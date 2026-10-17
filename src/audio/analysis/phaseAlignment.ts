/**
 * SYSTEM DJ — Micro-Slew Phase Alignment Engine
 * Fase 23.4 — Etapa 4: Planificación, perfilado y cálculo de alineación de fase
 * mediante modulación progresiva de velocidad (micro-slew).
 *
 * FUNDAMENTOS MATEMÁTICOS:
 * La corrección temporal se fundamenta en la identidad integral en tiempo continuo:
 *   ∫[0, T_slew] δR(u) du = Δx_target
 * donde:
 *   - δR(u) = R(u) - R_base es la desviación de velocidad relativa respecto a la tasa nominal.
 *   - Δx_target es el desplazamiento requerido en segundos de buffer de audio.
 *   - T_slew es la duración finita de la maniobra de corrección.
 *
 * CONVENCIÓN ESTRICTA DE SIGNOS:
 *   - Error de llegada: Δt_arr = t_slave_arr - t_master_arr (segundos de contexto Web Audio).
 *   - Error positivo (Δt_arr > 0): El esclavo llega tarde -> corrección debe acelerar (δR > 0, Δx_target > 0).
 *   - Error negativo (Δt_arr < 0): El esclavo llega temprano -> corrección debe desacelerar (δR < 0, Δx_target < 0).
 *
 * UNIDADES DE LAS VARIABLES:
 *   - masterCurrentTime, slaveCurrentTime: Segundos de buffer [s].
 *   - masterBpm, slaveBpm: Pulsos por minuto analizados [BPM].
 *   - masterPlaybackRate, slavePlaybackRate: Factores adimensionales de velocidad (0.92 a 1.08).
 *   - planningMarginSec: Segundos de tiempo de AudioContext [s].
 *   - Δt_arr: Segundos de tiempo de AudioContext [s].
 *   - Δx_target: Segundos de buffer [s].
 *   - maxSlewSlope: Tasa de cambio de velocidad por segundo [s⁻¹].
 *
 * LIMITACIÓN ACÚSTICA:
 * La igualdad matemática ideal del área no garantiza ausencia de artefactos acústicos ni
 * inaudibilidad perceptual en runtime. Los resultados dependen del material sonoro y del JND.
 */

import { computeProvisionalBeatgrid } from './beatgrid.ts';

/** Límites globales del sistema de transporte DJ (±8%). */
export const MIN_PLAYBACK_RATE = 0.92;
export const MAX_PLAYBACK_RATE = 1.08;

/** Margen mínimo de planificación temporal hacia el futuro (50 ms). */
export const DEFAULT_PLANNING_MARGIN_SEC = 0.050;

/** Umbral de tolerancia de alineación por debajo del cual no se requiere corrección (1 ms). */
export const PHASE_ALIGN_TOLERANCE_SEC = 0.001;

/**
 * Tasa máxima por defecto de cambio de velocidad (pendiente del slew) en s⁻¹.
 *
 * JUSTIFICACIÓN TÉCNICA DEL PARÁMETRO:
 * Se fija por defecto en 0.08 s⁻¹ (equivalente a una variación de 8% de velocidad por segundo).
 * Este valor limita la aceleración para que la rampa temporal no constituya una discontinuidad
 * brusca en el AudioParam, permitiendo una transición suave dentro de un horizonte de varios pulsos.
 *
 * AVISO PSICOACÚSTICO OBLIGATORIO:
 * Este valor NO se presenta como universalmente inaudible ni acústicamente transparente.
 * En señales percusivas o de tonos puros, cualquier modulación de velocidad transitoria puede
 * superar el umbral diferencial de tono (JND) y ser perceptible como un flutter o vibrato.
 * La transparencia perceptual depende del material musical y requiere validación auditiva empírica.
 */
export const DEFAULT_MAX_SLEW_SLOPE = 0.08;

/** Desviación máxima permitida de velocidad para micro-slew respecto al nominal (±4%). */
export const DEFAULT_MAX_SLEW_DEVIATION = 0.04;

/** Duración máxima razonable para un micro-slew (10 segundos). */
export const MAX_SLEW_DURATION_SEC = 10.0;

/** Margen de velocidad mínimo requerido en el sentido de la corrección (0.2%). */
export const MIN_RATE_HEADROOM = 0.002;

/** Máxima discrepancia admisible de tempo efectivo entre decks para alineación de fase estable (0.20 BPM). */
export const MAX_TEMPO_DISCREPANCY_BPM = 0.20;

