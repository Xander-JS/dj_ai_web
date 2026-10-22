import type { SessionTrackReference } from './SessionRecorder.ts';
import type { RecordedSession, SessionEvent } from './SessionRecorder.ts';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage.ts';

export type GetSessionTrackBlob = (trackId: string) => Promise<Blob | null>;
export type CreateDecodeAudioContext = () => Pick<AudioContext, 'decodeAudioData' | 'close'>;

export interface SessionAudioBufferResolver {
  resolve(track: SessionTrackReference): Promise<AudioBuffer | null>;
  dispose(): Promise<void>;
}

function collectSessionTracks(session: RecordedSession): Map<string, SessionTrackReference> {
  const tracks = new Map<string, SessionTrackReference>();
  for (const event of session.events as SessionEvent[]) {
    if (event.type === 'session.initial-state') {
      for (const deck of Object.values(event.state.decks)) {
        if (deck.track) tracks.set(deck.track.trackId, deck.track);
      }
    } else if (event.type === 'deck.track-loaded') {
      tracks.set(event.track.trackId, event.track);
    }
  }
  return tracks;
}

function createBrowserDecodeContext(): Pick<AudioContext, 'decodeAudioData' | 'close'> {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Constructor = globalThis.AudioContext ?? scope.webkitAudioContext;
  if (!Constructor) throw new Error('Web Audio decoding is not available in this browser.');
  return new Constructor();
}

/** Resolves all source tracks from local storage without using or resuming live playback. */
export function createSessionAudioBufferResolver(
  session: RecordedSession,
  options: {
    getTrackBlob?: GetSessionTrackBlob;
    createAudioContext?: CreateDecodeAudioContext;
  } = {},
): SessionAudioBufferResolver {
  const getTrackBlob = options.getTrackBlob ?? ((trackId) => indexedDBStorage.getTrackBlob(trackId));
  const createContext = options.createAudioContext ?? createBrowserDecodeContext;
  const unresolvedTrackIds = new Set(collectSessionTracks(session).keys());
  const cache = new Map<string, Promise<AudioBuffer | null>>();
  let context: Pick<AudioContext, 'decodeAudioData' | 'close'> | null = null;
  let closePromise: Promise<void> | null = null;
  let disposed = false;

  const closeContext = (): Promise<void> => {
    if (!context) return closePromise ?? Promise.resolve();
    const activeContext = context;
    context = null;
    try {
      closePromise = Promise.resolve(activeContext.close()).then(() => undefined, () => undefined);
    } catch {
      closePromise = Promise.resolve();
    }
    return closePromise;
  };

  return {
    resolve(track): Promise<AudioBuffer | null> {
      if (disposed) return Promise.reject(new Error('Session audio resolver has been disposed.'));
      const cached = cache.get(track.trackId);
      if (cached) return cached;

      const load = (async (): Promise<AudioBuffer | null> => {
        try {
          const blob = await getTrackBlob(track.trackId);
          if (!blob) throw new Error(`The source audio for "${track.title}" is no longer available in the local library.`);
          if (disposed) throw new Error('Session audio resolver has been disposed.');
          context ??= createContext();
          const buffer = await context.decodeAudioData(await blob.arrayBuffer());
          if (disposed) throw new Error('Session audio resolver has been disposed.');
          return buffer;
        } finally {
          unresolvedTrackIds.delete(track.trackId);
          if (unresolvedTrackIds.size === 0) await closeContext();
        }
      })();
      cache.set(track.trackId, load);
      return load;
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      cache.clear();
      unresolvedTrackIds.clear();
      await closeContext();
    },
  };
}
