import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDJStore } from '../../../store/useDJStore';
import { CURVE_BUTTONS, getCrossfaderSideLights } from '../../../services/console/mixerPanelModel';
import { ConsoleFader } from '../atoms/ConsoleFader';
import { ConsoleKey } from '../atoms/ConsoleKey';
import './MixerCrossfader.css';

const CROSSFADER_TICKS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Sección inferior del mixer, a todo el ancho: `← A`, el crossfader y `B →` (el brillo de cada
 * letra sigue la ganancia real de su lado con la curva activa) y, debajo, CP · LIN · CUT.
 * La curva elegida aquí vale solo para la sesión; la inicial viene de Ajustes.
 */
export const MixerCrossfader: React.FC = () => {
  const { t } = useTranslation();
  const { mixer, setCrossfader, setCrossfaderCurve } = useDJStore();
  const lights = getCrossfaderSideLights(mixer.crossfader, mixer.crossfaderCurve);

  return (
    <div className="mixer-xfader">
      <div className="mixer-xfader__row">
        <span
          className="mixer-xfader__side mixer-xfader__side--a"
          style={{ '--side-gain': lights.a } as React.CSSProperties}
          aria-hidden="true"
        >
          ← A
        </span>
        <ConsoleFader
          className="mixer-xfader__fader"
          orientation="horizontal"
          tone="master"
          value={mixer.crossfader}
          fillFrom={50}
          ticks={CROSSFADER_TICKS}
          aria-label={t('mixer.crossfader_label')}
          aria-valuetext={t('mixer.crossfader_value', { a: Math.round(lights.a * 100), b: Math.round(lights.b * 100) })}
          data-testid="crossfader-slider"
          onValueChange={(value) => setCrossfader(value)}
        />
        <span
          className="mixer-xfader__side mixer-xfader__side--b"
          style={{ '--side-gain': lights.b } as React.CSSProperties}
          aria-hidden="true"
        >
          B →
        </span>
      </div>

      <div className="mixer-xfader__curves" role="group" aria-label={t('mixer.curve')}>
        {CURVE_BUTTONS.map((curve) => {
          const active = mixer.crossfaderCurve === curve.id;
          return (
            <ConsoleKey
              key={curve.id}
              className="mixer-xfader__curve"
              lit={active}
              onClick={() => setCrossfaderCurve(curve.id)}
              aria-pressed={active}
              aria-label={t(curve.titleKey)}
              title={t(curve.titleKey)}
              data-testid={`curve-btn-${curve.id}`}
            >
              {t(curve.labelKey)}
            </ConsoleKey>
          );
        })}
      </div>
    </div>
  );
};
