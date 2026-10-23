import type { TrackAnalysis, TrackBeatUnit } from '../types/track.ts';

const VALID_BEAT_UNIT_VALUES = new Set([1, 2, 4, 8, 16, 32, 64]);

/** Runtime guard for persisted or worker-provided beat-unit metadata. */
export function isTrackBeatUnit(value: unknown): value is TrackBeatUnit {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  if (!VALID_BEAT_UNIT_VALUES.has(candidate.value as number)) return false;

  return (
    (candidate.status === 'confirmed' && candidate.source === 'manual') ||
    (candidate.status === 'provisional' && candidate.source === 'analysis')
  );
}

/**
 * Preserves valid explicit beat-unit evidence and drops malformed/legacy values.
 * It deliberately never derives a beat unit from BPM, beat count, or firstBeatTime.
 */
export function normalizeTrackAnalysis(analysis: TrackAnalysis): TrackAnalysis {
  const candidate = (analysis as TrackAnalysis & { beatUnit?: unknown }).beatUnit;
  if (isTrackBeatUnit(candidate)) {
    return {
      ...analysis,
      beatUnit: {
        value: candidate.value,
        status: candidate.status,
        source: candidate.source,
      } as TrackBeatUnit,
    };
  }

  const legacyCompatibleAnalysis = { ...analysis } as TrackAnalysis & { beatUnit?: unknown };
  delete legacyCompatibleAnalysis.beatUnit;
  return legacyCompatibleAnalysis;
}
