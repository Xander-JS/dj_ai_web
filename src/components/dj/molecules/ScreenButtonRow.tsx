import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConsoleKey } from '../atoms/ConsoleKey';
import { ConsoleLed } from '../atoms/ConsoleLed';
import type { DeckId } from '../../../types/deck';
import type { ScreenView } from '../../../services/console/digitalScreenStore';
import './ScreenButtonRow.css';

export interface ScreenButtonRowProps {
  view: ScreenView;
  subsection: DeckId;
  gridEnabled: boolean;
  recording: boolean;
  onMenu(): void;
  onGrid(): void;
  onLoad(deckId: DeckId): void;
  onRec(): void;
  /** Indicador de estado alineado al extremo derecho de la botonera. */
  status?: React.ReactNode;
}

/**
 * Botonera del borde superior de la pantalla: MENU, GRID, LOAD A, LOAD B y REC, en ese orden, y
 * el indicador de estado en el extremo derecho.
 */
export const ScreenButtonRow: React.FC<ScreenButtonRowProps> = ({
  view,
  subsection,
  gridEnabled,
  recording,
  onMenu,
  onGrid,
  onLoad,
  onRec,
  status,
}) => {
  const { t } = useTranslation();
  const menuOpen = view === 'menu';
  const loadKey = (deckId: DeckId) => {
    const active = menuOpen && subsection === deckId;
    return (
      <ConsoleKey
        tone="deck"
        lit={active}
        className={`screen-button-row__load console-tone-${deckId.toLowerCase()}`}
        aria-pressed={active}
        title={t('mixer.screen.load_title', { deck: deckId })}
        onClick={() => onLoad(deckId)}
        data-testid={`screen-key-load-${deckId.toLowerCase()}`}
      >
        {t(`mixer.screen.load_${deckId.toLowerCase()}`)}
      </ConsoleKey>
    );
  };

  return (
    <div className="screen-button-row" role="group" aria-label={t('mixer.screen.buttons')}>
      <ConsoleKey
        lit={menuOpen}
        aria-pressed={menuOpen}
        title={t('mixer.screen.menu_title')}
        onClick={onMenu}
        data-testid="screen-key-menu"
      >
        {t('mixer.screen.menu')}
      </ConsoleKey>
      <ConsoleKey
        lit={gridEnabled && !menuOpen}
        aria-pressed={gridEnabled}
        disabled={menuOpen}
        title={t('mixer.screen.grid_title')}
        onClick={onGrid}
        data-testid="screen-key-grid"
      >
        {t('mixer.screen.grid')}
      </ConsoleKey>
      {loadKey('A')}
      {loadKey('B')}
      <ConsoleKey
        className="screen-button-row__rec"
        aria-pressed={recording}
        aria-label={recording ? t('mixer.rec_stop') : t('mixer.rec_start')}
        title={recording ? t('mixer.rec_stop') : t('mixer.rec_start')}
        onClick={onRec}
        data-testid="screen-key-rec"
      >
        <ConsoleLed on={recording} color="red" blink />
        {t('mixer.rec_label')}
      </ConsoleKey>
      {status && <div className="screen-button-row__status">{status}</div>}
    </div>
  );
};
