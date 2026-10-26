/**
 * SYSTEM DJ — Digital screen display model
 * Valores que la vista normal de la pantalla muestra para cada deck: información técnica y el
 * mensaje que sustituye a título y artista (rechazo de SYNC o error de reproducción).
 */

import type { DeckStoreState, SyncFeedback } from '../../store/useDJStore.ts';
import { formatDuration } from '../../utils/formatters.ts';

const EMPTY = '—';

export interface DeckTechValues {
  bpm: string;
  time: string;
  key: string;
  camelot: string;
  energy: string;
}

/** BPM efectivo, tiempo restante, tonalidad, Camelot y energía, con `—` sin datos. */
export function deckTechValues(deck: DeckStoreState): DeckTechValues {
  const analysis = deck.track?.analysis;
  const isAnalyzed = analysis?.status === 'analyzed';
  return {
    bpm: deck.calculatedBpm !== null ? deck.calculatedBpm.toFixed(1) : EMPTY,
    time: deck.duration > 0 ? `-${formatDuration(Math.max(0, deck.duration - deck.currentTime))}` : '-0:00',
    key: isAnalyzed && analysis?.key ? analysis.key : EMPTY,
    camelot: isAnalyzed && analysis?.camelot ? analysis.camelot : EMPTY,
    energy: isAnalyzed && typeof analysis?.energy === 'number' ? `${analysis.energy.toFixed(1)}/10` : EMPTY,
  };
}

export type DeckAlert =
  | { kind: 'sync'; feedback: SyncFeedback }
  | { kind: 'playback'; message: string };

/** Rechazo de SYNC de este deck, o si no, error de reproducción; null si no hay ninguno. */
export function deckAlert(deck: DeckStoreState): DeckAlert | null {
  if (deck.errorCode === 'sync_failed' && deck.syncFeedback) return { kind: 'sync', feedback: deck.syncFeedback };
  if (deck.playbackState === 'error' && deck.errorMessage) return { kind: 'playback', message: deck.errorMessage };
  return null;
}
