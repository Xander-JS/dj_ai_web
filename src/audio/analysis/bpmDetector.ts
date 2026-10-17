/**
 * SYSTEM DJ — Algorithmic BPM Detector
 * Detección de tempo mediante decimilación, filtro percusivo, curva de novedad,
 * autocorrelación y análisis armónico (mitigación de medio y doble tiempo sin sesgo arbitrario).
 */

export interface BpmDetectionResult {
  bpm?: number;
  confidence: number;            // 0.0 a 1.0
  alternateBpm?: number[];       // Candidatos armónicos (ej. medio tiempo o doble tiempo)
  isAmbiguous: boolean;          // Verdadero si no hay pulsos periódicos claros
}

export interface BpmDetectorOptions {
  minBpm?: number;               // Por defecto 60 BPM
  maxBpm?: number;               // Por defecto 210 BPM
  maxAnalysisDurationSec?: number; // Ventana de análisis en segundos (por defecto 30s)
}

/**
 * Filtro IIR Pasa-Bajos Biquad de 2º orden.
 */
function applyBiquadLowpass(
  input: Float32Array,
  sampleRate: number,
  cutoffFreq: number
): Float32Array {
  const output = new Float32Array(input.length);
  const w0 = (2 * Math.PI * cutoffFreq) / sampleRate;
  const alpha = Math.sin(w0) / (2 * 0.7071);
  const cosW0 = Math.cos(w0);

  const b0 = (1 - cosW0) / 2;
  const b1 = 1 - cosW0;
  const b2 = (1 - cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;

    output[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return output;
}

/**
 * Decimación con filtro promediador (anti-aliasing) para acelerar el procesamiento.
 */
function downsampleAudio(
  input: Float32Array,
  sourceRate: number,
  targetRate: number
): { data: Float32Array; actualRate: number } {
  const factor = Math.max(1, Math.floor(sourceRate / targetRate));
  if (factor === 1) {
    return { data: input, actualRate: sourceRate };
  }

  const outLen = Math.floor(input.length / factor);
  const output = new Float32Array(outLen);

  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    const start = i * factor;
    for (let j = 0; j < factor; j++) {
      sum += input[start + j];
    }
    output[i] = sum / factor;
  }

  return { data: output, actualRate: sourceRate / factor };
}

/**
 * Calcula la curva de novedad (Onset Detection Function - ODF).
 */
function computeNoveltyCurve(
  pcm: Float32Array,
  hopSize: number,
  frameSize: number
): Float32Array {
  const numFrames = Math.max(1, Math.floor((pcm.length - frameSize) / hopSize));
  const odf = new Float32Array(numFrames);

  let prevEnergy = 0;

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;
    let sumSq = 0;
    for (let i = 0; i < frameSize; i++) {
      const s = pcm[offset + i];
      sumSq += s * s;
    }
    const currentEnergy = Math.sqrt(sumSq / frameSize);

    // Rectificación de media onda de la derivada de primer orden
    const diff = currentEnergy - prevEnergy;
    odf[f] = diff > 0 ? diff : 0;
    prevEnergy = currentEnergy;
  }

  return odf;
}

/**
 * Interpolación parabólica de pico para obtener precisión sub-muestra en el retardo.
 */
function parabolicInterpolation(
  array: Float32Array | number[],
  idx: number
): { preciseIndex: number; interpolatedValue: number } {
  if (idx <= 0 || idx >= array.length - 1) {
    return { preciseIndex: idx, interpolatedValue: array[idx] };
  }

  const alpha = array[idx - 1];
  const beta = array[idx];
  const gamma = array[idx + 1];

  const denom = alpha - 2 * beta + gamma;
  if (Math.abs(denom) < 1e-12) {
    return { preciseIndex: idx, interpolatedValue: beta };
  }

  const delta = (alpha - gamma) / (2 * denom);
  const preciseIndex = idx + delta;
  const interpolatedValue = beta - 0.25 * (alpha - gamma) * delta;

  return { preciseIndex, interpolatedValue };
}

