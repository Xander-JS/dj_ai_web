import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderSessionOffline, SessionRenderError } from '../src/session/OfflineSessionRenderer.ts';
import type { RecordedSession, SessionEvent, SessionInitialState, SessionTrackReference } from '../src/session/SessionRecorder.ts';

const trackA: SessionTrackReference = { trackId: 'track-a', title: 'A', artist: 'Test', durationSeconds: 20 };
const trackB: SessionTrackReference = { trackId: 'track-b', title: 'B', artist: 'Test', durationSeconds: 20 };
const initialState: SessionInitialState = {
  decks: {
    A: { track: trackA, playbackState: 'stopped', trackPositionSeconds: 0, effectivePlaybackRate: 1 },
    B: { track: trackB, playbackState: 'stopped', trackPositionSeconds: 0, effectivePlaybackRate: 1 },
  },
  mixer: {
    channels: {
      A: { gainLinear: 1, volumeLinear: 1, eqDb: { high: 0, mid: 0, low: 0 }, filter: 0 },
      B: { gainLinear: 1, volumeLinear: 1, eqDb: { high: 0, mid: 0, low: 0 }, filter: 0 },
    },
    crossfaderPosition: 0,
    crossfaderCurve: 'linear',
    masterGainLinear: 1,
  },
};

function event(sequence: number, sessionTimeMs: number, payload: Record<string, unknown>): SessionEvent {
  return { ...payload, sequence, sessionTimeMs } as SessionEvent;
}

function session(events: SessionEvent[], durationMs = 1000, formatVersion: 1 | 2 = 2): RecordedSession {
  return { sessionId: 'test-session', formatVersion, createdAtEpochMs: 0, metadata: {}, events, durationMs };
}

function syntheticBuffer(duration = 20): AudioBuffer {
  return { duration, length: duration * 48_000, numberOfChannels: 1, sampleRate: 48_000 } as AudioBuffer;
}

type ParamCall = { method: string; value: number; time: number };
function parameter(initialValue = 1): AudioParam & { calls: ParamCall[] } {
  const calls: ParamCall[] = [];
  return {
    value: initialValue,
    calls,
    setValueAtTime(value: number, time: number) { calls.push({ method: 'set', value, time }); return this; },
    linearRampToValueAtTime(value: number, time: number) { calls.push({ method: 'ramp', value, time }); return this; },
    cancelScheduledValues(time: number) { calls.push({ method: 'cancel', value: 0, time }); return this; },
    setTargetAtTime(value: number, time: number) { calls.push({ method: 'target', value, time }); return this; },
    setValueCurveAtTime(value: Float32Array, time: number) { calls.push({ method: 'curve', value: value[0], time }); return this; },
    cancelAndHoldAtTime(time: number) { calls.push({ method: 'hold', value: 0, time }); return this; },
  } as unknown as AudioParam & { calls: ParamCall[] };
}

function node<T extends object>(extra: T = {} as T): T & { connect: () => void; disconnect: () => void } {
  return Object.assign({ connect() {}, disconnect() {} }, extra);
}

function offlineFactory() {
  const sources: Array<{ buffer: AudioBuffer | null; starts: number[][]; stops: number[]; playbackRate: AudioParam & { calls: ParamCall[] } }> = [];
  const gains: Array<{ gain: AudioParam & { calls: ParamCall[] } }> = [];
  const context = {
    destination: node(),
    createGain() {
      const gain = { gain: parameter() };
      gains.push(gain);
      return node(gain) as unknown as GainNode;
    },
    createBiquadFilter() {
      return node({ type: 'allpass', frequency: parameter(350), Q: parameter(1), gain: parameter(0) }) as unknown as BiquadFilterNode;
    },
    createDynamicsCompressor() {
      return node({ threshold: parameter(-24), knee: parameter(30), ratio: parameter(12), attack: parameter(0.003), release: parameter(0.25) }) as unknown as DynamicsCompressorNode;
    },
    createBufferSource() {
      const source = {
        buffer: null as AudioBuffer | null,
        starts: [] as number[][],
        stops: [] as number[],
        playbackRate: parameter(1),
        start(...args: number[]) { this.starts.push(args); },
        stop(time?: number) { this.stops.push(time ?? -1); },
      };
      sources.push(source);
      return node(source) as unknown as AudioBufferSourceNode;
    },
    async startRendering() {
      return { sampleRate: 48_000, duration: 1, length: 48_000, numberOfChannels: 2 } as AudioBuffer;
    },
  };
  return { sources, gains, createOfflineContext: () => context as unknown as OfflineAudioContext };
}

const resolver = (track: SessionTrackReference) => track.trackId === trackA.trackId || track.trackId === trackB.trackId
  ? syntheticBuffer()
  : null;