export type PhaseAlignmentStatus =
  | 'idle'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'rejected_limits'
  | 'rejected_confidence'
  | 'rejected_state'
  | 'already_aligned';

/**
 * Parámetros de entrada para planificar una alineación de fase.
 */
export interface PhaseAlignmentInput {
  masterCurrentTime: number;      // Segundos de buffer del Master
  masterBpm: number;              // BPM analizado del Master
  masterFirstBeatTime: number;     // firstBeatTime en segundos de buffer
  masterDuration: number;         // Duración del buffer del Master en segundos
  masterPlaybackRate: number;     // Multiplicador de velocidad efectivo del Master
  masterBendAmount?: number;      // Pitch bend actual del Master (-0.08 a +0.08)
  masterBpmConfidence?: number;   // Certeza del BPM del Master
  masterIsAmbiguous?: boolean;    // Indicador de ambigüedad del Master

  slaveCurrentTime: number;       // Segundos de buffer del Esclavo
  slaveBpm: number;               // BPM analizado del Esclavo
  slaveFirstBeatTime: number;      // firstBeatTime en segundos de buffer
  slaveDuration: number;          // Duración del buffer del Esclavo en segundos
  slavePlaybackRate: number;      // Multiplicador de velocidad nominal base del Esclavo
  slaveBendAmount?: number;       // Pitch bend actual del Esclavo (-0.08 a +0.08)
  slaveBpmConfidence?: number;    // Certeza del BPM del Esclavo
  slaveIsAmbiguous?: boolean;     // Indicador de ambigüedad del Esclavo

  validateTempoCompatibility?: boolean; // Si es true, exige que las velocidades efectivas coincidan dentro del umbral
  maxTempoDiscrepancyBpm?: number;// Máxima diferencia admisible de BPM efectivo (defecto 0.20 BPM)
  planningMarginSec?: number;     // Margen de planificación hacia el futuro (defecto 0.05s)
  maxSlewSlope?: number;          // Pendiente máxima |d(rate)/dt| en s⁻¹ (defecto 0.08)
  maxSlewDeviation?: number;      // Desviación pico máxima permitida (defecto 0.04)
  phaseToleranceSec?: number;     // Tolerancia para considerar alineado (defecto 0.001s)
}

/**
 * Perfil geométrico del micro-slew temporal.
 * Consta de:
 * 1. Rampa de subida [0, tRamp] de baseRate a peakRate.
 * 2. Meseta opcional [tRamp, tRamp + tPlateau] en peakRate.
 * 3. Rampa de bajada [tRamp + tPlateau, tSlew] de peakRate a baseRate.
 */
export interface SlewProfilePlan {
  readonly baseRate: number;          // Velocidad de referencia inicial y final (R_base)
  readonly peakRate: number;          // Velocidad en el vértice/meseta (R_base + deltaR_peak)
  readonly deltaRPeak: number;        // Desviación pico con signo (peakRate - baseRate)
  readonly tRamp: number;             // Duración de la rampa de aceleración/desaceleración [s]
  readonly tPlateau: number;          // Duración de la meseta a velocidad pico [s]
  readonly tSlew: number;             // Duración total de la maniobra (2 * tRamp + tPlateau) [s]
  readonly targetDisplacement: number;// Desplazamiento acumulado objetivo en segundos de buffer [s]
  readonly calculatedIntegral: number;// Integral matemática exacta calculada [s]
  readonly plannedMasterBeatIndex: number;
  readonly plannedMasterBeatTime: number;
  readonly plannedSlaveBeatIndex: number;
  readonly plannedSlaveBeatTime: number;
  readonly arrivalErrorSec: number;   // Δt_arr = t_slave_arr - t_master_arr [s]
  readonly isTempoSynchronized?: boolean;
  readonly effectiveTempoDriftBpm?: number;
}

/**
 * Resultado formal del cálculo de planificación de alineación.
 */
export interface PhaseAlignmentCalculationResult {
  readonly success: boolean;
  readonly status: PhaseAlignmentStatus;
  readonly plan: SlewProfilePlan | null;
  readonly reason?: string;
  readonly arrivalErrorSec?: number;
  readonly targetDisplacementSec?: number;
  readonly isTempoSynchronized?: boolean;
  readonly effectiveTempoDriftBpm?: number;
}

/**
 * Planifica de manera determinista un perfil de micro-slew para alinear el esclavo con el maestro.
 * Cumple estrictamente con las cotas de velocidad, invariantes de selección y límites de margen.
 */