/**
 * Detecta el tempo (BPM) de una señal de audio PCM.
 */
export function detectBpm(
  pcm: Float32Array,
  sampleRate: number,
  options: BpmDetectorOptions = {}
): BpmDetectionResult {
  const minBpm = options.minBpm ?? 60;
  const maxBpm = options.maxBpm ?? 210;
  const maxDurationSec = options.maxAnalysisDurationSec ?? 30;

  if (!pcm || pcm.length < sampleRate * 0.5) {
    return { confidence: 0, isAmbiguous: true };
  }

  // 1. Limitar longitud de análisis para eficiencia (porción representativa central)
  const maxSamples = Math.floor(maxDurationSec * sampleRate);
  let analysisPcm = pcm;
  if (pcm.length > maxSamples) {
    // Tomar segmento central para evitar silencios prolongados en intro/outro
    const start = Math.floor((pcm.length - maxSamples) / 2);
    analysisPcm = pcm.subarray(start, start + maxSamples);
  }

  // 2. Decimar a una tasa manejable de análisis (~2205 Hz)
  const targetRate = 2205;
  const { data: downsampled, actualRate: downRate } = downsampleAudio(
    analysisPcm,
    sampleRate,
    targetRate
  );

  // 3. Aislar banda rítmica percusiva con filtro pasobajos a 220 Hz
  const lowpassed = applyBiquadLowpass(downsampled, downRate, 220);

  // 4. Calcular curva de novedad espectro-temporal combinada
  // Marco de 15 ms, hop de 5 ms -> ~200 frames por segundo
  const frameSize = Math.max(16, Math.round(0.015 * downRate));
  const hopSize = Math.max(8, Math.round(0.005 * downRate));
  const odfRate = downRate / hopSize;

  const odfLow = computeNoveltyCurve(lowpassed, hopSize, frameSize);
  const odfFull = computeNoveltyCurve(downsampled, hopSize, frameSize);

  const numFrames = Math.min(odfLow.length, odfFull.length);
  if (numFrames < 50) {
    return { confidence: 0, isAmbiguous: true };
  }

  // Curva de novedad ponderada: 75% frecuencias bajas (bombo/bajo), 25% banda completa (cajas/platos)
  const combinedOdf = new Float32Array(numFrames);
  let odfSum = 0;
  let odfMax = 0;

  for (let i = 0; i < numFrames; i++) {
    const val = 0.75 * odfLow[i] + 0.25 * odfFull[i];
    combinedOdf[i] = val;
    odfSum += val;
    if (val > odfMax) odfMax = val;
  }

  // Si no hay transitorios o la señal es continua y plana (ej. drone, silencio o ruido suave)
  if (odfMax < 1e-4) {
    return { confidence: 0, isAmbiguous: true };
  }

  const odfMean = odfSum / numFrames;
  let odfVar = 0;
  for (let i = 0; i < numFrames; i++) {
    const diff = combinedOdf[i] - odfMean;
    odfVar += diff * diff;
  }
  const odfStd = Math.sqrt(odfVar / numFrames);
  if (odfStd < 1e-5) {
    return { confidence: 0, isAmbiguous: true };
  }

  // Centrar ODF para la autocorrelación
  const odfCentered = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    odfCentered[i] = combinedOdf[i] - odfMean;
  }

  // 5. Autocorrelación evaluada en el rango de retardos correspondiente a [minBpm, maxBpm]
  const minLag = Math.max(2, Math.floor((60 * odfRate) / maxBpm));
  const maxLag = Math.min(numFrames - 2, Math.ceil((60 * odfRate) / minBpm));

  if (maxLag <= minLag) {
    return { confidence: 0, isAmbiguous: true };
  }

  // Vector de autocorrelación normalizada
  const autoCorr = new Float32Array(maxLag + 10);
  const variance = odfVar / numFrames;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const count = numFrames - lag;
    for (let i = 0; i < count; i++) {
      sum += odfCentered[i] * odfCentered[i + lag];
    }
    autoCorr[lag] = sum / (count * variance + 1e-12);
  }

  // 6. Búsqueda de picos y evaluación armónica (sin sesgo arbitrario a un tempo único)
  interface PeakCandidate {
    lag: number;
    preciseLag: number;
    bpm: number;
    rawCorr: number;
    harmonicScore: number;
  }

  const peaks: PeakCandidate[] = [];

  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const val = autoCorr[lag];
    if (val > autoCorr[lag - 1] && val > autoCorr[lag + 1] && val > 0.05) {
      const { preciseIndex, interpolatedValue } = parabolicInterpolation(autoCorr, lag);
      const bpm = (60 * odfRate) / preciseIndex;

      if (bpm >= minBpm && bpm <= maxBpm) {
        peaks.push({
          lag,
          preciseLag: preciseIndex,
          bpm,
          rawCorr: interpolatedValue,
          harmonicScore: interpolatedValue,
        });
      }
    }
  }

  if (peaks.length === 0) {
    return { confidence: 0, isAmbiguous: true };
  }

  // Evaluación de resonancia armónica para cada pico:
  // Evalúa si existen picos de soporte en el doble retardo (medio tiempo en BPM)
  // o en la mitad del retardo (doble tiempo en BPM)
  for (const peak of peaks) {
    let support = peak.rawCorr;

    // Soporte de segundo armónico temporal (lag * 2 -> tempo medio)
    const doubleLag = Math.round(peak.lag * 2);
    if (doubleLag < autoCorr.length && autoCorr[doubleLag] > 0.05) {
      support += 0.5 * autoCorr[doubleLag];
    }

    // Soporte de tercer armónico temporal (lag * 3)
    const tripleLag = Math.round(peak.lag * 3);
    if (tripleLag < autoCorr.length && autoCorr[tripleLag] > 0.05) {
      support += 0.25 * autoCorr[tripleLag];
    }

    // Soporte de sub-armónico temporal (lag / 2 -> doble tempo)
    const halfLag = Math.round(peak.lag / 2);
    if (halfLag >= minLag && autoCorr[halfLag] > 0.05) {
      support += 0.3 * autoCorr[halfLag];
    }

    peak.harmonicScore = support;
  }

  // Ordenar picos por resonancia armónica
  peaks.sort((a, b) => b.harmonicScore - a.harmonicScore);

  const best = peaks[0];
  const alternates: number[] = [];

  // Recopilar candidatos armónicos secundarios (medio tiempo, doble tiempo o segundo mejor pico)
  for (let i = 1; i < Math.min(peaks.length, 3); i++) {
    const candidateBpm = Number(peaks[i].bpm.toFixed(1));
    if (!alternates.includes(candidateBpm)) {
      alternates.push(candidateBpm);
    }
  }
  // Añadir matemáticamente medio y doble tempo si no estaban presentes
  const halfBpm = Number((best.bpm * 0.5).toFixed(1));
  const doubleBpm = Number((best.bpm * 2.0).toFixed(1));
  if (halfBpm >= 50 && !alternates.includes(halfBpm)) alternates.push(halfBpm);
  if (doubleBpm <= 220 && !alternates.includes(doubleBpm)) alternates.push(doubleBpm);

  // 7. Estimación de certeza y ambigüedad
  // Un pico sin suficiente prominencia respecto al fondo representa ritmo difuso o ausente
  let meanCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    meanCorr += Math.max(0, autoCorr[lag]);
  }
  meanCorr /= (maxLag - minLag + 1);

  const peakProminence = best.rawCorr - meanCorr;
  const isAmbiguous = best.rawCorr < 0.12 || peakProminence < 0.06;

  // Confianza acotada [0.0, 1.0]
  let confidence = 0;
  if (!isAmbiguous) {
    const corrFactor = Math.min(1.0, best.rawCorr / 0.6);
    const promFactor = Math.min(1.0, peakProminence / 0.25);
    confidence = Math.min(1.0, Math.max(0.15, 0.6 * corrFactor + 0.4 * promFactor));
  }

  if (isAmbiguous) {
    return {
      confidence: Number((confidence * 0.4).toFixed(3)),
      alternateBpm: alternates,
      isAmbiguous: true,
      bpm: undefined,
    };
  }

  return {
    bpm: Number(best.bpm.toFixed(1)),
    confidence: Number(confidence.toFixed(3)),
    alternateBpm: alternates,
    isAmbiguous: false,
  };
}

