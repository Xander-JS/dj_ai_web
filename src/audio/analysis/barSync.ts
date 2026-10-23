/**
 * SYSTEM DJ — Algoritmo Puro de Cálculo de Fase de Compás para BAR SYNC V1
 * Fase 23.4 — Etapa C.3
 *
 * PRINCIPIOS CONTRACTUALES OBLIGATORIOS:
 * 1. PUREZA ESTRICTA: Función puramente matemática y determinista. No accede a stores globales,
 *    APIs de AudioContext, IndexedDB, DOM ni emite comandos al motor de audio.
 * 2. PREPARACIÓN ESTÁTICA: BAR SYNC V1 opera exclusivamente sobre decks detenidos o pausados
 *    (Slave). No ejecuta micro-slew de compás en caliente durante la reproducción.
 * 3. FASE DE COMPÁS: prepara el Slave en la misma fase normalizada de compás que tiene el Master
 *    en la instantánea de cálculo. Una fase 0 equivale a un downbeat confirmado.
 * 4. NO INICIA REPRODUCCIÓN: nunca arranca la reproducción automáticamente ni cuantiza un lanzamiento.
 * 5. IDENTIDAD CRIPTOGRÁFICA: Exige confirmación manual explícita (source: 'manual') vinculada
 *    al contentHash verificado tanto en el Master como en el Slave.
 * 6. COMPATIBILIDAD MÉTRICA: Exige beatsPerBar y beatUnit coincidentes, ambos confirmados;
 *    rechaza diferencias con 'rejected_metric_mismatch' y nunca infiere la unidad de nota.
 * 7. LÍMITES FÍSICOS: La posición objetivo calculada debe pertenecer rigurosamente al rango [0, duration].
 */

import type { PlaybackState, BarSyncStatus } from '../../types/deck.ts';
import type { TrackAnalysis, TrackBeatUnit, TrackDownbeat } from '../../types/track.ts';
import { isDownbeatConfirmed } from '../../utils/downbeat.ts';
import { isTrackBeatUnit } from '../../utils/trackAnalysis.ts';
import { assessTempoCompatibility } from './tempoCompatibility.ts';

/** Tolerancia temporal por defecto para considerar que el Slave ya está alineado en el compás (5 ms). */
export const DEFAULT_BAR_SYNC_TOLERANCE_SEC = 0.005;

/**
 * Máxima diferencia relativa de BPM efectivo entre Master y Slave para lanzar BAR SYNC.
 * Con tempos distintos la fase alineada deriva en cada compás (a 125 BPM, un 0,5 % son
 * ~10 ms por compás: doble golpe audible en pocos compases). 2e-4 admite el redondeo de
 * SYNC (rate a 4 decimales) y deriva < 0,4 ms por compás.
 */
export const BAR_SYNC_TEMPO_TOLERANCE = 2e-4;

/** Límite inferior de BPM efectivo admisible para el cálculo de compás. */
export const MIN_EFFECTIVE_BPM = 20.0;

/** Límite superior de BPM efectivo admisible para el cálculo de compás. */
export const MAX_EFFECTIVE_BPM = 300.0;

export interface BarPhaseProjectionInput {
  /** Posición del Master (s de buffer) en el instante para el que se proyecta. */
  readonly masterPosition: number;
  readonly masterDownbeat: number;
  readonly masterBarPeriodSec: number;
  readonly slaveDownbeat: number;
  readonly slaveBarPeriodSec: number;
  /** Posición del Slave cerca de la cual se elige el compás equivalente. */
  readonly slaveReferencePosition: number;
  readonly slaveDuration: number;
}

export interface BarPhaseProjection {
  /** Fase normalizada del Master en su compás, en [0, 1). */
  readonly masterBarPhase: number;
  /** Desfase del Master dentro del compás actual, en [0, T_bar,M). */
  readonly masterBarOffsetSec: number;
  readonly barIndex: number;
  /** Posición exacta (sin redondeo) del Slave con la misma fase de compás. */
  readonly position: number;
}

/**
 * Proyección de fase de compás pura y sin redondeos: t_S = D_S + (k + φ_M) · T_bar,S,
 * con φ_M = ((t_M − D_M) mod T_bar,M) / T_bar,M y k el compás más próximo a la referencia.
 * Devuelve null si ningún compás cabe en [0, duración] del Slave.
 */
