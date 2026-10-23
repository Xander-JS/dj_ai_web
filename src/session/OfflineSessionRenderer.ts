import { calculateCrossfaderGains, getBipolarFilterSettings } from '../audio/djAudioMath.ts';
import type { DeckId } from '../types/deck.ts';
import {
  getSessionEventsInOrder,
  SESSION_FORMAT_VERSION,
  type RecordedSession,
  type SessionEvent,
  type SessionInitialDeckState,
  type SessionInitialState,
  type SessionTrackReference,
} from './SessionRecorder.ts';

export type SessionBufferResolver = (
  track: SessionTrackReference,
) => AudioBuffer | null | Promise<AudioBuffer | null>;

export interface OfflineSessionRenderOptions {
  /** Optional crop/end override. It must include every recorded event. */
  durationMs?: number;
  sampleRate?: number;
  /** Guards memory use for the stereo Float32 output buffer (default 512 MiB). */
  maxOutputBytes?: number;
  /** Hard duration ceiling independent of the output byte ceiling (default 30 min). */
  maxDurationSeconds?: number;
  /** Rendered fraction in [0, 1], measured through OfflineAudioContext.suspend() checkpoints. */
  onProgress?: (fraction: number) => void;
  /** Injection point for deterministic scheduling tests and non-browser hosts. */
  createOfflineContext?: (channels: number, frames: number, sampleRate: number) => OfflineAudioContext;
}

export interface OfflineSessionRenderResult {
  buffer: AudioBuffer;
  durationMs: number;
  sampleRate: number;
}

export interface PlannedPlaybackRate {
  sessionTimeSeconds: number;
  effectiveRate: number;
  rampDurationSeconds: number;
  startRate: number;
}

export interface PlannedPlaybackSegment {
  deckId: DeckId;
  track: SessionTrackReference;
  buffer: AudioBuffer;
  sessionStartSeconds: number;
  sessionEndSeconds: number;
  trackStartSeconds: number;
  rates: PlannedPlaybackRate[];
}

export type SessionRenderErrorCode =
  | 'INVALID_SESSION'
  | 'UNKNOWN_VERSION'
  | 'EMPTY_SESSION'
  | 'INVALID_TIMELINE'
  | 'MISSING_BUFFER'
  | 'INVALID_BUFFER'
  | 'UNSUPPORTED_EVENT'
  | 'INVALID_DURATION'
  | 'RESOURCE_LIMIT'
  | 'OFFLINE_AUDIO_UNAVAILABLE'
  | 'RENDER_FAILED';

export class SessionRenderError extends Error {
  public readonly code: SessionRenderErrorCode;

  public constructor(code: SessionRenderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = 'SessionRenderError';
  }
}

interface RateRamp {
  start: number;
  end: number;
  from: number;
  to: number;
}

interface DeckPlanState extends SessionInitialDeckState {
  lastSessionTimeSeconds: number;
  /** Pending linear rate ramps in session time, in order (a micro-slew queues up to three). */
  ramps: RateRamp[];
  activeSegment: PlannedPlaybackSegment | null;
}

interface RenderPlan {
  durationMs: number;
  durationSeconds: number;
  sampleRate: number;
  initialState: SessionInitialState;
  events: SessionEvent[];
  segments: PlannedPlaybackSegment[];
}

const DEFAULT_SAMPLE_RATE = 48_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_DURATION_SECONDS = 30 * 60;
const SUPPORTED_EVENT_TYPES = new Set([
  'session.initial-state', 'deck.track-loaded', 'deck.track-unloaded', 'transport.play',
  'transport.pause', 'transport.stop', 'transport.ended', 'transport.seek', 'deck.playback-rate',
  'deck.micro-slew', 'mixer.channel-gain', 'mixer.channel-volume', 'mixer.eq', 'mixer.filter',
  'mixer.crossfader', 'mixer.master-gain',
]);

function fail(code: SessionRenderErrorCode, message: string): never {
  throw new SessionRenderError(code, message);
}

/** Duration metadata is informational; the decoded buffer is validated separately. */
function isValidTrack(track: SessionTrackReference): boolean {
  return typeof track.trackId === 'string' && track.trackId.length > 0
    && Number.isFinite(track.durationSeconds) && track.durationSeconds >= 0;
}

