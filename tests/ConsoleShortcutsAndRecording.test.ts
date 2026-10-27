/**
 * SYSTEM DJ — Test Suite: Atajos de consola, grabación y selector de canciones
 * Convención F = Deck A / J = Deck B (Espacio, volumen y Pitch Bend), Master y MUTE, curva del
 * crossfader, selectoras de EQ/FILTER, comandos reasignables y su migración, control compartido
 * de la grabación de sesión y botones LOAD de la pantalla digital.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_NAVIGATION_BINDINGS,
  DEFAULT_SHORTCUT_BINDINGS,
  KEYBOARD_SHORTCUTS,
  LEGACY_SHORTCUT_BINDINGS,
  VOLUME_KEY_STEP,
  MIX_KEY_STEP,
  createShortcutHandlers,
  formatKeyCode,
  resolveShortcut,
  sanitizeShortcutBindings,
  validateBinding,
  validateNavigationBinding,
  type ShortcutBindings,
  type ShortcutTarget,
} from '../src/services/keyboard/keyboardShortcuts.ts';
import { createDJShortcutTarget } from '../src/services/keyboard/djShortcutTarget.ts';
import {
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  SettingsStore,
  stepCrossfaderCurve,
  type SettingsStorage,
} from '../src/store/useSettingsStore.ts';
import { djStore } from '../src/store/useDJStore.ts';
import { SessionRecorder } from '../src/session/SessionRecorder.ts';
import { SessionCaptureControl, type SessionCaptureDeps } from '../src/services/session/sessionCaptureControl.ts';
import { digitalScreenStore } from '../src/services/console/digitalScreenStore.ts';
import type { DeckId } from '../src/types/deck.ts';

interface FakeKeyEvent {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
  prevented: boolean;
  preventDefault(): void;
}

function key(code: string, extra: Partial<Omit<FakeKeyEvent, 'target'>> & { target?: unknown } = {}): FakeKeyEvent {
  const event: FakeKeyEvent = {
    code,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    defaultPrevented: false,
    prevented: false,
    ...extra,
    target: (extra.target ?? null) as EventTarget | null,
    preventDefault() { event.prevented = true; },
  };
  return event;
}

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, value) => { data[k] = value; },
  };
}

/** Destino simulado que registra cada llamada. */
function recordingTarget() {
  const calls: string[] = [];
  const volumes: Record<DeckId, number> = { A: 80, B: 80 };
  let master = 80;
  const target: ShortcutTarget = {
    togglePlayDeck: (deckId) => calls.push(`play:${deckId}`),
    handleCueDown: (deckId) => calls.push(`cueDown:${deckId}`),
    handleCueUp: (deckId) => calls.push(`cueUp:${deckId}`),
    toggleSync: (deckId) => calls.push(`sync:${deckId}`),
    getCrossfader: () => 50,
    setCrossfader: (position) => calls.push(`xf:${position}`),
    hasHotCue: () => false,
    jumpToHotCue: (deckId, slot) => calls.push(`jump:${deckId}${slot}`),
    setHotCue: (deckId, slot) => calls.push(`set:${deckId}${slot}`),
    getMixValue: () => 50,
    setMixValue: (deckId, param, value) => calls.push(`mix:${deckId}.${param}:${value}`),
    getChannelVolume: (deckId) => volumes[deckId],
    setChannelVolume: (deckId, volume) => { volumes[deckId] = volume; calls.push(`vol:${deckId}:${volume}`); },
    getMasterVolume: () => master,
    setMasterVolume: (volume) => { master = volume; calls.push(`master:${volume}`); },
    toggleMasterMute: () => calls.push('mute'),
    pitchBend: (deckId, direction) => calls.push(`bend:${deckId}:${direction}`),
    cycleCrossfaderCurve: (direction) => calls.push(`curve:${direction}`),
    toggleRecording: () => calls.push('record'),
    pressLoadButton: (deckId) => calls.push(`picker:${deckId}`),
    navigate: (section) => calls.push(`nav:${section}`),
  };
  return { target, calls };
}