export function projectBarPhasePosition(input: BarPhaseProjectionInput): BarPhaseProjection | null {
  const {
    masterPosition, masterDownbeat, masterBarPeriodSec,
    slaveDownbeat, slaveBarPeriodSec, slaveReferencePosition, slaveDuration,
  } = input;
  const deltaMasterSec = masterPosition - masterDownbeat;
  const masterBarOffsetSec = ((deltaMasterSec % masterBarPeriodSec) + masterBarPeriodSec) % masterBarPeriodSec;
  const masterBarPhase = masterBarOffsetSec / masterBarPeriodSec;

  const minBarIndex = Math.ceil(-slaveDownbeat / slaveBarPeriodSec - masterBarPhase);
  const maxBarIndex = Math.floor((slaveDuration - slaveDownbeat) / slaveBarPeriodSec - masterBarPhase);
  if (minBarIndex > maxBarIndex) return null;

  const rawIndex = Math.round((slaveReferencePosition - slaveDownbeat) / slaveBarPeriodSec - masterBarPhase);
  const barIndex = Math.max(minBarIndex, Math.min(maxBarIndex, rawIndex));
  return {
    masterBarPhase,
    masterBarOffsetSec,
    barIndex,
    position: slaveDownbeat + (barIndex + masterBarPhase) * slaveBarPeriodSec,
  };
}

/**
 * Parámetros de entrada para el cálculo de compás de un deck individual.
 */
export interface BarSyncDeckInput {
  /** Estado de reproducción actual del deck. */
  readonly playbackState: PlaybackState;
  /** Posición temporal actual del cabezal en segundos de buffer. */
  readonly currentTime: number;
  /** Duración total de la pista cargada en segundos. */
  readonly duration: number;
  /** BPM analizado original de la pista. */
  readonly bpm: number;
  /** Full analysis evidence for BPM quality and metric unit validation. */
  readonly analysis: TrackAnalysis;
  /** Multiplicador de velocidad efectivo aplicado (ej. 1.0 = nominal, 1.05 = +5%). */
  readonly playbackRate: number;
  /** BPM efectivo explícito opcional (si no se especifica, se calcula como bpm * playbackRate). */
  readonly effectiveBpm?: number;
  /** Estructura de downbeat de la pista. */
  readonly downbeat?: TrackDownbeat | null;
  /** Huella SHA-256 exacta y verificada del contenido binario de audio de la pista. */
  readonly contentHash?: string;
}

/**
 * Parámetros de entrada para la función pura de planificación de BAR SYNC.
 */
export interface BarSyncPlanInput {
  /** Datos del deck Master que actúa como referencia métrica activa. */
  readonly master: BarSyncDeckInput;
  /** Datos del deck Slave que se prepara estáticamente para el compás. */
  readonly slave: BarSyncDeckInput;
  /** Tolerancia en segundos para evaluar si ya está posicionado en el compás objetivo. */
  readonly toleranceSec?: number;
}

/**
 * Resultado formal del cálculo de BAR SYNC V1.
 */
export interface BarSyncPlanResult {
  /** Estado resultante de la evaluación de BAR SYNC. */
  readonly status: BarSyncStatus;
  /**
   * Posición temporal calculada en segundos de buffer a la que debe desplazarse el Slave.
   * Corresponde a la misma fase normalizada de compás del Master, dentro de [0, duration].
   * Es null si el cálculo fue rechazado.
   */
  readonly targetPosition: number | null;
  /**
   * Instante temporal en segundos del downbeat de referencia del Slave.
   * Es null si el cálculo fue rechazado.
   */
  readonly targetDownbeatSec: number | null;
  /** Métrica musical confirmada común entre Master y Slave (ej. 4, 3). */
  readonly beatsPerBar: number | null;
  /**
   * Fase relativa del Master dentro de su compás actual en el intervalo [0.0, 1.0).
   * 0.0 indica que el Master está exactamente sobre el tiempo 1 (Downbeat).
   */
  readonly masterBarPhase: number | null;
  /** Periodo temporal exacto de un compás completo del Master en segundos. */
  readonly masterBarPeriodSec: number | null;
  /** Tiempo estimado en segundos que resta para que el Master alcance su próximo tiempo 1. */
  readonly timeToNextMasterDownbeatSec: number | null;
  /** Periodo temporal exacto de un compás completo del Slave en segundos. */
  readonly slaveBarPeriodSec: number | null;
  /** Índice del compás (k) proyectado en el Slave respecto a su downbeat base. */
  readonly targetBarIndex: number | null;
  /** Razón técnica del rechazo, o null si el cálculo fue exitoso ('armed' o 'already_aligned'). */
  readonly reason: string | null;
}

