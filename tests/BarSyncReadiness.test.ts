import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createManualDownbeatConfirmation } from '../src/utils/downbeat.ts';
import { formatMeter, getBarSyncReadiness, getDeckMeter } from '../src/utils/barSyncReadiness.ts';
import type { BeatUnit, Track } from '../src/types/track.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function track(hash: string, meter?: { beats: number; unit?: BeatUnit }): Track {
  return {
    id: hash.slice(0, 6),
    title: 't',
    artist: 'a',
    fileMeta: { contentHash: hash },
    analysis: {
      status: 'analyzed',
      bpm: 124,
      ...(meter?.unit ? { beatUnit: { value: meter.unit, status: 'confirmed' as const, source: 'manual' as const } } : {}),
    },
    downbeat: meter
      ? createManualDownbeatConfirmation({ position: 0.5, beatsPerBar: meter.beats, contentHash: hash })
      : { status: 'none' },
  } as unknown as Track;
}

describe('BAR SYNC readiness — feedback previo y compás visible', () => {
  it('expone el compás confirmado y marca la unidad pendiente', () => {
    assert.equal(formatMeter(getDeckMeter(track(HASH_A, { beats: 6, unit: 8 }))), '6/8');
    const pendingUnit = getDeckMeter(track(HASH_A, { beats: 4 }));
    assert.equal(pendingUnit.downbeatConfirmed, true);
    assert.equal(pendingUnit.beatUnit, null);
    assert.equal(formatMeter(pendingUnit), '4/?');
    assert.equal(formatMeter(getDeckMeter(track(HASH_A))), null);
  });

  it('explica cada bloqueo en orden de resolución', () => {
    const ready = { track: track(HASH_A, { beats: 4, unit: 4 }), playbackState: 'paused', isMaster: false };
    const master = { track: track(HASH_B, { beats: 4, unit: 4 }), playbackState: 'playing', isMaster: true };

    assert.deepEqual(getBarSyncReadiness(ready, master), { ready: true });
    assert.equal(getBarSyncReadiness({ ...ready, isMaster: true }, master).ready === false && 'is_master', 'is_master');

    const reason = (self: typeof ready, other: typeof master) => {
      const result = getBarSyncReadiness(self, other);
      return result.ready ? 'ready' : result.reason;
    };
    assert.equal(reason({ ...ready, track: track(HASH_A, { beats: 4 }) }, master), 'self_unconfirmed');
    assert.equal(reason(ready, { ...master, track: track(HASH_B) }), 'master_unconfirmed');
    assert.equal(reason(ready, { ...master, track: track(HASH_B, { beats: 3, unit: 4 }) }), 'meter_mismatch');
    assert.equal(reason(ready, { ...master, playbackState: 'paused' }), 'master_not_playing');
    assert.equal(reason({ ...ready, playbackState: 'playing' }, master), 'self_playing');

    const mismatch = getBarSyncReadiness(ready, { ...master, track: track(HASH_B, { beats: 6, unit: 8 }) });
    assert.deepEqual(mismatch, { ready: false, reason: 'meter_mismatch', values: { self: '4/4', master_meter: '6/8' } });
  });
});

describe('BAR SYNC readiness — tempo', () => {
  it('exige BPM efectivo igualado antes de preparar el compás', () => {
    const self = { track: track(HASH_A, { beats: 4, unit: 4 }), playbackState: 'paused', isMaster: false, effectiveBpm: 124 };
    const master = { track: track(HASH_B, { beats: 4, unit: 4 }), playbackState: 'playing', isMaster: true, effectiveBpm: 120 };
    assert.deepEqual(getBarSyncReadiness(self, master), {
      ready: false,
      reason: 'tempo_mismatch',
      values: { self_bpm: '124.0', master_bpm: '120.0' },
    });
    assert.deepEqual(getBarSyncReadiness({ ...self, effectiveBpm: 120.01 }, master), { ready: true });
  });
});
