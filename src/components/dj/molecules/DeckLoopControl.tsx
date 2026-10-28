import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Plus, Repeat } from 'lucide-react';
import type { DeckId } from '../../../types/deck';
import { LOOP_BEATS, formatLoopBeats } from '../../../services/console/deckLoop';
import { HardwareButton } from '../atoms/HardwareButton';
import './DeckLoopControl.css';

export interface DeckLoopControlProps {
  deckId: DeckId;
  /** Hay pista: los tres botones responden. */
  enabled: boolean;
  active: boolean;
  /** Longitud elegida en pulsos. */
  beats: number;
  onToggle: () => void;
  onStep: (direction: 1 | -1) => void;
}

/**
 * Auto Loop: −, el botón central (icono de bucle y longitud, azul claro con el bucle activo) y +, tres
 * gomas en un mismo bisel con la serigrafía LOOP debajo. Deck B lo lleva en la esquina opuesta.
 */
export const DeckLoopControl: React.FC<DeckLoopControlProps> = ({ deckId, enabled, active, beats, onToggle, onStep }) => {
  const { t } = useTranslation();
  const id = deckId.toLowerCase();
  const lengthId = useId();
  const canReduce = enabled && beats > LOOP_BEATS[0];
  const canIncrease = enabled && beats < LOOP_BEATS[LOOP_BEATS.length - 1];
  const label = formatLoopBeats(beats);

  return (
    <div className="deck-loop" role="group" aria-label={t('dj.loop')}>
      <span className="deck-loop__bezel">
        <HardwareButton
          variant="momentary"
          lit={canReduce}
          disabled={!canReduce}
          icon={<Minus />}
          aria-label={t('dj.loop_reduce')}
          title={t('dj.loop_reduce')}
          data-testid={`deck-${id}-loop-reduce`}
          onClick={() => onStep(-1)}
        />
        <HardwareButton
          variant="latching"
          className="deck-loop__toggle"
          lit={active}
          disabled={!enabled}
          icon={<><Repeat /><span className="deck-loop__length">{label}</span></>}
          aria-label={t('dj.loop_toggle')}
          aria-pressed={active}
          aria-describedby={lengthId}
          title={t('dj.loop_toggle')}
          data-testid={`deck-${id}-loop`}
          onClick={onToggle}
        />
        <HardwareButton
          variant="momentary"
          lit={canIncrease}
          disabled={!canIncrease}
          icon={<Plus />}
          aria-label={t('dj.loop_increase')}
          title={t('dj.loop_increase')}
          data-testid={`deck-${id}-loop-increase`}
          onClick={() => onStep(1)}
        />
      </span>
      <span id={lengthId} className="sd-visually-hidden">{t('dj.loop_length', { count: beats, beats: label })}</span>
      <span className="hw-button__caption" aria-hidden="true">{t('dj.loop_caption')}</span>
    </div>
  );
};