function validateSession(session: RecordedSession): { events: SessionEvent[]; initialState: SessionInitialState } {
  if (!session || typeof session !== 'object' || typeof session.sessionId !== 'string' || session.sessionId.length === 0
    || !session.metadata || typeof session.metadata !== 'object') {
    fail('INVALID_SESSION', 'A valid finalized session snapshot is required.');
  }
  if (session.formatVersion !== 1 && session.formatVersion !== SESSION_FORMAT_VERSION) {
    fail('UNKNOWN_VERSION', `Unsupported session format version: ${String(session.formatVersion)}.`);
  }
  if (!Number.isFinite(session.createdAtEpochMs)) fail('INVALID_SESSION', 'Session creation metadata is invalid.');
  if (!Array.isArray(session.events) || session.events.length === 0) {
    fail('EMPTY_SESSION', 'The session contains no events.');
  }
  if (session.events.some((event) => !event || typeof event.type !== 'string')) {
    fail('INVALID_SESSION', 'Session contains a malformed event.');
  }
  if (session.events.some((event) => !SUPPORTED_EVENT_TYPES.has(event.type))) {
    fail('UNSUPPORTED_EVENT', 'Session contains an event type that this renderer does not understand.');
  }

  const events = getSessionEventsInOrder(session);
  if (events.length > 100_000) fail('RESOURCE_LIMIT', 'Session contains too many events to render safely.');
  const seenSequences = new Set<number>();
  for (const event of events) {
    if ('deckId' in event && event.deckId !== 'A' && event.deckId !== 'B') {
      fail('INVALID_SESSION', `Event ${event.type} references an invalid deck.`);
    }
    if (event.type === 'deck.track-unloaded' && typeof event.trackId !== 'string') {
      fail('INVALID_SESSION', 'Track-unloaded event is missing its track id.');
    }
    if ((event.type === 'transport.stop' || event.type === 'transport.ended') && (event.trackPositionSeconds as number) !== 0) {
      fail('INVALID_TIMELINE', `${event.type} must reset the track position to zero.`);
    }
    if (!Number.isFinite(event.sessionTimeMs) || event.sessionTimeMs < 0
      || !Number.isInteger(event.sequence) || event.sequence < 0 || seenSequences.has(event.sequence)) {
      fail('INVALID_TIMELINE', 'Session events must have finite non-negative timestamps and unique non-negative sequence numbers.');
    }
    seenSequences.add(event.sequence);
    if (event.type === 'deck.micro-slew' && hasSlewProfile(event) && !isValidSlewProfile(event)) {
      fail('INVALID_TIMELINE', `Deck ${event.deckId} contains a micro-slew profile with invalid rates or durations.`);
    }
  }
  const recordedOrder = [...session.events].sort((left, right) => left.sequence - right.sequence);
  for (let index = 0; index < recordedOrder.length; index += 1) {
    if (recordedOrder[index].sequence !== index
      || (index > 0 && recordedOrder[index].sessionTimeMs < recordedOrder[index - 1].sessionTimeMs)) {
      fail('INVALID_TIMELINE', 'Event sequence must be contiguous and session time must not regress in recording order.');
    }
  }
  for (const event of events) {
    if (event.type === 'deck.track-loaded' && (!isValidTrack(event.track) || !validRate(event.effectivePlaybackRate))) {
      fail('INVALID_SESSION', 'Track-loaded event contains invalid track metadata or playback rate.');
    }
    if (event.type === 'transport.play' && (!Number.isFinite(event.trackPositionSeconds) || event.trackPositionSeconds < 0 || !validRate(event.effectivePlaybackRate))) {
      fail('INVALID_TIMELINE', 'Transport play event contains an invalid media position or playback rate.');
    }
    if (event.type === 'transport.pause' && (!Number.isFinite(event.trackPositionSeconds) || event.trackPositionSeconds < 0)) {
      fail('INVALID_TIMELINE', 'Transport pause event contains an invalid media position.');
    }
    if (event.type === 'transport.seek' && (!Number.isFinite(event.trackPositionSeconds) || event.trackPositionSeconds < 0)) {
      fail('INVALID_TIMELINE', 'Transport seek event contains an invalid media position.');
    }
    if (event.type === 'transport.seek' && !['stopped', 'playing', 'paused'].includes(event.playbackState)) {
      fail('INVALID_TIMELINE', 'Transport seek event contains an invalid playback state.');
    }
    if (event.type === 'deck.playback-rate' && (!validRate(event.effectiveRate) || !Number.isFinite(event.rampDurationMs) || event.rampDurationMs < 0)) {
      fail('INVALID_TIMELINE', 'Playback-rate event contains invalid values.');
    }
    if (event.type === 'deck.playback-rate' && !['pitch', 'sync', 'pitch-bend'].includes(event.cause)) {
      fail('INVALID_TIMELINE', 'Playback-rate event has an unknown cause.');
    }
    if (event.type === 'mixer.channel-gain' && (!Number.isFinite(event.gainLinear) || event.gainLinear < 0 || event.gainLinear > 2)) {
      fail('INVALID_SESSION', 'Channel gain event must be within the engine range from 0 to 2.');
    }
    if (event.type === 'mixer.channel-volume' && (!Number.isFinite(event.volumeLinear) || event.volumeLinear < 0 || event.volumeLinear > 1)) {
      fail('INVALID_SESSION', 'Channel volume event must be within the engine range from 0 to 1.');
    }
    if (event.type === 'mixer.eq' && (!['high', 'mid', 'low'].includes(event.band)
      || !Number.isFinite(event.gainDb) || event.gainDb < -12 || event.gainDb > 12)) {
      fail('INVALID_SESSION', 'EQ event must be within the engine range from -12 to 12 dB.');
    }
    if (event.type === 'mixer.filter' && (!Number.isFinite(event.value) || event.value < -100 || event.value > 100)) {
      fail('INVALID_SESSION', 'Filter event must be within the engine range from -100 to 100.');
    }
    if (event.type === 'mixer.crossfader' && (!Number.isFinite(event.position) || event.position < 0 || event.position > 1
      || !['linear', 'constant-power', 'cut'].includes(event.curve))) {
      fail('INVALID_SESSION', 'Crossfader event contains an invalid position or curve.');
    }
    if (event.type === 'mixer.master-gain' && (!Number.isFinite(event.gainLinear) || event.gainLinear < 0 || event.gainLinear > 1)) {
      fail('INVALID_SESSION', 'Master gain event must be within the engine range from 0 to 1.');
    }
  }
  // Sessions recorded before the recorder re-anchored its clock stamp the snapshot
  // a fraction of a millisecond late; it is still the session origin.
  const first = events[0];
  if (first.type !== 'session.initial-state' || first.sequence !== 0) {
    fail('INVALID_SESSION', 'The first event must be the initial-state snapshot.');
  }
  if (events.slice(1).some((event) => event.type === 'session.initial-state')) {
    fail('INVALID_SESSION', 'A session must contain exactly one initial-state event.');
  }
  return { events, initialState: first.state };
}

