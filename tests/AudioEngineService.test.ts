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
  public connectedTo: MockAudioNode[] = [];
  public connect(destination: MockAudioNode): MockAudioNode {
    this.connectedTo.push(destination);
    return destination;
  }
  public disconnect(): void {
    this.connectedTo = [];
  }
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
  public customData: number[] | null = null;
  public getByteTimeDomainData(array: Uint8Array): void {
    if (this.customData) {
      for (let i = 0; i < array.length; i++) {
        array[i] = this.customData[i % this.customData.length];
      }
    } else {
      // Rellenar con señal neutra (128 = silencio)
      array.fill(128);
    }
  }
}

class MockDynamicsCompressorNode extends MockAudioNode {
  public threshold = new MockAudioParam(-1);
  public knee = new MockAudioParam(0);
  public ratio = new MockAudioParam(20);
  public attack = new MockAudioParam(0.001);
  public release = new MockAudioParam(0.05);
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

  public createDynamicsCompressor(): DynamicsCompressorNode {
    return new MockDynamicsCompressorNode() as unknown as DynamicsCompressorNode;
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

describe('AudioEngineService — Pruebas del Grafo DSP, Curvas y Medición Real', () => {
  let service: AudioEngineService;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    service = new AudioEngineService();
  });

  afterEach(async () => {
    await service.dispose();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  test('Topología del grafo DSP: orden secuencial de nodos en el canal', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');

    const gainNode = graphA.gainNode as unknown as MockAudioNode;
    const filterNode = graphA.filterNode as unknown as MockAudioNode;
    const eqHighNode = graphA.eqHighNode as unknown as MockAudioNode;
    const eqMidNode = graphA.eqMidNode as unknown as MockAudioNode;
    const eqLowNode = graphA.eqLowNode as unknown as MockAudioNode;
    const volumeNode = graphA.volumeNode as unknown as MockAudioNode;

    assert.ok(gainNode.connectedTo.includes(filterNode), 'gainNode debe conectar a filterNode');
    assert.ok(filterNode.connectedTo.includes(eqHighNode), 'filterNode debe conectar a eqHighNode');
    assert.ok(eqHighNode.connectedTo.includes(eqMidNode), 'eqHighNode debe conectar a eqMidNode');
    assert.ok(eqMidNode.connectedTo.includes(eqLowNode), 'eqMidNode debe conectar a eqLowNode');
    assert.ok(eqLowNode.connectedTo.includes(volumeNode), 'eqLowNode debe conectar a volumeNode');
  });

  test('Topología del grafo DSP: el analizador de canal es pre-crossfader y post-fader', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');

    const volumeNode = graphA.volumeNode as unknown as MockAudioNode;
    const analyserNode = graphA.analyserNode as unknown as MockAudioNode;
    const crossfaderGainNode = graphA.crossfaderGainNode as unknown as MockAudioNode;

    // volumeNode debe bifurcarse hacia analyserNode y hacia crossfaderGainNode
    assert.ok(volumeNode.connectedTo.includes(analyserNode), 'volumeNode debe derivar al analyserNode del canal');
    assert.ok(volumeNode.connectedTo.includes(crossfaderGainNode), 'volumeNode debe conectar al crossfaderGainNode');

    // analyserNode NO debe estar aguas abajo del crossfader
    assert.ok(
      !crossfaderGainNode.connectedTo.includes(analyserNode),
      'analyserNode no debe conectarse después de crossfaderGainNode'
    );
  });

  test('Topología de la etapa Master: masterGainNode alimenta al masterAnalyser y al limitador de seguridad', async () => {
    await service.initialize();
    const master = service.getMasterGraph();

    const masterGain = master.masterGainNode as unknown as MockAudioNode;
    const masterAnalyser = master.masterAnalyserNode as unknown as MockAudioNode;
    const limiter = master.limiterNode as unknown as MockAudioNode;
    const destination = MockAudioContext.lastInstance!.destination as unknown as MockAudioNode;

    assert.ok(masterGain.connectedTo.includes(masterAnalyser), 'masterGainNode debe derivar al masterAnalyserNode');
    assert.ok(masterGain.connectedTo.includes(limiter), 'masterGainNode debe conectar al limitador de picos');
    assert.ok(limiter.connectedTo.includes(destination), 'El limitador de picos debe conectar al destination final');
  });

  test('setChannelGain() aplica ganancia lineal 0..2 y aísla los canales A y B', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');
    const graphB = service.getDeckAudioGraph('B');

    const gainParamA = (graphA.gainNode as unknown as { gain: MockAudioParam }).gain;
    const gainParamB = (graphB.gainNode as unknown as { gain: MockAudioParam }).gain;

    service.setChannelGain('A', 50);
    assert.equal(gainParamA.value, 1.0);

    service.setChannelGain('A', 100);
    assert.equal(gainParamA.value, 2.0);

    service.setChannelGain('A', 0);
    assert.equal(gainParamA.value, 0.0);

    // Ajuste en B no altera A
    service.setChannelGain('B', 75);
    assert.equal(gainParamB.value, 1.5);
    assert.equal(gainParamA.value, 0.0);

    // Clamping estricto
    service.setChannelGain('A', 150);
    assert.equal(gainParamA.value, 2.0);
    service.setChannelGain('A', -20);
    assert.equal(gainParamA.value, 0.0);
  });

