/**
 * SYSTEM DJ — DJStore & Deck A Integration Tests
 * Pruebas automatizadas para la coordinación de estado compartido entre la biblioteca,
 * el almacenamiento local y los controles de transporte del Deck A.
 */

import 'fake-indexeddb/auto';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';

// Mock minimalista de Web Audio API para simulación en Node.js
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
  }
}

class MockAudioContext {
  public static lastInstance: MockAudioContext | null = null;
  public state: AudioContextState = 'suspended';
  public currentTime = 5.0;
  public destination = new MockAudioNode() as unknown as AudioDestinationNode;
  public onstatechange: (() => void) | null = null;

  constructor() {
    MockAudioContext.lastInstance = this;
  }

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
  public async decodeAudioData(buf: ArrayBuffer): Promise<AudioBuffer> {
    const duration = buf.byteLength > 1000 ? 240.0 : 195.0;
    return {
      duration,
      length: duration * 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(10),
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

describe('useDJStore — Coordinación y Transporte Real para Deck A', () => {
  const originalWindow = globalThis.window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    await audioEngine.initialize();
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await indexedDBStorage.clearAll();
  });

  afterEach(async () => {
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await audioEngine.dispose();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  test('Estado inicial del Deck A está vacío y detenido', () => {
    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track, null);
    assert.equal(snap.deckA.playbackState, 'stopped');
    assert.equal(snap.deckA.currentTime, 0);
    assert.equal(snap.deckA.duration, 0);
  });

  test('loadTrackToDeckA recupera archivo binario de IndexedDB y decodifica duración real', async () => {
    const rawContent = new Uint8Array([0x49, 0x44, 0x33, 0x00]); // Fake MP3
    const file = new File([rawContent], 'test_song.mp3', { type: 'audio/mpeg' });
    const track = createTrackFromFile(file, 0);

    // Guardar en almacenamiento
    await indexedDBStorage.saveTrack(track, file);

    // Cargar en Deck A
    await djStore.loadTrackToDeckA(track);

    const snap = djStore.getSnapshot();
    assert.ok(snap.deckA.track);
    assert.equal(snap.deckA.track.title, 'test_song');
    assert.equal(snap.deckA.duration, 195.0);
    assert.equal(snap.deckA.playbackState, 'stopped');
    assert.equal(snap.deckA.currentTime, 0);
    assert.equal(snap.deckA.errorMessage, null);
  });

  test('playDeckA(), pauseDeckA() y stopDeckA() controlan la reproducción y el cursor temporal', async () => {
    const file = new File([new Uint8Array(100)], 'groove.wav', { type: 'audio/wav' });
    const track = createTrackFromFile(file, 195.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    // Play
    await djStore.playDeckA();
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'playing');

    // Pause
    djStore.pauseDeckA();
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'paused');

    // Seek a 40 segundos
    djStore.seekDeckA(40.0);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.currentTime, 40.0);

    // Stop rebobina a 0:00
    djStore.stopDeckA();
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'stopped');
    assert.equal(snap.deckA.currentTime, 0);
  });

  test('setPitchDeckA varía el pitch y calcula el BPM dinámicamente', async () => {
    const file = new File([new Uint8Array(100)], 'tempo.mp3', { type: 'audio/mpeg' });
    const track = createTrackFromFile(file, 195.0);
    track.analysis.bpm = 120.0;
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    // Pitch al centro (50 -> 0% -> 120 BPM)
    djStore.setPitchDeckA(50);
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.pitch, 50);
    assert.equal(snap.deckA.playbackRate, 1.0);
    assert.equal(snap.deckA.calculatedBpm, 120.0);

    // Pitch a +8% (100 -> factor 1.08 -> 129.6 BPM)
    djStore.setPitchDeckA(100);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.pitch, 100);
    assert.equal(snap.deckA.playbackRate, 1.08);
    assert.equal(snap.deckA.calculatedBpm, 129.6);

