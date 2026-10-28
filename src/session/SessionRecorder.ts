import type { DeckId } from '../types/deck.ts';
import type { CrossfaderCurve } from '../types/mixer.ts';

export const SESSION_FORMAT_VERSION = 2 as const;

export interface SessionMetadata {
  title?: string;
}

export interface SessionTrackReference {
  trackId: string;
  title: string;
  artist: string;
  durationSeconds: number;
  contentHash?: string;
  fileName?: string;
}

export interface SessionChannelState {
  gainLinear: number;
  volumeLinear: number;
  eqDb: {
    high: number;
    mid: number;
    low: number;
  };
  filter: number;
}

export interface SessionInitialDeckState {
  track: SessionTrackReference | null;
  playbackState: 'stopped' | 'playing' | 'paused';
  trackPositionSeconds: number;
  effectivePlaybackRate: number;
}

export interface SessionInitialState {
  decks: Record<DeckId, SessionInitialDeckState>;
  mixer: {
    channels: Record<DeckId, SessionChannelState>;
    crossfaderPosition: number;
    crossfaderCurve: CrossfaderCurve;
    masterGainLinear: number;
  };
}

export type SessionEventPayload =
  | { type: 'session.initial-state'; state: SessionInitialState }
  | {
      type: 'deck.track-loaded';
      deckId: DeckId;
      track: SessionTrackReference;
      effectivePlaybackRate: number;
    }
  | { type: 'deck.track-unloaded'; deckId: DeckId; trackId: string }
  | {
      type: 'transport.play';
      deckId: DeckId;
      trackPositionSeconds: number;
      effectivePlaybackRate: number;
    }
  | { type: 'transport.pause'; deckId: DeckId; trackPositionSeconds: number }
  | { type: 'transport.stop'; deckId: DeckId; trackPositionSeconds: 0 }
  | { type: 'transport.ended'; deckId: DeckId; trackPositionSeconds: 0 }
  | {
      type: 'transport.seek';
      deckId: DeckId;
      trackPositionSeconds: number;
      playbackState: 'stopped' | 'playing' | 'paused';
    }
  | {
      type: 'deck.playback-rate';
      deckId: DeckId;
      effectiveRate: number;
      rampDurationMs: number;
      cause: 'pitch' | 'sync' | 'pitch-bend';
    }
  | {
      /** Marks automation that the current event contract cannot replay faithfully. */
      type: 'deck.micro-slew';
      deckId: DeckId;
      baseRate?: number;
      peakRate?: number;
      rampDurationSeconds?: number;
      plateauDurationSeconds?: number;
      targetDisplacementSeconds?: number;
    }
  | {
      /** Auto Loop activado, cambiado o quitado (start / end null). */
      type: 'deck.loop';
      deckId: DeckId;
      beats: number;
      startSeconds: number | null;
      endSeconds: number | null;
    }
  | { type: 'mixer.channel-gain'; deckId: DeckId; gainLinear: number }
  | { type: 'mixer.channel-volume'; deckId: DeckId; volumeLinear: number }
  | {
      type: 'mixer.eq';
      deckId: DeckId;
      band: 'high' | 'mid' | 'low';
      gainDb: number;
    }
  | { type: 'mixer.filter'; deckId: DeckId; value: number }
  | {
      type: 'mixer.crossfader';
      position: number;
      curve: CrossfaderCurve;
    }
  | { type: 'mixer.master-gain'; gainLinear: number };

/**
 * Session time is elapsed monotonic time from capture start. Track positions remain
 * independent media offsets in seconds. Sequence records action confirmation order
 * and breaks ties when two events share a session timestamp.
 */
export type SessionEvent = SessionEventPayload & {
  /** Monotonic insertion order, including when events share a session timestamp. */
  sequence: number;
  /** Milliseconds elapsed from the session's monotonic start point. */
  sessionTimeMs: number;
};

export interface RecordedSession {
  sessionId: string;
  /** Version 1 remains accepted by the renderer for previously captured sessions. */
  formatVersion: 1 | typeof SESSION_FORMAT_VERSION;
  /** Informational wall-clock creation time; never used to order events. */
  createdAtEpochMs: number;
  metadata: SessionMetadata;
  events: SessionEvent[];
  durationMs?: number;
}

export type RecordEventResult =
  | { recorded: true; event: SessionEvent }
  | { recorded: false; reason: 'inactive' | 'invalid-timestamp' | 'regressive-timestamp' };

export interface SessionRecorderOptions {
  monotonicNow?: () => number;
  wallClockNow?: () => number;
  createSessionId?: () => string;
}

