import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDJStore } from '../../../store/useDJStore';
import { ConsoleLed } from '../atoms/ConsoleLed';
import './ConsoleLiveIndicator.css';

/**
 * Indicador `EN VIVO` / `EN ESPERA`: LED rojo encendido y «en vivo» mientras al menos un deck
 * suena; apagado y «en espera» si no. Solo lectura.
 */
export const ConsoleLiveIndicator: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation();
  const { deckA, deckB } = useDJStore();
  const isLive = deckA.playbackState === 'playing' || deckB.playbackState === 'playing';

  return (
    <span
      className={className ? `console-live ${className}` : 'console-live'}
      role="status"
      aria-label={t(isLive ? 'mixer.live_on' : 'mixer.live_off')}
      data-testid="console-live"
      data-live={isLive}
    >
      <ConsoleLed on={isLive} color="red" />
      <span aria-hidden="true">{t(isLive ? 'mixer.live' : 'mixer.standby')}</span>
    </span>
  );
};