    // Pitch a -8% (0 -> factor 0.92 -> 110.4 BPM)
    djStore.setPitchDeckA(0);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.pitch, 0);
    assert.equal(snap.deckA.playbackRate, 0.92);
    assert.equal(snap.deckA.calculatedBpm, 110.4);
  });

  test('unloadDeckA descarga la pista y libera los estados de reproducción', async () => {
    const file = new File([new Uint8Array(100)], 'temp.mp3', { type: 'audio/mpeg' });
    const track = createTrackFromFile(file, 195.0);
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeckA(track);

    djStore.unloadDeckA();
    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track, null);
    assert.equal(snap.deckA.duration, 0);
    assert.equal(snap.deckA.playbackState, 'stopped');
  });

  test('Manejo de errores al intentar cargar una pista sin archivo local disponible', async () => {
    const ghostTrack = {
      id: 'local_non_existent',
      title: 'Inexistente',
      artist: '',
      duration: 100,
      durationFormatted: '1:40',
      type: 'audio' as const,
      source: { type: 'indexeddb' as const, indexedDbKey: 'non_existent_key' },
      analysis: { status: 'pending' as const },
      dateAdded: Date.now(),
    };

    await djStore.loadTrackToDeckA(ghostTrack);
    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'error');
    assert.equal(snap.deckA.errorCode, 'file_missing');
    assert.ok(snap.deckA.errorMessage);
    assert.match(snap.deckA.errorMessage, /no se encuentra/i);
  });

  test('Manejo de errores cuando decodeAudioData falla (archivo dañado o corrupto)', async () => {
    const file = new File([new Uint8Array(100)], 'corrupt.mp3', { type: 'audio/mpeg' });
    const track = createTrackFromFile(file, 0);
    await indexedDBStorage.saveTrack(track, file);

    const originalDecode = MockAudioContext.prototype.decodeAudioData;
    MockAudioContext.prototype.decodeAudioData = async () => {
      throw new Error('Fallo al decodificar: archivo binario dañado');
    };

    try {
      const loadResult = await djStore.loadTrackToDeckA(track);
      assert.equal(loadResult, false);

      const snap = djStore.getSnapshot();
      assert.equal(snap.deckA.playbackState, 'error');
      assert.equal(snap.deckA.errorCode, 'decode_failed');
      assert.ok(snap.deckA.errorMessage);
      assert.match(snap.deckA.errorMessage, /dañado/i);
      assert.equal(snap.deckA.duration, 0);
      assert.equal(audioEngine.getDeckDuration('A'), 0);
    } finally {
      MockAudioContext.prototype.decodeAudioData = originalDecode;
    }
  });

  test('Estado inicial incluye Deck B vacío y detenido', () => {
    const snap = djStore.getSnapshot();
    assert.ok(snap.deckB);
    assert.equal(snap.deckB.deckId, 'B');
    assert.equal(snap.deckB.track, null);
    assert.equal(snap.deckB.playbackState, 'stopped');
    assert.equal(snap.deckB.currentTime, 0);
    assert.equal(snap.deckB.duration, 0);
  });

  test('Cargar pistas diferentes en Deck A y Deck B recuperando sus binarios de IndexedDB', async () => {
    const fileA = new File([new Uint8Array(100)], 'trackA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'trackB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    const loadedA = await djStore.loadTrackToDeckA(trackA);
    const loadedB = await djStore.loadTrackToDeckB(trackB);

    assert.equal(loadedA, true);
    assert.equal(loadedB, true);

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.title, 'trackA');
    assert.equal(snap.deckA.duration, 195.0);
    assert.equal(snap.deckB.track?.title, 'trackB');
    assert.equal(snap.deckB.duration, 240.0);
    assert.equal(snap.deckA.playbackState, 'stopped');
    assert.equal(snap.deckB.playbackState, 'stopped');
  });

  test('Reproducir ambos simultáneamente mantiene el estado playing en ambos decks', async () => {
    const fileA = new File([new Uint8Array(100)], 'simulA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 195.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'simulB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    await djStore.playDeckA();
    await djStore.playDeckB();

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'playing');
    assert.equal(snap.deckB.playbackState, 'playing');
    assert.equal(djStore.isTimeLoopActive(), true);
  });

  test('Pausar Deck B mientras Deck A continúa mantiene a Deck A en reproducción', async () => {
    const fileA = new File([new Uint8Array(100)], 'pA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 195.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'pB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    await djStore.playDeckA();
    await djStore.playDeckB();

    djStore.seekDeckA(25.0);
    djStore.seekDeckB(45.0);

    // Pausar exclusivamente Deck B
    djStore.pauseDeckB();

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckB.playbackState, 'paused');
    assert.equal(snap.deckB.currentTime, 45.0);
    assert.equal(snap.deckA.playbackState, 'playing');
    assert.equal(snap.deckA.currentTime, 25.0);
    assert.equal(djStore.isTimeLoopActive(), true); // Bucle sigue vivo por Deck A
  });

  test('Detener Deck B sin modificar Deck A rebobina solo B', async () => {
    const fileA = new File([new Uint8Array(100)], 'sA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 195.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'sB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    await djStore.playDeckA();
    await djStore.playDeckB();

    djStore.seekDeckA(30.0);
    djStore.seekDeckB(60.0);

    // Detener exclusivamente Deck B
    djStore.stopDeckB();

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckB.playbackState, 'stopped');
    assert.equal(snap.deckB.currentTime, 0);
    assert.equal(snap.deckA.playbackState, 'playing');
    assert.equal(snap.deckA.currentTime, 30.0);
  });

  test('Buscar una posición en Deck B (Seek) no afecta a Deck A', async () => {
    const fileA = new File([new Uint8Array(100)], 'seekA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 195.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'seekB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    djStore.seekDeckA(15.0);
    djStore.seekDeckB(150.0);

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.currentTime, 15.0);
    assert.equal(snap.deckB.currentTime, 150.0);
  });

  test('Cambiar el pitch de Deck B sin modificar el de Deck A calcula BPM independiente', async () => {
    const fileA = new File([new Uint8Array(100)], 'pitchA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 195.0);
    trackA.analysis.bpm = 120.0;
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'pitchB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    trackB.analysis.bpm = 128.0;
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    djStore.setPitchDeckA(50); // Pitch 0% (1.0) -> 120.0 BPM
    djStore.setPitchDeckB(100); // Pitch +8% (1.08) -> 138.2 BPM

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.pitch, 50);
    assert.equal(snap.deckA.playbackRate, 1.0);
    assert.equal(snap.deckA.calculatedBpm, 120.0);

    assert.equal(snap.deckB.pitch, 100);
    assert.equal(snap.deckB.playbackRate, 1.08);
    assert.equal(snap.deckB.calculatedBpm, 138.2);
  });

  test('Ejecutar cargas concurrentes en ambos decks (Promise.all)', async () => {
    const fileA = new File([new Uint8Array(100)], 'concA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 195.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'concB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    // Cargar simultáneamente
    const [resA, resB] = await Promise.all([
      djStore.loadTrackToDeckA(trackA),
      djStore.loadTrackToDeckB(trackB),
    ]);

    assert.equal(resA, true);
    assert.equal(resB, true);

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.title, 'concA');
    assert.equal(snap.deckB.track?.title, 'concB');
  });

  test('Resolver cargas del mismo deck en orden inverso y conservar la selección más reciente', async () => {
    const file1 = new File([new Uint8Array(500)], 'primer_clic.mp3', { type: 'audio/mpeg' });
    const track1 = createTrackFromFile(file1, 0);
    await indexedDBStorage.saveTrack(track1, file1);

    const file2 = new File([new Uint8Array(600)], 'segundo_clic.mp3', { type: 'audio/mpeg' });
    const track2 = createTrackFromFile(file2, 0);
    await indexedDBStorage.saveTrack(track2, file2);

    // Disparar carga 1 y de inmediato carga 2 en Deck B
    const p1 = djStore.loadTrackToDeckB(track1);
    const p2 = djStore.loadTrackToDeckB(track2);

    const [res1, res2] = await Promise.all([p1, p2]);

    assert.equal(res1, false); // Cancelada por token obsoleto
    assert.equal(res2, true);  // Ganadora más reciente

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckB.track?.title, 'segundo_clic');
  });

  test('Mantener el bucle temporal activo mientras al menos uno de los decks continúa reproduciendo', async () => {
    const fileA = new File([new Uint8Array(100)], 'loopA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 195.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'loopB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    assert.equal(djStore.isTimeLoopActive(), false);

    // Iniciar ambos
    await djStore.playDeckA();
    await djStore.playDeckB();
    assert.equal(djStore.isTimeLoopActive(), true);

    // Pausar Deck A -> bucle temporal continúa porque Deck B sigue reproduciendo
    djStore.pauseDeckA();
    assert.equal(djStore.isTimeLoopActive(), true);

    // Pausar Deck B -> ahora ambos están pausados, bucle se detiene
    djStore.pauseDeckB();
    assert.equal(djStore.isTimeLoopActive(), false);

    // Reanudar solo Deck B -> bucle se activa nuevamente
    await djStore.playDeckB();
    assert.equal(djStore.isTimeLoopActive(), true);

    // Detener Deck B -> bucle se detiene
    djStore.stopDeckB();
    assert.equal(djStore.isTimeLoopActive(), false);
  });

  test('Finalizar una pista naturalmente en Deck B sin detener Deck A', async () => {
    const fileA = new File([new Uint8Array(100)], 'endA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 195.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'endB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    await djStore.playDeckA();
    await djStore.playDeckB();

    djStore.seekDeckA(50.0);

    // Disparar finalización natural en Deck B
    const graphB = (audioEngine as unknown as { deckGraphs: Map<string, { sourceNode: MockAudioBufferSourceNode | null }> })
      .deckGraphs.get('B');
    assert.ok(graphB?.sourceNode);
    graphB.sourceNode.onended?.();

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckB.playbackState, 'stopped');
    assert.equal(snap.deckB.currentTime, 0);

    // Deck A continúa sonando
    assert.equal(snap.deckA.playbackState, 'playing');
    assert.equal(snap.deckA.currentTime, 50.0);
    assert.equal(djStore.isTimeLoopActive(), true);
  });

  test('Descargar Deck B sin eliminar ni alterar la pista de Deck A', async () => {
    const fileA = new File([new Uint8Array(100)], 'stayA.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 195.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(2000)], 'leaveB.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    djStore.unloadDeckB();

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckB.track, null);
    assert.equal(snap.deckB.duration, 0);
    assert.equal(snap.deckB.playbackState, 'stopped');

    // Deck A permanece intacto
    assert.equal(snap.deckA.track?.title, 'stayA');
    assert.equal(snap.deckA.duration, 195.0);
  });

  test('Manejo de errores independiente en Deck B (archivo faltante)', async () => {
    const ghostTrackB = {
      id: 'ghost_b',
      title: 'Pista Fantasma B',
      artist: 'Desconocido',
      duration: 120,
      durationFormatted: '2:00',
      type: 'audio' as const,
      source: { type: 'indexeddb' as const, indexedDbKey: 'non_existent_b' },
      analysis: { status: 'pending' as const },
      dateAdded: Date.now(),
    };

    const loadResult = await djStore.loadTrackToDeckB(ghostTrackB);
    assert.equal(loadResult, false);

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckB.playbackState, 'error');
    assert.equal(snap.deckB.errorCode, 'file_missing');
    assert.ok(snap.deckB.errorMessage);
    assert.match(snap.deckB.errorMessage, /no se encuentra/i);
  });
});
