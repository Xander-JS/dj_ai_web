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

    assert.equal(await djStore.loadTrackToDeckA(ghostTrack), false);
    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track, null);
    assert.equal(snap.deckA.playbackState, 'stopped');
    assert.equal(snap.deckA.duration, 0);
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
      assert.equal(snap.deckA.track, null);
      assert.equal(snap.deckA.playbackState, 'stopped');
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
    assert.equal(snap.deckB.track, null);
    assert.equal(snap.deckB.playbackState, 'stopped');
    assert.equal(snap.deckB.duration, 0);
  });
});

describe('useDJStore — Centralización del Estado del Mixer y Sincronización DSP', () => {
  const originalWindow = globalThis.window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    await audioEngine.initialize();
    // Restablecer valores de prueba
    djStore.setMasterVolume(80);
    if (djStore.getSnapshot().isMasterMuted) {
      djStore.toggleMasterMute();
    }
    djStore.setChannelGain('A', 50);
    djStore.setChannelGain('B', 50);
    djStore.setChannelVolume('A', 80);
    djStore.setChannelVolume('B', 80);
    djStore.setCrossfader(50);
    djStore.setCrossfaderCurve('constant-power');
    djStore.setCuePfl('A', false);
    djStore.setCuePfl('B', false);
    djStore.setChannelEq('A', 'high', 50);
    djStore.setChannelEq('A', 'mid', 50);
    djStore.setChannelEq('A', 'low', 50);
    djStore.setChannelFilter('A', 50);
    djStore.setChannelEq('B', 'high', 50);
    djStore.setChannelEq('B', 'mid', 50);
    djStore.setChannelEq('B', 'low', 50);
    djStore.setChannelFilter('B', 50);
  });

  afterEach(async () => {
    await audioEngine.dispose();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  test('1. Estado inicial del Mixer posee los valores nominales y simétricos', () => {
    const snap = djStore.getSnapshot();
    assert.ok(snap.mixer, 'El snapshot debe contener la sección mixer');

    // Canal A
    assert.equal(snap.mixer.channelA.deckId, 'A');
    assert.equal(snap.mixer.channelA.gain, 50);
    assert.equal(snap.mixer.channelA.volume, 80);
    assert.equal(snap.mixer.channelA.cuePfl, false);
    assert.equal(snap.mixer.channelA.eq.high, 50);
    assert.equal(snap.mixer.channelA.eq.mid, 50);
    assert.equal(snap.mixer.channelA.eq.low, 50);
    assert.equal(snap.mixer.channelA.eq.filter, 50);

    // Canal B
    assert.equal(snap.mixer.channelB.deckId, 'B');
    assert.equal(snap.mixer.channelB.gain, 50);
    assert.equal(snap.mixer.channelB.volume, 80);
    assert.equal(snap.mixer.channelB.cuePfl, false);
    assert.equal(snap.mixer.channelB.eq.high, 50);
    assert.equal(snap.mixer.channelB.eq.mid, 50);
    assert.equal(snap.mixer.channelB.eq.low, 50);
    assert.equal(snap.mixer.channelB.eq.filter, 50);

    // Crossfader y Master
    assert.equal(snap.mixer.crossfader, 50);
    assert.equal(snap.mixer.crossfaderCurve, 'constant-power');
    assert.equal(snap.mixer.masterVolume, 80);
    assert.equal(snap.masterVolume, 80);
    assert.equal(snap.isMasterMuted, false);
  });

  test('2. Actualización independiente de ganancia en canales A y B y sincronización con motor', () => {
    djStore.setChannelGain('A', 75);
    let snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.gain, 75);
    assert.equal(snap.mixer.channelB.gain, 50);

    const graphA = audioEngine.getDeckAudioGraph?.('A');
    const graphB = audioEngine.getDeckAudioGraph?.('B');
    assert.equal((graphA?.gainNode as unknown as { gain: { value: number } }).gain.value, 1.5);
    assert.equal((graphB?.gainNode as unknown as { gain: { value: number } }).gain.value, 1.0);

    // Modificar B no altera A
    djStore.setChannelGain('B', 25);
    snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.gain, 75);
    assert.equal(snap.mixer.channelB.gain, 25);
    assert.equal((graphB?.gainNode as unknown as { gain: { value: number } }).gain.value, 0.5);
    assert.equal((graphA?.gainNode as unknown as { gain: { value: number } }).gain.value, 1.5);
  });

  test('3. Actualización independiente de las bandas EQ (high, mid, low) con mapeo a dB', () => {
    djStore.setChannelEq('A', 'high', 75); // 75 -> +6 dB
    djStore.setChannelEq('A', 'mid', 25);  // 25 -> -6 dB
    djStore.setChannelEq('A', 'low', 100); // 100 -> +12 dB

    const snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.eq.high, 75);
    assert.equal(snap.mixer.channelA.eq.mid, 25);
    assert.equal(snap.mixer.channelA.eq.low, 100);
    assert.equal(snap.mixer.channelB.eq.high, 50);

    const graphA = audioEngine.getDeckAudioGraph?.('A');
    const graphB = audioEngine.getDeckAudioGraph?.('B');
    assert.equal((graphA?.eqHighNode as unknown as { gain: { value: number } }).gain.value, 6.0);
    assert.equal((graphA?.eqMidNode as unknown as { gain: { value: number } }).gain.value, -6.0);
    assert.equal((graphA?.eqLowNode as unknown as { gain: { value: number } }).gain.value, 12.0);
    assert.equal((graphB?.eqHighNode as unknown as { gain: { value: number } }).gain.value, 0.0);
  });

  test('4. Ajuste del filtro bipolar y llamada correcta al motor', () => {
    // Lowpass: slider a 25 -> bipolar -50
    djStore.setChannelFilter('A', 25);
    let snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.eq.filter, 25);

    const graphA = audioEngine.getDeckAudioGraph?.('A');
    const filterA = graphA?.filterNode as unknown as { type: string; frequency: { value: number } };
    assert.equal(filterA.type, 'lowpass');

    // Highpass: slider a 75 -> bipolar +50
    djStore.setChannelFilter('A', 75);
    snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.eq.filter, 75);
    assert.equal(filterA.type, 'highpass');

    // Bypass: slider a 50 -> allpass
    djStore.setChannelFilter('A', 50);
    snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.eq.filter, 50);
    assert.equal(filterA.type, 'allpass');
  });

  test('5. Ajuste independiente del volumen del canal', () => {
    djStore.setChannelVolume('A', 60);
    let snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.volume, 60);
    assert.equal(snap.mixer.channelB.volume, 80);

    const graphA = audioEngine.getDeckAudioGraph?.('A');
    const graphB = audioEngine.getDeckAudioGraph?.('B');
    assert.equal((graphA?.volumeNode as unknown as { gain: { value: number } }).gain.value, 0.6);
    assert.equal((graphB?.volumeNode as unknown as { gain: { value: number } }).gain.value, 0.8);

    djStore.setChannelVolume('B', 0);
    snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelB.volume, 0);
    assert.equal((graphB?.volumeNode as unknown as { gain: { value: number } }).gain.value, 0.0);
  });

  test('6. Posición del crossfader se actualiza en el store y sincroniza con el motor usando la curva actual', () => {
    djStore.setCrossfader(0);
    let snap = djStore.getSnapshot();
    assert.equal(snap.mixer.crossfader, 0);

    const graphA = audioEngine.getDeckAudioGraph?.('A');
    const graphB = audioEngine.getDeckAudioGraph?.('B');
    assert.equal((graphA?.crossfaderGainNode as unknown as { gain: { value: number } }).gain.value, 1.0);
    assert.equal((graphB?.crossfaderGainNode as unknown as { gain: { value: number } }).gain.value, 0.0);

    // 100% Deck B
    djStore.setCrossfader(100);
    snap = djStore.getSnapshot();
    assert.equal(snap.mixer.crossfader, 100);
    assert.equal((graphA?.crossfaderGainNode as unknown as { gain: { value: number } }).gain.value, 0.0);
    assert.equal((graphB?.crossfaderGainNode as unknown as { gain: { value: number } }).gain.value, 1.0);
  });

  test('7. Cambio de curva recalcula las ganancias usando la posición actual del crossfader', () => {
    // Crossfader al centro (50)
    djStore.setCrossfader(50);
    djStore.setCrossfaderCurve('linear');

    const snap = djStore.getSnapshot();
    assert.equal(snap.mixer.crossfaderCurve, 'linear');

    const graphA = audioEngine.getDeckAudioGraph?.('A');
    const graphB = audioEngine.getDeckAudioGraph?.('B');
    assert.equal((graphA?.crossfaderGainNode as unknown as { gain: { value: number } }).gain.value, 0.5);
    assert.equal((graphB?.crossfaderGainNode as unknown as { gain: { value: number } }).gain.value, 0.5);

    // Cambiar a cut: en el centro ambos deben estar al 100% (1.0)
    djStore.setCrossfaderCurve('cut');
    assert.equal((graphA?.crossfaderGainNode as unknown as { gain: { value: number } }).gain.value, 1.0);
    assert.equal((graphB?.crossfaderGainNode as unknown as { gain: { value: number } }).gain.value, 1.0);
  });

  test('8. Volumen Master mantiene una única fuente de verdad entre state.masterVolume y state.mixer.masterVolume', () => {
    djStore.setMasterVolume(65);
    const snap = djStore.getSnapshot();
    assert.equal(snap.masterVolume, 65);
    assert.equal(snap.mixer.masterVolume, 65);

    const master = audioEngine.getMasterGraph?.();
    assert.equal((master?.masterGainNode as unknown as { gain: { value: number } }).gain.value, 0.65);
  });

  test('9. Conservación del estado de mute al cambiar el volumen Master', () => {
    djStore.setMasterVolume(80);
    assert.equal(djStore.getSnapshot().isMasterMuted, false);

    // Silenciar
    djStore.toggleMasterMute();
    assert.equal(djStore.getSnapshot().isMasterMuted, true);
    const master = audioEngine.getMasterGraph?.();
    assert.equal((master?.masterGainNode as unknown as { gain: { value: number } }).gain.value, 0.0);

    // Cambiar volumen mientras está silenciado NO debe desmutear accidentalmente
    djStore.setMasterVolume(40);
    const snap = djStore.getSnapshot();
    assert.equal(snap.isMasterMuted, true);
    assert.equal(snap.masterVolume, 40);
    assert.equal(snap.mixer.masterVolume, 40);
    // La salida física del motor debe permanecer en 0.0
    assert.equal((master?.masterGainNode as unknown as { gain: { value: number } }).gain.value, 0.0);

    // Al desmutear, recupera el nuevo nivel fijado (40)
    djStore.toggleMasterMute();
    assert.equal(djStore.getSnapshot().isMasterMuted, false);
    assert.equal((master?.masterGainNode as unknown as { gain: { value: number } }).gain.value, 0.4);
  });

  test('10. Normalización y clamping de valores fuera de rango', () => {
    // Ganancia
    djStore.setChannelGain('A', 150);
    assert.equal(djStore.getSnapshot().mixer.channelA.gain, 100);
    djStore.setChannelGain('A', -50);
    assert.equal(djStore.getSnapshot().mixer.channelA.gain, 0);

    // Volumen
    djStore.setChannelVolume('A', 200);
    assert.equal(djStore.getSnapshot().mixer.channelA.volume, 100);
    djStore.setChannelVolume('A', -20);
    assert.equal(djStore.getSnapshot().mixer.channelA.volume, 0);

    // Crossfader
    djStore.setCrossfader(120);
    assert.equal(djStore.getSnapshot().mixer.crossfader, 100);
    djStore.setCrossfader(-30);
    assert.equal(djStore.getSnapshot().mixer.crossfader, 0);

    // Master
    djStore.setMasterVolume(180);
    assert.equal(djStore.getSnapshot().masterVolume, 100);
    assert.equal(djStore.getSnapshot().mixer.masterVolume, 100);
    djStore.setMasterVolume(-10);
    assert.equal(djStore.getSnapshot().masterVolume, 0);
    assert.equal(djStore.getSnapshot().mixer.masterVolume, 0);
  });

  test('11. Comportamiento seguro cuando el motor de audio no está inicializado o falla', async () => {
    // Cerrar AudioEngine para simular entorno no inicializado
    await audioEngine.dispose();

    // Las acciones del store deben actualizar el estado sin lanzar excepciones
    assert.doesNotThrow(() => {
      djStore.setChannelGain('A', 70);
      djStore.setChannelEq('A', 'high', 80);
      djStore.setChannelFilter('A', 30);
      djStore.setChannelVolume('A', 90);
      djStore.setCrossfader(60);
      djStore.setCrossfaderCurve('linear');
      djStore.setCuePfl('A', true);
      djStore.setMasterVolume(50);
    });

    const snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.gain, 70);
    assert.equal(snap.mixer.channelA.eq.high, 80);
    assert.equal(snap.mixer.channelA.eq.filter, 30);
    assert.equal(snap.mixer.channelA.volume, 90);
    assert.equal(snap.mixer.crossfader, 60);
    assert.equal(snap.mixer.crossfaderCurve, 'linear');
    assert.equal(snap.mixer.channelA.cuePfl, true);
    assert.equal(snap.masterVolume, 50);
    assert.equal(snap.mixer.masterVolume, 50);
  });

  test('12. Inmutabilidad y preservación de transporte de Deck A y Deck B', () => {
    const snapBefore = djStore.getSnapshot();
    djStore.setChannelGain('A', 90);
    const snapAfter = djStore.getSnapshot();

    // Snapshots deben ser instancias distintas (inmutabilidad)
    assert.notEqual(snapBefore, snapAfter);
    assert.notEqual(snapBefore.mixer, snapAfter.mixer);

    // Deck A y Deck B no deben ser mutados por acciones del mixer
    assert.equal(snapBefore.deckA, snapAfter.deckA);
    assert.equal(snapBefore.deckB, snapAfter.deckB);
  });
});

