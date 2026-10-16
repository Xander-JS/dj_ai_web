/**
 * SYSTEM DJ — Test Suite: Servicio Orquestador de Análisis y Web Worker (Fase 22 - Etapa 2)
 *
 * NOTA TÉCNICA DE ENTORNO:
 * Node.js (ejecutor de pruebas nativo `node:test`) no implementa la interfaz DOM `Worker` del navegador.
 * Estas pruebas utilizan un adaptador de Worker simulado (`SimulatedAnalysisWorker`) inyectado mediante
 * la abstracción `WorkerFactory` de AnalysisService. Esto permite verificar de forma determinista la cola,
 * concurrencia, cancelación, errores de Worker, descarte de resultados obsoletos y recuperación ante fallos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AnalysisService,
  type IAnalysisWorker,
  type WorkerFactory,
} from '../src/services/analysis/AnalysisService.ts';

import { analyzeAudioPcm } from '../src/audio/analysis/index.ts';

import type {
  AnalysisWorkerInboundMessage,
  AnalysisWorkerOutboundMessage,
  AnalysisStatusUpdate,
} from '../src/types/analysis.ts';

/**
 * Adaptador de Worker simulado para pruebas en entorno headless de Node.js.
 */
class SimulatedAnalysisWorker implements IAnalysisWorker {
  public onmessage: ((event: MessageEvent<AnalysisWorkerOutboundMessage>) => void) | null = null;
  public onerror: ((event: ErrorEvent | Error) => void) | null = null;
  public isTerminated = false;
  public receivedMessages: AnalysisWorkerInboundMessage[] = [];

  private delayMs: number;
  private shouldFailWithError: string | null;
  private timerId: NodeJS.Timeout | null = null;
  private activeRequestId: string | null = null;

  constructor(delayMs = 15, shouldFailWithError: string | null = null) {
    this.delayMs = delayMs;
    this.shouldFailWithError = shouldFailWithError;
  }

  public postMessage(message: AnalysisWorkerInboundMessage): void {
    if (this.isTerminated) return;
    this.receivedMessages.push(message);

    if (message.type === 'CANCEL_ANALYSIS') {
      if (this.activeRequestId === message.requestId) {
        if (this.timerId) clearTimeout(this.timerId);
        this.activeRequestId = null;
      }
      return;
    }

    if (message.type === 'START_ANALYSIS') {
      this.activeRequestId = message.requestId;

      if (this.shouldFailWithError) {
        this.timerId = setTimeout(() => {
          if (this.isTerminated || this.activeRequestId !== message.requestId) return;
          if (this.onerror) {
            this.onerror(new Error(this.shouldFailWithError!));
          }
        }, this.delayMs);
        return;
      }

      this.timerId = setTimeout(() => {
        if (this.isTerminated || this.activeRequestId !== message.requestId) return;

        try {
          const result = analyzeAudioPcm(message.pcm, message.sampleRate, message.options);
          const response: AnalysisWorkerOutboundMessage = {
            type: 'ANALYSIS_COMPLETE',
            requestId: message.requestId,
            trackId: message.trackId,
            result,
            durationMs: 12.5,
          };

          if (this.onmessage) {
            this.onmessage({ data: response } as MessageEvent<AnalysisWorkerOutboundMessage>);
          }
        } catch (err) {
          if (this.isTerminated || this.activeRequestId !== message.requestId) return;
          const errorResponse: AnalysisWorkerOutboundMessage = {
            type: 'ANALYSIS_ERROR',
            requestId: message.requestId,
            trackId: message.trackId,
            error: err instanceof Error ? err.message : String(err),
          };
          if (this.onmessage) {
            this.onmessage({ data: errorResponse } as MessageEvent<AnalysisWorkerOutboundMessage>);
          }
        }
      }, this.delayMs);
    }
  }

