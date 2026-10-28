/**
 * SYSTEM DJ — Auto Loop y Backspin
 * Reglas puras del loop (longitudes, paso, región A→B con rejilla) y el transporte del motor:
 * el bucle nativo de la fuente y la posición envuelta, y el backspin con la copia invertida.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngineService, BACKSPIN_SECONDS, backspinTravel } from '../src/audio/AudioEngineService.ts';
import { DEFAULT_LOOP_BEATS, formatLoopBeats, loopRegion, stepLoopBeats } from '../src/services/console/deckLoop.ts';

class Param {
  public value = 1;
  public ramps: number[] = [];
  setValueAtTime(value: number) { this.value = value; return this; }
  exponentialRampToValueAtTime(value: number) { this.ramps.push(value); return this; }
  linearRampToValueAtTime(value: number) { this.value = value; return this; }
  cancelScheduledValues() { return this; }
}

class Node {
  public connectedTo: unknown[] = [];
  public gain = new Param();
  public frequency = new Param();
  public Q = new Param();
  public threshold = new Param();
  public knee = new Param();
  public ratio = new Param();
  public attack = new Param();
  public release = new Param();
  public fftSize = 256;
  public frequencyBinCount = 128;
  connect(target: unknown) { this.connectedTo.push(target); return target; }
  disconnect() { this.connectedTo = []; }
}

class Source extends Node {
  public buffer: AudioBuffer | null = null;
  public playbackRate = new Param();
  public loop = false;
  public loopStart = 0;
  public loopEnd = 0;
  public offset = -1;
  public onended: (() => void) | null = null;
  start(_when: number, offset: number) { this.offset = offset; }
  stop() {}
}

function makeBuffer(samples: number[], sampleRate = 10): AudioBuffer {
  const data = Float32Array.from(samples);
  return {
    duration: samples.length / sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

class Context {
  public state = 'running';
  public currentTime = 10;
  public destination = new Node();
  public sources: Source[] = [];
  createGain() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createAnalyser() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createBufferSource() { const s = new Source(); this.sources.push(s); return s; }
  createBuffer(_channels: number, length: number, sampleRate: number) { return makeBuffer(new Array(length).fill(0), sampleRate); }
  async resume() {}
  async close() {}
}

describe('Auto Loop — reglas puras', () => {
  test('− y + recorren ¼…32 sin pasar de los extremos; por defecto 1', () => {
    assert.equal(DEFAULT_LOOP_BEATS, 1);
    assert.equal(stepLoopBeats(1, 1), 2);
    assert.equal(stepLoopBeats(1, -1), 0.5);
    assert.equal(stepLoopBeats(0.25, -1), 0.25);
    assert.equal(stepLoopBeats(32, 1), 32);
    assert.deepEqual([0.25, 0.5, 4].map(formatLoopBeats), ['¼', '½', '4']);
  });

  test('B = A + pulsos × 60 / BPM; con rejilla, A va al pulso más cercano', () => {
    assert.deepEqual(loopRegion(10, 4, 120, null), { start: 10, end: 12 });
    // Pulso de 0,5 s desde el downbeat 0,1: 10,3 → 10,1
    const snapped = loopRegion(10.3, 1, 120, 0.1);
    assert.ok(Math.abs(snapped.start - 10.1) < 1e-9);
    assert.ok(Math.abs(snapped.end - 10.6) < 1e-9);
  });
});

describe('AudioEngineService — loop y backspin', () => {
  let service: AudioEngineService;
  let ctx: Context;
  const originalWindow = globalThis.window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = { AudioContext: Context };
    service = new AudioEngineService();
    await service.initialize();
    ctx = (service as unknown as { audioContext: Context }).audioContext;
  });

  afterEach(async () => {
    await service.dispose();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  test('el bucle usa los puntos nativos de la fuente y la posición vuelve a A pasada B', () => {
    service.loadBufferToDeck('A', makeBuffer(new Array(600).fill(0)));
    service.playDeck('A', 5);
    service.setDeckLoop('A', 5, 7);
    const source = ctx.sources.at(-1)!;
    assert.equal(source.loop, true);
    assert.equal(source.loopStart, 5);
    assert.equal(source.loopEnd, 7);
    ctx.currentTime += 2.5;
    assert.ok(Math.abs(service.getDeckCurrentTime('A') - 5.5) < 1e-9);

    // Acortar con el playhead pasado la nueva B: vuelve a A
    service.setDeckLoop('A', 5, 5.25);
    assert.ok(Math.abs(service.getDeckCurrentTime('A') - 5) < 1e-9);

    service.clearDeckLoop('A');
    assert.equal(ctx.sources.at(-1)!.loop, false);
    ctx.currentTime += 1;
    assert.ok(Math.abs(service.getDeckCurrentTime('A') - 6) < 1e-9);
  });

  test('el backspin suena con la copia invertida y deja el deck en pausa donde llegó', () => {
    service.loadBufferToDeck('A', makeBuffer([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 1));
    service.playDeck('A', 6);
    let ended = 0;
    assert.equal(service.backspinDeck('A', () => ended++), true);
    assert.equal(service.backspinDeck('A', () => ended++), false, 'no se relanza mientras corre');
    assert.equal(service.isDeckPlaying('A'), false);

    const reverse = ctx.sources.at(-1)!;
    assert.deepEqual(Array.from(reverse.buffer!.getChannelData(0)), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    assert.equal(reverse.offset, 4, 'arranca en la posición espejo');
    assert.equal(reverse.playbackRate.value, 3);

    ctx.currentTime += BACKSPIN_SECONDS;
    reverse.onended!();
    assert.equal(ended, 1);
    assert.equal(service.isDeckBackspinning('A'), false);
    assert.ok(Math.abs(service.getDeckCurrentTime('A') - (6 - backspinTravel(BACKSPIN_SECONDS))) < 1e-9);
  });

  test('PLAY durante el backspin lo corta y sigue desde la posición alcanzada', () => {
    service.loadBufferToDeck('A', makeBuffer(new Array(100).fill(0), 10));
    service.playDeck('A', 5);
    let ended = 0;
    service.backspinDeck('A', () => ended++);
    ctx.currentTime += 0.2;
    const reached = service.getDeckCurrentTime('A');
    assert.ok(reached < 5);
    service.playDeck('A', reached);
    assert.equal(ended, 1);
    assert.equal(service.isDeckPlaying('A'), true);
    assert.ok(Math.abs(ctx.sources.at(-1)!.offset - reached) < 1e-9);
  });
});
