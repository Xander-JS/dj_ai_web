/**
 * SYSTEM DJ — Waveform Peaks Web Worker (ESM)
 * Extrae los picos de alta resolución de la forma de onda ampliada fuera del hilo principal,
 * con el mismo método que el análisis (extractWaveformPeaks) y cuantizados a 8 bits.
 */

import { extractWaveformPeaks } from '../audio/analysis/audioAnalyzer.ts';

export interface WaveformPeaksRequest {
  channels: Float32Array[];
  buckets: number;
}

export type WaveformPeaksResponse = { peaks: Uint8Array } | { error: string };

interface DedicatedWorkerContext {
  onmessage: ((event: MessageEvent<WaveformPeaksRequest>) => void) | null;
  postMessage: (message: WaveformPeaksResponse, transfer?: Transferable[]) => void;
}

const workerCtx = (typeof self !== 'undefined' ? self : globalThis) as unknown as DedicatedWorkerContext;

workerCtx.onmessage = (event) => {
  try {
    const normalized = extractWaveformPeaks(event.data.channels, event.data.buckets);
    const peaks = Uint8Array.from(normalized, (peak) => Math.round(Math.max(0, Math.min(1, peak)) * 255));
    workerCtx.postMessage({ peaks }, [peaks.buffer]);
  } catch (err) {
    workerCtx.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
