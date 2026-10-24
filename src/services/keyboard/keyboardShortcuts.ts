/**
 * SYSTEM DJ — Global Keyboard Shortcuts
 * Un único par de oyentes keydown/keyup en `window` que traduce teclas físicas
 * (`KeyboardEvent.code`, independiente de la distribución del teclado) a acciones del DJ.
 *
 * Reglas:
 * - Se ignoran las teclas escritas en campos editables, las ya gestionadas por un control
 *   enfocado y las combinaciones con Ctrl/Alt/Meta.
 * - CUE es momentáneo: keydown inicia el CUE/CUP y keyup lo libera; perder el foco lo cancela.
 * - ← / → mueven el crossfader; mientras se mantiene una tecla selectora de mezcla
 *   (GAIN, HI, MID, LOW, FILTER de cada deck, reasignables) ajustan ese parámetro.
 * - Al desactivar los atajos se retiran los oyentes, sin coste residual.
 */

import type { DeckId } from '../../types/deck';

export type ShortcutAction =
  | { type: 'play'; deckId: DeckId }
  | { type: 'cue'; deckId: DeckId }
  | { type: 'sync'; deckId: DeckId }
  | { type: 'crossfader'; direction: -1 | 1 }
  | { type: 'hotcue'; deckId: DeckId; slot: number }
  | { type: 'mix'; deckId: DeckId; param: MixParam; direction: -1 | 1 };

/** Paso del crossfader por pulsación (escala 0–100). */
export const CROSSFADER_KEY_STEP = 5;
/** Paso de GAIN / EQ / FILTER por pulsación (escala 0–100, centro 50). */
export const MIX_KEY_STEP = 2;

/** Parámetros de mezcla ajustables con tecla selectora + ← / →. */
export type MixParam = 'gain' | 'high' | 'mid' | 'low' | 'filter';
export const MIX_PARAMS: readonly MixParam[] = ['gain', 'high', 'mid', 'low', 'filter'];

/** Comando reasignable: `A.gain`, `B.filter`, … */
export type MixShortcutId = `${DeckId}.${MixParam}`;
/** Tecla selectora de cada comando, como `KeyboardEvent.code` (p. ej. `KeyG`). */
export type ShortcutBindings = Record<MixShortcutId, string>;

export const MIX_SHORTCUT_IDS: readonly MixShortcutId[] = (['A', 'B'] as const).flatMap(
  (deckId) => MIX_PARAMS.map((param) => `${deckId}.${param}` as MixShortcutId),
);

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = {
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

/** Tabla de referencia mostrada en Ajustes → Atajos. */
export const KEYBOARD_SHORTCUTS: readonly { keys: string; labelKey: string }[] = [
  { keys: 'Space', labelKey: 'settings.shortcuts.play_a' },
  { keys: 'Shift + Space', labelKey: 'settings.shortcuts.play_b' },
  { keys: 'Q', labelKey: 'settings.shortcuts.cue_a' },
  { keys: 'W', labelKey: 'settings.shortcuts.sync_a' },
  { keys: 'O', labelKey: 'settings.shortcuts.cue_b' },
  { keys: 'P', labelKey: 'settings.shortcuts.sync_b' },
  { keys: '←', labelKey: 'settings.shortcuts.crossfader_a' },
  { keys: '→', labelKey: 'settings.shortcuts.crossfader_b' },
  { keys: '1 – 4', labelKey: 'settings.shortcuts.hotcues_a' },
  { keys: '7 – 0', labelKey: 'settings.shortcuts.hotcues_b' },
];

const DECK_B_HOT_CUE_CODES: readonly string[] = ['Digit7', 'Digit8', 'Digit9', 'Digit0'];

/** Teclas de atajos fijos; no pueden usarse como selectoras. */
export const RESERVED_SHORTCUT_CODES: readonly string[] = [
  'Space', 'KeyQ', 'KeyW', 'KeyO', 'KeyP', 'ArrowLeft', 'ArrowRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', ...DECK_B_HOT_CUE_CODES,
];

export type BindingError = 'invalid' | 'reserved' | 'duplicate';

/** Solo letras y dígitos libres pueden actuar como teclas selectoras. */
export function validateBinding(
  bindings: ShortcutBindings,
  id: MixShortcutId,
  code: string,
): BindingError | null {
  if (!/^(Key[A-Z]|Digit[0-9])$/.test(code)) return 'invalid';
  if (RESERVED_SHORTCUT_CODES.includes(code)) return 'reserved';
  if (MIX_SHORTCUT_IDS.some((other) => other !== id && bindings[other] === code)) return 'duplicate';
  return null;
}

/** Normaliza asignaciones guardadas: una entrada inválida o repetida vuelve a su tecla por defecto. */
export function sanitizeShortcutBindings(raw: unknown): ShortcutBindings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<MixShortcutId, unknown>>;
  const result = { ...DEFAULT_SHORTCUT_BINDINGS };
  for (const id of MIX_SHORTCUT_IDS) {
    const code = source[id];
    if (typeof code === 'string') result[id] = code;
  }
  for (const id of MIX_SHORTCUT_IDS) {
    if (validateBinding(result, id, result[id])) result[id] = DEFAULT_SHORTCUT_BINDINGS[id];
  }
  // Restaurar una entrada puede chocar con otra personalizada: en ese caso se vuelve al mapa por defecto
  const valid = MIX_SHORTCUT_IDS.every((id) => validateBinding(result, id, result[id]) === null);
  return valid ? result : { ...DEFAULT_SHORTCUT_BINDINGS };
}

