/**
 * SYSTEM DJ — Audio Analyzer Orchestrator
 * Función pura desacoplada que coordina el análisis de BPM, Tonalidad (Camelot),
 * Energía Acústica y extracción de picos de forma de onda.
 * Compatible con Web Workers y entornos de testing en Node.js.
 */

import type { TrackAnalysis } from '../../types/track.ts';
import { detectBpm, detectFirstBeatTime, RELAXED_BPM_OPTIONS, type BpmDetectorOptions } from './bpmDetector.ts';
import { detectKey, RELAXED_KEY_OPTIONS } from './keyDetector.ts';
import { calculateEnergy } from './energyCalculator.ts';

export interface AudioAnalysisOptions extends BpmDetectorOptions {
  waveformBuckets?: number;      // Número de picos a extraer para la visualización (por defecto 100)
}

// Resolución de la forma de onda según la duración real: 2 picos por segundo, acotado a [100, 1200]
const WAVEFORM_BUCKETS_PER_SECOND = 2;
const MIN_WAVEFORM_BUCKETS = 100;
const MAX_WAVEFORM_BUCKETS = 1200;

// Duraciones fuera de este rango hacen poco representativa la ventana central de la primera pasada
const TYPICAL_MIN_DURATION_SEC = 30;
const TYPICAL_MAX_DURATION_SEC = 15 * 60;

// Umbral RMS por bloque de ~1 s bajo el cual la señal se considera silencio
const SILENCE_RMS_THRESHOLD = 1e-4;

/**
 * Número de picos de forma de onda proporcional a la duración del audio decodificado.
 */
export function waveformBucketsForDuration(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return MIN_WAVEFORM_BUCKETS;
  const buckets = Math.round(durationSec * WAVEFORM_BUCKETS_PER_SECOND);
  return Math.min(MAX_WAVEFORM_BUCKETS, Math.max(MIN_WAVEFORM_BUCKETS, buckets));
}

/**
 * Extrae picos reales de amplitud (máximo absoluto por bloque, considerando todos los canales)
 * normalizados a 0.0–1.0. Los bloques se reparten con aritmética entera sobre la longitud
 * completa del buffer, de modo que el pico i cubre exactamente [i·D/n, (i+1)·D/n) segundos.
 */
export function extractWaveformPeaks(
  input: Float32Array | readonly Float32Array[],
  numBuckets = 100
): number[] {
  const channels = (Array.isArray(input) ? input : [input]) as readonly Float32Array[];
  const length = channels.length > 0 && channels[0] ? channels[0].length : 0;
  if (length === 0 || numBuckets <= 0) {
    return [];
  }

  const peaks = new Array<number>(numBuckets).fill(0);

  let maxGlobal = 0;

  for (let b = 0; b < numBuckets; b++) {
    const start = Math.floor((b * length) / numBuckets);
    const end = Math.floor(((b + 1) * length) / numBuckets);
    let bucketMax = 0;

    for (const channel of channels) {
      const channelEnd = Math.min(end, channel.length);
      for (let i = start; i < channelEnd; i++) {
        const absVal = Math.abs(channel[i]);
        if (absVal > bucketMax) bucketMax = absVal;
      }
    }

    peaks[b] = bucketMax;
    if (bucketMax > maxGlobal) maxGlobal = bucketMax;
  }

  // Normalización a escala [0.0, 1.0]
  if (maxGlobal > 1e-6) {
    for (let b = 0; b < numBuckets; b++) {
      peaks[b] = Number((peaks[b] / maxGlobal).toFixed(3));
    }
  }

  return peaks;
}

/**
 * Mezcla a mono (promedio) los canales para el análisis rítmico y tonal.
 */
export function downmixChannels(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];

  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (const channel of channels) {
    const len = Math.min(length, channel.length);
    for (let i = 0; i < len; i++) mono[i] += channel[i];
  }
  const scale = 1 / channels.length;
  for (let i = 0; i < length; i++) mono[i] *= scale;
  return mono;
}

