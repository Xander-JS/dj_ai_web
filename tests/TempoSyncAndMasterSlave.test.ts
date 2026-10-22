/**
 * SYSTEM DJ — Test Suite: Fase 23.4 — Etapa 3
 * Sincronización de Tempo (BPM Matching) y Gestión Maestro / Esclavo
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import { assessTempoCompatibility } from '../src/audio/analysis/tempoCompatibility.ts';
import type { Track } from '../src/types/track.ts';

// Mock minimal de Web Audio API para simulación determinista en Node.js
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
  public start(): void {}
  public stop(): void {}
}

class MockAudioContext {
  public static shouldFailDecode = false;
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
    if (MockAudioContext.shouldFailDecode) throw new Error('Corrupt audio data');
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

function createAnalyzedTrack(name: string, bpm: number, duration = 180.0): { track: Track; file: File } {
  const file = createTestAudioFile(name);
  const track = createTrackFromFile(file, duration);
  track.analysis = {
    status: 'analyzed',
    bpm,
    bpmConfidence: 0.85,
    isAmbiguous: false,
    alternateBpm: [
      ...(bpm * 0.5 >= 50 ? [Number((bpm * 0.5).toFixed(1))] : []),
      ...(bpm * 2 <= 220 ? [Number((bpm * 2).toFixed(1))] : []),
    ],
    key: '8B',
    camelot: '8B',
    energy: 6.5,
    firstBeatTime: 0.5,
  };
  return { track, file };
}

describe('Fase 1.1: Evidencia de compatibilidad de tempo', () => {
  const analysis = (bpm: number, alternateBpm: number[] = [bpm / 2]): Track['analysis'] => ({
    status: 'analyzed',
    bpm,
    bpmConfidence: 0.85,
    isAmbiguous: false,
    alternateBpm,
  });

  it('no encuentra conflicto armónico en BPM cercanos aunque haya candidatos cercanos entre sí', () => {
    assert.deepEqual(
      assessTempoCompatibility(analysis(124, [62, 125]), analysis(125, [62.5, 124])),
      { status: 'no_harmonic_conflict', reason: null }
    );
  });

  it('identifica una hipótesis de medio tiempo con apoyo del candidato alternativo', () => {
    const result = assessTempoCompatibility(analysis(140, [70]), analysis(70, [140]));
    assert.equal(result.status, 'half_time_hypothesis');
    assert.match(result.reason ?? '', /candidato alternativo del Slave/i);
  });

  it('identifica una hipótesis de doble tiempo con apoyo del candidato alternativo', () => {
    const result = assessTempoCompatibility(analysis(70, [140]), analysis(140, [70]));
    assert.equal(result.status, 'double_time_hypothesis');
    assert.match(result.reason ?? '', /candidato alternativo del Master/i);
  });

  it('rechaza como insuficientes datos BPM iguales sin candidatos alternativos', () => {
    const result = assessTempoCompatibility(analysis(120, []), analysis(120, []));
    assert.equal(result.status, 'insufficient_data');
    assert.match(result.reason ?? '', /confianza suficiente/i);
  });

  it('rechaza como insuficiente una confianza baja aun cuando ambos BPM coinciden', () => {
    const lowConfidence = { ...analysis(120), bpmConfidence: 0.49 };
    assert.equal(assessTempoCompatibility(lowConfidence, analysis(120)).status, 'insufficient_data');
  });

  it('rechaza un análisis marcado como ambiguo aunque tenga candidatos y confianza numérica', () => {
    const ambiguous = { ...analysis(120), isAmbiguous: true };
    assert.equal(assessTempoCompatibility(ambiguous, analysis(120)).status, 'insufficient_data');
  });

  it('rechaza BPM y candidatos alternativos ausentes, no finitos, no positivos o vacíos', () => {
    const valid = analysis(120, [60, 240]);
    const invalidAnalyses: Track['analysis'][] = [
      { ...valid, bpm: NaN },
      { ...valid, bpm: 0 },
      { ...valid, alternateBpm: [60, Infinity] },
      { ...valid, alternateBpm: [60, 0] },
      { ...valid, alternateBpm: [] },
    ];
    for (const invalid of invalidAnalyses) {
      assert.equal(assessTempoCompatibility(invalid, valid).status, 'insufficient_data');
    }
  });

  it('devuelve el mismo resultado para entradas idénticas y no confunde candidatos 1:1 con 2:1', () => {
    const master = analysis(124, [62, 125]);
    const slave = analysis(125, [62.5, 124]);
    const first = assessTempoCompatibility(master, slave);
    assert.deepEqual(first, { status: 'no_harmonic_conflict', reason: null });
    assert.deepEqual(assessTempoCompatibility(master, slave), first);
  });
});

function assertSyncRoleInvariant(snapshot: ReturnType<typeof djStore.getSnapshot>): void {
  if (snapshot.syncMasterDeck === null) {
    assert.equal(snapshot.deckA.isMaster, false);
    assert.equal(snapshot.deckB.isMaster, false);
    assert.equal(snapshot.deckA.isSyncActive, false);
    assert.equal(snapshot.deckB.isSyncActive, false);
    return;
  }

  const master = snapshot.syncMasterDeck === 'A' ? snapshot.deckA : snapshot.deckB;
  const slave = snapshot.syncMasterDeck === 'A' ? snapshot.deckB : snapshot.deckA;
  assert.equal(master.isMaster, true);
  assert.equal(master.isSyncActive, false);
  assert.equal(slave.isMaster, false);
  assert.equal(slave.isSyncActive, true);
}

describe('Fase 23.4: Etapa 3 — Sincronización de Tempo y Gestión Maestro/Esclavo', () => {
  let originalAudioContext: unknown;
  let originalWindow: unknown;

  beforeEach(async () => {
    MockAudioContext.shouldFailDecode = false;
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
    await indexedDBStorage.clearAll();
  });

  afterEach(async () => {
    djStore.stopTimeLoop();
    djStore.setPitchDeckA(50);
    djStore.setPitchDeckB(50);
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await audioEngine.dispose();
    await indexedDBStorage.clearAll();
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  // ========================================================
  // 1. Selección Determinista de Maestro y Esclavo
  // ========================================================
  describe('1. Selección determinista de Maestro y Esclavo', () => {
    it('1.1 Solo Deck A reproduciendo: A se convierte en Master y B en Slave al activar SYNC en B', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      // Reproducir solo Deck A
      await djStore.playDeckA();
      assert.equal(djStore.getSnapshot().deckA.playbackState, 'playing');
      assert.equal(djStore.getSnapshot().deckB.playbackState, 'stopped');

      // Activar SYNC en Deck B
      const observedSnapshots: ReturnType<typeof djStore.getSnapshot>[] = [];
      const unsubscribe = djStore.subscribe(() => observedSnapshots.push(djStore.getSnapshot()));
      const result = djStore.syncDeck('B');
      unsubscribe();
      assert.equal(result, true, 'SYNC debe activarse con éxito');
      assert.equal(observedSnapshots.length, 1, 'La activación de SYNC debe publicarse en una sola actualización');
      observedSnapshots.forEach(assertSyncRoleInvariant);

      const state = djStore.getSnapshot();
      assert.equal(state.syncMasterDeck, 'A', 'Deck A debe ser el Master');
      assert.equal(state.deckA.isMaster, true);
      assert.equal(state.deckA.isSyncActive, false, 'Master no tiene flag de esclavo');
      assert.equal(state.deckB.isMaster, false);
      assert.equal(state.deckB.isSyncActive, true, 'Deck B debe tener flag de esclavo');
    });

    it('1.2 Solo Deck B reproduciendo: B se convierte en Master y A en Slave al activar SYNC en A', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 120.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      // Reproducir solo Deck B
      await djStore.playDeckB();
      assert.equal(djStore.getSnapshot().deckB.playbackState, 'playing');

      // Activar SYNC en Deck A
      const result = djStore.syncDeck('A');
      assert.equal(result, true);

      const state = djStore.getSnapshot();
      assert.equal(state.syncMasterDeck, 'B', 'Deck B debe ser el Master');
      assert.equal(state.deckB.isMaster, true);
      assert.equal(state.deckA.isSyncActive, true);
      assert.equal(state.deckA.syncFeedback, null);
    });

    it('1.2a Solo Deck A reproduciendo: A sigue siendo Master al pulsar SYNC en A', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);
      await djStore.playDeckA();

      assert.equal(djStore.syncDeck('A'), true);
      const state = djStore.getSnapshot();
      assert.equal(state.syncMasterDeck, 'A');
      assert.equal(state.deckA.isMaster, true);
      assert.equal(state.deckA.isSyncActive, false);
      assert.equal(state.deckB.isMaster, false);
      assert.equal(state.deckB.isSyncActive, true);
    });

    it('1.2b Solo Deck B reproduciendo: B sigue siendo Master al pulsar SYNC en B', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);
      await djStore.playDeckB();

      assert.equal(djStore.syncDeck('B'), true);
      const state = djStore.getSnapshot();
      assert.equal(state.syncMasterDeck, 'B');
      assert.equal(state.deckB.isMaster, true);
      assert.equal(state.deckB.isSyncActive, false);
      assert.equal(state.deckA.isMaster, false);
      assert.equal(state.deckA.isSyncActive, true);
    });

    it('1.3 Ambos decks detenidos: el opuesto al pulsado actúa como Master determinista', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 126.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      // Ambos en stop
      assert.equal(djStore.getSnapshot().deckA.playbackState, 'stopped');
      assert.equal(djStore.getSnapshot().deckB.playbackState, 'stopped');

      // Usuario solicita SYNC en Deck B: Deck A actúa como Master determinista
      const result = djStore.syncDeck('B');
      assert.equal(result, true);

      const state = djStore.getSnapshot();
      assert.equal(state.syncMasterDeck, 'A');
      assert.equal(state.deckA.isMaster, true);
      assert.equal(state.deckB.isSyncActive, true);
      assert.equal(state.deckA.playbackState, 'stopped', 'SYNC no debe arrancar el Master');
      assert.equal(state.deckB.playbackState, 'stopped', 'SYNC no debe arrancar el Slave');
      assert.equal(state.deckA.currentTime, 0);
      assert.equal(state.deckB.currentTime, 0);
      assert.equal(state.deckA.playbackRate, 1);
      assert.equal(state.deckB.playbackRate, Number((124 / 126).toFixed(4)));
      assert.equal(audioEngine.getDeckPlaybackRate('B'), Number((124 / 126).toFixed(4)));
      assertSyncRoleInvariant(state);
    });

    it('1.4 Ambos decks reproduciendo: el opuesto al pulsado se define como Master', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 128.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 126.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);
      await djStore.playDeckA();
      await djStore.playDeckB();

      // Pulsar SYNC en Deck A: B se vuelve Master, A esclavo
      const result = djStore.syncDeck('A');
      assert.equal(result, true);

      const state = djStore.getSnapshot();
      assert.equal(state.syncMasterDeck, 'B');
      assert.equal(state.deckB.isMaster, true);
      assert.equal(state.deckA.isSyncActive, true);
    });
  });

  // ========================================================
  // 2. Rechazo ante Pistas o BPM Inválidos (Fail-safe)
  // ========================================================
  describe('2. Rechazo ante datos insuficientes o inválidos', () => {
    it('2.1 Rechaza si el deck solicitante no tiene pista cargada', async () => {
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckB(trackB);

      // Deck A vacío
      const result = djStore.syncDeck('A');
      assert.equal(result, false, 'Debe rechazar sincronización');
      assert.equal(djStore.getSnapshot().deckA.isSyncActive, false);
      assert.equal(djStore.getSnapshot().deckA.errorCode, 'sync_failed');
      assert.equal(djStore.getSnapshot().deckA.syncFeedback?.key, 'dj.sync_reject_slave_track');
    });

    it('2.2 Rechaza si el deck de referencia (Master) no tiene pista cargada', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await djStore.loadTrackToDeckA(trackA);

      // Deck B vacío
      const result = djStore.syncDeck('A');
      assert.equal(result, false);
      assert.equal(djStore.getSnapshot().deckA.isSyncActive, false);
      assert.equal(djStore.getSnapshot().deckA.errorCode, 'sync_failed');
    });

    it('2.3 Rechaza si la pista no tiene BPM analizado válido o está en estado unsupported', async () => {
      const fileA = createTestAudioFile('trackA.mp3');
      const trackA = createTrackFromFile(fileA, 120.0);
      // Pista A sin BPM analizado
      trackA.analysis = { status: 'unsupported', energy: 1 };

      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      const result = djStore.syncDeck('B');
      assert.equal(result, false);
      assert.equal(djStore.getSnapshot().deckB.isSyncActive, false);
      assert.equal(djStore.getSnapshot().deckB.errorCode, 'sync_failed');
    });

    it('2.4 Rechaza si el Master seleccionado por reproducción no tiene BPM válido y no altera tempos ni roles', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      trackA.analysis = { status: 'unsupported' };
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);
      await djStore.playDeckA();
      const before = djStore.getSnapshot();

      assert.equal(djStore.syncDeck('A'), false);
      const after = djStore.getSnapshot();
      assert.equal(after.syncMasterDeck, null);
      assert.equal(after.deckA.isMaster, false);
      assert.equal(after.deckA.isSyncActive, false);
      assert.equal(after.deckB.isMaster, false);
      assert.equal(after.deckB.isSyncActive, false);
      assert.equal(after.deckA.playbackRate, before.deckA.playbackRate);
      assert.equal(after.deckB.playbackRate, before.deckB.playbackRate);
      assert.equal(after.deckB.errorCode, 'sync_failed');
    });
  });

  // ========================================================
  // 3. Límites Estrictos de Velocidad [0.92, 1.08] (±8%)
  // ========================================================
  describe('3. Ratios exactos y límites estrictos de pitch', () => {
    it('3.1 Sincroniza con éxito exactamente en el límite superior (+8%, rate = 1.0800)', async () => {
      // Master: 108.0 BPM (a pitch 0% -> 108 BPM)
      // Slave: 100.0 BPM
      // requiredRate = 108 / 100 = 1.0800 (exacto)
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 108.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 100.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      const result = djStore.syncDeck('B');
      assert.equal(result, true, 'Debe permitir sincronización en límite exacto 1.08');

      const stateB = djStore.getSnapshot().deckB;
      assert.equal(stateB.playbackRate, 1.08);
      assert.equal(stateB.pitch, 100.0, 'Fader debe colocarse en 100% (+8%)');
      assert.equal(stateB.calculatedBpm, 108.0);
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 1.08);
    });

    it('3.2 Sincroniza con éxito exactamente en el límite inferior (-8%, rate = 0.9200)', async () => {
      // Master: 92.0 BPM
      // Slave: 100.0 BPM
      // requiredRate = 92 / 100 = 0.9200 (exacto)
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 92.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 100.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      const result = djStore.syncDeck('B');
      assert.equal(result, true, 'Debe permitir sincronización en límite exacto 0.92');

      const stateB = djStore.getSnapshot().deckB;
      assert.equal(stateB.playbackRate, 0.92);
      assert.equal(stateB.pitch, 0.0, 'Fader debe colocarse en 0% (-8%)');
      assert.equal(stateB.calculatedBpm, 92.0);
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 0.92);
    });

    it('3.3 Rechaza sin recortar si requiredRate supera el límite superior (> 1.08)', async () => {
      // Master: 110.0 BPM, Slave: 100.0 BPM -> requiredRate = 1.1000 (> 1.08)
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 110.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 100.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      const result = djStore.syncDeck('B');
      assert.equal(result, false, 'Debe rechazar tempo fuera de rango sin recortar silenciosamente');

      const stateB = djStore.getSnapshot().deckB;
      assert.equal(stateB.isSyncActive, false);
      assert.equal(stateB.playbackRate, 1.0, 'La velocidad nominal no debe alterarse');
      assert.equal(stateB.pitch, 50, 'El fader no debe alterarse');
      assert.equal(stateB.errorCode, 'sync_failed');
      assert.ok(stateB.errorMessage?.includes('excede el rango de pitch'));
      assert.equal(stateB.syncFeedback?.key, 'dj.sync_reject_pitch_limit');
      assert.deepEqual(stateB.syncFeedback?.values, { targetBpm: '110.0', trackBpm: '100.0' });
    });

    it('3.4 Rechaza sin recortar si requiredRate cae por debajo del límite inferior (< 0.92)', async () => {
      // Master: 90.0 BPM, Slave: 100.0 BPM -> requiredRate = 0.9000 (< 0.92)
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 90.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 100.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      const result = djStore.syncDeck('B');
      assert.equal(result, false);

      const stateB = djStore.getSnapshot().deckB;
      assert.equal(stateB.isSyncActive, false);
      assert.equal(stateB.playbackRate, 1.0);
      assert.equal(stateB.errorCode, 'sync_failed');
    });

    it('3.4a Rechaza ratios apenas fuera de ±8% aunque el redondeo a cuatro decimales caiga en el límite', async () => {
      for (const [masterBpm, label] of [[108.004, 'upper'], [91.996, 'lower']] as const) {
        const { track: trackA, file: fileA } = createAnalyzedTrack(`near_limit_master_${label}.mp3`, masterBpm);
        const { track: trackB, file: fileB } = createAnalyzedTrack(`near_limit_slave_${label}.mp3`, 100.0);
        await indexedDBStorage.saveTrack(trackA, fileA);
        await indexedDBStorage.saveTrack(trackB, fileB);
        await djStore.loadTrackToDeckA(trackA);
        await djStore.loadTrackToDeckB(trackB);

        assert.equal(djStore.syncDeck('B'), false, `${label} raw rate is outside the range`);
        const stateB = djStore.getSnapshot().deckB;
        assert.equal(stateB.isSyncActive, false);
        assert.equal(stateB.playbackRate, 1.0);
        assert.equal(audioEngine.getDeckPlaybackRate('B'), 1.0);
      }
    });

    it('3.4b Desacopla el Slave si el pitch del Master deja su ratio exacto apenas fuera del límite', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('near_limit_master_pitch.mp3', 100.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('near_limit_slave_pitch.mp3', 99.996);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      assert.equal(djStore.syncDeck('B'), true);
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.0);
      djStore.setPitchDeckA(100);

      const state = djStore.getSnapshot();
      assert.equal(state.deckB.isSyncActive, false);
      assert.equal(state.deckB.playbackRate, 1.0);
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 1.0);
      assert.match(state.deckB.errorMessage ?? '', /excedió el rango de pitch/i);
    });

    it('3.5 No aplica relaciones automáticas de medio tiempo o doble tiempo', async () => {
      // Pistas a 70 BPM y 140 BPM (relación 2:1 pero ratio directo = 2.0 > 1.08)
      // Debe ser rechazada sin forzar half-time/double-time
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 140.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 70.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      const result = djStore.syncDeck('B');
      assert.equal(result, false, 'No debe aceptar medio o doble tempo automáticamente');
      const state = djStore.getSnapshot();
      assert.equal(state.deckB.isSyncActive, false);
      assert.match(state.deckB.errorMessage ?? '', /candidato alternativo del Slave/i);
      assert.doesNotMatch(state.deckB.errorMessage ?? '', /excede el rango de pitch/i);
    });

    it('3.6 Rechaza la relación inversa de doble tiempo antes de evaluar el límite de pitch', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA_70.mp3', 70.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB_140.mp3', 140.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      assert.equal(djStore.syncDeck('B'), false);
      const error = djStore.getSnapshot().deckB.errorMessage ?? '';
      assert.match(error, /candidato alternativo del Master/i);
      assert.doesNotMatch(error, /excede el rango de pitch/i);
    });

    it('3.7 Rechaza SYNC si falta evidencia de análisis aunque los BPM almacenados sean iguales', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA_equal_no_evidence.mp3', 120.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB_equal_no_evidence.mp3', 120.0);
      delete trackA.analysis.alternateBpm;
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      assert.equal(djStore.syncDeck('B'), false);
      assert.match(djStore.getSnapshot().deckB.errorMessage ?? '', /requiere BPM, confianza suficiente/i);
    });
  });

  it('clears SYNC feedback after the deck pitch context changes and a later synchronization succeeds', async () => {
    const { track: trackA, file: fileA } = createAnalyzedTrack('sync_feedback_master.mp3', 110.0);
    const { track: trackB, file: fileB } = createAnalyzedTrack('sync_feedback_slave.mp3', 100.0);
    await indexedDBStorage.saveTrack(trackA, fileA);
    await indexedDBStorage.saveTrack(trackB, fileB);
    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    assert.equal(djStore.syncDeck('B'), false);
    assert.equal(djStore.getSnapshot().deckB.syncFeedback?.key, 'dj.sync_reject_pitch_limit');

    djStore.setPitchDeck('A', 30);
    assert.equal(djStore.getSnapshot().deckB.syncFeedback, null);
    assert.equal(djStore.syncDeck('B'), true);
    assert.equal(djStore.getSnapshot().deckB.syncFeedback, null);
    assert.equal(djStore.getSnapshot().deckB.errorMessage, null);
  });

  // ========================================================
  // 4. Preservación del BPM Original y Estados No Recíprocos
  // ========================================================
  describe('4. Preservación de metadatos y prevención de estados recíprocos', () => {
    it('4.1 Preserva inmutable el track.analysis.bpm original tras la sincronización', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 126.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');

      // El track original en B debe conservar bpm 126.0 intacto
      assert.equal(djStore.getSnapshot().deckB.track?.analysis?.bpm, 126.0);
      // Solo calculatedBpm refleja el tempo efectivo resultante
      assert.equal(djStore.getSnapshot().deckB.calculatedBpm, 124.0);
    });

    it('4.2 Evita estados recíprocos: Master es siempre asimétrico a Slave', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');

      const state = djStore.getSnapshot();
      assert.equal(state.deckA.isMaster, true);
      assert.equal(state.deckA.isSyncActive, false, 'Master nunca debe tener isSyncActive');
      assert.equal(state.deckB.isMaster, false, 'Slave nunca debe tener isMaster');
      assert.equal(state.deckB.isSyncActive, true);
    });
  });

  // ========================================================
  // 5. Interacción con Pitch Bend y Modulaciones
  // ========================================================
  describe('5. Interacción de SYNC con Pitch Bend', () => {
    it('5.1 Esclavo con SYNC activo responde a Pitch Bend y regresa a R_target al soltar', async () => {
      // Master: 125.0 BPM, Slave: 120.0 BPM -> R_target = 125 / 120 = 1.0417
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 125.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');
      const rateNominal = djStore.getSnapshot().deckB.playbackRate;
      assert.ok(Math.abs(rateNominal - 1.0417) < 0.001);

      // Pitch Bend UP en Esclavo (+3.5%)
      djStore.pitchBend('B', 'up');
      assert.ok(Math.abs(djStore.getSnapshot().deckB.pitchBend - 3.5039) < 0.001, 'El estado debe reflejar el porcentaje efectivo tras cuantizar playbackRate');
      const effectiveUp = audioEngine.getDeckPlaybackRate('B');
      // 1.0417 * 1.035 = 1.0782 (dentro de 1.08)
      assert.ok(effectiveUp > rateNominal && effectiveUp <= 1.08);

      // Release
      djStore.pitchBend('B', 'release');
      assert.equal(djStore.getSnapshot().deckB.pitchBend, 0);
      assert.equal(audioEngine.getDeckPlaybackRate('B'), rateNominal);
    });

    it('5.2 Pitch Bend en Master no altera el tempo nominal del Esclavo', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.0);

      // Aplicar bend en Master
      djStore.pitchBend('A', 'up');
      // El Esclavo debe mantener su velocidad nominal
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.0);
    });

    it('5.3 Clamping momentáneo en límite superior (1.08) con Pitch Bend UP no supera 1.08 y restaura nominal al soltar', async () => {
      // Master: 108.0 BPM, Slave: 100.0 BPM -> R_target = 1.0800 (límite superior exacto)
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 108.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 100.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.08);

      // Aplicar Pitch Bend UP (+3.5%) sobre el límite superior
      djStore.pitchBend('B', 'up');
      assert.equal(djStore.getSnapshot().deckB.pitchBend, 0, 'El bend queda completamente limitado en el tope superior');
      // El motor debe acotar estrictamente a 1.0800 sin overflow
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 1.08);

      // Liberar bend
      djStore.pitchBend('B', 'release');
      assert.equal(djStore.getSnapshot().deckB.pitchBend, 0);
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 1.08);
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.08);
    });

    it('5.4 Clamping momentáneo en límite inferior (0.92) con Pitch Bend DOWN no baja de 0.92 y restaura nominal al soltar', async () => {
      // Master: 92.0 BPM, Slave: 100.0 BPM -> R_target = 0.9200 (límite inferior exacto)
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 92.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 100.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 0.92);

      // Aplicar Pitch Bend DOWN (-3.5%) sobre el límite inferior
      djStore.pitchBend('B', 'down');
      assert.equal(djStore.getSnapshot().deckB.pitchBend, 0, 'El bend queda completamente limitado en el tope inferior');
      // El motor debe acotar estrictamente a 0.9200 sin underflow
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 0.92);

      // Liberar bend
      djStore.pitchBend('B', 'release');
      assert.equal(djStore.getSnapshot().deckB.pitchBend, 0);
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 0.92);
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 0.92);
    });
  });

  // ========================================================
  // 6. Desactivación de SYNC y Control Manual Coherente
  // ========================================================
  describe('6. Desactivación de SYNC y restauración del control manual', () => {
    it('6.1 Al desactivar SYNC, conserva exactamente la velocidad escuchada y la posición del fader', async () => {
      // Master: 125.0 BPM, Slave: 120.0 BPM -> R_target = 1.0417
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 125.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');
      const syncedPitch = djStore.getSnapshot().deckB.pitch;
      const syncedRate = djStore.getSnapshot().deckB.playbackRate;

      // Desactivar SYNC (segunda pulsación)
      const observedSnapshots: ReturnType<typeof djStore.getSnapshot>[] = [];
      const unsubscribe = djStore.subscribe(() => observedSnapshots.push(djStore.getSnapshot()));
      const res = djStore.syncDeck('B');
      unsubscribe();
      assert.equal(res, false, 'Debe devolver false al desactivar');
      assert.equal(observedSnapshots.length, 1, 'La desactivación de SYNC debe publicarse en una sola actualización');
      observedSnapshots.forEach(assertSyncRoleInvariant);

      const afterState = djStore.getSnapshot().deckB;
      assert.equal(afterState.isSyncActive, false);
      assert.equal(afterState.pitch, syncedPitch, 'El fader debe permanecer en la misma posición');
      assert.equal(afterState.playbackRate, syncedRate, 'La velocidad nominal debe permanecer idéntica');
      assert.equal(audioEngine.getDeckPlaybackRate('B'), syncedRate, 'El motor debe seguir sonando a la misma velocidad');
      assert.equal(djStore.getSnapshot().syncMasterDeck, null, 'No queda ningún Master activo');
    });

    it('6.2 Mover manualmente el pitch en el Esclavo desactiva SYNC y restaura control manual directo', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 125.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');
      assert.equal(djStore.getSnapshot().deckB.isSyncActive, true);

      // Usuario mueve manualmente el fader de B a posición 80 (rate = 1.048)
      const observedSnapshots: ReturnType<typeof djStore.getSnapshot>[] = [];
      const unsubscribe = djStore.subscribe(() => observedSnapshots.push(djStore.getSnapshot()));
      djStore.setPitchDeckB(80);
      unsubscribe();
      observedSnapshots.forEach(assertSyncRoleInvariant);

      const stateB = djStore.getSnapshot().deckB;
      assert.equal(stateB.isSyncActive, false, 'SYNC debe desactivarse al tocar el fader');
      assert.equal(stateB.pitch, 80);
      assert.equal(stateB.playbackRate, 1.048);
      assert.equal(djStore.getSnapshot().syncMasterDeck, null);
    });

    it('6.3 Modificar el pitch del Master actualiza reactivamente el Esclavo mientras SYNC esté activo', async () => {
      // Master A: 100 BPM, Slave B: 100 BPM
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 100.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 100.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.0);

      // Master se acelera al +4% (pitch = 75, rate = 1.0400)
      djStore.setPitchDeckA(75);

      const stateB = djStore.getSnapshot().deckB;
      assert.equal(stateB.isSyncActive, true);
      assert.equal(stateB.playbackRate, 1.04);
      assert.equal(stateB.calculatedBpm, 104.0);
    });

    it('6.4 Activar SYNC y desactivarlo inmediatamente conserva estado y fader sin cambios', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 125.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 120.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      // Activar
      djStore.syncDeck('B');
      const stateSynced = djStore.getSnapshot().deckB;
      assert.equal(stateSynced.isSyncActive, true);
      assert.equal(stateSynced.pitch, 76.1);
      assert.equal(stateSynced.playbackRate, 1.0417);
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 1.0417);

      // Desactivar inmediatamente
      djStore.syncDeck('B');
      const stateDeactivated = djStore.getSnapshot().deckB;
      assert.equal(stateDeactivated.isSyncActive, false);
      assert.equal(stateDeactivated.pitch, 76.1, 'Fader permanece en 76.1');
      assert.equal(stateDeactivated.playbackRate, 1.0417, 'Velocidad nominal permanece en 1.0417');
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 1.0417, 'Motor conserva velocidad');
      assert.equal(djStore.getSnapshot().syncMasterDeck, null);
    });

    it('6.5 Desactivar SYNC después de que el Master cambie su tempo: el Esclavo conserva su tempo y no sigue al Master', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 100.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 100.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');
      // Master acelera al +4%
      djStore.setPitchDeckA(75);
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.04);

      // Desactivar SYNC en Esclavo
      djStore.syncDeck('B');
      assert.equal(djStore.getSnapshot().deckB.isSyncActive, false);
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.04);
      assert.equal(djStore.getSnapshot().deckB.pitch, 75.0);

      // Master cambia nuevamente (vuelve al centro 50 -> rate 1.0)
      djStore.setPitchDeckA(50);
      assert.equal(djStore.getSnapshot().deckA.playbackRate, 1.0);

      // El ex-esclavo B debe permanecer intacto en 1.04
      const stateB = djStore.getSnapshot().deckB;
      assert.equal(stateB.playbackRate, 1.04);
      assert.equal(stateB.pitch, 75.0);
      assert.equal(audioEngine.getDeckPlaybackRate('B'), 1.04);
    });

    it('6.6 Desacopla automáticamente al Esclavo con mensaje de error si el Master excede el rango ±8%', async () => {
      // Master: 100 BPM, Slave: 93 BPM -> En pitch 50, requiredRate = 100 / 93 = 1.0753 (dentro de ±8%)
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 100.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 93.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      djStore.syncDeck('B');
      assert.equal(djStore.getSnapshot().deckB.isSyncActive, true);

      // Master se acelera a +4% (pitch 75, rate 1.04 -> 104 BPM)
      // Nuevo requiredRate para B = 104 / 93 = 1.1183 (> 1.08)
      const observedSnapshots: ReturnType<typeof djStore.getSnapshot>[] = [];
      const unsubscribe = djStore.subscribe(() => observedSnapshots.push(djStore.getSnapshot()));
      djStore.setPitchDeckA(75);
      unsubscribe();
      observedSnapshots.forEach(assertSyncRoleInvariant);

      const stateB = djStore.getSnapshot().deckB;
      assert.equal(stateB.isSyncActive, false, 'Esclavo debe desacoplarse');
      assert.ok(stateB.errorMessage?.includes('excedió el rango de pitch'), 'Debe reportar mensaje explicativo');
      assert.equal(djStore.getSnapshot().syncMasterDeck, null, 'No debe quedar master asignado');
      assert.equal(djStore.getSnapshot().deckA.isMaster, false);
    });
  });

  // ========================================================
  // 7. Descarga del Maestro y Desacoplamiento Seguro
  // ========================================================
  describe('7. Descarga del Maestro y desacoplamiento seguro', () => {
    it('7.1 Si el Maestro se descarga, el Esclavo se desacopla sin saltos y sin Master huérfano', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 126.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);
      await djStore.playDeckA();
      await djStore.playDeckB();

      djStore.syncDeck('B');
      assert.equal(djStore.getSnapshot().syncMasterDeck, 'A');
      assert.equal(djStore.getSnapshot().deckB.isSyncActive, true);
      const slaveRateBeforeUnload = djStore.getSnapshot().deckB.playbackRate;
      assert.notEqual(slaveRateBeforeUnload, 1, 'La prueba debe observar una velocidad sincronizada no unitaria');

      // Descargar el Master A
      const observedSnapshots: ReturnType<typeof djStore.getSnapshot>[] = [];
      const unsubscribe = djStore.subscribe(() => observedSnapshots.push(djStore.getSnapshot()));
      djStore.unloadDeckA();
      unsubscribe();
      observedSnapshots.forEach(assertSyncRoleInvariant);

      const state = djStore.getSnapshot();
      assert.equal(state.syncMasterDeck, null, 'No debe quedar ningún master asignado');
      assert.equal(state.deckA.isMaster, false);
      assert.equal(state.deckA.playbackState, 'stopped');
      assert.equal(state.deckB.playbackState, 'playing', 'Descargar el Master no debe detener la reproducción del Slave');
      assert.equal(state.deckB.isSyncActive, false, 'El Esclavo se desacopla');
      assert.equal(state.deckB.playbackRate, slaveRateBeforeUnload, 'Mantiene su velocidad al desacoplarse');
      assert.equal(audioEngine.getDeckPlaybackRate('B'), slaveRateBeforeUnload, 'El motor conserva la velocidad');
      assert.equal(state.deckB.isMaster, false);
    });

    it('7.1a Si falla el blob de una nueva pista, conserva el Master y el SYNC actuales', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);
      djStore.syncDeck('B');
      const slaveRate = djStore.getSnapshot().deckB.playbackRate;

      const missingTrack = createTrackFromFile(createTestAudioFile('missing.mp3'), 180);
      missingTrack.source = { type: 'indexeddb', indexedDbKey: 'missing-blob-id' };
      assert.equal(await djStore.loadTrackToDeckA(missingTrack), false);

      const state = djStore.getSnapshot();
      assert.equal(state.deckA.track?.id, trackA.id);
      assert.equal(state.syncMasterDeck, 'A');
      assert.equal(state.deckA.isMaster, true);
      assert.equal(state.deckA.isSyncActive, false);
      assert.equal(state.deckB.isMaster, false);
      assert.equal(state.deckB.isSyncActive, true);
      assert.equal(state.deckB.playbackRate, slaveRate);
    });

    it('7.1b Si falla la decodificación de una nueva pista, conserva el Master y el SYNC actuales', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);
      djStore.syncDeck('B');
      const slaveRate = djStore.getSnapshot().deckB.playbackRate;

      MockAudioContext.shouldFailDecode = true;
      const { track: corruptTrack, file: corruptFile } = createAnalyzedTrack('corrupt.mp3', 124.0);
      await indexedDBStorage.saveTrack(corruptTrack, corruptFile);
      assert.equal(await djStore.loadTrackToDeckA(corruptTrack), false);

      const state = djStore.getSnapshot();
      assert.equal(state.deckA.track?.id, trackA.id);
      assert.equal(state.syncMasterDeck, 'A');
      assert.equal(state.deckA.isMaster, true);
      assert.equal(state.deckA.isSyncActive, false);
      assert.equal(state.deckB.isMaster, false);
      assert.equal(state.deckB.isSyncActive, true);
      assert.equal(state.deckB.playbackRate, slaveRate);
    });

    it('7.2 Independencia absoluta cuando SYNC está desactivado', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      // SYNC inactivo
      djStore.setPitchDeckA(20); // -4.8%
      assert.equal(djStore.getSnapshot().deckA.pitch, 20);
      assert.equal(djStore.getSnapshot().deckB.pitch, 50, 'Deck B no debe ser afectado');
      assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.0);
    });

    it('7.3 Pausar o detener el Master NO detiene al Esclavo ni altera su velocidad', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 126.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      await djStore.playDeckA();
      await djStore.playDeckB();
      djStore.syncDeck('B');

      assert.equal(djStore.getSnapshot().deckA.playbackState, 'playing');
      assert.equal(djStore.getSnapshot().deckB.playbackState, 'playing');

      // Pausar el Master A
      djStore.pauseDeckA();
      assert.equal(djStore.getSnapshot().deckA.playbackState, 'paused');
      assert.equal(djStore.getSnapshot().deckB.playbackState, 'playing', 'Esclavo B continúa reproduciendo');
      const slaveRate = djStore.getSnapshot().deckB.playbackRate;
      assert.equal(slaveRate, Number((124 / 126).toFixed(4)), 'Velocidad de B intacta');
      assert.equal(audioEngine.getDeckPlaybackRate('B'), slaveRate);
      assert.equal(djStore.getSnapshot().syncMasterDeck, 'A');
      assertSyncRoleInvariant(djStore.getSnapshot());

      djStore.pitchBend('A', 'up');
      assert.equal(djStore.getSnapshot().deckA.pitchBend, 3.5);
      assert.equal(audioEngine.getDeckPitchBend('A'), 0.035);

      // Detener el Master A
      djStore.stopDeckA();
      const stoppedState = djStore.getSnapshot();
      assert.equal(stoppedState.deckA.playbackState, 'stopped');
      assert.equal(stoppedState.deckA.pitchBend, 0, 'El estado del store debe reflejar el reset del motor');
      assert.equal(audioEngine.getDeckPitchBend('A'), 0, 'Stop resetea el bend del motor');
      assert.equal(stoppedState.syncMasterDeck, 'A', 'Stop conserva la relación SYNC en esta arquitectura');
      assert.equal(stoppedState.deckB.playbackRate, slaveRate);
      assert.equal(audioEngine.getDeckPlaybackRate('B'), slaveRate);
      assert.equal(stoppedState.deckB.playbackState, 'playing', 'Esclavo B sigue reproduciendo ininterrumpidamente');
      assertSyncRoleInvariant(stoppedState);
    });

    it('7.4 Alternar repetidamente SYNC (toggle múltiple) no deja estados huérfanos ni inconsistencias', async () => {
      const { track: trackA, file: fileA } = createAnalyzedTrack('trackA.mp3', 124.0);
      const { track: trackB, file: fileB } = createAnalyzedTrack('trackB.mp3', 124.0);
      await indexedDBStorage.saveTrack(trackA, fileA);
      await indexedDBStorage.saveTrack(trackB, fileB);
      await djStore.loadTrackToDeckA(trackA);
      await djStore.loadTrackToDeckB(trackB);

      for (let i = 0; i < 5; i++) {
        const expectedActive = i % 2 === 0;
        const res = djStore.syncDeck('B');
        assert.equal(res, expectedActive);
        assert.equal(djStore.getSnapshot().deckB.isSyncActive, expectedActive);
        if (expectedActive) {
          assert.equal(djStore.getSnapshot().syncMasterDeck, 'A');
          assert.equal(djStore.getSnapshot().deckA.isMaster, true);
        } else {
          assert.equal(djStore.getSnapshot().syncMasterDeck, null);
          assert.equal(djStore.getSnapshot().deckA.isMaster, false);
        }
      }
    });
  });
});
