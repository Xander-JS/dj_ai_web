/**
 * SYSTEM DJ — Test Suite: Fase 23.4 — Etapa C.8.2
 * Interfaz Manual y Bilingüe de Downbeat & Compás (módulo de las secciones 5 / 6)
 *
 * Requisitos contractuales auditados:
 * 1. Estados visualizados: Sin confirmar, Sugerido (no confirmado) y Confirmado (manual).
 * 2. Acciones del editor: Usar posición sugerida sin confirmar, capturar cabezal, ajuste manual, métrica 4/4 y 3/4.
 * 3. Botón explícito de confirmación (confirmDownbeat) y botón de limpieza (clearDownbeat).
 * 4. Pista sin contentHash válido: botón deshabilitado, explicación clara y rechazo seguro.
 * 5. Manejo de errores de persistencia sin presentar confirmación fallida como exitosa.
 * 6. Prevención de dobles envíos durante operaciones asíncronas.
 * 7. Limpieza inmediata del editor al cambiar de pista (no conserva posición de la pista previa).
 * 8. Paridad estricta i18n (español e inglés) y estilos CSS obligatorios.
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
import { computeFileHash } from '../src/utils/cryptoHash.ts';
import {
  createManualDownbeatConfirmation,
  createSuggestedDownbeat,
  isDownbeatConfirmed,
} from '../src/utils/downbeat.ts';
import {
  METER_DETENTS,
  buildConfirmParams,
  getClearButton,
  getConfirmButton,
  getDownbeatTrackFacts,
  getInitialSelection,
  getStatusLeds,
  hasPendingChange,
  selectSource,
} from '../src/services/console/downbeatPanelModel.ts';
import type { Track } from '../src/types/track.ts';

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

function createTestAudioFile(name = 'track.mp3', content = 'pcm-data'): File {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);
  return new File([bytes], name, { type: 'audio/mpeg' });
}

async function createTrackWithRealHash(
  name: string,
  duration = 300.0,
  content = `data-${Date.now()}`
): Promise<{ track: Track; file: File; hash: string }> {
  const file = createTestAudioFile(name, content);
  const hash = await computeFileHash(file);
  const track = createTrackFromFile(file, duration);
  track.fileMeta = {
    ...track.fileMeta,
    contentHash: hash,
  };
  return { track, file, hash };
}

describe('Fase 23.4: Etapa C.8.2 — Interfaz Manual de Downbeat en los Decks', () => {
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

  const factsOf = (deckId: 'A' | 'B') => {
    const deck = deckId === 'A' ? djStore.getSnapshot().deckA : djStore.getSnapshot().deckB;
    return getDownbeatTrackFacts(deck.track, deck.duration);
  };

  // =========================================================================
  // 1. Estados del módulo DOWNBEAT & COMPÁS al cargar una pista real
  // =========================================================================
  describe('1. Estados visualizados con los LEDs: Sin confirmar, Sugerido y Confirmado', () => {
    it('1.1 Pista sin análisis ni confirmación: knob en OFF y solo SIN CONFIRMAR encendido', async () => {
      const { track, file } = await createTrackWithRealHash('none.mp3');
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const facts = factsOf('A');
      assert.equal(facts.suggestedPosition, null, 'No debe haber posición sugerida para pista sin análisis');
      assert.equal(facts.confirmed, null);
      const selection = getInitialSelection(facts);
      assert.equal(selection.source, 'off');
      assert.deepEqual(getStatusLeds(facts, selection), { unconfirmed: true, playhead: false, suggested: false, confirmed: false });
    });

    it('1.2 Pista con sugerencia algorítmica: el knob arranca en OFF y la sugerencia nunca es CONFIRMADO', async () => {
      const { track, file } = await createTrackWithRealHash('suggested.mp3');
      track.analysis = { status: 'analyzed', bpm: 124.0, bpmConfidence: 0.95, firstBeatTime: 1.25 };
      track.downbeat = createSuggestedDownbeat(1.25);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const deck = djStore.getSnapshot().deckA;
      assert.equal(
        isDownbeatConfirmed(deck.track?.downbeat, deck.track?.fileMeta?.contentHash),
        false,
        'Una sugerencia algorítmica nunca equivale a una confirmación humana'
      );
      const facts = factsOf('A');
      assert.equal(facts.suggestedPosition, 1.25);
      const selection = getInitialSelection(facts);
      assert.deepEqual(selection, { source: 'off', candidate: null, meterIndex: 0 });
      assert.deepEqual(getStatusLeds(facts, selectSource(facts, selection, 'suggested', 0)!), { unconfirmed: false, playhead: false, suggested: true, confirmed: false });
    });

    it('1.3 Pista confirmada manualmente: CONFIRMADO + LED de la fuente, métrica confirmada en el fader', async () => {
      const { track, file, hash } = await createTrackWithRealHash('confirmed.mp3');
      track.analysis = { status: 'analyzed', bpm: 128.0, firstBeatTime: 0.5 };
      track.downbeat = createManualDownbeatConfirmation({ position: 0.5, beatsPerBar: 3, contentHash: hash });
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const facts = factsOf('A');
      assert.equal(facts.confirmed?.position, 0.5);
      assert.equal(facts.confirmed?.beatsPerBar, 3);
      // Confirmación anterior al módulo, sin origen guardado: coincide con la sugerencia → SUG
      assert.equal(facts.confirmed?.origin, 'suggested');
      const selection = getInitialSelection(facts);
      assert.equal(selection.source, 'off');
      assert.equal(selection.meterIndex, 1, '3 pulsos → posición 3/4 del fader');
      assert.deepEqual(getStatusLeds(facts, selection), { unconfirmed: false, playhead: false, suggested: true, confirmed: true });
      assert.equal(facts.noteValueMissing, true, 'Sin unidad de nota confirmada se enciende el aviso ámbar');
    });
  });

  // =========================================================================
  // 2. Fuente, métrica, confirmación y limpieza
  // =========================================================================
  describe('2. Knob de fuente, fader de métrica, CONFIRMAR y LIMPIAR', () => {
    it('2.1 Girar a SUG toma la posición del análisis sin confirmarla', async () => {
      const { track, file } = await createTrackWithRealHash('startpoint.mp3');
      track.analysis = { status: 'analyzed', bpm: 120, firstBeatTime: 2.125 };
      track.downbeat = createSuggestedDownbeat(2.125);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const facts = factsOf('A');
      const off = { source: 'off' as const, candidate: null, meterIndex: 0 };
      const turned = selectSource(facts, off, 'suggested', 0);
      assert.deepEqual(turned, { source: 'suggested', candidate: 2.125, meterIndex: 0 });

      const deck = djStore.getSnapshot().deckA;
      assert.equal(isDownbeatConfirmed(deck.track?.downbeat, deck.track?.fileMeta?.contentHash), false);
    });

    it('2.2 Girar a CAB captura el cabezal en ese instante, sin confirmarlo', async () => {
      const { track, file } = await createTrackWithRealHash('playhead.mp3');
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);
      djStore.seekDeckA(15.75);

      const deck = djStore.getSnapshot().deckA;
      assert.equal(deck.currentTime, 15.75);
      const facts = factsOf('A');
      const turned = selectSource(facts, getInitialSelection(facts), 'playhead', deck.currentTime);
      assert.equal(turned?.candidate, 15.75);
      assert.equal(isDownbeatConfirmed(deck.track?.downbeat, deck.track?.fileMeta?.contentHash), false);
    });

    it('2.3 El fader de métrica ofrece 4/4, 3/4, 2/4 y 6/8, con 4/4 como valor inicial', () => {
      assert.deepEqual(
        METER_DETENTS.map((d) => `${d.beatsPerBar}/${d.beatUnit}`),
        ['4/4', '3/4', '2/4', '6/8'],
      );
      assert.equal(getInitialSelection(getDownbeatTrackFacts(null)).meterIndex, 0);
    });

    it('2.4 CONFIRMAR guarda posición, métrica, unidad y fuente en el store y en IndexedDB', async () => {
      const { track, file, hash } = await createTrackWithRealHash('confirm_flow.mp3');
      track.analysis = { status: 'analyzed', bpm: 125.0, firstBeatTime: 1.0 };
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);
      djStore.seekDeckA(1.5004);

      const facts = factsOf('A');
      const selection = { ...selectSource(facts, getInitialSelection(facts), 'playhead', 1.5004)!, meterIndex: 1 };
      const params = buildConfirmParams(facts, selection);
      assert.deepEqual(params, { position: 1.5, beatsPerBar: 3, beatUnit: 4, suggestedPosition: 1.0, origin: 'playhead' });

      assert.equal(await djStore.confirmDownbeat('A', params!), true, 'confirmDownbeat debe reportar éxito');

      const deckSnap = djStore.getSnapshot().deckA;
      assert.equal(deckSnap.track?.downbeat?.status, 'confirmed');
      assert.equal(deckSnap.track?.downbeat?.confirmation?.position, 1.5);
      assert.equal(deckSnap.track?.downbeat?.confirmation?.beatsPerBar, 3);
      assert.equal(deckSnap.track?.downbeat?.confirmation?.contentHash, hash);
      assert.equal(deckSnap.track?.downbeat?.confirmation?.origin, 'playhead');

      const persistedTrack = await indexedDBStorage.getTrack(track.id);
      assert.equal(persistedTrack?.downbeat?.status, 'confirmed');
      assert.equal(persistedTrack?.downbeat?.confirmation?.position, 1.5);
      assert.equal(persistedTrack?.downbeat?.confirmation?.origin, 'playhead');

      // Tras confirmar: CONFIRMADO + CABEZAL, y el LED de cambio pendiente apagado (knob en CAB, congelado)
      const after = factsOf('A');
      const synced = { ...selection, candidate: after.confirmed!.position };
      assert.deepEqual(getStatusLeds(after, synced), { unconfirmed: false, playhead: true, suggested: false, confirmed: true });
      assert.equal(hasPendingChange(after, synced), false);
    });

    it('2.4b Confirmar con unidad de nota la persiste como beatUnit manual y limpiar la elimina', async () => {
      const { track, file } = await createTrackWithRealHash('confirm_beat_unit.mp3');
      track.analysis = { status: 'analyzed', bpm: 124.0, firstBeatTime: 0.5 };
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      assert.equal(await djStore.confirmDownbeat('A', { position: 0.5, beatsPerBar: 6, beatUnit: 8 }), true);
      const confirmedUnit = { value: 8, status: 'confirmed', source: 'manual' };
      assert.deepEqual(djStore.getSnapshot().deckA.track?.analysis.beatUnit, confirmedUnit);
      assert.deepEqual((await indexedDBStorage.getTrackAnalysis(track.id))?.beatUnit, confirmedUnit);
      assert.equal(djStore.getSnapshot().deckA.track?.analysis.bpm, 124.0, 'El resto del análisis se conserva');
      assert.equal(getInitialSelection(factsOf('A')).meterIndex, 3, 'El fader vuelve a 6/8 al recargar el módulo');

      assert.equal(await djStore.clearDownbeat('A'), true);
      assert.equal(djStore.getSnapshot().deckA.track?.analysis.beatUnit, undefined);
      assert.equal((await indexedDBStorage.getTrackAnalysis(track.id))?.beatUnit, undefined);
    });

    it('2.5 LIMPIAR invoca clearDownbeat, revierte al estado sugerido y los LEDs vuelven a seguir al knob', async () => {
      const { track, file, hash } = await createTrackWithRealHash('clear_flow.mp3');
      track.analysis = { status: 'analyzed', bpm: 120.0, firstBeatTime: 0.8 };
      track.downbeat = createManualDownbeatConfirmation({
        position: 1.2,
        beatsPerBar: 4,
        contentHash: hash,
        suggestedPosition: 0.8,
        origin: 'playhead',
      });
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const before = factsOf('A');
      assert.equal(getClearButton(before, { saving: false, unavailable: false }).disabled, false);
      const selection = selectSource(before, getInitialSelection(before), 'playhead', 1.2)!;

      assert.equal(await djStore.clearDownbeat('A'), true, 'clearDownbeat debe reportar éxito');

      const clearedSnap = djStore.getSnapshot().deckA;
      assert.equal(clearedSnap.track?.downbeat?.status, 'suggested');
      assert.equal(clearedSnap.track?.downbeat?.confirmation, null);
      assert.equal(clearedSnap.track?.downbeat?.suggestedPosition, 0.8);
      assert.equal(isDownbeatConfirmed(clearedSnap.track?.downbeat, hash), false);

      const after = factsOf('A');
      assert.deepEqual(getStatusLeds(after, selection), { unconfirmed: false, playhead: true, suggested: false, confirmed: false });
      assert.equal(hasPendingChange(after, selection), true, 'Lo elegido ya no está confirmado: el LED de CONFIRMAR parpadea');
      assert.equal(getClearButton(after, { saving: false, unavailable: false }).disabled, true);

      const persisted = await indexedDBStorage.getTrack(track.id);
      assert.equal(persisted?.downbeat?.status, 'suggested');
      assert.equal(persisted?.downbeat?.confirmation, null);
    });

    it('2.6 Confirmar en un deck actualiza el módulo del otro deck si tiene la misma pista', async () => {
      const { track, file } = await createTrackWithRealHash('both_decks.mp3');
      track.analysis = { status: 'analyzed', bpm: 126.0, firstBeatTime: 0.75 };
      track.downbeat = createSuggestedDownbeat(0.75);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);
      await djStore.loadTrackToDeckB(track);

      const factsA = factsOf('A');
      const params = buildConfirmParams(factsA, selectSource(factsA, getInitialSelection(factsA), 'suggested', 0)!);
      assert.equal(await djStore.confirmDownbeat('A', params!), true);

      const factsB = factsOf('B');
      assert.equal(factsB.confirmed?.origin, 'suggested');
      assert.deepEqual(getStatusLeds(factsB, getInitialSelection(factsB)), { unconfirmed: false, playhead: false, suggested: true, confirmed: true });
    });
  });

  // =========================================================================
  // 3. Validación de Identidad y Seguridad
  // =========================================================================
  describe('3. Seguridad de Identidad, Hash y Gestión de Errores', () => {
    it('3.1 Pista sin contentHash válido: CONFIRMAR atenuado con la causa en su tooltip y el store lo rechaza', async () => {
      const file = createTestAudioFile('nohash.mp3');
      const trackNoHash = createTrackFromFile(file, 200.0);
      delete trackNoHash.fileMeta?.contentHash;
      await djStore.loadTrackToDeckA(trackNoHash);

      const facts = factsOf('A');
      assert.equal(facts.hasValidHash, false);
      const selection = selectSource(facts, getInitialSelection(facts), 'playhead', 1)!;
      assert.deepEqual(getConfirmButton(facts, selection, { saving: false, unavailable: false }), {
        disabled: true,
        tooltip: { key: 'dj.downbeat_btn_confirm_disabled_hash' },
      });

      const storeResult = await djStore.confirmDownbeat('A', 1.0, 4);
      assert.equal(storeResult, false, 'El store debe rechazar confirmar pistas sin contentHash');
    });

    it('3.2 Una posición fuera de la pista no se confirma (el módulo lo avisa con un toast)', async () => {
      const { track, file } = await createTrackWithRealHash('fail_persist.mp3');
      track.analysis = { status: 'analyzed', bpm: 120, firstBeatTime: 400 };
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const facts = factsOf('A');
      assert.equal(facts.duration, 300);
      assert.equal(buildConfirmParams(facts, getInitialSelection(facts)), null, 'OFF no confirma');
      assert.equal(buildConfirmParams(facts, selectSource(facts, getInitialSelection(facts), 'suggested', 0)!), null);

      const rejectDuration = await djStore.confirmDownbeat('A', 400.0, 4);
      assert.equal(rejectDuration, false);
      assert.equal(isDownbeatConfirmed(djStore.getSnapshot().deckA.track?.downbeat, track.fileMeta?.contentHash), false);
    });

    it('3.3 Mientras se guarda, CONFIRMAR y LIMPIAR quedan bloqueados (sin dobles envíos)', async () => {
      const { track, file, hash } = await createTrackWithRealHash('busy.mp3');
      track.downbeat = createManualDownbeatConfirmation({ position: 2, beatsPerBar: 4, contentHash: hash, origin: 'playhead' });
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const facts = factsOf('A');
      const selection = getInitialSelection(facts);
      const saving = { saving: true, unavailable: false };
      assert.equal(getConfirmButton(facts, selection, saving).disabled, true);
      assert.equal(getClearButton(facts, saving).disabled, true);
    });

    it('3.4 Al cambiar de pista el módulo parte de la nueva pista, sin valores de la anterior', async () => {
      const trackAData = await createTrackWithRealHash('trackA.mp3', 300, 'track-a-data');
      trackAData.track.analysis = { status: 'analyzed', bpm: 120, firstBeatTime: 1.0 };
      await indexedDBStorage.saveTrack(trackAData.track, trackAData.file);

      const trackBData = await createTrackWithRealHash('trackB.mp3', 300, 'track-b-data');
      trackBData.track.analysis = { status: 'analyzed', bpm: 130, firstBeatTime: 3.5 };
      await indexedDBStorage.saveTrack(trackBData.track, trackBData.file);

      await djStore.loadTrackToDeckA(trackAData.track);
      assert.equal(factsOf('A').suggestedPosition, 1.0);

      await djStore.loadTrackToDeckA(trackBData.track);
      assert.equal(djStore.getSnapshot().deckA.track?.id, trackBData.track.id);
      assert.equal(factsOf('A').suggestedPosition, 3.5);
      assert.deepEqual(getInitialSelection(factsOf('A')), { source: 'off', candidate: null, meterIndex: 0 });
    });
  });

  // =========================================================================
  // 4. Paridad Estricta de Localización i18n
  // =========================================================================
  describe('4. Paridad de Localización Bilingüe', () => {
    it('4.1 Todas las claves del módulo DOWNBEAT & COMPÁS existen en es y en', () => {
      const esJson = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
      );
      const enJson = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
      );

      const downbeatKeys = [
        'downbeat_editor_title',
        'downbeat_status_label',
        'downbeat_led_unconfirmed',
        'downbeat_led_playhead',
        'downbeat_led_suggested',
        'downbeat_led_confirmed',
        'downbeat_led_on',
        'downbeat_led_off',
        'downbeat_pos_label',
        'downbeat_metric_label',
        'downbeat_metric_tooltip',
        'downbeat_meter_fader',
        'downbeat_position_confirmed',
        'downbeat_position_candidate',
        'downbeat_position_none',
        'downbeat_source_label',
        'downbeat_source_playhead',
        'downbeat_source_off',
        'downbeat_source_suggested',
        'downbeat_source_playhead_short',
        'downbeat_source_off_short',
        'downbeat_source_suggested_short',
        'downbeat_source_playhead_tooltip',
        'downbeat_source_off_tooltip',
        'downbeat_source_suggested_tooltip',
        'downbeat_source_suggested_unavailable',
        'downbeat_btn_confirm',
        'downbeat_btn_confirm_tooltip',
        'downbeat_btn_confirm_disabled_hash',
        'downbeat_btn_confirm_disabled_off',
        'downbeat_confirm_pending',
        'downbeat_btn_clear',
        'downbeat_btn_clear_tooltip',
        'downbeat_btn_clear_disabled',
        'downbeat_missing_hash_explanation',
        'downbeat_unit_warning_label',
        'downbeat_error_persist',
        'downbeat_error_invalid_pos',
        'meter_pending_tooltip',
        'meter_unit_pending_tooltip',
      ];

      for (const key of downbeatKeys) {
        assert.ok(esJson.dj[key], `Falta dj.${key} en translation.json (es)`);
        assert.ok(enJson.dj[key], `Falta dj.${key} en translation.json (en)`);
      }
      assert.equal(esJson.dj.downbeat_editor_title, 'DOWNBEAT & COMPÁS');
      assert.equal(esJson.dj.downbeat_btn_confirm_disabled_hash, 'No se puede confirmar: la pista no dispone de huella SHA-256 válida');
    });

    it('4.2 El deck ya no contiene el editor: vive en el módulo de las secciones 5 / 6', () => {
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/organisms/Deck.tsx'), 'utf-8');
      assert.equal(deckSource.includes('downbeat'), false);
      const consoleSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/organisms/DJConsole.tsx'), 'utf-8');
      assert.ok(consoleSource.includes('<DownbeatPanel deckName="A" />'));
      assert.ok(consoleSource.includes('<DownbeatPanel deckName="B" />'));
    });
  });
});
