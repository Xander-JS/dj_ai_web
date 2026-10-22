import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getSessionEventsInOrder,
  SESSION_FORMAT_VERSION,
  SessionRecorder,
} from '../src/session/SessionRecorder.ts';

describe('SessionRecorder — versioned event contract', () => {
  let monotonicMs = 100;
  const createRecorder = () => new SessionRecorder({
    monotonicNow: () => monotonicMs,
    wallClockNow: () => 1_800_000_000_000,
    createSessionId: () => 'session-test-1',
  });

  test('creates a session with stable identity, version and wall-clock metadata', () => {
    monotonicMs = 100;
    const recorder = createRecorder();
    const session = recorder.start({ title: 'Night set' });

    assert.equal(session.sessionId, 'session-test-1');
    assert.equal(session.formatVersion, SESSION_FORMAT_VERSION);
    assert.equal(session.createdAtEpochMs, 1_800_000_000_000);
    assert.deepEqual(session.metadata, { title: 'Night set' });
    assert.deepEqual(session.events, []);
  });

  test('records monotonic session offsets independently from wall-clock time', () => {
    monotonicMs = 400;
    const recorder = createRecorder();
    recorder.start();
    monotonicMs = 425.5;

    const result = recorder.record({
      type: 'mixer.crossfader',
      position: 0.75,
      curve: 'linear',
    });

    assert.equal(result.recorded, true);
    if (!result.recorded) return;
    assert.equal(result.event.sessionTimeMs, 25.5);
    assert.equal(result.event.sequence, 0);
  });

  test('preserves insertion order for events with the same timestamp', () => {
    monotonicMs = 10;
    const recorder = createRecorder();
    recorder.start();
    recorder.record({ type: 'mixer.channel-gain', deckId: 'A', gainLinear: 1.5 });
    recorder.record({ type: 'mixer.channel-volume', deckId: 'B', volumeLinear: 0.6 });

    const session = recorder.getSession()!;
    const ordered = getSessionEventsInOrder(session);

    assert.equal(ordered[0].sessionTimeMs, ordered[1].sessionTimeMs);
    assert.deepEqual(ordered.map((event) => event.sequence), [0, 1]);
    assert.deepEqual(ordered.map((event) => event.type), ['mixer.channel-gain', 'mixer.channel-volume']);
  });

  test('retains typed event payloads and returns detached snapshots', () => {
    monotonicMs = 50;
    const recorder = createRecorder();
    recorder.start();
    const initialState = {
      decks: {
        A: { track: null, playbackState: 'stopped' as const, trackPositionSeconds: 0, effectivePlaybackRate: 1 },
        B: { track: null, playbackState: 'paused' as const, trackPositionSeconds: 22, effectivePlaybackRate: 1.04 },
      },
      mixer: {
        channels: {
          A: { gainLinear: 1, volumeLinear: 0.8, eqDb: { high: 0, mid: 0, low: 0 }, filter: 0 },
          B: { gainLinear: 1.5, volumeLinear: 0.6, eqDb: { high: 4, mid: -2, low: 0 }, filter: -25 },
        },
        crossfaderPosition: 0.65,
        crossfaderCurve: 'constant-power' as const,
        masterGainLinear: 0.8,
      },
    };
    recorder.record({ type: 'session.initial-state', state: initialState });

    const snapshot = recorder.getSession()!;
    assert.equal(snapshot.events[0].type, 'session.initial-state');
    assert.equal(snapshot.events[0].state.decks.B.trackPositionSeconds, 22);
    assert.equal(snapshot.events[0].state.mixer.channels.B.eqDb.high, 4);
    snapshot.events[0].state.mixer.channels.B.eqDb.high = 99;
    assert.equal(recorder.getSession()!.events[0].state.mixer.channels.B.eqDb.high, 4);
  });

  test('does not record when capture is inactive', () => {
    const recorder = createRecorder();
    assert.deepEqual(
      recorder.record({ type: 'transport.stop', deckId: 'A', trackPositionSeconds: 0 }),
      { recorded: false, reason: 'inactive' },
    );
  });

  test('finalizes capture, fixes duration and permits a later session', () => {
    monotonicMs = 100;
    const recorder = createRecorder();
    recorder.start();
    monotonicMs = 150;
    recorder.record({ type: 'transport.stop', deckId: 'A', trackPositionSeconds: 0 });
    monotonicMs = 180;

    const finalized = recorder.finalize();
    assert.equal(finalized?.durationMs, 80);
    assert.equal(recorder.isActive, false);
    assert.equal(recorder.getSession()?.durationMs, 80);
    assert.deepEqual(
      recorder.record({ type: 'transport.stop', deckId: 'A', trackPositionSeconds: 0 }),
      { recorded: false, reason: 'inactive' },
    );

    monotonicMs = 200;
    assert.equal(recorder.start().formatVersion, SESSION_FORMAT_VERSION);
    assert.equal(recorder.getSession()?.events.length, 0);
  });

  test('rejects invalid and regressive timestamps without advancing sequence', () => {
    monotonicMs = 20;
    const recorder = createRecorder();
    recorder.start();

    monotonicMs = Number.NaN;
    assert.deepEqual(
      recorder.record({ type: 'transport.stop', deckId: 'A', trackPositionSeconds: 0 }),
      { recorded: false, reason: 'invalid-timestamp' },
    );
    monotonicMs = 30;
    recorder.record({ type: 'transport.stop', deckId: 'A', trackPositionSeconds: 0 });
    monotonicMs = 29;
    assert.deepEqual(
      recorder.record({ type: 'transport.stop', deckId: 'B', trackPositionSeconds: 0 }),
      { recorded: false, reason: 'regressive-timestamp' },
    );
    monotonicMs = 31;
    const next = recorder.record({ type: 'transport.stop', deckId: 'B', trackPositionSeconds: 0 });

    assert.equal(next.recorded, true);
    if (next.recorded) assert.equal(next.event.sequence, 1);
  });

  test('rejects a second start while capture is active and finalizing is idempotent', () => {
    monotonicMs = 1;
    const recorder = createRecorder();
    recorder.start();
    assert.throws(() => recorder.start(), /already active/);
    const first = recorder.finalize();
    const second = recorder.finalize();
    assert.deepEqual(second, first);
  });
});
