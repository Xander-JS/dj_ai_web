/**
 * SYSTEM DJ — Fase 23.4: Etapa B
 * Suite de Pruebas: Integración de Identidad SHA-256, Persistencia Segura y Concurrencia
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { AnalysisSyncManager } from '../src/services/analysis/AnalysisSyncManager.ts';
import {
  AnalysisService,
  type IAnalysisWorker,
} from '../src/services/analysis/AnalysisService.ts';
import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import { computeFileHash } from '../src/utils/cryptoHash.ts';
import type { Track, TrackAnalysis, HotCue } from '../src/types/track.ts';
import type {
  AnalysisWorkerInboundMessage,
  AnalysisWorkerOutboundMessage,
} from '../src/types/analysis.ts';

// ---------------------------------------------------------------------------
// Mocks para Web Audio API y Web Worker determinista
// ---------------------------------------------------------------------------

class MockAudioParam {
  public value: number;
  constructor(val = 1) {
    this.value = val;
  }
  public setValueAtTime(v: number): void {
    this.value = v;
  }
}

class MockAudioNode {
  public connect(): MockAudioNode {
    return this;
  }
  public disconnect(): void {}
}

class MockGainNode extends MockAudioNode {
  public gain = new MockAudioParam(1);
}

class MockBiquadFilterNode extends MockAudioNode {
  public type = 'allpass';
  public frequency = new MockAudioParam(1000);
  public gain = new MockAudioParam(0);
  public Q = new MockAudioParam(1);
}

class MockAnalyserNode extends MockAudioNode {
  public fftSize = 256;
  public frequencyBinCount = 128;
  public smoothingTimeConstant = 0.8;
  public getByteTimeDomainData(arr: Uint8Array): void {
    arr.fill(128);
  }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  public buffer: AudioBuffer | null = null;
  public playbackRate = new MockAudioParam(1);
  public onended: (() => void) | null = null;
  public start(): void {}
  public stop(): void {}
}

class MockAudioContext {
  public state: AudioContextState = 'running';
  public currentTime = 0;
  public sampleRate = 44100;
  public destination = new MockAudioNode();

  public createGain(): MockGainNode {
    return new MockGainNode();
  }
  public createBiquadFilter(): MockBiquadFilterNode {
    return new MockBiquadFilterNode();
  }
  public createAnalyser(): MockAnalyserNode {
    return new MockAnalyserNode();
  }
  public createBufferSource(): MockAudioBufferSourceNode {
    return new MockAudioBufferSourceNode();
  }
  public async decodeAudioData(): Promise<AudioBuffer> {
    return {
      duration: 180.0,
      length: 180 * 44100,
      numberOfChannels: 1,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(1000),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
  }
  public async resume(): Promise<void> {
    this.state = 'running';
  }
  public async close(): Promise<void> {
    this.state = 'closed';
  }
}

class ControllableMockWorker implements IAnalysisWorker {
  public onmessage: ((event: MessageEvent<AnalysisWorkerOutboundMessage>) => void) | null = null;
  public onerror: ((event: ErrorEvent | Error) => void) | null = null;
  public isTerminated = false;
  public messagesReceived: AnalysisWorkerInboundMessage[] = [];

  private messageCallbacks: Array<(msg: AnalysisWorkerInboundMessage) => void> = [];

  public postMessage(message: AnalysisWorkerInboundMessage): void {
    this.messagesReceived.push(message);
    for (const cb of this.messageCallbacks) {
      cb(message);
    }
  }

  public async waitForMessage(predicateOrTrackId: string | ((m: AnalysisWorkerInboundMessage) => boolean)): Promise<AnalysisWorkerInboundMessage> {
    const predicate = typeof predicateOrTrackId === 'string'
      ? (m: AnalysisWorkerInboundMessage) => m.trackId === predicateOrTrackId
      : predicateOrTrackId;

    const foundIndex = this.messagesReceived.findIndex(predicate);
    if (foundIndex !== -1) {
      const [found] = this.messagesReceived.splice(foundIndex, 1);
      return found;
    }

    return new Promise((resolve) => {
      const listener = (msg: AnalysisWorkerInboundMessage) => {
        if (predicate(msg)) {
          this.messageCallbacks = this.messageCallbacks.filter((cb) => cb !== listener);
          const idx = this.messagesReceived.indexOf(msg);
          if (idx !== -1) this.messagesReceived.splice(idx, 1);
          resolve(msg);
        }
      };
      this.messageCallbacks.push(listener);
    });
  }

  public emitCompletion(requestId: string, trackId: string, result: TrackAnalysis): void {
    if (!this.onmessage) return;
    this.onmessage({
      data: {
        type: 'ANALYSIS_COMPLETE',
        requestId,
        trackId,
        result,
        durationMs: 10,
      },
    } as MessageEvent<AnalysisWorkerOutboundMessage>);
  }

  public terminate(): void {
    this.isTerminated = true;
    this.messageCallbacks = [];
  }
}

describe('Fase 23.4: Etapa B — Identidad SHA-256, Persistencia y Concurrencia', () => {
  let storage: IndexedDBStorage;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    storage = new IndexedDBStorage();
    await audioEngine.initialize();
    djStore.unloadDeckA();
    djStore.unloadDeckB();
  });

  afterEach(() => {
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  // 1. Importación de un archivo: su huella corresponde al contenido real.
  it('1. Importación de archivo: genera y almacena la huella SHA-256 correspondiente al contenido binario real', async () => {
    const content = new TextEncoder().encode('audio_binary_stream_track_content_1');
    const file = new File([content], 'real_track.mp3', { type: 'audio/mpeg' });
    const expectedHash = await computeFileHash(file);

    const track = createTrackFromFile(file, 180, expectedHash);
    const saveResult = await storage.saveTrack(track, file);

    assert.equal(saveResult.persisted, true);
    const retrieved = await storage.getTrack(track.id);
    assert.ok(retrieved);
    assert.equal(retrieved?.fileMeta?.contentHash, expectedHash);
    assert.match(retrieved!.fileMeta!.contentHash!, /^[0-9a-f]{64}$/);
  });

  // 2. Mismo contenido con distinto nombre o fecha: identidad de contenido equivalente.
  it('2. Mismo contenido con distinto nombre o fecha: genera exactamente la misma identidad criptográfica', async () => {
    const buffer = new Uint8Array([55, 66, 77, 88, 99]);
    const file1 = new File([buffer], 'session1.wav', { type: 'audio/wav', lastModified: 10000 });
    const file2 = new File([buffer], 'session2_renamed.mp3', { type: 'audio/mpeg', lastModified: 999999 });

    const hash1 = await computeFileHash(file1);
    const hash2 = await computeFileHash(file2);

    assert.equal(hash1, hash2);
  });

  // 3. Contenido distinto con metadatos iguales: identidad diferente.
  it('3. Contenido distinto con metadatos idénticos (mismo nombre, tamaño y tipo): produce huellas diferentes', async () => {
    const size = 1000;
    const bytesA = new Uint8Array(size).fill(0xaa);
    const bytesB = new Uint8Array(size).fill(0xbb);

    const fileA = new File([bytesA], 'track.mp3', { type: 'audio/mpeg', lastModified: 50000 });
    const fileB = new File([bytesB], 'track.mp3', { type: 'audio/mpeg', lastModified: 50000 });

    const hashA = await computeFileHash(fileA);
    const hashB = await computeFileHash(fileB);

    assert.notEqual(hashA, hashB);
  });

  // 4. Análisis antiguo que termina después del análisis nuevo: no sobrescribe el resultado nuevo.
  it('4. Análisis antiguo que termina después del análisis nuevo: no sobrescribe el resultado más reciente', async () => {
    const createdWorkers: ControllableMockWorker[] = [];
    const service = new AnalysisService({ maxConcurrency: 2 }, () => {
      const w = new ControllableMockWorker();
      createdWorkers.push(w);
      return w;
    });
    const syncManager = new AnalysisSyncManager(service, storage, async () => ({
      duration: 100, sampleRate: 44100, getChannelData: () => new Float32Array(100),
    } as unknown as AudioBuffer));

    const file = new File([new Uint8Array([1, 2, 3])], 'song.mp3');
    const track = createTrackFromFile(file, 120);
    await storage.saveTrack(track, file);

    // Iniciar primer análisis (Request 1)
    const p1 = syncManager.analyzeTrack(track);
    while (createdWorkers.length === 0) {
      await new Promise((r) => setTimeout(r, 2));
    }
    const worker1 = createdWorkers[0];
    const msg1 = await worker1.waitForMessage(track.id);
    const req1Id = msg1.requestId;

    // Iniciar segundo análisis (Request 2) forzando re-análisis
    const p2 = syncManager.analyzeTrack(track, { force: true });
    while (createdWorkers.length < 2) {
      await new Promise((r) => setTimeout(r, 2));
    }
    const worker2 = createdWorkers[1];
    const msg2 = await worker2.waitForMessage(track.id);
    const req2Id = msg2.requestId;

    // Resolver Request 2 primero con BPM 135
    worker2.emitCompletion(req2Id, track.id, {
      status: 'analyzed',
      bpm: 135.0,
      key: 'Am',
      camelot: '8A',
    });
    await p2;

    let current = await storage.getTrackAnalysis(track.id);
    assert.equal(current?.bpm, 135.0);

    // Resolver Request 1 tardíamente con BPM 110 (worker1 emite respuesta tardía)
    worker1.emitCompletion(req1Id, track.id, {
      status: 'analyzed',
      bpm: 110.0,
      key: 'Fm',
      camelot: '4A',
    });
    await p1;

    // El resultado almacenado debe mantenerse en 135.0
    current = await storage.getTrackAnalysis(track.id);
    assert.equal(current?.bpm, 135.0);

    service.destroy();
  });

  // 5. Secuencia de selección A → B → A: el resultado de la primera selección de A no contamina la segunda.
  it('5. Secuencia A → B → A: el resultado de la primera selección de A no contamina la segunda selección de A', async () => {
    const mockWorker = new ControllableMockWorker();
    const service = new AnalysisService({ maxConcurrency: 1 }, () => mockWorker);
    const syncManager = new AnalysisSyncManager(service, storage, async () => ({
      duration: 120, sampleRate: 44100, getChannelData: () => new Float32Array(100),
    } as unknown as AudioBuffer));
    const unsub = syncManager.subscribe((id, analysis, meta) => {
      djStore.handleAnalysisUpdated(id, analysis, meta);
    });

    const fileA1 = new File([new Uint8Array([10, 20])], 'trackA.mp3');
    const trackA = createTrackFromFile(fileA1, 120);
    trackA.id = 'track_A_unique';
    await storage.saveTrack(trackA, fileA1);

    const fileB = new File([new Uint8Array([30, 40])], 'trackB.mp3');
    const trackB = createTrackFromFile(fileB, 140);
    trackB.id = 'track_B_unique';
    trackB.analysis = { status: 'analyzed', bpm: 140.0, key: 'Am' };
    await storage.saveTrack(trackB, fileB);

    // 1. Cargar A en Deck A (Selección A1)
    await djStore.loadTrackToDeckA(trackA);
    const tokenA1 = (djStore as unknown as { deckSelections: { A: { selectionToken: number } } }).deckSelections.A.selectionToken;
    const pAnalysis1 = syncManager.analyzeTrack(trackA, { deckId: 'A', selectionToken: tokenA1 });
    const msg1 = await mockWorker.waitForMessage(trackA.id);

    // 2. Cargar B en Deck A (Selección B)
    await djStore.loadTrackToDeckA(trackB);
    assert.equal(djStore.getSnapshot().deckA.track?.id, 'track_B_unique');
    assert.equal(djStore.getSnapshot().deckA.calculatedBpm, 140.0);

    // 3. Volver a cargar A en Deck A (Selección A2)
    await djStore.loadTrackToDeckA(trackA);
    assert.equal(djStore.getSnapshot().deckA.track?.id, 'track_A_unique');
    const tokenA2 = (djStore as unknown as { deckSelections: { A: { selectionToken: number } } }).deckSelections.A.selectionToken;

    // 4. Finaliza el análisis iniciado en la Selección A1 con BPM 115
    mockWorker.emitCompletion(msg1.requestId, trackA.id, {
      status: 'analyzed',
      bpm: 115.0,
      key: 'Gm',
      camelot: '6A',
    });
    await pAnalysis1;

    // 5. Deck A no debe ser contaminado por la solicitud obsoleta de selección 1
    // (Deck A aún no tiene análisis vigente porque la selección activa es la A2)
    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.id, 'track_A_unique');
    assert.notEqual(snap.deckA.calculatedBpm, 115.0);
    assert.equal(snap.deckA.calculatedBpm, null);
    assert.notEqual(snap.deckA.track?.analysis?.bpm, 115.0);
    assert.notEqual(snap.deckA.track?.analysis?.status, 'analyzed');

    // 6. Demostrar positivamente que la Selección A2 sí puede procesar y recibir su propio análisis legítimo
    const pAnalysis2 = syncManager.analyzeTrack(trackA, { deckId: 'A', selectionToken: tokenA2, force: true });
    const msg2 = await mockWorker.waitForMessage(trackA.id);
    mockWorker.emitCompletion(msg2.requestId, trackA.id, {
      status: 'analyzed',
      bpm: 128.0,
      key: 'Am',
      camelot: '8A',
    });
    await pAnalysis2;

    const snap2 = djStore.getSnapshot();
    assert.equal(snap2.deckA.calculatedBpm, 128.0);
    assert.equal(snap2.deckA.keyStr, 'Am (8A)');
    assert.equal(snap2.deckA.track?.analysis?.bpm, 128.0);
    assert.equal(snap2.deckA.track?.analysis?.status, 'analyzed');

    unsub();
    service.destroy();
  });

  // 6. Resultado de Worker correspondiente a otra pista: rechazado.
  it('6. Resultado de Worker con trackId no coincidente: es rechazado por AnalysisService sin propagarse', async () => {
    let capturedWorker: ControllableMockWorker | null = null;
    const service = new AnalysisService({ maxConcurrency: 1 }, () => {
      capturedWorker = new ControllableMockWorker();
      return capturedWorker;
    });

    let rejectionError: Error | null = null;
    const queuePromise = service.queueAnalysis('target_track_1', new Float32Array(100), 44100)
      .catch((err) => {
        rejectionError = err;
      });

    const msg = await capturedWorker!.waitForMessage('target_track_1');

    // El worker emite mensaje con el requestId correcto pero trackId alterado a otra pista
    capturedWorker!.onmessage?.({
      data: {
        type: 'ANALYSIS_COMPLETE',
        requestId: msg.requestId,
        trackId: 'malicious_or_wrong_track_2',
        result: { status: 'analyzed', bpm: 120 },
        durationMs: 5,
      },
    } as MessageEvent<AnalysisWorkerOutboundMessage>);

    await queuePromise;

    // Debe haber sido rechazado con error explícito
    assert.ok(rejectionError);
    assert.match((rejectionError as Error).message, /Resultado de Worker rechazado/);
    assert.equal(service.isAnalyzing('target_track_1'), false);

    service.destroy();
  });

  // 7. Registro existente sin contentHash: no hereda confirmaciones manuales sin verificar identidad.
  it('7. Registro antiguo sin contentHash: no transfiere confirmaciones manuales (mainCue, hotCues) a una nueva versión', async () => {
    const rawContent = new TextEncoder().encode('legacy_track_no_hash');
    const legacyFile = new File([rawContent], 'legacy.mp3');

    // Registro legado sin contentHash
    const legacyRecord: Track = {
      id: 'legacy_track_7',
      title: 'Legacy Song',
      artist: 'Artist',
      duration: 200,
      durationFormatted: '3:20',
      type: 'audio',
      source: { type: 'indexeddb', blob: legacyFile, indexedDbKey: 'legacy_track_7' },
      analysis: { status: 'analyzed', bpm: 120.0 },
      fileMeta: {
        fileName: 'legacy.mp3',
        fileSize: legacyFile.size,
        mimeType: 'audio/mpeg',
        lastModified: 1000,
      },
      mainCue: 15.5,
      hotCues: [
        { id: 1, position: 20.0, trackId: 'legacy_track_7', color: '#ff0000', createdAt: 1000 },
      ],
      dateAdded: 1000,
    };

    // Guardar forzando omisión de contentHash para simular registro preexistente
    await storage.saveTrack(legacyRecord, legacyFile);
    // Eliminar contentHash manualmente para simular una versión anterior de IndexedDB
    const db = await storage.init();
    await new Promise<void>((resolve) => {
      const tx = db!.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      const getReq = store.get('legacy_track_7');
      getReq.onsuccess = () => {
        const rec = getReq.result;
        delete rec.fileMeta.contentHash;
        store.put(rec);
      };
      tx.oncomplete = () => resolve();
    });

    // Ahora se guarda una nueva pista bajo el mismo ID con contentHash verificado
    const newFile = new File([new TextEncoder().encode('new_audio_content')], 'legacy.mp3');
    const newHash = await computeFileHash(newFile);
    const incomingTrack = createTrackFromFile(newFile, 200, newHash);
    incomingTrack.id = 'legacy_track_7';

    await storage.saveTrack(incomingTrack, newFile);

    const stored = await storage.getTrack('legacy_track_7');
    assert.ok(stored);
    assert.equal(stored?.fileMeta?.contentHash, newHash);
    // No debe heredar las confirmaciones manuales porque el registro original no tenía identidad demostrada
    assert.equal(stored?.mainCue, null);
    assert.deepEqual(stored?.hotCues, []);
  });

  // 8. Huella diferente en un registro existente: los datos manuales dependientes del contenido no se conservan indebidamente.
  it('8. Huella diferente en registro existente: invalida análisis previo, mainCue y hotCues forzosamente', async () => {
    const fileA = new File([new TextEncoder().encode('original_audio')], 'song.mp3');
    const hashA = await computeFileHash(fileA);
    const trackA = createTrackFromFile(fileA, 150, hashA);
    trackA.id = 'track_diff_hash_8';
    trackA.mainCue = 12.0;
    trackA.hotCues = [{ id: 1, position: 24.0, trackId: trackA.id, color: '#00ff00', createdAt: 1000 }];

    await storage.saveTrack(trackA, fileA);
    await storage.updateTrackAnalysis(trackA.id, { status: 'analyzed', bpm: 126.0 });

    // Guardar nuevo contenido binario con distinto hash bajo el mismo ID
    const fileB = new File([new TextEncoder().encode('completely_different_audio')], 'song.mp3');
    const hashB = await computeFileHash(fileB);
    assert.notEqual(hashA, hashB);

    const trackB = createTrackFromFile(fileB, 150, hashB);
    trackB.id = 'track_diff_hash_8';

    await storage.saveTrack(trackB, fileB);

    const retrieved = await storage.getTrack('track_diff_hash_8');
    assert.ok(retrieved);
    assert.equal(retrieved?.fileMeta?.contentHash, hashB);
    assert.equal(retrieved?.analysis.status, 'pending');
    assert.equal(retrieved?.mainCue, null);
    assert.deepEqual(retrieved?.hotCues, []);
  });

  // 9. Huella coincidente: se conservan los datos permitidos por el contrato.
  it('9. Huella coincidente: conserva mainCue, hotCues y análisis existente cuando la pista entrante no los define', async () => {
    const file = new File([new TextEncoder().encode('same_audio_bytes')], 'song.mp3');
    const hash = await computeFileHash(file);

    const track1 = createTrackFromFile(file, 160, hash);
    track1.id = 'track_same_hash_9';
    track1.mainCue = 18.0;
    const cues: HotCue[] = [{ id: 1, position: 36.0, trackId: track1.id, color: '#0000ff', createdAt: 2000 }];
    track1.hotCues = cues;

    await storage.saveTrack(track1, file);
    await storage.updateTrackAnalysis(track1.id, { status: 'analyzed', bpm: 128.0, key: 'Am' });

    // Segunda escritura del mismo archivo (mismo hash) sin especificar CUEs (vienen indefinidos/vacíos)
    const track2 = createTrackFromFile(file, 160, hash);
    track2.id = 'track_same_hash_9';

    await storage.saveTrack(track2, file);

    const retrieved = await storage.getTrack('track_same_hash_9');
    assert.ok(retrieved);
    assert.equal(retrieved?.fileMeta?.contentHash, hash);
    assert.equal(retrieved?.mainCue, 18.0);
    assert.equal(retrieved?.hotCues?.length, 1);
    assert.equal(retrieved?.analysis.status, 'analyzed');
    assert.equal(retrieved?.analysis.bpm, 128.0);
  });

  // 10. Error al calcular el hash: no se marca la identidad como verificada ni se guardan confirmaciones heredadas.
  it('10. Error al calcular el hash: deja la identidad como no verificada (undefined) y no hereda confirmaciones', async () => {
    // Blob real cuyo arrayBuffer falla al calcular hash
    const faultyBlob = new Blob([new Uint8Array(500)], { type: 'audio/mpeg' });
    Object.defineProperty(faultyBlob, 'arrayBuffer', {
      value: async () => {
        throw new Error('I/O read failure on disk');
      },
    });

    const track: Track = {
      id: 'faulty_track_10',
      title: 'Faulty',
      artist: '',
      duration: 100,
      durationFormatted: '1:40',
      type: 'audio',
      source: { type: 'indexeddb', blob: faultyBlob, indexedDbKey: 'faulty_track_10' },
      analysis: { status: 'pending' },
      fileMeta: { fileName: 'faulty.mp3', fileSize: 500, mimeType: 'audio/mpeg', lastModified: 100 },
      dateAdded: 100,
    };

    const res = await storage.saveTrack(track, faultyBlob);
    assert.equal(res.persisted, true);

    const retrieved = await storage.getTrack('faulty_track_10');
    assert.ok(retrieved);
    // Identidad no verificada
    assert.equal(retrieved?.fileMeta?.contentHash, undefined);
  });

  // 11. Escrituras concurrentes: una respuesta obsoleta no sobrescribe el estado más reciente.
  it('11. Escrituras concurrentes: updateTrackAnalysis rechaza atómicamente escribir si el contentHash persistido difiere del esperado', async () => {
    const fileOriginal = new File([new TextEncoder().encode('version_1_pcm')], 'track.mp3');
    const hash1 = await computeFileHash(fileOriginal);
    const track = createTrackFromFile(fileOriginal, 120, hash1);
    track.id = 'concurrent_track_11';
    await storage.saveTrack(track, fileOriginal);

    // Se simula que mientras un análisis computaba para hash1, entra un nuevo archivo version 2
    const fileNew = new File([new TextEncoder().encode('version_2_pcm')], 'track.mp3');
    const hash2 = await computeFileHash(fileNew);
    assert.notEqual(hash1, hash2);

    const trackV2 = createTrackFromFile(fileNew, 120, hash2);
    trackV2.id = 'concurrent_track_11';
    await storage.saveTrack(trackV2, fileNew);

    // Ahora llega el resultado del primer análisis esperando hash1
    const writeResult = await storage.updateTrackAnalysis(
      'concurrent_track_11',
      { status: 'analyzed', bpm: 100.0 },
      hash1 // Expected hash1, pero en almacenamiento ya está hash2
    );

    // Debe ser rechazado
    assert.equal(writeResult, false);

    // El registro no debe haber sido sobrescrito con el BPM 100.0 del análisis desfasado
    const current = await storage.getTrack('concurrent_track_11');
    assert.equal(current?.fileMeta?.contentHash, hash2);
    assert.equal(current?.analysis.bpm, undefined);
  });

  // 12. Compatibilidad de lectura con registros IndexedDB antiguos que no contienen contentHash.
  it('12. Compatibilidad retroactiva: lectura transparente de registros antiguos sin contentHash vía getAllTracks y getTrack', async () => {
    const legacyFile = new File([new Uint8Array([7, 8, 9])], 'antique.mp3');
    const legacyRecord: Track = {
      id: 'antique_track_12',
      title: 'Antique Song',
      artist: 'Old Band',
      duration: 210,
      durationFormatted: '3:30',
      type: 'audio',
      source: { type: 'indexeddb', blob: legacyFile, indexedDbKey: 'antique_track_12' },
      analysis: { status: 'analyzed', bpm: 118.0, key: 'G' },
      fileMeta: {
        fileName: 'antique.mp3',
        fileSize: 3,
        mimeType: 'audio/mpeg',
        lastModified: 500,
      },
      dateAdded: 500,
    };

    // Inyectar directamente en IndexedDB simulando una base de datos antigua
    const db = await storage.init();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      store.put({
        ...legacyRecord,
        audioBlob: legacyFile,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // 1. Lectura individual
    const single = await storage.getTrack('antique_track_12');
    assert.ok(single);
    assert.equal(single?.id, 'antique_track_12');
    assert.equal(single?.fileMeta?.contentHash, undefined);
    assert.equal(single?.analysis.bpm, 118.0);

    // 2. Lectura masiva
    const all = await storage.getAllTracks();
    const found = all.find((t) => t.id === 'antique_track_12');
    assert.ok(found);
    assert.equal(found?.title, 'Antique Song');
    assert.equal(found?.fileMeta?.contentHash, undefined);
  });

  // 13. Corrección 1: Fallo en computeFileHash durante saveTrack no conserva una huella ajena heredada
  it('13. Fallo en computeFileHash durante saveTrack no conserva una huella ajena heredada en el registro guardado', async () => {
    const faultyBlob = new Blob([new Uint8Array(200)], { type: 'audio/mpeg' });
    Object.defineProperty(faultyBlob, 'arrayBuffer', {
      value: async () => {
        throw new Error('Disk read error');
      },
    });

    // Pista que hereda artificialmente una huella previa ajena
    const trackWithInheritedHash: Track = {
      id: 'inherited_hash_track_13',
      title: 'Inherited Hash Track',
      artist: '',
      duration: 100,
      durationFormatted: '1:40',
      type: 'audio',
      source: { type: 'indexeddb', blob: faultyBlob, indexedDbKey: 'inherited_hash_track_13' },
      analysis: { status: 'pending' },
      fileMeta: {
        fileName: 'inherited.mp3',
        fileSize: 200,
        mimeType: 'audio/mpeg',
        lastModified: 100,
        contentHash: 'foreign_hash_abcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
      },
      dateAdded: 100,
    };

    const res = await storage.saveTrack(trackWithInheritedHash, faultyBlob);
    assert.equal(res.persisted, true);

    const stored = await storage.getTrack('inherited_hash_track_13');
    assert.ok(stored);
    // La huella ajena heredada debe haber sido eliminada y no persistida
    assert.equal(stored?.fileMeta?.contentHash, undefined);
  });

  // 14. Corrección 1: Dos blobs distintos con idéntico tamaño y hash heredado provocan recálculo obligatorio
  it('14. Dos blobs distintos con idéntico tamaño y hash heredado provocan recálculo obligatorio y no reutilizan el hash ajeno', async () => {
    const size = 500;
    const blob1 = new Blob([new Uint8Array(size).fill(0x11)], { type: 'audio/mpeg' });
    const hash1 = await computeFileHash(blob1 as File);

    const blob2 = new Blob([new Uint8Array(size).fill(0x22)], { type: 'audio/mpeg' });
    const hash2 = await computeFileHash(blob2 as File);
    assert.notEqual(hash1, hash2);

    // Track que tiene blob2 pero trae el hash de blob1 en fileMeta
    const track: Track = {
      id: 'diff_blobs_same_size_14',
      title: 'Diff Blobs',
      artist: '',
      duration: 100,
      durationFormatted: '1:40',
      type: 'audio',
      source: { type: 'indexeddb', blob: blob2, indexedDbKey: 'diff_blobs_same_size_14' },
      analysis: { status: 'pending' },
      fileMeta: {
        fileName: 'song.mp3',
        fileSize: size,
        mimeType: 'audio/mpeg',
        lastModified: 100,
        contentHash: hash1, // Hash ajeno de blob1
      },
      dateAdded: 100,
    };

    await storage.saveTrack(track, blob2);

    const stored = await storage.getTrack('diff_blobs_same_size_14');
    assert.ok(stored);
    // Debe haber recalculado el hash exacto de blob2 y no haber reutilizado hash1
    assert.equal(stored?.fileMeta?.contentHash, hash2);
  });

  // 15. Corrección 2: Worker con trackId correcto pero requestId incorrecto es rechazado sin dejar promesa colgada
  it('15. Worker con trackId correcto pero requestId incorrecto: AnalysisService rechaza explícitamente la promesa', async () => {
    let capturedWorker: ControllableMockWorker | null = null;
    const service = new AnalysisService({ maxConcurrency: 1 }, () => {
      capturedWorker = new ControllableMockWorker();
      return capturedWorker;
    });

    let rejectionError: Error | null = null;
    const queuePromise = service.queueAnalysis('track_mismatch_req_15', new Float32Array(50), 44100)
      .catch((err) => {
        rejectionError = err;
      });

    await capturedWorker!.waitForMessage('track_mismatch_req_15');

    // El worker emite mensaje con trackId correcto pero requestId incorrecto
    capturedWorker!.onmessage?.({
      data: {
        type: 'ANALYSIS_COMPLETE',
        requestId: 'completely_wrong_request_id_999',
        trackId: 'track_mismatch_req_15',
        result: { status: 'analyzed', bpm: 120 },
        durationMs: 5,
      },
    } as MessageEvent<AnalysisWorkerOutboundMessage>);

    await queuePromise;

    // La promesa no debe colgarse: debe rechazarse explícitamente con error
    assert.ok(rejectionError);
    assert.match((rejectionError as Error).message, /Resultado de Worker rechazado: requestId/);
    assert.equal(service.isAnalyzing('track_mismatch_req_15'), false);

    service.destroy();
  });

  // 16. Corrección 2: Mensaje tardío de tarea cancelada previa no cancela ni afecta una tarea activa posterior
  it('16. Mensaje tardío de tarea cancelada previa no cancela ni afecta una tarea activa posterior en el mismo worker', async () => {
    let capturedWorker: ControllableMockWorker | null = null;
    const service = new AnalysisService({ maxConcurrency: 1 }, () => {
      if (!capturedWorker) {
        capturedWorker = new ControllableMockWorker();
      }
      return capturedWorker;
    });

    // Iniciar tarea 1
    const p1 = service.queueAnalysis('track_consecutive_16', new Float32Array(50), 44100)
      .catch((err) => err);
    const msg1 = await capturedWorker!.waitForMessage('track_consecutive_16');
    const req1Id = msg1.requestId;

    // Iniciar tarea 2 (reemplaza y cancela tarea 1)
    const p2 = service.queueAnalysis('track_consecutive_16', new Float32Array(50), 44100);
    let msg2 = capturedWorker!.messagesReceived.find((m) => m.requestId !== req1Id);
    while (!msg2) {
      await new Promise((r) => setTimeout(r, 2));
      msg2 = capturedWorker!.messagesReceived.find((m) => m.requestId !== req1Id);
    }
    const req2Id = msg2.requestId;

    // Tarea 1 debe haber sido cancelada
    const err1 = await p1;
    assert.ok(err1 instanceof Error);

    // El worker emite respuesta tardía para la tarea 1 cancelada
    capturedWorker!.onmessage?.({
      data: {
        type: 'ANALYSIS_COMPLETE',
        requestId: req1Id,
        trackId: 'track_consecutive_16',
        result: { status: 'analyzed', bpm: 110 },
        durationMs: 5,
      },
    } as MessageEvent<AnalysisWorkerOutboundMessage>);

    // Tarea 2 debe seguir activa y no haber sido cancelada ni rechazada
    assert.equal(service.isAnalyzing('track_consecutive_16'), true);

    // El worker emite la respuesta para la tarea 2
    capturedWorker!.onmessage?.({
      data: {
        type: 'ANALYSIS_COMPLETE',
        requestId: req2Id,
        trackId: 'track_consecutive_16',
        result: { status: 'analyzed', bpm: 128 },
        durationMs: 5,
      },
    } as MessageEvent<AnalysisWorkerOutboundMessage>);

    const res2 = await p2;
    assert.equal(res2.bpm, 128);

    service.destroy();
  });

  // 17. Corrección 3: Notificación sin deckId ni selectionToken no altera una selección activa
  it('17. Notificación sin deckId ni selectionToken no altera un deck que tiene una selección activa', async () => {
    const file = new File([new TextEncoder().encode('track_selection_17')], 'song.mp3');
    const track = createTrackFromFile(file, 120);
    track.id = 'track_selection_17';
    await storage.saveTrack(track, file);

    // Cargar en Deck A
    await djStore.loadTrackToDeckA(track);
    const snapBefore = djStore.getSnapshot();
    assert.equal(snapBefore.deckA.track?.id, 'track_selection_17');
    assert.equal(snapBefore.deckA.calculatedBpm, null);

    // Notificación incompleta sin deckId ni selectionToken
    djStore.handleAnalysisUpdated('track_selection_17', {
      status: 'analyzed',
      bpm: 155.0,
      key: 'Cm',
    });

    // Deck A no debe ser alterado
    const snapAfter = djStore.getSnapshot();
    assert.equal(snapAfter.deckA.calculatedBpm, null);
    assert.equal(snapAfter.deckA.track?.analysis?.status, 'pending');
  });

  // 18. Corrección 3: Actualización global de biblioteca para otra pista no altera el deck activo
  it('18. Actualización global de biblioteca para otra pista no altera el deck activo', async () => {
    const fileA = new File([new TextEncoder().encode('track_active_18')], 'songA.mp3');
    const trackA = createTrackFromFile(fileA, 120);
    trackA.id = 'track_active_18';
    await storage.saveTrack(trackA, fileA);

    await djStore.loadTrackToDeckA(trackA);

    // Actualización global para otra pista diferente
    djStore.handleAnalysisUpdated('track_other_18', {
      status: 'analyzed',
      bpm: 130.0,
      key: 'Dm',
    });

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.id, 'track_active_18');
    assert.equal(snap.deckA.calculatedBpm, null);
  });

  // 19. Corrección 3: Dos decks procesan solicitudes independientes sin interferencia cruzada
  it('19. Dos decks con solicitudes independientes procesan y reciben su análisis sin interferencia cruzada', async () => {
    const fileA = new File([new TextEncoder().encode('deck_a_file_19')], 'songA.mp3');
    const hashA = await computeFileHash(fileA);
    const trackA = createTrackFromFile(fileA, 120, hashA);
    trackA.id = 'track_deck_a_19';
    await storage.saveTrack(trackA, fileA);

    const fileB = new File([new TextEncoder().encode('deck_b_file_19')], 'songB.mp3');
    const hashB = await computeFileHash(fileB);
    const trackB = createTrackFromFile(fileB, 130, hashB);
    trackB.id = 'track_deck_b_19';
    await storage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    const snapInitial = djStore.getSnapshot();
    assert.equal(snapInitial.deckA.calculatedBpm, null);
    assert.equal(snapInitial.deckB.calculatedBpm, null);

    // Actualizar Deck A con su deckId y selectionToken correcto
    const tokenA = (djStore as unknown as { deckSelections: { A: { selectionToken: number } } }).deckSelections.A.selectionToken;
    djStore.handleAnalysisUpdated(
      'track_deck_a_19',
      { status: 'analyzed', bpm: 122.0, key: 'Am' },
      { deckId: 'A', selectionToken: tokenA, contentHash: hashA }
    );

    // Solo Deck A debe haberse actualizado
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.calculatedBpm, 122.0);
    assert.equal(snap.deckB.calculatedBpm, null);

    // Actualizar Deck B con su deckId y selectionToken correcto
    const tokenB = (djStore as unknown as { deckSelections: { B: { selectionToken: number } } }).deckSelections.B.selectionToken;
    djStore.handleAnalysisUpdated(
      'track_deck_b_19',
      { status: 'analyzed', bpm: 134.0, key: 'Gm' },
      { deckId: 'B', selectionToken: tokenB, contentHash: hashB }
    );

    // Ambos decks deben reflejar su respectivo análisis independiente
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.calculatedBpm, 122.0);
    assert.equal(snap.deckB.calculatedBpm, 134.0);
  });
});
