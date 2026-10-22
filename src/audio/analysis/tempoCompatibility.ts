import type { TrackAnalysis } from '../../types/track.ts';

/**
 * Result of checking stored analysis for a detected cross-track harmonic conflict.
 * `no_harmonic_conflict` is not proof of BPM accuracy, beat phase, downbeat, phrase, or sound quality.
 */
export type TempoCompatibilityStatus =
  | 'no_harmonic_conflict'
  | 'half_time_hypothesis'
  | 'double_time_hypothesis'
  | 'insufficient_data';

export interface TempoCompatibilityResult {
  readonly status: TempoCompatibilityStatus;
  readonly reason: string | null;
}

/** Reuse the minimum confidence already required by provisional beatgrid sync eligibility. */
export const MIN_SYNC_BPM_CONFIDENCE = 0.5;

/** Tolerance accounts for the detector's one-decimal BPM output and small analysis variation. */
const bpmMatches = (candidate: number, reference: number): boolean =>
  Math.abs(candidate - reference) <= Math.max(0.75, reference * 0.01);

const isDoubleTempoRatio = (higherBpm: number, lowerBpm: number): boolean =>
  Math.abs(higherBpm / lowerBpm - 2) <= 0.06;

function hasTempoEvidence(analysis: TrackAnalysis): boolean {
  return (
    analysis.status === 'analyzed' &&
    typeof analysis.bpm === 'number' && Number.isFinite(analysis.bpm) && analysis.bpm > 0 &&
    typeof analysis.bpmConfidence === 'number' && Number.isFinite(analysis.bpmConfidence) &&
    analysis.bpmConfidence >= MIN_SYNC_BPM_CONFIDENCE &&
    analysis.isAmbiguous === false &&
    Array.isArray(analysis.alternateBpm) && analysis.alternateBpm.length > 0 &&
    analysis.alternateBpm.every((candidate) => Number.isFinite(candidate) && candidate > 0)
  );
}

/**
 * Checks detector evidence for cross-track 2:1 tempo hypotheses before the pitch calculation.
 * The detector's alternate BPM values are hypotheses only; this does not establish true meter.
 */
export function assessTempoCompatibility(
  master: TrackAnalysis | null | undefined,
  slave: TrackAnalysis | null | undefined
): TempoCompatibilityResult {
  if (!master || !slave || !hasTempoEvidence(master) || !hasTempoEvidence(slave)) {
    return {
      status: 'insufficient_data',
      reason: 'SYNC requiere BPM, confianza suficiente, análisis no ambiguo y candidatos alternativos en ambos decks.',
    };
  }

  const masterBpm = master.bpm!;
  const slaveBpm = slave.bpm!;
  const masterSuggestsSlaveTempo = master.alternateBpm!.some((candidate) => bpmMatches(candidate, slaveBpm));
  const slaveSuggestsMasterTempo = slave.alternateBpm!.some((candidate) => bpmMatches(candidate, masterBpm));

  if (masterBpm > slaveBpm && isDoubleTempoRatio(masterBpm, slaveBpm) && slaveSuggestsMasterTempo) {
    return {
      status: 'half_time_hypothesis',
      reason: `El candidato alternativo del Slave coincide con el BPM principal del Master (${masterBpm.toFixed(1)} vs ${slaveBpm.toFixed(1)} BPM). Confirme el nivel de beat antes de usar SYNC.`,
    };
  }

  if (slaveBpm > masterBpm && isDoubleTempoRatio(slaveBpm, masterBpm) && masterSuggestsSlaveTempo) {
    return {
      status: 'double_time_hypothesis',
      reason: `El candidato alternativo del Master coincide con el BPM principal del Slave (${masterBpm.toFixed(1)} vs ${slaveBpm.toFixed(1)} BPM). Confirme el nivel de beat antes de usar SYNC.`,
    };
  }

  return { status: 'no_harmonic_conflict', reason: null };
}
