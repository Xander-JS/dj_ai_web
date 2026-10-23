/**
 * SYSTEM DJ — Analysis Orchestrator Service
 * Gestiona la cola de análisis, concurrencia limitada, cancelación, protección contra
 * resultados obsoletos y recuperación ante fallos de Web Workers sin bloquear el hilo principal.
 */

import type {
  TrackAnalysis,
} from '../../types/track.ts';
import { normalizeTrackAnalysis } from '../../utils/trackAnalysis.ts';

import type {
  AudioAnalysisOptions,
  AnalysisQueueItem,
  AnalysisServiceConfig,
  AnalysisStatusListener,
  AnalysisStatusUpdate,
  AnalysisWorkerInboundMessage,
  AnalysisWorkerOutboundMessage,
} from '../../types/analysis.ts';

/**
 * Abstracción de interfaz para Web Worker que permite inyección de dependencias
 * y pruebas unitarias aisladas en entornos Node.js y navegadores.
 */
export interface IAnalysisWorker {
  postMessage(message: AnalysisWorkerInboundMessage, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<AnalysisWorkerOutboundMessage>) => void) | null;
  onerror: ((event: ErrorEvent | Error) => void) | null;
}

export type WorkerFactory = () => IAnalysisWorker;

/**
 * Factoría estándar para navegadores basada en Vite ESM Workers.
 */
export const defaultBrowserWorkerFactory: WorkerFactory = () => {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers no están disponibles en este entorno de ejecución');
  }
  return new Worker(
    new URL('../../workers/audioAnalysisWorker.ts', import.meta.url),
    { type: 'module' }
  ) as unknown as IAnalysisWorker;
};