function validateInitialState(state: SessionInitialState): void {
  if (!state || typeof state !== 'object' || !state.decks || !state.mixer) {
    fail('INVALID_SESSION', 'Session initial state is missing deck or mixer data.');
  }
  for (const deckId of ['A', 'B'] as const) {
    const deck = state.decks?.[deckId];
    const channel = state.mixer?.channels?.[deckId];
    if (!deck || !channel || !['stopped', 'playing', 'paused'].includes(deck.playbackState)
      || !Number.isFinite(deck.trackPositionSeconds) || deck.trackPositionSeconds < 0
      || !validRate(deck.effectivePlaybackRate)
      || !Number.isFinite(channel.gainLinear) || channel.gainLinear < 0 || channel.gainLinear > 2
      || !Number.isFinite(channel.volumeLinear) || channel.volumeLinear < 0 || channel.volumeLinear > 1
      || !channel.eqDb || !Number.isFinite(channel.filter) || channel.filter < -100 || channel.filter > 100
      || !Number.isFinite(channel.eqDb.high) || channel.eqDb.high < -12 || channel.eqDb.high > 12
      || !Number.isFinite(channel.eqDb.mid) || channel.eqDb.mid < -12 || channel.eqDb.mid > 12
      || !Number.isFinite(channel.eqDb.low) || channel.eqDb.low < -12 || channel.eqDb.low > 12) {
      fail('INVALID_SESSION', `Initial state for deck ${deckId} contains invalid transport or mixer values.`);
    }
    if (deck.track && !isValidTrack(deck.track)) fail('INVALID_SESSION', `Initial track reference for deck ${deckId} is invalid.`);
  }
  const { crossfaderPosition, crossfaderCurve, masterGainLinear } = state.mixer;
  if (!Number.isFinite(crossfaderPosition) || crossfaderPosition < 0 || crossfaderPosition > 1
    || !['linear', 'constant-power', 'cut'].includes(crossfaderCurve)
    || !Number.isFinite(masterGainLinear) || masterGainLinear < 0 || masterGainLinear > 1) {
    fail('INVALID_SESSION', 'Initial master mixer state is invalid.');
  }
}

function validRate(value: number): boolean {
  return Number.isFinite(value) && value >= 0.92 && value <= 1.08;
}

type MicroSlewEvent = Extract<SessionEvent, { type: 'deck.micro-slew' }>;

/** A micro-slew recorded when capture starts mid-maneuver carries no profile. */
function hasSlewProfile(event: MicroSlewEvent): boolean {
  return event.baseRate !== undefined || event.peakRate !== undefined
    || event.rampDurationSeconds !== undefined || event.plateauDurationSeconds !== undefined;
}

