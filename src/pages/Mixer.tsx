import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { DJConsole } from '../components/dj/organisms/DJConsole';
import { useMixerImmersiveMode } from '../hooks/useMixerImmersiveMode';
import { useMixerEntrance } from '../hooks/useMixerEntrance';
import './Mixer.css';
import './MixerEntrance.css';

/**
 * Sección Mixer: la consola completa (pantalla digital, Deck A, mixer y Deck B), ajustada al
 * alto y al ancho disponibles. En un teléfono pasa a pantalla completa en horizontal, con la
 * consola sola.
 * Al entrar, la consola se enciende como un equipo real (MixerEntrance.css).
 */
export const Mixer: React.FC = () => {
  const { t } = useTranslation();
  const { isPhone, overlay, start } = useMixerImmersiveMode();
  const rootRef = useRef<HTMLDivElement>(null);
  const entrance = useMixerEntrance(rootRef);

  return (
    <div
      ref={rootRef}
      className={clsx(
        'mixer-page-container',
        isPhone && 'mixer-page-container--immersive',
        entrance && `mixer-entrance mixer-entrance--${entrance}`,
      )}
    >
      <DJConsole />

      {overlay === 'tap' && (
        <button type="button" className="mixer-immersive-overlay" onClick={start} data-testid="mixer-tap-to-start">
          <span className="mixer-immersive-overlay__title">{t('mixer.immersive.tap_title')}</span>
          <span className="mixer-immersive-overlay__hint">{t('mixer.immersive.tap_hint')}</span>
        </button>
      )}
      {overlay === 'rotate' && (
        <div className="mixer-immersive-overlay" role="alert" data-testid="mixer-rotate-device">
          <span className="mixer-immersive-overlay__icon" aria-hidden="true" />
          <span className="mixer-immersive-overlay__title">{t('mixer.immersive.rotate_title')}</span>
          <span className="mixer-immersive-overlay__hint">{t('mixer.immersive.rotate_hint')}</span>
        </div>
      )}
    </div>
  );
};
