/**
 * SYSTEM DJ — Test Suite: Fase 22 — Etapa 6.2
 * Pruebas Integrales de Persistencia, Recuperación en Frío y Prevención de Duplicados
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
import type { TrackAnalysis } from '../src/types/track.ts';
import type {
  AnalysisWorkerInboundMessage,
  AnalysisWorkerOutboundMessage,
} from '../src/types/analysis.ts';

class MockWorkerAdapter implements IAnalysisWorker {
  public onmessage: ((event: MessageEvent<AnalysisWorkerOutboundMessage>) => void) | null = null;
  public onerror: ((event: ErrorEvent | Error) => void) | null = null;
  public isTerminated = false;

  private delayMs: number;
  private resultToEmit: TrackAnalysis | null;
  private timer: NodeJS.Timeout | null = null;

  constructor(delayMs = 10, resultToEmit: TrackAnalysis | null = null) {
    this.delayMs = delayMs;
    this.resultToEmit = resultToEmit;
  }

  public postMessage(message: AnalysisWorkerInboundMessage): void {
    if (this.isTerminated || message.type !== 'START_ANALYSIS') return;

    this.timer = setTimeout(() => {
      if (this.isTerminated) return;

      const defaultAnalysis: TrackAnalysis = this.resultToEmit || {
        status: 'analyzed',
        bpm: 126.0,
        bpmConfidence: 0.96,
        key: 'Am',
        camelot: '8A',
        keyConfidence: 0.91,
        energy: 7.8,
        waveformPeaks: [0.1, 0.4, 0.7, 0.3],
      };

      const response: AnalysisWorkerOutboundMessage = {
        type: 'ANALYSIS_COMPLETE',
        requestId: message.requestId,
        trackId: message.trackId,
        result: defaultAnalysis,
        durationMs: 8,
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

function createTestAudioFile(name = 'track.mp3', size = 5120): File {
  const data = new Uint8Array(size);
  return new File([data], name, { type: 'audio/mpeg', lastModified: Date.now() });
}

function createMockAudioDecoder(pcmLength = 44100, sampleRate = 44100) {
  return async (): Promise<AudioBuffer> => {
    const channelData = new Float32Array(pcmLength);
    for (let i = 0; i < pcmLength; i++) {
      channelData[i] = 0.2 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
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

describe('Fase 22 — Etapa 6.2: Persistencia, Recuperación en Frío y Prevención de Duplicados', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.clearAll();
  });

  afterEach(async () => {
    await storage.clearAll();
  });

  it('6.2.1 Persistencia multi-sesión: las pistas y sus métricas sobreviven al reinicio en frío sin memoria compartida', async () => {
    // Sesión 1: Guardar 3 pistas con estados de análisis dispares
    const file1 = createTestAudioFile('house_session1.mp3', 10240);
    const track1 = createTrackFromFile(file1, 240);
    track1.id = 'track_house_01';
    track1.analysis = {
      status: 'analyzed',
      bpm: 124.0,
      bpmConfidence: 0.98,
      key: 'C',
      camelot: '8B',
      keyConfidence: 0.95,
      energy: 7.2,
      waveformPeaks: [0.15, 0.45, 0.85, 0.35],
    };

    const file2 = createTestAudioFile('techno_session1.mp3', 8192);
    const track2 = createTrackFromFile(file2, 360);
    track2.id = 'track_techno_02';
    track2.analysis = {
      status: 'analyzed',
      bpm: 135.0,
      bpmConfidence: 0.94,
      key: 'F#m',
      camelot: '11A',
      keyConfidence: 0.89,
      energy: 8.9,
      waveformPeaks: [0.3, 0.6, 0.9, 0.7],
    };

    const file3 = createTestAudioFile('ambient_session1.mp3', 4096);
    const track3 = createTrackFromFile(file3, 180);
    track3.id = 'track_ambient_03';
    track3.analysis = {
      status: 'unsupported',
      analysisError: 'Audio sin estructura rítmica clara',
    };

    const res1 = await storage.saveTrack(track1, file1);
    const res2 = await storage.saveTrack(track2, file2);
    const res3 = await storage.saveTrack(track3, file3);

    assert.equal(res1.persisted, true);
    assert.equal(res2.persisted, true);
    assert.equal(res3.persisted, true);

    // Simular cierre completo de sesión y desconexión
    // Sesión 2: Crear una instancia totalmente nueva de IndexedDBStorage (memoryStore vacío)
    const coldStorage = new IndexedDBStorage();

    const restoredTracks = await coldStorage.getAllTracks();
    assert.equal(restoredTracks.length, 3, 'Debe haber recuperado exactamente las 3 pistas');

    // Verificar fidelidad de la pista 1
    const recoveredT1 = restoredTracks.find((t) => t.id === 'track_house_01');
    assert.ok(recoveredT1);
    assert.equal(recoveredT1.title, 'house_session1');
    assert.equal(recoveredT1.analysis.status, 'analyzed');
    assert.equal(recoveredT1.analysis.bpm, 124.0);
    assert.equal(recoveredT1.analysis.key, 'C');
    assert.equal(recoveredT1.analysis.camelot, '8B');
    assert.equal(recoveredT1.analysis.energy, 7.2);
    assert.deepEqual(recoveredT1.analysis.waveformPeaks, [0.15, 0.45, 0.85, 0.35]);

    // Verificar fidelidad de la pista 2
    const recoveredT2 = restoredTracks.find((t) => t.id === 'track_techno_02');
    assert.ok(recoveredT2);
    assert.equal(recoveredT2.analysis.bpm, 135.0);
    assert.equal(recoveredT2.analysis.camelot, '11A');
    assert.equal(recoveredT2.analysis.energy, 8.9);

    // Verificar fidelidad de la pista 3 (unsupported sin datos inventados)
    const recoveredT3 = restoredTracks.find((t) => t.id === 'track_ambient_03');
    assert.ok(recoveredT3);
    assert.equal(recoveredT3.analysis.status, 'unsupported');
    assert.equal(recoveredT3.analysis.bpm, undefined);
    assert.equal(recoveredT3.analysis.key, undefined);

    // Verificar integridad binaria de los audioBlobs en frío
    const blob1 = await coldStorage.getTrackBlob('track_house_01');
    assert.ok(blob1);
    assert.equal(blob1.size, 10240);

    const blob2 = await coldStorage.getTrackBlob('track_techno_02');
    assert.ok(blob2);
    assert.equal(blob2.size, 8192);
  });

  it('6.2.2 Reanálisis forzado: actualiza los metadatos sin duplicar registros en IndexedDB', async () => {
    let workerExecutionCount = 0;
    const workerFactory: WorkerFactory = () => {
      workerExecutionCount++;
      return new MockWorkerAdapter(10, {
        status: 'analyzed',
        bpm: workerExecutionCount === 1 ? 120.0 : 128.0,
        bpmConfidence: 0.99,
        key: workerExecutionCount === 1 ? 'Dm' : 'Em',
        camelot: workerExecutionCount === 1 ? '7A' : '9A',
        energy: 6.0,
      });
    };

    const service = new AnalysisService({ maxConcurrency: 1 }, workerFactory);
    const syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder());

    const file = createTestAudioFile('track_reanalyze.mp3', 6000);
    const track = createTrackFromFile(file, 120);
    await storage.saveTrack(track, file);

    // 1. Primer análisis
    const res1 = await syncManager.analyzeTrack(track);
    assert.equal(res1.bpm, 120.0);
    assert.equal(res1.camelot, '7A');
    assert.equal(workerExecutionCount, 1);

    // Comprobar que en IndexedDB hay 1 solo registro
    let allTracks = await storage.getAllTracks();
    assert.equal(allTracks.length, 1);
    assert.equal(allTracks[0].analysis.bpm, 120.0);

    // 2. Consulta sin forzar: debe devolver el análisis existente SIN llamar al worker
    const resCached = await syncManager.analyzeTrack(track, { force: false });
    assert.equal(resCached.bpm, 120.0);
    assert.equal(workerExecutionCount, 1, 'No debe invocar el worker si el análisis ya es válido');

    // 3. Reanálisis forzado con force: true
    const resForced = await syncManager.analyzeTrack(track, { force: true });
    assert.equal(resForced.bpm, 128.0);
    assert.equal(resForced.camelot, '9A');
    assert.equal(workerExecutionCount, 2, 'Debe invocar el worker al forzar reanálisis');

    // Comprobar que en IndexedDB sigue existiendo exactamente 1 registro (sin duplicar)
    allTracks = await storage.getAllTracks();
    assert.equal(allTracks.length, 1, 'No debe haberse duplicado el registro de la pista');
    assert.equal(allTracks[0].id, track.id);
    assert.equal(allTracks[0].analysis.bpm, 128.0);
    assert.equal(allTracks[0].analysis.camelot, '9A');

    // Comprobar que el audioBlob sigue intacto tras el reanálisis
    const blob = await storage.getTrackBlob(track.id);
    assert.ok(blob);
    assert.equal(blob.size, 6000);

    service.destroy();
  });

  it('6.2.3 Prevención estricta de duplicados mediante hasDuplicate por nombre y tamaño', async () => {
    const fileName = 'song_duplicate_check.mp3';
    const fileSize = 7168;

    // Antes de guardar: no existe duplicado
    assert.equal(await storage.hasDuplicate(fileName, fileSize), false);

    const fileA = new File([new Uint8Array(fileSize)], fileName, { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 150);
    await storage.saveTrack(trackA, fileA);

    // Después de guardar: detecta el duplicado
    assert.equal(await storage.hasDuplicate(fileName, fileSize), true);

    // Mismo nombre con diferente tamaño no es duplicado
    assert.equal(await storage.hasDuplicate(fileName, fileSize + 100), false);

    // Diferente nombre con mismo tamaño no es duplicado
    assert.equal(await storage.hasDuplicate('different_song.mp3', fileSize), false);

    // Detección tras reinicio en frío
    const coldStorage = new IndexedDBStorage();
    assert.equal(await coldStorage.hasDuplicate(fileName, fileSize), true);
  });

  it('6.2.4 Aislamiento entre pistas: actualizar el análisis de una pista no afecta a los metadatos de las demás', async () => {
    const file1 = createTestAudioFile('pista_a.mp3', 4000);
    const track1 = createTrackFromFile(file1, 100);
    track1.id = 'track_A';
    track1.analysis = { status: 'analyzed', bpm: 120.0, key: 'C', camelot: '8B' };

    const file2 = createTestAudioFile('pista_b.mp3', 5000);
    const track2 = createTrackFromFile(file2, 110);
    track2.id = 'track_B';
    track2.analysis = { status: 'analyzed', bpm: 130.0, key: 'G', camelot: '9B' };

    await storage.saveTrack(track1, file1);
    await storage.saveTrack(track2, file2);

    // Actualizar exclusivamente pista A con un nuevo análisis
    const updatedA = await storage.updateTrackAnalysis('track_A', {
      status: 'analyzed',
      bpm: 122.5,
      key: 'Cm',
      camelot: '5A',
      energy: 8.0,
    });
    assert.equal(updatedA, true);

    // Verificar pista A
    const aRecord = await storage.getTrackAnalysis('track_A');
    assert.equal(aRecord?.bpm, 122.5);
    assert.equal(aRecord?.camelot, '5A');

    // Verificar que pista B permanece 100% inalterada
    const bRecord = await storage.getTrackAnalysis('track_B');
    assert.equal(bRecord?.bpm, 130.0);
    assert.equal(bRecord?.key, 'G');
    assert.equal(bRecord?.camelot, '9B');

    // Y el blob de pista B no ha sido tocado
    const blobB = await storage.getTrackBlob('track_B');
    assert.equal(blobB?.size, 5000);
  });
});
