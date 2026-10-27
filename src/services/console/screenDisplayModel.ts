/**
 * SYSTEM DJ — Digital screen display model
 * Valores que la vista normal de la pantalla muestra para cada deck: su información técnica.
 */

import type { DeckStoreState } from '../../store/useDJStore.ts';
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