  public terminate(): void {
    this.isTerminated = true;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

// Utilidad para crear PCM sintético breve
function createDummyPcm(durationSec = 1.0, sampleRate = 44100): Float32Array {
  const pcm = new Float32Array(Math.floor(durationSec * sampleRate));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = 0.3 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
  }
  return pcm;
}

// ============================================================================
// SUITE: ANALYSIS SERVICE & WORKER ORCHESTRATOR
// ============================================================================
describe('Fase 22 — Etapa 2: AnalysisService y Orquestador de Cola', () => {
  const sampleRate = 44100;

  it('2.1 Respeta estrictamente el límite de concurrencia configurado (maxConcurrency = 1)', async () => {
    let activeWorkersCount = 0;
    let maxObservedWorkers = 0;

    const customFactory: WorkerFactory = () => {
      activeWorkersCount++;
      if (activeWorkersCount > maxObservedWorkers) {
        maxObservedWorkers = activeWorkersCount;
      }
      const worker = new SimulatedAnalysisWorker(30);
      const originalTerm = worker.terminate.bind(worker);
      worker.terminate = () => {
        activeWorkersCount--;
        originalTerm();
      };
      return worker;
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, customFactory);
    const pcm1 = createDummyPcm(1, sampleRate);
    const pcm2 = createDummyPcm(1, sampleRate);
    const pcm3 = createDummyPcm(1, sampleRate);

    // Encolar 3 pistas simultáneamente
    const p1 = service.queueAnalysis('track_1', pcm1, sampleRate);
    const p2 = service.queueAnalysis('track_2', pcm2, sampleRate);
    const p3 = service.queueAnalysis('track_3', pcm3, sampleRate);

    // En el instante inicial: 1 activa, 2 en cola
    assert.equal(service.getActiveCount(), 1);
    assert.equal(service.getQueueLength(), 2);

    await Promise.all([p1, p2, p3]);

    // Concurrencia máxima observada nunca debe superar 1
    assert.equal(maxObservedWorkers, 1);
    assert.equal(service.getActiveCount(), 0);
    assert.equal(service.getQueueLength(), 0);

    service.destroy();
  });

  it('2.2 Procesa múltiples solicitudes concurrentes con maxConcurrency = 2', async () => {
    let maxObservedWorkers = 0;
    let currentWorkers = 0;

    const customFactory: WorkerFactory = () => {
      currentWorkers++;
      if (currentWorkers > maxObservedWorkers) maxObservedWorkers = currentWorkers;
      const worker = new SimulatedAnalysisWorker(20);
      const originalTerm = worker.terminate.bind(worker);
      worker.terminate = () => {
        currentWorkers--;
        originalTerm();
      };
      return worker;
    };

    const service = new AnalysisService({ maxConcurrency: 2 }, customFactory);
    const pcm = createDummyPcm(1, sampleRate);

    const promises = [
      service.queueAnalysis('t1', pcm, sampleRate),
      service.queueAnalysis('t2', pcm, sampleRate),
      service.queueAnalysis('t3', pcm, sampleRate),
      service.queueAnalysis('t4', pcm, sampleRate),
    ];

    assert.equal(service.getActiveCount(), 2);
    assert.equal(service.getQueueLength(), 2);

    const results = await Promise.all(promises);

    assert.equal(results.length, 4);
    assert.equal(maxObservedWorkers, 2);
    assert.equal(service.getActiveCount(), 0);

    service.destroy();
  });

  it('2.3 Cancela solicitudes pendientes en cola antes de su ejecución', async () => {
    const factory: WorkerFactory = () => new SimulatedAnalysisWorker(50);
    const service = new AnalysisService({ maxConcurrency: 1 }, factory);
    const pcm = createDummyPcm(1, sampleRate);

    const p1 = service.queueAnalysis('track_active', pcm, sampleRate);
    const p2 = service.queueAnalysis('track_queued', pcm, sampleRate);

    assert.equal(service.getQueueLength(), 1);

    // Cancelar la solicitud que está esperando en cola
    const cancelled = service.cancelAnalysis('track_queued');
    assert.equal(cancelled, true);
    assert.equal(service.getQueueLength(), 0);

    // La promesa de track_queued debe rechazarse con error de cancelación
    await assert.rejects(p2, /cancelado/i);

    // La solicitud activa debe finalizar con éxito
    const res1 = await p1;
    assert.ok(res1);

    service.destroy();
  });

  it('2.4 Cancela solicitudes activas en ejecución y libera la ranura inmediatamente', async () => {
    let workerTerminated = false;
    const factory: WorkerFactory = () => {
      const worker = new SimulatedAnalysisWorker(60);
      const origTerm = worker.terminate.bind(worker);
      worker.terminate = () => {
        workerTerminated = true;
        origTerm();
      };
      return worker;
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, factory);
    const pcm = createDummyPcm(1, sampleRate);

    const pActive = service.queueAnalysis('track_to_cancel', pcm, sampleRate);
    const pQueued = service.queueAnalysis('track_waiting', pcm, sampleRate);

    assert.equal(service.getActiveCount(), 1);
    assert.equal(service.getQueueLength(), 1);

    // Cancelar mientras está activamente calculando
    const cancelResult = service.cancelAnalysis('track_to_cancel');
    assert.equal(cancelResult, true);
    assert.equal(workerTerminated, true);

    // La tarea cancelada debe ser rechazada
    await assert.rejects(pActive, /cancelado/i);

    // La ranura liberada debe permitir que la tarea en cola inicie de inmediato
    assert.equal(service.getActiveCount(), 1);

    const resQueued = await pQueued;
    assert.ok(resQueued);

    service.destroy();
  });

  it('2.5 Descarta resultados obsoletos cuando una pista es reanalizada antes de finalizar', async () => {
    let callCount = 0;
    const factory: WorkerFactory = () => {
      callCount++;
      return new SimulatedAnalysisWorker(callCount === 1 ? 50 : 15);
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, factory);
    const pcm = createDummyPcm(1, sampleRate);

    const updates: AnalysisStatusUpdate[] = [];
    service.subscribe(u => updates.push(u));

    // Lanzar primera solicitud lenta
    const pFirst = service.queueAnalysis('track_same', pcm, sampleRate);

    // Inmediatamente reanalizar la misma pista (sustituye la anterior)
    const pSecond = service.queueAnalysis('track_same', pcm, sampleRate);

    // La primera promesa debe rechazarse por cancelación/sustitución
    await assert.rejects(pFirst, /cancelado|obsolet/i);

    // La segunda promesa debe resolver con el resultado más reciente
    const resSecond = await pSecond;
    assert.ok(resSecond);

    // Ninguna actualización completada con resultado debe pertenecer a la solicitud obsoleta
    const completedWithResult = updates.filter(u => u.result !== undefined);
    assert.equal(completedWithResult.length, 1);
    assert.equal(completedWithResult[0].result?.status, resSecond.status);

    service.destroy();
  });

  it('2.6 Tratamiento de fallos en el Worker y recuperación de la cola sin bloqueos', async () => {
    let workerIndex = 0;
    const factory: WorkerFactory = () => {
      workerIndex++;
      // Primer worker falla con un error, el segundo funciona correctamente
      if (workerIndex === 1) {
        return new SimulatedAnalysisWorker(15, 'Fallo de memoria simulado en Web Worker');
      }
      return new SimulatedAnalysisWorker(15);
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, factory);
    const pcm = createDummyPcm(1, sampleRate);

    const pFailing = service.queueAnalysis('track_failing', pcm, sampleRate);
    const pHealthy = service.queueAnalysis('track_healthy', pcm, sampleRate);

    // La tarea fallida debe rechazar y no quedar en 'analyzing'
    await assert.rejects(pFailing, /Fallo de memoria simulado/);

    // La cola no debe trabarse: la segunda tarea debe procesarse y resolver
    const resHealthy = await pHealthy;
    assert.ok(resHealthy);
    assert.equal(service.getActiveCount(), 0);
    assert.equal(service.getQueueLength(), 0);

    service.destroy();
  });

  it('2.7 Limpieza de recursos y terminación de Workers al invocar destroy()', async () => {
    let terminatedWorkers = 0;
    const factory: WorkerFactory = () => {
      const worker = new SimulatedAnalysisWorker(100);
      const origTerm = worker.terminate.bind(worker);
      worker.terminate = () => {
        terminatedWorkers++;
        origTerm();
      };
      return worker;
    };

    const service = new AnalysisService({ maxConcurrency: 2 }, factory);
    const pcm = createDummyPcm(1, sampleRate);

    const p1 = service.queueAnalysis('t1', pcm, sampleRate);
    const p2 = service.queueAnalysis('t2', pcm, sampleRate);
    const p3 = service.queueAnalysis('t3', pcm, sampleRate);

    // Destruir el servicio en medio de la ejecución
    service.destroy();

    // Las 3 promesas deben rechazarse limpiamente
    await assert.rejects(p1, /destruido/i);
    await assert.rejects(p2, /destruido/i);
    await assert.rejects(p3, /destruido/i);

    // Workers activos deben haber sido terminados
    assert.ok(terminatedWorkers >= 2);
    assert.equal(service.getActiveCount(), 0);
    assert.equal(service.getQueueLength(), 0);

    // Llamadas posteriores deben rechazarse de inmediato
    await assert.rejects(service.queueAnalysis('t_new', pcm, sampleRate), /destruido/i);
  });

  it('2.8 Política Transferable: por defecto clona el buffer y preserva el pcm original', async () => {
    let receivedBufferLength = 0;
    const factory: WorkerFactory = () => {
      const worker = new SimulatedAnalysisWorker(10);
      const origPost = worker.postMessage.bind(worker);
      worker.postMessage = (msg, transfer) => {
        if (transfer && transfer[0]) {
          receivedBufferLength = (transfer[0] as ArrayBuffer).byteLength;
        }
        origPost(msg, transfer);
      };
      return worker;
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, factory);
    const pcm = createDummyPcm(0.1, sampleRate);
    const originalByteLength = pcm.buffer.byteLength;

    // Por defecto transferBuffer es false: no debe desasociar pcm original
    await service.queueAnalysis('track_safe', pcm, sampleRate, { transferBuffer: false });

    assert.equal(pcm.buffer.byteLength, originalByteLength, 'El buffer original NO debe estar desasociado');
    assert.ok(receivedBufferLength > 0, 'El worker recibió un buffer transferido');

    service.destroy();
  });

  it('2.9 Recuperación automática por timeout de seguridad si un Worker no responde', async () => {
    const factory: WorkerFactory = () => {
      // Worker que deliberadamente nunca emite respuesta ni error
      const worker = new SimulatedAnalysisWorker(999999);
      worker.postMessage = () => {}; // Sin respuesta
      return worker;
    };

    // Timeout ultracorto para la prueba (40ms)
    const service = new AnalysisService({ maxConcurrency: 1, workerTimeoutMs: 40 }, factory);
    const pcm = createDummyPcm(0.1, sampleRate);

    const pTimeout = service.queueAnalysis('track_stuck', pcm, sampleRate);

    await assert.rejects(pTimeout, /Tiempo de análisis excedido/i);
    assert.equal(service.getActiveCount(), 0);

    service.destroy();
  });

  it('2.10 Manejo seguro de buffers desasociados (detached) e inválidos sin bloquear la cola', async () => {
    const service = new AnalysisService({ maxConcurrency: 1 }, () => new SimulatedAnalysisWorker(10));
    const pcm = createDummyPcm(0.1, sampleRate);

    // Desasociar intencionalmente el ArrayBuffer simulando una transferencia previa
    structuredClone(pcm, { transfer: [pcm.buffer] });

    // La promesa del buffer desasociado debe rechazarse de inmediato
    await assert.rejects(
      service.queueAnalysis('track_detached', pcm, sampleRate),
      /desasociado|transferir/i
    );

    // La cola no debe bloquearse y el contador activo debe ser 0
    assert.equal(service.getActiveCount(), 0);

    // La siguiente solicitud sana debe procesarse con total normalidad
    const pcmHealthy = createDummyPcm(0.1, sampleRate);
    const res = await service.queueAnalysis('track_healthy_after_detached', pcmHealthy, sampleRate);
    assert.ok(res);

    service.destroy();
  });

  it('2.11 Recuperación ante fallo de instanciación del Worker (WorkerFactory lanza excepción)', async () => {
    let callCount = 0;
    const failingFactory: WorkerFactory = () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Fallo crítico al crear Worker en el hilo principal');
      }
      return new SimulatedAnalysisWorker(10);
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, failingFactory);
    const pcm1 = createDummyPcm(0.1, sampleRate);
    const pcm2 = createDummyPcm(0.1, sampleRate);

    const pFailing = service.queueAnalysis('t_failing_factory', pcm1, sampleRate);
    const pSuccess = service.queueAnalysis('t_success_factory', pcm2, sampleRate);

    // La primera debe ser rechazada con el error de la factoría
    await assert.rejects(pFailing, /Error al inicializar Web Worker/i);

    // La segunda tarea en cola debe ejecutarse y resolver sin quedar trabada
    const resSuccess = await pSuccess;
    assert.ok(resSuccess);
    assert.equal(service.getActiveCount(), 0);
    assert.equal(service.getQueueLength(), 0);

    service.destroy();
  });