describe('Convención F / J — resolución de teclas', () => {
  const deckA = { kind: 'deck', deckId: 'A' } as const;
  const deckB = { kind: 'deck', deckId: 'B' } as const;

  it('F / J + Espacio, ↑ / ↓ y Shift + ↑ / ↓ actúan solo sobre su deck', () => {
    assert.deepEqual(resolveShortcut(key('Space'), deckA), { type: 'play', deckId: 'A' });
    assert.deepEqual(resolveShortcut(key('Space'), deckB), { type: 'play', deckId: 'B' });
    assert.deepEqual(resolveShortcut(key('ArrowUp'), deckA), { type: 'volume', deckId: 'A', direction: 1 });
    assert.deepEqual(resolveShortcut(key('ArrowDown'), deckB), { type: 'volume', deckId: 'B', direction: -1 });
    assert.deepEqual(resolveShortcut(key('ArrowUp', { shiftKey: true }), deckA), { type: 'pitch-bend', deckId: 'A', direction: 1 });
    assert.deepEqual(resolveShortcut(key('ArrowDown', { shiftKey: true }), deckB), { type: 'pitch-bend', deckId: 'B', direction: -1 });
  });

  it('↑ / ↓ solas ajustan el Master; con Shift o una selectora de mezcla no hacen nada', () => {
    assert.deepEqual(resolveShortcut(key('ArrowUp')), { type: 'master', direction: 1 });
    assert.deepEqual(resolveShortcut(key('ArrowDown')), { type: 'master', direction: -1 });
    assert.equal(resolveShortcut(key('ArrowDown', { shiftKey: true })), null);
    assert.equal(resolveShortcut(key('ArrowUp'), { kind: 'mix', id: 'A.high' }), null);
    assert.equal(resolveShortcut(key('ArrowUp', { ctrlKey: true })), null);
    assert.equal('master' in DEFAULT_SHORTCUT_BINDINGS, false);
  });

  it('MUTE, grabación y selector de canciones por defecto', () => {
    assert.deepEqual(resolveShortcut(key('KeyB')), { type: 'mute' });
    assert.deepEqual(resolveShortcut(key('Digit5')), { type: 'record' });
    assert.deepEqual(resolveShortcut(key('KeyV')), { type: 'library', deckId: 'A' });
    assert.deepEqual(resolveShortcut(key('KeyN')), { type: 'library', deckId: 'B' });
    // 6 y Y ya no tienen atajo de consola; con Shift no actúan
    assert.equal(resolveShortcut(key('Digit6')), null);
    assert.equal(resolveShortcut(key('Digit6'), deckA), null);
    assert.equal(resolveShortcut(key('KeyY')), null);
    assert.equal(resolveShortcut(key('KeyB', { shiftKey: true })), null);
    assert.equal(resolveShortcut(key('KeyV', { shiftKey: true })), null);
  });

  it('Shift + ← / → cambian la curva; sin Shift mueven el crossfader', () => {
    assert.deepEqual(resolveShortcut(key('ArrowLeft', { shiftKey: true })), { type: 'crossfader-curve', direction: -1 });
    assert.deepEqual(resolveShortcut(key('ArrowRight', { shiftKey: true })), { type: 'crossfader-curve', direction: 1 });
    assert.deepEqual(resolveShortcut(key('ArrowLeft')), { type: 'crossfader', direction: -1 });
    assert.deepEqual(resolveShortcut(key('ArrowRight')), { type: 'crossfader', direction: 1 });
  });

  it('los atajos fijos de CUE, SYNC y Hot Cues se conservan', () => {
    assert.deepEqual(resolveShortcut(key('KeyQ')), { type: 'cue', deckId: 'A' });
    assert.deepEqual(resolveShortcut(key('KeyE')), { type: 'sync', deckId: 'A' });
    assert.deepEqual(resolveShortcut(key('KeyI')), { type: 'cue', deckId: 'B' });
    assert.deepEqual(resolveShortcut(key('KeyP')), { type: 'sync', deckId: 'B' });
    for (const [digit, slot] of [['1', 1], ['4', 4]] as const) {
      assert.deepEqual(resolveShortcut(key(`Digit${digit}`)), { type: 'hotcue', deckId: 'A', slot });
    }
    for (const [digit, slot] of [['7', 1], ['0', 4]] as const) {
      assert.deepEqual(resolveShortcut(key(`Digit${digit}`)), { type: 'hotcue', deckId: 'B', slot });
    }
  });

  it('selectoras de EQ / FILTER: W D A S para el Deck A y O Ñ K L para el Deck B', () => {
    assert.equal(DEFAULT_SHORTCUT_BINDINGS['A.high'], 'KeyW');
    assert.equal(DEFAULT_SHORTCUT_BINDINGS['A.mid'], 'KeyD');
    assert.equal(DEFAULT_SHORTCUT_BINDINGS['A.low'], 'KeyA');
    assert.equal(DEFAULT_SHORTCUT_BINDINGS['A.filter'], 'KeyS');
    assert.equal(DEFAULT_SHORTCUT_BINDINGS['B.high'], 'KeyO');
    assert.equal(DEFAULT_SHORTCUT_BINDINGS['B.mid'], 'Semicolon');
    assert.equal(DEFAULT_SHORTCUT_BINDINGS['B.low'], 'KeyK');
    assert.equal(DEFAULT_SHORTCUT_BINDINGS['B.filter'], 'KeyL');
    assert.equal(formatKeyCode('Semicolon'), 'Ñ');
    assert.deepEqual(
      resolveShortcut(key('ArrowRight'), { kind: 'mix', id: 'B.mid' }),
      { type: 'mix', deckId: 'B', param: 'mid', direction: 1 },
    );
    // El mapa predeterminado es válido: sin duplicados ni teclas reservadas
    assert.deepEqual(sanitizeShortcutBindings(DEFAULT_SHORTCUT_BINDINGS), DEFAULT_SHORTCUT_BINDINGS);
  });

  it('cada etiqueta de la tabla de referencia existe en español e inglés', () => {
    const locales = ['es', 'en'].map((lang) => JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), `src/i18n/locales/${lang}/translation.json`), 'utf-8'),
    ));
    for (const { labelKey } of KEYBOARD_SHORTCUTS) {
      for (const locale of locales) {
        const value = labelKey.split('.').reduce((node: Record<string, unknown> | undefined, part) => node?.[part] as Record<string, unknown> | undefined, locale);
        assert.equal(typeof value, 'string', labelKey);
      }
    }
  });
});

