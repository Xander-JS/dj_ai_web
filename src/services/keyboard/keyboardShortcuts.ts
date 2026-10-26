/**
 * SYSTEM DJ — Global Keyboard Shortcuts
 * Un único par de oyentes keydown/keyup en `window` que traduce teclas físicas
 * (`KeyboardEvent.code`, independiente de la distribución del teclado) a acciones del DJ.
 *
 * Reglas:
 * - Se ignoran las teclas escritas en campos editables, las ya gestionadas por un control
 *   enfocado y las combinaciones con Ctrl/Alt/Meta.
 * - ↑ / ↓ solas ajustan el volumen Master (único atajo del Master).
 * - F identifica al Deck A y J al Deck B (fijas): mantenidas, Espacio reproduce/pausa ese deck,
 *   ↑ / ↓ ajustan su volumen y Shift + ↑ / ↓ aplican su Pitch Bend momentáneo.
 * - CUE y Pitch Bend son momentáneos: keydown los inicia y keyup los libera; perder el foco los cancela.
 * - ← / → mueven el crossfader y Shift + ← / → cambian su curva; mientras se mantiene una tecla
 *   selectora de mezcla (GAIN, HI, MID, LOW, FILTER de cada deck, reasignables) ajustan ese parámetro.
 * - Comandos de consola reasignables: MUTE (B), grabación de sesión (5) y mostrar / ocultar el
 *   selector de canciones de cada deck (V para el Deck A, N para el Deck B).
 * - Shift + tecla de sección (1–7 por defecto, reasignables) abre Inicio, Biblioteca,
 *   Playlists, Mixer, Sesiones, Ajustes o Mi perfil; se resuelve antes que las selectoras de mezcla.
 * - Al desactivar los atajos se retiran los oyentes, sin coste residual.
 */

import type { DeckId } from '../../types/deck';

export type ShortcutAction =
  | { type: 'play'; deckId: DeckId }
  | { type: 'cue'; deckId: DeckId }
  | { type: 'sync'; deckId: DeckId }
  | { type: 'crossfader'; direction: -1 | 1 }
  | { type: 'crossfader-curve'; direction: -1 | 1 }
  | { type: 'hotcue'; deckId: DeckId; slot: number }
  | { type: 'mix'; deckId: DeckId; param: MixParam; direction: -1 | 1 }
  | { type: 'volume'; deckId: DeckId; direction: -1 | 1 }
  | { type: 'pitch-bend'; deckId: DeckId; direction: -1 | 1 }
  | { type: 'master'; direction: -1 | 1 }
  | { type: 'mute' }
  | { type: 'record' }
  | { type: 'library'; deckId: DeckId };

/** Secciones principales de la consola alcanzables con Shift + tecla, en el orden de la barra lateral. */
export type NavSection = 'home' | 'library' | 'playlists' | 'mixer' | 'sessions' | 'settings' | 'profile';
export const NAV_SECTIONS: readonly NavSection[] = ['home', 'library', 'playlists', 'mixer', 'sessions', 'settings', 'profile'];
/** Ruta de cada sección (la clave de traducción es `navigation.<sección>`). */
export const NAV_SECTION_PATHS: Record<NavSection, string> = {
  home: '/dashboard',
  library: '/library',
  playlists: '/playlists',
  mixer: '/mixer',
  sessions: '/sessions',
  settings: '/settings',
  profile: '/profile',
};
/** Tecla de cada sección como `KeyboardEvent.code`; siempre se combina con Shift. */
export type NavigationBindings = Record<NavSection, string>;
export const DEFAULT_NAVIGATION_BINDINGS: NavigationBindings = {
  home: 'Digit1',
  library: 'Digit2',
  playlists: 'Digit3',
  mixer: 'Digit4',
  sessions: 'Digit5',
  settings: 'Digit6',
  profile: 'Digit7',
};

