/**
 * SYSTEM DJ — Test Suite: Fase 23.4 — Etapa C.5
 * Integración de la Interfaz de BAR SYNC V1 (UI, Estados, Badges y Transporte)
 *
 * Requisitos contractuales auditados:
 * 1. El botón BAR SYNC aparece junto a SYNC y ALIGN en el transporte de ambos decks.
 * 2. El botón invoca la acción correcta para el deck correspondiente ('A' o 'B').
 * 3. Los estados de preparación y rechazo se representan fielmente en UI (idle, preparing, armed, already_aligned, completed, cancelled, rejected_*).
 * 4. No se activa reproducción automática bajo ninguna circunstancia.
 * 5. 'armed', 'already_aligned' y 'completed' no se presentan como equivalentes en etiquetas, clases ni tooltips.
 * 6. La reproducción del Master no completa por error la preparación del Slave.
 * 7. Los controles conservan su comportamiento íntegro cuando BAR SYNC está inactivo o rechazado.
 * 8. Los errores no quedan ocultos ni generan falsas confirmaciones de downbeat ni sincronía.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import { createManualDownbeatConfirmation, createSuggestedDownbeat, isDownbeatConfirmed } from '../src/utils/downbeat.ts';
import type { Track } from '../src/types/track.ts';
import type { DeckId } from '../src/types/deck.ts';
import { getDownbeatTrackFacts } from '../src/services/console/downbeatPanelModel.ts';
import { getDeckBarSyncHint, getDeckNotices, getDeckSyncKeys, type DeckPanelInput, type PanelMessage } from '../src/services/console/deckPanelModel.ts';

/** Entrada del modelo del panel con el estado real del store, como la arma el deck. */
function panelInput(deckName: DeckId, overrides: Partial<DeckPanelInput> = {}): DeckPanelInput {
  const snap = djStore.getSnapshot();
  return {
    deckName,
    deck: deckName === 'A' ? snap.deckA : snap.deckB,
    otherDeck: deckName === 'A' ? snap.deckB : snap.deckA,
    syncMasterDeck: snap.syncMasterDeck,
    seedIndex: -1,
    isTriggeringAnalysis: false,
    isPreparingBarSync: false,
    syncLimitPercent: 8,
    ...overrides,
  };
}

const keyOf = (message: PanelMessage): string => ('key' in message ? message.key : message.text);

const HASH_MASTER = '1111111111111111111111111111111111111111111111111111111111111111';
const HASH_SLAVE = '2222222222222222222222222222222222222222222222222222222222222222';