describe('Atajos de consola — manejadores', () => {
  it('F + Espacio y J + Espacio reproducen solo su deck; Espacio solo no hace nada', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown, onKeyUp } = createShortcutHandlers(target);
    const f = key('KeyF');
    onKeyDown(f);
    onKeyDown(key('Space'));
    onKeyUp(key('KeyF'));
    onKeyDown(key('KeyJ'));
    onKeyDown(key('Space'));
    onKeyUp(key('KeyJ'));
    const lone = key('Space');
    onKeyDown(lone);
    assert.equal(f.prevented, true);
    assert.equal(lone.prevented, false);
    assert.deepEqual(calls, ['play:A', 'play:B']);
  });

  it('F / J + ↑ / ↓ ajustan el volumen con autorrepetición y acotado a 0–100', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown, onKeyUp } = createShortcutHandlers(target);
    onKeyDown(key('KeyF'));
    onKeyDown(key('ArrowUp'));
    onKeyDown(key('ArrowUp', { repeat: true }));
    onKeyUp(key('KeyF'));
    onKeyDown(key('KeyJ'));
    onKeyDown(key('ArrowDown'));
    assert.deepEqual(calls, [`vol:A:${80 + VOLUME_KEY_STEP}`, `vol:A:${80 + 2 * VOLUME_KEY_STEP}`, `vol:B:${80 - VOLUME_KEY_STEP}`]);
  });

  it('Shift + F / J + ↑ / ↓ aplican el Pitch Bend momentáneo y lo sueltan al soltar la combinación', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown, onKeyUp, onBlur } = createShortcutHandlers(target);
    // Pulsado en el orden Shift → F → ↑: se suelta con la flecha
    onKeyDown(key('ShiftLeft', { shiftKey: true }));
    onKeyDown(key('KeyF', { shiftKey: true }));
    onKeyDown(key('ArrowUp', { shiftKey: true }));
    onKeyDown(key('ArrowUp', { shiftKey: true, repeat: true }));
    onKeyUp(key('ArrowUp', { shiftKey: true }));
    // Soltar la tecla del deck también lo libera
    onKeyDown(key('KeyJ', { shiftKey: true }));
    onKeyDown(key('ArrowDown', { shiftKey: true }));
    onKeyUp(key('KeyJ', { shiftKey: true }));
    onKeyUp(key('ArrowDown', { shiftKey: true }));
    // Perder el foco con el Pitch Bend activo lo libera
    onKeyDown(key('KeyF', { shiftKey: true }));
    onKeyDown(key('ArrowDown', { shiftKey: true }));
    onBlur();
    assert.deepEqual(calls, [
      'bend:A:up', 'bend:A:release',
      'bend:B:down', 'bend:B:release',
      'bend:A:down', 'bend:A:release',
    ]);
    assert.ok(!calls.some((call) => call.startsWith('vol:')), 'Shift + flecha nunca toca el volumen');
  });

  it('soltar Shift antes que la flecha libera el Pitch Bend sin pasar la autorrepetición al volumen', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown, onKeyUp } = createShortcutHandlers(target);
    onKeyDown(key('KeyF', { shiftKey: true }));
    onKeyDown(key('ArrowUp', { shiftKey: true }));
    onKeyUp(key('ShiftLeft'));
    onKeyDown(key('ArrowUp', { repeat: true }));
    onKeyDown(key('ArrowUp', { repeat: true }));
    onKeyUp(key('ArrowUp'));
    // Una pulsación nueva de F + ↑ ya es volumen
    onKeyDown(key('ArrowUp'));
    assert.deepEqual(calls, ['bend:A:up', 'bend:A:release', `vol:A:${80 + VOLUME_KEY_STEP}`]);
  });

  it('↑ / ↓ ajustan el Master con autorrepetición; B alterna MUTE una vez por pulsación', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown } = createShortcutHandlers(target);
    const up = key('ArrowUp');
    onKeyDown(up);
    onKeyDown(key('ArrowDown'));
    onKeyDown(key('ArrowDown', { repeat: true }));
    assert.equal(up.prevented, true);
    onKeyDown(key('KeyB'));
    onKeyDown(key('KeyB', { repeat: true }));
    onKeyDown(key('KeyB'));
    assert.deepEqual(calls, ['master:82', 'master:80', 'master:78', 'mute', 'mute']);
  });

  it('5 alterna la grabación sin repetirse al mantenerla; V / N muestran u ocultan el selector de su deck', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown } = createShortcutHandlers(target);
    onKeyDown(key('Digit5'));
    onKeyDown(key('Digit5', { repeat: true }));
    onKeyDown(key('Digit5', { repeat: true }));
    onKeyDown(key('KeyV'));
    onKeyDown(key('KeyV', { repeat: true }));
    onKeyDown(key('KeyV'));
    onKeyDown(key('KeyN'));
    assert.deepEqual(calls, ['record', 'picker:A', 'picker:A', 'picker:B']);
  });

  it('Shift + ← / → cambian la curva una vez por pulsación', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown } = createShortcutHandlers(target);
    onKeyDown(key('ArrowLeft', { shiftKey: true }));
    onKeyDown(key('ArrowRight', { shiftKey: true }));
    onKeyDown(key('ArrowRight', { shiftKey: true, repeat: true }));
    assert.deepEqual(calls, ['curve:-1', 'curve:1']);
  });

  it('las selectoras W / Ñ ajustan su parámetro y la navegación Shift + 5 / 6 no se ve afectada', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown, onKeyUp } = createShortcutHandlers(target);
    onKeyDown(key('KeyW'));
    onKeyDown(key('ArrowRight'));
    onKeyUp(key('KeyW'));
    onKeyDown(key('Semicolon'));
    onKeyDown(key('ArrowLeft'));
    onKeyUp(key('Semicolon'));
    onKeyDown(key('Digit5', { shiftKey: true }));
    onKeyDown(key('Digit6', { shiftKey: true }));
    assert.deepEqual(calls, [`mix:A.high:${50 + MIX_KEY_STEP}`, `mix:B.mid:${50 - MIX_KEY_STEP}`, 'nav:sessions', 'nav:settings']);
  });

  it('no actúa mientras se escribe en un campo de texto ni en el buscador del selector', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown } = createShortcutHandlers(target);
    const input = { tagName: 'INPUT' };
    onKeyDown(key('KeyF', { target: input }));
    onKeyDown(key('KeyV', { target: input }));
    onKeyDown(key('KeyN', { target: input }));
    onKeyDown(key('KeyB', { target: input }));
    onKeyDown(key('Digit5', { target: input }));

    onKeyDown(key('Digit5', { target: { tagName: 'UL', getAttribute: (name: string) => (name === 'role' ? 'listbox' : null) } }));
    // Las flechas sobre controles que las usan (deslizador nativo, pestañas, deslizador ARIA) no mueven el Master
    onKeyDown(key('ArrowUp', { target: input }));
    onKeyDown(key('ArrowUp', { target: { tagName: 'BUTTON', getAttribute: (name: string) => (name === 'role' ? 'tab' : null) } }));
    onKeyDown(key('ArrowDown', { target: { tagName: 'DIV', getAttribute: (name: string) => (name === 'role' ? 'slider' : null) } }));
    onKeyDown(key('ArrowDown', { defaultPrevented: true }));
    assert.deepEqual(calls, []);
    // Una pestaña enfocada solo se reserva las flechas: MUTE sigue funcionando
    onKeyDown(key('KeyB', { target: { tagName: 'BUTTON', getAttribute: (name: string) => (name === 'role' ? 'tab' : null) } }));
    assert.deepEqual(calls, ['mute']);
  });

  it('los comandos de consola reasignados se leen en cada pulsación', () => {
    const { target, calls } = recordingTarget();
    let bindings: ShortcutBindings = { ...DEFAULT_SHORTCUT_BINDINGS };
    const { onKeyDown } = createShortcutHandlers(target, () => bindings);
    bindings = { ...bindings, libraryA: 'KeyX', libraryB: 'KeyU', record: 'KeyR', mute: 'KeyM' };
    onKeyDown(key('KeyX'));
    onKeyDown(key('KeyV'));
    onKeyDown(key('KeyU'));
    onKeyDown(key('KeyR'));
    onKeyDown(key('Digit5'));
    onKeyDown(key('KeyM'));
    onKeyDown(key('KeyB'));
    assert.deepEqual(calls, ['picker:A', 'picker:B', 'record', 'mute']);
  });
});

