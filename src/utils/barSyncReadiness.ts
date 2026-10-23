import type { BeatUnit, Track } from '../types/track.ts';
import { isDownbeatConfirmed } from './downbeat.ts';
import { isTrackBeatUnit } from './trackAnalysis.ts';
import { BAR_SYNC_TEMPO_TOLERANCE } from '../audio/analysis/barSync.ts';

export interface DeckMeter {
  downbeatConfirmed: boolean;
  beatsPerBar: number | null;
  /** Only a manually confirmed unit counts; provisional analysis never proves the meter. */
  beatUnit: BeatUnit | null;
}

/** Meter as BAR SYNC sees it: confirmed downbeat bound to the content hash plus a manual beat unit. */
export function getDeckMeter(track: Track | null | undefined): DeckMeter {
  if (!track) return { downbeatConfirmed: false, beatsPerBar: null, beatUnit: null };
  const downbeatConfirmed = isDownbeatConfirmed(track.downbeat, track.fileMeta?.contentHash);
  const unit = track.analysis?.beatUnit;
  return {
    downbeatConfirmed,
    beatsPerBar: downbeatConfirmed ? track.downbeat?.confirmation?.beatsPerBar ?? null : null,
    beatUnit: isTrackBeatUnit(unit) && unit.status === 'confirmed' ? unit.value : null,
  };
}

export function formatMeter(meter: DeckMeter): string | null {
  if (meter.beatsPerBar === null) return null;
  return `${meter.beatsPerBar}/${meter.beatUnit ?? '?'}`;
}

export interface BarSyncDeckInput {
  track: Track | null;
  playbackState: string;
  isMaster: boolean;
  /** Effective (pitched) BPM; omitted when unknown, in which case the store decides. */
  effectiveBpm?: number | null;
}

export type BarSyncBlockReason =
  | 'is_master'
  | 'no_track'
  | 'master_no_track'
  | 'self_unconfirmed'
  | 'master_unconfirmed'
  | 'meter_mismatch'
  | 'tempo_mismatch'
  | 'master_not_playing'
  | 'self_playing';

export type BarSyncReadiness =
  | { ready: true }
  | { ready: false; reason: BarSyncBlockReason; values?: Record<string, string> };

/**
 * UI pre-flight for BAR SYNC on `self` (the slave) against `master`.
 * It mirrors the store's preconditions so the user sees why before pressing;
 * the store remains the authority and may still reject on BPM/limits.
 */
export function getBarSyncReadiness(self: BarSyncDeckInput, master: BarSyncDeckInput): BarSyncReadiness {
  if (self.isMaster) return { ready: false, reason: 'is_master' };
  if (!self.track) return { ready: false, reason: 'no_track' };
  if (!master.track) return { ready: false, reason: 'master_no_track' };

  const selfMeter = getDeckMeter(self.track);
  const masterMeter = getDeckMeter(master.track);
  if (!selfMeter.downbeatConfirmed || selfMeter.beatUnit === null) return { ready: false, reason: 'self_unconfirmed' };
  if (!masterMeter.downbeatConfirmed || masterMeter.beatUnit === null) return { ready: false, reason: 'master_unconfirmed' };
  if (selfMeter.beatsPerBar !== masterMeter.beatsPerBar || selfMeter.beatUnit !== masterMeter.beatUnit) {
    return {
      ready: false,
      reason: 'meter_mismatch',
      values: { self: formatMeter(selfMeter) ?? '?', master_meter: formatMeter(masterMeter) ?? '?' },
    };
  }
  if (typeof self.effectiveBpm === 'number' && typeof master.effectiveBpm === 'number' && master.effectiveBpm > 0
    && Math.abs(self.effectiveBpm / master.effectiveBpm - 1) > BAR_SYNC_TEMPO_TOLERANCE) {
    return {
      ready: false,
      reason: 'tempo_mismatch',
      values: { self_bpm: self.effectiveBpm.toFixed(1), master_bpm: master.effectiveBpm.toFixed(1) },
    };
  }
  if (master.playbackState !== 'playing') return { ready: false, reason: 'master_not_playing' };
  if (self.playbackState === 'playing') return { ready: false, reason: 'self_playing' };
  return { ready: true };
}