class MockAudioParam {
  public value: number;
  constructor(val = 1) {
    this.value = val;
  }
  public setValueAtTime(v: number): void {
    this.value = v;
  }
  public cancelScheduledValues(): void {}
  public cancelAndHoldAtTime(): void {}
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

describe('Fase 23.4: Etapa C.5 — UI de BAR SYNC V1', () => {
  let originalAudioContext: unknown;
  let originalWindow: unknown;

  beforeEach(async () => {
    originalAudioContext = (globalThis as unknown as { AudioContext: unknown }).AudioContext;
    originalWindow = (globalThis as unknown as { window: unknown }).window;

    (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
      crypto: globalThis.crypto,
    };

    await audioEngine.initialize();
    djStore.setPitchDeckA(50);
    djStore.setPitchDeckB(50);
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await indexedDBStorage.clearAll();
  });

  afterEach(async () => {
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await audioEngine.dispose();
    await indexedDBStorage.clearAll();
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  // =========================================================================
  // 1. El botón BAR SYNC aparece junto a SYNC y ALIGN
  // =========================================================================
  it('1. El botón BAR SYNC aparece junto a SYNC y ALIGN en el transporte de ambos decks', () => {
    const rowSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/molecules/DeckSyncRow.tsx'), 'utf-8');
    const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/organisms/Deck.tsx'), 'utf-8');
    const keyCss = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/atoms/ConsoleKey.css'), 'utf-8');
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );
    const enJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
    );

    // 1.1 Fila de sincronización: BAR SYNC, ALIGN, SYNC y KEY LOCK, en ese orden, en ambos decks
    assert.ok(deckSource.includes('<DeckSyncRow'), 'El deck debe montar la fila de sincronización');
    const order = ['barSync', 'align', 'sync', 'keyLock'].map((key) => rowSource.indexOf(`renderKey(keys.${key},`));
    assert.ok(order.every((index) => index !== -1), 'Las cuatro teclas se renderizan');
    assert.deepEqual([...order].sort((x, y) => x - y), order, 'Orden BAR SYNC · ALIGN · SYNC · KEY LOCK');
    assert.ok(rowSource.includes('data-testid={`deck-${id}-${name}`}'), 'Cada tecla tiene su data-testid por deck');
    for (const deck of ['A', 'B'] as const) {
      const keys = getDeckSyncKeys(panelInput(deck));
      assert.deepEqual(Object.keys(keys), ['barSync', 'align', 'sync', 'keyLock']);
    }

    // 1.2 Las luces de estado de las teclas existen como tonos del átomo ConsoleKey
    for (const tone of ['amber', 'green', 'red', 'deck']) {
      assert.ok(keyCss.includes(`.console-key--${tone}`), `Falta el tono .console-key--${tone}`);
    }
    assert.ok(keyCss.includes('.console-key.is-filled'), 'SYNC ✓ se rellena con el color del deck');

    // 1.3 Verificar paridad estricta i18n
    const requiredKeys = [
      'bar_sync',
      'bar_sync_tooltip',
      'bar_sync_preparing',
      'bar_sync_armed',
      'bar_sync_already_aligned',
      'bar_sync_completed',
      'bar_sync_cancelled',
      'bar_sync_rejected',
      'bar_sync_notice',
      'bar_sync_armed_badge_tooltip',
      'bar_sync_already_aligned_badge_tooltip',
      'bar_sync_armed_btn_tooltip',
      'bar_sync_aligned_btn_tooltip',
      'bar_sync_time_tooltip',
    ];
    for (const k of requiredKeys) {
      assert.ok(esJson.dj[k], `Falta clave dj.${k} en es/translation.json`);
      assert.ok(enJson.dj[k], `Falta clave dj.${k} en en/translation.json`);
    }
  });

  // =========================================================================
  // 2. El botón invoca la acción correcta para el deck correspondiente
  // =========================================================================
  it('2. El botón invoca la acción correcta para el deck correspondiente (A o B)', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4, 300);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4, 300);

    await djStore.loadTrackToDeckA(masterTrack);
    await djStore.loadTrackToDeckB(slaveTrack);

    // Deck A como Master en reproducción
    await djStore.playDeckA();
    assert.equal(djStore.getSnapshot().deckA.playbackState, 'playing');
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'stopped');

    // Preparar Deck B como Slave
    const planB = djStore.prepareBarSync('B');
    assert.ok(['armed', 'already_aligned'].includes(planB.status), `Plan B debe ser exitoso, obtenido: ${planB.status}`);

    const snapB = djStore.getSnapshot();
    assert.equal(snapB.deckB.barSync.status, planB.status);
    assert.equal(snapB.deckA.barSync.status, 'idle', 'Deck A (Master) debe permanecer con barSync idle');

