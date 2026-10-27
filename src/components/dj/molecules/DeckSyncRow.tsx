import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DeckId } from '../../../types/deck';
import { ConsoleKey, type ConsoleKeyTone } from '../atoms/ConsoleKey';
import { translatePanelMessage, type DeckKey, type DeckSyncKeys, type PanelLight } from '../../../services/console/deckPanelModel';
import './DeckSyncRow.css';

export interface DeckSyncRowProps {
  deckId: DeckId;
  keys: DeckSyncKeys;
  onBarSync: () => void;
  onAlign: () => void;
  onSync: () => void;
  onKeyLock: () => void;
}

const KEY_TONES: Record<PanelLight, ConsoleKeyTone> = {
  tone: 'deck',
  amber: 'amber',
  green: 'green',
  red: 'red',
  neutral: 'neutral',
};

/**
 * Fila BAR SYNC · ALIGN · SYNC · KEY LOCK. Mismo orden en ambos decks para que se lea igual;
 * cada estado solo cambia la luz (borde y serigrafía), nunca el tamaño ni la posición.
 */
export const DeckSyncRow: React.FC<DeckSyncRowProps> = ({ deckId, keys, onBarSync, onAlign, onSync, onKeyLock }) => {
  const { t } = useTranslation();
  const id = deckId.toLowerCase();

  const renderKey = (key: DeckKey, name: 'barsync' | 'align' | 'sync' | 'keylock', onClick: () => void, extra?: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
    const tooltip = translatePanelMessage(t, key.tooltip);
    return (
      <ConsoleKey
        className="deck-sync-row__key"
        lit={key.light !== null}
        tone={key.light ? KEY_TONES[key.light] : 'neutral'}
        filled={key.filled}
        pulse={key.pulse}
        disabled={key.disabled}
        aria-pressed={key.pressed}
        title={tooltip}
        onClick={onClick}
        data-testid={`deck-${id}-${name}`}
        {...extra}
      >
        {translatePanelMessage(t, key.label)}
      </ConsoleKey>
    );
  };

  // La tecla muestra el estado (ARMADO, LISTO…): su nombre accesible conserva siempre «BAR SYNC»
  const barSyncLabel = translatePanelMessage(t, keys.barSync.label);
  const barSyncName = t('dj.bar_sync');

  return (
    <div className="deck-sync-row" role="group" aria-label={t('dj.sync_row_label')}>
      {renderKey(keys.barSync, 'barsync', onBarSync, {
        'aria-label': barSyncLabel === barSyncName ? barSyncName : `${barSyncName}: ${barSyncLabel}`,
      })}
      {renderKey(keys.align, 'align', onAlign)}
      {renderKey(keys.sync, 'sync', onSync)}
      {renderKey(keys.keyLock, 'keylock', onKeyLock)}
    </div>
  );
};
