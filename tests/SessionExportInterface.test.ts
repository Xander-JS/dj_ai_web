import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createSessionAudioBufferResolver, type SessionAudioBufferResolver } from '../src/session/SessionAudioBufferResolver.ts';
import { SessionExportBusyError, SessionExportCoordinator } from '../src/session/SessionExportCoordinator.ts';
import {
  createSessionDownload,
  createSessionExportFilename,
  initiateSessionDownload,
  releaseSessionDownload,
  type ObjectUrlApi,
} from '../src/session/SessionExportDownload.ts';
import type { SessionExportHandle, SessionExportRequest, SessionExportResult } from '../src/session/SessionExporter.ts';
import { isExportableSession } from '../src/session/SessionExportUiModel.ts';
import type { RecordedSession, SessionTrackReference } from '../src/session/SessionRecorder.ts';

function makeSession(track: SessionTrackReference | null = null): RecordedSession {
  return {
    sessionId: 'session/with unsafe:name',
    formatVersion: 2,
    createdAtEpochMs: 0,
    metadata: { title: ' Café / Late. Set ' },
    events: track ? [{
      type: 'deck.track-loaded',
      deckId: 'A',
      track,
      effectivePlaybackRate: 1,
      sequence: 0,
      sessionTimeMs: 0,
    }] : [],
    durationMs: 1000,
  };
}

