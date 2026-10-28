/**
 * SYSTEM DJ — Picos de alta resolución de la forma de onda ampliada
 * Se calculan al cargar una pista en un deck, a partir del audio ya decodificado y en un Web
 * Worker, sin depender del análisis musical. Se guardan en IndexedDB ligados a la huella SHA-256
 * y a la versión del formato; una carga posterior los lee de ahí en lugar de recalcularlos.
 */

import { indexedDBStorage } from '../storage/IndexedDBStorage.ts';
import type { WaveformPeaksRequest, WaveformPeaksResponse } from '../../workers/waveformPeaksWorker.ts';

export const WAVEFORM_DETAIL_PEAKS_PER_SECOND = 150;
/** Cambiarla invalida todos los picos guardados (se recalculan al cargar). */
export const WAVEFORM_DETAIL_FORMAT_VERSION = 1;
/** Pistas recientes que se conservan en memoria (los dos decks y alguna de reserva). */
const MEMORY_LIMIT = 4;

/** Picos 0–255 (8 bits) repartidos uniformemente sobre `durationSec` segundos de audio. */
export interface WaveformDetail {
  peaks: Uint8Array;
  durationSec: number;
}

const memory = new Map<string, WaveformDetail>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

export const waveformDetailKey = (trackId: string, contentHash: string | undefined) => `${trackId}:${contentHash ?? ''}`;

export function getWaveformDetail(key: string): WaveformDetail | undefined {
  return memory.get(key);
}

/** Avisa cuando llegan los picos de alguna pista. */
export function subscribeWaveformDetail(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function remember(key: string, detail: WaveformDetail): void {
  memory.delete(key);
  memory.set(key, detail);
  while (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
  for (const listener of listeners) listener();
}

function computeInWorker(buffer: AudioBuffer): Promise<Uint8Array> {
  const channels: Float32Array[] = [];
  // Copias: transferir los datos del AudioBuffer los dejaría inservibles para la reproducción
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) channels.push(buffer.getChannelData(channel).slice());
  const request: WaveformPeaksRequest = {
    channels,
    buckets: Math.max(1, Math.round(buffer.duration * WAVEFORM_DETAIL_PEAKS_PER_SECOND)),
  };

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/waveformPeaksWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WaveformPeaksResponse>) => {
      worker.terminate();
      if ('peaks' in event.data) resolve(event.data.peaks);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(request, channels.map((channel) => channel.buffer));
  });
}

/**
 * Deja disponibles los picos de alta resolución de la pista: memoria, IndexedDB o Worker, en
 * ese orden. Si la misma pista se carga en ambos decks, se calculan una sola vez.
 * Sin huella SHA-256 no se guardan (no habría con qué validarlos en la próxima carga).
 */
export function ensureWaveformDetail(trackId: string, contentHash: string | undefined, buffer: AudioBuffer): Promise<void> {
  const key = waveformDetailKey(trackId, contentHash);
  // Sin Web Workers (p. ej. pruebas en Node) la pantalla usa los picos del análisis
  if (memory.has(key) || typeof Worker === 'undefined') return Promise.resolve();
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const job = (async () => {
    const stored = contentHash ? await indexedDBStorage.getWaveformPeaks(trackId) : null;
    if (stored && stored.contentHash === contentHash && stored.formatVersion === WAVEFORM_DETAIL_FORMAT_VERSION) {
      remember(key, { peaks: stored.peaks, durationSec: stored.durationSec });
      return;
    }
    const detail = { peaks: await computeInWorker(buffer), durationSec: buffer.duration };
    remember(key, detail);
    if (contentHash) {
      await indexedDBStorage.saveWaveformPeaks({ trackId, contentHash, formatVersion: WAVEFORM_DETAIL_FORMAT_VERSION, ...detail });
    }
  })()
    // Sin picos de alta resolución la pantalla sigue con los del análisis: no es un error de carga
    .catch((err) => console.warn('[waveformDetail] No se pudieron obtener los picos de alta resolución:', err))
    .finally(() => pending.delete(key));

  pending.set(key, job);
  return job;
}