/**
 * Verdadero si ningún bloque de ~1 s de la señal supera el umbral RMS audible.
 * Recorre el buffer completo para no confundir una intro en silencio con una pista muda.
 */
function isSignalSilent(pcm: Float32Array, sampleRate: number): boolean {
  const blockSize = Math.max(1, Math.round(sampleRate));
  for (let start = 0; start < pcm.length; start += blockSize) {
    const end = Math.min(pcm.length, start + blockSize);
    let sumSq = 0;
    for (let i = start; i < end; i++) sumSq += pcm[i] * pcm[i];
    if (Math.sqrt(sumSq / (end - start)) >= SILENCE_RMS_THRESHOLD) return false;
  }
  return true;
}

/**
 * Analiza un buffer PCM de audio y devuelve un objeto TrackAnalysis completo (una pasada).
 * `waveformChannels` permite extraer los picos de todos los canales originales.
 */
export function analyzeAudioPcm(
  pcm: Float32Array,
  sampleRate: number,
  options: AudioAnalysisOptions = {},
  waveformChannels: readonly Float32Array[] = [pcm]
): TrackAnalysis {
  try {
    // 1. Verificación de buffer vacío o inválido
    if (!pcm || pcm.length === 0) {
      return {
        status: 'unsupported',
        analysisError: 'Buffer de audio vacío o longitud cero',
      };
    }

    const waveformDurationSec = Number((pcm.length / sampleRate).toFixed(3));

    // 2. Verificación de silencio absoluto o casi absoluto en toda la señal
    if (isSignalSilent(pcm, sampleRate)) {
      return {
        status: 'unsupported',
        energy: 0,
        waveformPeaks: new Array(options.waveformBuckets ?? 100).fill(0),
        waveformDurationSec,
        analysisError: 'Señal en silencio o nivel inferior al umbral mínimo audible',
      };
    }

    // 3. Extracción de picos reales de onda para UI (todos los canales, buffer completo)
    const waveformPeaks = extractWaveformPeaks(waveformChannels, options.waveformBuckets ?? 100);

    // 4. Detección de BPM y primer transitorio rítmico
    const bpmResult = detectBpm(pcm, sampleRate, options);
    const firstBeatTime = detectFirstBeatTime(pcm, sampleRate);

    // 5. Detección de Tonalidad y Camelot
    const keyResult = detectKey(pcm, sampleRate);

    // 6. Cálculo de Energía Acústica (0..10)
    const energyResult = calculateEnergy(pcm, sampleRate);

    // 7. Evaluación de viabilidad musical del resultado
    const hasBpm = typeof bpmResult.bpm === 'number' && !bpmResult.isAmbiguous;
    const hasKey = typeof keyResult.key === 'string' && !keyResult.isAmbiguous;

    // Si no se pudo determinar ni ritmo ni clave tonal concluyente
    if (!hasBpm && !hasKey) {
      return {
        status: 'unsupported',
        energy: energyResult.energy,
        waveformPeaks,
        waveformDurationSec,
        bpmConfidence: bpmResult.confidence,
        isAmbiguous: bpmResult.isAmbiguous,
        keyConfidence: keyResult.confidence,
        firstBeatTime: null,
        analysisError: 'Audio no musical o sin estructura rítmica y armónica suficiente para análisis determinista',
      };
    }

    return {
      status: 'analyzed',
      bpm: hasBpm ? bpmResult.bpm : undefined,
      key: hasKey ? keyResult.key : undefined,
      camelot: hasKey ? keyResult.camelot : undefined,
      energy: energyResult.energy,
      waveformPeaks,
      waveformDurationSec,
      bpmConfidence: bpmResult.confidence,
      isAmbiguous: bpmResult.isAmbiguous,
      alternateBpm: bpmResult.alternateBpm,
      keyConfidence: keyResult.confidence,
      firstBeatTime: hasBpm ? firstBeatTime : null,
    };
  } catch (err) {
    return {
      status: 'failed',
      analysisError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Indica si el resultado de la primera pasada requiere la pasada permisiva:
 * falta BPM, tonalidad o energía, el estado no es concluyente, o la duración es atípica
 * (la ventana central de 30 s no es representativa de la pista).
 */
export function needsSecondAnalysisPass(first: TrackAnalysis, durationSec: number): boolean {
  if (first.status !== 'analyzed') return true;
  if (typeof first.bpm !== 'number' || first.bpm <= 0) return true;
  if (typeof first.camelot !== 'string') return true;
  if (typeof first.energy !== 'number') return true;
  return durationSec < TYPICAL_MIN_DURATION_SEC || durationSec > TYPICAL_MAX_DURATION_SEC;
}

/**
 * Análisis completo en doble pasada.
 * 1ª pasada: algoritmo estándar sobre la mezcla mono.
 * 2ª pasada (solo si needsSecondAnalysisPass): autocorrelación de la curva de novedad sobre
 * una ventana de 120 s con umbrales relajados y croma con 128 ventanas FFT y criterios K-S
 * relajados. Para BPM y tonalidad se conserva el candidato de mayor confianza (empate: 1ª pasada).
 */
export function analyzeAudioChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: AudioAnalysisOptions = {}
): TrackAnalysis {
  const pcm = downmixChannels(channels);
  const first = analyzeAudioPcm(pcm, sampleRate, options, channels);

  const durationSec = pcm.length / sampleRate;
  if (first.status === 'failed' || !needsSecondAnalysisPass(first, durationSec)) {
    return { ...first, analysisPasses: 1 };
  }
  // Silencio en toda la señal: una segunda pasada no puede aportar evidencia
  if (!pcm.length || isSignalSilent(pcm, sampleRate)) {
    return { ...first, analysisPasses: 1 };
  }

  try {
    const relaxedBpm = detectBpm(pcm, sampleRate, { ...options, ...RELAXED_BPM_OPTIONS });
    const relaxedKey = detectKey(pcm, sampleRate, RELAXED_KEY_OPTIONS);

    const merged: TrackAnalysis = { ...first, analysisPasses: 2 };

    const firstHasBpm = typeof first.bpm === 'number';
    const relaxedHasBpm = typeof relaxedBpm.bpm === 'number' && !relaxedBpm.isAmbiguous;
    if (relaxedHasBpm && (!firstHasBpm || relaxedBpm.confidence > (first.bpmConfidence ?? 0))) {
      merged.bpm = relaxedBpm.bpm;
      merged.bpmConfidence = relaxedBpm.confidence;
      merged.isAmbiguous = false;
      merged.alternateBpm = relaxedBpm.alternateBpm;
      merged.firstBeatTime = firstHasBpm ? first.firstBeatTime : detectFirstBeatTime(pcm, sampleRate);
    }

    const firstHasKey = typeof first.camelot === 'string';
    const relaxedHasKey = typeof relaxedKey.camelot === 'string' && !relaxedKey.isAmbiguous;
    if (relaxedHasKey && (!firstHasKey || relaxedKey.confidence > (first.keyConfidence ?? 0))) {
      merged.key = relaxedKey.key;
      merged.camelot = relaxedKey.camelot;
      merged.keyConfidence = relaxedKey.confidence;
    }

    if (typeof merged.energy !== 'number') {
      merged.energy = calculateEnergy(pcm, sampleRate).energy;
    }

    if (typeof merged.bpm === 'number' || typeof merged.camelot === 'string') {
      merged.status = 'analyzed';
      delete merged.analysisError;
    }

    return merged;
  } catch {
    // La segunda pasada es un refuerzo: si falla, se conserva la primera sin alterarla
    return { ...first, analysisPasses: 1 };
  }
}