export function calculatePhaseAlignmentPlan(
  input: PhaseAlignmentInput
): PhaseAlignmentCalculationResult {
  const {
    masterCurrentTime,
    masterBpm,
    masterFirstBeatTime,
    masterDuration,
    masterPlaybackRate,
    masterBpmConfidence,
    masterIsAmbiguous,

    slaveCurrentTime,
    slaveBpm,
    slaveFirstBeatTime,
    slaveDuration,
    slavePlaybackRate,
    slaveBpmConfidence,
    slaveIsAmbiguous,

    planningMarginSec = DEFAULT_PLANNING_MARGIN_SEC,
    maxSlewSlope = DEFAULT_MAX_SLEW_SLOPE,
    maxSlewDeviation = DEFAULT_MAX_SLEW_DEVIATION,
    phaseToleranceSec = PHASE_ALIGN_TOLERANCE_SEC,
  } = input;

  // 1. Validaciones de estado inicial
  if (
    !Number.isFinite(masterCurrentTime) || masterCurrentTime < 0 ||
    !Number.isFinite(slaveCurrentTime) || slaveCurrentTime < 0 ||
    !Number.isFinite(masterPlaybackRate) || masterPlaybackRate <= 0 ||
    !Number.isFinite(slavePlaybackRate) || slavePlaybackRate <= 0 ||
    !Number.isFinite(masterBpm) || masterBpm <= 0 ||
    !Number.isFinite(slaveBpm) || slaveBpm <= 0
  ) {
    return {
      success: false,
      status: 'rejected_state',
      plan: null,
      reason: 'Parámetros numéricos de transporte o tempo inválidos para alinear fase.',
    };
  }

  // 2. Construcción y validación de las retículas provisionales
  const masterGrid = computeProvisionalBeatgrid(masterBpm, masterFirstBeatTime, masterDuration, {
    bpmConfidence: masterBpmConfidence,
    isAmbiguous: masterIsAmbiguous,
  });

  const slaveGrid = computeProvisionalBeatgrid(slaveBpm, slaveFirstBeatTime, slaveDuration, {
    bpmConfidence: slaveBpmConfidence,
    isAmbiguous: slaveIsAmbiguous,
  });

  if (!masterGrid || !slaveGrid) {
    return {
      success: false,
      status: 'rejected_confidence',
      plan: null,
      reason: 'No fue posible proyectar las retículas provisionales para uno o ambos decks.',
    };
  }

  // Verificación estricta de idoneidad: no alinear con retículas provisionales sin suficiente confianza o ambiguas
  if (!masterGrid.isSuitableForSync || !slaveGrid.isSuitableForSync) {
    return {
      success: false,
      status: 'rejected_confidence',
      plan: null,
      reason: 'Retícula provisional insuficientemente fiable para sincronización (baja confianza métrica o ritmo ambiguo).',
    };
  }

  // 3. Comprobación de compatibilidad de velocidades efectivas
  // Si las velocidades difieren, la fase deriva continuamente y un micro-slew no garantiza alineación sostenida.
  const masterBend = typeof input.masterBendAmount === 'number' && Number.isFinite(input.masterBendAmount)
    ? input.masterBendAmount
    : 0;
  const slaveBend = typeof input.slaveBendAmount === 'number' && Number.isFinite(input.slaveBendAmount)
    ? input.slaveBendAmount
    : 0;

  const masterEffectiveBpm = masterBpm * masterPlaybackRate * (1 + masterBend);
  const slaveEffectiveBpm = slaveBpm * slavePlaybackRate * (1 + slaveBend);
  const effectiveBpmDiff = Math.abs(masterEffectiveBpm - slaveEffectiveBpm);
  const maxDiscrepancy = typeof input.maxTempoDiscrepancyBpm === 'number' && Number.isFinite(input.maxTempoDiscrepancyBpm)
    ? input.maxTempoDiscrepancyBpm
    : MAX_TEMPO_DISCREPANCY_BPM;

  // Si se exige validación estricta de compatibilidad de tempo, rechazar si difieren
  if (input.validateTempoCompatibility && effectiveBpmDiff > maxDiscrepancy) {
    return {
      success: false,
      status: 'rejected_state',
      plan: null,
      reason: `Velocidades efectivas incompatibles (${masterEffectiveBpm.toFixed(1)} BPM vs ${slaveEffectiveBpm.toFixed(1)} BPM; diferencia: ${effectiveBpmDiff.toFixed(2)} BPM). Sincronice el tempo nominal (SYNC) antes de alinear la fase para evitar deriva continua.`,
      isTempoSynchronized: false,
      effectiveTempoDriftBpm: Number(effectiveBpmDiff.toFixed(2)),
    };
  }

  // 4. Selección del pulso futuro del Maestro respetando el margen de planificación
  // Δx_M,k = t_M,k - masterCurrentTime
  // Δt_M,k = Δx_M,k / masterPlaybackRate >= planningMarginSec
  let plannedMasterBeatIndex = -1;
  let plannedMasterBeatTime = -1;
  let masterDeltaArrivalSec = -1;

  for (let k = 0; k < masterGrid.totalBeats; k++) {
    const tBeat = masterGrid.beatTimes[k];
    const deltaBuffer = tBeat - masterCurrentTime;
    const deltaArrival = deltaBuffer / masterPlaybackRate;

    if (deltaArrival >= planningMarginSec) {
      plannedMasterBeatIndex = k;
      plannedMasterBeatTime = tBeat;
      masterDeltaArrivalSec = deltaArrival;
      break;
    }
  }

  if (plannedMasterBeatIndex === -1) {
    return {
      success: false,
      status: 'rejected_state',
      plan: null,
      reason: 'No existen pulsos futuros del maestro que respeten el margen de planificación mínimo (50 ms).',
    };
  }

  // 5. Selección del pulso del Esclavo cuya llegada prevista sea más próxima a la del Maestro
  // Para cada pulso j del esclavo:
  // Δt_S,j = (t_S,j - slaveCurrentTime) / slavePlaybackRate
  // Buscamos j_S que minimice |Δt_S,j - masterDeltaArrivalSec|
  let plannedSlaveBeatIndex = -1;
  let plannedSlaveBeatTime = -1;
  let slaveDeltaArrivalSec = -1;
  let minArrivalDiff = Infinity;

  for (let j = 0; j < slaveGrid.totalBeats; j++) {
    const tBeat = slaveGrid.beatTimes[j];
    const deltaBuffer = tBeat - slaveCurrentTime;
    const deltaArrival = deltaBuffer / slavePlaybackRate;

    // Solo considerar pulsos estrictamente futuros (causalmente alcanzables, no eventos pasados)
    if (deltaArrival >= 0) {
      const diff = Math.abs(deltaArrival - masterDeltaArrivalSec);
      if (diff < minArrivalDiff) {
        minArrivalDiff = diff;
        plannedSlaveBeatIndex = j;
        plannedSlaveBeatTime = tBeat;
        slaveDeltaArrivalSec = deltaArrival;
      }
    }
  }

  if (plannedSlaveBeatIndex === -1) {
    return {
      success: false,
      status: 'rejected_state',
      plan: null,
      reason: 'No se encontraron pulsos candidatos en el esclavo para la llegada prevista del maestro.',
    };
  }

  // 5. Definición explícita del error de llegada y desplazamiento objetivo
  // Δt_arr = slaveDeltaArrivalSec - masterDeltaArrivalSec
  // Si Δt_arr > 0: Esclavo llega tarde -> corrección acelera (δR > 0).
  // Si Δt_arr < 0: Esclavo llega temprano -> corrección desacelera (δR < 0).
  const arrivalErrorSec = Number((slaveDeltaArrivalSec - masterDeltaArrivalSec).toFixed(6));

  // Comprobar si ya se encuentra dentro de la tolerancia de alineación
  if (Math.abs(arrivalErrorSec) <= phaseToleranceSec) {
    return {
      success: true,
      status: 'already_aligned',
      plan: null,
      arrivalErrorSec,
      targetDisplacementSec: 0,
      reason: 'Los pulsos ya se encuentran alineados dentro del umbral de tolerancia.',
    };
  }

  // Desplazamiento acumulado en segundos de buffer que debe aportar el micro-slew:
  // Δx_target = Δt_arr * slavePlaybackRate
  const targetDisplacement = Number((arrivalErrorSec * slavePlaybackRate).toFixed(6));

  // 6. Evaluación de márgenes de velocidad disponibles en el Esclavo
  // Cotas estrictas: [MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE] = [0.92, 1.08]
  const isAccelerating = targetDisplacement > 0;
  const availableHeadroom = isAccelerating
    ? Number((MAX_PLAYBACK_RATE - slavePlaybackRate).toFixed(6))
    : Number((slavePlaybackRate - MIN_PLAYBACK_RATE).toFixed(6));

  // Si no existe margen suficiente en el sentido de la corrección, rechazar de forma segura
  if (availableHeadroom < MIN_RATE_HEADROOM) {
    return {
      success: false,
      status: 'rejected_limits',
      plan: null,
      arrivalErrorSec,
      targetDisplacementSec: targetDisplacement,
      reason: isAccelerating
        ? `Margen insuficiente para acelerar el esclavo: velocidad actual (${slavePlaybackRate.toFixed(4)}) cercana al límite superior (1.08).`
        : `Margen insuficiente para desacelerar el esclavo: velocidad actual (${slavePlaybackRate.toFixed(4)}) cercana al límite inferior (0.92).`,
    };
  }

  // 7. Cálculo de la geometría del perfil temporal de velocidad (micro-slew)
  // Perfil simétrico trapezoidal o triangular con tasa máxima de aceleración 'maxSlewSlope'.
  const allowedPeakDev = Math.min(availableHeadroom, maxSlewDeviation);
  const slope = Math.max(0.001, maxSlewSlope);

  // Área máxima alcanzable con un perfil triangular puro:
  // A_tri = (deltaR_cap)^2 / slope
  const maxTriangleArea = (allowedPeakDev * allowedPeakDev) / slope;
  const absArea = Math.abs(targetDisplacement);

  let deltaRPeakMagnitude: number;
  let tRamp: number;
  let tPlateau: number;

  if (absArea <= maxTriangleArea) {
    // Perfil triangular puro (sin meseta)
    deltaRPeakMagnitude = Math.sqrt(absArea * slope);
    tRamp = deltaRPeakMagnitude / slope;
    tPlateau = 0;
  } else {
    // Perfil trapezoidal (con meseta a velocidad pico permitida)
    deltaRPeakMagnitude = allowedPeakDev;
    tRamp = deltaRPeakMagnitude / slope;
    const rampArea = (deltaRPeakMagnitude * deltaRPeakMagnitude) / slope;
    tPlateau = (absArea - rampArea) / deltaRPeakMagnitude;
  }

  const tSlew = Number((2 * tRamp + tPlateau).toFixed(6));

  // Comprobar que la duración de la maniobra no exceda el límite admisible
  if (tSlew > MAX_SLEW_DURATION_SEC) {
    return {
      success: false,
      status: 'rejected_limits',
      plan: null,
      arrivalErrorSec,
      targetDisplacementSec: targetDisplacement,
      reason: `La duración requerida para la corrección (${tSlew.toFixed(2)}s) excede el límite máximo permitido (${MAX_SLEW_DURATION_SEC}s) con el margen de velocidad disponible.`,
    };
  }

  // Aplicar signo a la desviación pico
  const deltaRPeak = isAccelerating ? deltaRPeakMagnitude : -deltaRPeakMagnitude;
  const peakRate = Number((slavePlaybackRate + deltaRPeak).toFixed(4));

  // Verificación estricta final de que peakRate respeta las cotas globales
  if (peakRate < MIN_PLAYBACK_RATE || peakRate > MAX_PLAYBACK_RATE) {
    return {
      success: false,
      status: 'rejected_limits',
      plan: null,
      arrivalErrorSec,
      targetDisplacementSec: targetDisplacement,
      reason: `La velocidad calculada (${peakRate.toFixed(4)}) excede los límites admisibles [0.92, 1.08].`,
    };
  }

  // Comprobación analítica exacta de la integral
  // ∫ δR(u) du = deltaRPeak * (tRamp + tPlateau)
  const calculatedIntegral = Number((deltaRPeak * (tRamp + tPlateau)).toFixed(6));

  const isTempoSynchronized = effectiveBpmDiff <= maxDiscrepancy;
  const effectiveTempoDriftBpm = Number(effectiveBpmDiff.toFixed(2));

  const plan: SlewProfilePlan = {
    baseRate: slavePlaybackRate,
    peakRate,
    deltaRPeak: Number(deltaRPeak.toFixed(6)),
    tRamp: Number(tRamp.toFixed(6)),
    tPlateau: Number(tPlateau.toFixed(6)),
    tSlew,
    targetDisplacement,
    calculatedIntegral,
    plannedMasterBeatIndex,
    plannedMasterBeatTime,
    plannedSlaveBeatIndex,
    plannedSlaveBeatTime,
    arrivalErrorSec,
    isTempoSynchronized,
    effectiveTempoDriftBpm,
  };

  return {
    success: true,
    status: 'active',
    plan,
    arrivalErrorSec,
    targetDisplacementSec: targetDisplacement,
    isTempoSynchronized,
    effectiveTempoDriftBpm,
  };
}

