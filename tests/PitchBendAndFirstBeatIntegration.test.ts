/**
 * SYSTEM DJ — Test Suite: Fase 23.3
 * Pitch Bend (+ / - Nudge temporal) y Detección Matemática de Primer Beat (firstBeatTime)
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import { detectFirstBeatTime } from '../src/audio/analysis/bpmDetector.ts';
import { analyzeAudioPcm } from '../src/audio/analysis/audioAnalyzer.ts';

// Mock minimal de Web Audio API para simulación determinista en Node.js
class MockAudioParam {
  public value: number;
  public ramps: Array<{ value: number; time: number }> = [];
  constructor(val = 1) {
    this.value = val;
  }
  public setValueAtTime(v: number): void {
    this.value = v;
  }
  public linearRampToValueAtTime(v: number, time: number): void {
    this.ramps.push({ value: v, time });
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
  public start(): void {}
  public stop(): void {}
}

class MockAudioContext {
  public state: AudioContextState = 'running';
  public currentTime = 10.0;
  public sampleRate = 44100;
  public destination = new MockAudioNode();

  public createGain(): MockGainNode {
    return new MockGainNode();
  }
  public createBiquadFilter(): MockBiquadFilterNode {
    return new MockBiquadFilterNode();
  }
  public createAnalyser(): MockAnalyserNode {
    return new MockAnalyserNode();
  }
  public createBufferSource(): MockAudioBufferSourceNode {
    return new MockAudioBufferSourceNode();
  }
  public async decodeAudioData(): Promise<AudioBuffer> {
    return {
      duration: 180.0,
      length: 180 * 44100,
      numberOfChannels: 2,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(44100),
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

function createTestAudioFile(name = 'test_track.mp3'): File {
  const dummyPcm = new Uint8Array(44100);
  return new File([dummyPcm], name, { type: 'audio/mpeg' });
}

describe('Fase 23.3: Pitch Bend y Detección de Primer Beat (firstBeatTime)', () => {
  let originalAudioContext: unknown;
  let originalWindow: unknown;

  beforeEach(async () => {
    originalAudioContext = (globalThis as unknown as { AudioContext: unknown }).AudioContext;
    originalWindow = (globalThis as unknown as { window: unknown }).window;

    (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
      requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16),
      cancelAnimationFrame: (id: unknown) => clearTimeout(id as NodeJS.Timeout),
    };

    await audioEngine.initialize();
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
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  // ========================================================
  // 1. Pruebas de AudioEngineService: Pitch Bend
  // ========================================================
  describe('1. AudioEngineService: Control de Pitch Bend', () => {
    it('1.1 setDeckPitchBend acelera (+3.5%) y desacelera (-3.5%) la velocidad de reproducción', async () => {
      const file = createTestAudioFile('track_bend_1.mp3');
      const track = createTrackFromFile(file, 120.0);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      // Velocidad base nominal: 1.0 (pitch = 0%)
      assert.equal(audioEngine.getDeckPlaybackRate('A'), 1.0);
      assert.equal(audioEngine.getDeckPitchBend('A'), 0);

      // Aplicar Pitch Bend UP (+3.5%)
      audioEngine.setDeckPitchBend('A', 0.035);
      assert.equal(audioEngine.getDeckPitchBend('A'), 0.035);
      // 1.0 * (1 + 0.035) = 1.035
      const rateUp = audioEngine.getDeckPlaybackRate('A');
      assert.ok(Math.abs(rateUp - 1.035) < 0.0001, `Velocidad efectiva esperada ~1.035, recibida ${rateUp}`);

      // Aplicar Pitch Bend DOWN (-3.5%)
      audioEngine.setDeckPitchBend('A', -0.035);
      assert.equal(audioEngine.getDeckPitchBend('A'), -0.035);
      // 1.0 * (1 - 0.035) = 0.965
      const rateDown = audioEngine.getDeckPlaybackRate('A');
      assert.ok(Math.abs(rateDown - 0.965) < 0.0001, `Velocidad efectiva esperada ~0.965, recibida ${rateDown}`);

      // Release (0)
      audioEngine.setDeckPitchBend('A', 0);
      assert.equal(audioEngine.getDeckPitchBend('A'), 0);
      assert.equal(audioEngine.getDeckPlaybackRate('A'), 1.0);
    });

    it('1.2 Clamping estricto de velocidad efectiva dentro de ±8% (0.92 a 1.08)', async () => {
      const file = createTestAudioFile('track_bend_clamp.mp3');
      const track = createTrackFromFile(file, 120.0);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      // Fijar pitch al máximo permitido: +8% (rate = 1.08)
      audioEngine.setDeckPlaybackRate('A', 1.08);
      assert.equal(audioEngine.getDeckPlaybackRate('A'), 1.08);

      // Aplicar bend UP: no debe exceder 1.08 bajo ninguna circunstancia
      audioEngine.setDeckPitchBend('A', 0.035);
      const rateClampedHigh = audioEngine.getDeckPlaybackRate('A');
      assert.equal(rateClampedHigh, 1.08, `El límite superior estricto debe ser 1.08, recibido ${rateClampedHigh}`);

      // Fijar pitch al mínimo permitido: -8% (rate = 0.92)
      audioEngine.setDeckPitchBend('A', 0);
      audioEngine.setDeckPlaybackRate('A', 0.92);
      assert.equal(audioEngine.getDeckPlaybackRate('A'), 0.92);

      // Aplicar bend DOWN: no debe descender de 0.92
      audioEngine.setDeckPitchBend('A', -0.035);
      const rateClampedLow = audioEngine.getDeckPlaybackRate('A');
      assert.equal(rateClampedLow, 0.92, `El límite inferior estricto debe ser 0.92, recibido ${rateClampedLow}`);
    });

    it('1.3 Continuidad temporal en getDeckCurrentTime durante reproducción con pitch bend', async () => {
      const file = createTestAudioFile('track_bend_time.mp3');
      const track = createTrackFromFile(file, 120.0);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);
      await djStore.playDeckA();

      const timeBeforeBend = audioEngine.getDeckCurrentTime('A');
      assert.ok(timeBeforeBend >= 0);

      // Aplicar bend UP
      audioEngine.setDeckPitchBend('A', 0.035);
      const timeDuringBend = audioEngine.getDeckCurrentTime('A');
      assert.ok(
        Math.abs(timeDuringBend - timeBeforeBend) < 0.01,
        'No debe existir salto temporal discontinuo al iniciar pitch bend'
      );

      // Liberar bend
      audioEngine.setDeckPitchBend('A', 0);
      const timeAfterRelease = audioEngine.getDeckCurrentTime('A');
      assert.ok(
        Math.abs(timeAfterRelease - timeDuringBend) < 0.01,
        'No debe existir salto temporal discontinuo al liberar pitch bend'
      );
      const playbackRateParam = (audioEngine as unknown as { deckGraphs: Map<string, { sourceNode: MockAudioBufferSourceNode }> }).deckGraphs.get('A')?.sourceNode.playbackRate;
      assert.equal(playbackRateParam?.ramps.at(-1)?.value, 1.0, 'Release debe programar la tasa nominal');
      assert.equal(playbackRateParam?.ramps.at(-1)?.time, 10.04, 'Release debe usar una rampa de 40 ms');
    });
  });

  // ========================================================
  // 2. Pruebas de DJStore y Reactividad
  // ========================================================
  describe('2. DJStore: Acciones de Pitch Bend y Gestión de Estado', () => {
    it('2.1 djStore.pitchBend actualiza el estado y transmite la variación al motor de audio', async () => {
      const file = createTestAudioFile('track_store_bend.mp3');
      const track = createTrackFromFile(file, 150.0);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      assert.equal(djStore.getSnapshot().deckA.pitchBend, 0);

      // Pitch Bend UP
      djStore.pitchBend('A', 'up');
      assert.equal(djStore.getSnapshot().deckA.pitchBend, 3.5);
      assert.equal(audioEngine.getDeckPitchBend('A'), 0.035);

      // Pitch Bend DOWN
      djStore.pitchBend('A', 'down');
      assert.equal(djStore.getSnapshot().deckA.pitchBend, -3.5);
      assert.equal(audioEngine.getDeckPitchBend('A'), -0.035);

      // Release
      djStore.pitchBend('A', 'release');
      assert.equal(djStore.getSnapshot().deckA.pitchBend, 0);
      assert.equal(audioEngine.getDeckPitchBend('A'), 0);

      const permanentRate = djStore.getSnapshot().deckA.playbackRate;
      djStore.pitchBend('A', 'up');
      const firstBendRate = audioEngine.getDeckPlaybackRate('A');
      djStore.pitchBend('A', 'up');
      assert.equal(audioEngine.getDeckPlaybackRate('A'), firstBendRate, 'Pulsaciones repetidas no acumulan el bend');
      djStore.pitchBend('A', 'release');
      assert.equal(audioEngine.getDeckPlaybackRate('A'), permanentRate);
      assert.equal(djStore.getSnapshot().deckA.playbackRate, permanentRate);
    });

    it('2.1a El bend respeta el pitch permanente y refleja el clamping efectivo', async () => {
      const file = createTestAudioFile('track_bend_limit_store.mp3');
      const track = createTrackFromFile(file, 120.0);
      track.analysis = { status: 'analyzed', bpm: 120, bpmConfidence: 0.99, firstBeatTime: 0.2 };
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);
      djStore.setPitchDeckA(100);
      const permanentRate = djStore.getSnapshot().deckA.playbackRate;
      djStore.pitchBend('A', 'up');
      assert.equal(audioEngine.getDeckPlaybackRate('A'), 1.08);
      assert.equal(djStore.getSnapshot().deckA.pitchBend, 0);
      assert.equal(djStore.getSnapshot().deckA.playbackRate, permanentRate);
      assert.equal(djStore.getSnapshot().deckA.calculatedBpm, 129.6);
      djStore.pitchBend('A', 'release');
      assert.equal(audioEngine.getDeckPitchBend('A'), 0);
      assert.equal(djStore.getSnapshot().deckA.playbackRate, permanentRate);
      djStore.setPitchDeckA(50);
    });

    it('2.1b alignPhase rechaza análisis legacy sin firstBeatTime en vez de asumir posición cero', async () => {
      const createAnalyzed = async (name: string) => {
        const file = createTestAudioFile(name);
        const track = createTrackFromFile(file, 120.0);
        track.analysis = {
          status: 'analyzed',
          bpm: 120,
          bpmConfidence: 0.99,
          isAmbiguous: false,
          alternateBpm: [60],
        };
        await indexedDBStorage.saveTrack(track, file);
        return track;
      };
      const trackA = await createAnalyzed('phase_master_missing_anchor.mp3');
      const trackB = await createAnalyzed('phase_slave_missing_anchor.mp3');
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);
      assert.equal(djStore.syncDeck('B'), true);
      await djStore.playDeckA();
      await djStore.playDeckB();
      assert.equal(djStore.alignPhase('B'), false);
      assert.equal(djStore.getSnapshot().deckB.phaseAlignment.status, 'rejected_confidence');
    });

    it('2.2 Independencia absoluta de Pitch Bend entre Deck A y Deck B', async () => {
      const fileA = createTestAudioFile('track_a.mp3');
      const trackA = createTrackFromFile(fileA, 100.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await djStore.loadTrackToDeckA(trackA);

      const fileB = createTestAudioFile('track_b.mp3');
      const trackB = createTrackFromFile(fileB, 100.0);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckB(trackB);

      // Activar bend en Deck A solamente
      djStore.pitchBend('A', 'up');
      assert.equal(djStore.getSnapshot().deckA.pitchBend, 3.5);
      assert.equal(audioEngine.getDeckPitchBend('A'), 0.035);

      // Deck B debe permanecer inalterado en 0
      assert.equal(djStore.getSnapshot().deckB.pitchBend, 0);
      assert.equal(audioEngine.getDeckPitchBend('B'), 0);

      // Activar bend en Deck B en dirección contraria
      djStore.pitchBend('B', 'down');
      assert.equal(djStore.getSnapshot().deckA.pitchBend, 3.5);
      assert.equal(djStore.getSnapshot().deckB.pitchBend, -3.5);
      assert.equal(audioEngine.getDeckPitchBend('B'), -0.035);

      // Liberar Deck A no afecta Deck B
      djStore.pitchBend('A', 'release');
      assert.equal(djStore.getSnapshot().deckA.pitchBend, 0);
      assert.equal(djStore.getSnapshot().deckB.pitchBend, -3.5);
    });

    it('2.3 unloadDeck restablece pitchBend a 0 en el store y en el motor', async () => {
      const file = createTestAudioFile('track_unload_bend.mp3');
      const track = createTrackFromFile(file, 120.0);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      djStore.pitchBend('A', 'up');
      assert.equal(djStore.getSnapshot().deckA.pitchBend, 3.5);
      assert.equal(audioEngine.getDeckPitchBend('A'), 0.035);

      djStore.unloadDeckA();
      assert.equal(djStore.getSnapshot().deckA.pitchBend, 0);
      assert.equal(audioEngine.getDeckPitchBend('A'), 0);
    });
  });

  // ========================================================
  // 3. Detección Matemática de Primer Beat (firstBeatTime)
  // ========================================================
  describe('3. Detección algorítmica de firstBeatTime', () => {
    it('3.1 detectFirstBeatTime localiza con precisión el primer pulso percusivo sintético', () => {
      const sampleRate = 44100;
      const durationSec = 4;
      const pcm = new Float32Array(sampleRate * durationSec);

      // Inyectar un pulso percusivo nítido en t = 0.5 segundos (muestra 22050)
      const targetTimeSec = 0.5;
      const pulseIndex = Math.round(targetTimeSec * sampleRate);
      for (let i = 0; i < 400; i++) {
        // Envolvente de decaimiento rápido emulando transitorio de bombo / kick
        const decay = Math.exp(-i / 80);
        pcm[pulseIndex + i] = 0.9 * Math.sin((2 * Math.PI * 60 * i) / sampleRate) * decay;
      }

      // Inyectar pulsos subsecuentes a 120 BPM (cada 0.5s: 1.0s, 1.5s, 2.0s, etc.)
      for (let beat = 1; beat < 7; beat++) {
        const beatIndex = Math.round((targetTimeSec + beat * 0.5) * sampleRate);
        for (let i = 0; i < 400; i++) {
          const decay = Math.exp(-i / 80);
          pcm[beatIndex + i] = 0.9 * Math.sin((2 * Math.PI * 60 * i) / sampleRate) * decay;
        }
      }

      const detectedTime = detectFirstBeatTime(pcm, sampleRate);
      assert.ok(detectedTime !== null, 'Debe detectar el primer beat transitorio');
      assert.ok(
        Math.abs(detectedTime - targetTimeSec) <= 0.025,
        `El primer beat detectado (${detectedTime}s) debe coincidir con ${targetTimeSec}s con tolerancia de 25ms`
      );
    });

    it('3.2 detectFirstBeatTime devuelve null en señal de silencio absoluto o de baja amplitud', () => {
      const sampleRate = 44100;
      const silentPcm = new Float32Array(sampleRate * 3); // 3 segundos de ceros

      const result = detectFirstBeatTime(silentPcm, sampleRate);
      assert.equal(result, null, 'En silencio debe retornar null sin errores');

      // Ruido de fondo microscópico
      const noisePcm = new Float32Array(sampleRate * 2);
      for (let i = 0; i < noisePcm.length; i++) {
        noisePcm[i] = (Math.random() - 0.5) * 1e-5;
      }
      const noiseResult = detectFirstBeatTime(noisePcm, sampleRate);
      assert.equal(noiseResult, null, 'En ruido inaudible debe retornar null');
    });

    it('3.3 detectFirstBeatTime devuelve null en audio sinusoidal puro y continuo (drone/ambient sin ritmo)', () => {
      const sampleRate = 44100;
      const continuousPcm = new Float32Array(sampleRate * 4);
      for (let i = 0; i < continuousPcm.length; i++) {
        // Tono continuo constante a 440 Hz
        continuousPcm[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
      }

      const result = detectFirstBeatTime(continuousPcm, sampleRate);
      assert.equal(result, null, 'En señales continuas sin transitorios debe retornar null');
    });

    it('3.4 analyzeAudioPcm incorpora firstBeatTime sin degradar BPM, Key ni Energy', () => {
      const sampleRate = 44100;
      const pcm = new Float32Array(sampleRate * 6);

      // Generar audio estructurado con ritmo claro a 120 BPM y tono musical A4 (440Hz)
      const beatPeriodSamples = Math.round((60 / 120) * sampleRate);
      const firstBeatSample = Math.round(0.4 * sampleRate);

      for (let b = 0; b < 10; b++) {
        const start = firstBeatSample + b * beatPeriodSamples;
        for (let i = 0; i < 500 && start + i < pcm.length; i++) {
          const kick = Math.sin((2 * Math.PI * 80 * i) / sampleRate) * Math.exp(-i / 100);
          const tone = 0.4 * Math.sin((2 * Math.PI * 440 * (start + i)) / sampleRate);
          pcm[start + i] = kick + tone;
        }
      }

      const analysis = analyzeAudioPcm(pcm, sampleRate);

      assert.equal(analysis.status, 'analyzed');
      assert.ok(typeof analysis.bpm === 'number' && analysis.bpm > 0, 'BPM debe estar calculado');
      assert.ok(typeof analysis.energy === 'number', 'Energía debe estar calculada');
      assert.ok(Array.isArray(analysis.waveformPeaks), 'Waveform peaks deben estar presentes');

      // firstBeatTime debe existir y ser un número no negativo en segundos
      assert.ok(
        typeof analysis.firstBeatTime === 'number' && analysis.firstBeatTime >= 0,
        `firstBeatTime debe ser un número válido >= 0, recibido: ${analysis.firstBeatTime}`
      );
      assert.ok(
        Math.abs(analysis.firstBeatTime - 0.4) <= 0.05,
        `firstBeatTime esperado ~0.4s, obtenido: ${analysis.firstBeatTime}`
      );
    });
  });

  // ========================================================
  // 4. Preservación y Compatibilidad
  // ========================================================
  describe('4. Preservación y Compatibilidad de Datos', () => {
    it('4.1 Conserva pistas existentes sin firstBeatTime en IndexedDB y permite reproducirlas', async () => {
      const file = createTestAudioFile('legacy_track.mp3');
      const track = createTrackFromFile(file, 180.0);
      // Simular pista guardada en fases anteriores sin firstBeatTime
      track.analysis = {
        status: 'analyzed',
        bpm: 124.0,
        key: '8B',
        camelot: '8B',
        energy: 7.2,
      };

      await indexedDBStorage.saveTrack(track, file);

      // Recuperar de almacenamiento
      const retrieved = await indexedDBStorage.getTrack(track.id);
      assert.ok(retrieved !== null);
      assert.equal(retrieved?.analysis?.bpm, 124.0);
      assert.equal(retrieved?.analysis?.firstBeatTime, undefined);

      // Cargar y reproducir en Deck A
      const loaded = await djStore.loadTrackToDeckA(retrieved!);
      assert.equal(loaded, true);
      assert.equal(djStore.getSnapshot().deckA.track?.analysis?.bpm, 124.0);
      assert.equal(djStore.getSnapshot().deckA.playbackRate, 1.0);
    });
  });
});