describe('Atajos de consola — validación, persistencia y migración', () => {
  it('F y J están reservadas para los decks, también como teclas de navegación', () => {
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'A.gain', 'KeyF'), 'reserved');
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'record', 'KeyJ'), 'reserved');
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'mute', 'KeyE'), 'reserved');
    assert.equal(validateNavigationBinding(DEFAULT_NAVIGATION_BINDINGS, 'home', 'KeyF'), 'reserved');
    assert.equal(validateNavigationBinding(DEFAULT_NAVIGATION_BINDINGS, 'home', 'KeyJ'), 'reserved');
  });

  it('los comandos de consola no pueden repetir la tecla de una selectora', () => {
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'libraryA', 'KeyW'), 'duplicate');
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'libraryA', 'KeyN'), 'duplicate');
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'A.gain', 'KeyB'), 'duplicate');
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'libraryB', 'Digit8'), 'reserved');
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'libraryA', 'KeyX'), null);
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'A.mid', 'Semicolon'), 'duplicate');
    assert.equal(validateBinding(DEFAULT_SHORTCUT_BINDINGS, 'A.mid', 'Comma'), 'invalid');
  });

  it('una reasignación del selector de canciones persiste tras recargar', () => {
    const storage = memoryStorage();
    new SettingsStore(storage).update({ shortcutBindings: { ...DEFAULT_SHORTCUT_BINDINGS, libraryA: 'KeyX' } });
    const reloaded = new SettingsStore(storage).getSnapshot();
    assert.equal(reloaded.shortcutBindings.libraryA, 'KeyX');
    assert.equal(JSON.parse(storage.data[SETTINGS_STORAGE_KEY]).settingsVersion, SETTINGS_VERSION);
  });

  it('migra las selectoras predeterminadas antiguas y conserva las personalizadas', () => {
    const legacy = { ...LEGACY_SHORTCUT_BINDINGS, 'A.gain': 'KeyU' };
    const store = new SettingsStore(memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ settingsVersion: 2, shortcutBindings: legacy }),
    }));
    const bindings = store.getSnapshot().shortcutBindings;
    assert.equal(bindings['A.gain'], 'KeyU');
    assert.equal(bindings['A.high'], 'KeyW');
    assert.equal(bindings['A.filter'], 'KeyS');
    assert.equal(bindings['B.mid'], 'Semicolon');
    assert.equal(bindings['B.filter'], 'KeyL');
    assert.equal(bindings.libraryA, 'KeyV');
    assert.equal(bindings.libraryB, 'KeyN');
    assert.equal(bindings.mute, 'KeyB');
  });

  it('migra el MUTE predeterminado de la v3 (Y) a B y conserva un MUTE personalizado', () => {
    const v3 = { ...DEFAULT_SHORTCUT_BINDINGS, mute: 'KeyY', library: 'Digit6' };
    const legacy = new SettingsStore(memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ settingsVersion: 3, shortcutBindings: v3 }) }));
    assert.equal(legacy.getSnapshot().shortcutBindings.mute, 'KeyB');
    const custom = new SettingsStore(memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ settingsVersion: 3, shortcutBindings: { ...v3, mute: 'KeyM' } }) }));
    assert.equal(custom.getSnapshot().shortcutBindings.mute, 'KeyM');
  });

  it('una selectora personalizada que ahora es fija vuelve a su predeterminada', () => {
    const store = new SettingsStore(memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ settingsVersion: 2, shortcutBindings: { ...LEGACY_SHORTCUT_BINDINGS, 'A.low': 'KeyP' } }),
    }));
    assert.equal(store.getSnapshot().shortcutBindings['A.low'], 'KeyA');
  });

  it('la curva recorre CP → LIN → CUT de forma circular', () => {
    assert.equal(stepCrossfaderCurve('constant-power', 1), 'linear');
    assert.equal(stepCrossfaderCurve('linear', 1), 'cut');
    assert.equal(stepCrossfaderCurve('cut', 1), 'constant-power');
    assert.equal(stepCrossfaderCurve('constant-power', -1), 'cut');
    assert.equal(stepCrossfaderCurve('linear', -1), 'constant-power');
  });
});

