/**
 * SYSTEM DJ — Library load feedback
 * Carga una pista de la biblioteca en un deck con el mismo proceso que la Biblioteca
 * (loadTrackToDeck: rompe SYNC, cancela ALIGN, invalida BAR SYNC armado…) y confirma el
 * resultado con los avisos existentes. Lo usa el menú de carga de la pantalla digital.
 */

import i18n from '../../i18n/config';
import { djStore } from '../../store/useDJStore';
import { indexedDBStorage } from '../storage/IndexedDBStorage';
import { toastStore } from '../notifications/toastService';
import type { DeckId } from '../../types/deck';
import type { Track } from '../../types/track';

export async function loadTrackWithFeedback(deckId: DeckId, track: Track): Promise<boolean> {
  const deck = `Deck ${deckId}`;
  try {
    const loaded = await djStore.loadTrackToDeck(deckId, track);
    if (loaded) toastStore.show('success', i18n.t('library.toast.added_to_deck', { deck }));
    else toastStore.show('error', i18n.t('library.toast.load_failed', { deck }));
    return loaded;
  } catch (error) {
    toastStore.show('error', i18n.t('library.load_exception_error', {
      deck,
      error: error instanceof Error ? error.message : String(error),
    }));
    return false;
  }
}

/** Relee la biblioteca de IndexedDB; si falla, avisa y devuelve null. */
export async function readLibraryWithFeedback(): Promise<Track[] | null> {
  try {
    return await indexedDBStorage.getAllTracks();
  } catch (error) {
    console.warn('[DigitalScreen] Could not read the library:', error);
    toastStore.show('error', i18n.t('mixer.picker_library_error'));
    return null;
  }
}
