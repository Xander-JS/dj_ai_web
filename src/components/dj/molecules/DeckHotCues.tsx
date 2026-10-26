import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import type { DeckId } from '../../../types/deck';
import type { HotCue } from '../../../types/track';
import { HOT_CUE_COLORS } from '../../../store/useDJStore';
import { formatDuration } from '../../../utils/formatters';
import './DeckHotCues.css';

const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export interface DeckHotCuesProps {
  deckId: DeckId;
  hotCues: readonly HotCue[];
  /** Sin pista cargada: pads atenuados. */
  disabled: boolean;
  onSet: (slot: number) => void;
  onJump: (slot: number) => void;
  onDelete: (slot: number) => void;
}

/**
 * Banco de 8 Hot Cues (2 × 4) con el interruptor BORRAR. Clic en un pad vacío lo fija en el
 * cabezal; en uno guardado salta a él. Con BORRAR, Shift+clic o clic derecho, lo elimina.
 */
export const DeckHotCues: React.FC<DeckHotCuesProps> = ({ deckId, hotCues, disabled, onSet, onJump, onDelete }) => {
  const { t } = useTranslation();
  const [deleteModeRequested, setDeleteModeRequested] = useState(false);
  const id = deckId.toLowerCase();
  const hasCues = hotCues.length > 0;
  // Sin Hot Cues no hay nada que borrar: el modo se apaga solo
  const isDeleteMode = deleteModeRequested && hasCues && !disabled;

  const handlePadClick = (slot: number, e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const existingCue = hotCues.find((c) => c.id === slot);
    if (isDeleteMode || e.shiftKey) {
      if (existingCue) onDelete(slot);
      return;
    }
    if (existingCue) onJump(slot);
    else onSet(slot);
  };

  return (
    <div className="deck-hotcues" data-testid={`deck-${id}-hotcues-section`}>
      <div className="deck-hotcues__header">
        <span className="deck-hotcues__title">{t('dj.hot_cues')}</span>
        <button
          type="button"
          className={clsx('deck-hotcues__clear', isDeleteMode && 'is-active')}
          onClick={() => setDeleteModeRequested(!isDeleteMode)}
          disabled={disabled || !hasCues}
          aria-pressed={isDeleteMode}
          title={t('dj.hotcue_clear_title')}
          data-testid={`deck-${id}-hotcue-clear-btn`}
        >
          {t('dj.hotcue_clear')}
        </button>
      </div>
      <div className="deck-hotcues__grid">
        {SLOTS.map((slot) => {
          const cue = hotCues.find((c) => c.id === slot);
          const isDefined = Boolean(cue);
          const time = cue ? formatDuration(cue.position) : null;
          const label = isDeleteMode
            ? t('dj.hotcue_delete', { slot })
            : cue
              ? `${t('dj.hotcue_jump', { slot })} (${time})`
              : t('dj.hotcue_set', { slot });
          return (
            <button
              key={slot}
              type="button"
              className={clsx('deck-hotcue-pad', isDefined ? 'is-defined' : 'is-empty', isDeleteMode && isDefined && 'is-delete')}
              style={{ '--pad-color': cue?.color || HOT_CUE_COLORS[slot - 1] } as React.CSSProperties}
              onClick={(e) => handlePadClick(slot, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (isDefined && !disabled) onDelete(slot);
              }}
              disabled={disabled}
              title={label}
              aria-label={label}
              data-testid={`deck-${id}-hotcue-${slot}`}
              data-defined={isDefined}
            >
              <span className="deck-hotcue-pad__num" aria-hidden="true">{slot}</span>
              <span className="deck-hotcue-pad__time" aria-hidden="true">{time ?? '—'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