function isValidSlewProfile(event: MicroSlewEvent): event is MicroSlewEvent & {
  baseRate: number; peakRate: number; rampDurationSeconds: number; plateauDurationSeconds: number;
} {
  return validRate(event.baseRate as number) && validRate(event.peakRate as number)
    && Number.isFinite(event.rampDurationSeconds) && (event.rampDurationSeconds as number) > 0
    && Number.isFinite(event.plateauDurationSeconds) && (event.plateauDurationSeconds as number) >= 0;
}

function rateAt(ramp: RateRamp, time: number): number {
  return ramp.from + (ramp.to - ramp.from) * ((time - ramp.start) / (ramp.end - ramp.start));
}

function advancePlayback(state: DeckPlanState, timeSeconds: number): void {
  if (timeSeconds < state.lastSessionTimeSeconds) fail('INVALID_TIMELINE', 'Event timestamps regress after ordering.');
  if (state.playbackState === 'playing') {
    let cursor = state.lastSessionTimeSeconds;
    while (cursor < timeSeconds) {
      const ramp = state.ramps[0];
      if (!ramp || timeSeconds <= ramp.start) {
        state.trackPositionSeconds += (timeSeconds - cursor) * state.effectivePlaybackRate;
        break;
      }
      if (cursor < ramp.start) {
        state.trackPositionSeconds += (ramp.start - cursor) * state.effectivePlaybackRate;
        cursor = ramp.start;
      }
      const segmentEnd = Math.min(timeSeconds, ramp.end);
      state.trackPositionSeconds += (rateAt(ramp, cursor) + rateAt(ramp, segmentEnd)) * 0.5 * (segmentEnd - cursor);
      cursor = segmentEnd;
      if (segmentEnd >= ramp.end) {
        state.effectivePlaybackRate = ramp.to;
        state.ramps.shift();
      } else {
        state.effectivePlaybackRate = rateAt(ramp, segmentEnd);
      }
    }
  }
  state.lastSessionTimeSeconds = timeSeconds;
}

function closeSegment(state: DeckPlanState, timeSeconds: number, segments: PlannedPlaybackSegment[]): void {
  if (state.activeSegment) {
    state.activeSegment.sessionEndSeconds = timeSeconds;
    if (timeSeconds > state.activeSegment.sessionStartSeconds) segments.push(state.activeSegment);
    state.activeSegment = null;
  }
}

function startSegment(deckId: DeckId, state: DeckPlanState, timeSeconds: number): void {
  const resolved = state as ResolvedDeckPlanState;
  if (!state.track || !resolved._buffer) return;
  // Playing from the very end (seek clamp, ended race) is silent, not an invalid session.
  if (state.trackPositionSeconds >= resolved._buffer.duration) return;
  state.activeSegment = {
    deckId,
    track: state.track,
    buffer: resolved._buffer,
    sessionStartSeconds: timeSeconds,
    sessionEndSeconds: Number.POSITIVE_INFINITY,
    trackStartSeconds: state.trackPositionSeconds,
    rates: [{ sessionTimeSeconds: timeSeconds, effectiveRate: state.effectivePlaybackRate, rampDurationSeconds: 0, startRate: state.effectivePlaybackRate }],
  };
}

interface ResolvedDeckPlanState extends DeckPlanState {
  _buffer: AudioBuffer | null;
}

function validateTrackPosition(positionSeconds: number, deckId: DeckId): void {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
    fail('INVALID_TIMELINE', `Deck ${deckId} has an invalid playback position.`);
  }
}

