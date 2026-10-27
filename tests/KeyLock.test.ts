/**
 * SYSTEM DJ — KEY LOCK (secciones 2 y 3, fila de sincronización)
 *
 * 1. El desplazador granular devuelve el tono original cuando el deck va más rápido o más lento.
 * 2. El motor solo desvía la fuente por el desplazador con KEY LOCK activo; sin él, la ruta es la
 *    de siempre. Velocidad y corrección de tono reciben la misma programación.
 * 3. El store expone `isKeyLocked` / `toggleKeyLock` sin tocar velocidad, pitch ni SYNC.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GranularPitchShifter, KEY_LOCK_PROCESSOR_NAME } from '../src/audio/keyLock/granularPitchShifter.ts';
import { AudioEngineService } from '../src/audio/AudioEngineService.ts';
import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';

const SAMPLE_RATE = 48000;

/** Frecuencia dominante (Hz) entre `lo` y `hi`, por DFT directa con paso de 0,5 Hz. */
function dominantFrequency(signal: Float32Array, from: number, lo: number, hi: number): number {
  let best = 0;
  let bestFrequency = 0;
  for (let f = lo; f <= hi; f += 0.5) {
    let re = 0;
    let im = 0;
    for (let n = from; n < signal.length; n++) {
      const w = (2 * Math.PI * f * n) / SAMPLE_RATE;
      re += signal[n] * Math.cos(w);
      im += signal[n] * Math.sin(w);
    }
    const magnitude = re * re + im * im;
    if (magnitude > best) {
      best = magnitude;
      bestFrequency = f;
    }
  }
  return bestFrequency;
}

/** Pasa `input` por el desplazador en bloques de 128 muestras, como el hilo de audio. */
function runShifter(input: Float32Array, pitch: number): Float32Array {
  const shifter = new GranularPitchShifter(SAMPLE_RATE, 1);
  const output = new Float32Array(input.length);
  for (let offset = 0; offset < input.length; offset += 128) {
    const frames = Math.min(128, input.length - offset);
    const block = new Float32Array(128);
    shifter.process([input.subarray(offset, offset + frames)], [block], frames, pitch);
    output.set(block.subarray(0, frames), offset);
  }
  return output;
}

const sine = (frequency: number, seconds: number): Float32Array => {
  const length = Math.round(SAMPLE_RATE * seconds);
  const signal = new Float32Array(length);
  for (let n = 0; n < length; n++) signal[n] = Math.sin((2 * Math.PI * frequency * n) / SAMPLE_RATE);
  return signal;
};

describe('KEY LOCK — desplazador de tono granular', () => {
  for (const rate of [0.92, 1.08, 1.16]) {
    it(`a velocidad ×${rate} devuelve un La 440 Hz a su tono original`, () => {
      // La fuente a velocidad `rate` sube el La a 440·rate Hz; KEY LOCK aplica 1 / rate
      const sped = sine(440 * rate, 0.6);
      const restored = runShifter(sped, 1 / rate);
      const measured = dominantFrequency(restored, restored.length / 2, 380, 520);
      assert.ok(Math.abs(measured - 440) <= 4, `Esperado ≈ 440 Hz, medido ${measured} Hz`);
      // Sin KEY LOCK el tono seguiría desplazado
      assert.ok(Math.abs(dominantFrequency(sped, sped.length / 2, 380, 520) - 440 * rate) <= 1);
    });
  }

  it('con factor 1 acaba sonando un solo cabezal: la señal sale intacta con media ventana de retardo', () => {
    const shifter = new GranularPitchShifter(SAMPLE_RATE, 1);
    const input = sine(220, 0.3);
    const output = new Float32Array(input.length);
    for (let offset = 0; offset < input.length; offset += 128) {
      const block = new Float32Array(128);
      const frames = Math.min(128, input.length - offset);
      shifter.process([input.subarray(offset, offset + frames)], [block], frames, 1);
      output.set(block.subarray(0, frames), offset);
    }
    const latency = Math.round(shifter.latencySamples);
    let maxError = 0;
    for (let n = input.length - 2000; n < input.length; n++) {
      maxError = Math.max(maxError, Math.abs(output[n] - input[n - latency]));
    }
    assert.ok(maxError < 0.02, `La salida debe ser la entrada retrasada (error máximo ${maxError})`);
  });

  it('el nivel se conserva y nunca produce valores no finitos', () => {
    const output = runShifter(sine(330 * 1.08, 0.4), 1 / 1.08);
    let sumSquares = 0;
    for (let n = output.length / 2; n < output.length; n++) {
      assert.ok(Number.isFinite(output[n]));
      sumSquares += output[n] * output[n];
    }
    const rms = Math.sqrt(sumSquares / (output.length / 2));
    assert.ok(rms > 0.3 && rms < 0.8, `RMS fuera de rango: ${rms}`);
  });

  it('una velocidad no válida se trata como factor 1 y la salida estéreo sin entrada derecha copia la izquierda', () => {
    const shifter = new GranularPitchShifter(SAMPLE_RATE, 1);
    const left = new Float32Array(128).fill(0.5);
    const outL = new Float32Array(128);
    const outR = new Float32Array(128);
    shifter.process([left], [outL, outR], 128, Number.NaN);
    assert.deepEqual(Array.from(outR), Array.from(outL));
  });
});