describe('OfflineSessionRenderer — deterministic planning and graph scheduling', () => {
  test('schedules a synthetic track at its media offset and ends at session duration', async () => {
    const fake = offlineFactory();
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, playbackState: 'playing', trackPositionSeconds: 2 } } } }),
    ]);
    const result = await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    assert.equal(result.durationMs, 1000);
    assert.equal(result.buffer.duration, 1);
    assert.equal(fake.sources.length, 1);
    assert.deepEqual(fake.sources[0].starts, [[0, 2]]);
    assert.deepEqual(fake.sources[0].stops, [1]);
  });

  test('renders two deck segments that overlap in session time', async () => {
    const fake = offlineFactory();
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, playbackState: 'playing' } } } }),
      event(1, 400, { type: 'transport.play', deckId: 'B', trackPositionSeconds: 3, effectivePlaybackRate: 1 }),
    ]);
    await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    assert.equal(fake.sources.length, 2);
    assert.deepEqual(fake.sources.map((source) => source.starts[0]), [[0, 0], [0.4, 3]]);
    assert.deepEqual(fake.sources.map((source) => source.stops[0]), [1, 1]);
  });

  test('applies transport pause, seek and play events in timestamp and sequence order', async () => {
    const fake = offlineFactory();
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, playbackState: 'playing' } } } }),
      event(1, 200, { type: 'transport.pause', deckId: 'A', trackPositionSeconds: 0.2 }),
      event(2, 200, { type: 'transport.seek', deckId: 'A', trackPositionSeconds: 4, playbackState: 'playing' }),
      event(3, 500, { type: 'transport.pause', deckId: 'A', trackPositionSeconds: 4.3 }),
    ]);
    await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    assert.deepEqual(fake.sources.map((source) => source.starts[0]), [[0, 0], [0.2, 4]]);
    assert.deepEqual(fake.sources.map((source) => source.stops[0]), [0.2, 0.5]);
  });

  test('schedules deck volume and crossfader changes at recorded times', async () => {
    const fake = offlineFactory();
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: initialState }),
      event(1, 250, { type: 'mixer.channel-volume', deckId: 'A', volumeLinear: 0.35 }),
      event(2, 500, { type: 'mixer.crossfader', position: 1, curve: 'linear' }),
      event(3, 600, { type: 'mixer.filter', deckId: 'A', value: -50 }),
    ]);
    await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    assert.ok(fake.gains.some(({ gain }) => gain.calls.some((call) => call.value === 0.35 && call.time === 0.25)));
    assert.ok(fake.gains.some(({ gain }) => gain.calls.some((call) => call.value === 0 && call.time === 0.5)));
    assert.ok(fake.gains.some(({ gain }) => gain.calls.some((call) => call.value === 1 && call.time === 0.5)));
    assert.ok(fake.gains.some(({ gain }) => gain.calls.some((call) => call.value === 0 && call.time === 0.6)));
    assert.ok(fake.gains.some(({ gain }) => gain.calls.some((call) => call.value === 1 && call.time === 0.6)));
  });

  test('schedules playback rate changes, including the recorded ramp duration', async () => {
    const fake = offlineFactory();
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, playbackState: 'playing' } } } }),
      event(1, 300, { type: 'deck.playback-rate', deckId: 'A', effectiveRate: 1.05, rampDurationMs: 40, cause: 'pitch-bend' }),
    ]);
    await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    const ramp = fake.sources[0].playbackRate.calls.find((call) => call.method === 'ramp')!;
    assert.equal(ramp.value, 1.05);
    assert.ok(Math.abs(ramp.time - 0.34) < 1e-12);
  });

  test('preserves equal-time event order using sequence when scheduling parameter values', async () => {
    const fake = offlineFactory();
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: initialState }),
      event(2, 100, { type: 'mixer.master-gain', gainLinear: 0.2 }),
      event(1, 100, { type: 'mixer.master-gain', gainLinear: 0.7 }),
    ]);
    await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    const masterGainCalls = fake.gains[0].gain.calls;
    assert.deepEqual(masterGainCalls.filter((call) => call.time === 0.1).map((call) => call.value), [0.7, 0.2]);
  });

  test('rejects empty sessions, missing buffers, unknown versions and invalid durations', async () => {
    const fake = offlineFactory();
    await assert.rejects(renderSessionOffline(session([], 100), resolver), { code: 'EMPTY_SESSION' });
    await assert.rejects(renderSessionOffline(session([event(0, 0, { type: 'session.initial-state', state: initialState })]), () => null, { createOfflineContext: fake.createOfflineContext }), { code: 'MISSING_BUFFER' });
    const unknown = { ...session([event(0, 0, { type: 'session.initial-state', state: initialState })]), formatVersion: 3 } as unknown as RecordedSession;
    await assert.rejects(renderSessionOffline(unknown, resolver), { code: 'UNKNOWN_VERSION' });
    await assert.rejects(renderSessionOffline(session([event(0, 0, { type: 'session.initial-state', state: initialState })], -1), resolver), { code: 'INVALID_DURATION' });
  });

  test('rejects render duration and stereo output allocations above configured resource limits', async () => {
    const noTracks: SessionInitialState = {
      decks: {
        A: { track: null, playbackState: 'stopped', trackPositionSeconds: 0, effectivePlaybackRate: 1 },
        B: { track: null, playbackState: 'stopped', trackPositionSeconds: 0, effectivePlaybackRate: 1 },
      },
      mixer: initialState.mixer,
    };
    const s = session([event(0, 0, { type: 'session.initial-state', state: noTracks })], 2000);
    await assert.rejects(renderSessionOffline(s, resolver, { maxDurationSeconds: 1 }), { code: 'RESOURCE_LIMIT' });
    await assert.rejects(renderSessionOffline(s, resolver, { maxOutputBytes: 1024 }), { code: 'RESOURCE_LIMIT' });
  });

  test('reports OfflineAudioContext unavailable in Node when no real implementation is installed', async () => {
    if (typeof globalThis.OfflineAudioContext !== 'undefined') return;
    const noTracks: SessionInitialState = {
      decks: {
        A: { track: null, playbackState: 'stopped', trackPositionSeconds: 0, effectivePlaybackRate: 1 },
        B: { track: null, playbackState: 'stopped', trackPositionSeconds: 0, effectivePlaybackRate: 1 },
      },
      mixer: initialState.mixer,
    };
    const s = session([event(0, 0, { type: 'session.initial-state', state: noTracks })]);
    await assert.rejects(renderSessionOffline(s, resolver), { code: 'OFFLINE_AUDIO_UNAVAILABLE' });
  });

  test('keeps legacy version-1 sessions renderable', async () => {
    const fake = offlineFactory();
    const legacy = session([
      event(0, 0, { type: 'session.initial-state', state: { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, playbackState: 'playing' } } } }),
    ], 1000, 1);
    const result = await renderSessionOffline(legacy, resolver, { createOfflineContext: fake.createOfflineContext });
    assert.equal(result.buffer.numberOfChannels, 2);
    assert.equal(fake.sources.length, 1);
  });

  test('rejects timestamp regressions in recording sequence and accepts a shuffled event array', async () => {
    const fake = offlineFactory();
    const initial = event(0, 0, { type: 'session.initial-state', state: initialState });
    const early = event(1, 100, { type: 'mixer.master-gain', gainLinear: 0.5 });
    const late = event(2, 200, { type: 'mixer.master-gain', gainLinear: 0.2 });
    const shuffled = session([initial, late, early]);
    await renderSessionOffline(shuffled, resolver, { createOfflineContext: fake.createOfflineContext });
    assert.deepEqual(fake.gains[0].gain.calls.filter((call) => call.time > 0).map((call) => call.value), [0.5, 0.2]);
    const regressive = session([initial, event(1, 200, { type: 'mixer.master-gain', gainLinear: 0.5 }), event(2, 100, { type: 'mixer.master-gain', gainLinear: 0.2 })]);
    await assert.rejects(renderSessionOffline(regressive, resolver), { code: 'INVALID_TIMELINE' });
  });

  test('accepts live-recorded edge cases that previously failed validation', async () => {
    const fake = offlineFactory();
    const unknownDuration = { ...trackA, durationSeconds: 0 };
    const s = session([
      // Snapshot stamped a fraction of a millisecond late by an older recorder.
      event(0, 0.4, { type: 'session.initial-state', state: { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, track: unknownDuration, playbackState: 'playing', trackPositionSeconds: 19 } } } }),
      // Seek clamped to the exact end of the buffer, then the track ends.
      event(1, 300, { type: 'transport.seek', deckId: 'A', trackPositionSeconds: 20, playbackState: 'playing' }),
      event(2, 310, { type: 'transport.ended', deckId: 'A', trackPositionSeconds: 0 }),
      event(3, 400, { type: 'transport.play', deckId: 'A', trackPositionSeconds: 5, effectivePlaybackRate: 1 }),
    ]);
    const result = await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    assert.equal(result.buffer.duration, 1);
    assert.deepEqual(fake.sources.map((source) => source.starts[0]), [[0, 19], [0.4, 5]]);
    assert.deepEqual(fake.sources.map((source) => source.stops[0]), [0.3, 1]);
  });

  test('replays a micro-slew profile as playbackRate ramps on the active segment', async () => {
    const fake = offlineFactory();
    const playingA = { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, playbackState: 'playing' as const } } };
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: playingA }),
      event(1, 100, { type: 'deck.micro-slew', deckId: 'A', baseRate: 1, peakRate: 1.04, rampDurationSeconds: 0.2, plateauDurationSeconds: 0.1, targetDisplacementSeconds: 0.01 }),
    ]);
    await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    assert.equal(fake.sources.length, 1);
    const calls = fake.sources[0].playbackRate.calls.map(({ method, value, time }) => [method, value, Number(time.toFixed(6))]);
    assert.deepEqual(calls, [
      ['set', 1, 0],
      ['set', 1, 0.1], ['ramp', 1.04, 0.3],
      ['set', 1.04, 0.3], ['ramp', 1.04, 0.4],
      ['set', 1.04, 0.4], ['ramp', 1, 0.6],
    ]);
  });

  test('cancels the pending slew ramp when a rate change interrupts it', async () => {
    const fake = offlineFactory();
    const playingA = { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, playbackState: 'playing' as const } } };
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: playingA }),
      event(1, 100, { type: 'deck.micro-slew', deckId: 'A', baseRate: 1, peakRate: 1.04, rampDurationSeconds: 0.2, plateauDurationSeconds: 0, targetDisplacementSeconds: 0.004 }),
      event(2, 200, { type: 'deck.playback-rate', deckId: 'A', effectiveRate: 1.02, rampDurationMs: 0, cause: 'pitch' }),
    ]);
    await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    const calls = fake.sources[0].playbackRate.calls;
    assert.deepEqual(calls.at(-2), { method: 'cancel', value: 0, time: 0.2 });
    assert.deepEqual(calls.at(-1), { method: 'set', value: 1.02, time: 0.2 });
  });

  test('tolerates a profile-less micro-slew marker recorded at capture start', async () => {
    const fake = offlineFactory();
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, playbackState: 'playing' } } } }),
      event(1, 0, { type: 'deck.micro-slew', deckId: 'A' }),
    ]);
    await renderSessionOffline(s, resolver, { createOfflineContext: fake.createOfflineContext });
    assert.deepEqual(fake.sources[0].playbackRate.calls, [{ method: 'set', value: 1, time: 0 }]);
  });

  test('rejects micro-slew profiles with out-of-range rates', async () => {
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: initialState }),
      event(1, 10, { type: 'deck.micro-slew', deckId: 'A', baseRate: 1, peakRate: 1.5, rampDurationSeconds: 0.2, plateauDurationSeconds: 0.1 }),
    ]);
    await assert.rejects(renderSessionOffline(s, resolver), (error: unknown) => {
      assert.ok(error instanceof SessionRenderError);
      assert.equal(error.code, 'INVALID_TIMELINE');
      return true;
    });
  });

  test('reports measured render progress through suspend checkpoints', async () => {
    const fake = offlineFactory();
    const context = fake.createOfflineContext() as unknown as Record<string, unknown>;
    const pending: Array<{ time: number; resolve: () => void }> = [];
    context.suspend = (time: number) => new Promise<void>((resolve) => pending.push({ time, resolve }));
    context.resume = () => Promise.resolve();
    const originalStart = context.startRendering as () => Promise<AudioBuffer>;
    context.startRendering = async () => {
      for (const checkpoint of [...pending].sort((a, b) => a.time - b.time)) {
        checkpoint.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return originalStart();
    };
    const fractions: number[] = [];
    await renderSessionOffline(session([event(0, 0, { type: 'session.initial-state', state: initialState })]), resolver, {
      createOfflineContext: () => context as unknown as OfflineAudioContext,
      onProgress: (fraction) => fractions.push(fraction),
    });
    assert.ok(pending.length > 1);
    assert.ok(pending.every(({ time }) => Number.isInteger(Math.round(time * 48_000 / 128 * 1e6) / 1e6)));
    assert.equal(fractions.at(-1), 1);
    for (let index = 1; index < fractions.length; index += 1) assert.ok(fractions[index] > fractions[index - 1]);
  });

  test('does not change the recorded state object or source buffers during rendering', async () => {
    const fake = offlineFactory();
    const source = syntheticBuffer();
    const s = session([
      event(0, 0, { type: 'session.initial-state', state: { ...initialState, decks: { ...initialState.decks, A: { ...initialState.decks.A, playbackState: 'playing' } } } }),
      event(1, 100, { type: 'mixer.channel-gain', deckId: 'A', gainLinear: 1.5 }),
    ]);
    const before = structuredClone(s);
    const sourceDuration = source.duration;
    await renderSessionOffline(s, () => source, { createOfflineContext: fake.createOfflineContext });
    assert.deepEqual(s, before);
    assert.equal(source.duration, sourceDuration);
    assert.equal(source.numberOfChannels, 1);
  });
});
