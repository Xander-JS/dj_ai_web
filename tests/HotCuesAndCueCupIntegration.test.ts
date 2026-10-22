/**
 * SYSTEM DJ — Test Suite: Fase 23.2
 * Implementación de 8 Hot Cues por Deck y CUE Principal con comportamiento profesional (incluido CUP)
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { djStore, HOT_CUE_COLORS } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import type { HotCue } from '../src/types/track.ts';

// Mock minimal de Web Audio API para simulación en Node.js
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
  public isStarted = false;
  public isStopped = false;

  public start(): void {
    this.isStarted = true;
  }
  public stop(): void {
    this.isStopped = true;
    if (this.onended) {
      this.onended();
    }
  }
}

class MockAudioContext {
  public state: AudioContextState = 'running';
  public currentTime = 10.0;
  public destination = new MockAudioNode() as unknown as AudioDestinationNode;

  public createGain(): GainNode {
    return new MockGainNode() as unknown as GainNode;
  }
  public createBiquadFilter(): BiquadFilterNode {
    return new MockBiquadFilterNode() as unknown as BiquadFilterNode;
  }
  public createAnalyser(): AnalyserNode {
    return new MockAnalyserNode() as unknown as AnalyserNode;
  }
  public createBufferSource(): AudioBufferSourceNode {
    return new MockAudioBufferSourceNode() as unknown as AudioBufferSourceNode;
  }
  public async decodeAudioData(
    buffer: ArrayBuffer,
    successCallback?: (decoded: AudioBuffer) => void
  ): Promise<AudioBuffer> {
    const duration = 200.0;
    const mockBuffer = {
      duration,
      numberOfChannels: 2,
      sampleRate: 44100,
      length: duration * 44100,
      getChannelData: () => new Float32Array(100),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
    if (successCallback) successCallback(mockBuffer);
    return Promise.resolve(mockBuffer);
  }
  public async resume(): Promise<void> {
    this.state = 'running';
  }
  public async close(): Promise<void> {
    this.state = 'closed';
  }
}

function createTestAudioFile(name = 'cue_test_track.mp3', size = 2048): File {
  const data = new Uint8Array(size);
  return new File([data], name, { type: 'audio/mpeg', lastModified: Date.now() });
}

describe('Fase 23.2 — Hot Cues y CUE Principal con CUP', () => {
  const originalWindow = globalThis.window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    await audioEngine.initialize();
    djStore.stopTimeLoop();
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await indexedDBStorage.clearAll();
  });

  afterEach(async () => {
    djStore.stopTimeLoop();
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await audioEngine.dispose();
    await indexedDBStorage.clearAll();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  // ==========================================
  // 1. Guardar y activar los 8 Hot Cues
  // ==========================================
  it('1.1 Debe permitir guardar y activar de forma independiente cada uno de los 8 Hot Cues', async () => {
    const file = createTestAudioFile('track_eight_cues.mp3');
    const track = createTrackFromFile(file, 200.0);
    await indexedDBStorage.saveTrack(track, file);

    const loaded = await djStore.loadTrackToDeckA(track);
    assert.equal(loaded, true);

    // Definir 8 Hot Cues en posiciones crecientes
    const cuePositions = [10.5, 25.0, 42.1, 60.0, 75.3, 90.0, 110.2, 135.0];
    for (let i = 0; i < 8; i++) {
      const cueId = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
      const success = await djStore.setHotCue('A', cueId, cuePositions[i]);
      assert.equal(success, true, `Debe guardar exitosamente el Hot Cue ${cueId}`);
    }

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.hotCues.length, 8, 'Deck A debe tener exactamente 8 Hot Cues');

    for (let i = 0; i < 8; i++) {
      const cueId = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
      const cue = snap.deckA.hotCues.find((c: HotCue) => c.id === cueId);
      assert.ok(cue, `El Hot Cue ${cueId} debe existir`);
      assert.equal(cue.position, cuePositions[i]);
      assert.equal(cue.trackId, track.id);
      assert.equal(cue.label, `Cue ${cueId}`);
      assert.equal(cue.color, HOT_CUE_COLORS[i]);
      assert.ok(cue.createdAt > 0);
      assert.ok(cue.updatedAt > 0);
    }

    // Probar activación de cada Hot Cue
    for (let i = 0; i < 8; i++) {
      const cueId = (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
      djStore.jumpToHotCue('A', cueId);
      assert.equal(djStore.getSnapshot().deckA.currentTime, cuePositions[i]);
    }
  });

  // ==========================================
  // 2. Reasignación y eliminación de marcadores
  // ==========================================
  it('2.1 Debe permitir reasignar la posición de un Hot Cue existente y actualizar updatedAt', async () => {
    const file = createTestAudioFile('track_reassign.mp3');
    const track = createTrackFromFile(file, 200.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    await djStore.setHotCue('A', 3, 30.0);
    const initialCue = djStore.getSnapshot().deckA.hotCues.find((c: HotCue) => c.id === 3);
    assert.ok(initialCue);
    assert.equal(initialCue.position, 30.0);
    const initialUpdatedAt = initialCue.updatedAt;

    // Pequeño retardo simulado para verificar cambio en updatedAt
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Reasignar Hot Cue 3 a 75.0s
    const updated = await djStore.setHotCue('A', 3, 75.0);
    assert.equal(updated, true);

    const reallocatedCue = djStore.getSnapshot().deckA.hotCues.find((c: HotCue) => c.id === 3);
    assert.ok(reallocatedCue);
    assert.equal(reallocatedCue.position, 75.0);
    assert.ok(reallocatedCue.updatedAt >= initialUpdatedAt);

    // Salto al cue reasignado
    djStore.jumpToHotCue('A', 3);
    assert.equal(djStore.getSnapshot().deckA.currentTime, 75.0);
  });

  it('2.2 Debe permitir eliminar un Hot Cue y no realizar salto sobre un slot vacío', async () => {
    const file = createTestAudioFile('track_delete.mp3');
    const track = createTrackFromFile(file, 200.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    await djStore.setHotCue('A', 2, 20.0);
    assert.equal(djStore.getSnapshot().deckA.hotCues.length, 1);

    // Posición previa
    djStore.seekDeckA(50.0);
    assert.equal(djStore.getSnapshot().deckA.currentTime, 50.0);

    // Eliminar Hot Cue 2
    const deleted = await djStore.deleteHotCue('A', 2);
    assert.equal(deleted, true);
    assert.equal(djStore.getSnapshot().deckA.hotCues.length, 0);

    // Intentar saltar al Hot Cue 2 eliminado no debe alterar la posición
    djStore.jumpToHotCue('A', 2);
    assert.equal(djStore.getSnapshot().deckA.currentTime, 50.0, 'No debe cambiar la posición si el cue está vacío');
  });

  // ==========================================
  // 3. Rechazar posiciones inválidas
  // ==========================================
  it('3.1 Debe rechazar posiciones negativas, no finitas o que excedan la duración de la pista', async () => {
    const file = createTestAudioFile('track_invalid_pos.mp3');
    const track = createTrackFromFile(file, 100.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    // Posiciones inválidas para Hot Cues
    assert.equal(await djStore.setHotCue('A', 1, -0.1), false, 'Debe rechazar posición negativa');
    assert.equal(await djStore.setHotCue('A', 1, NaN), false, 'Debe rechazar NaN');
    assert.equal(await djStore.setHotCue('A', 1, Infinity), false, 'Debe rechazar Infinity');
    assert.equal(await djStore.setHotCue('A', 1, -Infinity), false, 'Debe rechazar -Infinity');
    assert.equal(await djStore.setHotCue('A', 1, 250.0), false, 'Debe rechazar posición > duración');

    // Slot fuera de rango 1..8
    assert.equal(await djStore.setHotCue('A', 0, 10.0), false, 'Debe rechazar slot 0');
    assert.equal(await djStore.setHotCue('A', 9, 10.0), false, 'Debe rechazar slot 9');

    assert.equal(djStore.getSnapshot().deckA.hotCues.length, 0, 'No debe haberse guardado ningún Hot Cue');

    // Posiciones inválidas para Main CUE
    await djStore.setMainCue('A', -1.0);
    assert.equal(djStore.getSnapshot().deckA.mainCue, null, 'Debe rechazar Main CUE negativo');
    await djStore.setMainCue('A', NaN);
    assert.equal(djStore.getSnapshot().deckA.mainCue, null, 'Debe rechazar Main CUE NaN');
    await djStore.setMainCue('A', 250.0);
    assert.equal(djStore.getSnapshot().deckA.mainCue, null, 'Debe rechazar Main CUE > duración');
  });

  // ==========================================
  // 4. Persistencia y recuperación de los ocho marcadores
  // ==========================================
  it('4.1 Debe persistir los 8 Hot Cues y Main Cue en IndexedDB y recuperarlos al recargar la pista', async () => {
    const file = createTestAudioFile('track_persist.mp3');
    const track = createTrackFromFile(file, 200.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    // Fijar Main Cue en 12.0s y 8 Hot Cues
    await djStore.setMainCue('A', 12.0);
    for (let i = 1; i <= 8; i++) {
      await djStore.setHotCue('A', i as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, i * 15.0);
    }

    // Verificar directamente en IndexedDB
    const persistedCues = await indexedDBStorage.getTrackCues(track.id);
    assert.ok(persistedCues);
    assert.equal(persistedCues.mainCue, 12.0);
    assert.equal(persistedCues.hotCues?.length, 8);

    // Descargar Deck A
    djStore.unloadDeckA();
    assert.equal(djStore.getSnapshot().deckA.track, null);
    assert.equal(djStore.getSnapshot().deckA.mainCue, null);
    assert.equal(djStore.getSnapshot().deckA.hotCues.length, 0);

    // Recargar pista en Deck A
    const reloaded = await djStore.loadTrackToDeckA(track);
    assert.equal(reloaded, true);

    const reloadedSnap = djStore.getSnapshot();
    assert.equal(reloadedSnap.deckA.mainCue, 12.0);
    assert.equal(reloadedSnap.deckA.hotCues.length, 8);
    for (let i = 1; i <= 8; i++) {
      const cue = reloadedSnap.deckA.hotCues.find((c: HotCue) => c.id === i);
      assert.ok(cue);
      assert.equal(cue.position, i * 15.0);
    }
  });

  // ==========================================
  // 5. Preservación del análisis musical
  // ==========================================
  it('5.1 Guardar, reasignar o eliminar Hot Cues no debe alterar los metadatos de análisis musical', async () => {
    const file = createTestAudioFile('track_analysis_preserve.mp3');
    const track = createTrackFromFile(file, 180.0);
    track.analysis = {
      status: 'analyzed',
      bpm: 126.0,
      bpmConfidence: 0.99,
      key: 'F#m',
      camelot: '11A',
      energy: 8.4,
      waveformPeaks: [0.1, 0.4, 0.8, 0.3],
    };
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    // Modificaciones en CUEs
    await djStore.setMainCue('A', 8.0);
    await djStore.setHotCue('A', 1, 15.0);
    await djStore.setHotCue('A', 2, 30.0);
    await djStore.setHotCue('A', 1, 18.0); // Reasignar
    await djStore.deleteHotCue('A', 2);     // Eliminar

    // Inspeccionar la pista recuperada íntegramente de IndexedDB
    const storedTrack = await indexedDBStorage.getTrack(track.id);
    assert.ok(storedTrack);
    assert.equal(storedTrack.analysis.status, 'analyzed');
    assert.equal(storedTrack.analysis.bpm, 126.0);
    assert.equal(storedTrack.analysis.bpmConfidence, 0.99);
    assert.equal(storedTrack.analysis.key, 'F#m');
    assert.equal(storedTrack.analysis.camelot, '11A');
    assert.equal(storedTrack.analysis.energy, 8.4);
    assert.deepEqual(storedTrack.analysis.waveformPeaks, [0.1, 0.4, 0.8, 0.3]);

    // Verificar que el binario de audio sigue intacto
    const audioBlob = await indexedDBStorage.getTrackBlob(track.id);
    assert.ok(audioBlob);
    assert.equal(audioBlob.size, 2048);
  });

  // ==========================================
  // 6. Asociación correcta tras cambiar de canción
  // ==========================================
  it('6.1 Cada pista mantiene sus propios Hot Cues al alternar canciones en el mismo Deck', async () => {
    const file1 = createTestAudioFile('song1.mp3');
    const track1 = createTrackFromFile(file1, 150.0);
    await indexedDBStorage.saveTrack(track1, file1);

    const file2 = createTestAudioFile('song2.mp3');
    const track2 = createTrackFromFile(file2, 180.0);
    await indexedDBStorage.saveTrack(track2, file2);

    // Cargar Canción 1 y asignar Hot Cue 1 en 10.0s
    await djStore.loadTrackToDeckA(track1);
    await djStore.setHotCue('A', 1, 10.0);

    // Cargar Canción 2 en Deck A y asignar Hot Cue 1 en 45.0s
    await djStore.loadTrackToDeckA(track2);
    assert.equal(djStore.getSnapshot().deckA.hotCues.length, 0, 'Canción 2 debe iniciar sin Hot Cues');
    await djStore.setHotCue('A', 1, 45.0);

    // Volver a cargar Canción 1 en Deck A
    await djStore.loadTrackToDeckA(track1);
    const snapTrack1 = djStore.getSnapshot().deckA;
    assert.equal(snapTrack1.hotCues.length, 1);
    assert.equal(snapTrack1.hotCues[0].position, 10.0, 'Canción 1 debe recuperar su propio Hot Cue');

    // Volver a cargar Canción 2 en Deck A
    await djStore.loadTrackToDeckA(track2);
    const snapTrack2 = djStore.getSnapshot().deckA;
    assert.equal(snapTrack2.hotCues.length, 1);
    assert.equal(snapTrack2.hotCues[0].position, 45.0, 'Canción 2 debe recuperar su propio Hot Cue');
  });

  // ==========================================
  // 7. Independencia y sincronización entre Deck A y Deck B
  // ==========================================
  it('7.1 Con pistas distintas, Deck A y Deck B son totalmente independientes', async () => {
    const fileA = createTestAudioFile('deckA_track.mp3');
    const trackA = createTrackFromFile(fileA, 120.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = createTestAudioFile('deckB_track.mp3');
    const trackB = createTrackFromFile(fileB, 140.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    await djStore.setHotCue('A', 1, 20.0);
    await djStore.setMainCue('A', 5.0);

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.hotCues.length, 1);
    assert.equal(snap.deckA.mainCue, 5.0);
    assert.equal(snap.deckB.hotCues.length, 0, 'Deck B no debe verse afectado por acciones en Deck A');
    assert.equal(snap.deckB.mainCue, null);

    // Saltar en Deck A no afecta currentTime de Deck B
    djStore.seekDeckB(60.0);
    djStore.jumpToHotCue('A', 1);
    assert.equal(djStore.getSnapshot().deckA.currentTime, 20.0);
    assert.equal(djStore.getSnapshot().deckB.currentTime, 60.0, 'Deck B debe conservar su currentTime');
  });

  it('7.2 Si ambos decks tienen la misma pista, comparten CUEs reactivamente pero conservan posición independiente', async () => {
    const file = createTestAudioFile('shared_track.mp3');
    const track = createTrackFromFile(file, 200.0);
    await indexedDBStorage.saveTrack(track, file);

    await djStore.loadTrackToDeckA(track);
    await djStore.loadTrackToDeckB(track);

    // Definir Hot Cue en Deck A
    await djStore.setHotCue('A', 4, 80.0);

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.hotCues.length, 1);
    assert.equal(snap.deckB.hotCues.length, 1, 'Deck B debe sincronizar reactivamente el Hot Cue de la misma pista');
    assert.equal(snap.deckB.hotCues[0].position, 80.0);

    // Deck B reproduce y Deck A salta al Hot Cue
    djStore.seekDeckB(10.0);
    djStore.jumpToHotCue('A', 4);
    assert.equal(djStore.getSnapshot().deckA.currentTime, 80.0);
    assert.equal(djStore.getSnapshot().deckB.currentTime, 10.0, 'Deck B no debe ser forzado a la posición de Deck A');
  });

  // ==========================================
  // 8. CUE principal en pausa y en reproducción
  // ==========================================
  it('8.1 En pausa, CUE establece la referencia en la posición actual y jumpToMainCue reposiciona', async () => {
    const file = createTestAudioFile('track_cue_behavior.mp3');
    const track = createTrackFromFile(file, 150.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    // En pausa, mover a 32.5s y fijar CUE
    djStore.seekDeckA(32.5);
    await djStore.setMainCue('A');

    assert.equal(djStore.getSnapshot().deckA.mainCue, 32.5);

    // Desplazarse a otra posición y saltar al CUE
    djStore.seekDeckA(70.0);
    assert.equal(djStore.getSnapshot().deckA.currentTime, 70.0);

    djStore.jumpToMainCue('A');
    assert.equal(djStore.getSnapshot().deckA.currentTime, 32.5);
    assert.equal(djStore.getSnapshot().deckA.playbackState, 'stopped');
  });

  it('8.2 Durante reproducción, CUE detiene el deck y regresa inmediatamente al punto CUE', async () => {
    const file = createTestAudioFile('track_cue_play.mp3');
    const track = createTrackFromFile(file, 150.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    // Establecer CUE en 15.0s
    await djStore.setMainCue('A', 15.0);

    // Iniciar reproducción y avanzar
    await djStore.playDeckA();
    assert.equal(djStore.getSnapshot().deckA.playbackState, 'playing');
    djStore.seekDeckA(45.0);

    // Pulsar CUE mientras reproduce (handleCueDown)
    await djStore.handleCueDown('A');

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'paused', 'Debe pausar el deck');
    assert.equal(snap.deckA.currentTime, 15.0, 'Debe regresar al punto CUE');
    djStore.stopTimeLoop();
  });

  // ==========================================
  // 9. Comportamiento CUP (Cue Play / Stutter)
  // ==========================================
  it('9.1 Desde pausa, mantener presionado CUE reproduce y soltarlo detiene y rebobina a CUE', async () => {
    const file = createTestAudioFile('track_cup.mp3');
    const track = createTrackFromFile(file, 180.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    await djStore.setMainCue('A', 22.0);
    djStore.seekDeckA(22.0);
    assert.equal(djStore.getSnapshot().deckA.playbackState, 'stopped');

    // Mantener presionado CUE (pointerdown / keydown)
    await djStore.handleCueDown('A');

    const snapPlaying = djStore.getSnapshot();
    assert.equal(snapPlaying.deckA.playbackState, 'playing', 'CUP debe iniciar reproducción');
    assert.equal(snapPlaying.deckA.isCupPlaying, true, 'isCupPlaying debe estar activo');
    assert.equal(snapPlaying.deckA.currentTime, 22.0);

    // Soltar CUE (pointerup / keyup)
    djStore.handleCueUp('A');

    const snapReleased = djStore.getSnapshot();
    assert.equal(snapReleased.deckA.playbackState, 'paused', 'Soltar CUP debe pausar');
    assert.equal(snapReleased.deckA.isCupPlaying, false, 'isCupPlaying debe desactivarse');
    assert.equal(snapReleased.deckA.currentTime, 22.0, 'Debe rebobinar al punto CUE');
    djStore.stopTimeLoop();
  });

  it('9.1a Soltar CUP mientras resume sigue pendiente cancela el inicio tardío', async () => {
    const file = createTestAudioFile('track_cup_delayed_resume.mp3');
    const track = createTrackFromFile(file, 180.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);
    await djStore.setMainCue('A', 22.0);
    djStore.seekDeckA(22.0);

    const originalResume = audioEngine.resume;
    let resolveResume!: () => void;
    audioEngine.resume = () => new Promise<void>((resolve) => { resolveResume = resolve; });
    try {
      const pendingDown = djStore.handleCueDown('A');
      assert.equal(djStore.getSnapshot().deckA.isCupPlaying, true);
      djStore.handleCueUp('A');
      resolveResume();
      await pendingDown;
      const state = djStore.getSnapshot().deckA;
      assert.equal(state.isCupPlaying, false);
      assert.equal(state.playbackState, 'paused');
      assert.equal(state.currentTime, 22.0);
    } finally {
      audioEngine.resume = originalResume;
    }
  });

  it('4.2 Un fallo de persistencia no presenta un Hot Cue como guardado', async () => {
    const file = createTestAudioFile('track_cue_persist_failure.mp3');
    const track = createTrackFromFile(file, 180.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);
    const originalUpdate = indexedDBStorage.updateTrackCues;
    indexedDBStorage.updateTrackCues = async () => false;
    try {
      assert.equal(await djStore.setHotCue('A', 1, 12.0), false);
      assert.equal(djStore.getSnapshot().deckA.hotCues.length, 0);
    } finally {
      indexedDBStorage.updateTrackCues = originalUpdate;
    }
  });

  it('4.2a Una transacción abortada no deja los CUEs optimistas en la caché de almacenamiento', async () => {
    const file = createTestAudioFile('track_cue_cache_abort.mp3');
    const track = createTrackFromFile(file, 180.0);
    await indexedDBStorage.saveTrack(track, file);
    assert.deepEqual((await indexedDBStorage.getTrackCues(track.id))?.hotCues, []);

    const request = {} as IDBRequest;
    const fakeStore = {
      get: () => request,
      put: () => undefined,
    };
    const fakeTransaction = {
      objectStore: () => fakeStore,
      oncomplete: null as IDBTransaction['oncomplete'],
      onerror: null as IDBTransaction['onerror'],
      onabort: null as IDBTransaction['onabort'],
    };
    const originalInit = indexedDBStorage.init;
    indexedDBStorage.init = async () => ({
      transaction: () => fakeTransaction,
    } as unknown as IDBDatabase);
    try {
      const pendingUpdate = indexedDBStorage.updateTrackCues(track.id, {
        hotCues: [{ id: 1, position: 12, trackId: track.id, color: '#ff3b30', createdAt: 1 }],
      });
      await Promise.resolve();
      request.onsuccess?.({ target: { result: { id: track.id, hotCues: [] } } } as unknown as Event);
      fakeTransaction.onerror?.(new Event('error'));
      assert.equal(await pendingUpdate, false);
      assert.deepEqual((await indexedDBStorage.getTrackCues(track.id))?.hotCues, []);
    } finally {
      indexedDBStorage.init = originalInit;
    }
  });

  it('4.3 Al restaurar, descarta CUEs persistidos fuera de duración o con slot/pista inválidos', async () => {
    const file = createTestAudioFile('track_invalid_persisted_cues.mp3');
    const track = createTrackFromFile(file, 180.0);
    await indexedDBStorage.saveTrack(track, file);
    await indexedDBStorage.updateTrackCues(track.id, {
      mainCue: 181,
      hotCues: [
        { id: 1, position: 181, trackId: track.id, color: '#fff', createdAt: 1 },
        { id: 9, position: 10, trackId: track.id, color: '#fff', createdAt: 1 },
        { id: 2, position: 10, trackId: 'another-track', color: '#fff', createdAt: 1 },
      ],
    });
    assert.equal(await djStore.loadTrackToDeckA(track), true);
    const state = djStore.getSnapshot().deckA;
    assert.equal(state.mainCue, null);
    assert.deepEqual(state.hotCues, []);
  });

  it('9.2 Latch con PLAY: Presionar PLAY mientras se sostiene CUE enclava la reproducción permanente', async () => {
    const file = createTestAudioFile('track_cup_latch.mp3');
    const track = createTrackFromFile(file, 180.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    await djStore.setMainCue('A', 10.0);

    // Iniciar CUP
    await djStore.handleCueDown('A');
    assert.equal(djStore.getSnapshot().deckA.isCupPlaying, true);

    // El DJ pulsa PLAY para enclavar
    await djStore.playDeckA();
    assert.equal(djStore.getSnapshot().deckA.isCupPlaying, false, 'playDeck debe liberar el modo CUP (latch)');
    assert.equal(djStore.getSnapshot().deckA.playbackState, 'playing');

    // El DJ suelta el botón CUE
    djStore.handleCueUp('A');

    // La reproducción NO debe detenerse ni rebobinar porque se enclavó con PLAY
    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'playing', 'El deck debe continuar sonando');
    assert.equal(snap.deckA.isCupPlaying, false);
    djStore.stopTimeLoop();
  });

  // ==========================================
  // 10. Liberación segura de CUP ante blur o descarga de pista
  // ==========================================
  it('10.1 cancelCup detiene la reproducción y rebobina a CUE de forma segura ante pérdida de foco', async () => {
    const file = createTestAudioFile('track_cup_blur.mp3');
    const track = createTrackFromFile(file, 150.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    await djStore.setMainCue('A', 18.0);
    djStore.seekDeckA(18.0);
    await djStore.handleCueDown('A');
    assert.equal(djStore.getSnapshot().deckA.isCupPlaying, true);

    // Simular evento blur o llamada a cancelCup
    djStore.cancelCup('A');

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.isCupPlaying, false);
    assert.equal(snap.deckA.playbackState, 'paused');
    assert.equal(snap.deckA.currentTime, 18.0);
    djStore.stopTimeLoop();
  });

  it('10.2 Descargar la pista mientras CUP está activo limpia el estado sin fugas de reproducción', async () => {
    const file = createTestAudioFile('track_cup_unload.mp3');
    const track = createTrackFromFile(file, 150.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    await djStore.setMainCue('A', 14.0);
    await djStore.handleCueDown('A');
    assert.equal(djStore.getSnapshot().deckA.isCupPlaying, true);

    // Descargar deck
    djStore.unloadDeckA();

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.isCupPlaying, false);
    assert.equal(snap.deckA.track, null);
    assert.equal(snap.deckA.playbackState, 'stopped');
    djStore.stopTimeLoop();
  });
});