interface ActiveSession {
  session: RecordedSession;
  monotonicStartMs: number;
  lastSessionTimeMs: number;
}

let fallbackSessionId = 0;

function defaultCreateSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  fallbackSessionId += 1;
  return `system-dj-session-${Date.now()}-${fallbackSessionId}`;
}

function cloneSession(session: RecordedSession): RecordedSession {
  return {
    ...session,
    metadata: { ...session.metadata },
    events: session.events.map((event) => structuredClone(event)),
  };
}

/** Records an ordered, in-memory event stream. It has no dependency on the audio engine or UI. */
export class SessionRecorder {
  private readonly monotonicNow: () => number;
  private readonly wallClockNow: () => number;
  private readonly createSessionId: () => string;
  private active: ActiveSession | null = null;
  private lastFinalized: RecordedSession | null = null;

  public constructor(options: SessionRecorderOptions = {}) {
    this.monotonicNow = options.monotonicNow ?? (() => globalThis.performance.now());
    this.wallClockNow = options.wallClockNow ?? (() => Date.now());
    this.createSessionId = options.createSessionId ?? defaultCreateSessionId;
  }

  public start(metadata: SessionMetadata = {}): RecordedSession {
    if (this.active) {
      throw new Error('A session capture is already active. Finalize it before starting another.');
    }

    const monotonicStartMs = this.monotonicNow();
    const createdAtEpochMs = this.wallClockNow();
    if (!Number.isFinite(monotonicStartMs) || !Number.isFinite(createdAtEpochMs)) {
      throw new RangeError('Session clocks must return finite timestamps.');
    }

    const session: RecordedSession = {
      sessionId: this.createSessionId(),
      formatVersion: SESSION_FORMAT_VERSION,
      createdAtEpochMs,
      metadata: { ...metadata },
      events: [],
    };
    this.active = { session, monotonicStartMs, lastSessionTimeMs: 0 };
    this.lastFinalized = null;
    return cloneSession(session);
  }

  public record(payload: SessionEventPayload): RecordEventResult {
    if (!this.active) return { recorded: false, reason: 'inactive' };

    const monotonicNowMs = this.monotonicNow();
    if (!Number.isFinite(monotonicNowMs)) {
      return { recorded: false, reason: 'invalid-timestamp' };
    }

    // The initial-state snapshot defines session time zero. Capturing it takes a
    // measurable moment after start(), so re-anchor the clock instead of stamping it late.
    if (payload.type === 'session.initial-state' && this.active.session.events.length === 0) {
      this.active.monotonicStartMs = monotonicNowMs;
    }
    const sessionTimeMs = monotonicNowMs - this.active.monotonicStartMs;
    if (!Number.isFinite(sessionTimeMs) || sessionTimeMs < 0) {
      return { recorded: false, reason: 'invalid-timestamp' };
    }
    if (sessionTimeMs < this.active.lastSessionTimeMs) {
      return { recorded: false, reason: 'regressive-timestamp' };
    }

    const event = {
      ...structuredClone(payload),
      sequence: this.active.session.events.length,
      sessionTimeMs,
    } as SessionEvent;
    this.active.session.events.push(event);
    this.active.lastSessionTimeMs = sessionTimeMs;
    return { recorded: true, event: structuredClone(event) };
  }

  public getSession(): RecordedSession | null {
    if (this.active) return cloneSession(this.active.session);
    return this.lastFinalized ? cloneSession(this.lastFinalized) : null;
  }

  public finalize(): RecordedSession | null {
    if (!this.active) return this.lastFinalized ? cloneSession(this.lastFinalized) : null;

    const now = this.monotonicNow();
    const elapsed = Number.isFinite(now) ? now - this.active.monotonicStartMs : Number.NaN;
    this.active.session.durationMs = Number.isFinite(elapsed) && elapsed >= this.active.lastSessionTimeMs
      ? elapsed
      : this.active.lastSessionTimeMs;

    this.lastFinalized = this.active.session;
    this.active = null;
    return cloneSession(this.lastFinalized);
  }

  public get isActive(): boolean {
    return this.active !== null;
  }

  /** Discards the active and the last finalized session (factory reset). */
  public reset(): void {
    this.active = null;
    this.lastFinalized = null;
  }
}

/** Returns replay order without mutating the stored session. Sequence resolves timestamp ties. */
export function getSessionEventsInOrder(session: RecordedSession): SessionEvent[] {
  return session.events
    .map((event) => structuredClone(event))
    .sort((left, right) => left.sessionTimeMs - right.sessionTimeMs || left.sequence - right.sequence);
}

export const sessionRecorder = new SessionRecorder();
