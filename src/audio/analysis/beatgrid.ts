/**
 * SYSTEM DJ — Provisional Beatgrid & Beat Phase Engine
 * Proyección matemática periódica y cálculo de fase relativa a partir de BPM
 * y del primer transitorio percusivo detectado (firstBeatTime).
 *
 * AVISO ARQUITECTÓNICO:
 * Esta retícula es una PROYECCIÓN MATEMÁTICA PROVISIONAL.
 * NO representa una detección compás a compás verificada, NO determina el compás
 * musical ni asume que firstBeatTime sea el Downbeat (tiempo 1 del compás).
 */

export interface ProvisionalBeatgridOptions {
  /** Confianza métrica (0.0 a 1.0) reportada por el detector de BPM. */
  bpmConfidence?: number;
  /** Bandera que indica si el ritmo fue reportado como ambiguo por el análisis. */
  isAmbiguous?: boolean;
  /** Límite superior de puntos generados en memoria para evitar saturación de heap. */
  maxBeats?: number;
}

/**
 * Representa la retícula temporal provisional proyectada para una pista.
 */
export interface ProvisionalBeatgrid {
  /** BPM base utilizado para la proyección. */
  readonly bpm: number;
  /** Intervalo exacto en segundos entre pulsos matemáticos (60 / bpm). */
  readonly beatInterval: number;
  /** Instante inicial en segundos del primer transitorio rítmico detectado. */
  readonly firstBeatTime: number;
  /** Duración total de la pista en segundos sobre la que se proyecta. */
  readonly duration: number;
  /** Cantidad total de pulsos generados en la retícula. */
  readonly totalBeats: number;
  /** Arreglo inmutable de marcas de tiempo en segundos para cada pulso k. */
  readonly beatTimes: readonly number[];
  /** Bandera estricta que documenta que es una proyección matemática provisional. */
  readonly isProvisional: true;
  /** Bandera estricta que documenta que NO es una retícula musical verificada. */
  readonly isMusicallyVerified: false;
  /** Nivel de confianza métrica (0.0 a 1.0) del análisis que dio origen a la retícula. */
  readonly bpmConfidence?: number;
  /** Indica si el tempo base fue considerado ambiguo en el análisis acústico. */
  readonly isAmbiguous?: boolean;
  /**
   * Evaluación de idoneidad técnica para sincronización.
   * Requiere confianza mínima y ausencia de ambigüedad, sin afirmar veracidad de compás.
   */
  readonly isSuitableForSync: boolean;
}

/**
 * Resultado del cálculo de fase rítmica respecto a la retícula provisional.
 */
export interface BeatPhaseResult {
  /** Indica si el cálculo de fase es matemáticamente válido y consistente. */
  readonly isValid: boolean;
  /** Índice (0-based) del pulso matemático proyectado más cercano. */
  readonly nearestBeatIndex: number;
  /** Instante en segundos del pulso matemático más cercano. */
  readonly nearestBeatTime: number;
  /**
   * Fase relativa normalizada dentro del intervalo [0, 1).
   * 0.0 indica coincidencia exacta con un pulso.
   * 0.5 indica contratiempo exacto (mitad del intervalo).
   */
  readonly phase: number;
  /**
   * Desviación temporal con signo en segundos:
   * signedDistanceSec = currentTime - nearestBeatTime
   * - > 0: El cabezal de reproducción está ADELANTADO respecto al pulso (el pulso ya ocurrió).
   * - < 0: El cabezal de reproducción está RETRASADO respecto al pulso (el pulso ocurrirá).
   * - === 0: Coincidencia exacta con el pulso.
   */
  readonly signedDistanceSec: number;
  /** Distancia temporal absoluta en segundos al pulso más cercano (|signedDistanceSec|). */
  readonly distanceSec: number;
  /** Mensaje de error en caso de que isValid sea false. */
  readonly error?: string;
}

/** Límite superior por defecto de puntos para proteger memoria en audios prolongados. */
export const DEFAULT_MAX_PROVISIONAL_BEATS = 20000;

/**
 * Proyecta una retícula matemática provisional a partir de BPM y firstBeatTime.
 * Valida estrictamente todos los argumentos y retorna null si los datos no son viables.
 */
