/**
 * SYSTEM DJ — Panel de deck (secciones 2 y 3, carpeta dj_console/02-03)
 *
 * Reglas del modelo puro: qué avisos aparecen sobre el disco y en qué orden, cómo se ilumina
 * cada tecla de la fila de sincronización y cuándo hay guía de BAR SYNC. Además, la
 * disposición: Deck B es el espejo de Deck A y el Pitch Bend queda bajo el fader de tempo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDeckBarSyncHint,
  getDeckMessage,
  getDeckNotices,
  getDeckSyncKeys,
  translatePanelMessage,
  type DeckPanelInput,
  type PanelMessage,
} from '../src/services/console/deckPanelModel.ts';
import type { DeckStoreState } from '../src/store/useDJStore.ts';
import type { Track, TrackAnalysis } from '../src/types/track.ts';

const keyOf = (message: PanelMessage): string => ('key' in message ? message.key : message.text);

function makeTrack(analysis?: Partial<TrackAnalysis>): Track {
  return {
    id: 'track-1',
    title: 'Track',
    artist: 'Artist',
    duration: 200,
    ...(analysis ? { analysis: { status: 'analyzed', ...analysis } } : {}),
  } as unknown as Track;
}

function makeDeck(deckId: 'A' | 'B', overrides: Partial<DeckStoreState> = {}): DeckStoreState {
  return {
    deckId,
    track: null,
    playbackState: 'stopped',
    currentTime: 0,
    duration: 0,
    pitch: 50,
    playbackRate: 1,
    calculatedBpm: null,
    keyStr: null,
    mainCue: null,
    hotCues: [],
    pitchBend: 0,
    isKeyLocked: false,
    isCupPlaying: false,
    isSyncActive: false,
    isMaster: false,
    phaseAlignment: { status: 'idle', progressPercent: 0 },
    barSync: { status: 'idle' },
    errorCode: null,
    errorMessage: null,
    syncFeedback: null,
    loop: { beats: 1, region: null, warning: false },
    isBackspinning: false,
    ...overrides,
  };
}

function input(deck: Partial<DeckStoreState>, other: Partial<DeckStoreState> = {}, extra: Partial<DeckPanelInput> = {}): DeckPanelInput {
  return {
    deckName: 'A',
    deck: makeDeck('A', deck),
    otherDeck: makeDeck('B', other),
    syncMasterDeck: null,
    seedIndex: -1,
    isTriggeringAnalysis: false,
    isPreparingBarSync: false,
    syncLimitPercent: 8,
    ...extra,
  };
}

const noticeIds = (panel: DeckPanelInput) => getDeckNotices(panel).map((n) => n.id);

describe('Panel de deck — avisos sobre el disco', () => {
  it('sin pista no hay avisos ni guía de BAR SYNC', () => {
    assert.deepEqual(noticeIds(input({})), []);
    assert.equal(getDeckBarSyncHint(input({})), null);
  });

  it('PENDIENTE y ERROR son interactivos (lanzan el análisis); ANALIZADO y NO COMPATIBLE no', () => {
    const pending = getDeckNotices(input({ track: makeTrack() }))[0];
    assert.equal(keyOf(pending.label), 'library.status_pending');
    assert.equal(pending.interactive, true);
    assert.equal(pending.light, 'neutral');

    const failed = getDeckNotices(input({ track: makeTrack({ status: 'failed', analysisError: 'Decodificación fallida' }) }))[0];
    assert.equal(failed.interactive, true);
    assert.equal(failed.light, 'red');
    assert.deepEqual(failed.tooltip, { text: 'Decodificación fallida' }, 'El error real del análisis va en el tooltip');

    const analyzed = getDeckNotices(input({ track: makeTrack({ bpm: 120 }) }))[0];
    assert.equal(keyOf(analyzed.label), 'library.status_analyzed');
    assert.equal(analyzed.light, 'green');
    assert.ok(!analyzed.interactive);

    const unsupported = getDeckNotices(input({ track: makeTrack({ status: 'unsupported' }) }))[0];
    assert.equal(unsupported.light, 'amber');
    assert.ok(!unsupported.interactive);
  });

  it('mientras se lanza el análisis el aviso pasa a ANALIZANDO y deja de ser interactivo', () => {
    const notice = getDeckNotices(input({ track: makeTrack() }, {}, { isTriggeringAnalysis: true }))[0];
    assert.equal(keyOf(notice.label), 'library.status_analyzing');
    assert.equal(notice.busy, true);
    assert.ok(!notice.interactive);
  });

  it('PROVISIONAL aparece con retícula estimada y lleva su explicación', () => {
    const notices = getDeckNotices(input({ track: makeTrack({ bpm: 124, firstBeatTime: 0.42 }) }));
    const provisional = notices.find((n) => n.id === 'provisional');
    assert.ok(provisional);
    assert.equal(provisional.light, 'amber');
    assert.equal(keyOf(provisional.tooltip), 'dj.phase_align_grid_tooltip');
  });

  it('el rol de SYNC solo aparece con SYNC activo: MASTER o SLAVE ← deck opuesto', () => {
    const track = makeTrack({ bpm: 120 });
    assert.equal(noticeIds(input({ track })).includes('role'), false);

    const master = getDeckNotices(input({ track, isMaster: true })).find((n) => n.id === 'role');
    assert.equal(keyOf(master!.label), 'dj.role_master');
    assert.equal(master!.light, 'tone');

    const slave = getDeckNotices(input({ track, isSyncActive: true, playbackRate: 1.025 }, { calculatedBpm: 123 })).find((n) => n.id === 'role');
    assert.deepEqual(slave!.label, { key: 'dj.role_slave', values: { master: 'B' } });
    const tooltip = slave!.tooltip as { key: string; values: Record<string, unknown> };
    assert.equal(tooltip.values.bpm, '123.0');
    assert.equal(tooltip.values.pitch, '+2.50%');
  });

  it('ALIGN y BAR SYNC se ocultan en reposo y muestran su estado con el color correcto', () => {
    const track = makeTrack({ bpm: 120 });
    assert.equal(noticeIds(input({ track })).some((id) => id === 'align' || id === 'barsync'), false);

    const aligning = getDeckNotices(input({ track, phaseAlignment: { status: 'active', progressPercent: 42.4 } })).find((n) => n.id === 'align')!;
    assert.deepEqual(aligning.label, { key: 'dj.align_notice', values: { state: { key: 'dj.phase_align_active', values: { percent: 42 } } } });
    assert.equal(aligning.light, 'tone');
    const t = (key: string, values?: Record<string, string | number>) =>
      ({ 'dj.align_notice': `ALIGN · ${values?.state}`, 'dj.phase_align_active': `MODULANDO... (${values?.percent}%)` })[key] ?? key;
    assert.equal(translatePanelMessage(t, aligning.label), 'ALIGN · MODULANDO... (42%)');

    const rejected = getDeckNotices(input({ track, phaseAlignment: { status: 'rejected_limits', progressPercent: 0 } })).find((n) => n.id === 'align')!;
    assert.equal(rejected.light, 'red');
    const tolerance = getDeckNotices(input({ track, phaseAlignment: { status: 'already_aligned', progressPercent: 0 } })).find((n) => n.id === 'align')!;
    assert.equal(tolerance.light, 'green');

    const armed = getDeckNotices(input({ track, barSync: { status: 'armed', preparedPosition: 8.2, displacementSec: 0.2 } })).find((n) => n.id === 'barsync')!;
    assert.equal(armed.light, 'amber');
    assert.equal(keyOf(armed.tooltip), 'dj.bar_sync_armed_badge_tooltip');
  });

  it('REFERENCIA N aparece cuando la pista es semilla', () => {
    const notice = getDeckNotices(input({ track: makeTrack() }, {}, { seedIndex: 1 })).find((n) => n.id === 'reference')!;
    assert.deepEqual(notice.label, { key: 'seed.badge', values: { index: 2 } });
    assert.equal(notice.light, 'neutral');
  });

  it('nunca muestra los avisos de downbeat o compás (los comunica la sección 5 / 6) y respeta el orden', () => {
    const notices = getDeckNotices(input(
      {
        track: makeTrack({ bpm: 120, firstBeatTime: 0.5 }),
        isMaster: true,
        phaseAlignment: { status: 'completed', progressPercent: 100 },
        barSync: { status: 'completed' },
      },
      {},
      { seedIndex: 0 },
    ));
    assert.deepEqual(notices.map((n) => n.id), ['analysis', 'provisional', 'role', 'align', 'barsync', 'reference']);
    const keys = JSON.stringify(notices);
    assert.equal(/downbeat|meter_pending|meter_unit/.test(keys), false);
  });
});

describe('Panel de deck — fila de sincronización', () => {
  const track = makeTrack({ bpm: 120 });

  it('sin pista BAR SYNC, ALIGN y SYNC están deshabilitadas; KEY LOCK siempre se puede pulsar', () => {
    const keys = getDeckSyncKeys(input({}));
    assert.equal(keys.barSync.disabled, true);
    assert.equal(keys.align.disabled, true);
    assert.equal(keys.sync.disabled, true);
    assert.equal(keys.keyLock.disabled, false);
  });

  it('ALIGN solo se habilita con el deck sonando y muestra el porcentaje latiendo mientras corrige', () => {
    assert.equal(getDeckSyncKeys(input({ track })).align.disabled, true);
    const playing = getDeckSyncKeys(input({ track, playbackState: 'playing' })).align;
    assert.equal(playing.disabled, false);
    assert.equal(playing.light, null);

    const active = getDeckSyncKeys(input({ track, playbackState: 'playing', phaseAlignment: { status: 'active', progressPercent: 66.6 } })).align;
    assert.deepEqual(active.label, { text: '67%' });
    assert.equal(active.light, 'tone');
    assert.equal(active.pulse, true);
    assert.equal(getDeckSyncKeys(input({ track, playbackState: 'playing', phaseAlignment: { status: 'completed', progressPercent: 100 } })).align.light, 'green');
    assert.equal(getDeckSyncKeys(input({ track, playbackState: 'playing', phaseAlignment: { status: 'rejected_confidence', progressPercent: 0 } })).align.light, 'red');
  });

  it('SYNC: apagada, SYNC ✓ rellena del color del deck (Slave) o MASTER en ámbar', () => {
    const idle = getDeckSyncKeys(input({ track })).sync;
    assert.equal(keyOf(idle.label), 'dj.sync');
    assert.equal(idle.light, null);
    assert.equal(idle.pressed, false);

    const slave = getDeckSyncKeys(input({ track, isSyncActive: true })).sync;
    assert.equal(keyOf(slave.label), 'dj.sync_on');
    assert.equal(slave.light, 'tone');
    assert.equal(slave.filled, true);
    assert.equal(slave.pressed, true);
    assert.equal(keyOf(slave.tooltip), 'dj.sync_active_tooltip_detail');

    const master = getDeckSyncKeys(input({ track }, {}, { syncMasterDeck: 'A' })).sync;
    assert.equal(keyOf(master.label), 'dj.master');
    assert.equal(master.light, 'amber');
    assert.equal(master.filled, false);
  });

  it('KEY LOCK: interruptor neutro apagado, color del deck encendido', () => {
    const off = getDeckSyncKeys(input({ track })).keyLock;
    assert.equal(off.light, null);
    assert.equal(off.pressed, false);
    assert.equal(keyOf(off.tooltip), 'dj.key_lock_off_tooltip');
    const on = getDeckSyncKeys(input({ track, isKeyLocked: true })).keyLock;
    assert.equal(on.light, 'tone');
    assert.equal(on.pressed, true);
    assert.equal(keyOf(on.tooltip), 'dj.key_lock_on_tooltip');
  });

  it('BAR SYNC bloqueado: guía bajo el deck y el motivo añadido al tooltip de la tecla', () => {
    // Pista sin downbeat confirmado y Master sin pista: BAR SYNC no puede prepararse
    const panel = input({ track });
    const hint = getDeckBarSyncHint(panel);
    assert.ok(hint);
    assert.equal(hint.rejected, false);
    assert.ok(keyOf(hint.message).startsWith('dj.bar_sync_block_'));
    const tooltip = getDeckSyncKeys(panel).barSync.tooltip as { key: string; values: Record<string, PanelMessage> };
    assert.equal(tooltip.key, 'dj.bar_sync_tooltip_blocked');
    assert.deepEqual(tooltip.values.reason, hint.message);
  });
});

describe('Panel de deck — mensaje del display LED', () => {
  const track = makeTrack();
  const levelAndKey = (panel: DeckPanelInput) => {
    const m = getDeckMessage(panel);
    return m && [m.level, keyOf(m.message)];
  };

  it('deck vacío: guía «Carga una pista»; un rechazo de SYNC tiene prioridad', () => {
    assert.deepEqual(levelAndKey(input({})), ['guide', 'dj.display_load_track']);
    const rejected = getDeckMessage(input({ errorCode: 'sync_failed', syncFeedback: { key: 'dj.sync_reject_slave_track' } }));
    assert.deepEqual(rejected, { level: 'error', message: { key: 'dj.sync_reject_slave_track' } });
  });

  it('loop sin BPM analizado: warning por delante del bloqueo de BAR SYNC; con BPM desaparece', () => {
    const loop = { beats: 1, region: null, warning: true };
    assert.deepEqual(levelAndKey(input({ track, loop })), ['warning', 'dj.loop_requires_bpm']);
    assert.notEqual(levelAndKey(input({ track, loop, calculatedBpm: 124 }))?.[1], 'dj.loop_requires_bpm');
  });

  it('el error de reproducción es un error con su texto; sin estado de error no se muestra', () => {
    const failed = getDeckMessage(input({ track, playbackState: 'error', errorMessage: 'boom' }));
    assert.deepEqual(failed, { level: 'error', message: { text: 'boom' } });
    assert.notEqual(levelAndKey(input({ track, errorMessage: 'SYNC desactivado' }))?.[0], 'error');
  });

  it('BAR SYNC: bloqueo corregible = warning, rechazo = error, ser Master = guía', () => {
    const blocked = getDeckMessage(input({ track }))!;
    assert.equal(blocked.level, 'warning');
    assert.equal(keyOf(blocked.message), 'dj.display_bar_sync');
    const rejected = getDeckMessage(input({ track, barSync: { status: 'rejected_unconfirmed' } as DeckStoreState['barSync'] }))!;
    assert.equal(rejected.level, 'error');
    const master = getDeckMessage(input({ track, isMaster: true }))!;
    assert.equal(master.level, 'guide');
  });

  it('con varios mensajes gana el de mayor prioridad', () => {
    const both = getDeckMessage(input({ track, errorCode: 'sync_failed', syncFeedback: { key: 'dj.sync_reject_slave_bpm' } }))!;
    assert.deepEqual([both.level, keyOf(both.message)], ['error', 'dj.sync_reject_slave_bpm']);
  });
});

describe('Panel de deck — disposición y textos', () => {
  const css = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/organisms/Deck.css'), 'utf-8');
  const pitch = fs.readFileSync(path.resolve(process.cwd(), 'src/components/dj/molecules/DeckPitchFader.tsx'), 'utf-8');

  it('Deck A: transporte · principal · pitch; Deck B es su espejo horizontal', () => {
    assert.ok(css.includes('"transport sync pitch"'));
    assert.ok(css.includes('"transport cues pitch"'));
    assert.ok(css.includes('"pitch sync transport"'));
    assert.ok(css.includes('"pitch cues transport"'));
    // El fader empieza en la mitad inferior del disco
    assert.ok(css.includes('padding-top: calc(var(--jog-size) * 0.55)'));
  });

  it('los botones de Pitch Bend quedan directamente bajo el fader de tempo', () => {
    const fader = pitch.indexOf('<ConsoleFader');
    const caption = pitch.indexOf("t('dj.tempo')");
    const bends = pitch.indexOf('deck-pitch__bends');
    assert.ok(fader !== -1 && caption > fader && bends > caption, 'Orden: fader, TEMPO, Pitch Bend');
  });

  it('los textos nuevos existen en español e inglés', () => {
    const es = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8'));
    const en = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8'));
    for (const key of ['key_lock', 'key_lock_on_tooltip', 'key_lock_off_tooltip', 'sync_row_label', 'play_pause', 'tempo', 'align_notice', 'bar_sync_notice', 'bar_sync_tooltip_blocked']) {
      assert.ok(es.dj[key], `Falta es.dj.${key}`);
      assert.ok(en.dj[key], `Falta en.dj.${key}`);
    }
    assert.ok(es.dj.phase_align_active.includes('{{percent}}'));
    assert.ok(en.dj.phase_align_active.includes('{{percent}}'));
  });
});
