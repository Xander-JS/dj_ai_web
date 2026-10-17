/**
 * SYSTEM DJ — Audio Analyzer Orchestrator
 * Función pura desacoplada que coordina el análisis de BPM, Tonalidad (Camelot),
 * Energía Acústica y extracción de picos de forma de onda.
 * Compatible con Web Workers y entornos de testing en Node.js.
 */

import type { TrackAnalysis } from '../../types/track.ts';
import { detectBpm, detectFirstBeatTime, type BpmDetectorOptions } from './bpmDetector.ts';
import { detectKey } from './keyDetector.ts';
import { calculateEnergy } from './energyCalculator.ts';

export interface AudioAnalysisOptions extends BpmDetectorOptions {
  waveformBuckets?: number;      // Número de picos a extraer para la visualización (por defecto 100)
}

/**
 * Extrae una representación reducida y normalizada (0.0 a 1.0) de picos de amplitud
 * para renderizado instantáneo de forma de onda sin sobrecargar la memoria.
 */
export function extractWaveformPeaks(
  pcm: Float32Array,
  numBuckets = 100
): number[] {
  if (!pcm || pcm.length === 0 || numBuckets <= 0) {
    return [];
  }

  const peaks = new Array<number>(numBuckets).fill(0);
  const bucketSize = pcm.length / numBuckets;

  let maxGlobal = 0;

  for (let b = 0; b < numBuckets; b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(pcm.length, Math.floor((b + 1) * bucketSize));
    let bucketMax = 0;

    for (let i = start; i < end; i++) {
      const absVal = Math.abs(pcm[i]);
      if (absVal > bucketMax) bucketMax = absVal;
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
 * Analiza un buffer PCM de audio y devuelve un objeto TrackAnalysis completo.
 */
export function analyzeAudioPcm(
  pcm: Float32Array,
  sampleRate: number,
  options: AudioAnalysisOptions = {}
): TrackAnalysis {
  try {
    // 1. Verificación de buffer vacío o inválido
    if (!pcm || pcm.length === 0) {
      return {
        status: 'unsupported',
        analysisError: 'Buffer de audio vacío o longitud cero',
      };
    }

    // 2. Verificación de silencio absoluto o casi absoluto
    let sumSq = 0;
    const checkLen = Math.min(pcm.length, 48000);
    for (let i = 0; i < checkLen; i++) {
      sumSq += pcm[i] * pcm[i];
    }
    const preliminaryRms = Math.sqrt(sumSq / checkLen);

    if (preliminaryRms < 1e-4) {
      return {
        status: 'unsupported',
        energy: 0,
        waveformPeaks: new Array(options.waveformBuckets ?? 100).fill(0),
        analysisError: 'Señal en silencio o nivel inferior al umbral mínimo audible',
      };
    }

    // 3. Extracción de picos de onda para UI
    const waveformPeaks = extractWaveformPeaks(pcm, options.waveformBuckets ?? 100);

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
        bpmConfidence: bpmResult.confidence,
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
      bpmConfidence: bpmResult.confidence,
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
