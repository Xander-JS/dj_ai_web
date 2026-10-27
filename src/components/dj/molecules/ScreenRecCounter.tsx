import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConsoleLed } from '../atoms/ConsoleLed';
import { formatDuration } from '../../../utils/formatters';
import './ScreenRecCounter.css';

/** Contador de grabación de la esquina superior derecha de la pantalla: punto rojo y `mm:ss`. */
export const ScreenRecCounter: React.FC<{ elapsedMs: number }> = ({ elapsedMs }) => {
  const { t } = useTranslation();
  const time = formatDuration(elapsedMs / 1000).padStart(5, '0');
  return (
    <span className="screen-rec-counter" data-testid="screen-rec-counter">
      <ConsoleLed on color="red" blink />
      {/* El tiempo visible no es una región viva: no se anuncia en cada refresco */}
      <span className="screen-rec-counter__time" aria-hidden="true">{time}</span>
      <span className="sd-visually-hidden">{t('mixer.screen.rec_counter', { time })}</span>
    </span>
  );
};
