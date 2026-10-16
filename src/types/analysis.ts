/**
 * SYSTEM DJ — Domain Contracts: Audio Analysis Worker & Service
 * Tipos y contratos para la comunicación entre hilo principal y Web Worker.
 */

import type { TrackAnalysis, AnalysisStatus } from './track.ts';

export interface AudioAnalysisOptions {
  bpmRange?: { min: number; max: number };
  waveformBuckets?: number;
  maxAnalysisDurationSec?: number;
  /**
   * Si es true, transfiere el ArrayBuffer del Float32Array al Worker (Zero-Copy Transferable).
   * ATENCIÓN: El buffer original en el hilo emisor quedará desasociado (detached).
   * Si el hilo principal aún necesita el buffer (ej. para reproducción de audio),
   * debe mantenerse en false (se transferirá una copia clonada).
   */
  transferBuffer?: boolean;
}

// ---------------------------------------------------------------------------
// Mensajes Hilo Principal -> Web Worker (Inbound)
// ---------------------------------------------------------------------------

export interface AnalysisWorkerStartMessage {
  type: 'START_ANALYSIS';
  requestId: string;
  trackId: string;
  pcm: Float32Array;
  sampleRate: number;
  options?: AudioAnalysisOptions;
}

export interface AnalysisWorkerCancelMessage {
  type: 'CANCEL_ANALYSIS';
  requestId: string;
  trackId: string;
}

export type AnalysisWorkerInboundMessage =
  | AnalysisWorkerStartMessage
  | AnalysisWorkerCancelMessage;

// ---------------------------------------------------------------------------
// Mensajes Web Worker -> Hilo Principal (Outbound)
// ---------------------------------------------------------------------------

export interface AnalysisWorkerSuccessMessage {
  type: 'ANALYSIS_COMPLETE';
  requestId: string;
  trackId: string;
  result: TrackAnalysis;
  durationMs: number;
}

export interface AnalysisWorkerErrorMessage {
  type: 'ANALYSIS_ERROR';
  requestId: string;
  trackId: string;
  error: string;
}

export type AnalysisWorkerOutboundMessage =
  | AnalysisWorkerSuccessMessage
  | AnalysisWorkerErrorMessage;

// ---------------------------------------------------------------------------
// Modelos del Servicio de Análisis
// ---------------------------------------------------------------------------

export interface AnalysisQueueItem {
  requestId: string;
  trackId: string;
  pcm: Float32Array;
  sampleRate: number;
  options?: AudioAnalysisOptions;
  status: AnalysisStatus;
  queuedAt: number;
  startedAt?: number;
  completedAt?: number;
  resolve: (result: TrackAnalysis) => void;
  reject: (reason: Error) => void;
}

export interface AnalysisServiceConfig {
  maxConcurrency?: number;       // Número máximo de Workers concurrentes (por defecto 1)
  workerTimeoutMs?: number;      // Tiempo límite antes de considerar un Worker bloqueado (por defecto 30000ms)
}

export interface AnalysisStatusUpdate {
  trackId: string;
  requestId: string;
  status: AnalysisStatus;
  result?: TrackAnalysis;
  error?: string;
}

export type AnalysisStatusListener = (update: AnalysisStatusUpdate) => void;
