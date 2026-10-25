/**
 * SYSTEM DJ — Test Suite: Ajustes y Atajos de Teclado
 * Saneamiento y persistencia de preferencias, tokens de apariencia, traducción de teclas
 * a acciones del DJ y efecto del rango de pitch / modo CUE en el DJ store.
 */

import 'fake-indexeddb/auto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  ACCENT_COLORS,
  ACCENT_HUES,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  SettingsStore,
  sanitizeSettings,
  type SettingsStorage,
} from '../src/store/useSettingsStore.ts';
import { applyAppearanceToRoot } from '../src/services/settings/appearance.ts';
import {
  CROSSFADER_KEY_STEP,
  KEYBOARD_SHORTCUTS,
  createShortcutHandlers,
  resolveShortcut,
  type ShortcutTarget,
} from '../src/services/keyboard/keyboardShortcuts.ts';
import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import type { DeckId } from '../src/types/deck.ts';

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => { data[key] = value; },
  };
}

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

describe('SettingsStore — saneamiento y persistencia', () => {
  it('descarta valores desconocidos y conserva los válidos', () => {
    const result = sanitizeSettings({ theme: 'dark', accentColor: 'pink', pitchRange: 0.5, bufferSize: 1024, shortcutsEnabled: 'yes' });
    assert.equal(result.theme, 'dark');
    assert.equal(result.accentColor, DEFAULT_SETTINGS.accentColor);
    assert.equal(result.pitchRange, DEFAULT_SETTINGS.pitchRange);
    assert.equal(result.bufferSize, 1024);
    assert.equal(result.shortcutsEnabled, DEFAULT_SETTINGS.shortcutsEnabled);
    assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  });

  it('carga desde el almacenamiento y tolera JSON corrupto', () => {
    const stored = new SettingsStore(memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ cueMode: 'standard', language: 'en' }) }));
    assert.equal(stored.getSnapshot().cueMode, 'standard');
    assert.equal(stored.getSnapshot().language, 'en');
    const corrupt = new SettingsStore(memoryStorage({ [SETTINGS_STORAGE_KEY]: '{not json' }));
    assert.deepEqual(corrupt.getSnapshot(), DEFAULT_SETTINGS);
  });

  it('persiste cambios y notifica solo cuando algo cambia', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    const calls: string[] = [];
    store.subscribe((next, previous) => calls.push(`${previous.crossfaderCurve}->${next.crossfaderCurve}`));

    store.update({ crossfaderCurve: 'cut', autoTransitionBeats: 32 });
    store.update({ crossfaderCurve: 'cut' });

    assert.deepEqual(calls, ['constant-power->cut']);
    const persisted = JSON.parse(storage.data[SETTINGS_STORAGE_KEY]);
    assert.equal(persisted.crossfaderCurve, 'cut');
    assert.equal(persisted.autoTransitionBeats, 32);
    assert.equal(new SettingsStore(storage).getSnapshot().autoTransitionBeats, 32);
  });

  it('migra el violeta heredado sin versión al naranja y respeta los demás acentos', () => {
    const legacyDefault = new SettingsStore(memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ accentColor: 'violet', theme: 'dark' }) }));
    assert.equal(legacyDefault.getSnapshot().accentColor, 'orange');
    assert.equal(legacyDefault.getSnapshot().theme, 'dark');
    const legacyChoice = new SettingsStore(memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ accentColor: 'neon' }) }));
    assert.equal(legacyChoice.getSnapshot().accentColor, 'neon');

    // Una elección de violeta guardada con la versión actual se conserva tras recargar
    const storage = memoryStorage();
    new SettingsStore(storage).update({ accentColor: 'violet' });
    assert.equal(JSON.parse(storage.data[SETTINGS_STORAGE_KEY]).settingsVersion, SETTINGS_VERSION);
    assert.equal(new SettingsStore(storage).getSnapshot().accentColor, 'violet');
  });

  it('persiste Animaciones y el modo experimental, legibles antes de recargar', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    store.update({ animations: false, experimentalInterface: true });
    assert.equal(store.readPersisted()?.experimentalInterface, true);
    const reloaded = new SettingsStore(storage).getSnapshot();
    assert.equal(reloaded.animations, false);
    assert.equal(reloaded.experimentalInterface, true);
    // Sin almacenamiento no hay nada que leer: el modo experimental no debe recargar
    assert.equal(new SettingsStore(null).readPersisted(), null);
  });

  it('funciona sin almacenamiento disponible', () => {
    const store = new SettingsStore(null);
    store.update({ autoAnalyzeOnImport: false });
    assert.equal(store.getSnapshot().autoAnalyzeOnImport, false);
  });
});

