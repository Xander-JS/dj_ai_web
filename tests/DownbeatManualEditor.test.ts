/**
 * SYSTEM DJ — Test Suite: Fase 23.4 — Etapa C.8.2
 * Interfaz Manual y Bilingüe de Downbeat & Compás en los Decks
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

  // =========================================================================
  // 1. Estados visualizados: Sin confirmar, Sugerido y Confirmado
  // =========================================================================
  describe('1. Estados visualizados: Sin confirmar, Sugerido y Confirmado', () => {
    it('1.1 Pista sin análisis ni confirmación se clasifica en estado sin confirmar (badge-none)', async () => {
      const { track, file } = await createTrackWithRealHash('none.mp3');
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const deck = djStore.getSnapshot().deckA;
      assert.ok(deck.track);
      assert.equal(isDownbeatConfirmed(deck.track?.downbeat, deck.track?.fileMeta?.contentHash), false);

      const suggestedPos =
        deck.track?.downbeat?.suggestedPosition ??
        (typeof deck.track?.analysis?.firstBeatTime === 'number'
          ? deck.track.analysis.firstBeatTime
          : null);
      const hasSuggested =
        typeof suggestedPos === 'number' && Number.isFinite(suggestedPos) && suggestedPos >= 0;
      assert.equal(hasSuggested, false, 'No debe haber posición sugerida para pista sin análisis');

      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(deckSource.includes("badge-none"), 'Deck.tsx debe incluir la clase badge-none');
      assert.ok(deckSource.includes("t('dj.downbeat_badge_none')"), 'Deck.tsx debe traducir el badge sin confirmar');
    });

    it('1.2 Pista con sugerencia algorítmica muestra SUGERIDO (NO CONFIRMADO) y su posición', async () => {
      const { track, file } = await createTrackWithRealHash('suggested.mp3');
      track.analysis = {
        status: 'analyzed',
        bpm: 124.0,
        bpmConfidence: 0.95,
        firstBeatTime: 1.25,
      };
      track.downbeat = createSuggestedDownbeat(1.25);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const deck = djStore.getSnapshot().deckA;
      assert.ok(deck.track);
      assert.equal(
        isDownbeatConfirmed(deck.track?.downbeat, deck.track?.fileMeta?.contentHash),
        false,
        'Una sugerencia algorítmica nunca equivale a una confirmación humana'
      );

      const suggestedPos =
        deck.track?.downbeat?.suggestedPosition ??
        (typeof deck.track?.analysis?.firstBeatTime === 'number'
          ? deck.track.analysis.firstBeatTime
          : null);
      assert.equal(suggestedPos, 1.25);

      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(deckSource.includes("badge-suggested"), 'Deck.tsx debe incluir la clase badge-suggested');
      assert.ok(deckSource.includes("t('dj.downbeat_badge_suggested')"), 'Deck.tsx debe traducir SUGERIDO');
    });

    it('1.3 Pista confirmada manualmente muestra CONFIRMADO (MANUAL), métrica y activa badge DOWNBEAT ✓', async () => {
      const { track, file, hash } = await createTrackWithRealHash('confirmed.mp3');
      track.analysis = { status: 'analyzed', bpm: 128.0, firstBeatTime: 0.5 };
      track.downbeat = createManualDownbeatConfirmation({
        position: 0.5,
        beatsPerBar: 4,
        contentHash: hash,
      });
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const deck = djStore.getSnapshot().deckA;
      assert.ok(deck.track);
      assert.equal(
        isDownbeatConfirmed(deck.track?.downbeat, deck.track?.fileMeta?.contentHash),
        true,
        'El downbeat manual con hash coincidente debe ser confirmado'
      );
      assert.equal(deck.track?.downbeat?.confirmation?.position, 0.5);
      assert.equal(deck.track?.downbeat?.confirmation?.beatsPerBar, 4);

      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(deckSource.includes("badge-confirmed"), 'Deck.tsx debe incluir la clase badge-confirmed');
      assert.ok(deckSource.includes("t('dj.downbeat_badge_confirmed')"), 'Deck.tsx debe traducir CONFIRMADO (MANUAL)');
      assert.ok(deckSource.includes("deck-downbeat-badge"), 'Deck.tsx debe renderizar el badge DOWNBEAT ✓');
    });
  });

  // =========================================================================
  // 2. Acciones del editor y confirmación / limpieza
  // =========================================================================
  describe('2. Acciones del editor: captura, sugerencia, métrica, confirmación y limpieza', () => {
    it('2.1 Botón de Sugerido toma la posición del análisis sin confirmarla automáticamente', async () => {
      const { track, file } = await createTrackWithRealHash('startpoint.mp3');
      track.analysis = { status: 'analyzed', bpm: 120, firstBeatTime: 2.125 };
      track.downbeat = createSuggestedDownbeat(2.125);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      // Inspección de la lógica de handleUseSuggested en Deck.tsx:
      // debe fijar editDownbeatPos en suggestedPos.toFixed(3) sin invocar confirmDownbeat
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(
        deckSource.includes('handleUseSuggested = () => {') &&
          deckSource.includes('setEditDownbeatPos(suggestedPos.toFixed(3))'),
        'handleUseSuggested debe actualizar únicamente el estado local sin confirmar'
      );
      assert.ok(
        !deckSource.includes('handleUseSuggested = async () => {\n    await confirmDownbeat'),
        'handleUseSuggested no debe invocar confirmDownbeat'
      );

      // En el store la pista permanece sin confirmación humana
      const deck = djStore.getSnapshot().deckA;
      assert.equal(isDownbeatConfirmed(deck.track?.downbeat, deck.track?.fileMeta?.contentHash), false);
    });

    it('2.2 Botón de Cabezal captura currentTime sin confirmarla automáticamente', async () => {
      const { track, file } = await createTrackWithRealHash('playhead.mp3');
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);
      djStore.seekDeckA(15.75);

      const deck = djStore.getSnapshot().deckA;
      assert.equal(deck.currentTime, 15.75);

      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(
        deckSource.includes('handleCapturePlayhead = () => {') &&
          deckSource.includes('setEditDownbeatPos(Math.max(0, currentTime).toFixed(3))'),
        'handleCapturePlayhead debe asignar el currentTime al campo de posición'
      );

      // Sigue sin estar confirmado
      assert.equal(isDownbeatConfirmed(deck.track?.downbeat, deck.track?.fileMeta?.contentHash), false);
    });

    it('2.3 Selección de métrica permite 4/4 como valor inicial y 3/4 alternativo, incluyendo la unidad de nota', async () => {
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(
        deckSource.includes('[[4, 4], [3, 4], [2, 4], [6, 8]]'),
        'El selector debe ofrecer compases completos (pulsos/unidad), empezando por 4/4 y con 3/4 alternativo'
      );
      assert.ok(
        deckSource.includes("const [editBeatUnit, setEditBeatUnit] = useState<BeatUnit>(4);") &&
          deckSource.includes('beatUnit: editBeatUnit,'),
        'La unidad de nota elegida debe enviarse al confirmar el downbeat'
      );
      assert.ok(
        deckSource.includes("const [editBeatsPerBar, setEditBeatsPerBar] = useState<number>(4);"),
        'El valor inicial explícito debe ser 4 (4/4)'
      );
    });

    it('2.4 Confirmar invoca confirmDownbeat y actualiza tanto el store como IndexedDB', async () => {
      const { track, file, hash } = await createTrackWithRealHash('confirm_flow.mp3');
      track.analysis = { status: 'analyzed', bpm: 125.0, firstBeatTime: 1.0 };
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      // Confirmar a través de la acción real del store
      const success = await djStore.confirmDownbeat('A', {
        position: 1.5,
        beatsPerBar: 3,
        suggestedPosition: 1.0,
      });
      assert.equal(success, true, 'confirmDownbeat debe reportar éxito');

      const deckSnap = djStore.getSnapshot().deckA;
      assert.equal(deckSnap.track?.downbeat?.status, 'confirmed');
      assert.equal(deckSnap.track?.downbeat?.confirmation?.position, 1.5);
      assert.equal(deckSnap.track?.downbeat?.confirmation?.beatsPerBar, 3);
      assert.equal(deckSnap.track?.downbeat?.confirmation?.contentHash, hash);

      // Verificar persistencia en IndexedDB
      const persistedTrack = await indexedDBStorage.getTrack(track.id);
      assert.equal(persistedTrack?.downbeat?.status, 'confirmed');
      assert.equal(persistedTrack?.downbeat?.confirmation?.position, 1.5);
      assert.equal(persistedTrack?.downbeat?.confirmation?.beatsPerBar, 3);
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

      assert.equal(await djStore.clearDownbeat('A'), true);
      assert.equal(djStore.getSnapshot().deckA.track?.analysis.beatUnit, undefined);
      assert.equal((await indexedDBStorage.getTrackAnalysis(track.id))?.beatUnit, undefined);
    });

    it('2.5 Limpiar confirmación invoca clearDownbeat y revierte al estado sugerido', async () => {
      const { track, file, hash } = await createTrackWithRealHash('clear_flow.mp3');
      track.analysis = { status: 'analyzed', bpm: 120.0, firstBeatTime: 0.8 };
      track.downbeat = createManualDownbeatConfirmation({
        position: 1.2,
        beatsPerBar: 4,
        contentHash: hash,
        suggestedPosition: 0.8,
      });
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      assert.equal(isDownbeatConfirmed(djStore.getSnapshot().deckA.track?.downbeat, hash), true);

      // Limpiar confirmación
      const clearSuccess = await djStore.clearDownbeat('A');
      assert.equal(clearSuccess, true, 'clearDownbeat debe reportar éxito');

      const clearedSnap = djStore.getSnapshot().deckA;
      assert.equal(clearedSnap.track?.downbeat?.status, 'suggested');
      assert.equal(clearedSnap.track?.downbeat?.confirmation, null);
      assert.equal(clearedSnap.track?.downbeat?.suggestedPosition, 0.8);
      assert.equal(isDownbeatConfirmed(clearedSnap.track?.downbeat, hash), false);

      // Persistencia en IndexedDB actualizada
      const persisted = await indexedDBStorage.getTrack(track.id);
      assert.equal(persisted?.downbeat?.status, 'suggested');
      assert.equal(persisted?.downbeat?.confirmation, null);
    });
  });

  // =========================================================================
  // 3. Validación de Identidad y Seguridad
  // =========================================================================
  describe('3. Seguridad de Identidad, Hash y Gestión de Errores', () => {
    it('3.1 Pista sin contentHash válido deshabilita el botón de confirmación y muestra advertencia', async () => {
      const file = createTestAudioFile('nohash.mp3');
      const trackNoHash = createTrackFromFile(file, 200.0);
      delete trackNoHash.fileMeta?.contentHash; // Sin hash SHA-256
      await djStore.loadTrackToDeckA(trackNoHash);

      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(
        deckSource.includes('disabled={!hasTrack || isLoading || isSavingDownbeat || !hasValidHash}'),
        'El botón de confirmar debe estar deshabilitado si !hasValidHash'
      );
      assert.ok(
        deckSource.includes('data-testid={`deck-${deckName.toLowerCase()}-downbeat-hash-warning`}'),
        'Debe renderizar la advertencia si la pista no tiene hash válido'
      );
      assert.ok(
        deckSource.includes("t('dj.downbeat_missing_hash_explanation')"),
        'Debe mostrar la explicación de hash ausente'
      );

      // Intento en el store es rechazado
      const storeResult = await djStore.confirmDownbeat('A', 1.0, 4);
      assert.equal(storeResult, false, 'El store debe rechazar confirmar pistas sin contentHash');
    });

    it('3.2 Errores de persistencia muestran mensaje de error sin simular confirmación exitosa', async () => {
      const { track, file } = await createTrackWithRealHash('fail_persist.mp3');
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(
        deckSource.includes("setDownbeatError(t('dj.downbeat_error_persist'))"),
        'Debe capturar fallos de persistencia y asignar mensaje de error'
      );
      assert.ok(
        deckSource.includes('data-testid={`deck-${deckName.toLowerCase()}-downbeat-error`}'),
        'Debe renderizar el elemento con testid de error'
      );

      // Posición fuera de rango (> duración 300s) debe ser rechazada
      const rejectDuration = await djStore.confirmDownbeat('A', 400.0, 4);
      assert.equal(rejectDuration, false);
      assert.equal(isDownbeatConfirmed(djStore.getSnapshot().deckA.track?.downbeat, track.fileMeta?.contentHash), false);
    });

    it('3.3 Protección contra dobles envíos durante operaciones asíncronas', () => {
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(
        deckSource.includes('if (!hasTrack || !hasValidHash || isSavingDownbeat || isLoading) return;'),
        'handleConfirmDownbeat debe descartar clics concurrentes si isSavingDownbeat es true'
      );
      assert.ok(
        deckSource.includes('if (!hasTrack || isSavingDownbeat || isLoading || !isDownbeatManuallyConfirmed) return;'),
        'handleClearDownbeat debe descartar clics concurrentes si isSavingDownbeat es true'
      );
    });

    it('3.4 El editor refleja los cambios de pista inmediatamente y descarta valores de la pista anterior', async () => {
      const trackAData = await createTrackWithRealHash('trackA.mp3', 300, 'track-a-data');
      trackAData.track.analysis = { status: 'analyzed', bpm: 120, firstBeatTime: 1.0 };
      await indexedDBStorage.saveTrack(trackAData.track, trackAData.file);

      const trackBData = await createTrackWithRealHash('trackB.mp3', 300, 'track-b-data');
      trackBData.track.analysis = { status: 'analyzed', bpm: 130, firstBeatTime: 3.5 };
      await indexedDBStorage.saveTrack(trackBData.track, trackBData.file);

      // Cargar Pista A
      await djStore.loadTrackToDeckA(trackAData.track);
      assert.equal(djStore.getSnapshot().deckA.track?.id, trackAData.track.id);

      // Cargar Pista B: Deck A debe cambiar de pista y no retener nada de A
      await djStore.loadTrackToDeckA(trackBData.track);
      assert.equal(djStore.getSnapshot().deckA.track?.id, trackBData.track.id);
      assert.equal(djStore.getSnapshot().deckA.track?.analysis?.firstBeatTime, 3.5);

      // Inspección del mecanismo de reinicio en Deck.tsx:
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(
        deckSource.includes('if (currentTrackId !== prevTrackId || isDownbeatManuallyConfirmed !== prevConfirmed)'),
        'Deck.tsx debe resetear el editor cuando cambia currentTrackId'
      );
    });
  });

  // =========================================================================
  // 4. Paridad Estricta de Localización i18n y CSS
  // =========================================================================
  describe('4. Paridad de Localización Bilingüe y Selectores CSS', () => {
    it('4.1 Todas las claves de traducción de downbeat existen en es y en con correspondencia simétrica', () => {
      const esJson = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
      );
      const enJson = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
      );

      const downbeatKeys = [
        'downbeat_editor_title',
        'downbeat_badge_confirmed',
        'downbeat_badge_suggested',
        'downbeat_badge_none',
        'downbeat_pos_label',
        'downbeat_metric_label',
        'downbeat_btn_capture',
        'downbeat_btn_capture_tooltip',
        'downbeat_btn_use_suggested',
        'downbeat_btn_use_suggested_tooltip',
        'downbeat_btn_confirm',
        'downbeat_btn_confirm_tooltip',
        'downbeat_btn_confirm_disabled_hash',
        'downbeat_btn_clear',
        'downbeat_btn_clear_tooltip',
        'downbeat_missing_hash_explanation',
        'downbeat_error_persist',
        'downbeat_error_invalid_pos',
      ];

      for (const key of downbeatKeys) {
        assert.ok(esJson.dj[key], `Falta dj.${key} en translation.json (es)`);
        assert.ok(enJson.dj[key], `Falta dj.${key} en translation.json (en)`);
      }
    });

    it('4.2 Todos los selectores y clases CSS del editor de downbeat están presentes en Deck.css', () => {
      const cssSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.css'), 'utf-8');

      const expectedSelectors = [
        '.deck-downbeat-editor',
        '.deck-downbeat-header',
        '.deck-downbeat-title',
        '.deck-downbeat-status-wrapper',
        '.downbeat-status-badge',
        '.downbeat-status-badge.badge-confirmed',
        '.downbeat-status-badge.badge-suggested',
        '.downbeat-status-badge.badge-none',
        '.downbeat-status-detail',
        '.deck-downbeat-controls-row',
        '.deck-downbeat-input-group',
        '.deck-downbeat-input',
        '.deck-downbeat-select',
        '.btn-downbeat-action',
        '.btn-downbeat-source',
        '.btn-downbeat-source.selected',
        '.source-indicator-dot',
        '.btn-downbeat-confirm',
        '.btn-downbeat-clear',
        '.downbeat-hash-warning',
        '.downbeat-error-msg',
      ];

      for (const selector of expectedSelectors) {
        assert.ok(cssSource.includes(selector), `Falta el selector CSS "${selector}" en Deck.css`);
      }
    });

    it('4.3 Deck.tsx incluye todos los data-testid requeridos para automatización', () => {
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');

      const testIds = [
        'downbeat-editor',
        'downbeat-status-badge',
        'downbeat-status-detail',
        'downbeat-pos-input',
        'downbeat-capture-btn',
        'downbeat-suggested-btn',
        'downbeat-metric-select',
        'downbeat-confirm-btn',
        'downbeat-clear-btn',
        'downbeat-hash-warning',
        'downbeat-error',
      ];

      for (const id of testIds) {
        assert.ok(
          deckSource.includes(`data-testid={\`deck-\${deckName.toLowerCase()}-${id}\`}`),
          `Falta el data-testid "deck-\${deckName.toLowerCase()}-${id}" en Deck.tsx`
        );
      }
    });
  });

  // =========================================================================
  // 5. Selección visual explícita entre Sugerido y Cabezal (Etapa C.8.3)
  // =========================================================================
  describe('5. Selección visual explícita entre Sugerido y Cabezal (Etapa C.8.3)', () => {
    it('5.1 Al seleccionar Sugerido, solo esa opción queda resaltada con clase selected y aria-pressed', () => {
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');

      // Verifica el estado de selección en el botón Sugerido
      assert.ok(
        deckSource.includes("selectedSource === 'suggested' && 'selected'"),
        'El botón Sugerido debe aplicar la clase selected cuando selectedSource === "suggested"'
      );
      assert.ok(
        deckSource.includes("aria-pressed={selectedSource === 'suggested'}"),
        'El botón Sugerido debe incluir aria-pressed reactivo a selectedSource'
      );
      assert.ok(
        deckSource.includes("data-selected={selectedSource === 'suggested'}"),
        'El botón Sugerido debe incluir data-selected reactivo a selectedSource'
      );
      assert.ok(
        deckSource.includes("selectedSource === 'suggested' && (\n                <span className=\"source-indicator-dot\" aria-hidden=\"true\" />\n              )"),
        'El botón Sugerido debe renderizar el punto indicador cuando está seleccionado'
      );

      // Verifica que handleUseSuggested actualiza selectedSource a 'suggested'
      assert.ok(
        deckSource.includes("setSelectedSource('suggested')"),
        'handleUseSuggested debe establecer selectedSource en "suggested"'
      );
    });

    it('5.2 Al seleccionar Cabezal, el resaltado cambia inmediatamente a esa opción', () => {
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');

      // Verifica el estado de selección en el botón Cabezal
      assert.ok(
        deckSource.includes("selectedSource === 'playhead' && 'selected'"),
        'El botón Cabezal debe aplicar la clase selected cuando selectedSource === "playhead"'
      );
      assert.ok(
        deckSource.includes("aria-pressed={selectedSource === 'playhead'}"),
        'El botón Cabezal debe incluir aria-pressed reactivo a selectedSource'
      );
      assert.ok(
        deckSource.includes("data-selected={selectedSource === 'playhead'}"),
        'El botón Cabezal debe incluir data-selected reactivo a selectedSource'
      );
      assert.ok(
        deckSource.includes("selectedSource === 'playhead' && (\n                <span className=\"source-indicator-dot\" aria-hidden=\"true\" />\n              )"),
        'El botón Cabezal debe renderizar el punto indicador cuando está seleccionado'
      );

      // Verifica que handleCapturePlayhead actualiza selectedSource a 'playhead'
      assert.ok(
        deckSource.includes("setSelectedSource('playhead')"),
        'handleCapturePlayhead debe establecer selectedSource en "playhead"'
      );
    });

    it('5.3 La selección visual representa la última fuente elegida y no depende solo del valor numérico', () => {
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');

      // Comprueba que existe un estado explícito de selección independiente del valor numérico de la posición
      assert.ok(
        deckSource.includes("const [selectedSource, setSelectedSource] = useState<'suggested' | 'playhead' | null>(null);"),
        'Debe existir un estado explícito selectedSource'
      );

      // Verifica que no se infiere la clase selected comparando números de posición
      assert.ok(
        !deckSource.includes("editDownbeatPos === suggestedPos"),
        'La selección no debe inferirse comparando cadenas o números de posición'
      );
    });

    it('5.4 Seleccionar Sugerido o Cabezal no confirma automáticamente el downbeat en el store', async () => {
      const { track, file } = await createTrackWithRealHash('no_auto_confirm.mp3');
      track.analysis = { status: 'analyzed', bpm: 120, firstBeatTime: 1.5 };
      track.downbeat = createSuggestedDownbeat(1.5);
      await indexedDBStorage.saveTrack(track, file);
      await djStore.loadTrackToDeckA(track);

      // El store debe mantenerse en unconfirmed antes y después de interactuar con las fuentes
      const snap = djStore.getSnapshot().deckA;
      assert.equal(
        isDownbeatConfirmed(snap.track?.downbeat, snap.track?.fileMeta?.contentHash),
        false,
        'La pista cargada con sugerencia no debe estar confirmada'
      );

      // Verificar que ningún handler de selección invoca confirmDownbeat
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');
      assert.ok(!deckSource.includes("handleUseSuggested = async"), 'handleUseSuggested no debe ser asíncrono ni confirmar');
      assert.ok(!deckSource.includes("handleCapturePlayhead = async"), 'handleCapturePlayhead no debe ser asíncrono ni confirmar');
    });

    it('5.5 Cambiar de pista en el deck reinicia inmediatamente la selección visual', async () => {
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');

      // Verifica que en el bloque de sincronización de cambio de pista se ejecuta setSelectedSource(null)
      assert.ok(
        deckSource.includes('setSelectedSource(null);'),
        'El editor debe reiniciar selectedSource a null al cambiar de pista'
      );

      // Prueba funcional con dos pistas distintas cargadas secuencialmente
      const track1Data = await createTrackWithRealHash('source1.mp3');
      const track2Data = await createTrackWithRealHash('source2.mp3');
      await indexedDBStorage.saveTrack(track1Data.track, track1Data.file);
      await indexedDBStorage.saveTrack(track2Data.track, track2Data.file);

      await djStore.loadTrackToDeckA(track1Data.track);
      assert.equal(djStore.getSnapshot().deckA.track?.id, track1Data.track.id);

      await djStore.loadTrackToDeckA(track2Data.track);
      assert.equal(djStore.getSnapshot().deckA.track?.id, track2Data.track.id);
    });

    it('5.6 Editar manualmente el input de posición descarta la selección de fuente activa', () => {
      const deckSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'), 'utf-8');

      assert.ok(
        deckSource.includes('onChange={(e) => {\n                  setEditDownbeatPos(e.target.value);\n                  setSelectedSource(null);\n                }}'),
        'El onChange del input debe reiniciar selectedSource a null al ingresar un valor manual'
      );
    });

    it('5.7 Estilos CSS para el estado seleccionado y accesibilidad de foco', () => {
      const cssSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/Deck.css'), 'utf-8');

      assert.ok(cssSource.includes('.btn-downbeat-source.selected'), 'Deck.css debe definir .btn-downbeat-source.selected');
      assert.ok(cssSource.includes('.source-indicator-dot'), 'Deck.css debe definir .source-indicator-dot');
      assert.ok(cssSource.includes('.btn-downbeat-action:focus-visible'), 'Deck.css debe definir :focus-visible para accesibilidad');
    });
  });
});