// --- Motor: mocks mínimos de Web Audio con AudioWorklet ---

class MockParam {
  public value = 1;
  public calls: string[] = [];
  public setValueAtTime(v: number): this {
    this.value = v;
    this.calls.push(`set:${v}`);
    return this;
  }
  public linearRampToValueAtTime(v: number): this {
    this.value = v;
    this.calls.push(`ramp:${v}`);
    return this;
  }
  public cancelScheduledValues(): this {
    this.calls.push('cancel');
    return this;
  }
  public cancelAndHoldAtTime(): this {
    this.calls.push('hold');
    return this;
  }
}

class MockNode {
  public connectedTo: unknown[] = [];
  public connect(destination: unknown): unknown {
    this.connectedTo.push(destination);
    return destination;
  }
  public disconnect(): void {
    this.connectedTo = [];
  }
}

class MockGain extends MockNode {
  public gain = new MockParam();
}

class MockBiquad extends MockNode {
  public type = 'allpass';
  public frequency = new MockParam();
  public gain = new MockParam();
  public Q = new MockParam();
}

class MockAnalyser extends MockNode {
  public fftSize = 256;
  public frequencyBinCount = 128;
  public smoothingTimeConstant = 0.8;
  public getByteTimeDomainData(array: Uint8Array): void {
    array.fill(128);
  }
}

class MockCompressor extends MockNode {
  public threshold = new MockParam();
  public knee = new MockParam();
  public ratio = new MockParam();
  public attack = new MockParam();
  public release = new MockParam();
}

class MockSource extends MockNode {
  public buffer: AudioBuffer | null = null;
  public playbackRate = new MockParam();
  public onended: (() => void) | null = null;
  public start(): void {}
  public stop(): void {}
}

class MockWorkletNode extends MockNode {
  public static created: MockWorkletNode[] = [];
  public readonly name: string;
  public readonly rate = new MockParam();
  public readonly parameters = new Map<string, MockParam>([['rate', this.rate]]);
  public readonly messages: unknown[] = [];
  public readonly port = { postMessage: (message: unknown) => this.messages.push(message) };
  constructor(_ctx: unknown, name: string) {
    super();
    this.name = name;
    MockWorkletNode.created.push(this);
  }
}