/**
 * Evalúa la velocidad efectiva instantánea R(t) de un perfil de micro-slew en cualquier instante relativo t >= 0.
 *
 * Tramos:
 * - t < 0: baseRate
 * - 0 <= t < tRamp: R_base + deltaR_peak * (t / tRamp)
 * - tRamp <= t <= tRamp + tPlateau: peakRate
 * - tRamp + tPlateau < t <= tSlew: peakRate - deltaR_peak * ((t - (tRamp + tPlateau)) / tRamp)
 * - t > tSlew: baseRate
 */
export function evaluateSlewRateAt(plan: SlewProfilePlan, relativeTimeSec: number): number {
  const { baseRate, peakRate, deltaRPeak, tRamp, tPlateau, tSlew } = plan;

  if (relativeTimeSec <= 0) {
    return baseRate;
  }
  if (relativeTimeSec >= tSlew) {
    return baseRate;
  }

  // Tramo 1: Rampa de aceleración/desaceleración inicial
  if (relativeTimeSec < tRamp) {
    const fraction = relativeTimeSec / tRamp;
    return Number((baseRate + deltaRPeak * fraction).toFixed(6));
  }

  // Tramo 2: Meseta
  const tPlateauEnd = tRamp + tPlateau;
  if (relativeTimeSec <= tPlateauEnd) {
    return peakRate;
  }

  // Tramo 3: Rampa de retorno a velocidad base
  const returnFraction = (relativeTimeSec - tPlateauEnd) / tRamp;
  return Number((peakRate - deltaRPeak * returnFraction).toFixed(6));
}