  it('2.12 Comportamiento ante buffers vacíos (length = 0) devuelve unsupported ordenado', async () => {
    const service = new AnalysisService({ maxConcurrency: 1 }, () => new SimulatedAnalysisWorker(10));
    const emptyPcm = new Float32Array(0);

    const result = await service.queueAnalysis('track_empty', emptyPcm, sampleRate);

    assert.equal(result.status, 'unsupported');
    assert.match(result.analysisError || '', /vacío/i);
    assert.equal(service.getActiveCount(), 0);

    service.destroy();
  });

  it('2.13 Ejecución de la lógica del manejador real de audioAnalysisWorker (START y CANCEL)', async () => {
    // Importación dinámica del worker real en entorno Node
    await import('../src/workers/audioAnalysisWorker.ts');

    const workerGlobal = (typeof self !== 'undefined' ? self : globalThis) as unknown as {
      onmessage: ((event: { data: unknown }) => void) | null;
      postMessage?: (msg: unknown) => void;
    };
    assert.equal(typeof workerGlobal.onmessage, 'function', 'El worker debe registrar un onmessage');

    // 1. Probar START_ANALYSIS
    const pcm = createDummyPcm(0.2, sampleRate);
    const receivedMessages: Array<{
      type: string;
      requestId: string;
      result?: unknown;
      durationMs?: number;
    }> = [];
    workerGlobal.postMessage = (msg: unknown) => {
      receivedMessages.push(msg as { type: string; requestId: string; result?: unknown; durationMs?: number });
    };

    workerGlobal.onmessage!({
      data: {
        type: 'START_ANALYSIS',
        requestId: 'req_direct_test',
        trackId: 'track_direct',
        pcm,
        sampleRate,
      },
    });

    assert.equal(receivedMessages.length, 1);
    assert.equal(receivedMessages[0].type, 'ANALYSIS_COMPLETE');
    assert.equal(receivedMessages[0].requestId, 'req_direct_test');
    assert.ok(receivedMessages[0].result);
    assert.ok((receivedMessages[0].durationMs ?? 0) >= 0);

    // 2. Probar CANCEL_ANALYSIS
    workerGlobal.onmessage!({
      data: {
        type: 'CANCEL_ANALYSIS',
        requestId: 'req_direct_test',
        trackId: 'track_direct',
      },
    });

    // Restaurar postMessage
    delete workerGlobal.postMessage;
  });
});