/** Paso del crossfader por pulsación (escala 0–100). */
export const CROSSFADER_KEY_STEP = 5;
/** Paso de GAIN / EQ / FILTER por pulsación (escala 0–100, centro 50). */
export const MIX_KEY_STEP = 2;
/** Paso del volumen de canal y del Master por pulsación (escala 0–100). */
export const VOLUME_KEY_STEP = 2;

/** Teclas fijas que identifican a cada deck en las combinaciones (F = Deck A, J = Deck B). */
export const DECK_KEY_CODES: Readonly<Record<DeckId, string>> = { A: 'KeyF', B: 'KeyJ' };

/** Parámetros de mezcla ajustables con tecla selectora + ← / →. */
export type MixParam = 'gain' | 'high' | 'mid' | 'low' | 'filter';
export const MIX_PARAMS: readonly MixParam[] = ['gain', 'high', 'mid', 'low', 'filter'];

/** Comando reasignable: `A.gain`, `B.filter`, … */
export type MixShortcutId = `${DeckId}.${MixParam}`;
/** Comandos de consola reasignables; actúan al pulsarse, sin tecla mantenida. */
export type ConsoleShortcutId = 'mute' | 'record' | 'libraryA' | 'libraryB';
export type ShortcutId = MixShortcutId | ConsoleShortcutId;
/** Tecla de cada comando, como `KeyboardEvent.code` (p. ej. `KeyG`). */
export type ShortcutBindings = Record<ShortcutId, string>;

export const MIX_SHORTCUT_IDS: readonly MixShortcutId[] = (['A', 'B'] as const).flatMap(
  (deckId) => MIX_PARAMS.map((param) => `${deckId}.${param}` as MixShortcutId),
);
export const CONSOLE_SHORTCUT_IDS: readonly ConsoleShortcutId[] = ['mute', 'record', 'libraryA', 'libraryB'];
export const SHORTCUT_IDS: readonly ShortcutId[] = [...MIX_SHORTCUT_IDS, ...CONSOLE_SHORTCUT_IDS];

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = {
  'A.gain': 'KeyG',
  'A.high': 'KeyW',
  'A.mid': 'KeyD',
  'A.low': 'KeyA',
  'A.filter': 'KeyS',
  'B.gain': 'KeyH',
  'B.high': 'KeyO',
  // `Semicolon` es la tecla física de la Ñ en la distribución española
  'B.mid': 'Semicolon',
  'B.low': 'KeyK',
  'B.filter': 'KeyL',
  mute: 'KeyB',
  record: 'Digit5',
  libraryA: 'KeyV',
  libraryB: 'KeyN',
};

/**
 * Selectoras predeterminadas hasta la v2 de las preferencias. Como el mapa completo se guarda,
 * quien nunca las cambió las conserva en localStorage; la migración las sustituye por las nuevas.
 */
export const LEGACY_SHORTCUT_BINDINGS: Readonly<Record<MixShortcutId, string>> = {
  'A.gain': 'KeyG',
  'A.high': 'KeyE',
  'A.mid': 'KeyD',
  'A.low': 'KeyC',
  'A.filter': 'KeyF',
  'B.gain': 'KeyH',
  'B.high': 'KeyI',
  'B.mid': 'KeyK',
  'B.low': 'KeyM',
  'B.filter': 'KeyJ',
};

