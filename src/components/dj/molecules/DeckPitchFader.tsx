import React from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import type { DeckId } from '../../../types/deck';
import { ConsoleFader } from '../atoms/ConsoleFader';
import './DeckPitchFader.css';

type BendDirection = 'up' | 'down';

export interface DeckPitchFaderProps {
  deckId: DeckId;
  /** Posición del fader, 0–100 (50 = 0 %). */
  value: number;
  /** Rango de Ajustes en % (6, 8 o 16). */
  rangePercent: number;
  /** Velocidad efectiva para lectores de pantalla (`+1.50%`). */
  valueText: string;
  disabled: boolean;
  /** Pitch bend momentáneo en curso (signo = dirección). */
  bend: number;
  onChange: (value: number) => void;
  onBend: (direction: BendDirection) => void;
  onBendRelease: () => void;
}

/**
 * Fader de tempo invertido, como en un CDJ (− arriba, + abajo), con la línea de 0 % en el color
 * del deck, la serigrafía `TEMPO` y debajo los dos botones momentáneos de Pitch Bend.
 */
export const DeckPitchFader: React.FC<DeckPitchFaderProps> = ({
  deckId,
  value,
  rangePercent,
  valueText,
  disabled,
  bend,
  onChange,
  onBend,
  onBendRelease,
}) => {
  const { t } = useTranslation();
  const id = deckId.toLowerCase();

  const bendButton = (direction: BendDirection) => {
    const isDown = direction === 'down';
    return (
      <button
        type="button"
        className={clsx('deck-pitch__bend', (isDown ? bend < 0 : bend > 0) && 'is-active')}
        onPointerDown={() => onBend(direction)}
        onPointerUp={onBendRelease}
        onPointerLeave={onBendRelease}
        onPointerCancel={onBendRelease}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!e.repeat) onBend(direction);
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onBendRelease();
          }
        }}
        disabled={disabled}
        title={t(isDown ? 'dj.pitch_bend_down_tooltip' : 'dj.pitch_bend_up_tooltip')}
        aria-label={t(isDown ? 'dj.pitch_bend_down' : 'dj.pitch_bend_up')}
        data-testid={`deck-${id}-pitchbend-${direction}`}
      >
        {isDown ? '−' : '+'}
      </button>
    );
  };

  return (
    <div className={clsx('deck-pitch', disabled && 'is-disabled')}>
      <span className="deck-pitch__range" aria-hidden="true">−{rangePercent}%</span>
      <div className="deck-pitch__track">
        <ConsoleFader
          orientation="vertical"
          inverted
          fillFrom={50}
          tone={deckId === 'A' ? 'a' : 'b'}
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          aria-label={t('dj.pitch_fader', { deck: deckId })}
          aria-valuetext={valueText}
          data-testid={`deck-${id}-pitch`}
        />
      </div>
      <span className="deck-pitch__range" aria-hidden="true">+{rangePercent}%</span>
      <span className="deck-pitch__caption" aria-hidden="true">{t('dj.tempo')}</span>
      <div className="deck-pitch__bends" role="group" aria-label={t('dj.pitch_bend_label')}>
        {bendButton('down')}
        {bendButton('up')}
      </div>
    </div>
  );
};