class MockContext {
  public state = 'running';
  public currentTime = 5;
  public destination = new MockNode();
  public onstatechange: (() => void) | null = null;
  public audioWorklet = { modules: [] as string[], addModule: async (url: string) => void this.audioWorklet.modules.push(url) };
  public createGain() { return new MockGain(); }
  public createBiquadFilter() { return new MockBiquad(); }
  public createAnalyser() { return new MockAnalyser(); }
  public createDynamicsCompressor() { return new MockCompressor(); }
  public createBufferSource() { return new MockSource(); }
  public async resume() {}
  public async close() { this.state = 'closed'; }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const fakeBuffer = { duration: 120 } as AudioBuffer;

describe('KEY LOCK — motor de audio', () => {
  const originalWindow = globalThis.window;
  const originalWorkletNode = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;
  let engine: AudioEngineService;
  let loads = 0;

  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = { AudioContext: MockContext };
    (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = MockWorkletNode;
    MockWorkletNode.created = [];
    loads = 0;
    engine = new AudioEngineService();
    engine.setKeyLockModuleLoader(async () => {
      loads++;
    });
  });

  afterEach(async () => {
    await engine.dispose();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
    (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = originalWorkletNode;
  });

  const source = (deck: 'A' | 'B') => engine.getDeckAudioGraph(deck).sourceNode as unknown as MockSource;

  it('sin KEY LOCK la fuente va directa a la ganancia del canal y no se carga ningún AudioWorklet', async () => {
    await engine.initialize();
    engine.loadBufferToDeck('A', fakeBuffer);
    engine.playDeck('A', 0);
    const graph = engine.getDeckAudioGraph('A');
    assert.deepEqual(source('A').connectedTo, [graph.gainNode]);
    assert.equal(graph.keyLockNode ?? null, null);
    assert.equal(loads, 0);
  });

  it('al activarlo, la fuente sonando pasa por el desplazador, que sigue conectado al canal', async () => {
    await engine.initialize();
    engine.loadBufferToDeck('A', fakeBuffer);
    engine.setDeckPlaybackRate('A', 1.06);
    engine.playDeck('A', 0);

    engine.setDeckKeyLock('A', true);
    await flush();

    const graph = engine.getDeckAudioGraph('A');
    const node = graph.keyLockNode as unknown as MockWorkletNode;
    assert.ok(node, 'Debe existir el desplazador');
    assert.equal(node.name, KEY_LOCK_PROCESSOR_NAME);
    assert.deepEqual(node.connectedTo, [graph.gainNode]);
    assert.deepEqual(source('A').connectedTo, [node]);
    assert.equal(node.rate.value, 1.06, 'La corrección de tono arranca con la velocidad actual');
    assert.equal(engine.isDeckKeyLockEngaged('A'), true);
    assert.equal(engine.isDeckKeyLockEngaged('B'), false, 'El otro deck no cambia');
    assert.equal(loads, 1);
  });

  it('el fader de pitch y el pitch bend programan la misma velocidad en la fuente y en el desplazador', async () => {
    await engine.initialize();
    engine.loadBufferToDeck('A', fakeBuffer);
    engine.setDeckKeyLock('A', true);
    await flush();
    engine.playDeck('A', 0);
    const node = engine.getDeckAudioGraph('A').keyLockNode as unknown as MockWorkletNode;

    engine.setDeckPlaybackRate('A', 0.95);
    assert.equal(source('A').playbackRate.value, 0.95);
    assert.equal(node.rate.value, 0.95);

    engine.setDeckPitchBend('A', 0.035);
    assert.equal(node.rate.value, source('A').playbackRate.value);
    engine.setDeckPitchBend('A', 0);
    assert.equal(node.rate.value, source('A').playbackRate.value);
    assert.ok(node.rate.calls.includes('ramp:0.95'), 'La vuelta del bend también es rampa en el desplazador');
  });

  it('cada arranque vacía la línea de retardo para no arrastrar audio de la posición anterior', async () => {
    await engine.initialize();
    engine.loadBufferToDeck('A', fakeBuffer);
    engine.setDeckKeyLock('A', true);
    await flush();
    engine.playDeck('A', 0);
    engine.seekDeck('A', 30);
    const node = engine.getDeckAudioGraph('A').keyLockNode as unknown as MockWorkletNode;
    assert.equal(node.messages.filter((m) => m === 'reset').length, 2);
    assert.deepEqual(source('A').connectedTo, [node]);
  });

  it('al desactivarlo la fuente vuelve a la ruta directa sin parar la reproducción', async () => {
    await engine.initialize();
    engine.loadBufferToDeck('A', fakeBuffer);
    engine.playDeck('A', 0);
    engine.setDeckKeyLock('A', true);
    await flush();
    const playing = source('A');

    engine.setDeckKeyLock('A', false);
    const graph = engine.getDeckAudioGraph('A');
    assert.equal(source('A'), playing, 'Misma fuente: no hay corte ni salto de posición');
    assert.deepEqual(playing.connectedTo, [graph.gainNode]);
    assert.equal(engine.isDeckPlaying('A'), true);
    assert.equal(engine.isDeckKeyLocked('A'), false);
  });

  it('activado antes de crear el contexto se aplica al inicializar', async () => {
    engine.setDeckKeyLock('B', true);
    assert.equal(engine.isDeckKeyLocked('B'), true);
    await engine.initialize();
    await flush();
    assert.ok(engine.getDeckAudioGraph('B').keyLockNode);
  });

  it('sin soporte de AudioWorklet guarda el estado y el audio sigue por la ruta directa', async () => {
    (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = undefined;
    await engine.initialize();
    engine.loadBufferToDeck('A', fakeBuffer);
    engine.playDeck('A', 0);
    engine.setDeckKeyLock('A', true);
    await flush();
    assert.equal(engine.isDeckKeyLocked('A'), true);
    assert.equal(engine.isDeckKeyLockEngaged('A'), false);
    assert.deepEqual(source('A').connectedTo, [engine.getDeckAudioGraph('A').gainNode]);
    assert.equal(loads, 0);
  });

  it('si el AudioWorklet no carga, la reproducción no se interrumpe', async () => {
    engine.setKeyLockModuleLoader(async () => {
      throw new Error('sin red');
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      await engine.initialize();
      engine.loadBufferToDeck('A', fakeBuffer);
      engine.playDeck('A', 0);
      engine.setDeckKeyLock('A', true);
      await flush();
      await flush();
    } finally {
      console.error = originalError;
    }
    assert.equal(engine.isDeckKeyLockEngaged('A'), false);
    assert.deepEqual(source('A').connectedTo, [engine.getDeckAudioGraph('A').gainNode]);
  });
});

describe('KEY LOCK — store', () => {
  const originalWindow = globalThis.window;
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = { AudioContext: MockContext };
  });
  afterEach(async () => {
    await audioEngine.dispose();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('toggleKeyLock alterna el estado del deck sin tocar velocidad, pitch ni SYNC', () => {
    const before = djStore.getSnapshot().deckA;
    assert.equal(before.isKeyLocked, false, 'Apagado por defecto');

    djStore.toggleKeyLock('A');
    const after = djStore.getSnapshot().deckA;
    assert.equal(after.isKeyLocked, true);
    assert.equal(after.playbackRate, before.playbackRate);
    assert.equal(after.pitch, before.pitch);
    assert.equal(after.isSyncActive, before.isSyncActive);
    assert.equal(djStore.getSnapshot().deckB.isKeyLocked, false, 'Cada deck tiene su propio KEY LOCK');
    assert.equal(audioEngine.isDeckKeyLocked('A'), true, 'El motor recibe el cambio');

    djStore.toggleKeyLock('A');
    assert.equal(djStore.getSnapshot().deckA.isKeyLocked, false);
    assert.equal(audioEngine.isDeckKeyLocked('A'), false);
  });

  it('se conserva al expulsar la pista, como el Master Tempo de un CDJ', () => {
    djStore.toggleKeyLock('B');
    djStore.unloadDeck('B');
    assert.equal(djStore.getSnapshot().deckB.isKeyLocked, true);
    djStore.toggleKeyLock('B');
  });
});
