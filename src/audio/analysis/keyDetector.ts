/**
 * SYSTEM DJ — Algorithmic Musical Key & Chroma Detector
 * Extracción de perfil cromático (Pitch Class Profile - PCP) y correlación modal Krumhansl-Schmuckler.
 */

import type { MusicalKeyCamelot } from '../../types/track.ts';
import { pitchClassToKey } from './camelotMapper.ts';

// Perfiles tonales de Krumhansl-Schmuckler (K-S) para tonalidades mayores y menores
// Normalizados con ponderaciones psicofísicas estándar de jerarquía tonal de Krumhansl & Kessler (1982)
const KS_MAJOR_PROFILE = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88
];

const KS_MINOR_PROFILE = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17
];

export interface KeyCandidate {
  key: string;
  camelot: MusicalKeyCamelot;
  mode: 'major' | 'minor';
  rootPitchClass: number;
  correlation: number;
}

export interface KeyDetectionResult {
  key?: string;
  camelot?: MusicalKeyCamelot;
  confidence: number;            // 0.0 a 1.0
  correlation: number;           // Coeficiente Pearson de la mejor tonalidad (-1.0 a 1.0)
  secondCandidate?: KeyCandidate;
  chroma: number[];              // Vector de 12 clases de altura (0 = C, 1 = C#, ...)
  isAmbiguous: boolean;          // Verdadero si la correlación es difusa o hay empate
}

export interface KeyDetectorOptions {
  maxFrames?: number;            // Ventanas FFT distribuidas a lo largo de la pista (por defecto 32)
  minCorrelation?: number;       // Correlación K-S mínima para una tonalidad concluyente (por defecto 0.50)
  minMargin?: number;            // Margen mínimo frente al segundo candidato (por defecto 0.05)
  minConfidence?: number;        // Confianza mínima para no considerarse ambigua (por defecto 0.30)
}

/**
 * Umbrales permisivos para la segunda pasada: 4x más ventanas cromáticas sobre toda la
 * pista y criterios de correlación/margen relajados. La fórmula de confianza se mantiene.
 */
export const RELAXED_KEY_OPTIONS: Readonly<KeyDetectorOptions> = {
  maxFrames: 128,
  minCorrelation: 0.40,
  minMargin: 0.02,
  minConfidence: 0.15,
};

/**
 * Implementación in-place optimizada de la Transformada Rápida de Fourier (Radix-2 FFT).
 * Solo para tamaños potencia de 2 (ej. 2048, 4096).
 */
function fftRadix2(real: Float64Array, imag: Float64Array, n: number): void {
  // Reordenamiento por inversión de bits (Bit-reversal)
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = real[i];
      real[i] = real[j];
      real[j] = tempR;

      const tempI = imag[i];
      imag[i] = imag[j];
      imag[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Mariposas de Cooley-Tukey
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angleStep = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angleStep);
    const wStepI = Math.sin(angleStep);

    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;

      for (let k = 0; k < halfLen; k++) {
        const idxEven = i + k;
        const idxOdd = i + k + halfLen;

        const tr = wR * real[idxOdd] - wI * imag[idxOdd];
        const ti = wR * imag[idxOdd] + wI * real[idxOdd];

        real[idxOdd] = real[idxEven] - tr;
        imag[idxOdd] = imag[idxEven] - ti;

        real[idxEven] = real[idxEven] + tr;
        imag[idxEven] = imag[idxEven] + ti;

        const nextWR = wR * wStepR - wI * wStepI;
        const nextWI = wR * wStepI + wI * wStepR;
        wR = nextWR;
        wI = nextWI;
      }
    }
  }
}

/**
 * Coeficiente de correlación de Pearson entre dos vectores de longitud idéntica.
 */
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const denom = Math.sqrt(denX * denY);
  if (denom < 1e-12) return 0;
  return num / denom;
}

/**
 * Extrae el vector de 12 clases cromáticas (PCP) a partir de muestras PCM de audio.
 */