  test('setChannelEq() aplica ecualización de 3 bandas (-12 a +12 dB) con aislamiento', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');
    const graphB = service.getDeckAudioGraph('B');

    const highA = (graphA.eqHighNode as unknown as { gain: MockAudioParam }).gain;
    const midA = (graphA.eqMidNode as unknown as { gain: MockAudioParam }).gain;
    const lowA = (graphA.eqLowNode as unknown as { gain: MockAudioParam }).gain;

    const highB = (graphB.eqHighNode as unknown as { gain: MockAudioParam }).gain;

    service.setChannelEq('A', 'high', 8);
    assert.equal(highA.value, 8);

    service.setChannelEq('A', 'mid', -4);
    assert.equal(midA.value, -4);

    service.setChannelEq('A', 'low', 12);
    assert.equal(lowA.value, 12);

    // Canal B permanece en 0 dB
    assert.equal(highB.value, 0);

    // Clamping a [-12, +12]
    service.setChannelEq('A', 'high', 25);
    assert.equal(highA.value, 12);

    service.setChannelEq('A', 'low', -30);
    assert.equal(lowA.value, -12);
  });

  test('setChannelFilter() implementa filtro bipolar: bypass (0), lowpass (<0) y highpass (>0)', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');
    const graphB = service.getDeckAudioGraph('B');

    const filterNodeA = graphA.filterNode as unknown as { type: string; frequency: MockAudioParam };
    const filterNodeB = graphB.filterNode as unknown as { type: string; frequency: MockAudioParam };

    // Centro = Allpass bypass
    service.setChannelFilter('A', 0);
    assert.equal(filterNodeA.type, 'allpass');

    // Hacia la izquierda (<0) = Lowpass progresivo
    service.setChannelFilter('A', -50);
    assert.equal(filterNodeA.type, 'lowpass');
    assert.ok(filterNodeA.frequency.value > 200 && filterNodeA.frequency.value < 20000);

    // Hacia la derecha (>0) = Highpass progresivo
    service.setChannelFilter('A', 50);
    assert.equal(filterNodeA.type, 'highpass');
    assert.ok(filterNodeA.frequency.value > 20 && filterNodeA.frequency.value < 8000);

    // Canal B se mantiene en su estado
    assert.equal(filterNodeB.type, 'allpass');
  });

  test('setChannelVolume() aplica fader lineal 0..1 independiente por canal', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');
    const graphB = service.getDeckAudioGraph('B');

    const volA = (graphA.volumeNode as unknown as { gain: MockAudioParam }).gain;
    const volB = (graphB.volumeNode as unknown as { gain: MockAudioParam }).gain;

    service.setChannelVolume('A', 80);
    assert.equal(volA.value, 0.8);

    service.setChannelVolume('A', 0);
    assert.equal(volA.value, 0.0);

    service.setChannelVolume('B', 100);
    assert.equal(volB.value, 1.0);
    assert.equal(volA.value, 0.0);

    // Clamping
    service.setChannelVolume('A', 120);
    assert.equal(volA.value, 1.0);
    service.setChannelVolume('A', -10);
    assert.equal(volA.value, 0.0);
  });

  test('setCrossfader() curva constant-power conserva la potencia acústica', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');
    const graphB = service.getDeckAudioGraph('B');

    const crossA = (graphA.crossfaderGainNode as unknown as { gain: MockAudioParam }).gain;
    const crossB = (graphB.crossfaderGainNode as unknown as { gain: MockAudioParam }).gain;

    // Extremo A (0.0)
    service.setCrossfader(0.0, 'constant-power');
    assert.equal(crossA.value, 1.0);
    assert.equal(crossB.value, 0.0);

    // Centro (0.5) -> cos(pi/4) ≈ 0.7071
    service.setCrossfader(0.5, 'constant-power');
    assert.ok(Math.abs(crossA.value - 0.7071) < 0.001);
    assert.ok(Math.abs(crossB.value - 0.7071) < 0.001);

    // Extremo B (1.0)
    service.setCrossfader(1.0, 'constant-power');
    assert.equal(crossA.value, 0.0);
    assert.equal(crossB.value, 1.0);
  });

  test('setCrossfader() curva linear atenúa de forma proporcional directa', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');
    const graphB = service.getDeckAudioGraph('B');

    const crossA = (graphA.crossfaderGainNode as unknown as { gain: MockAudioParam }).gain;
    const crossB = (graphB.crossfaderGainNode as unknown as { gain: MockAudioParam }).gain;

    service.setCrossfader(0.0, 'linear');
    assert.equal(crossA.value, 1.0);
    assert.equal(crossB.value, 0.0);

    service.setCrossfader(0.5, 'linear');
    assert.equal(crossA.value, 0.5);
    assert.equal(crossB.value, 0.5);

    service.setCrossfader(1.0, 'linear');
    assert.equal(crossA.value, 0.0);
    assert.equal(crossB.value, 1.0);
  });

  test('setCrossfader() curva cut (scratch) ofrece transición abrupta en extremos y plena ganancia central', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');
    const graphB = service.getDeckAudioGraph('B');

    const crossA = (graphA.crossfaderGainNode as unknown as { gain: MockAudioParam }).gain;
    const crossB = (graphB.crossfaderGainNode as unknown as { gain: MockAudioParam }).gain;

    service.setCrossfader(0.0, 'cut');
    assert.equal(crossA.value, 1.0);
    assert.equal(crossB.value, 0.0);

    // Corte rápido en extremo B (pos = 0.025 -> 0.025 * 20 = 0.5)
    service.setCrossfader(0.025, 'cut');
    assert.equal(crossA.value, 1.0);
    assert.equal(crossB.value, 0.5);

    // En 0.05 ya alcanza 1.0
    service.setCrossfader(0.05, 'cut');
    assert.equal(crossA.value, 1.0);
    assert.equal(crossB.value, 1.0);

    // Centro
    service.setCrossfader(0.5, 'cut');
    assert.equal(crossA.value, 1.0);
    assert.equal(crossB.value, 1.0);

    // En 0.95 todavía está al 100%
    service.setCrossfader(0.95, 'cut');
    assert.equal(crossA.value, 1.0);
    assert.equal(crossB.value, 1.0);

    // Corte rápido en extremo A (pos = 0.975 -> (1 - 0.975) * 20 = 0.5)
    service.setCrossfader(0.975, 'cut');
    assert.equal(crossA.value, 0.5);
    assert.equal(crossB.value, 1.0);

    // Extremo B (1.0)
    service.setCrossfader(1.0, 'cut');
    assert.equal(crossA.value, 0.0);
    assert.equal(crossB.value, 1.0);
  });

  test('setCrossfader() soporta valores normalizados 0..1 y porcentuales 0..100 indistintamente', async () => {
    await service.initialize();
    const graphA = service.getDeckAudioGraph('A');
    const graphB = service.getDeckAudioGraph('B');

    const crossA = (graphA.crossfaderGainNode as unknown as { gain: MockAudioParam }).gain;
    const crossB = (graphB.crossfaderGainNode as unknown as { gain: MockAudioParam }).gain;

    service.setCrossfader(50, 'constant-power');
    assert.ok(Math.abs(crossA.value - 0.7071) < 0.001);
    assert.ok(Math.abs(crossB.value - 0.7071) < 0.001);

    service.setCrossfader(100, 'constant-power');
    assert.equal(crossA.value, 0.0);
    assert.equal(crossB.value, 1.0);

    service.setCrossfader(0, 'constant-power');
    assert.equal(crossA.value, 1.0);
    assert.equal(crossB.value, 0.0);
  });

  test('El vúmetro de canal no se anula cuando el crossfader está en el extremo opuesto', async () => {
    await service.initialize();
    const fakeBuffer = { duration: 120.0 } as AudioBuffer;
    service.loadBufferToDeck('A', fakeBuffer);
    service.playDeck('A', 0);

    const graphA = service.getDeckAudioGraph('A');
    const analyserA = graphA.analyserNode as unknown as MockAnalyserNode;

    // Simular que el canal A tiene señal de audio (amplitud variable)
    analyserA.customData = [200, 56, 200, 56];

    // Mover el crossfader totalmente hacia Deck B (atenuando Deck A a 0 en el master)
    service.setCrossfader(1.0, 'constant-power');
    const crossGainA = (graphA.crossfaderGainNode as unknown as { gain: MockAudioParam }).gain;
    assert.equal(crossGainA.value, 0.0);

    // Comprobar que el vúmetro del canal A sigue midiendo la señal de audio real
    const rmsA = service.getDeckRMS('A');
    const vuA = service.getDeckVUMeter('A');

    assert.ok(rmsA > 0, 'El valor RMS del canal A debe ser > 0 independientemente del crossfader');
    assert.ok(vuA > 0, 'El nivel VU del canal A debe ser > 0 independientemente del crossfader');
  });

  test('Medición RMS Master representa la mezcla combinada y cae a 0 si no hay reproducción', async () => {
    await service.initialize();
    const master = service.getMasterGraph();
    const masterAnalyser = master.masterAnalyserNode as unknown as MockAnalyserNode;

    // Con ambos decks detenidos, el nivel Master debe ser 0
    assert.equal(service.getMasterRMS(), 0);
    assert.equal(service.getMasterVUMeter(), 0);

    // Al reproducir Deck A con señal activa en el analizador maestro
    const fakeBuffer = { duration: 120.0 } as AudioBuffer;
    service.loadBufferToDeck('A', fakeBuffer);
    service.playDeck('A', 0);

    masterAnalyser.customData = [180, 76, 180, 76];
    assert.ok(service.getMasterRMS() > 0, 'El RMS Master debe ser > 0 cuando hay señal');
    assert.ok(service.getMasterVUMeter() > 0, 'El VUMeter Master debe ser > 0 cuando hay señal');
  });

  test('Protección contra picos: DynamicsCompressorNode se configura con parámetros de seguridad', async () => {
    await service.initialize();
    const master = service.getMasterGraph();

    assert.ok(master.limiterNode, 'El nodo limitador de picos debe existir');
    const limiter = master.limiterNode as unknown as MockDynamicsCompressorNode;

    assert.equal(limiter.threshold.value, -1.0, 'Threshold debe configurarse en -1.0 dBFS');
    assert.equal(limiter.ratio.value, 20.0, 'Ratio debe configurarse en 20:1');
    assert.equal(limiter.knee.value, 0.0, 'Knee debe ser 0');
    assert.equal(limiter.attack.value, 0.001, 'Attack debe ser 1 ms');
    assert.equal(limiter.release.value, 0.050, 'Release debe ser 50 ms');
  });

  test('setMasterVolume() ajusta la ganancia del nodo master y aísla el valor', async () => {
    await service.initialize();
    const master = service.getMasterGraph();
    const masterGain = (master.masterGainNode as unknown as { gain: MockAudioParam }).gain;

    service.setMasterVolume(80);
    assert.equal(masterGain.value, 0.8);

    service.setMasterVolume(0);
    assert.equal(masterGain.value, 0.0);

    service.setMasterVolume(100);
    assert.equal(masterGain.value, 1.0);

    // Clamping
    service.setMasterVolume(150);
    assert.equal(masterGain.value, 1.0);
    service.setMasterVolume(-30);
    assert.equal(masterGain.value, 0.0);
  });
});

