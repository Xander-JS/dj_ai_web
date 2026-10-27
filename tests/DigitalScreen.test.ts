/**
 * SYSTEM DJ — Test Suite: Pantalla digital de la consola (carpeta 01)
 * Botonera MENU / GRID / LOAD A / LOAD B / REC, menú de carga (búsqueda, selección, navegación
 * con ocho teclas, decisión de carga y confirmación), captura de teclas frente a los atajos
 * globales, valores de la vista normal y textos en español e inglés.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { DigitalScreenStore, ENTER_GUARD_MS } from '../src/services/console/digitalScreenStore.ts';
import {
  filterTracksByTitle,
  initialSelectionIndex,
  normalizeSearchText,
  resolveLoadIntent,
  resolveMenuKey,
  toMenuRow,
  type MenuKeyContext,
} from '../src/services/console/screenMenuModel.ts';
import { deckTechValues } from '../src/services/console/screenDisplayModel.ts';
import {
  SHORTCUTS_PASSTHROUGH_ATTRIBUTE,
  createShortcutHandlers,
  isEditableTarget,
  type ShortcutTarget,
} from '../src/services/keyboard/keyboardShortcuts.ts';
import { djStore, type DeckStoreState } from '../src/store/useDJStore.ts';
import type { Track } from '../src/types/track.ts';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');

function track(partial: Partial<Track> & { id: string; title: string }): Track {
  return {
    artist: 'Artist',
    duration: 252,
    durationFormatted: '4:12',
    type: 'audio',
    source: { type: 'indexeddb' },
    analysis: { status: 'pending' },
    dateAdded: 0,
    ...partial,
  };
}

function clockedStore() {
  let now = 1_000;
  const store = new DigitalScreenStore(() => now);
  return { store, advance: (ms: number) => { now += ms; } };
}

// ---------------------------------------------------------------------------
// 1. Botonera y estado de la pantalla
// ---------------------------------------------------------------------------
describe('Pantalla digital — botonera y vistas', () => {
  it('sin pantalla montada los botones no hacen nada', () => {
    const { store } = clockedStore();
    assert.equal(store.pressMenu(), false);
    assert.equal(store.pressLoad('A'), false);
    assert.equal(store.toggleGrid(), false);
    assert.equal(store.getSnapshot().view, 'normal');
  });

  it('MENU abre en LOAD A la primera vez, después en el último subapartado, y cierra', () => {
    const { store } = clockedStore();
    store.attach();
    store.pressMenu();
    assert.equal(store.getSnapshot().view, 'menu');
    assert.equal(store.getSnapshot().subsection, 'A');
    store.pressLoad('B');
    store.pressMenu();
    assert.equal(store.getSnapshot().view, 'normal');
    store.pressMenu();
    assert.equal(store.getSnapshot().view, 'menu');
    assert.equal(store.getSnapshot().subsection, 'B', 'recuerda el último subapartado usado');
  });

  it('LOAD abre su subapartado, cambia desde el otro y cierra si ya está activo', () => {
    const { store } = clockedStore();
    store.attach();
    store.pressLoad('B');
    assert.deepEqual([store.getSnapshot().view, store.getSnapshot().subsection], ['menu', 'B']);
    store.pressLoad('A');
    assert.deepEqual([store.getSnapshot().view, store.getSnapshot().subsection], ['menu', 'A']);
    store.pressLoad('A');
    assert.equal(store.getSnapshot().view, 'normal');
  });

  it('cada apertura o cambio desde un botón pide el foco para la lista', () => {
    const { store } = clockedStore();
    store.attach();
    const first = store.getSnapshot().focusRequest;
    store.pressLoad('A');
    store.pressLoad('B');
    assert.equal(store.getSnapshot().focusRequest, first + 2);
    // Cambiar desde la propia lista no mueve el foco
    store.selectSubsection('A');
    assert.equal(store.getSnapshot().focusRequest, first + 2);
    assert.equal(store.getSnapshot().subsection, 'A');
  });

  it('GRID alterna su estado en la vista normal; con el menú abierto no responde y lo conserva', () => {
    const { store } = clockedStore();
    store.attach();
    assert.equal(store.toggleGrid(), true);
    assert.equal(store.getSnapshot().gridEnabled, true);
    store.pressMenu();
    assert.equal(store.toggleGrid(), false);
    assert.equal(store.getSnapshot().gridEnabled, true);
    store.pressMenu();
    store.toggleGrid();
    assert.equal(store.getSnapshot().gridEnabled, false);
  });

  it('al desmontarse vuelve a la vista normal y conserva GRID', () => {
    const { store } = clockedStore();
    const detach = store.attach();
    store.toggleGrid();
    store.pressLoad('B');
    assert.equal(store.isCapturingNavigation(), true);
    detach();
    assert.equal(store.getSnapshot().view, 'normal');
    assert.equal(store.getSnapshot().gridEnabled, true);
    assert.equal(store.isCapturingNavigation(), false);
  });
});

// ---------------------------------------------------------------------------
// 2. Confirmación de reemplazo
// ---------------------------------------------------------------------------
describe('Pantalla digital — confirmación de reemplazo', () => {
  it('solo se abre con el menú abierto', () => {
    const { store } = clockedStore();
    store.attach();
    store.requestReplace('A', 't1');
    assert.equal(store.getSnapshot().replace, null);
    store.pressLoad('A');
    store.requestReplace('A', 't1');
    assert.equal(store.getSnapshot().replace?.trackId, 't1');
  });

  it(`Enter queda bloqueado ${ENTER_GUARD_MS} ms tras abrirla`, () => {
    const { store, advance } = clockedStore();
    store.attach();
    store.pressLoad('A');
    store.requestReplace('A', 't1');
    assert.equal(store.isEnterGuarded(), true);
    advance(ENTER_GUARD_MS - 1);
    assert.equal(store.isEnterGuarded(), true);
    advance(1);
    assert.equal(store.isEnterGuarded(), false);
  });

  it('cancelar cierra solo la ventana; el menú sigue abierto', () => {
    const { store } = clockedStore();
    store.attach();
    store.pressLoad('A');
    store.requestReplace('A', 't1');
    store.cancelReplace();
    assert.equal(store.getSnapshot().replace, null);
    assert.equal(store.getSnapshot().view, 'menu');
  });

  it('MENU, LOAD A o LOAD B con la ventana abierta cancelan y aplican su acción', () => {
    const { store } = clockedStore();
    store.attach();
    store.pressLoad('A');
    store.requestReplace('A', 't1');
    store.pressLoad('B');
    assert.equal(store.getSnapshot().replace, null);
    assert.deepEqual([store.getSnapshot().view, store.getSnapshot().subsection], ['menu', 'B']);

    store.requestReplace('B', 't2');
    store.pressLoad('B');
    assert.equal(store.getSnapshot().replace, null);
    assert.equal(store.getSnapshot().view, 'normal');

    store.pressMenu();
    store.requestReplace('B', 't2');
    store.pressMenu();
    assert.equal(store.getSnapshot().replace, null);
    assert.equal(store.getSnapshot().view, 'normal');
  });
});

// ---------------------------------------------------------------------------
// 3. Modelo del menú: filas, búsqueda, selección y carga
// ---------------------------------------------------------------------------
describe('Pantalla digital — modelo del menú de carga', () => {
  it('cada fila muestra título, BPM entero, Camelot solo analizado y duración m:ss', () => {
    assert.deepEqual(
      toMenuRow(track({ id: '1', title: 'Uno', duration: 347.6, analysis: { status: 'analyzed', bpm: 123.6, camelot: '8A' } })),
      { id: '1', title: 'Uno', bpm: '124', camelot: '8A', duration: '5:47' },
    );
    // Camelot exige estado analizado; sin BPM ni duración se muestra «—»
    assert.deepEqual(
      toMenuRow(track({ id: '2', title: 'Dos', duration: 0, analysis: { status: 'failed', camelot: '8A' } })),
      { id: '2', title: 'Dos', bpm: '—', camelot: '—', duration: '—' },
    );
  });

  it('la búsqueda filtra solo por título, sin mayúsculas ni acentos', () => {
    const tracks = [
      track({ id: '1', title: 'Canción Uno', artist: 'Zeta' }),
      track({ id: '2', title: 'Other', artist: 'Cancion Artist' }),
      track({ id: '3', title: 'CANCIÓN tres' }),
    ];
    assert.deepEqual(filterTracksByTitle(tracks, 'cancion').map((t) => t.id), ['1', '3']);
    assert.deepEqual(filterTracksByTitle(tracks, '  ').map((t) => t.id), ['1', '2', '3']);
    assert.deepEqual(filterTracksByTitle(tracks, 'zeta'), [], 'el artista no cuenta');
    assert.equal(normalizeSearchText('ÁÉÍÓÚ Ñ'), 'aeiou n');
  });

  it('al abrir se selecciona la pista cargada en el deck destino; si no, la primera', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.equal(initialSelectionIndex(rows, 'b'), 1);
    assert.equal(initialSelectionIndex(rows, 'zzz'), 0);
    assert.equal(initialSelectionIndex(rows, null), 0);
    assert.equal(initialSelectionIndex([], 'b'), -1);
  });

  it('deck parado, en pausa o vacío carga directo; sonando pide confirmación; misma pista no hace nada', () => {
    assert.equal(resolveLoadIntent({ trackId: null, playbackState: 'stopped' }, 'x'), 'load');
    assert.equal(resolveLoadIntent({ trackId: 'y', playbackState: 'paused' }, 'x'), 'load');
    assert.equal(resolveLoadIntent({ trackId: 'y', playbackState: 'playing' }, 'x'), 'confirm');
    assert.equal(resolveLoadIntent({ trackId: 'x', playbackState: 'playing' }, 'x'), 'none');
    assert.equal(resolveLoadIntent({ trackId: 'x', playbackState: 'stopped' }, 'x'), 'none');
  });
});

// ---------------------------------------------------------------------------
// 4. Navegación con las ocho teclas
// ---------------------------------------------------------------------------
describe('Pantalla digital — navegación del menú', () => {
  const ctx = (extra: Partial<MenuKeyContext> = {}): MenuKeyContext => ({
    subsection: 'A',
    selectedIndex: 2,
    rowCount: 5,
    searchText: '',
    ...extra,
  });

  it('en los subapartados', () => {
    assert.deepEqual(resolveMenuKey('subsections', 'ArrowDown', ctx()), { type: 'subsection', deckId: 'B' });
    assert.deepEqual(resolveMenuKey('subsections', 'ArrowUp', ctx({ subsection: 'B' })), { type: 'subsection', deckId: 'A' });
    assert.deepEqual(resolveMenuKey('subsections', 'ArrowUp', ctx()), { type: 'subsection', deckId: 'A' });
    assert.deepEqual(resolveMenuKey('subsections', 'Home', ctx({ subsection: 'B' })), { type: 'subsection', deckId: 'A' });
    assert.deepEqual(resolveMenuKey('subsections', 'End', ctx()), { type: 'subsection', deckId: 'B' });
    assert.deepEqual(resolveMenuKey('subsections', 'ArrowRight', ctx()), { type: 'focus', zone: 'list' });
    assert.deepEqual(resolveMenuKey('subsections', 'Enter', ctx()), { type: 'focus', zone: 'list' });
    assert.deepEqual(resolveMenuKey('subsections', 'ArrowLeft', ctx()), { type: 'none' });
    assert.deepEqual(resolveMenuKey('subsections', 'Escape', ctx()), { type: 'close' });
  });

  it('en la lista', () => {
    assert.deepEqual(resolveMenuKey('list', 'ArrowDown', ctx()), { type: 'select', index: 3 });
    assert.deepEqual(resolveMenuKey('list', 'ArrowDown', ctx({ selectedIndex: 4 })), { type: 'select', index: 4 });
    assert.deepEqual(resolveMenuKey('list', 'ArrowUp', ctx()), { type: 'select', index: 1 });
    assert.deepEqual(resolveMenuKey('list', 'ArrowUp', ctx({ selectedIndex: 0 })), { type: 'focus', zone: 'search' });
    assert.deepEqual(resolveMenuKey('list', 'Home', ctx()), { type: 'select', index: 0 });
    assert.deepEqual(resolveMenuKey('list', 'End', ctx()), { type: 'select', index: 4 });
    assert.deepEqual(resolveMenuKey('list', 'ArrowRight', ctx()), { type: 'none' });
    assert.deepEqual(resolveMenuKey('list', 'ArrowLeft', ctx()), { type: 'focus', zone: 'subsections' });
    assert.deepEqual(resolveMenuKey('list', 'Enter', ctx()), { type: 'load' });
    assert.deepEqual(resolveMenuKey('list', 'Enter', ctx({ rowCount: 0, selectedIndex: -1 })), { type: 'none' });
    assert.deepEqual(resolveMenuKey('list', 'Escape', ctx()), { type: 'close' });
  });

  it('en el buscador', () => {
    assert.deepEqual(resolveMenuKey('search', 'ArrowDown', ctx()), { type: 'select', index: 0 });
    assert.deepEqual(resolveMenuKey('search', 'Enter', ctx()), { type: 'select', index: 0 });
    assert.deepEqual(resolveMenuKey('search', 'ArrowDown', ctx({ rowCount: 0 })), { type: 'none' });
    for (const native of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) {
      assert.deepEqual(resolveMenuKey('search', native, ctx()), { type: 'native' }, native);
    }
    assert.deepEqual(resolveMenuKey('search', 'Escape', ctx({ searchText: 'abc' })), { type: 'clear-search' });
    assert.deepEqual(resolveMenuKey('search', 'Escape', ctx()), { type: 'close' });
  });
});

// ---------------------------------------------------------------------------
// 5. Captura de teclas frente a los atajos globales
// ---------------------------------------------------------------------------
describe('Pantalla digital — atajos con el menú abierto', () => {
  function key(code: string, extra: Record<string, unknown> = {}) {
    const event = {
      code,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      defaultPrevented: false,
      target: null as EventTarget | null,
      prevented: false,
      preventDefault() { event.prevented = true; },
      ...extra,
    };
    return event;
  }

  function target(captured: { value: boolean }) {
    const calls: string[] = [];
    const shortcutTarget: ShortcutTarget = {
      togglePlayDeck: (deckId) => calls.push(`play:${deckId}`),
      handleCueDown: (deckId) => calls.push(`cueDown:${deckId}`),
      handleCueUp: (deckId) => calls.push(`cueUp:${deckId}`),
      toggleSync: (deckId) => calls.push(`sync:${deckId}`),
      getCrossfader: () => 50,
      setCrossfader: (position) => calls.push(`xf:${position}`),
      hasHotCue: () => false,
      jumpToHotCue: () => undefined,
      setHotCue: (deckId, slot) => calls.push(`set:${deckId}${slot}`),
      getMixValue: () => 50,
      setMixValue: (deckId, param, value) => calls.push(`mix:${deckId}.${param}:${value}`),
      getChannelVolume: () => 80,
      setChannelVolume: (deckId, volume) => calls.push(`vol:${deckId}:${volume}`),
      getMasterVolume: () => 80,
      setMasterVolume: (volume) => calls.push(`master:${volume}`),
      toggleMasterMute: () => calls.push('mute'),
      pitchBend: (deckId, direction) => calls.push(`bend:${deckId}:${direction}`),
      cycleCrossfaderCurve: (direction) => calls.push(`curve:${direction}`),
      toggleRecording: () => calls.push('record'),
      pressLoadButton: (deckId) => calls.push(`load:${deckId}`),
      isNavigationCaptured: () => captured.value,
    };
    return { shortcutTarget, calls };
  }

  it('↑ / ↓ no mueven el Master ni ← / → el crossfader; la tecla queda para la pantalla', () => {
    const captured = { value: true };
    const { shortcutTarget, calls } = target(captured);
    const { onKeyDown } = createShortcutHandlers(shortcutTarget);
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Escape']) {
      const event = key(code);
      onKeyDown(event);
      assert.equal(event.prevented, false, `${code} no se consume: la pantalla lo recibe`);
    }
    assert.deepEqual(calls, []);
    captured.value = false;
    onKeyDown(key('ArrowUp'));
    onKeyDown(key('ArrowRight'));
    assert.deepEqual(calls, ['master:82', 'xf:55'], 'con el menú cerrado vuelven a su función');
  });

  it('transporte, CUE, SYNC, Hot Cues, faders de canal, curva, MUTE, REC y LOAD siguen respondiendo', () => {
    const { shortcutTarget, calls } = target({ value: true });
    const { onKeyDown, onKeyUp } = createShortcutHandlers(shortcutTarget);
    onKeyDown(key('KeyF'));
    onKeyDown(key('Space'));
    onKeyDown(key('ArrowUp'));
    onKeyUp(key('KeyF'));
    onKeyDown(key('KeyQ'));
    onKeyUp(key('KeyQ'));
    onKeyDown(key('KeyE'));
    onKeyDown(key('Digit1'));
    onKeyDown(key('ArrowLeft', { shiftKey: true }));
    onKeyDown(key('KeyB'));
    onKeyDown(key('Digit5'));
    onKeyDown(key('KeyN'));
    assert.deepEqual(calls, [
      'play:A', 'vol:A:82', 'cueDown:A', 'cueUp:A', 'sync:A', 'set:A1', 'curve:-1', 'mute', 'record', 'load:B',
    ]);
  });

  it('las listas de la pantalla no bloquean los atajos aunque tengan el foco', () => {
    const element = (attrs: Record<string, string>) => ({
      tagName: 'DIV',
      isContentEditable: false,
      getAttribute: (name: string) => attrs[name] ?? null,
    }) as unknown as EventTarget;
    assert.equal(isEditableTarget(element({ role: 'listbox' })), true);
    assert.equal(isEditableTarget(element({ role: 'listbox', [SHORTCUTS_PASSTHROUGH_ATTRIBUTE]: 'pass' })), false);
    // El buscador sigue siendo un campo editable: las letras se escriben y no disparan atajos
    assert.equal(isEditableTarget({ tagName: 'INPUT', getAttribute: () => null } as unknown as EventTarget), true);
  });
});

// ---------------------------------------------------------------------------
// 6. Vista normal: información técnica e identificación
// ---------------------------------------------------------------------------
describe('Pantalla digital — vista normal', () => {
  let base: DeckStoreState;
  beforeEach(() => {
    base = djStore.getSnapshot().deckA;
  });

  it('sin datos muestra «—» y el tiempo «-0:00»', () => {
    assert.deepEqual(deckTechValues({ ...base, track: null, calculatedBpm: null, duration: 0, currentTime: 0 }), {
      bpm: '—', time: '-0:00', key: '—', camelot: '—', energy: '—',
    });
  });

  it('con análisis muestra BPM efectivo, tiempo restante, tonalidad, Camelot y energía', () => {
    const loaded = track({
      id: 't',
      title: 'T',
      analysis: { status: 'analyzed', bpm: 124, key: 'Am', camelot: '8A', energy: 7 },
    });
    assert.deepEqual(deckTechValues({ ...base, track: loaded, calculatedBpm: 126.48, duration: 250, currentTime: 29 }), {
      bpm: '126.5', time: '-3:41', key: 'Am', camelot: '8A', energy: '7.0/10',
    });
    // Tonalidad, Camelot y energía solo con el análisis completado
    const pending = { ...loaded, analysis: { ...loaded.analysis, status: 'analyzing' as const } };
    const values = deckTechValues({ ...base, track: pending, calculatedBpm: 124, duration: 250, currentTime: 0 });
    assert.deepEqual([values.key, values.camelot, values.energy], ['—', '—', '—']);
  });
});

// ---------------------------------------------------------------------------
// 7. Estructura, accesibilidad y textos
// ---------------------------------------------------------------------------
describe('Pantalla digital — estructura, accesibilidad e i18n', () => {
  it('la botonera sigue el orden MENU, GRID, LOAD A, LOAD B, REC y expone aria-pressed', () => {
    const row = read('src/components/dj/molecules/ScreenButtonRow.tsx');
    const order = ['screen-key-menu', 'screen-key-grid', "loadKey('A')", "loadKey('B')", 'screen-key-rec'].map((id) => row.indexOf(id));
    assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), 'orden de la botonera');
    assert.equal(row.match(/aria-pressed=/g)?.length, 4, 'MENU, GRID, LOAD (compartido) y REC');
    assert.match(row, /disabled=\{menuOpen\}/, 'GRID atenuado con el menú abierto');
    assert.match(row, /t\('mixer\.rec_stop'\) : t\('mixer\.rec_start'\)/);
  });

  it('el menú usa fieldset/legend, listbox con aria-activedescendant y la ventana alertdialog', () => {
    const menu = read('src/components/dj/organisms/ScreenLoadMenu.tsx');
    assert.match(menu, /<fieldset/);
    assert.match(menu, /<legend/);
    assert.equal(menu.match(/role="listbox"/g)?.length, 2);
    assert.equal(menu.match(/aria-activedescendant=/g)?.length, 2);
    const dialog = read('src/components/dj/molecules/ScreenReplaceDialog.tsx');
    assert.match(dialog, /role="alertdialog"/);
    assert.match(dialog, /aria-labelledby=\{titleId\}/);
    assert.match(dialog, /aria-describedby=\{descriptionId\}/);
  });

  it('el LED y el contador de REC siguen el estado real de la captura', () => {
    const hook = read('src/hooks/useSessionCapture.ts');
    assert.match(hook, /useSyncExternalStore\(sessionCaptureControl\.subscribe, sessionCaptureControl\.getSnapshot\)/);
    const screen = read('src/components/dj/organisms/DigitalScreen.tsx');
    assert.match(screen, /recording=\{capture\.active\}/);
    assert.match(screen, /\{capture\.active && <ScreenRecCounter/);
  });

  it('todos los textos nuevos existen en español e inglés', () => {
    const es = JSON.parse(read('src/i18n/locales/es/translation.json'));
    const en = JSON.parse(read('src/i18n/locales/en/translation.json'));
    assert.deepEqual(Object.keys(es.mixer.screen).sort(), Object.keys(en.mixer.screen).sort());
    for (const value of [...Object.values(es.mixer.screen), ...Object.values(en.mixer.screen)]) {
      assert.equal(typeof value, 'string');
      assert.notEqual((value as string).trim(), '');
    }
    assert.equal(es.mixer.screen.search, 'Buscar por título');
    assert.equal(en.mixer.screen.search, 'Search by title');
    assert.equal(es.mixer.screen.keybar_dialog, 'Enter reemplazar · Esc cancelar');
    assert.equal(en.mixer.screen.keybar_menu, '↑↓ move · Home/End first/last · → enter list · ← back to subsections · Enter load · Esc exit');
    assert.equal(es.mixer.screen.replace_title, 'El Deck {{deck}} está sonando');
    assert.equal(en.mixer.screen.rec_counter, 'Recording, {{time}}');
    // Claves retiradas junto con el selector y el panel REC de la consola
    for (const removed of ['picker_label', 'picker_placeholder', 'picker_aria', 'picker_search', 'rec_on', 'rec_off', 'rec_panel']) {
      assert.equal(es.mixer[removed], undefined, removed);
      assert.equal(en.mixer[removed], undefined, removed);
    }
  });
});