async function planRender(
  session: RecordedSession,
  resolveBuffer: SessionBufferResolver,
  options: OfflineSessionRenderOptions,
): Promise<{ plan: RenderPlan; resolvedBuffers: Map<string, AudioBuffer> }> {
  if (typeof resolveBuffer !== 'function') fail('MISSING_BUFFER', 'A decoded-buffer resolver is required.');
  const { events, initialState } = validateSession(session);
  validateInitialState(initialState);
  if (!Number.isFinite(session.durationMs) || (session.durationMs ?? 0) <= 0) {
    fail('INVALID_DURATION', 'A finalized session duration greater than zero is required.');
  }
  const durationMs = options.durationMs ?? session.durationMs;
  if (!Number.isFinite(durationMs) || (durationMs ?? 0) <= 0) {
    fail('INVALID_DURATION', 'A finalized session duration greater than zero is required.');
  }
  const durationSeconds = durationMs! / 1000;
  if (durationMs! > session.durationMs!) fail('INVALID_DURATION', 'Render duration cannot extend beyond the finalized session duration.');
  const maxDurationSeconds = options.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0
    || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    fail('INVALID_DURATION', 'Render memory and duration limits must be finite positive values.');
  }
  if (durationSeconds > maxDurationSeconds) fail('RESOURCE_LIMIT', `Session duration exceeds the ${maxDurationSeconds}s render limit.`);
  if (events.some((event) => event.sessionTimeMs > durationMs!)) {
    fail('INVALID_TIMELINE', 'A session event occurs after the requested render duration.');
  }
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    fail('INVALID_DURATION', 'Render sample rate must be an integer between 8000 and 192000 Hz.');
  }
  const frames = Math.ceil(durationSeconds * sampleRate);
  const bytes = frames * 2 * Float32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(frames) || bytes > maxOutputBytes) {
    fail('RESOURCE_LIMIT', 'Requested stereo output exceeds the configured memory limit.');
  }

  const trackReferences = new Map<string, SessionTrackReference>();
  const addTrack = (track: SessionTrackReference | null) => {
    if (!track) return;
    if (!isValidTrack(track)) fail('INVALID_SESSION', `Track reference ${track.trackId} is invalid.`);
    const prior = trackReferences.get(track.trackId);
    if (prior && prior.contentHash && track.contentHash && prior.contentHash !== track.contentHash) {
      fail('INVALID_SESSION', `Track id ${track.trackId} maps to conflicting content hashes.`);
    }
    trackReferences.set(track.trackId, track);
  };
  for (const deckId of ['A', 'B'] as const) addTrack(initialState.decks[deckId].track);
  for (const event of events) if (event.type === 'deck.track-loaded') addTrack(event.track);

  const resolvedBuffers = new Map<string, AudioBuffer>();
  for (const [trackId, reference] of trackReferences) {
    let buffer: AudioBuffer | null;
    try {
      buffer = await resolveBuffer(reference);
    } catch (error) {
      throw new SessionRenderError('MISSING_BUFFER', `Could not resolve audio for track ${trackId}.`, { cause: error });
    }
    if (!buffer) fail('MISSING_BUFFER', `No decoded audio buffer was provided for track ${trackId}.`);
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || !Number.isInteger(buffer.numberOfChannels)
      || buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2 || !Number.isFinite(buffer.sampleRate)
      || buffer.sampleRate <= 0 || buffer.length <= 0) {
      fail('INVALID_BUFFER', `Audio buffer for track ${trackId} has unsupported dimensions.`);
    }
    resolvedBuffers.set(trackId, buffer);
  }

  const decks = {} as Record<DeckId, ResolvedDeckPlanState>;
  for (const deckId of ['A', 'B'] as const) {
    const initial = initialState.decks[deckId];
    const initialBuffer = initial.track ? resolvedBuffers.get(initial.track.trackId) ?? null : null;
    decks[deckId] = {
      ...initial,
      lastSessionTimeSeconds: 0,
      ramps: [],
      activeSegment: null,
      _buffer: initialBuffer,
    };
    if (initial.playbackState === 'playing' && !initial.track) {
      fail('INVALID_SESSION', `Deck ${deckId} is playing without a loaded track.`);
    }
    if (initial.playbackState === 'playing') startSegment(deckId, decks[deckId], 0);
  }

  const segments: PlannedPlaybackSegment[] = [];
  const scheduledEvents = events.slice(1);
  for (const event of scheduledEvents) {
    const at = event.sessionTimeMs / 1000;
    if (event.type === 'session.initial-state') fail('INVALID_SESSION', 'Multiple initial-state events are not supported.');
    if (event.type.startsWith('mixer.')) continue;
    if (event.type !== 'deck.track-loaded' && event.type !== 'deck.track-unloaded'
      && event.type !== 'deck.playback-rate' && event.type !== 'transport.play'
      && event.type !== 'transport.pause' && event.type !== 'transport.stop'
      && event.type !== 'transport.ended' && event.type !== 'transport.seek'
      && event.type !== 'deck.micro-slew') {
      fail('UNSUPPORTED_EVENT', `Event type ${event.type} cannot be replayed by this renderer.`);
    }
    const state = decks[event.deckId];
    advancePlayback(state, at);
    switch (event.type) {
      case 'deck.track-loaded':
        closeSegment(state, at, segments);
        state.track = event.track;
        state._buffer = resolvedBuffers.get(event.track.trackId) ?? null;
        state.trackPositionSeconds = 0;
        state.playbackState = 'stopped';
        state.effectivePlaybackRate = event.effectivePlaybackRate;
        state.ramps = [];
        break;
      case 'deck.track-unloaded':
        closeSegment(state, at, segments);
        if (state.track && state.track.trackId !== event.trackId) {
          fail('INVALID_TIMELINE', `Deck ${event.deckId} unload event does not match its loaded track.`);
        }
        state.track = null;
        state._buffer = null;
        state.trackPositionSeconds = 0;
        state.playbackState = 'stopped';
        state.ramps = [];
        break;
      case 'transport.play':
        if (!state.track || !state._buffer) fail('INVALID_SESSION', `Deck ${event.deckId} cannot play without a resolved track.`);
        closeSegment(state, at, segments);
        validateTrackPosition(event.trackPositionSeconds, event.deckId);
        state.trackPositionSeconds = event.trackPositionSeconds;
        state.effectivePlaybackRate = event.effectivePlaybackRate;
        state.ramps = [];
        state.playbackState = 'playing';
        startSegment(event.deckId, state, at);
        break;
      case 'transport.pause':
        closeSegment(state, at, segments);
        validateTrackPosition(event.trackPositionSeconds, event.deckId);
        state.trackPositionSeconds = event.trackPositionSeconds;
        state.playbackState = 'paused';
        break;
      case 'transport.stop':
      case 'transport.ended':
        closeSegment(state, at, segments);
        state.trackPositionSeconds = 0;
        state.playbackState = 'stopped';
        state.ramps = [];
        break;
      case 'transport.seek':
        closeSegment(state, at, segments);
        validateTrackPosition(event.trackPositionSeconds, event.deckId);
        state.trackPositionSeconds = event.trackPositionSeconds;
        state.playbackState = event.playbackState;
        if (event.playbackState === 'playing') startSegment(event.deckId, state, at);
        break;
      case 'deck.playback-rate': {
        if (!Number.isFinite(event.effectiveRate) || event.effectiveRate <= 0 || event.rampDurationMs < 0) {
          fail('INVALID_TIMELINE', 'Playback-rate event has invalid values.');
        }
        const rampDurationSeconds = event.rampDurationMs / 1000;
        const startRate = state.effectivePlaybackRate;
        if (state.activeSegment) {
          state.activeSegment.rates.push({ sessionTimeSeconds: at, effectiveRate: event.effectiveRate, rampDurationSeconds, startRate });
        }
        if (rampDurationSeconds > 0 && state.playbackState === 'playing') {
          const from = state.effectivePlaybackRate;
          state.ramps = [{ start: at, end: at + rampDurationSeconds, from, to: event.effectiveRate }];
        } else {
          state.ramps = [];
          state.effectivePlaybackRate = event.effectiveRate;
        }
        break;
      }
      case 'deck.micro-slew': {
        // Without a profile (capture started mid-maneuver) the remaining slew is a
        // sub-beat correction; keeping the base rate is the closest faithful replay.
        if (!isValidSlewProfile(event) || state.playbackState !== 'playing' || !state.activeSegment) break;
        const { baseRate, peakRate, rampDurationSeconds, plateauDurationSeconds } = event;
        const rampUpEnd = at + rampDurationSeconds;
        const plateauEnd = rampUpEnd + plateauDurationSeconds;
        const rates = state.activeSegment.rates;
        rates.push({ sessionTimeSeconds: at, effectiveRate: peakRate, rampDurationSeconds, startRate: baseRate });
        if (plateauDurationSeconds > 0) {
          rates.push({ sessionTimeSeconds: rampUpEnd, effectiveRate: peakRate, rampDurationSeconds: plateauDurationSeconds, startRate: peakRate });
        }
        rates.push({ sessionTimeSeconds: plateauEnd, effectiveRate: baseRate, rampDurationSeconds, startRate: peakRate });
        state.effectivePlaybackRate = baseRate;
        state.ramps = [
          { start: at, end: rampUpEnd, from: baseRate, to: peakRate },
          ...(plateauDurationSeconds > 0 ? [{ start: rampUpEnd, end: plateauEnd, from: peakRate, to: peakRate }] : []),
          { start: plateauEnd, end: plateauEnd + rampDurationSeconds, from: peakRate, to: baseRate },
        ];
        break;
      }
    }
  }
  for (const deckId of ['A', 'B'] as const) closeSegment(decks[deckId], durationSeconds, segments);

  return {
    plan: { durationMs: durationSeconds * 1000, durationSeconds, sampleRate, initialState, events, segments },
    resolvedBuffers,
  };
}

