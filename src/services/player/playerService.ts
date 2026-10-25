/**
 * SYSTEM DJ — Player service
 * Instancia única de la cola conectada al transporte real: Deck A de djStore, el mismo que
 * la barra de reproducción ya mostraba. No hay un segundo motor ni un segundo AudioContext;
 * el volumen de la barra sigue siendo el Master del motor.
 */

import { useSyncExternalStore } from 'react';
import { audioEngine } from '../../audio';
import { djStore } from '../../store/useDJStore';
import { notificationCenter } from '../notifications/notificationCenter';
import { PlayerQueue, type PlayerQueueState } from './playerQueue';

/** Deck que actúa como reproductor de la barra inferior. */
export const PLAYER_DECK = 'A' as const;

export const playerQueue = new PlayerQueue(
  {
    load: (track) => djStore.loadTrackToDeck(PLAYER_DECK, track),
    play: () => djStore.playDeck(PLAYER_DECK),
    restart: () => djStore.seekDeck(PLAYER_DECK, 0),
    getLoadedTrackId: () => djStore.getSnapshot().deckA.track?.id ?? null,
    getCurrentTime: () => djStore.getSnapshot().deckA.currentTime,
  },
  {
    onLoadError: (track) => {
      notificationCenter.push({
        type: 'error',
        messageKey: 'library.load_error',
        params: { title: track.title, deck: 'Deck A' },
      });
    },
  },
);

// djStore registró su oyente antes (al importarse), así que el deck ya figura detenido aquí
audioEngine.onPlaybackEnded(PLAYER_DECK, () => {
  void playerQueue.handleTrackEnded();
});

export function usePlayerQueue(): PlayerQueueState {
  return useSyncExternalStore(playerQueue.subscribe, playerQueue.getSnapshot, playerQueue.getSnapshot);
}
