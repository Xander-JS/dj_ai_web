import React from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Pause, Play } from 'lucide-react';
import type { DeckId } from '../../../types/deck';
import './DeckTransport.css';

export interface DeckTransportProps {
  deckId: DeckId;
  disabled: boolean;
  isPlaying: boolean;
  /** CUE pulsado (puntero, teclado o atajo `Q` / `I`): luz ámbar. */
  isCueLit: boolean;
  /** Eventos del CUE momentáneo (pulsar / soltar), gestionados por el deck. */
  cueHandlers: React.ButtonHTMLAttributes<HTMLButtonElement>;
  onPlayToggle: () => void;
}

/** Columna de transporte: CUE (ámbar) arriba y PLAY / PAUSE (verde) abajo, siempre circulares. */
export const DeckTransport: React.FC<DeckTransportProps> = ({ deckId, disabled, isPlaying, isCueLit, cueHandlers, onPlayToggle }) => {
  const { t } = useTranslation();
  const id = deckId.toLowerCase();
  return (
    <div className="deck-transport">
      <button
        type="button"
        className={clsx('deck-round-key', 'deck-round-key--cue', isCueLit && 'is-lit')}
        title={t('dj.cue_pro_title')}
        aria-label={t('dj.cue')}
        disabled={disabled}
        data-testid={`deck-${id}-cue`}
        {...cueHandlers}
      >
        {t('dj.cue')}
      </button>
      <div className="deck-transport__play">
        <span className="deck-transport__caption" aria-hidden="true">{t('dj.play_pause')}</span>
        <button
          type="button"
          className={clsx('deck-round-key', 'deck-round-key--play', isPlaying && 'is-lit')}
          onClick={onPlayToggle}
          disabled={disabled}
          aria-label={isPlaying ? t('dj.pause') : t('dj.play')}
          aria-pressed={isPlaying}
          data-testid={`deck-${id}-play`}
        >
          <Play aria-hidden="true" className="deck-round-key__icon" fill="currentColor" strokeWidth={1.5} />
          <Pause aria-hidden="true" className="deck-round-key__icon" fill="currentColor" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
};