/** Tabla de referencia mostrada en Ajustes → Atajos; el sufijo agrupa por deck (_a, _b) o consola (_mix). */
export const KEYBOARD_SHORTCUTS: readonly { keys: string; labelKey: string }[] = [
  { keys: 'F + Space', labelKey: 'settings.shortcuts.play_a' },
  { keys: 'F + ↑ / ↓', labelKey: 'settings.shortcuts.volume_a' },
  { keys: 'Shift + F + ↑ / ↓', labelKey: 'settings.shortcuts.pitch_bend_a' },
  { keys: 'Q', labelKey: 'settings.shortcuts.cue_a' },
  { keys: 'E', labelKey: 'settings.shortcuts.sync_a' },
  { keys: '1 – 4', labelKey: 'settings.shortcuts.hotcues_a' },
  { keys: 'J + Space', labelKey: 'settings.shortcuts.play_b' },
  { keys: 'J + ↑ / ↓', labelKey: 'settings.shortcuts.volume_b' },
  { keys: 'Shift + J + ↑ / ↓', labelKey: 'settings.shortcuts.pitch_bend_b' },
  { keys: 'I', labelKey: 'settings.shortcuts.cue_b' },
  { keys: 'P', labelKey: 'settings.shortcuts.sync_b' },
  { keys: '7 – 0', labelKey: 'settings.shortcuts.hotcues_b' },
  { keys: '←', labelKey: 'settings.shortcuts.crossfader_a_mix' },
  { keys: '→', labelKey: 'settings.shortcuts.crossfader_b_mix' },
  { keys: 'Shift + ← / →', labelKey: 'settings.shortcuts.crossfader_curve_mix' },
  { keys: '↑ / ↓', labelKey: 'settings.shortcuts.master_mix' },
];

const DECK_B_HOT_CUE_CODES: readonly string[] = ['Digit7', 'Digit8', 'Digit9', 'Digit0'];

/** Teclas de atajos fijos; no pueden usarse como selectoras ni comandos reasignables. */
export const RESERVED_SHORTCUT_CODES: readonly string[] = [
  'Space', 'KeyQ', 'KeyE', 'KeyI', 'KeyP', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  DECK_KEY_CODES.A, DECK_KEY_CODES.B,
  'Digit1', 'Digit2', 'Digit3', 'Digit4', ...DECK_B_HOT_CUE_CODES,
];

export type BindingError = 'invalid' | 'reserved' | 'duplicate';

/** Letras, dígitos y la Ñ (`Semicolon`) libres pueden asignarse a un comando. */
export function validateBinding(
  bindings: ShortcutBindings,
  id: ShortcutId,
  code: string,
): BindingError | null {
  if (!/^(Key[A-Z]|Digit[0-9]|Semicolon)$/.test(code)) return 'invalid';
  if (RESERVED_SHORTCUT_CODES.includes(code)) return 'reserved';
  if (SHORTCUT_IDS.some((other) => other !== id && bindings[other] === code)) return 'duplicate';
  return null;
}

/**
 * Teclas de navegación: letra o dígito, distinta de las demás secciones. Como siempre van con
 * Shift no chocan con los atajos fijos ni con las selectoras de mezcla, que se usan sin Shift.
 * F y J sí se reservan: Shift + F / J + ↑ / ↓ es el Pitch Bend de cada deck.
 */
export function validateNavigationBinding(
  bindings: NavigationBindings,
  section: NavSection,
  code: string,
): BindingError | null {
  if (!/^(Key[A-Z]|Digit[0-9])$/.test(code)) return 'invalid';
  if (code === DECK_KEY_CODES.A || code === DECK_KEY_CODES.B) return 'reserved';
  if (NAV_SECTIONS.some((other) => other !== section && bindings[other] === code)) return 'duplicate';
  return null;
}

export function sanitizeNavigationBindings(raw: unknown): NavigationBindings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<NavSection, unknown>>;
  const result = { ...DEFAULT_NAVIGATION_BINDINGS };
  for (const section of NAV_SECTIONS) {
    const code = source[section];
    if (typeof code === 'string') result[section] = code;
  }
  const valid = NAV_SECTIONS.every((section) => validateNavigationBinding(result, section, result[section]) === null);
  return valid ? result : { ...DEFAULT_NAVIGATION_BINDINGS };
}

/** Sección asociada a Shift + tecla, o null. */
export function resolveNavigationShortcut(event: ShortcutKeyEvent, bindings: NavigationBindings): NavSection | null {
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null;
  return NAV_SECTIONS.find((section) => bindings[section] === event.code) ?? null;
}