describe('Atajos de consola — parámetros reales del DJ store', () => {
  beforeEach(() => {
    djStore.setChannelVolume('A', 80);
    djStore.setChannelVolume('B', 80);
    djStore.setMasterVolume(80);
    if (djStore.getSnapshot().isMasterMuted) djStore.toggleMasterMute();
    djStore.setCrossfaderCurve('constant-power');
  });

  it('F + ↑ modifica el volumen del canal A, no el Master ni el canal B', () => {
    const { onKeyDown, onKeyUp } = createShortcutHandlers(createDJShortcutTarget());
    onKeyDown(key('KeyF'));
    onKeyDown(key('ArrowUp'));
    onKeyUp(key('KeyF'));
    onKeyDown(key('KeyJ'));
    onKeyDown(key('ArrowDown'));
    onKeyDown(key('ArrowDown', { repeat: true }));
    const state = djStore.getSnapshot();
    assert.equal(state.mixer.channelA.volume, 80 + VOLUME_KEY_STEP);
    assert.equal(state.mixer.channelB.volume, 80 - 2 * VOLUME_KEY_STEP);
    assert.equal(state.masterVolume, 80);
  });

  it('↑ / ↓ modifican el Master real y B alterna su silencio sin perder el nivel', () => {
    const { onKeyDown, onKeyUp } = createShortcutHandlers(createDJShortcutTarget());
    onKeyDown(key('ArrowUp'));
    onKeyDown(key('ArrowUp', { repeat: true }));
    let state = djStore.getSnapshot();
    assert.equal(state.masterVolume, 80 + 2 * VOLUME_KEY_STEP);
    assert.equal(state.mixer.masterVolume, 80 + 2 * VOLUME_KEY_STEP);
    assert.equal(state.mixer.channelA.volume, 80);
    assert.equal(state.mixer.channelB.volume, 80);
    onKeyDown(key('KeyB'));
    assert.equal(djStore.getSnapshot().isMasterMuted, true);
    onKeyUp(key('KeyB'));
    onKeyDown(key('KeyB'));
    state = djStore.getSnapshot();
    assert.equal(state.isMasterMuted, false);
    assert.equal(state.masterVolume, 80 + 2 * VOLUME_KEY_STEP);
  });

  it('Shift + J + ↑ curva solo el Deck B y se retira al soltar', () => {
    const { onKeyDown, onKeyUp } = createShortcutHandlers(createDJShortcutTarget());
    onKeyDown(key('KeyJ', { shiftKey: true }));
    onKeyDown(key('ArrowUp', { shiftKey: true }));
    assert.ok(djStore.getSnapshot().deckB.pitchBend > 0);
    assert.equal(djStore.getSnapshot().deckA.pitchBend, 0);
    assert.equal(djStore.getSnapshot().mixer.channelB.volume, 80);
    onKeyUp(key('ArrowUp', { shiftKey: true }));
    assert.equal(djStore.getSnapshot().deckB.pitchBend, 0);
  });

  it('Shift + → / ← cambian la curva real del crossfader', () => {
    const { onKeyDown } = createShortcutHandlers(createDJShortcutTarget());
    onKeyDown(key('ArrowRight', { shiftKey: true }));
    assert.equal(djStore.getSnapshot().mixer.crossfaderCurve, 'linear');
    onKeyDown(key('ArrowRight', { shiftKey: true }));
    assert.equal(djStore.getSnapshot().mixer.crossfaderCurve, 'cut');
    onKeyDown(key('ArrowRight', { shiftKey: true }));
    assert.equal(djStore.getSnapshot().mixer.crossfaderCurve, 'constant-power');
    onKeyDown(key('ArrowLeft', { shiftKey: true }));
    assert.equal(djStore.getSnapshot().mixer.crossfaderCurve, 'cut');
  });

  it('S + → mueve el FILTER del Deck A sin tocar el crossfader', () => {
    const crossfader = djStore.getSnapshot().mixer.crossfader;
    const filter = djStore.getSnapshot().mixer.channelA.eq.filter;
    const { onKeyDown } = createShortcutHandlers(createDJShortcutTarget());
    onKeyDown(key('KeyS'));
    onKeyDown(key('ArrowRight'));
    assert.equal(djStore.getSnapshot().mixer.channelA.eq.filter, Math.min(100, filter + MIX_KEY_STEP));
    assert.equal(djStore.getSnapshot().mixer.crossfader, crossfader);
  });
});