describe('Apariencia — tokens en el elemento raíz', () => {
  it('aplica tema, densidad y acento mediante atributos y variables CSS', () => {
    const attributes: Record<string, string> = {};
    const properties: Record<string, string> = {};
    const root = {
      setAttribute: (name: string, value: string) => { attributes[name] = value; },
      style: { setProperty: (name: string, value: string) => { properties[name] = value; } },
    } as unknown as HTMLElement;

    applyAppearanceToRoot({ theme: 'dark', density: 'compact', accentColor: 'cyan', animations: false, experimentalInterface: true }, root);

    assert.equal(attributes['data-theme'], 'dark');
    assert.equal(attributes['data-density'], 'compact');
    assert.equal(attributes['data-accent'], 'cyan');
    assert.equal(attributes['data-animations'], 'off');
    assert.equal(attributes['data-interface'], 'experimental');
    assert.equal(properties['--hue-primary'], String(ACCENT_HUES.cyan));
    assert.equal(properties['--color-accent'], 'var(--sd-accent)');
  });

  it('cada acento tiene su bloque de tokens y el naranja es el predeterminado', () => {
    const tokens = fs.readFileSync(new URL('../src/design-system/tokens.css', import.meta.url), 'utf8');
    for (const color of ACCENT_COLORS) {
      assert.match(tokens, new RegExp(`\\[data-accent='${color}'\\]\\s*\\{[^}]*--sd-accent:`), `falta [data-accent='${color}']`);
    }
    assert.equal(DEFAULT_SETTINGS.accentColor, 'orange');
    assert.equal(DEFAULT_SETTINGS.animations, true);
    assert.equal(DEFAULT_SETTINGS.experimentalInterface, false);
  });
});

describe('Atajos de teclado — resolución de teclas', () => {
  it('mapea las 10 entradas de la tabla de referencia', () => {
    assert.equal(KEYBOARD_SHORTCUTS.length, 10);
    assert.deepEqual(resolveShortcut(key('Space')), { type: 'play', deckId: 'A' });
    assert.deepEqual(resolveShortcut(key('Space', { shiftKey: true })), { type: 'play', deckId: 'B' });
    assert.deepEqual(resolveShortcut(key('KeyQ')), { type: 'cue', deckId: 'A' });
    assert.deepEqual(resolveShortcut(key('KeyW')), { type: 'sync', deckId: 'A' });
    assert.deepEqual(resolveShortcut(key('KeyO')), { type: 'cue', deckId: 'B' });
    assert.deepEqual(resolveShortcut(key('KeyP')), { type: 'sync', deckId: 'B' });
    assert.deepEqual(resolveShortcut(key('ArrowLeft')), { type: 'crossfader', direction: -1 });
    assert.deepEqual(resolveShortcut(key('ArrowRight')), { type: 'crossfader', direction: 1 });
    assert.deepEqual(resolveShortcut(key('Digit1')), { type: 'hotcue', deckId: 'A', slot: 1 });
    assert.deepEqual(resolveShortcut(key('Digit4')), { type: 'hotcue', deckId: 'A', slot: 4 });
    assert.deepEqual(resolveShortcut(key('Digit7')), { type: 'hotcue', deckId: 'B', slot: 1 });
    assert.deepEqual(resolveShortcut(key('Digit0')), { type: 'hotcue', deckId: 'B', slot: 4 });
  });

  it('ignora teclas no mapeadas y combinaciones del sistema', () => {
    assert.equal(resolveShortcut(key('Digit5')), null);
    assert.equal(resolveShortcut(key('KeyA')), null);
    assert.equal(resolveShortcut(key('KeyQ', { ctrlKey: true })), null);
    assert.equal(resolveShortcut(key('Space', { metaKey: true })), null);
    assert.equal(resolveShortcut(key('KeyQ', { shiftKey: true })), null);
  });
});

function recordingTarget(initialCrossfader = 50, hotCues: Record<DeckId, number[]> = { A: [], B: [] }) {
  const calls: string[] = [];
  let crossfader = initialCrossfader;
  const target: ShortcutTarget = {
    togglePlayDeck: (deckId) => calls.push(`play:${deckId}`),
    handleCueDown: (deckId) => calls.push(`cueDown:${deckId}`),
    handleCueUp: (deckId) => calls.push(`cueUp:${deckId}`),
    toggleSync: (deckId) => calls.push(`sync:${deckId}`),
    getCrossfader: () => crossfader,
    setCrossfader: (position) => { crossfader = position; calls.push(`xf:${position}`); },
    hasHotCue: (deckId, slot) => hotCues[deckId].includes(slot),
    jumpToHotCue: (deckId, slot) => calls.push(`jump:${deckId}${slot}`),
    setHotCue: (deckId, slot) => calls.push(`set:${deckId}${slot}`),
  };
  return { target, calls };
}

