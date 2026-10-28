import { useEffect, useSyncExternalStore } from 'react';
import type { DeckId } from '../types/deck';
import type { DeckDisplayMessage } from './useDeckMessage';

export type DeckDisplayMode = 'guide' | 'map';

const AUTO_GUIDE_MS = 4000;

interface DisplayModeState {
  /** Modo elegido con MODE (MAP por defecto). */
  chosen: DeckDisplayMode;
  /** Error o warning que forzó GUÍA durante 4 s, si sigue activo el cambio automático. */
  autoAlertId: string | null;
  /** Último error o warning visto, para detectar los nuevos. */
  seenAlertId: string | null;
}

// En memoria: el modo de cada deck se conserva al salir y volver al Mixer (no se persiste).
// Lo comparten el botón MODE (en el deck) y el display (sobre DOWNBEAT & COMPÁS).
const states: Record<DeckId, DisplayModeState> = {
  A: { chosen: 'map', autoAlertId: null, seenAlertId: null },
  B: { chosen: 'map', autoAlertId: null, seenAlertId: null },
};
const listeners = new Set<() => void>();

function update(deckId: DeckId, partial: Partial<DisplayModeState>) {
  states[deckId] = { ...states[deckId], ...partial };
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const shownMode = (state: DisplayModeState): DeckDisplayMode => (state.autoAlertId ? 'guide' : state.chosen);

/** Botón MODE: alterna lo que se ve y cancela el cambio automático en curso. */
export function toggleDeckDisplayMode(deckId: DeckId) {
  update(deckId, { chosen: shownMode(states[deckId]) === 'map' ? 'guide' : 'map', autoAlertId: null });
}

/**
 * Modo del display LED del deck. Un error o warning nuevo en MAP pasa a GUÍA durante 4 s y vuelve
 * solo; los mensajes de guía nunca interrumpen MAP.
 */
export function useDeckDisplayMode(deckId: DeckId, message: DeckDisplayMessage | null): DeckDisplayMode {
  const state = useSyncExternalStore(subscribe, () => states[deckId]);
  const alertId = message && message.level !== 'guide' ? message.id : null;

  useEffect(() => {
    const current = states[deckId];
    if (alertId === current.seenAlertId) return;
    update(deckId, { seenAlertId: alertId, ...(alertId && current.chosen === 'map' ? { autoAlertId: alertId } : {}) });
  }, [deckId, alertId]);

  useEffect(() => {
    if (!state.autoAlertId) return;
    const timer = setTimeout(() => update(deckId, { autoAlertId: null }), AUTO_GUIDE_MS);
    return () => clearTimeout(timer);
  }, [deckId, state.autoAlertId]);

  return shownMode(state);
}