interface ActiveTaskRecord {
  item: AnalysisQueueItem;
  worker: IAnalysisWorker;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export class AnalysisService {
  private maxConcurrency: number;
  private workerTimeoutMs: number;
  private workerFactory: WorkerFactory;

  private queue: AnalysisQueueItem[] = [];
  private activeTasks: Map<string, ActiveTaskRecord> = new Map(); // requestId -> ActiveTaskRecord
  private trackToLatestRequestId: Map<string, string> = new Map(); // trackId -> latest requestId
  private cancelledRequestIds: Set<string> = new Set();
  private listeners: Set<AnalysisStatusListener> = new Set();
  private isDestroyed = false;

  constructor(
    config: AnalysisServiceConfig = {},
    workerFactory: WorkerFactory = defaultBrowserWorkerFactory
  ) {
    this.maxConcurrency = Math.max(1, config.maxConcurrency ?? 1);
    this.workerTimeoutMs = config.workerTimeoutMs ?? 30000;
    this.workerFactory = workerFactory;
  }

  /**
   * Encola una pista para análisis de audio asíncrono.
   * Si ya existe un análisis en curso o encolado para el mismo trackId,
   * se cancela y se sustituye por la nueva solicitud (protección de resultados obsoletos).
   */
  public queueAnalysis(
    trackId: string,
    pcm: Float32Array,
    sampleRate: number,
    options: AudioAnalysisOptions = {}
  ): Promise<TrackAnalysis> {
    if (this.isDestroyed) {
      return Promise.reject(new Error('AnalysisService ha sido destruido'));
    }

    // Cancelar cualquier análisis previo pendiente o en curso para este mismo track
    if (this.trackToLatestRequestId.has(trackId)) {
      this.cancelAnalysis(trackId);
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.trackToLatestRequestId.set(trackId, requestId);

    return new Promise<TrackAnalysis>((resolve, reject) => {
      const queueItem: AnalysisQueueItem = {
        requestId,
        trackId,
        pcm,
        sampleRate,
        options,
        status: 'pending',
        queuedAt: Date.now(),
        resolve,
        reject,
      };

      this.queue.push(queueItem);
      this.notifyListeners({
        trackId,
        requestId,
        status: 'pending',
      });

      this.processQueue();
    });
  }

  /**
   * Cancela una solicitud de análisis por trackId, ya sea que esté pendiente en cola o activa en Worker.
   */
  public cancelAnalysis(trackId: string): boolean {
    const targetRequestId = this.trackToLatestRequestId.get(trackId);
    if (!targetRequestId) {
      return false;
    }

    this.cancelledRequestIds.add(targetRequestId);
    this.trackToLatestRequestId.delete(trackId);

    // 1. Caso: Está pendiente en la cola
    const queueIndex = this.queue.findIndex(item => item.requestId === targetRequestId);
    if (queueIndex !== -1) {
      const [removed] = this.queue.splice(queueIndex, 1);
      removed.status = 'unsupported';
      removed.reject(new Error(`Análisis cancelado para pista ${trackId}`));
      this.notifyListeners({
        trackId,
        requestId: targetRequestId,
        status: 'unsupported',
        error: 'Análisis cancelado antes de iniciar',
      });
      return true;
    }

    // 2. Caso: Está activamente ejecutándose en un Worker
    const active = this.activeTasks.get(targetRequestId);
    if (active) {
      if (active.timeoutId) clearTimeout(active.timeoutId);

      try {
        // Enviar mensaje de cancelación al Worker
        active.worker.postMessage({
          type: 'CANCEL_ANALYSIS',
          requestId: targetRequestId,
          trackId,
        });
      } catch {
        // Ignorar si el worker ya no acepta mensajes
      }

      // Terminar el worker para liberar la ranura inmediatamente
      try {
        active.worker.terminate();
      } catch {
        // Ignorar errores de terminación
      }

      this.activeTasks.delete(targetRequestId);
      active.item.reject(new Error(`Análisis cancelado en ejecución para pista ${trackId}`));
      this.notifyListeners({
        trackId,
        requestId: targetRequestId,
        status: 'unsupported',
        error: 'Análisis cancelado durante la ejecución',
      });

      // Procesar el siguiente elemento de la cola para no dejar el slot ocioso
      this.processQueue();
      return true;
    }

    return false;
  }

  /**
   * Indica si una pista específica está en proceso de análisis o encolada.
   */
  public isAnalyzing(trackId: string): boolean {
    return this.trackToLatestRequestId.has(trackId);
  }

  /**
   * Obtiene la cantidad de solicitudes actualmente encoladas en espera.
   */
  public getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Obtiene la cantidad de Workers ejecutándose activamente en paralelo.
   */
  public getActiveCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Suscripción a eventos de ciclo de vida del análisis musical.
   */
  public subscribe(listener: AnalysisStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Procesa los elementos de la cola respetando el límite estricto de concurrencia.
   */
  private processQueue(): void {
    if (this.isDestroyed) return;

    while (this.activeTasks.size < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      // Si la solicitud fue cancelada mientras esperaba en cola, saltar
      if (this.cancelledRequestIds.has(item.requestId)) {
        continue;
      }

      // Si fue superada por una solicitud más reciente del mismo track, ignorar
      if (this.trackToLatestRequestId.get(item.trackId) !== item.requestId) {
        item.reject(new Error('Solicitud obsoleta reemplazada por un análisis más reciente'));
        continue;
      }

      this.dispatchItemToWorker(item);
    }
  }

  /**
   * Despacha una tarea individual a una instancia de Web Worker.
   */
  private dispatchItemToWorker(item: AnalysisQueueItem): void {
    item.status = 'analyzing';
    item.startedAt = Date.now();

    let worker: IAnalysisWorker;
    try {
      worker = this.workerFactory();
    } catch (err) {
      // Fallo de instanciación del Worker: no dejar la pista en 'analyzing'
      this.handleTaskFailure(item, `Error al inicializar Web Worker: ${err instanceof Error ? err.message : String(err)}`);
      this.processQueue();
      return;
    }

    const taskRecord: ActiveTaskRecord = {
      item,
      worker,
    };
    this.activeTasks.set(item.requestId, taskRecord);

    this.notifyListeners({
      trackId: item.trackId,
      requestId: item.requestId,
      status: 'analyzing',
    });

    // Timeout de seguridad para evitar que un Worker trabado bloquee la cola
    taskRecord.timeoutId = setTimeout(() => {
      if (this.activeTasks.has(item.requestId)) {
        try {
          worker.terminate();
        } catch {
          // Ignorar
        }
        this.activeTasks.delete(item.requestId);
        this.handleTaskFailure(item, `Tiempo de análisis excedido (${this.workerTimeoutMs} ms)`);
        this.processQueue();
      }
    }, this.workerTimeoutMs);

    // Configurar listener de respuestas
    worker.onmessage = (event: MessageEvent<AnalysisWorkerOutboundMessage>) => {
      const msg = event.data;
      if (!msg) return;

      // 1. Si la tarea ya no está activa (fue cancelada, expiró por timeout o ya finalizó),
      // descartar cualquier mensaje residual tardío sin alterar tareas posteriores.
      if (!this.activeTasks.has(item.requestId)) {
        return;
      }

      // 2. Si el mensaje corresponde a una solicitud que fue cancelada previamente,
      // descartarlo como mensaje tardío obsoleto sin afectar la tarea activa actual.
      if (this.cancelledRequestIds.has(msg.requestId)) {
        return;
      }

      // 3. Rechazo explícito si el resultado del Worker pertenece a otra pista (Requisito 7.6)
      if (msg.trackId !== item.trackId) {
        this.cleanupActiveTask(item.requestId, worker);
        this.handleTaskFailure(item, `Resultado de Worker rechazado: trackId "${msg.trackId}" no coincide con "${item.trackId}"`);
        this.processQueue();
        return;
      }

      // 4. Si el mensaje trae un requestId que no coincide con la tarea activa actual
      if (msg.requestId !== item.requestId) {
        this.cleanupActiveTask(item.requestId, worker);
        this.handleTaskFailure(item, `Resultado de Worker rechazado: requestId "${msg.requestId}" no coincide con la tarea activa "${item.requestId}"`);
        this.processQueue();
        return;
      }

      // 5. Si la tarea fue superada por una solicitud más reciente del mismo trackId
      if (this.trackToLatestRequestId.get(item.trackId) !== item.requestId) {
        this.cleanupActiveTask(item.requestId, worker);
        this.handleTaskFailure(item, 'Solicitud obsoleta reemplazada por un análisis más reciente');
        this.processQueue();
        return;
      }

      this.cleanupActiveTask(item.requestId, worker);

      if (msg.type === 'ANALYSIS_COMPLETE') {
        const result = normalizeTrackAnalysis(msg.result);
        item.status = result.status;
        item.completedAt = Date.now();
        this.trackToLatestRequestId.delete(item.trackId);

        this.notifyListeners({
          trackId: item.trackId,
          requestId: item.requestId,
          status: result.status,
          result,
        });

        item.resolve(result);
      } else if (msg.type === 'ANALYSIS_ERROR') {
        this.handleTaskFailure(item, msg.error);
      }

      this.processQueue();
    };

    // Configurar listener de errores no controlados del Worker
    worker.onerror = (event: ErrorEvent | Error) => {
      this.cleanupActiveTask(item.requestId, worker);
      const errorMessage = event instanceof Error ? event.message : (event?.message || 'Fallo inesperado en Web Worker');
      this.handleTaskFailure(item, errorMessage);
      this.processQueue();
    };

    // Política de transferencia Transferable:
    // Si options.transferBuffer === true, se transfiere pcm.buffer con zero-copy (desasocia pcm en el hilo emisor).
    // Si options.transferBuffer !== true, se clona una copia para transferir el clon sin desasociar el pcm original.
    try {
      // Detección preventiva de buffer desasociado o inválido
      if ((item.pcm.buffer as { detached?: boolean }).detached === true) {
        throw new Error('El buffer de audio está desasociado (detached ArrayBuffer)');
      }

      let bufferToTransfer: ArrayBuffer;
      let pcmToSend: Float32Array;

      if (item.options?.transferBuffer) {
        pcmToSend = item.pcm;
        bufferToTransfer = item.pcm.buffer as ArrayBuffer;
      } else {
        const clone = item.pcm.slice();
        pcmToSend = clone;
        bufferToTransfer = clone.buffer as ArrayBuffer;
      }

      worker.postMessage(
        {
          type: 'START_ANALYSIS',
          requestId: item.requestId,
          trackId: item.trackId,
          pcm: pcmToSend,
          sampleRate: item.sampleRate,
          options: item.options,
        },
        [bufferToTransfer]
      );
    } catch (err) {
      this.cleanupActiveTask(item.requestId, worker);
      this.handleTaskFailure(item, `Error al transferir buffer al Worker: ${err instanceof Error ? err.message : String(err)}`);
      this.processQueue();
    }
  }

  private handleTaskFailure(item: AnalysisQueueItem, errorMessage: string): void {
    item.status = 'failed';
    this.trackToLatestRequestId.delete(item.trackId);

    const errorResult: TrackAnalysis = {
      status: 'failed',
      analysisError: errorMessage,
    };

    this.notifyListeners({
      trackId: item.trackId,
      requestId: item.requestId,
      status: 'failed',
      error: errorMessage,
      result: errorResult,
    });

    item.reject(new Error(errorMessage));
  }

  private cleanupActiveTask(requestId: string, worker: IAnalysisWorker): void {
    const active = this.activeTasks.get(requestId);
    if (active?.timeoutId) {
      clearTimeout(active.timeoutId);
    }
    this.activeTasks.delete(requestId);

    try {
      worker.terminate();
    } catch {
      // Ignorar errores de terminación
    }
  }

  private notifyListeners(update: AnalysisStatusUpdate): void {
    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch {
        // Prevenir que errores en un suscriptor detengan el despachador
      }
    }
  }

  /**
   * Libera todos los recursos, cancela solicitudes activas y pendientes, y termina Workers.
   */
  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // Rechazar tareas en cola
    for (const item of this.queue) {
      item.status = 'unsupported';
      item.reject(new Error('AnalysisService destruido'));
    }
    this.queue = [];

    // Terminar workers activos
    for (const [requestId, active] of this.activeTasks) {
      if (active.timeoutId) clearTimeout(active.timeoutId);
      try {
        active.worker.terminate();
      } catch {
        // Ignorar
      }
      active.item.status = 'unsupported';
      active.item.reject(new Error('AnalysisService destruido'));
      this.cancelledRequestIds.add(requestId);
    }
    this.activeTasks.clear();
    this.trackToLatestRequestId.clear();
    this.cancelledRequestIds.clear();
    this.listeners.clear();
  }
}

// Instancia singleton por defecto para la aplicación
export const analysisService = new AnalysisService();
