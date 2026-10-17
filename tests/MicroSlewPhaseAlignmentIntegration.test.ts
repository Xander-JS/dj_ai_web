/**
 * SYSTEM DJ — Test Suite: Fase 23.4 — Etapa 4
 * Integración de AudioEngineService y Store para Micro-Slew de Fase
 * 
 * Cobertura de integración de audio y ciclo de vida de automatizaciones:
 * 1. Programación de 3 segmentos en AudioParam y asignación de epoch.
 * 2. Cancelación en rampa ascendente, meseta y rampa descendente.
 * 3. Cancelación inmediata y prioridad del cambio manual de pitch.
 * 4. Cancelación inmediata y prioridad de Pitch Bend.
 * 5. Pausa, detención y descarga del esclavo durante micro-slew.
 * 6. Descarga y desacoplamiento del maestro durante micro-slew.
 * 7. Invalidación lógica de callbacks obsoletos mediante slewEpoch.
 * 8. Continuidad C0 del transporte sin saltos al cancelar o interrumpir.
 * 9. Independencia estricta entre Deck A y Deck B.
 * 10. Compatibilidad con CUE, Hot Cues y SYNC de tempo nominal.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import type { Track } from '../src/types/track.ts';

// Mock enriquecido de Web Audio API para auditar eventos en AudioParam
class MockAudioParam {
  public value: number;
  public events: Array<{ type: string; value?: number; time: number }> = [];

  constructor(val = 1) {
    this.value = val;
  }

  public setValueAtTime(v: number, time: number): void {
    this.value = v;
    this.events.push({ type: 'setValueAtTime', value: v, time });
  }

  public linearRampToValueAtTime(v: number, time: number): void {
    this.value = v;
    this.events.push({ type: 'linearRampToValueAtTime', value: v, time });
  }

  public cancelScheduledValues(time: number): void {
    this.events.push({ type: 'cancelScheduledValues', time });
  }

  public cancelAndHoldAtTime(time: number): void {
    this.events.push({ type: 'cancelAndHoldAtTime', time });
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

function createTestAudioFile(name = 'track.mp3'): File {
  const dummyPcm = new Uint8Array(44100);
  return new File([dummyPcm], name, { type: 'audio/mpeg' });
}

function createAnalyzedTrack(name: string, bpm: number, firstBeat = 0.0, duration = 180.0): { track: Track; file: File } {
  const file = createTestAudioFile(name);
  const track = createTrackFromFile(file, duration);
  track.analysis = {
    status: 'analyzed',
    bpm,
    bpmConfidence: 0.90,
    key: '8B',
    camelot: '8B',
    energy: 6.5,
    firstBeatTime: firstBeat,
  };
  return { track, file };
}

describe('Fase 23.4: Etapa 4 — Integración Micro-Slew de Fase en Motor y Store', () => {
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
    djStore.setPitchDeckA(50);
    djStore.setPitchDeckB(50);
    djStore.unloadDeckA();
    djStore.unloadDeckB();

    try {
      await indexedDBStorage.init();
      await indexedDBStorage.clearAll();
    } catch {
      // Ignorar fallos de limpieza en mock
    }
  });

  afterEach(async () => {
    djStore.stopTimeLoop();
    djStore.setPitchDeckA(50);
    djStore.setPitchDeckB(50);
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await audioEngine.dispose();
    try {
      await indexedDBStorage.clearAll();
    } catch {
      // Ignorar
    }
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  describe('1. Coordinación de AudioParam y programación de 3 segmentos', () => {
    it('1.1 Programa rampas ascendente, meseta y descendente sobre el AudioParam del deck', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);

      await djStore.playDeck('A');
      await djStore.playDeck('B');

      // Maestro en 10.0s, Esclavo en 9.93s (70ms retrasado)
      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.93);

      const scheduled = djStore.alignPhase('B');
      assert.equal(scheduled, true, 'La alineación debe planificarse y aplicarse con éxito');

      assert.equal(audioEngine.isDeckSlewActive('B'), true);
      const activeSlew = audioEngine.getDeckActiveSlew('B');
      assert.ok(activeSlew !== null);
      assert.ok(activeSlew.plan.tRamp > 0);
      assert.ok(activeSlew.plan.tSlew > 0);

      const deckBState = djStore.getSnapshot().deckB;
      assert.equal(deckBState.phaseAlignment?.status, 'active');
      assert.ok(deckBState.phaseAlignment.targetDisplacementSec! > 0);
    });
  });

  describe('2. Cancelación de micro-slew y consolidación de transporte', () => {
    it('2.1 Cancelar en rampa ascendente detiene el perfil y restaura la velocidad nominal sin saltos', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92);

      djStore.alignPhase('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      // Cancelar explícitamente durante la rampa
      djStore.cancelPhaseAlignment('B');

      assert.equal(audioEngine.isDeckSlewActive('B'), false);
      const deckB = djStore.getSnapshot().deckB;
      assert.equal(deckB.phaseAlignment?.status, 'cancelled');

      // Comprobar que currentTime es continuo y finito
      const timeAfter = audioEngine.getDeckCurrentTime('B');
      assert.ok(Number.isFinite(timeAfter));
      assert.ok(timeAfter >= 9.92);
    });

    it('2.2 Intervención manual: mover el pitch del Esclavo cancela el micro-slew inmediatamente y prioriza al usuario', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92);

      djStore.alignPhase('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      // El usuario mueve manualmente el fader de pitch
      djStore.setPitchDeck('B', 70); // Subir pitch al 70%

      // El micro-slew debe haber sido cancelado de inmediato
      assert.equal(audioEngine.isDeckSlewActive('B'), false);
      const deckB = djStore.getSnapshot().deckB;
      assert.equal(deckB.pitch, 70);
      assert.equal(deckB.phaseAlignment?.status, 'cancelled');
    });

    it('2.3 Pitch Bend manual sobre el Esclavo cancela el micro-slew inmediatamente', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92);

      djStore.alignPhase('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      // El DJ pulsa Pitch Bend +
      djStore.pitchBend('B', 'up');

      assert.equal(audioEngine.isDeckSlewActive('B'), false);
      const deckB = djStore.getSnapshot().deckB;
      assert.equal(deckB.pitchBend, 3.5);
      assert.equal(deckB.phaseAlignment?.status, 'cancelled');
    });

    it('2.4 Pausar o detener el deck Esclavo cancela el micro-slew de inmediato', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92);

      djStore.alignPhase('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      // Pausar deck B
      djStore.pauseDeck('B');

      assert.equal(audioEngine.isDeckSlewActive('B'), false);
      const deckB = djStore.getSnapshot().deckB;
      assert.equal(deckB.playbackState, 'paused');
      assert.equal(deckB.phaseAlignment?.status, 'cancelled');
    });

    it('2.5 Descargar el deck Maestro cancela el micro-slew del Esclavo', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92);

      djStore.alignPhase('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      // Expulsar pista del Maestro (Deck A)
      djStore.unloadDeck('A');

      assert.equal(audioEngine.isDeckSlewActive('B'), false);
      const deckB = djStore.getSnapshot().deckB;
      assert.equal(deckB.phaseAlignment?.status, 'cancelled');
    });
  });

  describe('3. Independencia de Decks y compatibilidad funcional', () => {
    it('3.1 Micro-slew en Deck B no altera la reproducción, pitch ni automatización de Deck A', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      const initialPitchA = djStore.getSnapshot().deckA.pitch;

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92);

      djStore.alignPhase('B');

      // Deck A permanece completamente inalterado
      assert.equal(audioEngine.isDeckSlewActive('A'), false);
      assert.equal(djStore.getSnapshot().deckA.pitch, initialPitchA);
      assert.equal(djStore.getSnapshot().deckA.phaseAlignment?.status, 'idle');
    });

    it('3.2 Saltar a un Hot Cue en el Esclavo cancela el micro-slew activo y reubica el transporte', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);

      // Fijar Hot Cue 1 en 30.0s en Deck B
      await djStore.setHotCue('B', 1, 30.0);

      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92);

      djStore.alignPhase('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      // Saltar a Hot Cue 1
      djStore.jumpToHotCue('B', 1);

      assert.equal(audioEngine.isDeckSlewActive('B'), false);
      const deckB = djStore.getSnapshot().deckB;
      assert.equal(deckB.phaseAlignment?.status, 'cancelled');
    });

    it('3.3 Sincronización nominal de tempo (SYNC) cancela cualquier micro-slew previo antes de actualizar velocidad', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.94);

      djStore.alignPhase('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      // Activar SYNC de tempo nominal
      const syncResult = djStore.syncDeck('B');
      assert.equal(syncResult, true);

      assert.equal(audioEngine.isDeckSlewActive('B'), false);
      const deckB = djStore.getSnapshot().deckB;
      assert.equal(deckB.isSyncActive, true);
      assert.equal(deckB.phaseAlignment?.status, 'cancelled');
    });

    it('3.4 Múltiples solicitudes consecutivas invalidan llamadas anteriores mediante slewEpoch', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92);

      // Disparar 3 solicitudes seguidas de alineación
      djStore.alignPhase('B');
      const slew1 = audioEngine.getDeckActiveSlew('B');
      const epoch1 = slew1?.epoch;

      djStore.alignPhase('B');
      const slew2 = audioEngine.getDeckActiveSlew('B');
      const epoch2 = slew2?.epoch;

      assert.ok(epoch2! > epoch1!, `epoch2 (${epoch2}) debe superar a epoch1 (${epoch1})`);
      assert.equal(audioEngine.isDeckSlewActive('B'), true);
    });
  });

  describe('4. Ciclo de vida con reloj simulado, contrato de tipos y roles', () => {
    it('4.1 Contrato de tipos: getDeckActiveSlew devuelve slewEpoch numérico y plan válido', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.93);

      const scheduled = djStore.alignPhase('B');
      assert.equal(scheduled, true);

      const activeSlew = audioEngine.getDeckActiveSlew('B');
      assert.ok(activeSlew !== null);
      assert.equal(typeof activeSlew.slewEpoch, 'number');
      assert.ok(Number.isFinite(activeSlew.slewEpoch));
      assert.equal(activeSlew.slewEpoch, audioEngine.getDeckSlewEpoch('B'));
      assert.ok(activeSlew.startedAtCtxTime > 0);
      assert.ok(activeSlew.plan.tSlew > 0);
    });

    it('4.2 Cancelación en rampa ascendente avanzando el reloj de audio simulado', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.93);

      djStore.alignPhase('B');
      const slew = audioEngine.getDeckActiveSlew('B')!;
      const t0 = slew.startedAtCtxTime;
      const tRamp = slew.plan.tRamp;

      // Avanzar reloj simulado a la mitad de la rampa ascendente
      const ctx = (audioEngine as unknown as { audioContext: MockAudioContext }).audioContext;
      ctx.currentTime = t0 + tRamp * 0.5;

      // Cancelar a mitad de la rampa
      djStore.cancelPhaseAlignment('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), false);

      const posAfter = audioEngine.getDeckCurrentTime('B');
      // Debe haber acumulado la rampa parcial pero menos del objetivo total
      assert.ok(posAfter > 9.93, `posAfter (${posAfter}) debe superar la posición inicial (9.93)`);
      assert.ok(posAfter < 9.93 + slew.plan.targetDisplacement + (tRamp * 0.5), 'posAfter no puede exceder el objetivo');
    });

    it('4.3 Cancelación en meseta avanzando el reloj de audio simulado', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92); // 80 ms para generar meseta

      djStore.alignPhase('B');
      const slew = audioEngine.getDeckActiveSlew('B')!;
      assert.ok(slew.plan.tPlateau > 0, 'Debe haber meseta');

      const t0 = slew.startedAtCtxTime;
      const tPlateauMid = t0 + slew.plan.tRamp + (slew.plan.tPlateau * 0.5);

      const ctx = (audioEngine as unknown as { audioContext: MockAudioContext }).audioContext;
      ctx.currentTime = tPlateauMid;

      djStore.cancelPhaseAlignment('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), false);

      const posAfter = audioEngine.getDeckCurrentTime('B');
      assert.ok(posAfter > 9.92);
      assert.equal(djStore.getSnapshot().deckB.phaseAlignment?.status, 'cancelled');
    });

    it('4.4 Cancelación en rampa descendente avanzando el reloj de audio simulado', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.92);

      djStore.alignPhase('B');
      const slew = audioEngine.getDeckActiveSlew('B')!;
      const t0 = slew.startedAtCtxTime;
      const tRamp2Mid = t0 + slew.plan.tRamp + slew.plan.tPlateau + (slew.plan.tRamp * 0.5);

      const ctx = (audioEngine as unknown as { audioContext: MockAudioContext }).audioContext;
      ctx.currentTime = tRamp2Mid;

      djStore.cancelPhaseAlignment('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), false);

      const posAfter = audioEngine.getDeckCurrentTime('B');
      assert.ok(posAfter > 9.92);
    });

    it('4.5 Expiración natural del temporizador ejecuta callback y pasa a estado completed sin retroceso', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.985); // 15 ms, rampa muy breve (~0.375s)

      djStore.alignPhase('B');
      const slew = audioEngine.getDeckActiveSlew('B')!;
      const tSlew = slew.plan.tSlew;

      const ctx = (audioEngine as unknown as { audioContext: MockAudioContext }).audioContext;
      
      // Esperar a que expire el temporizador simulando el avance temporal en ctx.currentTime
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          ctx.currentTime += tSlew + 0.05;
          setTimeout(() => {
            resolve();
          }, Math.ceil(tSlew * 1000) + 30);
        }, 10);
      });

      assert.equal(audioEngine.isDeckSlewActive('B'), false);
      const deckBState = djStore.getSnapshot().deckB;
      assert.equal(deckBState.phaseAlignment?.status, 'completed');

      const posAfter = audioEngine.getDeckCurrentTime('B');
      assert.ok(Number.isFinite(posAfter));
      assert.ok(posAfter >= 9.985);
    });

    it('4.6 Consolidación sin doble contabilización ante múltiples llamadas consecutivas a cancelDeckSlew', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.93);

      djStore.alignPhase('B');

      const ctx = (audioEngine as unknown as { audioContext: MockAudioContext }).audioContext;
      ctx.currentTime += 0.2;

      // Primera cancelación
      audioEngine.cancelDeckSlew('B');
      const pos1 = audioEngine.getDeckCurrentTime('B');

      // Segunda cancelación consecutiva (debe ser no-op)
      audioEngine.cancelDeckSlew('B');
      const pos2 = audioEngine.getDeckCurrentTime('B');

      assert.equal(pos1, pos2, 'La segunda cancelación no debe duplicar el desplazamiento acumulado');
    });

    it('4.7 Coherencia de roles Master/Slave: un deck Master no puede actuar como esclavo ni modular su fase', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      // Deck B activa SYNC respecto a Deck A (Deck A se convierte en Master, Deck B es Esclavo)
      djStore.syncDeck('B');
      assert.equal(djStore.getSnapshot().deckA.isMaster, true);
      assert.equal(djStore.getSnapshot().syncMasterDeck, 'A');

      // Intentar modular la fase de Deck A (Master)
      const alignMasterResult = djStore.alignPhase('A');
      assert.equal(alignMasterResult, false, 'El Master no puede solicitar alineación de fase');
      assert.equal(audioEngine.isDeckSlewActive('A'), false);

      const deckAState = djStore.getSnapshot().deckA;
      assert.equal(deckAState.phaseAlignment?.status, 'rejected_state');
      assert.ok(deckAState.phaseAlignment?.reason?.includes('Master'));
    });
  });

  describe('5. Regresiones de auditoría técnica final: continuidad, colisiones y tempo', () => {
    it('5.1 BLOQUEANTE-01: Conserva los 20s de reproducción previa al iniciar micro-slew sin retroceso a 0', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.060); // 60 ms de desfase de fase

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      const ctx = (audioEngine as unknown as { audioContext: MockAudioContext }).audioContext;
      
      // Simular 20 segundos de reproducción continua sin cambios de pitch ni seek
      ctx.currentTime += 20.0;

      const posPreAlign = audioEngine.getDeckCurrentTime('B');
      assert.ok(posPreAlign >= 20.0, `La posición antes de ALIGN debe ser al menos 20.0s (obtenido: ${posPreAlign})`);

      // Ejecutar ALIGN en Deck B (debe planificar micro-slew para compensar los 60 ms)
      const aligned = djStore.alignPhase('B');
      assert.equal(aligned, true);
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      // Avanzar 50 ms en el reloj simulado durante el micro-slew
      ctx.currentTime += 0.050;

      const posDuringSlew = audioEngine.getDeckCurrentTime('B');
      assert.ok(
        posDuringSlew >= 20.050,
        `La posición durante el slew NO debe retroceder a 0 (obtenido: ${posDuringSlew}, esperado >= 20.050)`
      );
      assert.ok(
        posDuringSlew < 22.0,
        `La posición no debe saltar de forma anómala (obtenido: ${posDuringSlew})`
      );

      // Esperar a que la maniobra expire naturalmente
      const slew = audioEngine.getDeckActiveSlew('B')!;
      ctx.currentTime += slew.plan.tSlew + 0.1;

      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.ceil(slew.plan.tSlew * 1000) + 30);
      });

      const posPostSlew = audioEngine.getDeckCurrentTime('B');
      assert.ok(
        posPostSlew >= 20.0 + slew.plan.tSlew,
        `La posición post-slew debe retener los 20s iniciales más el tiempo del slew (obtenido: ${posPostSlew})`
      );
    });

    it('5.2 IMPORTANTE-01: Cambio manual de pitch o bend durante el slew/cancelación anula la rampa residual en AudioParam', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.93);

      djStore.alignPhase('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      // Mover manualmente el fader de pitch al 75% (+4% de velocidad = rate 1.04)
      djStore.setPitchDeck('B', 75);

      // Micro-slew debe estar cancelado
      assert.equal(audioEngine.isDeckSlewActive('B'), false);

      const graphB = audioEngine.getDeckAudioGraph('B');
      const paramEvents = (graphB.sourceNode?.playbackRate as unknown as MockAudioParam).events;
      
      // El último evento registrado en playbackRate debe ser un setValueAtTime con el nuevo valor (1.04)
      const lastEvent = paramEvents[paramEvents.length - 1];
      assert.equal(lastEvent.type, 'setValueAtTime');
      assert.equal(lastEvent.value, 1.04);

      // Comprobar también que no quedó ninguna rampa linearRampToValueAtTime posterior en el param
      const lastRampIdx = paramEvents.findLastIndex(e => e.type === 'linearRampToValueAtTime');
      const lastSetIdx = paramEvents.findLastIndex(e => e.type === 'setValueAtTime');
      assert.ok(lastSetIdx > lastRampIdx, 'El setValueAtTime manual debe ser posterior a cualquier rampa');

      // Restaurar pitch al centro para que los tempos vuelvan a ser compatibles
      djStore.setPitchDeck('B', 50);
      audioEngine.seekDeck('B', 9.93);

      // Probar activación de Pitch Bend durante una alineación
      djStore.alignPhase('B');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);

      djStore.pitchBend('B', 'up');
      assert.equal(audioEngine.isDeckSlewActive('B'), false);

      const eventsAfterBend = (graphB.sourceNode?.playbackRate as unknown as MockAudioParam).events;
      const finalEvent = eventsAfterBend[eventsAfterBend.length - 1];
      assert.equal(finalEvent.type, 'setValueAtTime');
      assert.ok(finalEvent.value! > 1.0, `Pitch bend UP debe superar 1.0 (obtenido: ${finalEvent.value})`);
    });

    it('5.3 IMPORTANTE-02: Consolidación continua al expirar el slew sin retroceso si el timer se ejecuta con retraso', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.985); // slew breve de ~0.375s

      djStore.alignPhase('B');
      const slew = audioEngine.getDeckActiveSlew('B')!;
      const t0 = slew.startedAtCtxTime;
      const tSlew = slew.plan.tSlew;
      const t3 = t0 + tSlew;

      const ctx = (audioEngine as unknown as { audioContext: MockAudioContext }).audioContext;

      // Avanzar el reloj de audio simulado más allá de t3 (por ejemplo 80 ms después de t3) antes de que termine el timeout
      ctx.currentTime = t3 + 0.080;

      const posPreCallback = audioEngine.getDeckCurrentTime('B');

      // Esperar a que se ejecute el callback de consolidación
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.ceil(tSlew * 1000) + 40);
      });

      assert.equal(audioEngine.isDeckSlewActive('B'), false);
      const posPostCallback = audioEngine.getDeckCurrentTime('B');

      // La posición tras el callback debe ser continua respecto a posPreCallback (tolerancia numérica estándar)
      assert.ok(
        posPostCallback >= posPreCallback - 1e-5,
        `posPostCallback (${posPostCallback}) no debe retroceder respecto a posPreCallback (${posPreCallback})`
      );
      // Y debe incluir el tiempo transcurrido tras t3 (0.080s)
      assert.ok(
        posPostCallback >= 9.985 + slew.plan.targetDisplacement + 0.080,
        `Debe incluir los 80 ms de retraso tras t3 (obtenido: ${posPostCallback})`
      );
    });

    it('5.4 IMPORTANTE-03: alignPhase rechaza explícitamente cuando las pistas difieren en más de 0.20 BPM', async () => {
      // Deck A a 124 BPM, Deck B a 120 BPM (diferencia de 4.0 BPM > 0.20 BPM)
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124, 0.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120, 0.0);

      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);

      await djStore.loadTrackToDeck('A', trackA);
      await djStore.loadTrackToDeck('B', trackB);
      await djStore.playDeck('A');
      await djStore.playDeck('B');

      audioEngine.seekDeck('A', 10.0);
      audioEngine.seekDeck('B', 9.94);

      // Intentar alinear fase sin haber sincronizado el tempo nominal
      const alignResult = djStore.alignPhase('B');
      assert.equal(alignResult, false, 'Debe rechazar alignPhase por discrepancia de tempo > 0.20 BPM');
      assert.equal(audioEngine.isDeckSlewActive('B'), false, 'No debe iniciar slew en el motor de audio');

      const deckBState = djStore.getSnapshot().deckB;
      assert.equal(deckBState.phaseAlignment?.status, 'rejected_state');
      assert.ok(deckBState.phaseAlignment?.reason?.includes('incompatibles'));
      assert.ok(deckBState.phaseAlignment?.reason?.includes('BPM'));

      // Sincronizar el tempo nominal (Deck B pasa a 124 BPM)
      const syncOk = djStore.syncDeck('B');
      assert.equal(syncOk, true);

      // Ahora con tempos compatibles, alignPhase debe tener éxito
      const alignAfterSync = djStore.alignPhase('B');
      assert.equal(alignAfterSync, true, 'Con tempo sincronizado debe aceptar alignPhase');
      assert.equal(audioEngine.isDeckSlewActive('B'), true);
      assert.equal(djStore.getSnapshot().deckB.phaseAlignment?.status, 'active');
    });
  });
});
