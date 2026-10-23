/**
 * SYSTEM DJ — Test Suite: Fase 23.4 — Etapa C.4
 * Integración de BAR SYNC V1 en el Store y Preparación Segura del Transporte
 *
 * Contrato contractual auditado:
 * 1. Preparación correcta con Master reproduciéndose y Slave detenido.
 * 2. Preparación correcta con Slave pausado, conservando el estado pausado.
 * 3. Master detenido o pausado: rechazo sin movimiento ('rejected_state').
 * 4. Slave reproduciéndose: rechazo sin movimiento ('rejected_state').
 * 5. Falta de downbeat confirmado: rechazo sin movimiento ('rejected_unconfirmed').
 * 6. Hash cambiado o pista sustituida: rechazo y ninguna preparación obsoleta ('rejected_unconfirmed').
 * 7. Métricas incompatibles: rechazo sin movimiento ('rejected_metric_mismatch').
 * 8. Fallo de posicionamiento: no declarar 'armed' ('rejected_state').
 * 9. already_aligned: no reposicionar innecesariamente ('already_aligned').
 * 10. El Master continúa reproduciéndose sin cambios.
 * 11. La preparación no cambia BPM, pitch, playbackRate, SYNC ni la selección de Master.
 * 12. Descarga o sustitución posterior de la pista invalida el estado preparado ('idle').
 * 13. PLAY/CUP siguen siendo acciones manuales independientes de BAR SYNC.
 * 14. Ningún resultado declara sincronización audible exacta ni lanzamiento cuantizado.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import { createManualDownbeatConfirmation, createSuggestedDownbeat } from '../src/utils/downbeat.ts';
import { computeFileHash } from '../src/utils/cryptoHash.ts';
import type { Track, TrackDownbeat } from '../src/types/track.ts';
import type { DeckId } from '../src/types/deck.ts';

const HASH_MASTER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_SLAVE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

class MockAudioParam {
  public value: number;
  public events: Array<{ type: string; value?: number; time?: number }> = [];

  constructor(val = 1) {
    this.value = val;
  }

  public setValueAtTime(v: number, time?: number): void {
    this.value = v;
    this.events.push({ type: 'setValueAtTime', value: v, time });
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
  public currentTime = 10.5;
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
      duration: 300.0,
      length: 300 * 44100,
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

function createConfiguredTrack(
  name: string,
  bpm: number,
  contentHash: string,
  downbeatPosition = 1.0,
  beatsPerBar = 4,
  duration = 300.0
): Track {
  const file = createTestAudioFile(name);
  const track = createTrackFromFile(file, duration);
  track.fileMeta = {
    ...track.fileMeta,
    contentHash,
  };
  track.analysis = {
    status: 'analyzed',
    bpm,
    bpmConfidence: 0.95,
    isAmbiguous: false,
    alternateBpm: [bpm * 0.5, bpm * 2],
    beatUnit: { value: 4, status: 'confirmed', source: 'manual' },
    key: '8B',
    camelot: '8B',
    energy: 7.0,
    firstBeatTime: downbeatPosition,
  };
  track.downbeat = createManualDownbeatConfirmation({
    position: downbeatPosition,
    beatsPerBar,
    contentHash,
  });
  return track;
}

describe('Fase 23.4: Etapa C.4 — Integración de BAR SYNC V1 en DJStore y Transporte', () => {
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

  // 1. Preparación correcta con Master reproduciéndose y Slave detenido
  it('1. Preparación correcta con Master en reproducción y Slave detenido', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);

    // Master reproduce
    await djStore.playDeck('A');
    assert.equal(djStore.getSnapshot().deckA.playbackState, 'playing');

    // Slave detenido en 8.2s
    audioEngine.seekDeck('B', 8.2);
    // Verificar estado detenido antes de preparar
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'stopped');

    // BAR SYNC conserva la fase de compás del Master en esta instantánea y elige
    // la posición equivalente más cercana en el Slave.
    const plan = djStore.prepareBarSync('B');

    assert.equal(plan.status, 'armed');
    assert.equal(plan.targetPosition, 7.5);
    assert.equal(plan.beatsPerBar, 4);

    const deckB = djStore.getSnapshot().deckB;
    assert.equal(deckB.currentTime, 7.5);
    assert.equal(deckB.playbackState, 'stopped', 'El Slave debe conservar estrictamente su estado detenido');
    assert.equal(deckB.barSync.status, 'armed');
    assert.equal(deckB.barSync.preparedPosition, 7.5);
    assert.equal(deckB.barSync.previousPosition, 8.2);
    assert.equal(deckB.barSync.displacementSec, -0.7);
    assert.equal(deckB.barSync.targetDownbeatSec, 0.5);
    assert.equal(deckB.barSync.beatsPerBar, 4);
    assert.equal(deckB.barSync.reason, null);
  });

  // 2. Preparación correcta con Slave pausado, conservando el estado pausado
  it('2. Preparación correcta con Slave pausado, conservando el estado pausado', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);

    await djStore.playDeck('A');
    // Poner Slave en pausa
    await djStore.playDeck('B');
    djStore.pauseDeck('B');
    audioEngine.seekDeck('B', 8.2);
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'paused');

    const plan = djStore.prepareBarSync('B');

    assert.equal(plan.status, 'armed');
    assert.equal(plan.targetPosition, 7.5);

    const deckB = djStore.getSnapshot().deckB;
    assert.equal(deckB.currentTime, 7.5);
    assert.equal(deckB.playbackState, 'paused', 'El Slave debe conservar estrictamente su estado pausado');
    assert.equal(deckB.barSync.status, 'armed');
    assert.equal(deckB.barSync.preparedPosition, 7.5);
  });

  // 3. Master detenido o pausado: rechazo sin movimiento
  it('3. Master detenido o pausado rechaza la preparación sin mover el transporte', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);

    // 3a. Master detenido
    audioEngine.seekDeck('B', 8.2);
    const planStopped = djStore.prepareBarSync('B');

    assert.equal(planStopped.status, 'rejected_state');
    assert.equal(planStopped.targetPosition, null);
    assert.ok(planStopped.reason?.includes('Master debe estar en reproducción'));
    assert.equal(audioEngine.getDeckCurrentTime('B'), 8.2, 'El cabezal de B no debe haberse movido');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'rejected_state');

    // 3b. Master pausado
    await djStore.playDeck('A');
    djStore.pauseDeck('A');
    assert.equal(djStore.getSnapshot().deckA.playbackState, 'paused');

    const planPaused = djStore.prepareBarSync('B');
    assert.equal(planPaused.status, 'rejected_state');
    assert.equal(planPaused.targetPosition, null);
    assert.equal(audioEngine.getDeckCurrentTime('B'), 8.2, 'El cabezal de B no debe haberse movido');
  });

  // 4. Slave reproduciéndose: rechazo sin movimiento
  it('4. Slave reproduciéndose rechaza la preparación sin alterar la reproducción', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);

    await djStore.playDeck('A');
    await djStore.playDeck('B');
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'playing');

    const plan = djStore.prepareBarSync('B');

    assert.equal(plan.status, 'rejected_state');
    assert.ok(plan.reason?.includes('Slave está reproduciéndose'));
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'playing');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'rejected_state');
  });

  // 5. Falta de downbeat confirmado: rechazo sin movimiento
  it('5. Falta de downbeat confirmado rechaza sin mover el cabezal', async () => {
    // Master con sugerencia (no manual)
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    masterTrack.downbeat = createSuggestedDownbeat(1.0, 4, 0.85);

    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    audioEngine.seekDeck('B', 8.2);

    const plan = djStore.prepareBarSync('B');
    assert.equal(plan.status, 'rejected_unconfirmed');
    assert.ok(plan.reason?.includes('downbeat confirmado'));
    assert.equal(audioEngine.getDeckCurrentTime('B'), 8.2);
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'rejected_unconfirmed');
  });

  // 6. Hash cambiado o pista sustituida: rechazo y ninguna preparación obsoleta
  it('6. Hash cambiado rechaza y no ejecuta ninguna preparación obsoleta', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    // Slave con hash incongruente entre confirmación y fileMeta
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);
    slaveTrack.fileMeta = {
      ...slaveTrack.fileMeta,
      contentHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    };

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    audioEngine.seekDeck('B', 8.2);

    const plan = djStore.prepareBarSync('B');
    assert.equal(plan.status, 'rejected_unconfirmed');
    assert.equal(audioEngine.getDeckCurrentTime('B'), 8.2);
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'rejected_unconfirmed');
  });

  // 7. Métricas incompatibles: rechazo sin movimiento
  it('7. Métricas musicales incompatibles (4/4 vs 3/4) rechazan sin mover el transporte', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4); // 4/4
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 3);   // 3/4

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    audioEngine.seekDeck('B', 8.2);

    const plan = djStore.prepareBarSync('B');
    assert.equal(plan.status, 'rejected_metric_mismatch');
    assert.ok(plan.reason?.includes('Discrepancia métrica musical'));
    assert.equal(audioEngine.getDeckCurrentTime('B'), 8.2);
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'rejected_metric_mismatch');
  });

  it('7.1 BeatUnit ausente rechaza sin seek ni cambios de velocidad, SYNC o Master', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);
    delete slaveTrack.analysis.beatUnit;

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');
    audioEngine.seekDeck('B', 8.2);
    const before = djStore.getSnapshot();
    const plan = djStore.prepareBarSync('B');
    const after = djStore.getSnapshot();

    assert.equal(plan.status, 'rejected_unconfirmed');
    assert.equal(plan.targetPosition, null);
    assert.match(plan.reason ?? '', /beatUnit válido confirmado manualmente/i);
    assert.equal(audioEngine.getDeckCurrentTime('B'), 8.2);
    assert.equal(after.deckB.playbackRate, before.deckB.playbackRate);
    assert.equal(after.deckB.syncStatus, before.deckB.syncStatus);
    assert.equal(after.masterDeckId, before.masterDeckId);
    assert.equal(after.deckB.track?.analysis.bpm, before.deckB.track?.analysis.bpm);
  });

  it('7.2 Hipótesis 0.5x/2x rechazada antes del seek con estado y tempo intactos', async () => {
    const masterTrack = createConfiguredTrack('master-140.mp3', 140, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave-70.mp3', 70, HASH_SLAVE, 0.5, 4);
    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');
    audioEngine.seekDeck('B', 8.2);
    const before = djStore.getSnapshot();

    const plan = djStore.prepareBarSync('B');
    const after = djStore.getSnapshot();

    assert.equal(plan.status, 'rejected_confidence');
    assert.equal(plan.targetPosition, null);
    assert.equal(audioEngine.getDeckCurrentTime('B'), 8.2);
    assert.equal(after.deckB.playbackRate, before.deckB.playbackRate);
    assert.equal(after.deckB.track?.analysis.bpm, 70);
    assert.equal(after.deckA.isMaster, before.deckA.isMaster);
    assert.equal(after.deckB.isSyncActive, before.deckB.isSyncActive);
  });

  // 8. Fallo de posicionamiento: no declarar armed
  it('8. Fallo de posicionamiento en el transporte no declara armed y registra error', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    // Interceptar seekDeck para simular un fallo en el controlador de audio subyacente
    const originalSeek = audioEngine.seekDeck.bind(audioEngine);
    audioEngine.seekDeck = () => {
      throw new Error('Dispositivo de audio inaccesible');
    };

    try {
      const plan = djStore.prepareBarSync('B');
      assert.notEqual(plan.status, 'armed');
      assert.equal(plan.status, 'rejected_state');
      assert.ok(plan.reason?.includes('Fallo al posicionar el cabezal'));
      assert.equal(djStore.getSnapshot().deckB.barSync.status, 'rejected_state');
    } finally {
      audioEngine.seekDeck = originalSeek;
    }
  });

  // 9. already_aligned: no reposicionar innecesariamente
  it('9. already_aligned: si el Slave ya está en el compás, no ejecuta seekDeck', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    // Posicionar al Slave en la fase equivalente calculada por BAR SYNC.
    audioEngine.seekDeck('B', 7.5);

    let seekCalled = false;
    const originalSeek = audioEngine.seekDeck.bind(audioEngine);
    audioEngine.seekDeck = (deckId: DeckId, pos: number) => {
      seekCalled = true;
      return originalSeek(deckId, pos);
    };

    try {
      const plan = djStore.prepareBarSync('B');
      assert.equal(plan.status, 'already_aligned');
      assert.equal(plan.targetPosition, 7.5);
      assert.equal(seekCalled, false, 'No se debe llamar a seekDeck si ya estaba alineado');
      const bSync = djStore.getSnapshot().deckB.barSync;
      assert.equal(bSync.status, 'already_aligned');
      assert.equal(bSync.preparedPosition, 7.5);
      assert.equal(bSync.previousPosition, 7.5);
      assert.equal(bSync.displacementSec, 0);
    } finally {
      audioEngine.seekDeck = originalSeek;
    }
  });

  // 10. El Master continúa reproduciéndose sin cambios
  it('10. El Master continúa reproduciéndose sin cambios tras la preparación del Slave', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    const masterStateBefore = djStore.getSnapshot().deckA;
    assert.equal(masterStateBefore.playbackState, 'playing');

    djStore.prepareBarSync('B');

    const masterStateAfter = djStore.getSnapshot().deckA;
    assert.equal(masterStateAfter.playbackState, 'playing');
    assert.equal(masterStateAfter.pitch, masterStateBefore.pitch);
    assert.equal(masterStateAfter.playbackRate, masterStateBefore.playbackRate);
    assert.equal(masterStateAfter.calculatedBpm, masterStateBefore.calculatedBpm);
  });

  // 11. La preparación no cambia BPM, pitch, playbackRate, SYNC ni la selección de Master
  it('11. La preparación de compás no cambia BPM, pitch, playbackRate, SYNC ni Master', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 124, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    // Configurar pitch manual en Slave: +2% (pitch = 62.5, playbackRate = 1.02)
    djStore.setPitchDeck('B', 62.5);
    const slaveBefore = djStore.getSnapshot().deckB;
    const masterDeckIdBefore = djStore.getSnapshot().syncMasterDeck;

    const plan = djStore.prepareBarSync('B');
    assert.equal(plan.status, 'armed');

    const slaveAfter = djStore.getSnapshot().deckB;
    assert.equal(slaveAfter.pitch, slaveBefore.pitch);
    assert.equal(slaveAfter.playbackRate, slaveBefore.playbackRate);
    assert.equal(slaveAfter.calculatedBpm, slaveBefore.calculatedBpm);
    assert.equal(slaveAfter.isSyncActive, slaveBefore.isSyncActive);
    assert.equal(djStore.getSnapshot().syncMasterDeck, masterDeckIdBefore);
  });

  // 12. Descarga o sustitución posterior de la pista invalida el estado preparado
  it('12. Descarga o sustitución de la pista invalida el estado preparado', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack1 = createConfiguredTrack('slave1.mp3', 120, HASH_SLAVE, 0.5, 4);
    const slaveTrack2 = createConfiguredTrack('slave2.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack1);
    await djStore.playDeck('A');

    // 12a. Armar y luego descargar Slave
    djStore.prepareBarSync('B');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'armed');

    djStore.unloadDeck('B');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'idle');
    assert.equal(djStore.getSnapshot().deckB.barSync.preparedPosition, null);

    // 12b. Cargar nueva pista en Slave: inicia en idle
    await djStore.loadTrackToDeck('B', slaveTrack2);
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'idle');

    // 12c. Armar Slave y descargar Master: invalida la preparación de Slave
    djStore.prepareBarSync('B');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'armed');

    djStore.unloadDeck('A');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'idle');
  });

  // 13. PLAY/CUP siguen siendo acciones manuales independientes de BAR SYNC
  it('13. PLAY y CUP son acciones manuales independientes de BAR SYNC y conservan pitch, rate y BPM', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 124, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    // Configurar pitch manual en Slave: +2% (pitch = 62.5, playbackRate = 1.02)
    djStore.setPitchDeck('B', 62.5);

    // Preparar Slave
    djStore.prepareBarSync('B');
    const slaveBeforePlay = djStore.getSnapshot().deckB;
    assert.equal(slaveBeforePlay.barSync.status, 'armed');
    assert.equal(slaveBeforePlay.playbackState, 'stopped', 'No debe arrancar automáticamente');

    // Registrar valores originales antes de pulsar PLAY
    const expectedPitch = slaveBeforePlay.pitch;
    const expectedPlaybackRate = slaveBeforePlay.playbackRate;
    const expectedCalculatedBpm = slaveBeforePlay.calculatedBpm;
    const expectedAnalysisBpm = slaveBeforePlay.track?.analysis?.bpm;

    // El DJ pulsa manualmente PLAY
    await djStore.playDeck('B');
    const slaveAfterPlay = djStore.getSnapshot().deckB;
    assert.equal(slaveAfterPlay.playbackState, 'playing', 'La reproducción comienza únicamente por la acción manual');
    assert.equal(slaveAfterPlay.barSync.status, 'completed', 'El estado cambia a completed según el contrato');
    assert.equal(slaveAfterPlay.pitch, expectedPitch, 'El pitch permanece igual tras el lanzamiento manual PLAY');
    assert.equal(slaveAfterPlay.playbackRate, expectedPlaybackRate, 'El playbackRate permanece igual tras el lanzamiento manual PLAY');
    assert.equal(slaveAfterPlay.calculatedBpm, expectedCalculatedBpm, 'El calculatedBpm permanece igual tras el lanzamiento manual PLAY');
    assert.equal(slaveAfterPlay.track?.analysis?.bpm, expectedAnalysisBpm, 'El track.analysis.bpm permanece igual tras el lanzamiento manual PLAY');

    // Pausar y preparar de nuevo
    djStore.pauseDeck('B');
    audioEngine.seekDeck('B', 6.0);
    djStore.prepareBarSync('B');

    const slaveBeforeCup = djStore.getSnapshot().deckB;
    assert.equal(slaveBeforeCup.barSync.status, 'armed');

    // Registrar valores originales antes de pulsar CUE / CUP
    const expectedCupPitch = slaveBeforeCup.pitch;
    const expectedCupPlaybackRate = slaveBeforeCup.playbackRate;
    const expectedCupCalculatedBpm = slaveBeforeCup.calculatedBpm;
    const expectedCupAnalysisBpm = slaveBeforeCup.track?.analysis?.bpm;

    // El DJ pulsa manualmente CUE / CUP
    await djStore.handleCueDown('B');
    const slaveAfterCup = djStore.getSnapshot().deckB;
    assert.equal(slaveAfterCup.isCupPlaying, true, 'La reproducción CUP comienza únicamente por la acción manual');
    assert.equal(slaveAfterCup.barSync.status, 'completed', 'El estado cambia a completed tras CUP');
    assert.equal(slaveAfterCup.pitch, expectedCupPitch, 'El pitch permanece igual tras el lanzamiento manual CUP');
    assert.equal(slaveAfterCup.playbackRate, expectedCupPlaybackRate, 'El playbackRate permanece igual tras el lanzamiento manual CUP');
    assert.equal(slaveAfterCup.calculatedBpm, expectedCupCalculatedBpm, 'El calculatedBpm permanece igual tras el lanzamiento manual CUP');
    assert.equal(slaveAfterCup.track?.analysis?.bpm, expectedCupAnalysisBpm, 'El track.analysis.bpm permanece igual tras el lanzamiento manual CUP');

    djStore.handleCueUp('B');
  });

  // 14. Ningún resultado declara sincronización audible exacta ni lanzamiento cuantizado
  it('14. Ningún resultado declara sincronización audible exacta ni cuantizada', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    const plan = djStore.prepareBarSync('B');

    // Validar semántica estricta del contrato
    assert.equal(plan.status, 'armed');
    // 'armed' significa exclusivamente cabezal preparado estáticamente en el downbeat
    assert.equal(typeof plan.targetPosition, 'number');
    assert.equal(typeof plan.targetDownbeatSec, 'number');
    assert.equal(typeof plan.beatsPerBar, 'number');

    // No existen flags ni promesas de sincronía audible asegurada o lanzamiento automático
    const resultObj = plan as unknown as Record<string, unknown>;
    assert.equal(resultObj.audibleLock, undefined);
    assert.equal(resultObj.quantizedLaunch, undefined);
    assert.equal(resultObj.autoPlayScheduled, undefined);
  });

  // 15. already_aligned con pequeña desviación sub-tolerancia registra posición real y no fuerza displacementSec = 0
  it('15. already_aligned registra la posición real del cabezal y no fuerza displacementSec = 0 si difieren dentro de tolerancia', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    // Posicionar al Slave en 7.503 (target es 7.5, tolerancia por defecto 0.005s)
    audioEngine.seekDeck('B', 7.503);

    let seekCalled = false;
    const originalSeek = audioEngine.seekDeck.bind(audioEngine);
    audioEngine.seekDeck = (deckId: DeckId, pos: number) => {
      seekCalled = true;
      return originalSeek(deckId, pos);
    };

    try {
      const plan = djStore.prepareBarSync('B');
      assert.equal(plan.status, 'already_aligned');
      assert.equal(plan.targetPosition, 7.5);
      assert.equal(seekCalled, false, 'No debe ejecutar seekDeck en already_aligned');

      const bSync = djStore.getSnapshot().deckB.barSync;
      assert.equal(bSync.status, 'already_aligned');
      assert.equal(bSync.preparedPosition, 7.503, 'preparedPosition debe ser la posición real del cabezal');
      assert.equal(bSync.previousPosition, 7.503, 'previousPosition debe registrar la posición previa real');
      assert.equal(bSync.displacementSec, 0.003, 'displacementSec no debe forzarse a 0 si hay desviación real');
    } finally {
      audioEngine.seekDeck = originalSeek;
    }
  });

  // 16. cancelBarSync limpia y reinicia todos los campos posicionales y métricos
  it('16. cancelBarSync limpia y reinicia los datos de BAR SYNC a null', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    audioEngine.seekDeck('B', 8.2);
    const plan = djStore.prepareBarSync('B');
    assert.equal(plan.status, 'armed');

    const armedSync = djStore.getSnapshot().deckB.barSync;
    assert.equal(armedSync.preparedPosition, 7.5);
    assert.equal(armedSync.previousPosition, 8.2);
    assert.equal(armedSync.displacementSec, -0.7);

    // Cancelar BAR SYNC
    djStore.cancelBarSync('B');

    const cancelledSync = djStore.getSnapshot().deckB.barSync;
    assert.equal(cancelledSync.status, 'cancelled');
    assert.equal(cancelledSync.preparedPosition, null);
    assert.equal(cancelledSync.previousPosition, null);
    assert.equal(cancelledSync.displacementSec, null);
    assert.equal(cancelledSync.targetDownbeatSec, null);
    assert.equal(cancelledSync.beatsPerBar, null);
    assert.ok(cancelledSync.reason?.includes('cancelada'));
  });

  // 17. Reinicio y limpieza de datos en cambio de pista, seek, stop y nueva preparación rechazada
  it('17. Limpia y reinicia datos al cambiar de pista, seek, stop y nueva preparación rechazada', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4);
    const slaveTrack1 = createConfiguredTrack('slave1.mp3', 120, HASH_SLAVE, 0.5, 4);
    const slaveTrack2 = createConfiguredTrack('slave2.mp3', 120, 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 0.8, 4);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack1);
    await djStore.playDeck('A');

    // 17.1 Preparar Slave
    audioEngine.seekDeck('B', 8.2);
    djStore.prepareBarSync('B');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'armed');

    // 17.2 Cargar nueva pista limpia barSync
    await djStore.loadTrackToDeck('B', slaveTrack2);
    const afterLoad = djStore.getSnapshot().deckB.barSync;
    assert.equal(afterLoad.status, 'idle');
    assert.equal(afterLoad.preparedPosition, null);
    assert.equal(afterLoad.previousPosition, null);
    assert.equal(afterLoad.displacementSec, null);

    // 17.3 Preparar de nuevo y hacer seek manual
    audioEngine.seekDeck('B', 4.0);
    djStore.prepareBarSync('B');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'armed');
    djStore.seekDeck('B', 20.0);
    const afterSeek = djStore.getSnapshot().deckB.barSync;
    assert.equal(afterSeek.status, 'idle');
    assert.equal(afterSeek.preparedPosition, null);
    assert.equal(afterSeek.previousPosition, null);
    assert.equal(afterSeek.displacementSec, null);

    // 17.4 Preparar de nuevo y llamar a stopDeck
    audioEngine.seekDeck('B', 4.0);
    djStore.prepareBarSync('B');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'armed');
    djStore.stopDeck('B');
    const afterStop = djStore.getSnapshot().deckB.barSync;
    assert.equal(afterStop.status, 'idle');
    assert.equal(afterStop.preparedPosition, null);
    assert.equal(afterStop.previousPosition, null);
    assert.equal(afterStop.displacementSec, null);

    // 17.5 Nueva preparación rechazada limpia cualquier dato residual
    // Pausar Master para forzar rechazo
    await djStore.pauseDeck('A');
    const rejectPlan = djStore.prepareBarSync('B');
    assert.equal(rejectPlan.status, 'rejected_state');
    const afterReject = djStore.getSnapshot().deckB.barSync;
    assert.equal(afterReject.status, 'rejected_state');
    assert.equal(afterReject.preparedPosition, null);
    assert.equal(afterReject.previousPosition, null);
    assert.equal(afterReject.displacementSec, null);
  });
});

describe('Fase 23.4: Etapa C.8.1 — Acciones Seguras en Store para Confirmar y Limpiar Downbeat', () => {
  let originalAudioContext: unknown;
  let originalWindow: unknown;

  async function createTestTrackWithRealHash(
    name: string,
    bpm = 120,
    downbeat?: TrackDownbeat | null
  ): Promise<{ track: Track; file: File; hash: string }> {
    const file = createTestAudioFile(name);
    const hash = await computeFileHash(file);
    const track = createTrackFromFile(file, 300, hash);
    track.analysis = {
      status: 'analyzed',
      bpm,
      bpmConfidence: 0.95,
      key: '8B',
      camelot: '8B',
      energy: 7.0,
      firstBeatTime: 1.0,
    };
    if (downbeat) {
      track.downbeat = downbeat;
    }
    return { track, file, hash };
  }

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

  // 1. Confirmar downbeat de la pista cargada con posición y métrica explícitas
  it('1. Confirma downbeat de la pista cargada con posición y métrica explícitas y persiste en IndexedDB', async () => {
    const { track, file, hash } = await createTestTrackWithRealHash('trackA.mp3', 120, createSuggestedDownbeat(0.5));

    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeck('A', track);

    assert.equal(djStore.getSnapshot().deckA.track?.downbeat?.status, 'suggested');
    assert.equal(djStore.getSnapshot().deckA.track?.downbeat?.confirmation, null);

    const success = await djStore.confirmDownbeat('A', 1.25, 4);
    assert.equal(success, true);

    const deckA = djStore.getSnapshot().deckA;
    assert.equal(deckA.track?.downbeat?.status, 'confirmed');
    assert.equal(deckA.track?.downbeat?.confirmation?.position, 1.25);
    assert.equal(deckA.track?.downbeat?.confirmation?.beatsPerBar, 4);
    assert.equal(deckA.track?.downbeat?.confirmation?.contentHash, hash);
    assert.equal(deckA.track?.downbeat?.suggestedPosition, 0.5);

    // Verificar en almacenamiento persistente
    const persisted = await indexedDBStorage.getTrackDownbeat(track.id);
    assert.equal(persisted?.status, 'confirmed');
    assert.equal(persisted?.confirmation?.position, 1.25);
    assert.equal(persisted?.confirmation?.beatsPerBar, 4);
    assert.equal(persisted?.confirmation?.contentHash, hash);
  });

  // 2. Limpiar una confirmación existente, respetando el modelo de estados none / suggested
  it('2. Limpia confirmación existente respetando modelo none / suggested (con y sin sugerencia previa)', async () => {
    // Caso A: con sugerencia previa (debe quedar en 'suggested')
    const fileA = createTestAudioFile('trackA.mp3');
    const hashA = await computeFileHash(fileA);
    const trackA = createTrackFromFile(fileA, 300, hashA);
    trackA.downbeat = createManualDownbeatConfirmation({
      position: 1.0,
      beatsPerBar: 4,
      contentHash: hashA,
      suggestedPosition: 0.5,
    });
    await indexedDBStorage.saveTrack(trackA, fileA);
    await djStore.loadTrackToDeck('A', trackA);

    assert.equal(djStore.getSnapshot().deckA.track?.downbeat?.status, 'confirmed');
    const clearedA = await djStore.clearDownbeat('A');
    assert.equal(clearedA, true);

    const deckA = djStore.getSnapshot().deckA;
    assert.equal(deckA.track?.downbeat?.status, 'suggested');
    assert.equal(deckA.track?.downbeat?.suggestedPosition, 0.5);
    assert.equal(deckA.track?.downbeat?.confirmation, null);

    const persistedA = await indexedDBStorage.getTrackDownbeat(trackA.id);
    assert.equal(persistedA?.status, 'suggested');
    assert.equal(persistedA?.suggestedPosition, 0.5);
    assert.equal(persistedA?.confirmation, null);

    // Caso B: sin sugerencia previa (debe quedar en 'none')
    const fileB = createTestAudioFile('trackB.mp3');
    const hashB = await computeFileHash(fileB);
    const trackB = createTrackFromFile(fileB, 300, hashB);
    trackB.downbeat = createManualDownbeatConfirmation({
      position: 1.0,
      beatsPerBar: 4,
      contentHash: hashB,
      suggestedPosition: null,
    });
    await indexedDBStorage.saveTrack(trackB, fileB);
    await djStore.loadTrackToDeck('B', trackB);

    assert.equal(djStore.getSnapshot().deckB.track?.downbeat?.status, 'confirmed');
    const clearedB = await djStore.clearDownbeat('B');
    assert.equal(clearedB, true);

    const deckB = djStore.getSnapshot().deckB;
    assert.equal(deckB.track?.downbeat?.status, 'none');
    assert.equal(deckB.track?.downbeat?.suggestedPosition, null);
    assert.equal(deckB.track?.downbeat?.confirmation, null);

    const persistedB = await indexedDBStorage.getTrackDownbeat(trackB.id);
    assert.equal(persistedB?.status, 'none');
    assert.equal(persistedB?.suggestedPosition, null);
    assert.equal(persistedB?.confirmation, null);
  });

  // 3. Persistencia fallida no declara confirmación exitosa ni altera estado del deck
  it('3. Persistencia fallida retorna false y no actualiza el estado del deck', async () => {
    const { track, file } = await createTestTrackWithRealHash('fail.mp3', 120, createSuggestedDownbeat(0.4));
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeck('A', track);

    // Simular error en la persistencia
    const originalMethod = indexedDBStorage.updateTrackDownbeat.bind(indexedDBStorage);
    indexedDBStorage.updateTrackDownbeat = async () => false;

    try {
      const result = await djStore.confirmDownbeat('A', 1.0, 4);
      assert.equal(result, false, 'Debe retornar false ante fallo en persistencia');
      assert.equal(djStore.getSnapshot().deckA.track?.downbeat?.status, 'suggested');
      assert.equal(djStore.getSnapshot().deckA.track?.downbeat?.confirmation, null);
    } finally {
      indexedDBStorage.updateTrackDownbeat = originalMethod;
    }
  });

  // 4. Exige contentHash SHA-256 válido y rechaza pistas sin hash o con hash inválido
  it('4. Exige contentHash SHA-256 válido y rechaza pistas sin hash o con hash inválido', async () => {
    const file = createTestAudioFile('nohash.mp3');
    const trackNoHash = createTrackFromFile(file, 300);
    delete trackNoHash.fileMeta?.contentHash;
    await djStore.loadTrackToDeck('A', trackNoHash);

    const resNoHash = await djStore.confirmDownbeat('A', 1.0, 4);
    assert.equal(resNoHash, false);
    assert.notEqual(djStore.getSnapshot().deckA.track?.downbeat?.status, 'confirmed');

    const resClearNoHash = await djStore.clearDownbeat('A');
    assert.equal(resClearNoHash, false);

    // Hash con longitud o caracteres inválidos
    const fileInvalid = createTestAudioFile('badhash.mp3');
    const trackBadHash = createTrackFromFile(fileInvalid, 300);
    trackBadHash.fileMeta = { ...trackBadHash.fileMeta, contentHash: 'not-a-64-character-sha256-hash' };
    await djStore.loadTrackToDeck('B', trackBadHash);

    const resBadHash = await djStore.confirmDownbeat('B', 1.0, 4);
    assert.equal(resBadHash, false);
    assert.notEqual(djStore.getSnapshot().deckB.track?.downbeat?.status, 'confirmed');

    const resClearBad = await djStore.clearDownbeat('B');
    assert.equal(resClearBad, false);
  });

  // 5. Cambio de pista concurrente durante operación asíncrona (anti-carrera)
  it('5. Descarta operación y retorna false si la pista cambia durante la persistencia asíncrona', async () => {
    const { track: track1, file: file1 } = await createTestTrackWithRealHash('track1.mp3');
    await indexedDBStorage.saveTrack(track1, file1);

    const { track: track2, file: file2 } = await createTestTrackWithRealHash('track2.mp3');
    await indexedDBStorage.saveTrack(track2, file2);

    await djStore.loadTrackToDeck('A', track1);

    // Interceptar updateTrackDownbeat para cambiar la pista cargada concurrentemente
    const originalMethod = indexedDBStorage.updateTrackDownbeat.bind(indexedDBStorage);
    let interceptionTriggered = false;

    indexedDBStorage.updateTrackDownbeat = async (id, downbeat, expectedHash) => {
      interceptionTriggered = true;
      // Mientras la persistencia está en progreso, el usuario carga track2 en Deck A
      await djStore.loadTrackToDeck('A', track2);
      // Retornar éxito en la persistencia de la pista 1
      return originalMethod(id, downbeat, expectedHash);
    };

    try {
      const result = await djStore.confirmDownbeat('A', 1.5, 4);
      assert.equal(interceptionTriggered, true);
      assert.equal(result, false, 'Debe retornar false al detectar que Deck A ya no tiene track1');

      // Deck A debe conservar track2 sin contaminación de track1
      const currentDeckA = djStore.getSnapshot().deckA;
      assert.equal(currentDeckA.track?.id, track2.id);
      assert.notEqual(currentDeckA.track?.downbeat?.confirmation?.position, 1.5);
    } finally {
      indexedDBStorage.updateTrackDownbeat = originalMethod;
    }
  });

  // 6. Misma pista cargada en ambos decks se mantiene coherente
  it('6. Mantiene ambos decks coherentes cuando la misma pista está cargada en ambos decks', async () => {
    const { track: sharedTrack, file } = await createTestTrackWithRealHash('shared.mp3');
    await indexedDBStorage.saveTrack(sharedTrack, file);

    await djStore.loadTrackToDeck('A', sharedTrack);
    await djStore.loadTrackToDeck('B', sharedTrack);

    assert.equal(djStore.getSnapshot().deckA.track?.id, sharedTrack.id);
    assert.equal(djStore.getSnapshot().deckB.track?.id, sharedTrack.id);

    // Confirmar desde Deck A
    const confirmed = await djStore.confirmDownbeat('A', 1.5, 4);
    assert.equal(confirmed, true);

    const snapshotAfterConfirm = djStore.getSnapshot();
    assert.equal(snapshotAfterConfirm.deckA.track?.downbeat?.status, 'confirmed');
    assert.equal(snapshotAfterConfirm.deckB.track?.downbeat?.status, 'confirmed');
    assert.equal(snapshotAfterConfirm.deckA.track?.downbeat?.confirmation?.position, 1.5);
    assert.equal(snapshotAfterConfirm.deckB.track?.downbeat?.confirmation?.position, 1.5);

    // Limpiar desde Deck B
    const cleared = await djStore.clearDownbeat('B');
    assert.equal(cleared, true);

    const snapshotAfterClear = djStore.getSnapshot();
    assert.notEqual(snapshotAfterClear.deckA.track?.downbeat?.status, 'confirmed');
    assert.notEqual(snapshotAfterClear.deckB.track?.downbeat?.status, 'confirmed');
    assert.equal(snapshotAfterClear.deckA.track?.downbeat?.confirmation, null);
    assert.equal(snapshotAfterClear.deckB.track?.downbeat?.confirmation, null);
  });

  // 7. Limpieza de estados de BAR SYNC que hayan quedado obsoletos
  it('7. Limpia preparaciones de BAR SYNC que hayan quedado obsoletas tras confirmar o limpiar downbeat', async () => {
    const fileMaster = createTestAudioFile('master.mp3');
    const hashMaster = await computeFileHash(fileMaster);
    const masterTrack = createTrackFromFile(fileMaster, 300, hashMaster);
    masterTrack.analysis = {
      status: 'analyzed', bpm: 120, bpmConfidence: 0.95, isAmbiguous: false,
      alternateBpm: [60, 240], beatUnit: { value: 4, status: 'confirmed', source: 'manual' }, firstBeatTime: 1.0,
    };
    masterTrack.downbeat = createManualDownbeatConfirmation({
      position: 1.0,
      beatsPerBar: 4,
      contentHash: hashMaster,
    });
    await indexedDBStorage.saveTrack(masterTrack, fileMaster);

    const fileSlave = createTestAudioFile('slave.mp3');
    const hashSlave = await computeFileHash(fileSlave);
    const slaveTrack = createTrackFromFile(fileSlave, 300, hashSlave);
    slaveTrack.analysis = {
      status: 'analyzed', bpm: 120, bpmConfidence: 0.95, isAmbiguous: false,
      alternateBpm: [60, 240], beatUnit: { value: 4, status: 'confirmed', source: 'manual' }, firstBeatTime: 0.5,
    };
    slaveTrack.downbeat = createManualDownbeatConfirmation({
      position: 0.5,
      beatsPerBar: 4,
      contentHash: hashSlave,
    });
    await indexedDBStorage.saveTrack(slaveTrack, fileSlave);

    await djStore.loadTrackToDeck('A', masterTrack);
    await djStore.loadTrackToDeck('B', slaveTrack);
    await djStore.playDeck('A');

    // Preparar Slave en frontera de compás
    const plan1 = djStore.prepareBarSync('B');
    assert.equal(plan1.status, 'armed');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'armed');

    // Modificar downbeat de Slave confirmando una nueva posición
    const updatedB = await djStore.confirmDownbeat('B', 2.0, 4);
    assert.equal(updatedB, true);
    assert.equal(
      djStore.getSnapshot().deckB.barSync.status,
      'idle',
      'El BAR SYNC de Deck B debe invalidarse a idle tras cambiar su downbeat'
    );
    assert.equal(djStore.getSnapshot().deckB.barSync.preparedPosition, null);

    // Preparar de nuevo Slave
    const plan2 = djStore.prepareBarSync('B');
    assert.equal(plan2.status, 'armed');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'armed');

    // Limpiar downbeat de Master
    const clearedMaster = await djStore.clearDownbeat('A');
    assert.equal(clearedMaster, true);
    assert.equal(
      djStore.getSnapshot().deckB.barSync.status,
      'idle',
      'El BAR SYNC de Deck B debe invalidarse a idle cuando el Master pierde o cambia su downbeat'
    );
  });

  // 8. Validación estricta de parámetros y no convertir firstBeatTime implícitamente
  it('8. Valida estrictamente parámetros y no convierte firstBeatTime implícitamente', async () => {
    const { track, file } = await createTestTrackWithRealHash('strict.mp3', 120);
    track.analysis = { status: 'analyzed', bpm: 120, firstBeatTime: 0.75 };
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeck('A', track);

    // Posición negativa
    assert.equal(await djStore.confirmDownbeat('A', -1, 4), false);
    // Posición no finita
    assert.equal(await djStore.confirmDownbeat('A', NaN, 4), false);
    assert.equal(await djStore.confirmDownbeat('A', Infinity, 4), false);
    // Posición excede duración (MockAudioContext dura 300s)
    assert.equal(await djStore.confirmDownbeat('A', 350, 4), false);
    // Métrica inválida
    assert.equal(await djStore.confirmDownbeat('A', 1.0, 0), false);
    assert.equal(await djStore.confirmDownbeat('A', 1.0, -1), false);
    assert.equal(await djStore.confirmDownbeat('A', 1.0, 3.5), false);
    assert.equal(await djStore.confirmDownbeat('A', 1.0, NaN), false);

    // Deck nunca se confirmó automáticamente a partir de firstBeatTime
    assert.notEqual(djStore.getSnapshot().deckA.track?.downbeat?.status, 'confirmed');
  });

  // 9. Sobrecargas por objeto y métodos auxiliares por deck
  it('9. Soporta llamadas por objeto ({ position, beatsPerBar }) y métodos confirmDownbeatDeckA/clearDownbeatDeckA', async () => {
    const { track, file } = await createTestTrackWithRealHash('helpers.mp3');
    await indexedDBStorage.saveTrack(track, file);
    await djStore.loadTrackToDeck('A', track);

    const okConfirm = await djStore.confirmDownbeatDeckA({ position: 2.5, beatsPerBar: 4 });
    assert.equal(okConfirm, true);
    assert.equal(djStore.getSnapshot().deckA.track?.downbeat?.confirmation?.position, 2.5);

    const okClear = await djStore.clearDownbeatDeckA();
    assert.equal(okClear, true);
    assert.equal(djStore.getSnapshot().deckA.track?.downbeat?.confirmation, null);
  });
});
