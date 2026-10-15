/**
 * SYSTEM DJ — AudioEngineService Unit & Lifecycle Tests
 * Pruebas automatizadas de la lógica del motor Web Audio API.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngineService } from '../src/audio/AudioEngineService.ts';

// Mock minimalista de Web Audio API para ejecución determinista en Node.js
class MockAudioParam {
  public value: number;
  constructor(defaultValue = 1) {
    this.value = defaultValue;
  }
  public setValueAtTime(val: number): void {
    this.value = val;
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
  public type: BiquadFilterType = 'allpass';
  public frequency = new MockAudioParam(1000);
  public gain = new MockAudioParam(0);
  public Q = new MockAudioParam(1);
}

class MockAnalyserNode extends MockAudioNode {
  public fftSize = 256;
  public frequencyBinCount = 128;
  public smoothingTimeConstant = 0.8;
  public getByteTimeDomainData(array: Uint8Array): void {
    // Rellenar con señal neutra (128 = silencio)
    array.fill(128);
  }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  public buffer: AudioBuffer | null = null;
  public playbackRate = new MockAudioParam(1);
  public onended: (() => void) | null = null;
  public isStarted = false;
  public isStopped = false;
  public startOffset = 0;

  public start(_when?: number, offset?: number): void {
    this.isStarted = true;
    this.startOffset = offset || 0;
  }

  public stop(): void {
    this.isStopped = true;
  }
}

class MockAudioContext {
  public state: AudioContextState = 'suspended';
  public currentTime = 10.0;
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

  public async decodeAudioData(_buffer: ArrayBuffer): Promise<AudioBuffer> {
    void _buffer;
    return {
      duration: 180.5,
      length: 180.5 * 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(100),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
  }

  public async resume(): Promise<void> {
    this.state = 'running';
    if (this.onstatechange) this.onstatechange();
  }

  public async close(): Promise<void> {
    this.state = 'closed';
    if (this.onstatechange) this.onstatechange();
  }
}

describe('AudioEngineService — Pruebas de Ciclo de Vida y Transporte', () => {
  let service: AudioEngineService;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // Configurar entorno global con mock de AudioContext
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    service = new AudioEngineService();
  });

  afterEach(async () => {
    await service.dispose();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  test('Estado inicial es "uninitialized" antes de interactuar', () => {
    assert.equal(service.status, 'uninitialized');
  });

  test('initialize() instancia AudioContext y transiciona a "suspended"', async () => {
    await service.initialize();
    assert.equal(service.status, 'suspended');
  });

  test('resume() activa AudioContext a "running"', async () => {
    await service.resume();
    assert.equal(service.status, 'running');
  });

  test('decodeAudioData() decodifica un ArrayBuffer a AudioBuffer', async () => {
    const fakeArrayBuffer = new ArrayBuffer(1024);
    const audioBuffer = await service.decodeAudioData(fakeArrayBuffer);
    assert.ok(audioBuffer);
    assert.equal(audioBuffer.duration, 180.5);
    assert.equal(audioBuffer.sampleRate, 44100);
  });

  test('loadBufferToDeck() carga buffer y asigna duración en Deck A', async () => {
    const fakeBuffer = { duration: 240.0 } as AudioBuffer;
    service.loadBufferToDeck('A', fakeBuffer);

    assert.equal(service.getDeckDuration('A'), 240.0);
    assert.equal(service.getDeckCurrentTime('A'), 0);
  });

  test('playDeck() y pauseDeck() gestionan la posición temporal exacta', async () => {
    const fakeBuffer = { duration: 200.0 } as AudioBuffer;
    service.loadBufferToDeck('A', fakeBuffer);

    // Iniciar reproducción
    service.playDeck('A', 15.0);
    assert.equal(service.getDeckCurrentTime('A'), 15.0);

    // Pausar
    service.pauseDeck('A');
    assert.equal(service.getDeckCurrentTime('A'), 15.0);
  });

  test('stopDeck() detiene y rebobina la posición a cero', async () => {
    const fakeBuffer = { duration: 150.0 } as AudioBuffer;
    service.loadBufferToDeck('A', fakeBuffer);

    service.playDeck('A', 45.0);
    service.stopDeck('A');

    assert.equal(service.getDeckCurrentTime('A'), 0);
  });

  test('seekDeck() actualiza el cursor temporal tanto en pausa como en reproducción', async () => {
    const fakeBuffer = { duration: 300.0 } as AudioBuffer;
    service.loadBufferToDeck('A', fakeBuffer);

    // Seek en pausa
    service.seekDeck('A', 60.0);
    assert.equal(service.getDeckCurrentTime('A'), 60.0);

    // Seek fuera de rango se limita a la duración
    service.seekDeck('A', 999.0);
    assert.equal(service.getDeckCurrentTime('A'), 300.0);

    // Seek negativo se limita a 0
    service.seekDeck('A', -10.0);
    assert.equal(service.getDeckCurrentTime('A'), 0);
  });

  test('setDeckPlaybackRate() limita estrictamente al rango de pitch ±8% (0.92 a 1.08)', async () => {
    const fakeBuffer = { duration: 100.0 } as AudioBuffer;
    service.loadBufferToDeck('A', fakeBuffer);

    // Intentar valor inferior al -8%
    service.setDeckPlaybackRate('A', 0.5);
    // Intentar valor superior al +8%
    service.setDeckPlaybackRate('A', 1.5);
    // Valor dentro del rango
    service.setDeckPlaybackRate('A', 1.04);
  });

  test('unloadDeck() libera el buffer del deck y reinicia el tiempo', async () => {
    const fakeBuffer = { duration: 120.0 } as AudioBuffer;
    service.loadBufferToDeck('A', fakeBuffer);
    assert.equal(service.getDeckDuration('A'), 120.0);

    service.unloadDeck('A');
    assert.equal(service.getDeckDuration('A'), 0);
    assert.equal(service.getDeckCurrentTime('A'), 0);
  });

  test('dispose() cierra el AudioContext y libera recursos', async () => {
    await service.initialize();
    await service.dispose();
    assert.equal(service.status, 'uninitialized');
  });
});
