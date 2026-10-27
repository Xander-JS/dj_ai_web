/**
 * SYSTEM DJ — Deck utility feedback
 * Expulsar y Referencia de cada deck: llaman a las acciones existentes (unloadDeck, toggleSeed)
 * sin cambiar sus efectos y confirman el resultado con un aviso breve.
 */

import i18n from '../../i18n/config';
import { djStore } from '../../store/useDJStore';
import { seedStore } from '../../store/useSeedStore';
import { toastStore } from '../notifications/toastService';
import type { DeckId } from '../../types/deck';

export function ejectDeckWithFeedback(deckId: DeckId): void {
  djStore.unloadDeck(deckId);
  toastStore.show('info', i18n.t('dj.toast_ejected', { deck: deckId }));
}

export function toggleReferenceWithFeedback(deckId: DeckId, trackId: string): void {
  const { action } = seedStore.toggleSeed(trackId);
  if (action === 'removed') toastStore.show('info', i18n.t('dj.toast_reference_removed', { deck: deckId }));
  else toastStore.show('success', i18n.t('dj.toast_reference_set', { deck: deckId }));
}
