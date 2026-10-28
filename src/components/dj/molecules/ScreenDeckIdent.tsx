import React from 'react';
import { clsx } from 'clsx';
import type { DeckId } from '../../../types/deck';
import './ScreenDeckIdent.css';

export interface ScreenDeckIdentProps {
  deckId: DeckId;
  title: string;
  /** Artista, o vacío sin pista. */
  artist: string;
}

/** Fila de identificación de un deck en la pantalla: título y artista (los mensajes van al display LED del deck). */
export const ScreenDeckIdent: React.FC<ScreenDeckIdentProps> = ({ deckId, title, artist }) => (
  <div
    className={clsx('screen-deck-ident', `console-tone-${deckId.toLowerCase()}`)}
    data-testid={`screen-ident-${deckId.toLowerCase()}`}
  >
    <span className="screen-deck-ident__letter" aria-hidden="true">{deckId}</span>
    <span className="screen-deck-ident__text" title={artist ? `${title} — ${artist}` : title}>
      <span className="screen-deck-ident__title">{title}</span>
      {artist && <span className="screen-deck-ident__artist">{artist}</span>}
    </span>
  </div>
);