export function extractChromaProfile(
  pcm: Float32Array,
  sampleRate: number,
  maxFrames = 32
): { chroma: number[]; isFlatOrSilent: boolean } {
  const chroma = new Array(12).fill(0);
  const totalLength = pcm ? pcm.length : 0;

  if (totalLength < 1024) {
    return { chroma, isFlatOrSilent: true };
  }

  // Decimación adaptativa hacia ~11025 Hz para máxima resolución por semitono (2.69 Hz/bin)
  const targetRate = 11025;
  const decimationFactor = Math.max(1, Math.floor(sampleRate / targetRate));
  const effectiveRate = sampleRate / decimationFactor;

  let analysisPcm = pcm;
  if (decimationFactor > 1) {
    const downLen = Math.floor(totalLength / decimationFactor);
    const downsampled = new Float32Array(downLen);
    for (let i = 0; i < downLen; i++) {
      let sum = 0;
      const start = i * decimationFactor;
      for (let j = 0; j < decimationFactor; j++) {
        sum += pcm[start + j];
      }
      downsampled[i] = sum / decimationFactor;
    }
    analysisPcm = downsampled;
  }

  const fftSize = 4096;
  const halfFft = fftSize / 2;

  // Calculamos ventanas representativas distribuidas a lo largo de la señal
  const hopSize = 2048;
  const numPossibleFrames = Math.max(1, Math.floor((analysisPcm.length - fftSize) / hopSize));
  const maxFramesToAnalyze = Math.min(Math.max(1, maxFrames), numPossibleFrames);
  const frameStride = Math.max(1, Math.floor(numPossibleFrames / maxFramesToAnalyze));

  const realBuffer = new Float64Array(fftSize);
  const imagBuffer = new Float64Array(fftSize);

  // Ventana de Hann precalculada
  const hannWindow = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  let framesProcessed = 0;
  let totalEnergy = 0;

  for (let f = 0; f < numPossibleFrames; f += frameStride) {
    const offset = f * hopSize;
    if (offset + fftSize > analysisPcm.length) break;

    // Llenar y aplicar ventana
    for (let i = 0; i < fftSize; i++) {
      realBuffer[i] = analysisPcm[offset + i] * hannWindow[i];
      imagBuffer[i] = 0.0;
    }

    fftRadix2(realBuffer, imagBuffer, fftSize);
    framesProcessed++;

    // Analizamos contenedores de frecuencia entre 65 Hz (C2) y 1200 Hz (D6)
    for (let bin = 1; bin < halfFft; bin++) {
      const freq = (bin * effectiveRate) / fftSize;
      if (freq < 65 || freq > 1200) continue;

      const magSquared = realBuffer[bin] * realBuffer[bin] + imagBuffer[bin] * imagBuffer[bin];
      if (magSquared < 1e-10) continue;

      const mag = Math.sqrt(magSquared);
      totalEnergy += magSquared;

      // Conversión a tono MIDI y clase cromática (0 = C, 1 = C#, ...)
      const midiNote = 69 + 12 * Math.log2(freq / 440);
      const roundedMidi = Math.round(midiNote);
      const pitchClass = ((roundedMidi % 12) + 12) % 12;

      chroma[pitchClass] += mag;
    }

    if (framesProcessed >= maxFramesToAnalyze) break;
  }

  if (framesProcessed === 0 || totalEnergy < 1e-7) {
    return { chroma, isFlatOrSilent: true };
  }

  // Normalización L2 del vector croma
  let normL2 = 0;
  for (let c = 0; c < 12; c++) {
    normL2 += chroma[c] * chroma[c];
  }
  normL2 = Math.sqrt(normL2);

  if (normL2 < 1e-8) {
    return { chroma, isFlatOrSilent: true };
  }

  for (let c = 0; c < 12; c++) {
    chroma[c] /= normL2;
  }

  // Evaluar si el espectro cromático es completamente plano (ej. ruido blanco)
  let mean = 0;
  for (let c = 0; c < 12; c++) mean += chroma[c];
  mean /= 12;

  let variance = 0;
  for (let c = 0; c < 12; c++) {
    const diff = chroma[c] - mean;
    variance += diff * diff;
  }
  const stdDev = Math.sqrt(variance / 12);

  // Si la desviación estándar es insignificante (< 0.025), no hay discriminación tonal
  const isFlatOrSilent = stdDev < 0.025;

  return { chroma, isFlatOrSilent };
}

