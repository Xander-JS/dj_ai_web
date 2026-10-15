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
  public state: AudioContextState = 'suspended';
  public currentTime = 5.0;
  public destination = new MockAudioNode() as unknown as AudioDestinationNode;
  public onstatechange: (() => void) | null = null;

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
  public async decodeAudioData(_buf: ArrayBuffer): Promise<AudioBuffer> {
    void _buf;
    return {
      duration: 195.0,
      length: 195.0 * 44100,
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
    await indexedDBStorage.clearAll();
  });

  afterEach(async () => {
    djStore.unloadDeckA();
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
});
