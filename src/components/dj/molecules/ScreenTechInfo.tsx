import React from 'react';
import { useTranslation } from 'react-i18next';
import { deckTechValues } from '../../../services/console/screenDisplayModel';
import type { DeckStoreState } from '../../../store/useDJStore';
import './ScreenTechInfo.css';

const COLUMNS = ['bpm', 'time', 'key', 'camelot', 'energy'] as const;

/** Información técnica de un deck: cabeceras y valores en 2 filas × 5 columnas. */
export const ScreenTechInfo: React.FC<{ deck: DeckStoreState }> = ({ deck }) => {
  const { t } = useTranslation();
  const id = deck.deckId.toLowerCase();
  const values = deckTechValues(deck);
  const timeTooltip = t('dj.bar_sync_time_tooltip', {
    current: deck.currentTime.toFixed(3),
    total: deck.duration.toFixed(3),
  });

  return (
    <dl
      className={`screen-tech-info console-tone-${id}`}
      aria-label={t('mixer.screen.tech_label', { deck: deck.deckId })}
      data-testid={`screen-tech-${id}`}
    >
      {COLUMNS.map((column) => (
        <div
          key={column}
          className={`screen-tech-info__cell screen-tech-info__cell--${column}`}
          title={column === 'time' ? timeTooltip : undefined}
          data-testid={`screen-tech-${id}-${column}`}
        >
          <dt>{t(`mixer.screen.tech_${column}`)}</dt>
          <dd>{values[column]}</dd>
        </div>
      ))}
    </dl>
  );
};
