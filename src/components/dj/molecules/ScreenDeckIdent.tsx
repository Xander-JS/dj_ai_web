import React from 'react';
import { clsx } from 'clsx';
import type { DeckId } from '../../../types/deck';
import './ScreenDeckIdent.css';

export interface ScreenDeckIdentProps {
  deckId: DeckId;
  title: string;
  /** Artista, o vacío sin pista. */
  artist: string;
  /** Error de reproducción o rechazo de SYNC: sustituye a título y artista, en rojo. */
  alert: string | null;
}

/** Fila de identificación de un deck en la pantalla: título y artista, o su mensaje de error. */
export const ScreenDeckIdent: React.FC<ScreenDeckIdentProps> = ({ deckId, title, artist, alert }) => (
  <div
    className={clsx('screen-deck-ident', `console-tone-${deckId.toLowerCase()}`, alert && 'has-alert')}
    data-testid={`screen-ident-${deckId.toLowerCase()}`}
  >
    <span className="screen-deck-ident__letter" aria-hidden="true">{deckId}</span>
    {alert ? (
      <span className="screen-deck-ident__alert" role="alert" title={alert}>{alert}</span>
    ) : (
      <span className="screen-deck-ident__text" title={artist ? `${title} — ${artist}` : title}>
        <span className="screen-deck-ident__title">{title}</span>
        {artist && <span className="screen-deck-ident__artist">{artist}</span>}
      </span>
    )}
  </div>
);
