import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DeckId } from '../../../types/deck';
import { ConsoleBadge } from '../atoms/ConsoleBadge';
import { translatePanelMessage, type DeckNotice } from '../../../services/console/deckPanelModel';
import './DeckNoticeStrip.css';

export interface DeckNoticeStripProps {
  deckId: DeckId;
  notices: readonly DeckNotice[];
  /** Lanza el análisis musical desde el aviso PENDIENTE / ERROR. */
  onAnalyze: () => void;
}

/**
 * Franja de avisos sobre el disco: solo aparecen los que aplican; si no caben, pasan a otra línea.
 * El de Referencia tiene su hueco reservado al final: aparecer o desaparecer no mueve a los demás.
 */
export const DeckNoticeStrip: React.FC<DeckNoticeStripProps> = ({ deckId, notices, onAnalyze }) => {
  const { t } = useTranslation();
  const id = deckId.toLowerCase();
  const renderBadge = (notice: DeckNotice) => (
    <ConsoleBadge
      key={notice.id}
      light={notice.light}
      tooltip={translatePanelMessage(t, notice.tooltip)}
      busy={notice.busy}
      onActivate={notice.interactive ? onAnalyze : undefined}
      data-testid={`deck-${id}-notice-${notice.id}`}
    >
      {translatePanelMessage(t, notice.label)}
    </ConsoleBadge>
  );
  const reference = notices.find((notice) => notice.id === 'reference');

  return (
    <div className="deck-notice-strip" data-testid={`deck-${id}-notices`}>
      {notices.filter((notice) => notice !== reference).map(renderBadge)}
      <span className="deck-notice-strip__reserved">
        {/* Ocupa el ancho del aviso aunque no esté */}
        <span className="console-badge deck-notice-strip__placeholder" aria-hidden="true">
          {t('seed.badge', { index: 1 })}
        </span>
        {reference && renderBadge(reference)}
      </span>
    </div>
  );
};
