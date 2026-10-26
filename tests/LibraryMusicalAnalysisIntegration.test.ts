/**
 * SYSTEM DJ — Test Suite: Fase 22 — Etapa 4
 * Integración del Análisis Musical en la Biblioteca Local y Acciones de Análisis
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { AnalysisSyncManager } from '../src/services/analysis/AnalysisSyncManager.ts';
import {
  AnalysisService,
  type WorkerFactory,
  type IAnalysisWorker,
} from '../src/services/analysis/AnalysisService.ts';
import { djStore } from '../src/store/useDJStore.ts';
import { keyToCamelot } from '../src/audio/analysis/camelotMapper.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import type { TrackAnalysis, AnalysisStatus } from '../src/types/track.ts';
import type {
  AnalysisWorkerInboundMessage,
  AnalysisWorkerOutboundMessage,
} from '../src/types/analysis.ts';

// Worker simulado determinista
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
        bpmConfidence: 0.95,
        key: 'F#m',
        camelot: '11A',
        keyConfidence: 0.9,
        energy: 8.4,
        waveformPeaks: [0.1, 0.5, 0.9],
      };

      if (this.onmessage) {
        this.onmessage({
          data: {
            type: 'ANALYSIS_COMPLETE',
            requestId: message.requestId,
            trackId: message.trackId,
            result: defaultAnalysis,
            durationMs: 10,
          },
        } as MessageEvent<AnalysisWorkerOutboundMessage>);
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

function createMockAudioDecoder() {
  return async (): Promise<AudioBuffer> => {
    return {
      sampleRate: 44100,
      length: 44100 * 10,
      duration: 10,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(44100 * 10),
    } as unknown as AudioBuffer;
  };
}

function createTestAudioFile(name = 'library_track.mp3', size = 4096): File {
  const data = new Uint8Array(size);
  return new File([data], name, { type: 'audio/mpeg', lastModified: Date.now() });
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

describe('Fase 22 — Etapa 4: Integración del Análisis Musical en la Biblioteca Local', () => {
  let storage: IndexedDBStorage;
  let service: AnalysisService;
  let syncManager: AnalysisSyncManager;
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    storage = new IndexedDBStorage();
    await storage.clearAll();

    const factory: WorkerFactory = () => new MockWorkerAdapter(10);
    service = new AnalysisService({ maxConcurrency: 2 }, factory);
    syncManager = new AnalysisSyncManager(service, storage, createMockAudioDecoder());

    djStore.unloadDeckA();
    djStore.unloadDeckB();
  });

  afterEach(() => {
    service.destroy();
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
  });

  it('4.1 Visualización: Expone BPM, Tonalidad, Camelot y Energía cuando existen en una pista analizada', async () => {
    const file = createTestAudioFile('track_full_analyzed.mp3');
    const track = createTrackFromFile(file, 210);
    track.analysis = {
      status: 'analyzed',
      bpm: 128.0,
      bpmConfidence: 0.98,
      key: 'F#m',
      camelot: '11A',
      energy: 8.5,
    };
    await storage.saveTrack(track, file);

    const tracks = await storage.getAllTracks();
    assert.equal(tracks.length, 1);
    const t = tracks[0];

    assert.equal(t.analysis.status, 'analyzed');
    assert.equal(t.analysis.bpm, 128.0);
    assert.equal(t.analysis.key, 'F#m');
    assert.equal(t.analysis.camelot, '11A');
    assert.equal(t.analysis.energy, 8.5);

    // Mapeo Camelot determinista para claves canónicas
    assert.equal(keyToCamelot('F#m'), '11A');
    assert.equal(keyToCamelot('Cm'), '5A');
    assert.equal(keyToCamelot('C'), '8B');
  });

  it('4.2 Indicador neutral: Muestra "—" y no inventa datos cuando el análisis no está disponible o está pendiente', async () => {
    const file = createTestAudioFile('track_pending.mp3');
    const track = createTrackFromFile(file, 180);
    // Estado inicial generado por createTrackFromFile es 'pending'
    assert.equal(track.analysis.status, 'pending');
    assert.equal(track.analysis.bpm, undefined);
    assert.equal(track.analysis.key, undefined);
    assert.equal(track.analysis.camelot, undefined);
    assert.equal(track.analysis.energy, undefined);

    await storage.saveTrack(track, file);
    const retrieved = await storage.getTrack(track.id);
    assert.ok(retrieved);
    assert.equal(retrieved.analysis.status, 'pending');
    assert.equal(retrieved.analysis.bpm, undefined);
    assert.equal(retrieved.analysis.key, undefined);
    assert.equal(retrieved.analysis.energy, undefined);
  });

  it('4.3 Representación accesible y diferenciada de los cinco estados de análisis', () => {
    const statuses: AnalysisStatus[] = ['pending', 'analyzing', 'analyzed', 'failed', 'unsupported'];

    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );
    const enJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
    );

    for (const status of statuses) {
      const esKey = esJson.library[`status_${status}`];
      const enKey = enJson.library[`status_${status}`];
      const esTitle = esJson.library[`status_${status}_title`];
      const enTitle = enJson.library[`status_${status}_title`];

      assert.ok(esKey, `Falta library.status_${status} en español`);
      assert.ok(enKey, `Falta library.status_${status} en inglés`);
      assert.ok(esTitle, `Falta library.status_${status}_title en español`);
      assert.ok(enTitle, `Falta library.status_${status}_title en inglés`);
    }

    // Las clases compartidas de insignia de estado viven en Badge.css.
    const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ui/Badge.css'), 'utf-8');
    const libraryCss = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Library.css'), 'utf-8');
    const deckModel = fs.readFileSync(path.resolve(process.cwd(), 'src/services/console/deckPanelModel.ts'), 'utf-8');
    for (const status of statuses) {
      assert.ok(
        cssContent.includes(`.status-badge-${status}`),
        `Falta clase CSS compartida .status-badge-${status} en Badge.css`
      );
    }
    // El deck muestra el estado con su propio aviso de consola, con los mismos textos de Biblioteca
    assert.ok(deckModel.includes('msg(`library.status_${shown}`)'), 'El aviso del deck reutiliza los textos de estado de Biblioteca');
    for (const status of statuses) {
      assert.ok(deckModel.includes(`'library.status_${status}_title'`), `El aviso del deck explica el estado ${status}`);
    }
    assert.equal(libraryCss.includes('.status-badge-pending'), false, 'Library no debe duplicar los estados compartidos');
  });

  it('4.4 Inicio de análisis desde la Biblioteca invocando el método real de análisis', async () => {
    const file = createTestAudioFile('track_to_analyze.mp3');
    const track = createTrackFromFile(file, 120);
    await storage.saveTrack(track, file);

    let progressEventFired = false;
    syncManager.subscribe((id, analysis) => {
      if (id === track.id && analysis.status === 'analyzing') {
        progressEventFired = true;
      }
    });

    const result = await syncManager.analyzeTrack(track);
    assert.equal(progressEventFired, true, 'Debe emitir el estado intermedio analyzing');
    assert.equal(result.status, 'analyzed');
    assert.equal(result.bpm, 126.0);
    assert.equal(result.key, 'F#m');
    assert.equal(result.camelot, '11A');

    // Verificar que quedó persistido en IndexedDB
    const fromStorage = await storage.getTrackAnalysis(track.id);
    assert.equal(fromStorage?.status, 'analyzed');
    assert.equal(fromStorage?.bpm, 126.0);
  });

  it('4.5 Actualización reactiva: los suscriptores reciben el resultado del análisis sin recargar', async () => {
    const file = createTestAudioFile('reactive_track.mp3');
    const track = createTrackFromFile(file, 90);
    await storage.saveTrack(track, file);

    const receivedStates: string[] = [];
    const unsubscribe = syncManager.subscribe((id, analysis) => {
      if (id === track.id) {
        receivedStates.push(analysis.status);
      }
    });

    await syncManager.analyzeTrack(track);
    unsubscribe();

    assert.ok(receivedStates.includes('analyzing'), 'Debe emitir analyzing');
    assert.ok(receivedStates.includes('analyzed'), 'Debe emitir analyzed');
    assert.equal(receivedStates[receivedStates.length - 1], 'analyzed');
  });

  it('4.6 Reanálisis: Permite forzar un nuevo análisis (force: true) actualizando resultados previos', async () => {
    let callCount = 0;
    const dynamicFactory: WorkerFactory = () => {
      callCount++;
      const current = callCount;
      return new MockWorkerAdapter(5, {
        status: 'analyzed',
        bpm: current === 1 ? 120.0 : 135.0,
        key: current === 1 ? 'C' : 'G',
        camelot: current === 1 ? '8B' : '9B',
      });
    };

    const dynService = new AnalysisService({ maxConcurrency: 1 }, dynamicFactory);
    const dynSyncManager = new AnalysisSyncManager(dynService, storage, createMockAudioDecoder());

    const file = createTestAudioFile('track_reanalyze.mp3');
    const track = createTrackFromFile(file, 100);
    await storage.saveTrack(track, file);

    // Primer análisis
    const res1 = await dynSyncManager.analyzeTrack(track);
    assert.equal(res1.bpm, 120.0);
    assert.equal(res1.key, 'C');

    // Reanálisis forzado
    const res2 = await dynSyncManager.analyzeTrack(track, { force: true });
    assert.equal(res2.bpm, 135.0);
    assert.equal(res2.key, 'G');
    assert.equal(res2.camelot, '9B');

    const stored = await storage.getTrackAnalysis(track.id);
    assert.equal(stored?.bpm, 135.0);
    assert.equal(stored?.key, 'G');

    dynService.destroy();
  });

  it('4.7 Prevención de solicitudes duplicadas mediante isAnalyzing', async () => {
    const file = createTestAudioFile('track_duplicate_guard.mp3');
    const track = createTrackFromFile(file, 60);
    await storage.saveTrack(track, file);

    const slowFactory: WorkerFactory = () => new MockWorkerAdapter(50);
    const slowService = new AnalysisService({ maxConcurrency: 1 }, slowFactory);
    const slowManager = new AnalysisSyncManager(slowService, storage, createMockAudioDecoder());

    // Iniciar primer análisis
    const promise1 = slowManager.analyzeTrack(track);

    // Comprobar que isAnalyzing detecta que la tarea está en curso
    assert.equal(slowManager.isAnalyzing(track.id), true);

    await promise1;
    assert.equal(slowManager.isAnalyzing(track.id), false);

    slowService.destroy();
  });

  it('4.8 Manejo de errores y posibilidad de recuperación/reintento', async () => {
    let failFirst = true;
    const recoveringFactory: WorkerFactory = () => {
      if (failFirst) {
        failFirst = false;
        const worker = new MockWorkerAdapter(5);
        worker.postMessage = () => {
          setTimeout(() => {
            if (worker.onerror) {
              worker.onerror(new Error('Audio corrupto o truncado'));
            }
          }, 5);
        };
        return worker;
      }
      return new MockWorkerAdapter(5, {
        status: 'analyzed',
        bpm: 124.0,
        key: 'Am',
        camelot: '8A',
      });
    };

    const errorService = new AnalysisService({ maxConcurrency: 1 }, recoveringFactory);
    const errorManager = new AnalysisSyncManager(errorService, storage, createMockAudioDecoder());

    const file = createTestAudioFile('recoverable_track.mp3');
    const track = createTrackFromFile(file, 100);
    await storage.saveTrack(track, file);

    // 1. Intento que falla
    const failRes = await errorManager.analyzeTrack(track);
    assert.equal(failRes.status, 'failed');
    assert.ok(failRes.analysisError);

    let stored = await storage.getTrackAnalysis(track.id);
    assert.equal(stored?.status, 'failed');

    // 2. Reintento de recuperación (el usuario vuelve a solicitar analizar la pista fallida)
    const recoverRes = await errorManager.analyzeTrack(track, { force: true });
    assert.equal(recoverRes.status, 'analyzed');
    assert.equal(recoverRes.bpm, 124.0);
    assert.equal(recoverRes.key, 'Am');

    stored = await storage.getTrackAnalysis(track.id);
    assert.equal(stored?.status, 'analyzed');
    assert.equal(stored?.bpm, 124.0);

    errorService.destroy();
  });

  it('4.9 Eliminación de pista durante el análisis cancela la tarea y no resucita la pista', async () => {
    const file = createTestAudioFile('to_be_deleted.mp3');
    const track = createTrackFromFile(file, 80);
    await storage.saveTrack(track, file);

    const longWorkerFactory: WorkerFactory = () => new MockWorkerAdapter(40);
    const longService = new AnalysisService({ maxConcurrency: 1 }, longWorkerFactory);
    const longManager = new AnalysisSyncManager(longService, storage, createMockAudioDecoder());

    const analysisPromise = longManager.analyzeTrack(track);
    assert.equal(longManager.isAnalyzing(track.id), true);

    // El usuario elimina la pista antes de que el Worker finalice
    longManager.cancelAnalysis(track.id);
    await storage.deleteTrack(track.id);

    await analysisPromise;

    // Verificar que la pista no existe ni resucita en IndexedDB
    const exists = await storage.hasTrack(track.id);
    assert.equal(exists, false);

    const all = await storage.getAllTracks();
    assert.equal(all.length, 0);

    longService.destroy();
  });

  it('4.10 Localización estricta: Paridad de claves en español e inglés sin textos hardcodeados', () => {
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );
    const enJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
    );

    const requiredKeys = [
      'col_status',
      'status_pending',
      'status_analyzing',
      'status_analyzed',
      'status_failed',
      'status_unsupported',
      'status_pending_title',
      'status_analyzing_title',
      'status_analyzed_title',
      'status_failed_title',
      'status_unsupported_title',
      'action_analyze',
      'action_reanalyze',
      'action_cancel_analysis',
      'analysis_success',
      'analysis_failed_warning',
      'analysis_error',
      'energy_label',
      'delete_success',
      'import_partial_warning',
      'delete_error',
      'load_exception_error',
    ];

    for (const key of requiredKeys) {
      assert.ok(esJson.library[key], `Falta translation.json [es] library.${key}`);
      assert.ok(enJson.library[key], `Falta translation.json [en] library.${key}`);
      assert.equal(typeof esJson.library[key], 'string');
      assert.equal(typeof enJson.library[key], 'string');
      assert.notEqual(esJson.library[key].trim(), '');
      assert.notEqual(enJson.library[key].trim(), '');
    }

    for (const key of ['cancel', 'delete']) {
      assert.ok(esJson.common[key], `Falta translation.json [es] common.${key}`);
      assert.ok(enJson.common[key], `Falta translation.json [en] common.${key}`);
      assert.notEqual(esJson.common[key].trim(), '');
      assert.notEqual(enJson.common[key].trim(), '');
    }

    const librarySource = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/Library.tsx'), 'utf-8');
    assert.ok(librarySource.includes("t('library.import_partial_warning'"));
    assert.ok(librarySource.includes("t('library.delete_error'"));
    assert.ok(librarySource.includes("t('library.load_exception_error'"));
    assert.ok(esJson.library.import_partial_warning.includes('{{warnings}}'));
    assert.ok(enJson.library.import_partial_warning.includes('{{warnings}}'));
    assert.ok(esJson.library.delete_error.includes('{{error}}'));
    assert.ok(enJson.library.delete_error.includes('{{error}}'));
    assert.ok(esJson.library.load_exception_error.includes('{{deck}}'));
    assert.ok(enJson.library.load_exception_error.includes('{{deck}}'));
  });

  it('4.11 Tema claro y oscuro: Estilos usan exclusivamente tokens semánticos del sistema de diseño', () => {
    const badgeCss = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ui/Badge.css'), 'utf-8');

    // Las clases compartidas deben usar tokens CSS y color-mix, manteniendo la densidad del Deck.
    const analysisSectionMatch = badgeCss.indexOf('/* Shared analysis status badges used by Library and Deck. */');
    assert.ok(analysisSectionMatch !== -1, 'Debe existir la sección compartida de estados de análisis en Badge.css');

    const analysisStyles = badgeCss.slice(analysisSectionMatch);

    // No debe contener valores hex duros (#fff, #000, etc.)
    const hexPattern = /#[0-9a-fA-F]{3,6}/;
    assert.equal(
      hexPattern.test(analysisStyles),
      false,
      'Los estilos de análisis no deben contener colores hex fijos, deben usar tokens CSS'
    );

    // Debe contener tokens semánticos
    assert.ok(analysisStyles.includes('var(--color-primary-500)'));
    assert.ok(analysisStyles.includes('var(--color-success)'));
    assert.ok(analysisStyles.includes('var(--color-error)'));
    assert.ok(analysisStyles.includes('var(--color-warning)'));
    assert.ok(analysisStyles.includes('var(--text-secondary)'));
  });

  it('4.12 Ausencia de regresiones en las funcionalidades existentes de la Biblioteca (carga en Decks)', async () => {
    const file = createTestAudioFile('deck_load_test.mp3');
    const track = createTrackFromFile(file, 150);
    track.analysis = {
      status: 'analyzed',
      bpm: 125.0,
      key: 'Am',
      camelot: '8A',
    };
    await storage.saveTrack(track, file);

    // Cargar en Deck A
    const loadedA = await djStore.loadTrackToDeckA(track);
    assert.equal(loadedA, true);
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.id, track.id);
    assert.equal(snap.deckA.calculatedBpm, 125.0);
    assert.equal(snap.deckA.keyStr, 'Am (8A)');

    // Cargar en Deck B
    const loadedB = await djStore.loadTrackToDeckB(track);
    assert.equal(loadedB, true);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckB.track?.id, track.id);
    assert.equal(snap.deckB.calculatedBpm, 125.0);
    assert.equal(snap.deckB.keyStr, 'Am (8A)');
  });
});