/** Grabador real con relojes controlados y transporte simulado. */
function captureFixture() {
  let monotonic = 1_000;
  let wall = 1_700_000_000_000;
  const recorder = new SessionRecorder({ monotonicNow: () => monotonic, wallClockNow: () => wall });
  const flags = { playing: true, exportBusy: false };
  let starts = 0;
  const deps: SessionCaptureDeps = {
    start: () => {
      starts += 1;
      const session = recorder.start();
      recorder.record({ type: 'mixer.master-gain', gainLinear: 0.8 });
      return session;
    },
    finalize: () => recorder.finalize(),
    isActive: () => recorder.isActive,
    getSession: () => recorder.getSession(),
    isAudioPlaying: () => flags.playing,
    isExportBusy: () => flags.exportBusy,
  };
  return {
    control: new SessionCaptureControl(deps),
    recorder,
    flags,
    advance: (ms: number) => { monotonic += ms; wall += ms; },
    startCount: () => starts,
  };
}

describe('Grabación de sesión — control compartido', () => {
  it('alterna inicio / fin, publica el estado y conserva la duración real', () => {
    const { control, advance } = captureFixture();
    const seen: boolean[] = [];
    control.subscribe(() => seen.push(control.getSnapshot().active));
    assert.deepEqual(control.getSnapshot(), { active: false, startedAtEpochMs: null, durationMs: null });

    const started = control.toggle();
    assert.equal(started.status, 'started');
    assert.equal(control.getSnapshot().active, true);
    assert.equal(control.getSnapshot().durationMs, null);

    advance(42_000);
    const stopped = control.toggle();
    assert.equal(stopped.status, 'saved');
    assert.equal(control.getSnapshot().active, false);
    assert.equal(control.getSnapshot().durationMs, 42_000);
    assert.deepEqual(seen, [true, false]);
  });

  it('nunca inicia dos capturas a la vez', () => {
    const { control, startCount } = captureFixture();
    control.start();
    const again = control.start();
    assert.deepEqual(again, { status: 'blocked', reason: 'already-active' });
    assert.equal(startCount(), 1);
  });

  it('respeta las reglas de Sesiones: sin audio o con una exportación en curso no inicia', () => {
    const { control, flags, startCount } = captureFixture();
    flags.playing = false;
    assert.deepEqual(control.toggle(), { status: 'blocked', reason: 'no-audio' });
    flags.playing = true;
    flags.exportBusy = true;
    assert.deepEqual(control.toggle(), { status: 'blocked', reason: 'export-busy' });
    assert.equal(startCount(), 0);
    assert.equal(control.getSnapshot().active, false);
  });

  it('una nueva grabación reinicia el contador a partir de su propio inicio', () => {
    const { control, advance } = captureFixture();
    control.start();
    advance(10_000);
    control.stop();
    const firstStart = control.getSnapshot().startedAtEpochMs;
    advance(5_000);
    control.start();
    const snapshot = control.getSnapshot();
    assert.equal(snapshot.active, true);
    assert.equal(snapshot.durationMs, null);
    assert.equal(snapshot.startedAtEpochMs, firstStart! + 15_000);
  });

  it('solo informa «guardada» cuando el grabador devuelve una sesión exportable', () => {
    const recorder = new SessionRecorder({ monotonicNow: () => 0, wallClockNow: () => 0 });
    const control = new SessionCaptureControl({
      start: () => recorder.start(),
      finalize: () => recorder.finalize(),
      isActive: () => recorder.isActive,
      getSession: () => recorder.getSession(),
      isAudioPlaying: () => true,
      isExportBusy: () => false,
    });
    control.start();
    assert.deepEqual(control.stop(), { status: 'empty' });
  });

  it('un fallo del grabador se devuelve como error sin dejar un estado incoherente', () => {
    const control = new SessionCaptureControl({
      start: () => { throw new Error('boom'); },
      finalize: () => null,
      isActive: () => false,
      getSession: () => null,
      isAudioPlaying: () => true,
      isExportBusy: () => false,
    });
    const result = control.start();
    assert.equal(result.status, 'error');
    assert.equal(control.getSnapshot().active, false);
  });
});