function setParam(param: AudioParam, value: number, time: number): void {
  param.setValueAtTime(value, time);
}

const RENDER_PROGRESS_STEPS = 20;

/**
 * OfflineAudioContext has no progress event. Suspending at evenly spaced,
 * render-quantum-aligned times and resuming immediately yields measured progress.
 */
function scheduleRenderProgress(
  context: OfflineAudioContext,
  durationSeconds: number,
  sampleRate: number,
  onProgress: ((fraction: number) => void) | undefined,
): void {
  if (!onProgress || typeof context.suspend !== 'function' || typeof context.resume !== 'function') return;
  const quantumSeconds = 128 / sampleRate;
  const scheduled = new Set<number>();
  for (let step = 1; step < RENDER_PROGRESS_STEPS; step += 1) {
    const time = Math.floor((durationSeconds * step) / RENDER_PROGRESS_STEPS / quantumSeconds) * quantumSeconds;
    if (time <= 0 || time >= durationSeconds || scheduled.has(time)) continue;
    scheduled.add(time);
    const fraction = step / RENDER_PROGRESS_STEPS;
    context.suspend(time).then(() => {
      try { onProgress(fraction); } catch { /* Progress listeners must never stall rendering. */ }
      return context.resume();
    }).catch(() => { /* A rejected checkpoint only loses one progress update. */ });
  }
}

