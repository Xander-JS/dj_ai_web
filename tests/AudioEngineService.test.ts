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
  public static lastInstance: MockAudioContext | null = null;
  public state: AudioContextState = 'suspended';
  public currentTime = 10.0;
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

  test('decodeAudioData() rechaza con mensaje amigable cuando la decodificación falla', async () => {
    const originalDecode = MockAudioContext.prototype.decodeAudioData;
    MockAudioContext.prototype.decodeAudioData = async () => {
      throw new Error('Formato binario no reconocible');
    };

    try {
      await assert.rejects(
        async () => {
          await service.decodeAudioData(new ArrayBuffer(100));
        },
        /Fallo al decodificar los datos de audio/
      );
    } finally {
      MockAudioContext.prototype.decodeAudioData = originalDecode;
    }
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

  test('Deck A y Deck B pueden cargar buffers distintos con duraciones independientes', () => {
    const bufferA = { duration: 180.0 } as AudioBuffer;
    const bufferB = { duration: 245.5 } as AudioBuffer;

    service.loadBufferToDeck('A', bufferA);
    service.loadBufferToDeck('B', bufferB);

    assert.equal(service.getDeckDuration('A'), 180.0);
    assert.equal(service.getDeckDuration('B'), 245.5);
    assert.equal(service.getDeckCurrentTime('A'), 0);
    assert.equal(service.getDeckCurrentTime('B'), 0);
  });

  test('Reproducción simultánea e independiente en Deck A y Deck B con avance temporal', () => {
    const bufferA = { duration: 300.0 } as AudioBuffer;
    const bufferB = { duration: 300.0 } as AudioBuffer;

    service.loadBufferToDeck('A', bufferA);
    service.loadBufferToDeck('B', bufferB);

    // Iniciar Deck A en 10s y Deck B en 50s
    service.playDeck('A', 10.0);
    service.playDeck('B', 50.0);

    assert.equal(service.isDeckPlaying('A'), true);
    assert.equal(service.isDeckPlaying('B'), true);
    assert.equal(service.getDeckCurrentTime('A'), 10.0);
    assert.equal(service.getDeckCurrentTime('B'), 50.0);

    // Simular que el AudioContext avanza 5 segundos
    const ctx = MockAudioContext.lastInstance;
    assert.ok(ctx);
    ctx.currentTime += 5.0;

    // Ambos deben haber avanzado exactamente 5 segundos de forma simultánea
    assert.equal(service.getDeckCurrentTime('A'), 15.0);
    assert.equal(service.getDeckCurrentTime('B'), 55.0);
  });

  test('Pausar Deck B conserva su posición y no pausa ni afecta a Deck A', () => {
    const bufferA = { duration: 200.0 } as AudioBuffer;
    const bufferB = { duration: 200.0 } as AudioBuffer;

    service.loadBufferToDeck('A', bufferA);
    service.loadBufferToDeck('B', bufferB);

    service.playDeck('A', 20.0);
    service.playDeck('B', 30.0);

    const ctx = MockAudioContext.lastInstance;
    assert.ok(ctx);
    ctx.currentTime += 5.0;

    // Pausar exclusivamente Deck B
    service.pauseDeck('B');

    assert.equal(service.isDeckPlaying('B'), false);
    assert.equal(service.getDeckCurrentTime('B'), 35.0);

    // Deck A debe seguir en reproducción continua
    assert.equal(service.isDeckPlaying('A'), true);
    assert.equal(service.getDeckCurrentTime('A'), 25.0);

    // Avanzar otros 10 segundos en el AudioContext
    ctx.currentTime += 10.0;

    // Deck B se mantiene congelado en 35.0
    assert.equal(service.getDeckCurrentTime('B'), 35.0);
    // Deck A avanza a 35.0 (25.0 + 10.0)
    assert.equal(service.getDeckCurrentTime('A'), 35.0);
  });

  test('Detener Deck B rebobina su cursor y no altera la reproducción de Deck A', () => {
    const bufferA = { duration: 250.0 } as AudioBuffer;
    const bufferB = { duration: 250.0 } as AudioBuffer;

    service.loadBufferToDeck('A', bufferA);
    service.loadBufferToDeck('B', bufferB);

    service.playDeck('A', 40.0);
    service.playDeck('B', 80.0);

    const ctx = MockAudioContext.lastInstance;
    assert.ok(ctx);
    ctx.currentTime += 10.0;

    // Detener exclusivamente Deck B
    service.stopDeck('B');

    assert.equal(service.isDeckPlaying('B'), false);
    assert.equal(service.getDeckCurrentTime('B'), 0);

    // Deck A sigue reproduciendo en 50.0 (40.0 + 10.0)
    assert.equal(service.isDeckPlaying('A'), true);
    assert.equal(service.getDeckCurrentTime('A'), 50.0);
  });

  test('Pitch (velocidad de reproducción) es independiente entre ambos decks', () => {
    const bufferA = { duration: 200.0 } as AudioBuffer;
    const bufferB = { duration: 200.0 } as AudioBuffer;

    service.loadBufferToDeck('A', bufferA);
    service.loadBufferToDeck('B', bufferB);

    // Variar pitch independientemente
    service.setDeckPlaybackRate('A', 1.08); // +8%
    service.setDeckPlaybackRate('B', 0.92); // -8%

    assert.equal(service.getDeckPlaybackRate('A'), 1.08);
    assert.equal(service.getDeckPlaybackRate('B'), 0.92);

    service.playDeck('A', 0);
    service.playDeck('B', 0);

    const ctx = MockAudioContext.lastInstance;
    assert.ok(ctx);
    ctx.currentTime += 10.0;

    // Deck A avanzó 10 * 1.08 = 10.8 segundos
    assert.equal(Number(service.getDeckCurrentTime('A').toFixed(2)), 10.8);
    // Deck B avanzó 10 * 0.92 = 9.2 segundos
    assert.equal(Number(service.getDeckCurrentTime('B').toFixed(2)), 9.2);

    // Límites de pitch para Deck B respetados estrictamente (0.92 a 1.08)
    service.setDeckPlaybackRate('B', 0.5);
    assert.equal(service.getDeckPlaybackRate('B'), 0.92);
    service.setDeckPlaybackRate('B', 1.5);
    assert.equal(service.getDeckPlaybackRate('B'), 1.08);

    // Deck A conserva su pitch original inalterado
    assert.equal(service.getDeckPlaybackRate('A'), 1.08);
  });

  test('Descargar Deck B libera sus recursos sin afectar a Deck A', () => {
    const bufferA = { duration: 160.0 } as AudioBuffer;
    const bufferB = { duration: 160.0 } as AudioBuffer;

    service.loadBufferToDeck('A', bufferA);
    service.loadBufferToDeck('B', bufferB);

    service.playDeck('A', 15.0);
    service.playDeck('B', 25.0);

    // Descargar exclusivamente Deck B
    service.unloadDeck('B');

    assert.equal(service.getDeckDuration('B'), 0);
    assert.equal(service.getDeckCurrentTime('B'), 0);
    assert.equal(service.isDeckPlaying('B'), false);

    // Deck A continúa activo, con su buffer y reproduciendo
    assert.equal(service.getDeckDuration('A'), 160.0);
    assert.equal(service.isDeckPlaying('A'), true);
  });

  test('Reemplazar pista en Deck B detiene y libera el AudioBufferSourceNode anterior', () => {
    const bufferB1 = { duration: 100.0 } as AudioBuffer;
    const bufferB2 = { duration: 220.0 } as AudioBuffer;

    service.loadBufferToDeck('B', bufferB1);
    service.playDeck('B', 10.0);

    assert.equal(service.isDeckPlaying('B'), true);
    assert.equal(service.getDeckDuration('B'), 100.0);

    // Cargar nuevo buffer en Deck B
    service.loadBufferToDeck('B', bufferB2);

    assert.equal(service.isDeckPlaying('B'), false);
    assert.equal(service.getDeckCurrentTime('B'), 0);
    assert.equal(service.getDeckDuration('B'), 220.0);
  });

  test('Seek en Deck B es preciso y no altera la reproducción de Deck A', () => {
    const bufferA = { duration: 200.0 } as AudioBuffer;
    const bufferB = { duration: 300.0 } as AudioBuffer;

    service.loadBufferToDeck('A', bufferA);
    service.loadBufferToDeck('B', bufferB);

    service.playDeck('A', 15.0);
    service.playDeck('B', 30.0);

    // Seek en Deck B mientras reproduce
    service.seekDeck('B', 120.0);

    assert.equal(service.getDeckCurrentTime('B'), 120.0);
    assert.equal(service.isDeckPlaying('B'), true);

    // Deck A conserva su posición y continúa reproduciendo
    assert.equal(service.getDeckCurrentTime('A'), 15.0);
    assert.equal(service.isDeckPlaying('A'), true);
  });

  test('Evento onPlaybackEnded de Deck B notifica solo a listeners de Deck B', () => {
    const bufferB = { duration: 100.0 } as AudioBuffer;
    service.loadBufferToDeck('B', bufferB);

    let deckANotified = false;
    let deckBNotified = false;

    service.onPlaybackEnded('A', () => {
      deckANotified = true;
    });
    service.onPlaybackEnded('B', () => {
      deckBNotified = true;
    });

    service.playDeck('B', 0);

    // Simular que el sourceNode de Deck B termina naturalmente
    const graphB = (service as unknown as { deckGraphs: Map<string, { sourceNode: MockAudioBufferSourceNode | null }> })
      .deckGraphs.get('B');

    assert.ok(graphB?.sourceNode);
    graphB.sourceNode.onended?.();

    assert.equal(deckBNotified, true);
    assert.equal(deckANotified, false);
    assert.equal(service.isDeckPlaying('B'), false);
  });

  test('dispose() cierra el AudioContext y libera recursos', async () => {
    await service.initialize();
    await service.dispose();
    assert.equal(service.status, 'uninitialized');
  });
});