export function computeProvisionalBeatgrid(
  bpm: number,
  firstBeatTime: number,
  duration: number,
  options: ProvisionalBeatgridOptions = {}
): ProvisionalBeatgrid | null {
  // 1. Validaciones matemáticas estrictas
  if (
    typeof bpm !== 'number' ||
    !Number.isFinite(bpm) ||
    bpm <= 0 ||
    typeof firstBeatTime !== 'number' ||
    !Number.isFinite(firstBeatTime) ||
    firstBeatTime < 0 ||
    typeof duration !== 'number' ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    firstBeatTime > duration
  ) {
    return null;
  }

  const beatInterval = 60 / bpm;
  if (!Number.isFinite(beatInterval) || beatInterval <= 0) {
    return null;
  }

  // 2. Cálculo de cantidad de pulsos acotada a la duración disponible
  const availableDuration = duration - firstBeatTime;
  const theoreticalCount = Math.floor(availableDuration / beatInterval) + 1;

  const maxLimit = options.maxBeats !== undefined && Number.isFinite(options.maxBeats) && options.maxBeats > 0
    ? Math.floor(options.maxBeats)
    : DEFAULT_MAX_PROVISIONAL_BEATS;

  const totalBeats = Math.min(theoreticalCount, maxLimit);
  if (totalBeats <= 0) {
    return null;
  }

  // 3. Proyección determinista de marcas de tiempo
  const beatTimes = new Array<number>(totalBeats);
  for (let k = 0; k < totalBeats; k++) {
    const t = firstBeatTime + k * beatInterval;
    beatTimes[k] = Number(t.toFixed(6));
  }

  // 4. Evaluación de idoneidad para sincronización (sin inventar certezas de compás)
  const confidence = options.bpmConfidence;
  const isAmbiguous = options.isAmbiguous ?? false;
  // Requiere explícitamente confianza numérica válida (>= 0.5) y que no sea ambiguo
  const hasSufficientConfidence = typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0.5;
  const isSuitableForSync = totalBeats >= 2 && !isAmbiguous && hasSufficientConfidence;

  return {
    bpm: Number(bpm.toFixed(3)),
    beatInterval: Number(beatInterval.toFixed(6)),
    firstBeatTime: Number(firstBeatTime.toFixed(6)),
    duration: Number(duration.toFixed(6)),
    totalBeats,
    beatTimes: Object.freeze(beatTimes),
    isProvisional: true,
    isMusicallyVerified: false,
    bpmConfidence: confidence,
    isAmbiguous,
    isSuitableForSync,
  };
}

/**
 * Calcula la fase relativa y distancia al pulso matemático más cercano en la retícula.
 * Convención de signo: signedDistanceSec = currentTime - nearestBeatTime
 */
export function getBeatPhase(
  currentTime: number,
  beatgrid: ProvisionalBeatgrid | null | undefined
): BeatPhaseResult {
  // Validación de entradas
  if (
    !beatgrid ||
    typeof currentTime !== 'number' ||
    !Number.isFinite(currentTime) ||
    currentTime < 0 ||
    currentTime > beatgrid.duration ||
    beatgrid.totalBeats === 0 ||
    !Number.isFinite(beatgrid.beatInterval) ||
    beatgrid.beatInterval <= 0
  ) {
    let errorMsg = 'Parámetros inválidos para cálculo de fase';
    if (!beatgrid) {
      errorMsg = 'Retícula provisional no suministrada o nula';
    } else if (!Number.isFinite(currentTime) || currentTime < 0 || currentTime > beatgrid.duration) {
      errorMsg = `currentTime (${currentTime}) fuera de los límites de la pista [0, ${beatgrid.duration}]`;
    }

    return {
      isValid: false,
      nearestBeatIndex: -1,
      nearestBeatTime: NaN,
      phase: NaN,
      signedDistanceSec: NaN,
      distanceSec: NaN,
      error: errorMsg,
    };
  }

  const { firstBeatTime, beatInterval, totalBeats, beatTimes } = beatgrid;

  // 1. Fase relativa normalizada dentro del intervalo [0, 1)
  const timeOffset = currentTime - firstBeatTime;
  const rawPhase = ((timeOffset % beatInterval) + beatInterval) % beatInterval;
  let phase = rawPhase / beatInterval;

  // Mitigación de errores de redondeo en aritmética de punto flotante en fronteras 0 y 1
  if (phase >= 1.0 || Math.abs(phase - 1.0) < 1e-9 || Math.abs(phase) < 1e-9) {
    phase = 0.0;
  }
  phase = Number(phase.toFixed(6));

  // 2. Índice del pulso más cercano (acotado al rango generado [0, totalBeats - 1])
  const kExact = timeOffset / beatInterval;
  const kNearest = Math.round(kExact);
  const nearestBeatIndex = Math.max(0, Math.min(totalBeats - 1, kNearest));
  const nearestBeatTime = beatTimes[nearestBeatIndex];

  // 3. Desviación temporal con signo
  let signedDistance = currentTime - nearestBeatTime;
  if (Math.abs(signedDistance) < 1e-9) {
    signedDistance = 0;
  }
  signedDistance = Number(signedDistance.toFixed(6));
  const distanceSec = Number(Math.abs(signedDistance).toFixed(6));

  return {
    isValid: true,
    nearestBeatIndex,
    nearestBeatTime,
    phase,
    signedDistanceSec: signedDistance,
    distanceSec,
  };
}