function createBrowserOfflineContext(channels: number, frames: number, sampleRate: number): OfflineAudioContext {
  const Constructor = globalThis.OfflineAudioContext;
  if (!Constructor) fail('OFFLINE_AUDIO_UNAVAILABLE', 'OfflineAudioContext is not available in this environment.');
  return new Constructor(channels, frames, sampleRate);
}

/**
 * Reconstructs a finalized version-1 session in an isolated stereo offline graph.
 * Session time starts at 0; track offsets remain media positions in seconds.
 */
export async function renderSessionOffline(
  session: RecordedSession,
  resolveBuffer: SessionBufferResolver,
  options: OfflineSessionRenderOptions = {},
): Promise<OfflineSessionRenderResult> {
  const { plan } = await planRender(session, resolveBuffer, options);
  const frames = Math.ceil(plan.durationSeconds * plan.sampleRate);
  let context: OfflineAudioContext;
  try {
    context = (options.createOfflineContext ?? createBrowserOfflineContext)(2, frames, plan.sampleRate);
  } catch (error) {
    if (error instanceof SessionRenderError) throw error;
    throw new SessionRenderError('RENDER_FAILED', 'Could not create the offline audio context.', { cause: error });
  }

  const nodes: AudioNode[] = [];
  const sources: AudioBufferSourceNode[] = [];
  try {
  const makeGain = (value: number): GainNode => {
    const node = context.createGain();
    setParam(node.gain, value, 0);
    nodes.push(node);
    return node;
  };
  const master = makeGain(plan.initialState.mixer.masterGainLinear);
  let output: AudioNode = master;
  if (typeof context.createDynamicsCompressor === 'function') {
    const compressor = context.createDynamicsCompressor();
    setParam(compressor.threshold, -1, 0);
    setParam(compressor.knee, 0, 0);
    setParam(compressor.ratio, 20, 0);
    setParam(compressor.attack, 0.001, 0);
    setParam(compressor.release, 0.2, 0);
    master.connect(compressor);
    nodes.push(compressor);
    output = compressor;
  }
  output.connect(context.destination);

  const channelNodes = {} as Record<DeckId, {
    gain: GainNode; high: BiquadFilterNode; mid: BiquadFilterNode;
    low: BiquadFilterNode; volume: GainNode; cross: GainNode;
  }>;
  for (const deckId of ['A', 'B'] as const) {
    const channel = plan.initialState.mixer.channels[deckId];
    const gain = makeGain(channel.gainLinear);
    const high = context.createBiquadFilter(); high.type = 'highshelf'; setParam(high.frequency, 2500, 0); setParam(high.gain, channel.eqDb.high, 0);
    const mid = context.createBiquadFilter(); mid.type = 'peaking'; setParam(mid.frequency, 1000, 0); setParam(mid.Q, 1, 0); setParam(mid.gain, channel.eqDb.mid, 0);
    const low = context.createBiquadFilter(); low.type = 'lowshelf'; setParam(low.frequency, 300, 0); setParam(low.gain, channel.eqDb.low, 0);
    const volume = makeGain(channel.volumeLinear);
    const crossfader = calculateCrossfaderGains(plan.initialState.mixer.crossfaderPosition, plan.initialState.mixer.crossfaderCurve);
    const cross = makeGain(deckId === 'A' ? crossfader.gainA : crossfader.gainB);
    const filterStates: Array<{ at: number; value: number }> = [{ at: 0, value: channel.filter }];
    for (const event of plan.events.slice(1)) {
      if (event.type === 'mixer.filter' && event.deckId === deckId) {
        const at = event.sessionTimeMs / 1000;
        const last = filterStates.at(-1)!;
        if (last.at === at) last.value = event.value;
        else filterStates.push({ at, value: event.value });
      }
    }
    if (filterStates.length > 4096) fail('RESOURCE_LIMIT', `Deck ${deckId} has too many filter changes to render safely.`);
    filterStates.forEach((state, index) => {
      const filter = context.createBiquadFilter();
      const settings = getBipolarFilterSettings(state.value);
      filter.type = settings.type;
      if (settings.frequency !== undefined) setParam(filter.frequency, settings.frequency, 0);
      const gate = makeGain(index === 0 ? 1 : 0);
      if (index > 0) setParam(gate.gain, 1, state.at);
      const next = filterStates[index + 1];
      if (next) setParam(gate.gain, 0, next.at);
      gain.connect(filter);
      filter.connect(gate);
      gate.connect(high);
      nodes.push(filter);
    });
    high.connect(mid); mid.connect(low); low.connect(volume); volume.connect(cross); cross.connect(master);
    nodes.push(high, mid, low);
    channelNodes[deckId] = { gain, high, mid, low, volume, cross };
  }

  for (const event of plan.events.slice(1)) {
    const time = event.sessionTimeMs / 1000;
    if (event.type === 'mixer.channel-gain') setParam(channelNodes[event.deckId].gain.gain, event.gainLinear, time);
    else if (event.type === 'mixer.channel-volume') setParam(channelNodes[event.deckId].volume.gain, event.volumeLinear, time);
    else if (event.type === 'mixer.eq') {
      const node = event.band === 'high' ? channelNodes[event.deckId].high : event.band === 'mid' ? channelNodes[event.deckId].mid : channelNodes[event.deckId].low;
      setParam(node.gain, event.gainDb, time);
    } else if (event.type === 'mixer.filter') {
      // Filter type is not an AudioParam. Its time interval is represented by a gated branch above.
    } else if (event.type === 'mixer.crossfader') {
      const values = calculateCrossfaderGains(event.position, event.curve);
      setParam(channelNodes.A.cross.gain, values.gainA, time);
      setParam(channelNodes.B.cross.gain, values.gainB, time);
    } else if (event.type === 'mixer.master-gain') setParam(master.gain, event.gainLinear, time);
  }

    for (const segment of plan.segments) {
      if (segment.sessionStartSeconds >= plan.durationSeconds || segment.trackStartSeconds >= segment.buffer.duration) continue;
      const source = context.createBufferSource();
      source.buffer = segment.buffer;
      source.connect(channelNodes[segment.deckId].gain);
      const firstRate = segment.rates[0];
      source.playbackRate.setValueAtTime(firstRate.effectiveRate, segment.sessionStartSeconds);
      let rampScheduledUntil = segment.sessionStartSeconds;
      for (const rate of segment.rates.slice(1)) {
        // A rate change that interrupts a pending ramp (e.g. pitch moved mid-slew)
        // must drop that ramp's end event, or the param keeps ramping toward it.
        if (rate.sessionTimeSeconds < rampScheduledUntil && typeof source.playbackRate.cancelScheduledValues === 'function') {
          source.playbackRate.cancelScheduledValues(rate.sessionTimeSeconds);
        }
        rampScheduledUntil = Math.max(rampScheduledUntil, rate.sessionTimeSeconds + rate.rampDurationSeconds);
        if (rate.rampDurationSeconds > 0) {
          source.playbackRate.setValueAtTime(rate.startRate, rate.sessionTimeSeconds);
          source.playbackRate.linearRampToValueAtTime(rate.effectiveRate, rate.sessionTimeSeconds + rate.rampDurationSeconds);
        } else {
          source.playbackRate.setValueAtTime(rate.effectiveRate, rate.sessionTimeSeconds);
        }
      }
      const segmentEnd = Math.min(segment.sessionEndSeconds, plan.durationSeconds);
      source.start(segment.sessionStartSeconds, segment.trackStartSeconds);
      if (Number.isFinite(segmentEnd) && segmentEnd > segment.sessionStartSeconds) source.stop(segmentEnd);
      sources.push(source);
      nodes.push(source);
    }
    scheduleRenderProgress(context, plan.durationSeconds, plan.sampleRate, options.onProgress);
    const buffer = await context.startRendering();
    if (!buffer || buffer.numberOfChannels !== 2 || buffer.sampleRate !== plan.sampleRate
      || buffer.length !== frames || !Number.isFinite(buffer.duration) || buffer.duration <= 0) {
      throw new Error('OfflineAudioContext returned an invalid or inconsistent AudioBuffer.');
    }
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* Rendering is complete; tolerate already-disconnected nodes. */ }
    }
    options.onProgress?.(1);
    return { buffer, durationMs: buffer.duration * 1000, sampleRate: buffer.sampleRate };
  } catch (error) {
    for (const source of sources) {
      try { source.stop(); } catch { /* A failed render may already have stopped the source. */ }
    }
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* Release best-effort after rendering errors. */ }
    }
    if (error instanceof SessionRenderError) throw error;
    throw new SessionRenderError('RENDER_FAILED', 'Offline audio rendering failed.', { cause: error });
  }
}