/** Normaliza asignaciones guardadas: una entrada inválida o repetida vuelve a su tecla por defecto. */
export function sanitizeShortcutBindings(raw: unknown): ShortcutBindings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<ShortcutId, unknown>>;
  const result = { ...DEFAULT_SHORTCUT_BINDINGS };
  for (const id of SHORTCUT_IDS) {
    const code = source[id];
    if (typeof code === 'string') result[id] = code;
  }
  for (const id of SHORTCUT_IDS) {
    if (validateBinding(result, id, result[id])) result[id] = DEFAULT_SHORTCUT_BINDINGS[id];
  }
  // Restaurar una entrada puede chocar con otra personalizada: en ese caso se vuelve al mapa por defecto
  const valid = SHORTCUT_IDS.every((id) => validateBinding(result, id, result[id]) === null);
  return valid ? result : { ...DEFAULT_SHORTCUT_BINDINGS };
}

/**
 * Sustituye las selectoras que siguen en su valor predeterminado anterior (v2) por las actuales;
 * las personalizadas se conservan y sanitizeShortcutBindings resuelve las que ahora choquen.
 */
export function migrateLegacyShortcutBindings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const source = { ...(raw as Record<string, unknown>) };
  for (const id of MIX_SHORTCUT_IDS) {
    if (source[id] === LEGACY_SHORTCUT_BINDINGS[id]) source[id] = DEFAULT_SHORTCUT_BINDINGS[id];
  }
  return migrateLegacyConsoleBindings(source);
}

/** En la v3 MUTE era Y por defecto; desde la v4 es B. Una Y guardada se considera el valor heredado. */
export function migrateLegacyConsoleBindings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const source = raw as Record<string, unknown>;
  return source.mute === 'KeyY' ? { ...source, mute: DEFAULT_SHORTCUT_BINDINGS.mute } : raw;
}

/** Etiqueta legible de un `KeyboardEvent.code` (`KeyG` → `G`, `Digit5` → `5`, `Semicolon` → `Ñ`). */
export function formatKeyCode(code: string): string {
  if (code === 'Semicolon') return 'Ñ';
  return code.replace(/^Key|^Digit/, '');
}

/** Tecla que se mantiene pulsada para modificar las flechas, Espacio o el selector de canciones. */
export type HeldKey =
  | { kind: 'mix'; id: MixShortcutId }
  | { kind: 'deck'; deckId: DeckId };

function findHeldKey(bindings: ShortcutBindings, code: string): HeldKey | null {
  if (code === DECK_KEY_CODES.A) return { kind: 'deck', deckId: 'A' };
  if (code === DECK_KEY_CODES.B) return { kind: 'deck', deckId: 'B' };
  const id = MIX_SHORTCUT_IDS.find((mixId) => bindings[mixId] === code);
  return id ? { kind: 'mix', id } : null;
}

export interface ShortcutKeyEvent {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * Traduce una pulsación a su acción, o null si no corresponde a ningún atajo.
 * `held` es la tecla de deck o selectora de mezcla que se mantiene pulsada.
 */
export function resolveShortcut(
  event: ShortcutKeyEvent,
  held: HeldKey | null = null,
  bindings: ShortcutBindings = DEFAULT_SHORTCUT_BINDINGS,
): ShortcutAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const { code, shiftKey } = event;
  const horizontal = code === 'ArrowLeft' ? -1 : code === 'ArrowRight' ? 1 : 0;
  const vertical = code === 'ArrowDown' ? -1 : code === 'ArrowUp' ? 1 : 0;

  if (held?.kind === 'mix' && horizontal) {
    const [deckId, param] = held.id.split('.') as [DeckId, MixParam];
    return { type: 'mix', deckId, param, direction: horizontal };
  }
  if (held?.kind === 'deck') {
    // F + ↑ / ↓ es volumen; con Shift, Pitch Bend del mismo deck
    if (vertical) return { type: shiftKey ? 'pitch-bend' : 'volume', deckId: held.deckId, direction: vertical };
    if (code === 'Space') return { type: 'play', deckId: held.deckId };
  }