/** Etiqueta legible de un `KeyboardEvent.code` (`KeyG` → `G`, `Digit5` → `5`). */
export function formatKeyCode(code: string): string {
  return code.replace(/^Key|^Digit/, '');
}

function findMixShortcut(bindings: ShortcutBindings, code: string): MixShortcutId | null {
  return MIX_SHORTCUT_IDS.find((id) => bindings[id] === code) ?? null;
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
 * `heldSelector` es el comando de mezcla cuya tecla selectora se mantiene pulsada.
 */
export function resolveShortcut(event: ShortcutKeyEvent, heldSelector: MixShortcutId | null = null): ShortcutAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const { code, shiftKey } = event;

  if (heldSelector && (code === 'ArrowLeft' || code === 'ArrowRight')) {
    const [deckId, param] = heldSelector.split('.') as [DeckId, MixParam];
    return { type: 'mix', deckId, param, direction: code === 'ArrowLeft' ? -1 : 1 };
  }

  if (code === 'Space') return { type: 'play', deckId: shiftKey ? 'B' : 'A' };
  if (shiftKey) return null;

  switch (code) {
    case 'KeyQ': return { type: 'cue', deckId: 'A' };
    case 'KeyW': return { type: 'sync', deckId: 'A' };
    case 'KeyO': return { type: 'cue', deckId: 'B' };
    case 'KeyP': return { type: 'sync', deckId: 'B' };
    case 'ArrowLeft': return { type: 'crossfader', direction: -1 };
    case 'ArrowRight': return { type: 'crossfader', direction: 1 };
  }

  const deckADigit = /^Digit([1-4])$/.exec(code);
  if (deckADigit) return { type: 'hotcue', deckId: 'A', slot: Number(deckADigit[1]) };
  const deckBSlot = DECK_B_HOT_CUE_CODES.indexOf(code);
  if (deckBSlot >= 0) return { type: 'hotcue', deckId: 'B', slot: deckBSlot + 1 };

  return null;
}

/** Controles ARIA que usan Espacio/flechas como un control nativo (casillas, selectores, listas). */
const FORM_CONTROL_ROLES = new Set(['checkbox', 'switch', 'radio', 'combobox', 'listbox', 'option']);

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
}

interface ShortcutEventLike extends ShortcutKeyEvent {
  target: EventTarget | null;
  repeat: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/** Las asignaciones se leen en cada pulsación, así que reasignar no exige reinstalar los oyentes. */
export function createShortcutHandlers(
  target: ShortcutTarget,
  getBindings: () => ShortcutBindings = () => DEFAULT_SHORTCUT_BINDINGS,
): {
  onKeyDown: (event: ShortcutEventLike) => void;
  onKeyUp: (event: ShortcutEventLike) => void;
  onBlur: () => void;
} {
  const heldCues = new Set<DeckId>();
  // Teclas selectoras pulsadas, en orden; la última pulsada es la activa
  const heldSelectors: string[] = [];

  const releaseSelector = (code: string): void => {
    const index = heldSelectors.indexOf(code);
    if (index >= 0) heldSelectors.splice(index, 1);
  };

  const onKeyDown = (event: ShortcutEventLike): void => {
    // Un control enfocado que ya gestionó la tecla (p. ej. el botón CUE) tiene prioridad
    if (event.defaultPrevented || isEditableTarget(event.target)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const bindings = getBindings();

    if (findMixShortcut(bindings, event.code)) {
      if (!event.repeat) {
        releaseSelector(event.code);
        heldSelectors.push(event.code);
      }
      event.preventDefault();
      return;
    }

    const activeCode = heldSelectors[heldSelectors.length - 1];
    const heldSelector = activeCode ? findMixShortcut(bindings, activeCode) : null;
    const action = resolveShortcut(event, heldSelector);
    if (!action) return;
    event.preventDefault();
    // Solo crossfader y mezcla admiten autorrepetición al mantener la tecla
    if (event.repeat && action.type !== 'crossfader' && action.type !== 'mix') return;

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
        target.setCrossfader(Math.max(0, Math.min(100, target.getCrossfader() + action.direction * CROSSFADER_KEY_STEP)));
        break;
      case 'mix':
        target.setMixValue(
          action.deckId,
          action.param,
          Math.max(0, Math.min(100, target.getMixValue(action.deckId, action.param) + action.direction * MIX_KEY_STEP)),
        );
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
    releaseSelector(event.code);
    // Ignorar modificadores al soltar: un CUE mantenido debe liberarse aunque se pulse Ctrl/Alt/Shift
    const action = resolveShortcut({ ...event, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
    if (action?.type !== 'cue' || !heldCues.has(action.deckId)) return;
    heldCues.delete(action.deckId);
    target.handleCueUp(action.deckId);
  };

  const onBlur = (): void => {
    for (const deckId of heldCues) target.handleCueUp(deckId);
    heldCues.clear();
    heldSelectors.length = 0;
  };

  return { onKeyDown, onKeyUp, onBlur };
}

/** Registra los atajos en `window` y devuelve la función que los retira. */
export function installKeyboardShortcuts(
  target: ShortcutTarget,
  getBindings?: () => ShortcutBindings,
  win: Window = window,
): () => void {
  const { onKeyDown, onKeyUp, onBlur } = createShortcutHandlers(target, getBindings);
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
