/**
 * SYSTEM DJ — Test Suite: Persistencia de Análisis en IndexedDB y Sincronización con useDJStore
 * Fase 22 — Etapa 3
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import {
  AnalysisSyncManager,
  isAnalysisValid,
} from '../src/services/analysis/AnalysisSyncManager.ts';
import {
  AnalysisService,
  type IAnalysisWorker,
  type WorkerFactory,
} from '../src/services/analysis/AnalysisService.ts';
import { djStore } from '../src/store/useDJStore.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import type { TrackAnalysis } from '../src/types/track.ts';
import type {
  AnalysisWorkerInboundMessage,
  AnalysisWorkerOutboundMessage,
} from '../src/types/analysis.ts';

// Worker simulado determinista para las pruebas de sincronización
class MockWorkerAdapter implements IAnalysisWorker {
  public onmessage: ((event: MessageEvent<AnalysisWorkerOutboundMessage>) => void) | null = null;
  public onerror: ((event: ErrorEvent | Error) => void) | null = null;
  public isTerminated = false;

  private delayMs: number;
  private resultToEmit: TrackAnalysis | null;
  private timer: NodeJS.Timeout | null = null;

  constructor(delayMs = 15, resultToEmit: TrackAnalysis | null = null) {
    this.delayMs = delayMs;
    this.resultToEmit = resultToEmit;
  }

  public postMessage(message: AnalysisWorkerInboundMessage): void {
    if (this.isTerminated || message.type !== 'START_ANALYSIS') return;

    this.timer = setTimeout(() => {
      if (this.isTerminated) return;

      const defaultAnalysis: TrackAnalysis = this.resultToEmit || {
        status: 'analyzed',
        bpm: 125.0,
        bpmConfidence: 0.95,
        key: 'Gm',
        camelot: '6A',
        keyConfidence: 0.88,
        energy: 7.5,
        waveformPeaks: new Array(100).fill(0.5),
      };

      const response: AnalysisWorkerOutboundMessage = {
        type: 'ANALYSIS_COMPLETE',
        requestId: message.requestId,
        trackId: message.trackId,
        result: defaultAnalysis,
        durationMs: 10,
      };

      if (this.onmessage) {
        this.onmessage({ data: response } as MessageEvent<AnalysisWorkerOutboundMessage>);
      }
    }, this.delayMs);
  }

  public terminate(): void {
    this.isTerminated = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

// Generador de archivos y pistas de prueba
function createTestAudioFile(name = 'test_track.mp3', size = 4096): File {
  const data = new Uint8Array(size);
  return new File([data], name, { type: 'audio/mpeg', lastModified: Date.now() });
}

// Decodificador simulado de Web Audio
function createMockAudioDecoder(pcmLength = 44100, sampleRate = 44100) {
  return async (): Promise<AudioBuffer> => {
    const channelData = new Float32Array(pcmLength);
    for (let i = 0; i < pcmLength; i++) {
      channelData[i] = 0.3 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
    }
    return {
      sampleRate,
      length: pcmLength,
      duration: pcmLength / sampleRate,
      numberOfChannels: 1,
      getChannelData: () => channelData,
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
  };
}

class MockAudioBufferSourceNode {
  public buffer: AudioBuffer | null = null;
  public playbackRate = { value: 1, setValueAtTime: () => {} };
  public onended: (() => void) | null = null;
  public connect() { return this; }
  public disconnect() {}
  public start() {}
  public stop() {}
}

class MockAudioContext {
  public state: AudioContextState = 'suspended';
  public currentTime = 0;
  public destination = {} as unknown as AudioDestinationNode;
  public createGain() { return { gain: { value: 1, setValueAtTime: () => {} }, connect: () => this, disconnect: () => {} }; }
  public createBiquadFilter() { return { frequency: { value: 1000, setValueAtTime: () => {} }, gain: { value: 0, setValueAtTime: () => {} }, Q: { value: 1, setValueAtTime: () => {} }, connect: () => this, disconnect: () => {} }; }
  public createAnalyser() { return { fftSize: 256, getByteTimeDomainData: () => {}, connect: () => this, disconnect: () => {} }; }
  public createBufferSource() { return new MockAudioBufferSourceNode(); }
  public async decodeAudioData(): Promise<AudioBuffer> {
    return {
      duration: 180,
      length: 180 * 44100,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(10),
    } as unknown as AudioBuffer;
  }
  public async resume(): Promise<void> { this.state = 'running'; }
  public async close(): Promise<void> { this.state = 'closed'; }
}

describe('Fase 22 — Etapa 3: Persistencia en IndexedDB y Sincronización useDJStore', () => {
  let storage: IndexedDBStorage;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    storage = new IndexedDBStorage();
    await storage.clearAll();
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    djStore.setPitchDeckA(50);
    djStore.setPitchDeckB(50);
  });

  afterEach(async () => {
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  it('3.1 Persiste y recupera resultados de análisis en IndexedDB de forma atómica sin reescribir audioBlob', async () => {
    const file = createTestAudioFile('song_persisted.mp3', 8192);
    const track = createTrackFromFile(file, 180);

    // Guardar pista inicial
    const saveRes = await storage.saveTrack(track, file);
    assert.equal(saveRes.persisted, true);

    const validAnalysis: TrackAnalysis = {
      status: 'analyzed',
      bpm: 128.0,
      bpmConfidence: 0.92,
      key: 'F#m',
      camelot: '11A',
      keyConfidence: 0.85,
      energy: 8.2,
      waveformPeaks: [0.1, 0.4, 0.8, 0.5],
    };

    // Actualizar exclusivamente los metadatos de análisis
    const updated = await storage.updateTrackAnalysis(track.id, validAnalysis);
    assert.equal(updated, true);

    // Recuperar solo los metadatos de análisis
    const retrievedAnalysis = await storage.getTrackAnalysis(track.id);
    assert.ok(retrievedAnalysis);
    assert.equal(retrievedAnalysis.status, 'analyzed');
    assert.equal(retrievedAnalysis.bpm, 128.0);
    assert.equal(retrievedAnalysis.key, 'F#m');
    assert.equal(retrievedAnalysis.camelot, '11A');
    assert.equal(retrievedAnalysis.energy, 8.2);
    assert.deepEqual(retrievedAnalysis.waveformPeaks, [0.1, 0.4, 0.8, 0.5]);

    // Recuperar la pista completa desde IndexedDB
    const allTracks = await storage.getAllTracks();
    assert.equal(allTracks.length, 1);
    assert.equal(allTracks[0].analysis.bpm, 128.0);
    assert.equal(allTracks[0].analysis.camelot, '11A');

    // Comprobar que el audioBlob original no fue corrompido ni eliminado
    const blob = await storage.getTrackBlob(track.id);
    assert.ok(blob);
    assert.equal(blob.size, 8192);
  });

  it('3.2 Maneja de forma transparente pistas históricas/antiguas sin campo de metadatos de análisis', async () => {
    const db = await storage.init();
    assert.ok(db);

    // Inserción directa en IndexedDB de un registro histórico sin la propiedad 'analysis'
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      const legacyRecord = {
        id: 'legacy_track_001',
        title: 'Legacy Song',
        artist: 'Vintage Artist',
        duration: 200,
        durationFormatted: '3:20',
        type: 'audio',
        audioBlob: new Blob([new Uint8Array(100)]),
        fileMeta: { fileName: 'legacy.mp3', fileSize: 100, mimeType: 'audio/mpeg', lastModified: 1000 },
        dateAdded: 1000,
        // analysis deliberadamente omitido
      };
      store.put(legacyRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Cargar todas las pistas: no debe lanzar excepción y debe inicializar analysis seguro
    const tracks = await storage.getAllTracks();
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].id, 'legacy_track_001');
    assert.ok(tracks[0].analysis);
    assert.equal(tracks[0].analysis.status, 'pending');
    assert.equal(tracks[0].analysis.bpm, undefined);
    assert.equal(tracks[0].analysis.key, undefined);

    // Consulta directa de análisis para pista histórica
    const analysis = await storage.getTrackAnalysis('legacy_track_001');
    assert.ok(analysis);
    assert.equal(analysis.status, 'pending');
  });

  it('3.3 Evita reanalizar pistas cuyos resultados válidos ya están guardados en memoria o en IndexedDB (isAnalysisValid)', async () => {
    let workerInvoked = false;
    let decoderInvoked = false;

    const mockFactory: WorkerFactory = () => {
      workerInvoked = true;
      return new MockWorkerAdapter();
    };
    const mockService = new AnalysisService({ maxConcurrency: 1 }, mockFactory);

    const mockDecoder = async (buf: ArrayBuffer): Promise<AudioBuffer> => {
      decoderInvoked = true;
      return createMockAudioDecoder()(buf);
    };

    const syncManager = new AnalysisSyncManager(mockService, storage, mockDecoder);

    // 1. Caso: análisis ya válido en el objeto Track
    const file = createTestAudioFile('track_already_analyzed.mp3');
    const track = createTrackFromFile(file, 120);
    track.analysis = {
      status: 'analyzed',
      bpm: 124.0,
      key: 'C',
      camelot: '8B',
    };

    const res1 = await syncManager.analyzeTrack(track);
    assert.equal(res1.bpm, 124.0);
    assert.equal(workerInvoked, false, 'No debe invocar el Web Worker');
    assert.equal(decoderInvoked, false, 'No debe decodificar el audio');

    // 2. Caso: análisis guardado en IndexedDB aunque el objeto Track esté en pending
    const track2 = createTrackFromFile(file, 150);
    track2.analysis = { status: 'pending' };
    await storage.saveTrack(track2, file);
    await storage.updateTrackAnalysis(track2.id, {
      status: 'analyzed',
      bpm: 130.0,
      key: 'Am',
      camelot: '8A',
    });

    const res2 = await syncManager.analyzeTrack(track2);
    assert.equal(res2.bpm, 130.0);
    assert.equal(res2.camelot, '8A');
    assert.equal(workerInvoked, false, 'No debe invocar el Worker si ya estaba persistido');
    assert.equal(decoderInvoked, false, 'No debe decodificar si ya estaba persistido');

    mockService.destroy();
  });

  it('3.4 Fuerza el re-análisis cuando se solicita explícitamente options.force = true', async () => {
    let workerInvoked = false;
    const mockFactory: WorkerFactory = () => {
      workerInvoked = true;
      return new MockWorkerAdapter(10, {
        status: 'analyzed',
        bpm: 140.0,
        key: 'Dm',
        camelot: '7A',
      });
    };
    const mockService = new AnalysisService({ maxConcurrency: 1 }, mockFactory);
    const syncManager = new AnalysisSyncManager(mockService, storage, createMockAudioDecoder());

    const file = createTestAudioFile('force_track.mp3');
    const track = createTrackFromFile(file, 100);
    track.analysis = {
      status: 'analyzed',
      bpm: 120.0,
      key: 'C',
    };
    await storage.saveTrack(track, file);

    // Reanálisis forzado
    const res = await syncManager.analyzeTrack(track, { force: true });
    assert.equal(workerInvoked, true);
    assert.equal(res.bpm, 140.0);
    assert.equal(res.key, 'Dm');

    // Comprobar que en IndexedDB se actualizó el nuevo valor
    const fromDb = await storage.getTrackAnalysis(track.id);
    assert.equal(fromDb?.bpm, 140.0);

    mockService.destroy();
  });

  it('3.5 Actualiza useDJStore reactivamente cuando finaliza el análisis de una pista cargada en Deck A o Deck B', async () => {
    const file = createTestAudioFile('deck_track.mp3');
    const track = createTrackFromFile(file, 120);
    await storage.saveTrack(track, file);

    // Cargar pista en Deck A (sin análisis previo, estado pending)
    await djStore.loadTrackToDeckA(track);

    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.calculatedBpm, null);
    assert.equal(snap.deckA.keyStr, null);

    // Simular actualización de análisis completado vía handleAnalysisUpdated
    const completedAnalysis: TrackAnalysis = {
      status: 'analyzed',
      bpm: 126.0,
      key: 'Ebm',
      camelot: '2A',
      energy: 8.0,
    };
    await djStore.updateTrackAnalysis(track.id, completedAnalysis);

    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.analysis.status, 'analyzed');
    assert.equal(snap.deckA.calculatedBpm, 126.0);
    assert.equal(snap.deckA.keyStr, 'Ebm (2A)');

    // Probar reactividad al modificar pitch (+8% a pitch 100)
    djStore.setPitchDeckA(100);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackRate, 1.08);
    // 126.0 * 1.08 = 136.08 -> 136.1
    assert.equal(snap.deckA.calculatedBpm, 136.1);
  });

  it('3.6 Evita escrituras obsoletas si la pista fue eliminada durante el procesamiento en segundo plano', async () => {
    let finishWorker: (() => void) | null = null;

    const controllableFactory: WorkerFactory = () => {
      const worker = new MockWorkerAdapter();
      worker.postMessage = (msg) => {
        if (msg.type !== 'START_ANALYSIS') return;
        finishWorker = () => {
          if (worker.onmessage) {
            worker.onmessage({
              data: {
                type: 'ANALYSIS_COMPLETE',
                requestId: msg.requestId,
                trackId: msg.trackId,
                result: { status: 'analyzed', bpm: 132.0, key: 'Am', camelot: '8A' },
                durationMs: 5,
              },
            } as MessageEvent<AnalysisWorkerOutboundMessage>);
          }
        };
      };
      return worker;
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, controllableFactory);
    const syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder());

    const file = createTestAudioFile('track_to_delete.mp3');
    const track = createTrackFromFile(file, 60);
    await storage.saveTrack(track, file);

    // Iniciar análisis asíncrono
    const analysisPromise = syncManager.analyzeTrack(track);

    // El usuario elimina la pista antes de que el Worker termine
    await storage.deleteTrack(track.id);
    assert.equal(await storage.hasTrack(track.id), false);

    // Ahora el Worker finaliza
    finishWorker!();
    await analysisPromise;

    // La pista eliminada NO debe resucitar en IndexedDB
    assert.equal(await storage.hasTrack(track.id), false);
    const all = await storage.getAllTracks();
    assert.equal(all.length, 0);

    service.destroy();
  });

  it('3.7 Descarta escrituras desfasadas cuando una pista recibe un análisis nuevo más reciente', async () => {
    let callCount = 0;
    const factory: WorkerFactory = () => {
      callCount++;
      const currentCall = callCount;
      const bpm = currentCall === 1 ? 100.0 : 150.0;
      const delay = currentCall === 1 ? 30 : 10;
      return new MockWorkerAdapter(delay, {
        status: 'analyzed',
        bpm,
        key: currentCall === 1 ? 'C' : 'D',
      });
    };

    const service = new AnalysisService({ maxConcurrency: 2 }, factory);
    const syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder());

    const file = createTestAudioFile('track_multi.mp3');
    const track = createTrackFromFile(file, 60);
    await storage.saveTrack(track, file);

    // Lanzar primera solicitud (más lenta, 100 BPM)
    const p1 = syncManager.analyzeTrack(track, { force: true });
    // Esperar a que p1 pase la decodificación y entre en el Worker
    await new Promise((r) => setTimeout(r, 5));
    // Lanzar segunda solicitud (más rápida, 150 BPM)
    const p2 = syncManager.analyzeTrack(track, { force: true });

    await Promise.allSettled([p1, p2]);

    // El valor persistido final debe ser el de la solicitud más reciente (150 BPM)
    const stored = await storage.getTrackAnalysis(track.id);
    assert.equal(stored?.bpm, 150.0);
    assert.equal(stored?.key, 'D');

    service.destroy();
  });

  it('3.8 Gestiona fallos de almacenamiento (IndexedDB no soportado o error de cuota) con fallback en memoria', async () => {
    const fallbackStorage = new IndexedDBStorage();
    (fallbackStorage as unknown as { isSupported: boolean }).isSupported = false;

    const file = createTestAudioFile('fallback_analysis.mp3');
    const track = createTrackFromFile(file, 60);
    await fallbackStorage.saveTrack(track, file);

    // Actualizar metadatos de análisis en entorno sin IndexedDB
    const updated = await fallbackStorage.updateTrackAnalysis(track.id, {
      status: 'analyzed',
      bpm: 122.0,
      key: 'G',
    });
    assert.equal(updated, true);

    const fromMemory = await fallbackStorage.getTrackAnalysis(track.id);
    assert.ok(fromMemory);
    assert.equal(fromMemory.bpm, 122.0);
  });

  it('3.9 Invalida metadatos cuando se solicita explícitamente (invalidateAnalysis)', async () => {
    const file = createTestAudioFile('to_invalidate.mp3');
    const track = createTrackFromFile(file, 90);
    track.analysis = {
      status: 'analyzed',
      bpm: 128.0,
      key: 'Bbm',
    };
    await storage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    assert.equal(djStore.getSnapshot().deckA.calculatedBpm, 128.0);

    const syncManager = new AnalysisSyncManager(
      new AnalysisService({ maxConcurrency: 1 }),
      storage,
      createMockAudioDecoder()
    );

    // Invalidar el análisis
    await syncManager.invalidateAnalysis(track.id);

    // Comprobar que en storage volvió a 'pending'
    const stored = await storage.getTrackAnalysis(track.id);
    assert.equal(stored?.status, 'pending');
    assert.equal(stored?.bpm, undefined);

    // Actualizar DJStore
    djStore.handleAnalysisUpdated(track.id, { status: 'pending' });
    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.calculatedBpm, null);
    assert.equal(snap.deckA.keyStr, null);
  });

  it('3.10 Criterio estricto de estados: unsupported y failed nunca inventan BPM ni clave tonal', async () => {
    const file1 = createTestAudioFile('unsupported_track.mp3');
    const trackUnsupported = createTrackFromFile(file1, 50);
    trackUnsupported.analysis = {
      status: 'unsupported',
      analysisError: 'Audio sin estructura rítmica clara',
      bpm: 120, // Simulando valor residual
      key: 'Am',
    };

    const file2 = createTestAudioFile('failed_track.mp3');
    const trackFailed = createTrackFromFile(file2, 50);
    trackFailed.analysis = {
      status: 'failed',
      analysisError: 'Decodificación abortada',
      bpm: 128,
      key: 'C',
    };

    // Cargar pista no soportada en Deck A
    await djStore.loadTrackToDeckA(trackUnsupported);
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.calculatedBpm, null, 'Pista unsupported debe tener calculatedBpm = null');
    assert.equal(snap.deckA.keyStr, null, 'Pista unsupported debe tener keyStr = null');

    // Cargar pista fallida en Deck B
    await djStore.loadTrackToDeckB(trackFailed);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckB.calculatedBpm, null, 'Pista failed debe tener calculatedBpm = null');
    assert.equal(snap.deckB.keyStr, null, 'Pista failed debe tener keyStr = null');

    // Validación de la función pura isAnalysisValid
    assert.equal(isAnalysisValid(trackUnsupported.analysis), false);
    assert.equal(isAnalysisValid(trackFailed.analysis), false);
    assert.equal(isAnalysisValid({ status: 'pending' }), false);
    assert.equal(isAnalysisValid({ status: 'analyzing' }), false);
    assert.equal(isAnalysisValid({ status: 'analyzed', bpm: 120 }), true);
    assert.equal(isAnalysisValid({ status: 'analyzed', key: 'Am' }), true);
  });

  it('3.11 Los resultados de análisis sobreviven a la destrucción y recreación de la instancia de IndexedDBStorage (sin memoria compartida)', async () => {
    const file = createTestAudioFile('independent_survival.mp3', 6000);
    const track = createTrackFromFile(file, 150);

    // Guardar pista y análisis con la primera instancia
    await storage.saveTrack(track, file);
    await storage.updateTrackAnalysis(track.id, {
      status: 'analyzed',
      bpm: 127.5,
      bpmConfidence: 0.94,
      key: 'Cm',
      camelot: '5A',
      energy: 7.9,
    });

    // Destruir la referencia local y crear una instancia completamente nueva
    // (nace con memoryStore vacío)
    const freshStorage = new IndexedDBStorage();

    // Recuperar solo análisis
    const retrievedAnalysis = await freshStorage.getTrackAnalysis(track.id);
    assert.ok(retrievedAnalysis);
    assert.equal(retrievedAnalysis.status, 'analyzed');
    assert.equal(retrievedAnalysis.bpm, 127.5);
    assert.equal(retrievedAnalysis.key, 'Cm');
    assert.equal(retrievedAnalysis.camelot, '5A');
    assert.equal(retrievedAnalysis.energy, 7.9);

    // Recuperar pista completa y su blob
    const singleTrack = await freshStorage.getTrack(track.id);
    assert.ok(singleTrack);
    assert.equal(singleTrack.id, track.id);
    assert.equal(singleTrack.analysis.bpm, 127.5);

    const blob = await freshStorage.getTrackBlob(track.id);
    assert.ok(blob);
    assert.equal(blob.size, 6000);
  });

  it('3.12 Reemplazar el archivo físico de una pista invalida sus metadatos de análisis anteriores (mismo trackId)', async () => {
    const fileA = createTestAudioFile('original_song.mp3', 4000);
    const track = createTrackFromFile(fileA, 120);

    await storage.saveTrack(track, fileA);
    await storage.updateTrackAnalysis(track.id, {
      status: 'analyzed',
      bpm: 128.0,
      key: 'Gm',
      camelot: '6A',
    });

    // Comprobar que inicialmente está analizada
    let currentAnalysis = await storage.getTrackAnalysis(track.id);
    assert.equal(currentAnalysis?.bpm, 128.0);

    // Reemplazar el archivo de la pista conservando el mismo trackId pero con diferente tamaño y fecha
    const fileB = new File([new Uint8Array(8000)], 'replaced_song.mp3', {
      type: 'audio/mpeg',
      lastModified: Date.now() + 5000,
    });
    track.fileMeta = {
      fileName: 'replaced_song.mp3',
      fileSize: 8000,
      mimeType: 'audio/mpeg',
      lastModified: fileB.lastModified,
    };

    // Al guardar el nuevo archivo bajo el mismo trackId, el análisis anterior debe invalidarse
    const saveResult = await storage.saveTrack(track, fileB);
    assert.equal(saveResult.persisted, true);

    currentAnalysis = await storage.getTrackAnalysis(track.id);
    assert.equal(currentAnalysis?.status, 'pending');
    assert.equal(currentAnalysis?.bpm, undefined);

    // También al consultar analyzeTrack con metadatos cambiados, detecta el cambio e invalida
    const service = new AnalysisService({ maxConcurrency: 1 }, () => new MockWorkerAdapter());
    const syncManager = new AnalysisSyncManager(
      service,
      storage,
      createMockAudioDecoder()
    );
    // Simular que el objeto track traía un análisis previo residual
    track.analysis = { status: 'analyzed', bpm: 128.0 };
    // Cambiar la fecha de modificación de nuevo
    track.fileMeta = {
      ...track.fileMeta,
      fileSize: 9500,
      lastModified: Date.now() + 10000,
    };
    await storage.saveTrack(track, new File([new Uint8Array(9500)], 'replaced_song2.mp3', { type: 'audio/mpeg' }));

    // analyzeTrack detecta que el archivo difiere del almacenado, invalida y reanaliza
    const freshAnalysis = await syncManager.analyzeTrack(track);
    assert.equal(freshAnalysis.status, 'analyzed');
    assert.notEqual(freshAnalysis.bpm, 128.0); // El mockworker por defecto retorna 125
    service.destroy();
  });

  it('3.13 Aislamiento de Deck: cambiar de pista en un Deck mientras se analiza la anterior no sobrescribe BPM ni tonalidad tardíamente', async () => {
    let finishTrackAAnalysis: (() => void) | null = null;

    const mockFactory: WorkerFactory = () => {
      const worker = new MockWorkerAdapter();
      worker.postMessage = (msg) => {
        if (msg.trackId === 'track_slow_A') {
          finishTrackAAnalysis = () => {
            if (worker.onmessage) {
              worker.onmessage({
                data: {
                  type: 'ANALYSIS_COMPLETE',
                  requestId: msg.requestId,
                  trackId: msg.trackId,
                  result: {
                    status: 'analyzed',
                    bpm: 110.0,
                    key: 'Fm',
                    camelot: '4A',
                  },
                  durationMs: 15,
                },
              } as MessageEvent<AnalysisWorkerOutboundMessage>);
            }
          };
        }
      };
      return worker;
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, mockFactory);
    const syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder());

    // Pista 1 (lenta en procesarse, 110 BPM)
    const file1 = createTestAudioFile('track_1.mp3', 3000);
    const track1 = createTrackFromFile(file1, 100);
    track1.id = 'track_slow_A';
    await storage.saveTrack(track1, file1);

    // Pista 2 (ya analizada con 130.0 BPM, Bm)
    const file2 = createTestAudioFile('track_2.mp3', 5000);
    const track2 = createTrackFromFile(file2, 120);
    track2.id = 'track_fast_B';
    track2.analysis = {
      status: 'analyzed',
      bpm: 130.0,
      key: 'Bm',
      camelot: '10A',
    };
    await storage.saveTrack(track2, file2);

    // 1. Cargar Pista 1 en Deck A
    await djStore.loadTrackToDeckA(track1);
    assert.equal(djStore.getSnapshot().deckA.track?.id, 'track_slow_A');
    assert.equal(djStore.getSnapshot().deckA.calculatedBpm, null);

    // 2. Iniciar el análisis de Pista 1 en segundo plano
    const analysisPromise = syncManager.analyzeTrack(track1);

    // 3. El usuario cambia la pista de Deck A a Pista 2 ANTES de que termine el análisis de Pista 1
    await djStore.loadTrackToDeckA(track2);
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.id, 'track_fast_B');
    assert.equal(snap.deckA.calculatedBpm, 130.0);
    assert.equal(snap.deckA.keyStr, 'Bm (10A)');

    // 4. El análisis de Pista 1 finaliza tardíamente
    assert.ok(finishTrackAAnalysis);
    finishTrackAAnalysis!();
    await analysisPromise;

    // 5. Deck A NO debe haber sido contaminado por el resultado tardío de Pista 1
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.id, 'track_fast_B');
    assert.equal(snap.deckA.calculatedBpm, 130.0, 'El BPM de Deck A debe mantenerse en 130.0');
    assert.equal(snap.deckA.keyStr, 'Bm (10A)', 'La tonalidad de Deck A debe mantenerse en Bm (10A)');

    // 6. Y Pista 1 quedó guardada correctamente en IndexedDB sin afectar al Deck
    const track1StoredAnalysis = await storage.getTrackAnalysis('track_slow_A');
    assert.equal(track1StoredAnalysis?.bpm, 110.0);

    service.destroy();
  });

  it('3.14 Limpieza y ciclo de vida de suscripciones: unsubscribe previene fugas de memoria y notificaciones duplicadas', () => {
    const syncManager = new AnalysisSyncManager(
      new AnalysisService({ maxConcurrency: 1 }),
      storage,
      createMockAudioDecoder()
    );

    let notificationCount = 0;
    const listener = () => {
      notificationCount++;
    };

    // Suscribir listener
    const unsubscribe = syncManager.subscribe(listener);

    // Notificar análisis
    (syncManager as unknown as { notifyListeners: (id: string, a: TrackAnalysis) => void }).notifyListeners(
      't1',
      { status: 'analyzed', bpm: 120 }
    );
    assert.equal(notificationCount, 1);

    // Desuscribir
    unsubscribe();

    // Nueva notificación: el listener ya no debe ser invocado
    (syncManager as unknown as { notifyListeners: (id: string, a: TrackAnalysis) => void }).notifyListeners(
      't1',
      { status: 'analyzed', bpm: 125 }
    );
    assert.equal(notificationCount, 1, 'No debe recibir eventos tras desuscribirse');
  });

  it('3.15 Cancelar un análisis activo restablece el estado a pending y evita que la pista quede indefinidamente en analyzing', async () => {
    const factory: WorkerFactory = () => new MockWorkerAdapter(50);
    const service = new AnalysisService({ maxConcurrency: 1 }, factory);
    const syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder());

    const file = createTestAudioFile('to_cancel.mp3', 2048);
    const track = createTrackFromFile(file, 60);
    await storage.saveTrack(track, file);

    let lastEmittedStatus = '';
    const analyzingPromise = new Promise<void>((resolve) => {
      syncManager.subscribe((id, analysis) => {
        if (id === track.id) {
          lastEmittedStatus = analysis.status;
          if (analysis.status === 'analyzing') {
            resolve();
          }
        }
      });
    });

    // Iniciar análisis asíncrono
    void syncManager.analyzeTrack(track);

    // Esperar a que entre en el estado 'analyzing'
    await analyzingPromise;
    assert.equal(lastEmittedStatus, 'analyzing');

    // Cancelar análisis en curso
    const cancelled = syncManager.cancelAnalysis(track.id);
    assert.equal(cancelled, true);

    // El estado emitido debe volver a 'pending' y no quedar en 'analyzing'
    assert.equal(lastEmittedStatus, 'pending');

    service.destroy();
  });
});