/**
 * Detecta la tonalidad musical de una señal PCM mediante correlación Krumhansl-Schmuckler.
 */
export function detectKey(
  pcm: Float32Array,
  sampleRate: number,
  options: KeyDetectorOptions = {}
): KeyDetectionResult {
  const minCorrelation = options.minCorrelation ?? 0.50;
  const minMargin = options.minMargin ?? 0.05;
  const minConfidence = options.minConfidence ?? 0.30;
  const { chroma, isFlatOrSilent } = extractChromaProfile(pcm, sampleRate, options.maxFrames ?? 32);

  if (isFlatOrSilent) {
    return {
      confidence: 0,
      correlation: 0,
      chroma,
      isAmbiguous: true,
    };
  }

  const candidates: KeyCandidate[] = [];

  // Confrontar vector contra los 24 perfiles modales de Krumhansl-Schmuckler
  for (let root = 0; root < 12; root++) {
    // 1. Tonalidad Mayor rotada
    const rotatedMajor = new Array(12);
    for (let i = 0; i < 12; i++) {
      rotatedMajor[i] = KS_MAJOR_PROFILE[(i - root + 12) % 12];
    }
    const corrMajor = pearsonCorrelation(chroma, rotatedMajor);
    const majorInfo = pitchClassToKey(root, 'major');
    candidates.push({
      key: majorInfo.key,
      camelot: majorInfo.camelot,
      mode: 'major',
      rootPitchClass: root,
      correlation: corrMajor,
    });

    // 2. Tonalidad Menor rotada
    const rotatedMinor = new Array(12);
    for (let i = 0; i < 12; i++) {
      rotatedMinor[i] = KS_MINOR_PROFILE[(i - root + 12) % 12];
    }
    const corrMinor = pearsonCorrelation(chroma, rotatedMinor);
    const minorInfo = pitchClassToKey(root, 'minor');
    candidates.push({
      key: minorInfo.key,
      camelot: minorInfo.camelot,
      mode: 'minor',
      rootPitchClass: root,
      correlation: corrMinor,
    });
  }

  // Ordenar candidatos por mayor correlación
  candidates.sort((a, b) => b.correlation - a.correlation);

  const best = candidates[0];
  const second = candidates[1];

  const maxCorr = best.correlation;
  const margin = best.correlation - second.correlation;

  // Criterios de calidad y ambigüedad rigurosos:
  // 1. Correlación mínima para ser musicalmente concluyente: >= 0.50 (el ruido aleatorio puede rondar 0.30-0.45)
  // 2. Margen de separación respecto al segundo candidato: si es menor a 0.05 con correlación moderada, es ambiguo
  const isTooLow = maxCorr < minCorrelation;
  const isNarrowMargin = margin < minMargin && maxCorr < 0.70;

  // Cálculo de confianza normalizado (0.0 a 1.0)
  // Combina la correlación absoluta con el margen discriminante
  let confidence = 0;
  if (!isTooLow) {
    const corrFactor = Math.max(0, (maxCorr - 0.50) / 0.40); // 0 a 1 entre 0.50 y 0.90
    const marginFactor = Math.min(1, margin / 0.15);         // 0 a 1 hasta un margen de 0.15
    confidence = Math.min(1.0, Math.max(0.1, corrFactor * 0.65 + marginFactor * 0.35));
  }

  const isAmbiguous = isTooLow || isNarrowMargin || confidence < minConfidence;

  // Si es estrictamente ambiguo o sin evidencia suficiente, no se presenta como certeza
  if (isAmbiguous) {
    return {
      confidence: 0,
      correlation: Number(maxCorr.toFixed(4)),
      secondCandidate: second,
      chroma,
      isAmbiguous: true,
      // No asignamos key ni camelot cuando es ambiguo/insuficiente
      key: undefined,
      camelot: undefined,
    };
  }

  return {
    key: best.key,
    camelot: best.camelot,
    confidence: Number(confidence.toFixed(3)),
    correlation: Number(maxCorr.toFixed(4)),
    secondCandidate: second,
    chroma,
    isAmbiguous: false,
  };
}