/**
 * Detecta el instante en segundos del primer beat/transitorio rítmico significativo
 * a partir de la curva de novedad (ODF) y filtrado percusivo.
 * No asume compás 4/4 ni downbeat forzado (preparado para Fase 23.4).
 * Retorna null si la pista no tiene transitorios percusivos claros (ej. ambient, drone o silencio).
 */
export function detectFirstBeatTime(
  pcm: Float32Array,
  sampleRate: number
): number | null {
  if (!pcm || pcm.length < sampleRate * 0.2) {
    return null;
  }

  // Analizar primeros 12 segundos (o la pista entera si es más corta)
  const maxSamples = Math.min(pcm.length, Math.round(sampleRate * 12));
  const introPcm = pcm.subarray(0, maxSamples);

  // Decimar a ~2205 Hz
  const targetRate = 2205;
  const { data: downsampled, actualRate: downRate } = downsampleAudio(
    introPcm,
    sampleRate,
    targetRate
  );

  // Filtro pasobajos a 220 Hz para transitorios de percusión/bombo
  const lowpassed = applyBiquadLowpass(downsampled, downRate, 220);

  // Curva de novedad (ODF)
  const frameSize = Math.max(16, Math.round(0.015 * downRate));
  const hopSize = Math.max(8, Math.round(0.005 * downRate));

  const odfLow = computeNoveltyCurve(lowpassed, hopSize, frameSize);
  const odfFull = computeNoveltyCurve(downsampled, hopSize, frameSize);

  const numFrames = Math.min(odfLow.length, odfFull.length);
  if (numFrames < 10) {
    return null;
  }

  const combinedOdf = new Float32Array(numFrames);
  let odfMax = 0;
  let odfSum = 0;

  for (let i = 0; i < numFrames; i++) {
    const val = 0.75 * odfLow[i] + 0.25 * odfFull[i];
    combinedOdf[i] = val;
    odfSum += val;
    if (val > odfMax) odfMax = val;
  }

  if (odfMax < 1e-4) {
    return null;
  }

  const odfMean = odfSum / numFrames;
  let odfVar = 0;
  for (let i = 0; i < numFrames; i++) {
    const diff = combinedOdf[i] - odfMean;
    odfVar += diff * diff;
  }
  const odfStd = Math.sqrt(odfVar / numFrames);

  // Umbral adaptativo: al menos 20% del máximo transitorio y por encima del nivel medio + desviación
  const threshold = Math.max(0.20 * odfMax, odfMean + 1.0 * odfStd);

  // Buscar el primer pico local que supere el umbral
  for (let i = 1; i < numFrames - 1; i++) {
    if (
      combinedOdf[i] >= threshold &&
      combinedOdf[i] > combinedOdf[i - 1] &&
      combinedOdf[i] >= combinedOdf[i + 1]
    ) {
      // Interpolación parabólica para precisión de milisegundos
      const { preciseIndex } = parabolicInterpolation(combinedOdf, i);
      const timeSeconds = (preciseIndex * hopSize) / downRate;
      return Number(Math.max(0, timeSeconds).toFixed(3));
    }
  }

  return null;
}
