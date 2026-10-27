import React from 'react';
import { useTranslation } from 'react-i18next';
import { Wordmark } from '../../atoms/Wordmark';
import './ScreenPowerOn.css';

/**
 * Capa de encendido de la pantalla: la línea de barrido y el logo SYSTEM DJ sobre negro. Solo
 * se ve durante la entrada del Mixer (MixerEntrance.css la muestra y la anima). Decorativa.
 */
export const ScreenPowerOn: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="screen-power-on" aria-hidden="true">
      <span className="screen-power-on__line" />
      <span className="screen-power-on__logo">
        <Wordmark name={t('landing.brand')} />
      </span>
    </div>
  );
};