describe('Atajos de teclado — manejadores', () => {
  it('ejecuta acciones, CUE momentáneo y evita el desplazamiento de la página', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown, onKeyUp } = createShortcutHandlers(target);
    const space = key('Space');
    onKeyDown(space);
    onKeyDown(key('KeyQ'));
    onKeyUp(key('KeyQ'));
    onKeyDown(key('KeyP'));
    assert.equal(space.prevented, true);
    assert.deepEqual(calls, ['play:A', 'cueDown:A', 'cueUp:A', 'sync:B']);
  });

  it('suelta el CUE al perder el foco y no repite acciones al mantener la tecla', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown, onBlur } = createShortcutHandlers(target);
    onKeyDown(key('KeyO'));
    onKeyDown(key('KeyO', { repeat: true }));
    onKeyDown(key('Space', { repeat: true }));
    onBlur();
    assert.deepEqual(calls, ['cueDown:B', 'cueUp:B']);
  });

  it('mueve el crossfader por pasos acotados a 0–100, también con autorrepetición', () => {
    const { target, calls } = recordingTarget(97);
    const { onKeyDown } = createShortcutHandlers(target);
    onKeyDown(key('ArrowRight'));
    onKeyDown(key('ArrowLeft', { repeat: true }));
    assert.deepEqual(calls, ['xf:100', `xf:${100 - CROSSFADER_KEY_STEP}`]);
  });

  it('salta a un Hot Cue existente o lo crea si el slot está vacío', () => {
    const { target, calls } = recordingTarget(50, { A: [2], B: [] });
    const { onKeyDown } = createShortcutHandlers(target);
    onKeyDown(key('Digit2'));
    onKeyDown(key('Digit9'));
    assert.deepEqual(calls, ['jump:A2', 'set:B3']);
  });

  it('no actúa al escribir en campos ni cuando un control ya gestionó la tecla', () => {
    const { target, calls } = recordingTarget();
    const { onKeyDown } = createShortcutHandlers(target);
    onKeyDown(key('Space', { target: { tagName: 'INPUT' } }));
    onKeyDown(key('KeyQ', { target: { tagName: 'DIV', isContentEditable: true } }));
    onKeyDown(key('Space', { defaultPrevented: true }));
    // Casillas y selectores ARIA (Biblioteca, Playlists) usan Espacio como un control nativo
    onKeyDown(key('Space', { target: { tagName: 'BUTTON', getAttribute: (name: string) => (name === 'role' ? 'checkbox' : null) } }));
    onKeyDown(key('Space', { target: { tagName: 'BUTTON', getAttribute: (name: string) => (name === 'role' ? 'combobox' : null) } }));
    assert.deepEqual(calls, []);
    // Un botón corriente sigue sin bloquear el atajo de reproducción
    onKeyDown(key('Space', { target: { tagName: 'BUTTON', getAttribute: () => null } }));
    assert.deepEqual(calls, ['play:A']);
  });
});

describe('DJ store — rango de pitch y modo CUE configurables', () => {
  it('ajusta el rango del fader y la velocidad resultante', () => {
    try {
      djStore.setPitchRange(0.16);
      assert.equal(djStore.getPitchRange(), 0.16);
      assert.equal(audioEngine.getPitchRange(), 0.16);
      djStore.setPitchDeck('A', 100);
      assert.equal(djStore.getSnapshot().deckA.playbackRate, 1.16);

      // Al reducir el rango la velocidad se recorta y el fader se recoloca en el extremo
      djStore.setPitchRange(0.06);
      assert.equal(djStore.getSnapshot().deckA.playbackRate, 1.06);
      assert.equal(djStore.getSnapshot().deckA.pitch, 100);

      djStore.setPitchRange(0.5);
      assert.equal(djStore.getPitchRange(), 0.06, 'rangos no admitidos se ignoran');
    } finally {
      djStore.setPitchRange(0.08);
      djStore.setPitchDeck('A', 50);
    }
  });

  it('el motor acota playbackRate al rango configurado', () => {
    try {
      audioEngine.setPitchRange(0.16);
      assert.equal(audioEngine.calculateEffectiveRate(1.2), 1.16);
      audioEngine.setPitchRange(0.08);
      assert.equal(audioEngine.calculateEffectiveRate(1.2), 1.08);
    } finally {
      audioEngine.setPitchRange(0.08);
    }
  });

  it('expone el modo del botón CUE', () => {
    djStore.setCueMode('standard');
    assert.equal(djStore.getCueMode(), 'standard');
    djStore.setCueMode('cdj');
    assert.equal(djStore.getCueMode(), 'cdj');
  });
});
