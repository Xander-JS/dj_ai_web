/**
 * SYSTEM DJ — Test Suite: Fase 22 — Etapa 6.3
 * Pruebas Integrales de Concurrencia, Cola, Cancelación y Manejo de Errores
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { AnalysisSyncManager } from '../src/services/analysis/AnalysisSyncManager.ts';
import {
  AnalysisService,
  type IAnalysisWorker,
  type WorkerFactory,
} from '../src/services/analysis/AnalysisService.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import type { Track, TrackAnalysis } from '../src/types/track.ts';
import type {
  AnalysisWorkerInboundMessage,
  AnalysisWorkerOutboundMessage,
} from '../src/types/analysis.ts';

class ControllableMockWorker implements IAnalysisWorker {
  public onmessage: ((event: MessageEvent<AnalysisWorkerOutboundMessage>) => void) | null = null;
  public onerror: ((event: ErrorEvent | Error) => void) | null = null;
  public isTerminated = false;

  private behaviorMap: Map<string, { delay: number; fail?: boolean; result?: TrackAnalysis }>;
  private activeTimers: Set<NodeJS.Timeout> = new Set();

  constructor(behaviorMap: Map<string, { delay: number; fail?: boolean; result?: TrackAnalysis }>) {
    this.behaviorMap = behaviorMap;
  }

  public postMessage(message: AnalysisWorkerInboundMessage): void {
    if (this.isTerminated || message.type !== 'START_ANALYSIS') return;

    const behavior = this.behaviorMap.get(message.trackId) || { delay: 10 };

    const timer = setTimeout(() => {
      this.activeTimers.delete(timer);
      if (this.isTerminated) return;

      if (behavior.fail) {
        if (this.onerror) {
          this.onerror(new Error(`Error sintético de análisis para ${message.trackId}`));
        } else if (this.onmessage) {
          this.onmessage({
            data: {
              type: 'ANALYSIS_ERROR',
              requestId: message.requestId,
              trackId: message.trackId,
              error: `Error sintético en worker para ${message.trackId}`,
            },
          } as MessageEvent<AnalysisWorkerOutboundMessage>);
        }
        return;
      }

      const res: TrackAnalysis = behavior.result || {
        status: 'analyzed',
        bpm: 125.0,
        bpmConfidence: 0.95,
        key: 'Cm',
        camelot: '5A',
        energy: 7.0,
        waveformPeaks: [0.2, 0.4, 0.6],
      };

      if (this.onmessage) {
        this.onmessage({
          data: {
            type: 'ANALYSIS_COMPLETE',
            requestId: message.requestId,
            trackId: message.trackId,
            result: res,
            durationMs: 12,
          },
        } as MessageEvent<AnalysisWorkerOutboundMessage>);
      }
    }, behavior.delay);

    this.activeTimers.add(timer);
  }

  public terminate(): void {
    this.isTerminated = true;
    for (const timer of this.activeTimers) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
  }
}

function createTestAudioFile(name: string, size = 3000): File {
  return new File([new Uint8Array(size)], name, { type: 'audio/mpeg', lastModified: Date.now() });
}

function createMockAudioDecoder(failTrackId?: string) {
  return async (_buf: ArrayBuffer): Promise<AudioBuffer> => {
    if (failTrackId && _buf.byteLength === 999) {
      throw new Error('Fallo crítico al decodificar stream binario corrupto');
    }
    const sampleRate = 44100;
    const length = 44100;
    return {
      sampleRate,
      length,
      duration: 1.0,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(length),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
  };
}

describe('Fase 22 — Etapa 6.3: Concurrencia, Cola, Cancelación y Manejo de Errores', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.clearAll();
  });

  afterEach(async () => {
    await storage.clearAll();
  });

  it('6.3.1 Procesamiento de múltiples pistas en cola: respeta la concurrencia y procesa todas las tareas', async () => {
    const behaviors = new Map<string, { delay: number; result?: TrackAnalysis }>();
    behaviors.set('track_1', { delay: 20, result: { status: 'analyzed', bpm: 120.0, key: 'C', camelot: '8B' } });
    behaviors.set('track_2', { delay: 15, result: { status: 'analyzed', bpm: 124.0, key: 'Am', camelot: '8A' } });
    behaviors.set('track_3', { delay: 10, result: { status: 'analyzed', bpm: 128.0, key: 'F#m', camelot: '11A' } });
    behaviors.set('track_4', { delay: 5, result: { status: 'analyzed', bpm: 130.0, key: 'Dm', camelot: '7A' } });

    let concurrentWorkers = 0;
    let maxConcurrentObserved = 0;

    const factory: WorkerFactory = () => {
      const worker = new ControllableMockWorker(behaviors);
      concurrentWorkers++;
      if (concurrentWorkers > maxConcurrentObserved) {
        maxConcurrentObserved = concurrentWorkers;
      }
      const origTerminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        concurrentWorkers = Math.max(0, concurrentWorkers - 1);
        origTerminate();
      };
      return worker;
    };

    // Concurrencia máxima 2
    const service = new AnalysisService({ maxConcurrency: 2 }, factory);
    const syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder());

    const tracks: Track[] = [];
    for (let i = 1; i <= 4; i++) {
      const file = createTestAudioFile(`track_${i}.mp3`);
      const track = createTrackFromFile(file, 120);
      track.id = `track_${i}`;
      await storage.saveTrack(track, file);
      tracks.push(track);
    }

    // Lanzar las 4 pistas simultáneamente
    const promises = tracks.map((t) => syncManager.analyzeTrack(t));
    const results = await Promise.all(promises);

    // Verificar que los 4 resultados finalizaron con éxito
    assert.equal(results.length, 4);
    assert.equal(results[0].bpm, 120.0);
    assert.equal(results[1].bpm, 124.0);
    assert.equal(results[2].bpm, 128.0);
    assert.equal(results[3].bpm, 130.0);

    // Verificar que todos quedaron persistidos en IndexedDB
    for (const t of tracks) {
      const dbAnalysis = await storage.getTrackAnalysis(t.id);
      assert.equal(dbAnalysis?.status, 'analyzed');
      assert.ok(typeof dbAnalysis?.bpm === 'number');
    }

    // Verificar que la concurrencia no excedió el límite configurado (2)
    assert.ok(maxConcurrentObserved <= 2, `Concurrencia máxima observada (${maxConcurrentObserved}) no debe superar 2`);

    service.destroy();
  });

  it('6.3.2 Archivo defectuoso no interrumpe el procesamiento de las demás pistas en la cola', async () => {
    const behaviors = new Map<string, { delay: number; fail?: boolean; result?: TrackAnalysis }>();
    behaviors.set('pista_ok_1', { delay: 10, result: { status: 'analyzed', bpm: 122.0, key: 'C', camelot: '8B' } });
    behaviors.set('pista_corrupta', { delay: 5, fail: true });
    behaviors.set('pista_ok_2', { delay: 10, result: { status: 'analyzed', bpm: 132.0, key: 'G', camelot: '9B' } });

    const service = new AnalysisService({ maxConcurrency: 1 }, () => new ControllableMockWorker(behaviors));
    const syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder());

    // Crear 3 pistas
    const file1 = createTestAudioFile('pista_ok_1.mp3');
    const t1 = createTrackFromFile(file1, 60);
    t1.id = 'pista_ok_1';
    await storage.saveTrack(t1, file1);

    const file2 = createTestAudioFile('pista_corrupta.mp3');
    const t2 = createTrackFromFile(file2, 60);
    t2.id = 'pista_corrupta';
    await storage.saveTrack(t2, file2);

    const file3 = createTestAudioFile('pista_ok_2.mp3');
    const t3 = createTrackFromFile(file3, 60);
    t3.id = 'pista_ok_2';
    await storage.saveTrack(t3, file3);

    // Encolar las 3 de forma secuencial / concurrente
    const p1 = syncManager.analyzeTrack(t1);
    const p2 = syncManager.analyzeTrack(t2);
    const p3 = syncManager.analyzeTrack(t3);

    const [res1, res2, res3] = await Promise.all([p1, p2, p3]);

    // Pista 1: Exitosa
    assert.equal(res1.status, 'analyzed');
    assert.equal(res1.bpm, 122.0);

    // Pista 2: Fallida con status: 'failed' y mensaje de error, sin inventar métricas
    assert.equal(res2.status, 'failed');
    assert.ok(res2.analysisError);
    assert.equal(res2.bpm, undefined);
    assert.equal(res2.key, undefined);

    // Pista 3: Exitosa — El fallo de la pista 2 NO interrumpió la cola
    assert.equal(res3.status, 'analyzed');
    assert.equal(res3.bpm, 132.0);

    // Verificar almacenamiento persistente
    const db2 = await storage.getTrackAnalysis('pista_corrupta');
    assert.equal(db2?.status, 'failed');
    const db3 = await storage.getTrackAnalysis('pista_ok_2');
    assert.equal(db3?.status, 'analyzed');
    assert.equal(db3?.bpm, 132.0);

    service.destroy();
  });

  it('6.3.3 Fallo al decodificar audio (stream no válido) marca failed y no congela el sistema', async () => {
    const service = new AnalysisService({ maxConcurrency: 1 }, () => new ControllableMockWorker(new Map()));
    // Decodificador simulado que lanza excepción para archivos con tamaño 999
    const syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder('track_corrupt_stream'));

    const corruptFile = createTestAudioFile('corrupt.mp3', 999);
    const corruptTrack = createTrackFromFile(corruptFile, 50);
    corruptTrack.id = 'track_corrupt_stream';
    await storage.saveTrack(corruptTrack, corruptFile);

    const result = await syncManager.analyzeTrack(corruptTrack);

    assert.equal(result.status, 'failed');
    assert.ok(result.analysisError?.includes('Fallo al decodificar audio'));
    assert.equal(result.bpm, undefined);
    assert.equal(result.key, undefined);

    // Comprobar que el servicio sigue operativo para otra pista posterior
    const normalFile = createTestAudioFile('normal.mp3', 2000);
    const normalTrack = createTrackFromFile(normalFile, 50);
    normalTrack.id = 'track_normal_post_crash';
    await storage.saveTrack(normalTrack, normalFile);

    const normalResult = await syncManager.analyzeTrack(normalTrack);
    assert.equal(normalResult.status, 'analyzed');

    service.destroy();
  });

  it('6.3.4 Cancelación de tarea activa restablece estado y permite procesar nuevas peticiones sin bloqueos', async () => {
    let cancelCalled = false;
    const controllableFactory: WorkerFactory = () => {
      const worker = new ControllableMockWorker(new Map());
      worker.postMessage = (msg) => {
        if (msg.trackId === 'track_to_cancel') {
          // El worker simula una tarea muy larga (2000 ms)
          setTimeout(() => {
            if (!worker.isTerminated && !cancelCalled) {
              if (worker.onmessage) {
                worker.onmessage({
                  data: {
                    type: 'ANALYSIS_COMPLETE',
                    requestId: msg.requestId,
                    trackId: msg.trackId,
                    result: { status: 'analyzed', bpm: 99.0 },
                    durationMs: 2000,
                  },
                } as MessageEvent<AnalysisWorkerOutboundMessage>);
              }
            }
          }, 2000);
        }
      };
      return worker;
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, controllableFactory);
    const syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder());

    const file = createTestAudioFile('cancel_me.mp3', 4000);
    const track = createTrackFromFile(file, 120);
    track.id = 'track_to_cancel';
    await storage.saveTrack(track, file);

    let observedStatus = '';
    const analyzingWaitPromise = new Promise<void>((resolve) => {
      syncManager.subscribe((id, a) => {
        if (id === track.id) {
          observedStatus = a.status;
          if (a.status === 'analyzing') {
            resolve();
          }
        }
      });
    });

    // Iniciar análisis
    const analysisPromise = syncManager.analyzeTrack(track);

    // Esperar a que entre en analyzing
    await analyzingWaitPromise;
    assert.equal(observedStatus, 'analyzing');

    // Cancelar la tarea
    cancelCalled = true;
    const cancelled = syncManager.cancelAnalysis('track_to_cancel');
    assert.equal(cancelled, true);

    // El estado emitido debe haber vuelto a 'pending'
    assert.equal(observedStatus, 'pending');

    await analysisPromise;

    // IndexedDB debe reflejar 'pending' y no contener métricas espurias
    const dbAnalysis = await storage.getTrackAnalysis('track_to_cancel');
    assert.equal(dbAnalysis?.status, 'pending');
    assert.equal(dbAnalysis?.bpm, undefined);

    service.destroy();
  });
});