describe('Botones LOAD de la pantalla digital — atajos V / N', () => {
  it('solo actúan con la pantalla montada (dentro del Mixer)', () => {
    digitalScreenStore.reset();
    const target = createDJShortcutTarget();
    assert.equal(target.pressLoadButton!('A'), false);
    assert.equal(digitalScreenStore.getSnapshot().view, 'normal');
    const detach = digitalScreenStore.attach();
    assert.equal(target.pressLoadButton!('A'), true);
    assert.equal(digitalScreenStore.getSnapshot().view, 'menu');
    assert.equal(target.isNavigationCaptured!(), true);
    detach();
    assert.equal(digitalScreenStore.getSnapshot().view, 'normal');
    assert.equal(target.isNavigationCaptured!(), false);
    assert.equal(target.pressLoadButton!('B'), false);
  });
});

describe('Consola — integración visual e i18n', () => {
  const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');

  it('la carga y REC viven en la pantalla digital, no en la consola; Sesiones usa el control compartido', () => {
    const consoleCode = read('src/components/dj/organisms/MixerConsole.tsx');
    assert.doesNotMatch(consoleCode, /ConsoleTrackPicker|ConsoleRecPanel|mixer-deckbar/);
    for (const removed of ['ConsoleTrackPicker.tsx', 'ConsoleRecPanel.tsx']) {
      assert.equal(fs.existsSync(path.resolve(process.cwd(), 'src/components/dj', removed)), false, removed);
    }
    // Los atajos se consultan en Ajustes: la pantalla no muestra teclas (V / N, 5)
    for (const file of [
      'src/components/dj/organisms/MixerConsole.tsx',
      'src/components/dj/organisms/DigitalScreen.tsx',
      'src/components/dj/molecules/ScreenButtonRow.tsx',
    ]) {
      // Solo el código: los comentarios pueden mencionar el atajo sin mostrarlo
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.doesNotMatch(code, /formatKeyCode|DECK_KEY_CODES|<kbd|F \+ 6|J \+ 6/, file);
    }
    const screenCode = read('src/components/dj/organisms/DigitalScreen.tsx');
    assert.match(screenCode, /toggleSessionCaptureWithFeedback\(\)/);
    const loadCode = read('src/services/console/libraryLoadFeedback.ts');
    assert.match(loadCode, /loadTrackToDeck\(deckId, track\)/);
    assert.match(loadCode, /indexedDBStorage\.getAllTracks\(\)/);
    const sessionsCode = read('src/pages/Sessions.tsx');
    assert.match(sessionsCode, /sessionCaptureControl\.subscribe/);
    assert.match(sessionsCode, /sessionCaptureControl\.start\(\)/);
    assert.match(sessionsCode, /sessionCaptureControl\.stop\(\)/);
  });

  it('los textos nuevos existen en español e inglés', () => {
    const es = JSON.parse(read('src/i18n/locales/es/translation.json'));
    const en = JSON.parse(read('src/i18n/locales/en/translation.json'));
    const mixerKeys = Object.keys(es.mixer).filter((k) => k.startsWith('rec_') || k.startsWith('picker_'));
    assert.ok(mixerKeys.length >= 10);
    for (const k of mixerKeys) assert.equal(typeof en.mixer[k], 'string', `mixer.${k}`);
    assert.equal(en.mixer.rec_saved, 'Session saved');
    assert.equal(es.mixer.rec_saved, 'Sesión guardada');
    for (const id of ['mute', 'record', 'libraryA', 'libraryB']) {
      assert.equal(typeof es.settings.shortcuts_console[id], 'string');
      assert.equal(typeof en.settings.shortcuts_console[id], 'string');
    }
    for (const k of ['shortcuts_console_title', 'shortcuts_console_desc', 'shortcuts_console_binding_aria', 'shortcuts_nav_binding_reserved', 'shortcuts_mixer_group', 'shortcuts_mixer_short']) {
      assert.equal(typeof es.settings[k], 'string', k);
      assert.equal(typeof en.settings[k], 'string', k);
    }
    // Cada motivo de bloqueo que puede mostrarse tiene su texto
    for (const reason of ['no_audio', 'export_busy']) {
      assert.equal(typeof es.mixer[`rec_blocked_${reason}`], 'string');
      assert.equal(typeof en.mixer[`rec_blocked_${reason}`], 'string');
    }
  });
});
