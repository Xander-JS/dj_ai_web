/**
 * SYSTEM DJ — Console track picker bridge
 * Los atajos se instalan fuera del árbol de React (settingsEffects), pero el selector de
 * canciones vive en la consola del Mixer. Cada selector montado registra aquí cómo mostrarse u
 * ocultarse; fuera del Mixer no hay selector y el atajo no hace nada.
 */

import type { DeckId } from '../../types/deck.ts';

type TogglePicker = () => void;

const pickers = new Map<DeckId, TogglePicker>();

/** Registra el selector de un deck; devuelve la función que lo retira. */
export function registerTrackPicker(deckId: DeckId, toggle: TogglePicker): () => void {
  pickers.set(deckId, toggle);
  return () => {
    if (pickers.get(deckId) === toggle) pickers.delete(deckId);
  };
}

/** Muestra u oculta el selector del deck si la consola está montada. Devuelve si había selector. */
export function toggleTrackPicker(deckId: DeckId): boolean {
  const toggle = pickers.get(deckId);
  if (!toggle) return false;
  toggle();
  return true;
}