  if (shiftKey) return horizontal ? { type: 'crossfader-curve', direction: horizontal } : null;
  // ↑ / ↓ sin tecla mantenida: volumen Master (con una selectora de mezcla no hacen nada)
  if (vertical) return held ? null : { type: 'master', direction: vertical };

  switch (code) {
    case 'KeyQ': return { type: 'cue', deckId: 'A' };
    case 'KeyE': return { type: 'sync', deckId: 'A' };
    case 'KeyI': return { type: 'cue', deckId: 'B' };
    case 'KeyP': return { type: 'sync', deckId: 'B' };
    case 'ArrowLeft': return { type: 'crossfader', direction: -1 };
    case 'ArrowRight': return { type: 'crossfader', direction: 1 };
  }
  if (code === bindings.mute) return { type: 'mute' };
  if (code === bindings.libraryA) return { type: 'library', deckId: 'A' };
  if (code === bindings.libraryB) return { type: 'library', deckId: 'B' };
  if (code === bindings.record) return { type: 'record' };

  const deckADigit = /^Digit([1-4])$/.exec(code);
  if (deckADigit) return { type: 'hotcue', deckId: 'A', slot: Number(deckADigit[1]) };
  const deckBSlot = DECK_B_HOT_CUE_CODES.indexOf(code);
  if (deckBSlot >= 0) return { type: 'hotcue', deckId: 'B', slot: deckBSlot + 1 };

  return null;
}

/** Controles ARIA que usan Espacio/flechas como un control nativo (casillas, selectores, listas). */
const FORM_CONTROL_ROLES = new Set(['checkbox', 'switch', 'radio', 'combobox', 'listbox', 'option']);

/** Controles ARIA que usan las flechas para moverse (pestañas, deslizadores, menús…). */
const ARROW_KEY_ROLES = new Set(['slider', 'spinbutton', 'tab', 'tablist', 'menu', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'radiogroup', 'tree', 'treeitem', 'grid', 'gridcell', 'scrollbar']);

/** Las flechas sobre un control que las necesita se dejan a ese control; las demás teclas no. */
function isArrowKeyTarget(target: EventTarget | null, code: string): boolean {
  if (!code.startsWith('Arrow') || !target || typeof (target as HTMLElement).getAttribute !== 'function') return false;
  const role = (target as HTMLElement).getAttribute('role');
  return role !== null && ARROW_KEY_ROLES.has(role);
}

/** Evita disparar atajos mientras el usuario escribe o maneja un control nativo (o su equivalente ARIA). */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const role = typeof element.getAttribute === 'function' ? element.getAttribute('role') : null;
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable === true
    || (role !== null && FORM_CONTROL_ROLES.has(role));
}

/** Acciones del DJ que consumen los atajos (inyectables en pruebas). */
export interface ShortcutTarget {
  togglePlayDeck(deckId: DeckId): unknown;
  handleCueDown(deckId: DeckId): unknown;
  handleCueUp(deckId: DeckId): unknown;
  toggleSync(deckId: DeckId): unknown;
  getCrossfader(): number;
  setCrossfader(position: number): void;
  hasHotCue(deckId: DeckId, slot: number): boolean;
  jumpToHotCue(deckId: DeckId, slot: number): void;
  setHotCue(deckId: DeckId, slot: number): unknown;
  getMixValue(deckId: DeckId, param: MixParam): number;
  setMixValue(deckId: DeckId, param: MixParam, value: number): void;
  getChannelVolume(deckId: DeckId): number;
  setChannelVolume(deckId: DeckId, volume: number): void;
  getMasterVolume(): number;
  setMasterVolume(volume: number): void;
  toggleMasterMute(): void;
  /** Pitch Bend momentáneo del deck: `release` lo retira. */
  pitchBend(deckId: DeckId, direction: 'up' | 'down' | 'release'): void;
  /** Pasa a la curva anterior (-1) o siguiente (1) del crossfader, en el orden de la consola. */
  cycleCrossfaderCurve(direction: -1 | 1): void;
  /** Inicia o detiene la grabación de la sesión; sin él la tecla de grabación no hace nada. */
  toggleRecording?(): unknown;
  /** Muestra u oculta el selector de canciones del deck en la consola; sin él el atajo no hace nada. */
  toggleTrackPicker?(deckId: DeckId): unknown;
  /** Abre una sección de la consola; sin él los atajos de navegación no hacen nada. */
  navigate?(section: NavSection): void;
}

