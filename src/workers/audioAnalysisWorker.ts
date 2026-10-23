/**
 * SYSTEM DJ — Audio Analysis Web Worker (ESM)
 * Ejecuta el pipeline matemático puro de análisis musical en un hilo aislado.
 * Compatible con Vite ESM Worker bundle.
 */

import { analyzeAudioChannels } from '../audio/analysis/index.ts';
import type {
  AnalysisWorkerInboundMessage,
  AnalysisWorkerOutboundMessage,
} from '../types/analysis.ts';

// Contexto tipado para el Web Worker compatible con la librería DOM estándar de TypeScript
interface DedicatedWorkerContext {
  onmessage: ((event: MessageEvent<AnalysisWorkerInboundMessage>) => void) | null;
  postMessage: (message: AnalysisWorkerOutboundMessage, transfer?: Transferable[]) => void;
}

const workerCtx = (typeof self !== 'undefined' ? self : globalThis) as unknown as DedicatedWorkerContext;

let activeRequestId: string | null = null;

workerCtx.onmessage = (event: MessageEvent<AnalysisWorkerInboundMessage>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'CANCEL_ANALYSIS') {
    if (activeRequestId === msg.requestId) {
      activeRequestId = null;
    }
    return;
  }

  if (msg.type === 'START_ANALYSIS') {
    activeRequestId = msg.requestId;
    const startTime = performance.now();

    try {
      // Pipeline matemático puro en doble pasada sobre todos los canales decodificados
      const channels = [msg.pcm, ...(msg.extraChannels ?? [])];
      const result = analyzeAudioChannels(channels, msg.sampleRate, msg.options);

      // Si la solicitud fue cancelada durante el procesamiento, descartar resultado
      if (activeRequestId !== msg.requestId) {
        return;
      }

      const durationMs = performance.now() - startTime;
      const successResponse: AnalysisWorkerOutboundMessage = {
        type: 'ANALYSIS_COMPLETE',
        requestId: msg.requestId,
        trackId: msg.trackId,
        result,
        durationMs: Number(durationMs.toFixed(1)),
      };

      workerCtx.postMessage(successResponse);
    } catch (err) {
      if (activeRequestId !== msg.requestId) {
        return;
      }

      const errorResponse: AnalysisWorkerOutboundMessage = {
        type: 'ANALYSIS_ERROR',
        requestId: msg.requestId,
        trackId: msg.trackId,
        error: err instanceof Error ? err.message : String(err),
      };

      workerCtx.postMessage(errorResponse);
    } finally {
      if (activeRequestId === msg.requestId) {
        activeRequestId = null;
      }
    }
  }
};