/**
 * Calcula de manera pura y determinista la posición objetivo del Slave que iguala la fase
 * normalizada del compás confirmado del Master en la instantánea de cálculo. Esto prepara
 * equivalencia de fase; no garantiza alineación audible posterior ni sincronía de frase.
 *
 * @param input Datos estructurados de Master, Slave y tolerancias.
 * @returns BarSyncPlanResult con el estado ('armed', 'already_aligned' o código de rechazo) y métricas.
 */
export function calculateBarSyncPlan(input: BarSyncPlanInput): BarSyncPlanResult {
  const { master, slave, toleranceSec = DEFAULT_BAR_SYNC_TOLERANCE_SEC } = input;

  const reject = (status: BarSyncStatus, reason: string): BarSyncPlanResult => ({
    status,
    targetPosition: null,
    targetDownbeatSec: null,
    beatsPerBar: null,
    masterBarPhase: null,
    masterBarPeriodSec: null,
    timeToNextMasterDownbeatSec: null,
    slaveBarPeriodSec: null,
    targetBarIndex: null,
    reason,
  });

  // -------------------------------------------------------------------------
  // 1. Precondiciones de Transporte y Estado de Reproducción ('rejected_state')
  // -------------------------------------------------------------------------
  if (!master || !slave) {
    return reject('rejected_state', 'Parámetros incompletos de Master o Slave');
  }

  if (master.playbackState !== 'playing') {
    return reject(
      'rejected_state',
      `El deck Master debe estar en reproducción activa (estado actual: ${master.playbackState})`
    );
  }

  if (!master.analysis || !slave.analysis) {
    return reject('rejected_confidence', 'Falta el análisis musical requerido en uno o ambos decks');
  }

  if (slave.playbackState === 'playing') {
    return reject(
      'rejected_state',
      'El deck Slave está reproduciéndose. BAR SYNC V1 solo prepara decks detenidos o pausados (micro-slew de compás no permitido en V1)'
    );
  }

  // -------------------------------------------------------------------------
  // 2. Precondiciones de Límites Físicos Generales ('rejected_limits')
  // -------------------------------------------------------------------------
  const isValidNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

  if (
    !isValidNumber(master.bpm) || master.bpm <= 0 ||
    !isValidNumber(slave.bpm) || slave.bpm <= 0 ||
    !isValidNumber(master.playbackRate) || master.playbackRate < 0.92 || master.playbackRate > 1.08 ||
    !isValidNumber(slave.playbackRate) || slave.playbackRate < 0.92 || slave.playbackRate > 1.08 ||
    !isValidNumber(master.duration) || master.duration <= 0 ||
    !isValidNumber(slave.duration) || slave.duration <= 0 ||
    !isValidNumber(master.currentTime) || master.currentTime < 0 || master.currentTime > master.duration ||
    !isValidNumber(slave.currentTime) || slave.currentTime < 0 || slave.currentTime > slave.duration ||
    !isValidNumber(toleranceSec) || toleranceSec < 0
  ) {
    return reject('rejected_limits', 'Posiciones temporales o duraciones fuera de límites válidos o no finitas');
  }

  // Cálculo y validación de BPM efectivo del Master
  const masterEffectiveBpm = master.effectiveBpm === undefined
    ? master.bpm * master.playbackRate
    : master.effectiveBpm;

  if (
    !isValidNumber(masterEffectiveBpm) ||
    masterEffectiveBpm < MIN_EFFECTIVE_BPM ||
    masterEffectiveBpm > MAX_EFFECTIVE_BPM ||
    (master.effectiveBpm !== undefined && Math.abs(masterEffectiveBpm - master.bpm * master.playbackRate) > 0.00005)
  ) {
    return reject(
      'rejected_limits',
      `BPM efectivo del Master inválido o fuera de rango [${MIN_EFFECTIVE_BPM}, ${MAX_EFFECTIVE_BPM}]: ${masterEffectiveBpm}`
    );
  }

  // Cálculo y validación de BPM efectivo del Slave
  const slaveEffectiveBpm = slave.effectiveBpm === undefined
    ? slave.bpm * slave.playbackRate
    : slave.effectiveBpm;

  if (
    !isValidNumber(slaveEffectiveBpm) ||
    slaveEffectiveBpm < MIN_EFFECTIVE_BPM ||
    slaveEffectiveBpm > MAX_EFFECTIVE_BPM ||
    (slave.effectiveBpm !== undefined && Math.abs(slaveEffectiveBpm - slave.bpm * slave.playbackRate) > 0.00005)
  ) {
    return reject(
      'rejected_limits',
      `BPM efectivo del Slave inválido o fuera de rango [${MIN_EFFECTIVE_BPM}, ${MAX_EFFECTIVE_BPM}]: ${slaveEffectiveBpm}`
    );
  }

  // -------------------------------------------------------------------------
  // 3. Precondiciones de Confirmación Manual e Identidad Criptográfica ('rejected_unconfirmed')
  // -------------------------------------------------------------------------
  const isValidContentHash = (h?: string): h is string =>
    typeof h === 'string' && h.length === 64 && /^[0-9a-f]{64}$/i.test(h);

  if (!isValidContentHash(master.contentHash) || !isDownbeatConfirmed(master.downbeat, master.contentHash)) {
    return reject(
      'rejected_unconfirmed',
      'El deck Master no dispone de un downbeat confirmado manualmente asociado a su contentHash verificado'
    );
  }

  if (!isValidContentHash(slave.contentHash) || !isDownbeatConfirmed(slave.downbeat, slave.contentHash)) {
    return reject(
      'rejected_unconfirmed',
      'El deck Slave no dispone de un downbeat confirmado manualmente asociado a su contentHash verificado'
    );
  }

  const masterConfirmation = master.downbeat!.confirmation!;
  const slaveConfirmation = slave.downbeat!.confirmation!;

  const masterBeatUnit = master.analysis.beatUnit;
  const slaveBeatUnit = slave.analysis.beatUnit;
  const isManuallyConfirmedBeatUnit = (value: TrackBeatUnit | undefined): value is Extract<TrackBeatUnit, { status: 'confirmed' }> =>
    isTrackBeatUnit(value) && value.status === 'confirmed' && value.source === 'manual';
  if (!isManuallyConfirmedBeatUnit(masterBeatUnit) || !isManuallyConfirmedBeatUnit(slaveBeatUnit)) {
    return reject(
      'rejected_unconfirmed',
      'Ambas pistas requieren beatUnit válido confirmado manualmente; los valores provisionales o ausentes no demuestran compatibilidad métrica'
    );
  }

  if (master.analysis?.bpm !== master.bpm || slave.analysis?.bpm !== slave.bpm) {
    return reject('rejected_confidence', 'El BPM del plan no coincide con el BPM de análisis de la pista');
  }

  // Reuse established analysis quality signals and 0.5x/2x conflict detection.
  // BAR SYNC cannot select a tempo hypothesis on behalf of the user.
  const tempoCompatibility = assessTempoCompatibility(master.analysis, slave.analysis);
  if (tempoCompatibility.status !== 'no_harmonic_conflict') {
    return reject(
      'rejected_confidence',
      tempoCompatibility.reason ?? 'Análisis de BPM insuficiente o ambiguo para BAR SYNC'
    );
  }

  // -------------------------------------------------------------------------
  // 4. Precondición de Compatibilidad de Métrica Musical ('rejected_metric_mismatch')
  // -------------------------------------------------------------------------
  if (
    masterConfirmation.beatsPerBar !== slaveConfirmation.beatsPerBar ||
    masterBeatUnit.value !== slaveBeatUnit.value
  ) {
    return reject(
      'rejected_metric_mismatch',
      `Discrepancia métrica musical: Master es ${masterConfirmation.beatsPerBar}/${masterBeatUnit.value} pero Slave es ${slaveConfirmation.beatsPerBar}/${slaveBeatUnit.value}`
    );
  }

  const beatsPerBar = masterConfirmation.beatsPerBar;

  // -------------------------------------------------------------------------
  // 5. Modelo Matemático de Compás Master
  // -------------------------------------------------------------------------
  // Periodo de un pulso del Master en segundos: T_beat,M = 60 / BPM_eff,M
  const masterBeatPeriodSec = 60.0 / masterEffectiveBpm;
  // Periodo de un compás completo del Master en segundos: T_bar,M = beatsPerBar * T_beat,M
  const masterBarPeriodSec = beatsPerBar * masterBeatPeriodSec;

  if (!isValidNumber(masterBarPeriodSec) || masterBarPeriodSec <= 0) {
    return reject('rejected_limits', 'Periodo de compás del Master inválido');
  }

  if (masterConfirmation.position > master.duration || slaveConfirmation.position > slave.duration) {
    return reject('rejected_limits', 'El downbeat confirmado queda fuera de la duración de su pista');
  }

  // -------------------------------------------------------------------------
  // 6. Modelo Matemático y Proyección de Frontera de Compás en el Slave
  // -------------------------------------------------------------------------
  // Periodo de compás completo del Slave en segundos: T_bar,S = beatsPerBar * (60 / BPM_eff,S)
  const slaveBeatPeriodSec = 60.0 / slaveEffectiveBpm;
  const slaveBarPeriodSec = beatsPerBar * slaveBeatPeriodSec;

  if (!isValidNumber(slaveBarPeriodSec) || slaveBarPeriodSec <= 0) {
    return reject('rejected_limits', 'Periodo de compás del Slave inválido');
  }

  const slaveAnchorDownbeat = slaveConfirmation.position;

  // La posición equivalente en Slave preserva la fase normalizada del Master:
  // t_S = D_S + (k + φ_M) * T_bar,S. Elegimos el k más próximo al cabezal actual.
  const projection = projectBarPhasePosition({
    masterPosition: master.currentTime,
    masterDownbeat: masterConfirmation.position,
    masterBarPeriodSec,
    slaveDownbeat: slaveAnchorDownbeat,
    slaveBarPeriodSec,
    slaveReferencePosition: slave.currentTime,
    slaveDuration: slave.duration,
  });

  if (!projection) {
    return reject(
      'rejected_limits',
      `No existe ninguna frontera de compás válida dentro de la duración del Slave (${slave.duration}s)`
    );
  }

  const { masterBarPhase, masterBarOffsetSec, barIndex: targetBarIndex, position: exactTargetPosition } = projection;

  // Tiempo en segundos hasta el siguiente tiempo 1 (Downbeat) del Master:
  // Si está exactamente en el tiempo 1 (τ_M === 0), la distancia al siguiente es 0 (o T_bar)
  const timeToNextMasterDownbeatSec = masterBarOffsetSec === 0
    ? 0
    : Number((masterBarPeriodSec - masterBarOffsetSec).toFixed(3));
  const targetPosition = Number(exactTargetPosition.toFixed(3));

  if (!isValidNumber(targetPosition) || targetPosition < 0 || targetPosition > slave.duration) {
    return reject('rejected_limits', `Posición objetivo calculada (${targetPosition}s) fuera de límites [0, ${slave.duration}]`);
  }

  // -------------------------------------------------------------------------
  // 7. Determinación de Estado ('already_aligned' vs 'armed')
  // -------------------------------------------------------------------------
  const isAlreadyAligned = Math.abs(slave.currentTime - targetPosition) <= toleranceSec;

  return {
    status: isAlreadyAligned ? 'already_aligned' : 'armed',
    targetPosition,
    targetDownbeatSec: Number(slaveAnchorDownbeat.toFixed(3)),
    beatsPerBar,
    masterBarPhase: Number(masterBarPhase.toFixed(4)),
    masterBarPeriodSec: Number(masterBarPeriodSec.toFixed(3)),
    timeToNextMasterDownbeatSec,
    slaveBarPeriodSec: Number(slaveBarPeriodSec.toFixed(3)),
    targetBarIndex,
    reason: null,
  };
}