    // Cancelar la preparación en Deck B mediante cancelBarSync
    djStore.cancelBarSync('B');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'cancelled');
    assert.equal(djStore.getSnapshot().deckA.barSync.status, 'idle');
  });

  // =========================================================================
  // 3. Los estados de preparación y rechazo se representan correctamente
  // =========================================================================
  it('3. Los estados de preparación y rechazo se representan correctamente sin ambigüedad', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4, 300);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4, 300);
    await djStore.loadTrackToDeckA(masterTrack);
    await djStore.loadTrackToDeckB(slaveTrack);

    // 3.1 En reposo no hay aviso de BAR SYNC y la tecla está apagada
    assert.equal(getDeckNotices(panelInput('B')).some((n) => n.id === 'barsync'), false, 'Aviso oculto en idle');
    const idle = getDeckSyncKeys(panelInput('B')).barSync;
    assert.equal(keyOf(idle.label), 'dj.bar_sync');
    assert.equal(idle.light, null);

    // 3.2 ARMADO: tecla ámbar y aviso con las posiciones y el desplazamiento en el tooltip
    await djStore.playDeckA();
    audioEngine.seekDeck('B', 8.2);
    djStore.prepareBarSync('B');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'armed');
    const armedKey = getDeckSyncKeys(panelInput('B')).barSync;
    assert.equal(keyOf(armedKey.label), 'dj.bar_sync_armed');
    assert.equal(armedKey.light, 'amber');
    assert.equal(keyOf(armedKey.tooltip), 'dj.bar_sync_armed_btn_tooltip');
    const armedNotice = getDeckNotices(panelInput('B')).find((n) => n.id === 'barsync');
    assert.ok(armedNotice, 'Aviso visible en armed');
    assert.equal(keyOf(armedNotice.tooltip), 'dj.bar_sync_armed_badge_tooltip');
    const armedValues = 'key' in armedNotice.tooltip ? armedNotice.tooltip.values ?? {} : {};
    assert.ok(typeof armedValues.disp === 'string', 'El tooltip incluye el desplazamiento');
    assert.ok(typeof armedValues.prepared === 'string', 'El tooltip incluye la posición preparada');

    // 3.3 Cancelado: ni ámbar ni verde
    djStore.cancelBarSync('B');
    const cancelledKey = getDeckSyncKeys(panelInput('B')).barSync;
    assert.equal(cancelledKey.light, null);
    assert.equal(keyOf(cancelledKey.tooltip), 'dj.bar_sync_cancelled_tooltip');
    const cancelledNotice = getDeckNotices(panelInput('B')).find((n) => n.id === 'barsync');
    assert.equal(keyOf(cancelledNotice!.tooltip), 'dj.bar_sync_cancelled_tooltip');

    // 3.4 Rechazo: tecla roja, aviso rojo y motivo traducido según el estado
    await djStore.playDeckB();
    djStore.prepareBarSync('B');
    const status = djStore.getSnapshot().deckB.barSync.status;
    assert.ok(status.startsWith('rejected_'), `Debe rechazarse con el Slave sonando (${status})`);
    const rejectedKey = getDeckSyncKeys(panelInput('B')).barSync;
    assert.equal(keyOf(rejectedKey.label), 'dj.bar_sync_rejected');
    assert.equal(rejectedKey.light, 'red');
    assert.equal(keyOf(rejectedKey.tooltip), `dj.bar_sync_reason_${status}`);
    const rejectedNotice = getDeckNotices(panelInput('B')).find((n) => n.id === 'barsync');
    assert.equal(rejectedNotice?.light, 'red');
    assert.equal(keyOf(rejectedNotice!.tooltip), `dj.bar_sync_reason_${status}`);
    const hint = getDeckBarSyncHint(panelInput('B'));
    assert.equal(hint?.rejected, true, 'La guía bajo el deck anuncia el rechazo');
    assert.equal(keyOf(hint!.message), `dj.bar_sync_reason_${status}`);
  });

  // =========================================================================
  // 4. No se activa reproducción automática
  // =========================================================================
  it('4. No se activa reproducción automática bajo ninguna circunstancia', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4, 300);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4, 300);

    await djStore.loadTrackToDeckA(masterTrack);
    await djStore.loadTrackToDeckB(slaveTrack);
    await djStore.playDeckA();

    // Estado previo de Slave: stopped
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'stopped');
    assert.equal(audioEngine.isDeckPlaying('B'), false);

    // Ejecutar BAR SYNC
    const plan = djStore.prepareBarSync('B');
    assert.ok(['armed', 'already_aligned'].includes(plan.status));

    // Verificar que Slave NO arrancó a reproducir automáticamente
    const snap = djStore.getSnapshot();
    assert.equal(snap.deckB.playbackState, 'stopped', 'Slave debe permanecer detenido tras preparar BAR SYNC');
    assert.equal(audioEngine.isDeckPlaying('B'), false, 'El motor de audio no debe reproducir Slave');

    // Lo mismo si Slave estaba en pausa
    await djStore.loadTrackToDeckB(slaveTrack);
    djStore.seekDeck('B', 10.0);
    // Cambiar a pausado
    await djStore.playDeckB();
    await djStore.pauseDeckB();
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'paused');

    djStore.prepareBarSync('B');
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'paused', 'Slave debe permanecer pausado tras preparar BAR SYNC');
    assert.equal(audioEngine.isDeckPlaying('B'), false);
  });

  // =========================================================================
  // 5. 'armed', 'already_aligned' y 'completed' no se presentan como equivalentes
  // =========================================================================
  it('5. armed, already_aligned y completed son estados contractualmente distintos y no equivalentes', () => {
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );

    // 5.1 En el botón, cada estado tiene etiqueta propia y clase CSS distinta
    assert.notEqual(esJson.dj.bar_sync_armed, esJson.dj.bar_sync_already_aligned, 'armed y already_aligned deben tener textos distintos');
    assert.notEqual(esJson.dj.bar_sync_armed, esJson.dj.bar_sync_completed, 'armed y completed deben tener textos distintos');
    assert.notEqual(esJson.dj.bar_sync_already_aligned, esJson.dj.bar_sync_completed, 'already_aligned y completed deben tener textos distintos');

    // 5.2 Cada estado tiene su propia luz: ARMADO ámbar, ALINEADO color del deck, LISTO verde
    const lightFor = (status: 'armed' | 'already_aligned' | 'completed') => {
      const input = panelInput('B');
      const deck = { ...input.deck, track: input.deck.track, barSync: { ...input.deck.barSync, status } };
      return getDeckSyncKeys({ ...input, deck }).barSync;
    };
    assert.equal(lightFor('armed').light, 'amber');
    assert.equal(lightFor('already_aligned').light, 'tone');
    assert.equal(lightFor('completed').light, 'green');
    assert.equal(keyOf(lightFor('completed').label), 'dj.bar_sync_completed');
  });

  // =========================================================================
  // 6. La reproducción del Master no completa por error la preparación del Slave
  // =========================================================================
  it('6. La reproducción del Master no completa por error la preparación del Slave', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4, 300);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4, 300);

    await djStore.loadTrackToDeckA(masterTrack);
    await djStore.loadTrackToDeckB(slaveTrack);

    // Deck A (Master) inicia reproducción
    await djStore.playDeckA();

    // Preparar Deck B como Slave
    const plan = djStore.prepareBarSync('B');
    assert.ok(['armed', 'already_aligned'].includes(plan.status));
    assert.equal(djStore.getSnapshot().deckB.barSync.status, plan.status);

    // Pausar y volver a reproducir el Master Deck A
    await djStore.pauseDeckA();
    await djStore.playDeckA();

    // Deck B NO debe haber pasado a 'completed' por acciones sobre el Master
    assert.equal(
      djStore.getSnapshot().deckB.barSync.status,
      plan.status,
      'Deck B debe conservar su estado de preparación intacto tras cambios de reproducción en Master'
    );

    // Solo al reproducir manualmente Deck B se completa la preparación
    await djStore.playDeckB();
    assert.equal(
      djStore.getSnapshot().deckB.barSync.status,
      'completed',
      'Deck B pasa a completed exclusivamente al reproducirse él mismo'
    );
  });

  // =========================================================================
  // 7. Los controles conservan su comportamiento cuando BAR SYNC está inactivo o rechazado
  // =========================================================================
  it('7. Los controles de transporte conservan su comportamiento cuando BAR SYNC está inactivo o rechazado', async () => {
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4, 300);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4, 300);

    await indexedDBStorage.saveTrack(masterTrack, createTestAudioFile('master.mp3'));
    await indexedDBStorage.saveTrack(slaveTrack, createTestAudioFile('slave.mp3'));
    await djStore.loadTrackToDeckA(masterTrack);
    await djStore.loadTrackToDeckB(slaveTrack);

    // 7.1 BAR SYNC inactivo: transporte normal
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'idle');
    await djStore.playDeckB();
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'playing');
    await djStore.pauseDeckB();
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'paused');
    djStore.stopDeck('B');
    assert.equal(djStore.getSnapshot().deckB.playbackState, 'stopped');

    // 7.2 Forzar un rechazo (ej. preparar mientras Master está detenido)
    const rejectPlan = djStore.prepareBarSync('B');
    assert.equal(rejectPlan.status, 'rejected_state');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'rejected_state');

    // Verificar que los controles siguen funcionando con normalidad tras el rechazo
    djStore.setPitchDeck('B', 75);
    assert.equal(djStore.getSnapshot().deckB.pitch, 75);

    djStore.seekDeck('B', 30.0);
    assert.equal(djStore.getSnapshot().deckB.currentTime, 30.0);

    // Hot cues funcionan normalmente
    await djStore.setHotCue('B', 1, 15.0);
    assert.equal(djStore.getSnapshot().deckB.hotCues.find((c) => c.id === 1)?.position, 15.0);

    djStore.jumpToHotCue('B', 1);
    assert.equal(djStore.getSnapshot().deckB.currentTime, 15.0);
  });

  // =========================================================================
  // 8. Los errores no quedan ocultos ni generan falsas confirmaciones
  // =========================================================================
  it('8. Los errores no quedan ocultos ni muestran falsas confirmaciones de downbeat', async () => {
    // 8.1 El LED CONFIRMADO del módulo DOWNBEAT & COMPÁS exige confirmación manual ligada a la huella actual
    const trackDegraded = createConfiguredTrack('degraded.mp3', 120, HASH_MASTER, 1.0, 4, 300);
    assert.ok(getDownbeatTrackFacts(trackDegraded).confirmed, 'Confirmación con huella coincidente: CONFIRMADO');
    trackDegraded.fileMeta = { ...trackDegraded.fileMeta, contentHash: HASH_SLAVE };
    assert.equal(
      getDownbeatTrackFacts(trackDegraded).confirmed,
      null,
      'Si la huella del archivo cambia, la confirmación queda degradada y CONFIRMADO se apaga'
    );

    // 8.2 Pista con downbeat sugerido no confirmado: no debe validar
    const fileUnconfirmed = createTestAudioFile('suggested.mp3');
    const trackUnconfirmed = createTrackFromFile(fileUnconfirmed, 200);
    trackUnconfirmed.fileMeta = { ...trackUnconfirmed.fileMeta, contentHash: HASH_SLAVE };
    trackUnconfirmed.analysis = {
      status: 'analyzed',
      bpm: 120,
      bpmConfidence: 0.95,
      key: '8B',
      camelot: '8B',
      energy: 7.0,
      firstBeatTime: 1.0,
    };
    trackUnconfirmed.downbeat = createSuggestedDownbeat({
      position: 1.0,
      confidence: 0.9,
      beatsPerBar: 4,
    });

    const isConfirmed = isDownbeatConfirmed(trackUnconfirmed.downbeat, trackUnconfirmed.fileMeta?.contentHash);
    assert.equal(isConfirmed, false, 'Una sugerencia de downbeat no confirmada manualmente no debe ser válida');

    // 8.3 Intento de BAR SYNC con pista no confirmada: rechazo explícito con razón legible
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4, 300);
    await djStore.loadTrackToDeckA(masterTrack);
    await djStore.loadTrackToDeckB(trackUnconfirmed);
    await djStore.playDeckA();

    const plan = djStore.prepareBarSync('B');
    assert.equal(plan.status, 'rejected_unconfirmed');
    assert.ok(
      plan.reason?.includes('Slave no dispone de un downbeat confirmado manualmente') ||
      plan.reason?.includes('Slave downbeat must be explicitly confirmed'),
      `Razón inesperada: ${plan.reason}`
    );

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckB.barSync.status, 'rejected_unconfirmed');
    assert.equal(snap.deckB.barSync.reason, plan.reason);

    // 8.4 La razón no queda oculta: aviso RECHAZADO con el motivo y guía bajo el deck
    const notice = getDeckNotices(panelInput('B')).find((n) => n.id === 'barsync');
    assert.ok(notice, 'El aviso de BAR SYNC se muestra tras el rechazo');
    assert.equal(keyOf(notice.tooltip), 'dj.bar_sync_reason_rejected_unconfirmed');
    assert.equal(keyOf(getDeckBarSyncHint(panelInput('B'))!.message), 'dj.bar_sync_reason_rejected_unconfirmed');
  });

  // =========================================================================
  // 9. Feedback visual de desplazamiento, tooltips y tiempo de alta precisión
  // =========================================================================
  it('9. El feedback visual incluye desplazamiento (Δ), tooltips multilingües y tiempo de alta precisión', async () => {
    const deckSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/organisms/Deck.tsx'),
      'utf-8'
    );
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );
    const enJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
    );

    // 9.1 El aviso dice BAR SYNC y su estado; posición y desplazamiento Δ van en su tooltip
    assert.ok(esJson.dj.bar_sync_notice.includes('{{state}}'));
    assert.ok(enJson.dj.bar_sync_notice.includes('{{state}}'));
    assert.ok(esJson.dj.bar_sync_already_aligned_badge_tooltip.includes('Δ {{disp}}'));
    assert.ok(enJson.dj.bar_sync_already_aligned_badge_tooltip.includes('Δ {{disp}}'));

    // 9.2 El tiempo vive en la pantalla digital: data-testid y tooltip con precisión de milisegundos
    const techSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/molecules/ScreenTechInfo.tsx'),
      'utf-8'
    );
    assert.ok(
      techSource.includes('data-testid={`screen-tech-${id}-${column}`}'),
      'Cada valor técnico (incluido el tiempo) debe tener data-testid para comprobación en UI'
    );
    assert.ok(
      techSource.includes("t('dj.bar_sync_time_tooltip'"),
      'Item de tiempo debe invocar la traducción de precisión de tiempo'
    );
    assert.ok(
      techSource.includes('deck.currentTime.toFixed(3)'),
      'El tooltip de tiempo debe incluir currentTime con 3 decimales (milisegundos)'
    );

    // 9.3 Comprobar contenido y variables en las plantillas i18n
    const tooltipKeys = [
      'bar_sync_armed_badge_tooltip',
      'bar_sync_already_aligned_badge_tooltip',
      'bar_sync_armed_btn_tooltip',
      'bar_sync_aligned_btn_tooltip',
      'bar_sync_time_tooltip',
      'bar_sync_notice',
      'bar_sync_reason_rejected_state',
      'bar_sync_reason_rejected_unconfirmed',
      'bar_sync_reason_rejected_no_downbeat',
      'bar_sync_reason_rejected_metric_mismatch',
      'bar_sync_reason_rejected_limits',
      'bar_sync_reason_rejected_confidence',
      'bar_sync_reason_generic',
    ];
    for (const key of tooltipKeys) {
      assert.ok(esJson.dj[key], `Clave es.dj.${key} debe existir`);
      assert.ok(enJson.dj[key], `Clave en.dj.${key} debe existir`);
    }

    // Verificar que los tooltips de armed contienen variables para posiciones y desplazamiento
    assert.ok(esJson.dj.bar_sync_armed_badge_tooltip.includes('{{prepared}}'));
    assert.ok(esJson.dj.bar_sync_armed_badge_tooltip.includes('{{prev}}'));
    assert.ok(esJson.dj.bar_sync_armed_badge_tooltip.includes('{{disp}}'));
    assert.ok(enJson.dj.bar_sync_armed_badge_tooltip.includes('{{prepared}}'));
    assert.ok(enJson.dj.bar_sync_armed_badge_tooltip.includes('{{prev}}'));
    assert.ok(enJson.dj.bar_sync_armed_badge_tooltip.includes('{{disp}}'));
    assert.equal(esJson.dj.bar_sync_armed, 'ARMADO');
    assert.equal(esJson.dj.bar_sync_already_aligned, 'ALINEADO');
    assert.equal(esJson.dj.bar_sync_completed, 'LISTO');
    assert.equal(esJson.dj.bar_sync_rejected, 'RECHAZADO');

    // 9.4 Cancelación interactiva: pulsar BAR SYNC cuando está armed o aligned cancela el estado
    const masterTrack = createConfiguredTrack('master.mp3', 120, HASH_MASTER, 1.0, 4, 300);
    const slaveTrack = createConfiguredTrack('slave.mp3', 120, HASH_SLAVE, 0.5, 4, 300);

    await djStore.loadTrackToDeckA(masterTrack);
    await djStore.loadTrackToDeckB(slaveTrack);
    await djStore.playDeckA();

    // Preparar B
    audioEngine.seekDeck('B', 8.2);
    djStore.prepareBarSync('B');
    assert.equal(djStore.getSnapshot().deckB.barSync.status, 'armed');

    // Simular clic en BAR SYNC mientras está armed (llama a cancelBarSync)
    assert.ok(deckSource.includes('if (isBarSyncArmed || isBarSyncAligned) {'));
    assert.ok(deckSource.includes('cancelBarSync(deckName);'));

    djStore.cancelBarSync('B');
    const cancelled = djStore.getSnapshot().deckB.barSync;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.preparedPosition, null);
    assert.equal(cancelled.previousPosition, null);
    assert.equal(cancelled.displacementSec, null);
  });

  // =========================================================================
  // 10. Tooltips visuales CSS en BAR SYNC badge e indicador de tiempo (Fase 23.4)
  // =========================================================================
  it('10. Tooltips visuales CSS en BAR SYNC badge e indicador de tiempo', async () => {
    const deckSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/organisms/Deck.tsx'),
      'utf-8'
    );

    // 10.1 Avisos del deck (BAR SYNC incluido): tooltip propio, nota accesible y enfocable por teclado
    assert.ok(deckSource.includes('<DeckNoticeStrip'), 'El deck monta la franja de avisos');
    const badgeSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/atoms/ConsoleBadge.tsx'), 'utf-8');
    assert.ok(badgeSource.includes('data-tooltip={tooltip}'), 'El aviso dispone de data-tooltip para renderizado CSS');
    assert.ok(badgeSource.includes('aria-description={tooltip}'), 'El tooltip forma parte de la descripción accesible');
    assert.ok(badgeSource.includes('role="note"'), 'Elementos con tooltip definen role="note"');
    assert.ok(badgeSource.includes('tabIndex={0}'), 'Elementos con tooltip son accesibles vía teclado (tabIndex=0)');

    // 10.2 Indicador de tiempo: ahora en la pantalla digital, con el tooltip de precisión como title
    const techSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/molecules/ScreenTechInfo.tsx'),
      'utf-8'
    );
    assert.ok(techSource.includes("title={column === 'time' ? timeTooltip : undefined}"), 'Tiempo conserva atributo title nativo');

    // 10.3 Reglas CSS para tooltips: pseudo-elementos ::after, hover, focus-visible y z-index
    const badgeCss = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/atoms/ConsoleBadge.css'), 'utf-8');
    assert.ok(badgeCss.includes('.console-badge[data-tooltip]:not([data-tooltip=""])::after'), 'Pseudo-elemento ::after con data-tooltip');
    assert.ok(badgeCss.includes('content: attr(data-tooltip);'), 'Contenido mediante attr(data-tooltip)');
    assert.ok(badgeCss.includes('.console-badge[data-tooltip]:not([data-tooltip=""]):hover::after'), 'Tooltip al hover');
    assert.ok(badgeCss.includes('.console-badge[data-tooltip]:not([data-tooltip=""]):focus-visible::after'), 'Tooltip en foco de teclado focus-visible');
    assert.ok(badgeCss.includes('position: relative;'), 'El aviso es el contenedor del tooltip');
    assert.ok(badgeCss.includes('z-index: 1000;'), 'Tooltip por encima del resto de la consola');
  });
});