function makeResult(format: 'wav' | 'mp3' = 'wav'): SessionExportResult {
  const mimeType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: mimeType });
  return {
    status: 'completed', format, blob, mimeType, byteLength: blob.size,
    durationMs: 1000, sampleRate: 48_000, channels: 2,
    ...(format === 'mp3' ? { bitrateKbps: 192 } : {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('Session export interface integration services', () => {
  test('marks only finalized sessions with duration and captured events as exportable', () => {
    const finalized = makeSession();
    assert.equal(isExportableSession(finalized), false);
    assert.equal(isExportableSession({ ...finalized, events: [{
      type: 'transport.stop', deckId: 'A', trackPositionSeconds: 0, sequence: 0, sessionTimeMs: 0,
    }] }), true);
    assert.equal(isExportableSession({ ...finalized, durationMs: 0, events: [{
      type: 'transport.stop', deckId: 'A', trackPositionSeconds: 0, sequence: 0, sessionTimeMs: 0,
    }] }), false);
    assert.equal(isExportableSession(null), false);
  });

  test('creates safe filenames and validates the selected format MIME and file size', () => {
    const session = makeSession();
    assert.equal(createSessionExportFilename(session, 'wav'), 'system-dj-Cafe-Late.-Set.wav');
    assert.equal(createSessionExportFilename({ ...session, metadata: {} }, 'mp3'), 'system-dj-session-with-unsafe-name.mp3');
    assert.equal(createSessionDownload(makeResult('wav'), session, {
      createObjectURL: () => 'blob:test-wav', revokeObjectURL() {},
    }).mimeType, 'audio/wav');
    assert.equal(createSessionDownload(makeResult('mp3'), session, {
      createObjectURL: () => 'blob:test-mp3', revokeObjectURL() {},
    }).filename.endsWith('.mp3'), true);
    assert.throws(() => createSessionDownload({ ...makeResult(), mimeType: 'audio/mpeg' }, session, {
      createObjectURL: () => 'blob:invalid', revokeObjectURL() {},
    }), /MIME type do not match/);
    assert.throws(() => createSessionDownload({ ...makeResult(), byteLength: 0 }, session, {
      createObjectURL: () => 'blob:invalid', revokeObjectURL() {},
    }), /invalid file size/);
  });

  test('initiates a browser-anchor download and releases the object URL', () => {
    const removed: string[] = [];
    let appended = 0;
    let clicked = 0;
    const anchor = {
      href: '', download: '', hidden: false,
      click() { clicked += 1; },
      remove() { removed.push(this.href); },
    } as unknown as HTMLAnchorElement;
    initiateSessionDownload({ url: 'blob:session', filename: 'mix.wav', mimeType: 'audio/wav' }, {
      createElement: () => anchor,
      body: { appendChild() { appended += 1; } },
    });
    assert.equal(appended, 1);
    assert.equal(clicked, 1);
    assert.deepEqual(removed, ['blob:session']);

    const failingAnchor = {
      href: '', download: '', hidden: false,
      click() { throw new Error('download blocked'); },
      remove() { removed.push('failed-anchor-removed'); },
    } as unknown as HTMLAnchorElement;
    assert.throws(() => initiateSessionDownload({
      url: 'blob:failure', filename: 'mix.wav', mimeType: 'audio/wav',
    }, {
      createElement: () => failingAnchor,
      body: { appendChild() {} },
    }), /download blocked/);
    assert.equal(removed.at(-1), 'failed-anchor-removed');

    const revoked: string[] = [];
    const urlApi: ObjectUrlApi = { createObjectURL: () => 'blob:unused', revokeObjectURL: (url) => revoked.push(url) };
    releaseSessionDownload({ url: 'blob:session', filename: 'mix.wav', mimeType: 'audio/wav' }, urlApi);
    releaseSessionDownload(null, urlApi);
    assert.deepEqual(revoked, ['blob:session']);
  });

  test('resolves source tracks once from local blobs, closes decoder context, and leaves session data untouched', async () => {
    const track: SessionTrackReference = {
      trackId: 'track-1', title: 'Local song', artist: 'Artist', durationSeconds: 1,
    };
    const session = makeSession(track);
    const originalEvents = structuredClone(session.events);
    const decoded = { numberOfChannels: 1 } as AudioBuffer;
    let blobReads = 0;
    let decodes = 0;
    let closes = 0;
    const resolver: SessionAudioBufferResolver = createSessionAudioBufferResolver(session, {
      getTrackBlob: async () => { blobReads += 1; return new Blob([new Uint8Array([7, 8])]); },
      createAudioContext: () => ({
        async decodeAudioData(data) {
          decodes += 1;
          assert.deepEqual([...new Uint8Array(data)], [7, 8]);
          return decoded;
        },
        async close() { closes += 1; },
      }),
    });

    const [first, second] = await Promise.all([resolver.resolve(track), resolver.resolve(track)]);
    assert.equal(first, decoded);
    assert.equal(second, decoded);
    assert.equal(blobReads, 1);
    assert.equal(decodes, 1);
    assert.equal(closes, 1);
    await resolver.dispose();
    assert.deepEqual(session.events, originalEvents);
    await assert.rejects(resolver.resolve(track), /disposed/);
  });

  test('reports a missing local source track as an actionable export preparation error', async () => {
    const track: SessionTrackReference = {
      trackId: 'deleted-track', title: 'Missing song', artist: 'Artist', durationSeconds: 1,
    };
    const resolver = createSessionAudioBufferResolver(makeSession(track), { getTrackBlob: async () => null });
    await assert.rejects(resolver.resolve(track), /source audio.*no longer available/);
    await resolver.dispose();
  });

  test('does not create a decoder after cancellation disposes a resolver waiting for local storage', async () => {
    const track: SessionTrackReference = {
      trackId: 'slow-track', title: 'Slow song', artist: 'Artist', durationSeconds: 1,
    };
    const blobResult = deferred<Blob | null>();
    let decoderCreations = 0;
    const resolver = createSessionAudioBufferResolver(makeSession(track), {
      getTrackBlob: () => blobResult.promise,
      createAudioContext: () => {
        decoderCreations += 1;
        return { async decodeAudioData() { return {} as AudioBuffer; }, async close() {} };
      },
    });
    const pending = resolver.resolve(track);
    await resolver.dispose();
    blobResult.resolve(new Blob([new Uint8Array([1])]));
    await assert.rejects(pending, /disposed/);
    assert.equal(decoderCreations, 0);
  });

  test('passes the selected format and validated options to the exporter and rejects overlapping work until cleanup', async () => {
    const finished = deferred<void>();
    const requests: SessionExportRequest[] = [];
    const handle: SessionExportHandle = {
      result: Promise.resolve(makeResult('mp3')),
      finished: finished.promise,
      cancel: () => true,
      progress: { phase: 'preparing', percent: 0, indeterminate: true },
    };
    const coordinator = new SessionExportCoordinator((request) => {
      requests.push(request);
      return handle;
    });
    const listenerCalls: number[] = [];
    coordinator.subscribe(() => listenerCalls.push(listenerCalls.length));
    const request: SessionExportRequest = {
      session: makeSession(),
      resolveBuffer: async () => null,
      format: 'mp3',
      render: { sampleRate: 48_000 },
      mp3: { bitrateKbps: 192 },
    };

    assert.equal(coordinator.startExclusive(request), handle);
    assert.equal(coordinator.getSnapshot(), true);
    assert.equal(requests[0].format, 'mp3');
    assert.deepEqual(requests[0].mp3, { bitrateKbps: 192 });
    assert.throws(() => coordinator.startExclusive(request), SessionExportBusyError);
    finished.resolve();
    await finished.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(coordinator.getSnapshot(), false);
    assert.equal(listenerCalls.length, 2);
  });
});
