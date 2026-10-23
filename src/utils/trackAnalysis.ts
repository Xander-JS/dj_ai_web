import type { ManualAnalysisField, MusicalKeyCamelot, TrackAnalysis, TrackBeatUnit } from '../types/track.ts';
import { camelotToKey } from '../audio/analysis/camelotMapper.ts';

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

export const MANUAL_BPM_MIN = 40;
export const MANUAL_BPM_MAX = 250;
export const MANUAL_ENERGY_MIN = 0;
export const MANUAL_ENERGY_MAX = 10;

export const CAMELOT_KEYS: readonly MusicalKeyCamelot[] = Array.from({ length: 12 }, (_, i) => i + 1)
  .flatMap((n) => [`${n}A`, `${n}B`] as MusicalKeyCamelot[]);

/**
 * Edición manual de metadatos: un valor fija el campo como manual, `null` lo borra
 * (y retira la marca manual) y `undefined` lo deja intacto.
 */
export interface ManualAnalysisEdits {
  bpm?: number | null;
  camelot?: MusicalKeyCamelot | null;
  energy?: number | null;
}

export type ManualEditValidationError = 'bpm' | 'camelot' | 'energy';

/** Devuelve el primer campo inválido o null si todas las ediciones son aceptables. */
export function validateManualAnalysisEdits(edits: ManualAnalysisEdits): ManualEditValidationError | null {
  if (typeof edits.bpm === 'number' && (!Number.isFinite(edits.bpm) || edits.bpm < MANUAL_BPM_MIN || edits.bpm > MANUAL_BPM_MAX)) {
    return 'bpm';
  }
  if (typeof edits.camelot === 'string' && !CAMELOT_KEYS.includes(edits.camelot)) {
    return 'camelot';
  }
  if (
    typeof edits.energy === 'number' &&
    (!Number.isInteger(edits.energy) || edits.energy < MANUAL_ENERGY_MIN || edits.energy > MANUAL_ENERGY_MAX)
  ) {
    return 'energy';
  }
  return null;
}

/**
 * Aplica ediciones manuales sobre un análisis. Los valores introducidos por el usuario se
 * tratan como confirmados (confianza 1). Si tras la edición hay BPM o tonalidad, la pista
 * queda en estado 'analyzed' para que la Biblioteca y los Decks la consideren utilizable.
 */
export function applyManualAnalysisEdits(analysis: TrackAnalysis, edits: ManualAnalysisEdits): TrackAnalysis {
  const invalid = validateManualAnalysisEdits(edits);
  if (invalid) {
    throw new RangeError(`Valor manual inválido para ${invalid}`);
  }

  const next: TrackAnalysis = { ...normalizeTrackAnalysis(analysis) };
  const manual = new Set<ManualAnalysisField>(next.manualFields ?? []);

  if (edits.bpm !== undefined) {
    if (edits.bpm === null) {
      delete next.bpm;
      delete next.bpmConfidence;
      delete next.alternateBpm;
      manual.delete('bpm');
    } else {
      next.bpm = Number(edits.bpm.toFixed(1));
      next.bpmConfidence = 1;
      next.isAmbiguous = false;
      delete next.alternateBpm;
      manual.add('bpm');
    }
  }

  if (edits.camelot !== undefined) {
    if (edits.camelot === null) {
      delete next.key;
      delete next.camelot;
      delete next.keyConfidence;
      manual.delete('camelot');
    } else {
      next.camelot = edits.camelot;
      next.key = camelotToKey(edits.camelot);
      next.keyConfidence = 1;
      manual.add('camelot');
    }
  }

  if (edits.energy !== undefined) {
    if (edits.energy === null) {
      delete next.energy;
      manual.delete('energy');
    } else {
      next.energy = edits.energy;
      manual.add('energy');
    }
  }

  if (manual.size > 0) {
    next.manualFields = Array.from(manual);
  } else {
    delete next.manualFields;
  }

  if (typeof next.bpm === 'number' || typeof next.camelot === 'string') {
    next.status = 'analyzed';
    delete next.analysisError;
  }

  return next;
}

/**
 * Reaplica sobre un análisis nuevo los campos que el usuario fijó manualmente,
 * para que un reanálisis del mismo contenido no sobrescriba sus correcciones.
 */
export function preserveManualAnalysisFields(result: TrackAnalysis, previous: TrackAnalysis): TrackAnalysis {
  const fields = previous.manualFields ?? [];
  if (fields.length === 0 || (result.status !== 'analyzed' && result.status !== 'unsupported')) {
    return result;
  }

  return applyManualAnalysisEdits(result, {
    bpm: fields.includes('bpm') ? previous.bpm ?? null : undefined,
    camelot: fields.includes('camelot') ? previous.camelot ?? null : undefined,
    energy: fields.includes('energy') ? previous.energy ?? null : undefined,
  });
}
