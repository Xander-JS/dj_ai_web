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
    const deckSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'),
      'utf-8'
    );
    const cssSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.css'),
      'utf-8'
    );
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );
    const enJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
    );

    // 1.1 Verificar existencia y orden en el contenedor de transporte
    assert.ok(deckSource.includes('className="deck-transport"'), 'Debe existir el contenedor deck-transport');
    assert.ok(deckSource.includes('data-testid={`deck-${deckName.toLowerCase()}-sync`}'), 'Debe existir deck-sync');
    assert.ok(deckSource.includes('data-testid={`deck-${deckName.toLowerCase()}-align`}'), 'Debe existir deck-align');
    assert.ok(deckSource.includes('data-testid={`deck-${deckName.toLowerCase()}-barsync`}'), 'Debe existir deck-barsync');

    // 1.2 Verificar estilos CSS del botón BAR SYNC
    assert.ok(cssSource.includes('.btn-dj-barsync'), 'Debe existir la regla CSS .btn-dj-barsync');
    assert.ok(cssSource.includes('.barsync-armed'), 'Debe existir .barsync-armed en Deck.css');
    assert.ok(cssSource.includes('.barsync-aligned'), 'Debe existir .barsync-aligned en Deck.css');
    assert.ok(cssSource.includes('.barsync-completed'), 'Debe existir .barsync-completed en Deck.css');
    assert.ok(cssSource.includes('.barsync-rejected'), 'Debe existir .barsync-rejected en Deck.css');

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
      'bar_sync_badge_downbeat',
      'bar_sync_badge_downbeat_title',
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
    const deckSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'),
      'utf-8'
    );

    // 3.1 Badge solo se renderiza cuando status no es idle
    assert.ok(deckSource.includes("barSync && barSync.status !== 'idle'"), 'Badge debe ocultarse en estado idle');

    // 3.2 Representación de armed
    assert.ok(deckSource.includes("barSync.status === 'armed'"), 'Debe comprobar status armed');
    assert.ok(deckSource.includes("BAR ARMED ("), 'Texto de badge armed');
    assert.ok(deckSource.includes("Δ ${formatDeltaSeconds(barSync.displacementSec)}"), 'Badge armed incluye desplazamiento');
    assert.ok(deckSource.includes("t('dj.bar_sync_armed_badge_tooltip'"), 'Badge armed usa tooltip i18n con posiciones');
    assert.ok(deckSource.includes("t('dj.bar_sync_armed_btn_tooltip'"), 'Botón armed usa tooltip i18n');
    assert.ok(deckSource.includes("t('dj.bar_sync_armed', 'ARMED')"), 'Etiqueta de botón armed');

    // 3.3 Representación de already_aligned
    assert.ok(deckSource.includes("barSync.status === 'already_aligned'"), 'Debe comprobar status already_aligned');
    assert.ok(deckSource.includes("BAR ALIGNED ("), 'Texto de badge already_aligned');
    assert.ok(deckSource.includes("t('dj.bar_sync_already_aligned_badge_tooltip'"), 'Badge already_aligned usa tooltip i18n');
    assert.ok(deckSource.includes("t('dj.bar_sync_aligned_btn_tooltip'"), 'Botón already_aligned usa tooltip i18n');
    assert.ok(deckSource.includes("t('dj.bar_sync_already_aligned', 'ALIGNED')"), 'Etiqueta de botón already_aligned');

    // 3.4 Representación de completed
    assert.ok(deckSource.includes("barSync.status === 'completed'"), 'Debe comprobar status completed');
    assert.ok(deckSource.includes("'BAR COMPLETED'"), 'Texto de badge completed');
    assert.ok(deckSource.includes("t('dj.bar_sync_completed', 'DONE')"), 'Etiqueta de botón completed');

    // 3.5 Representación de cancelled
    assert.ok(deckSource.includes("barSync.status === 'cancelled'"), 'Debe comprobar status cancelled');
    assert.ok(deckSource.includes("'BAR CANCELLED'"), 'Texto de badge cancelled');

    // 3.6 Representación de rejected_*
    assert.ok(deckSource.includes("barSyncStatus?.startsWith('rejected_')"), 'Debe detectar prefijo rejected_');
    assert.ok(deckSource.includes("`BAR REJECTED: ${barSync.reason || barSync.status}`"), 'Texto de badge rejected');
    assert.ok(deckSource.includes("t('dj.bar_sync_rejected', 'REJECT')"), 'Etiqueta de botón rejected');
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
    const deckSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'),
      'utf-8'
    );
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );

    // 5.1 En el botón, cada estado tiene etiqueta propia y clase CSS distinta
    assert.notEqual(esJson.dj.bar_sync_armed, esJson.dj.bar_sync_already_aligned, 'armed y already_aligned deben tener textos distintos');
    assert.notEqual(esJson.dj.bar_sync_armed, esJson.dj.bar_sync_completed, 'armed y completed deben tener textos distintos');
    assert.notEqual(esJson.dj.bar_sync_already_aligned, esJson.dj.bar_sync_completed, 'already_aligned y completed deben tener textos distintos');

    // 5.2 Clases CSS diferenciadas
    assert.ok(deckSource.includes("isBarSyncArmed && 'barsync-armed'"), 'Clase barsync-armed');
    assert.ok(deckSource.includes("isBarSyncAligned && 'barsync-aligned'"), 'Clase barsync-aligned');
    assert.ok(deckSource.includes("barSyncStatus === 'completed' && 'barsync-completed'"), 'Clase barsync-completed');

    // 5.3 Badges diferenciados
    assert.ok(deckSource.includes("`barsync-badge-${barSync.status}`"), 'Badges con clases de estado específicas');
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
    const deckSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'),
      'utf-8'
    );

    // 8.1 Verificar que el badge de DOWNBEAT requiere validación estricta de hash y confirmación manual
    assert.ok(
      deckSource.includes('isDownbeatConfirmed(track?.downbeat, track?.fileMeta?.contentHash)'),
      'Deck.tsx debe validar el downbeat con isDownbeatConfirmed antes de mostrar el badge'
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

    // 8.4 En Deck.tsx, la razón no queda oculta y se muestra en el badge y en el tooltip
    assert.ok(deckSource.includes('`BAR REJECTED: ${barSync.reason || barSync.status}`'));
    assert.ok(deckSource.includes('barSync.reason || \'Preparación de compás rechazada\''));
  });

  // =========================================================================
  // 9. Feedback visual de desplazamiento, tooltips y tiempo de alta precisión
  // =========================================================================
  it('9. El feedback visual incluye desplazamiento (Δ), tooltips multilingües y tiempo de alta precisión', async () => {
    const deckSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'),
      'utf-8'
    );
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );
    const enJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
    );

    // 9.1 Verificar que el badge formatea el desplazamiento con el símbolo Δ
    assert.ok(
      deckSource.includes('`BAR ARMED (${barSync.preparedPosition?.toFixed(2)}s, Δ ${formatDeltaSeconds(barSync.displacementSec)})`'),
      'Badge ARMED debe incluir posición y desplazamiento con Δ'
    );
    assert.ok(
      deckSource.includes('`BAR ALIGNED (${barSync.preparedPosition?.toFixed(2)}s, Δ ${formatDeltaSeconds(barSync.displacementSec)})`'),
      'Badge ALIGNED debe incluir posición y desplazamiento con Δ'
    );

    // 9.2 Verificar que el item de tiempo dispone de data-testid y tooltip con precisión de milisegundos
    assert.ok(
      deckSource.includes('data-testid={`deck-${deckName.toLowerCase()}-time`}'),
      'Item de tiempo debe tener data-testid para comprobación en UI'
    );
    assert.ok(
      deckSource.includes("t('dj.bar_sync_time_tooltip'"),
      'Item de tiempo debe invocar la traducción de precisión de tiempo'
    );
    assert.ok(
      deckSource.includes('currentTime.toFixed(3)'),
      'El tooltip de tiempo debe incluir currentTime con 3 decimales (milisegundos)'
    );

    // 9.3 Comprobar contenido y variables en las plantillas i18n
    const tooltipKeys = [
      'bar_sync_armed_badge_tooltip',
      'bar_sync_already_aligned_badge_tooltip',
      'bar_sync_armed_btn_tooltip',
      'bar_sync_aligned_btn_tooltip',
      'bar_sync_time_tooltip',
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
      path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'),
      'utf-8'
    );
    const cssSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.css'),
      'utf-8'
    );

    // 10.1 BAR SYNC Badge: preserva title y añade data-tooltip, deck-tooltip-trigger y accesibilidad
    assert.ok(deckSource.includes("title={barSyncBadgeTooltip}"), 'Badge conserva atributo title nativo');
    assert.ok(deckSource.includes("data-tooltip={barSyncBadgeTooltip}"), 'Badge dispone de data-tooltip para renderizado CSS');
    assert.ok(deckSource.includes("'deck-tooltip-trigger'"), 'Badge incluye clase deck-tooltip-trigger');
    assert.ok(deckSource.includes('role="note"'), 'Elementos con tooltip definen role="note"');
    assert.ok(deckSource.includes('tabIndex={0}'), 'Elementos con tooltip son accesibles vía teclado (tabIndex=0)');

    // 10.2 Indicador de tiempo: preserva title y añade data-tooltip, deck-stat-time y deck-tooltip-trigger
    assert.ok(deckSource.includes("title={timeStatTooltip}"), 'Tiempo conserva atributo title nativo');
    assert.ok(deckSource.includes("data-tooltip={timeStatTooltip}"), 'Tiempo dispone de data-tooltip para renderizado CSS');
    assert.ok(deckSource.includes('className="deck-stat-item deck-stat-time deck-tooltip-trigger"'), 'Tiempo incluye deck-stat-time y deck-tooltip-trigger');

    // 10.3 Reglas CSS para tooltips: pseudo-elementos ::after, hover, focus-visible y z-index
    assert.ok(cssSource.includes('.deck-tooltip-trigger {'), 'Deck.css define .deck-tooltip-trigger');
    assert.ok(cssSource.includes('.deck-tooltip-trigger[data-tooltip]:not([data-tooltip=""])::after'), 'Deck.css define pseudo-elemento ::after con data-tooltip');
    assert.ok(cssSource.includes('content: attr(data-tooltip);'), 'Deck.css extrae contenido mediante attr(data-tooltip)');
    assert.ok(cssSource.includes('.deck-tooltip-trigger[data-tooltip]:not([data-tooltip=""]):hover::after'), 'Deck.css activa tooltip al hover');
    assert.ok(cssSource.includes('.deck-tooltip-trigger[data-tooltip]:not([data-tooltip=""]):focus-visible::after'), 'Deck.css activa tooltip en foco de teclado focus-visible');
    assert.ok(cssSource.includes('.deck-stat-time[data-tooltip]::after'), 'Deck.css alinea el tooltip de tiempo a la derecha');
    assert.ok(cssSource.includes('position: relative;'), 'Deck.css establece position: relative en contenedor');
    assert.ok(cssSource.includes('z-index: 1000;'), 'Deck.css asigna z-index elevado a los tooltips');
    assert.ok(cssSource.includes('z-index: 25;'), 'Deck.css asigna contexto de apilamiento a deck-header');
  });
});
