import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConsoleLcd } from '../atoms/ConsoleLcd';
import { ConsoleFader } from '../atoms/ConsoleFader';
import { METER_DETENTS, formatDetent } from '../../../services/console/downbeatPanelModel';
import './DownbeatMeterZone.css';

export interface DownbeatMeterZoneProps {
  /** Posición en `mm:ss.mmm`, o `--:--.---` sin fuente. */
  clock: string;
  positionTooltip: string;
  meterIndex: number;
  disabled: boolean;
  testIdPrefix: string;
  onMeterChange: (index: number) => void;
}

const LAST_DETENT = METER_DETENTS.length - 1;

/**
 * Zona 2: los mini displays POSICIÓN (S) y MÉTRICA en una fila y, debajo, el fader de métrica de
 * cuatro posiciones fijas con su marca y serigrafía bajo cada una. Mover el fader no guarda nada.
 */
export const DownbeatMeterZone: React.FC<DownbeatMeterZoneProps> = ({
  clock,
  positionTooltip,
  meterIndex,
  disabled,
  testIdPrefix,
  onMeterChange,
}) => {
  const { t } = useTranslation();
  const meterText = formatDetent(meterIndex);

  return (
    <div className="downbeat-meter">
      <div className="downbeat-meter__displays">
        <span className="downbeat-meter__readout">
          <span className="downbeat-meter__caption">{t('dj.downbeat_pos_label')}</span>
          <ConsoleLcd title={positionTooltip} data-testid={`${testIdPrefix}-position`}>{clock}</ConsoleLcd>
        </span>
        <span className="downbeat-meter__readout">
          <span className="downbeat-meter__caption">{t('dj.downbeat_metric_label')}</span>
          <ConsoleLcd data-testid={`${testIdPrefix}-meter`}>{meterText}</ConsoleLcd>
        </span>
      </div>

      <div className="downbeat-meter__fader" title={t('dj.downbeat_metric_tooltip')}>
        <ConsoleFader
          orientation="horizontal"
          tone="master"
          min={0}
          max={LAST_DETENT}
          value={meterIndex}
          ticks={[]}
          disabled={disabled}
          aria-label={t('dj.downbeat_meter_fader')}
          aria-valuetext={meterText}
          data-testid={`${testIdPrefix}-meter-fader`}
          onValueChange={onMeterChange}
        />
        <div className="downbeat-meter__scale" aria-hidden="true">
          {METER_DETENTS.map((_, index) => (
            <span
              key={index}
              className="downbeat-meter__detent"
              data-selected={index === meterIndex}
              style={{ '--detent': index / LAST_DETENT } as React.CSSProperties}
            >
              {formatDetent(index)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