interface ShortcutEventLike extends ShortcutKeyEvent {
  target: EventTarget | null;
  repeat: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/** Acciones que admiten autorrepetición al mantener la tecla. */
const REPEATABLE_ACTIONS: ReadonlySet<ShortcutAction['type']> = new Set(['crossfader', 'mix', 'volume', 'master']);

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

/** Las asignaciones se leen en cada pulsación, así que reasignar no exige reinstalar los oyentes. */
export function createShortcutHandlers(
  target: ShortcutTarget,
  getBindings: () => ShortcutBindings = () => DEFAULT_SHORTCUT_BINDINGS,
  getNavigationBindings: () => NavigationBindings = () => DEFAULT_NAVIGATION_BINDINGS,
): {
  onKeyDown: (event: ShortcutEventLike) => void;
  onKeyUp: (event: ShortcutEventLike) => void;
  onBlur: () => void;
} {
  const heldCues = new Set<DeckId>();
  // Teclas de deck y selectoras pulsadas, en orden; la última pulsada es la activa
  const heldKeys: string[] = [];
  // Pitch Bend en curso y la flecha que lo inició
  let heldBend: { deckId: DeckId; code: string } | null = null;
  // Flecha cuyo Pitch Bend se soltó antes que ella: su autorrepetición no debe pasar a volumen
  let mutedRepeatCode: string | null = null;

  const releaseHeldKey = (code: string): void => {
    const index = heldKeys.indexOf(code);
    if (index >= 0) heldKeys.splice(index, 1);
  };

  const releaseBend = (): void => {
    if (!heldBend) return;
    mutedRepeatCode = heldBend.code;
    target.pitchBend(heldBend.deckId, 'release');
    heldBend = null;
  };

  const onKeyDown = (event: ShortcutEventLike): void => {
    // Un control enfocado que ya gestionó la tecla (p. ej. el botón CUE) tiene prioridad
    if (event.defaultPrevented || isEditableTarget(event.target) || isArrowKeyTarget(event.target, event.code)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // Antes que las selectoras: Shift + 5 abre una sección aunque 5 sea una selectora de mezcla
    const section = target.navigate ? resolveNavigationShortcut(event, getNavigationBindings()) : null;
    if (section) {
      event.preventDefault();
      if (!event.repeat) target.navigate!(section);
      return;
    }

    if (event.repeat && event.code === mutedRepeatCode) {
      event.preventDefault();
      return;
    }

    const bindings = getBindings();

    if (findHeldKey(bindings, event.code)) {
      if (!event.repeat) {
        releaseHeldKey(event.code);
        heldKeys.push(event.code);
      }
      event.preventDefault();
      return;
    }

    const activeCode = heldKeys[heldKeys.length - 1];
    const held = activeCode ? findHeldKey(bindings, activeCode) : null;
    const action = resolveShortcut(event, held, bindings);
    if (!action) return;
    event.preventDefault();
    if (event.repeat && !REPEATABLE_ACTIONS.has(action.type)) return;

    switch (action.type) {
      case 'play':
        void target.togglePlayDeck(action.deckId);
        break;
      case 'cue':
        heldCues.add(action.deckId);
        void target.handleCueDown(action.deckId);
        break;
      case 'sync':
        target.toggleSync(action.deckId);
        break;
      case 'crossfader':
        target.setCrossfader(clampPercent(target.getCrossfader() + action.direction * CROSSFADER_KEY_STEP));
        break;
      case 'crossfader-curve':
        target.cycleCrossfaderCurve(action.direction);
        break;
      case 'mix':
        target.setMixValue(
          action.deckId,
          action.param,
          clampPercent(target.getMixValue(action.deckId, action.param) + action.direction * MIX_KEY_STEP),
        );
        break;
      case 'volume':
        target.setChannelVolume(
          action.deckId,
          clampPercent(target.getChannelVolume(action.deckId) + action.direction * VOLUME_KEY_STEP),
        );
        break;
      case 'master':
        target.setMasterVolume(clampPercent(target.getMasterVolume() + action.direction * VOLUME_KEY_STEP));
        break;
      case 'pitch-bend':
        // Una sola curvatura a la vez: cambiar de flecha o de deck sustituye la anterior
        if (heldBend && heldBend.deckId !== action.deckId) target.pitchBend(heldBend.deckId, 'release');
        heldBend = { deckId: action.deckId, code: event.code };
        mutedRepeatCode = null;
        target.pitchBend(action.deckId, action.direction > 0 ? 'up' : 'down');
        break;
      case 'mute':
        target.toggleMasterMute();
        break;
      case 'record':
        void target.toggleRecording?.();
        break;
      case 'library':
        void target.toggleTrackPicker?.(action.deckId);
        break;
      case 'hotcue':
        if (target.hasHotCue(action.deckId, action.slot)) {
          target.jumpToHotCue(action.deckId, action.slot);
        } else {
          void target.setHotCue(action.deckId, action.slot);
        }
        break;
    }
  };

  const onKeyUp = (event: ShortcutEventLike): void => {
    releaseHeldKey(event.code);
    if (event.code === mutedRepeatCode) mutedRepeatCode = null;
    // Soltar la flecha, la tecla del deck o Shift deshace la combinación del Pitch Bend
    if (heldBend && (
      event.code === heldBend.code
      || event.code === DECK_KEY_CODES[heldBend.deckId]
      || event.code === 'ShiftLeft'
      || event.code === 'ShiftRight'
    )) {
      releaseBend();
      if (event.code === mutedRepeatCode) mutedRepeatCode = null;
    }
    // Ignorar modificadores al soltar: un CUE mantenido debe liberarse aunque se pulse Ctrl/Alt/Shift
    const action = resolveShortcut({ ...event, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    if (action?.type !== 'cue' || !heldCues.has(action.deckId)) return;
    heldCues.delete(action.deckId);
    target.handleCueUp(action.deckId);
  };

  const onBlur = (): void => {
    for (const deckId of heldCues) target.handleCueUp(deckId);
    heldCues.clear();
    heldKeys.length = 0;
    releaseBend();
    mutedRepeatCode = null;
  };

  return { onKeyDown, onKeyUp, onBlur };
}

/** Registra los atajos en `window` y devuelve la función que los retira. */
export function installKeyboardShortcuts(
  target: ShortcutTarget,
  getBindings?: () => ShortcutBindings,
  win: Window = window,
  getNavigationBindings?: () => NavigationBindings,
): () => void {
  const { onKeyDown, onKeyUp, onBlur } = createShortcutHandlers(target, getBindings, getNavigationBindings);
  win.addEventListener('keydown', onKeyDown);
  win.addEventListener('keyup', onKeyUp);
  win.addEventListener('blur', onBlur);
  return () => {
    onBlur();
    win.removeEventListener('keydown', onKeyDown);
    win.removeEventListener('keyup', onKeyUp);
    win.removeEventListener('blur', onBlur);
  };
}