/**
 * Calcula de manera analítica y exacta la integral de la trayectoria efectiva entre dos instantes:
 * ∫[tFrom, tTo] R(u) du
 *
 * Permite consolidar la posición exacta del transporte en segundos de buffer sin error numérico
 * de discretización si la maniobra es cancelada o interrumpida prematuramente.
 */
export function integrateSlewTrajectory(
  plan: SlewProfilePlan,
  tFromSec: number,
  tToSec: number
): number {
  if (tToSec <= tFromSec) {
    return 0;
  }

  const { baseRate, deltaRPeak, tRamp, tPlateau, tSlew } = plan;
  const tPlateauEnd = tRamp + tPlateau;

  // Función analítica de primitiva de R(t): F(t) = ∫[0, t] R(u) du
  const primitiveF = (t: number): number => {
    if (t <= 0) return 0;

    // Tramo 1: [0, tRamp]
    // R(u) = baseRate + deltaRPeak * (u / tRamp)
    // F(t) = baseRate * t + 0.5 * deltaRPeak * t^2 / tRamp
    if (t <= tRamp) {
      return baseRate * t + 0.5 * deltaRPeak * (t * t) / tRamp;
    }

    const areaRamp1 = baseRate * tRamp + 0.5 * deltaRPeak * tRamp;

    // Tramo 2: [tRamp, tPlateauEnd]
    // R(u) = baseRate + deltaRPeak
    if (t <= tPlateauEnd) {
      const deltaT = t - tRamp;
      return areaRamp1 + (baseRate + deltaRPeak) * deltaT;
    }

    const areaPlateau = (baseRate + deltaRPeak) * tPlateau;

    // Tramo 3: [tPlateauEnd, tSlew]
    // R(u) = (baseRate + deltaRPeak) - deltaRPeak * ((u - tPlateauEnd) / tRamp)
    if (t <= tSlew) {
      const deltaT = t - tPlateauEnd;
      const rAtDelta = (baseRate + deltaRPeak) - 0.5 * deltaRPeak * (deltaT / tRamp);
      return areaRamp1 + areaPlateau + rAtDelta * deltaT;
    }

    // Tramo 4: t > tSlew
    // R(u) = baseRate
    const areaRamp2 = baseRate * tRamp + 0.5 * deltaRPeak * tRamp;
    const totalSlewArea = areaRamp1 + areaPlateau + areaRamp2;
    return totalSlewArea + baseRate * (t - tSlew);
  };

  const integral = primitiveF(tToSec) - primitiveF(tFromSec);
  return Number(integral.toFixed(6));
}
