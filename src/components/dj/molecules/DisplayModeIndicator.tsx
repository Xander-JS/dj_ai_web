import React from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { ConsoleLed, type ConsoleLedColor } from '../atoms/ConsoleLed';
import type { DeckDisplayMode } from '../../../hooks/useDeckDisplayMode';
import './DisplayModeIndicator.css';

export interface DisplayModeIndicatorProps {
  mode: DeckDisplayMode;
  /** Luz de GUÍA encendida: el color del deck, o rojo / ámbar con un error o warning en pantalla. */
  guideColor: ConsoleLedColor;
}

/** Serigrafía sobre el display LED: título MODO a la izquierda y los LEDs GUÍA y MAPA a la derecha. */
export const DisplayModeIndicator: React.FC<DisplayModeIndicatorProps> = ({ mode, guideColor }) => {
  const { t } = useTranslation();
  const modeLabel = t(mode === 'guide' ? 'dj.display_mode_guide' : 'dj.display_mode_map');

  return (
    <div className="display-mode-indicator">
      <span className="display-mode-indicator__title" aria-hidden="true">{t('dj.display_mode')}</span>
      <span className="display-mode-indicator__leds" aria-hidden="true">
        <span className={clsx('display-mode-indicator__led', mode === 'guide' && 'is-active')}>
          {t('dj.display_mode_guide')}
          <ConsoleLed on={mode === 'guide'} color={guideColor} />
        </span>
        <span className={clsx('display-mode-indicator__led', mode === 'map' && 'is-active')}>
          {t('dj.display_mode_map')}
          <ConsoleLed on={mode === 'map'} color="tone" />
        </span>
      </span>
      <span className="sd-visually-hidden">{t('dj.display_mode_state', { mode: modeLabel })}</span>
    </div>
  );
};
