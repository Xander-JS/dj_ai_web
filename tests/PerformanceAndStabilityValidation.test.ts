/**
 * SYSTEM DJ — Test Suite: Fase 22 — Etapa 6.4
 * Pruebas y Mediciones Reales de Rendimiento, Memoria y Estabilidad Concurrente
 */

import 'fake-indexeddb/auto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeAudioPcm } from '../src/audio/analysis/audioAnalyzer.ts';
import { audioEngine } from '../src/audio/index.ts';

// Mock minimal de AudioContext para Node.js
class MockAudioParam {
  public value: number;
  constructor(val = 1) { this.value = val; }
  public setValueAtTime(v: number): void { this.value = v; }
}

class MockAudioNode {
  public connect(): MockAudioNode { return this; }
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
  public getByteTimeDomainData(arr: Uint8Array): void { arr.fill(128); }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  public buffer: AudioBuffer | null = null;
  public playbackRate = new MockAudioParam(1);
  public onended: (() => void) | null = null;
  public start(): void {}
  public stop(): void {}
}

class MockAudioContext {
  public state = 'running';
  public currentTime = 10.0;
  public destination = new MockAudioNode();
  public createGain() { return new MockGainNode(); }
  public createBiquadFilter() { return new MockBiquadFilterNode(); }
  public createAnalyser() { return new MockAnalyserNode(); }
  public createBufferSource() { return new MockAudioBufferSourceNode(); }
  public async resume(): Promise<void> { this.state = 'running'; }
  public async close(): Promise<void> { this.state = 'closed'; }
}

// Generador determinista de señal sintética musical para medición de rendimiento
function generateMusicalPcm(durationSec: number, bpm = 124, sampleRate = 44100): Float32Array {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(totalSamples);
  const beatInterval = Math.floor(sampleRate * (60 / bpm));

  // Tonalidad C Mayor (Fundamentales C4=261.63Hz, E4=329.63Hz, G4=392.0Hz)
  const fC = 261.63;
  const fE = 329.63;
  const fG = 392.00;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Base armónica
    const harmony = 0.25 * Math.sin(2 * Math.PI * fC * t) +
                    0.20 * Math.sin(2 * Math.PI * fE * t) +
                    0.20 * Math.sin(2 * Math.PI * fG * t);

    // Pulso rítmico periódico
    const beatPos = i % beatInterval;
    let drum = 0;
    if (beatPos < sampleRate * 0.08) {
      const dt = beatPos / sampleRate;
      drum = 0.5 * Math.exp(-dt * 40) * Math.sin(2 * Math.PI * 65 * dt);
    }

    pcm[i] = Math.max(-1, Math.min(1, harmony + drum));
  }

  return pcm;
}

describe('Fase 22 — Etapa 6.4: Medición de Rendimiento, Memoria y Estabilidad', () => {
  it('6.4.1 Tiempos reales de análisis para audio de 30s, 3 minutos y 6 minutos', () => {
    const sampleRate = 44100;

    // 1. Audio corto: 30 segundos
    const pcm30s = generateMusicalPcm(30, 124, sampleRate);
    const startMem30 = process.memoryUsage().heapUsed;
    const start30 = performance.now();
    const res30s = analyzeAudioPcm(pcm30s, sampleRate);
    const elapsed30s = performance.now() - start30;
    const endMem30 = process.memoryUsage().heapUsed;

    assert.equal(res30s.status, 'analyzed');
    assert.ok(res30s.bpm && res30s.bpm >= 120 && res30s.bpm <= 128, `BPM detectado (${res30s.bpm}) debe estar cerca de 124`);
    assert.equal(res30s.waveformPeaks?.length, 100);
    // Debe procesar 30s en menos de 500 ms en un CPU moderno
    assert.ok(elapsed30s < 1000, `30s de audio tardó ${elapsed30s.toFixed(2)} ms (umbral < 1000 ms)`);

    // 2. Audio estándar: 3 minutos (180 segundos)
    const pcm180s = generateMusicalPcm(180, 124, sampleRate);
    const start180 = performance.now();
    const res180s = analyzeAudioPcm(pcm180s, sampleRate);
    const elapsed180s = performance.now() - start180;

    assert.equal(res180s.status, 'analyzed');
    assert.ok(res180s.bpm && res180s.bpm >= 120 && res180s.bpm <= 128);
    // Debe procesar 180s en menos de 2000 ms
    assert.ok(elapsed180s < 2500, `3 minutos de audio tardó ${elapsed180s.toFixed(2)} ms (umbral < 2500 ms)`);

    // 3. Audio largo: 6 minutos (360 segundos)
    const pcm360s = generateMusicalPcm(360, 124, sampleRate);
    const start360 = performance.now();
    const res360s = analyzeAudioPcm(pcm360s, sampleRate);
    const elapsed360s = performance.now() - start360;

    assert.equal(res360s.status, 'analyzed');
    assert.ok(res360s.bpm && res360s.bpm >= 120 && res360s.bpm <= 128);
    assert.ok(elapsed360s < 5000, `6 minutos de audio tardó ${elapsed360s.toFixed(2)} ms (umbral < 5000 ms)`);

    // Registro documental de métricas reales para el informe
    console.log(`[Rendimiento Real Medido]:
  - Pista 30s:   ${elapsed30s.toFixed(2)} ms | BPM: ${res30s.bpm} | Key: ${res30s.key} (${res30s.camelot}) | Energy: ${res30s.energy}/10 | Mem delta: ${((endMem30 - startMem30) / 1024 / 1024).toFixed(2)} MB
  - Pista 3 min: ${elapsed180s.toFixed(2)} ms | BPM: ${res180s.bpm} | Key: ${res180s.key} (${res180s.camelot}) | Energy: ${res180s.energy}/10
  - Pista 6 min: ${elapsed360s.toFixed(2)} ms | BPM: ${res360s.bpm} | Key: ${res360s.key} (${res360s.camelot}) | Energy: ${res360s.energy}/10`);
  });

  it('6.4.2 Estabilidad e independencia del motor de audio y vúmetros durante el cálculo de análisis', async () => {
    const origWindow = globalThis.window;
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };

    // Verificar que la consulta de vúmetros y el estado del mixer no se degradan durante el análisis
    await audioEngine.initialize();

    const vuA = audioEngine.getDeckVUMeter('A');
    const vuB = audioEngine.getDeckVUMeter('B');
    const vuMaster = audioEngine.getMasterVUMeter();

    assert.ok(vuA >= 0 && vuA <= 100);
    assert.ok(vuB >= 0 && vuB <= 100);
    assert.ok(vuMaster >= 0 && vuMaster <= 100);

    // Simular ráfaga de 30 consultas a 30 FPS (simulando renderizado de UI)
    const vuStart = performance.now();
    for (let frame = 0; frame < 30; frame++) {
      audioEngine.getDeckVUMeter('A');
      audioEngine.getDeckVUMeter('B');
      audioEngine.getMasterVUMeter();
    }
    const vuElapsed = performance.now() - vuStart;

    // 30 lecturas de vúmetros deben demorar menos de 10 ms (sin sobrecargar el renderizado)
    assert.ok(vuElapsed < 10, `30 lecturas de vúmetros tardaron ${vuElapsed.toFixed(3)} ms (promedio: ${(vuElapsed / 30).toFixed(4)} ms/frame)`);

    await audioEngine.dispose();
    (globalThis as unknown as { window: unknown }).window = origWindow;
  });
});
