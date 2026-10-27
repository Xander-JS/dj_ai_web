import React from 'react';
import { useTranslation } from 'react-i18next';
import { ConsoleLed, type ConsoleLedColor } from '../atoms/ConsoleLed';
import type { DownbeatStatusLeds as Leds } from '../../../services/console/downbeatPanelModel';
import './DownbeatStatusLeds.css';

export interface DownbeatStatusLedsProps {
  leds: Leds;
  /** Tooltip de cada fila, si lo tiene (p. ej. la guía de SIN CONFIRMAR). */
  tooltips: Partial<Record<keyof Leds, string>>;
  testIdPrefix: string;
}

const ROWS: ReadonlyArray<{ id: keyof Leds; labelKey: string; color: ConsoleLedColor }> = [
  { id: 'unconfirmed', labelKey: 'dj.downbeat_led_unconfirmed', color: 'neutral' },
  { id: 'playhead', labelKey: 'dj.downbeat_led_playhead', color: 'green' },
  { id: 'suggested', labelKey: 'dj.downbeat_led_suggested', color: 'amber' },
  { id: 'confirmed', labelKey: 'dj.downbeat_led_confirmed', color: 'tone' },
];

/**
 * Zona 1: cuatro LEDs apilados con su serigrafía, sin título. Responden a «¿en qué estado está el
 * downbeat de esta pista?»; el estado encendido / apagado también se lee con lector de pantalla.
 */
export const DownbeatStatusLeds: React.FC<DownbeatStatusLedsProps> = ({ leds, tooltips, testIdPrefix }) => {
  const { t } = useTranslation();

  return (
    <ul className="downbeat-leds" aria-label={t('dj.downbeat_status_label')}>
      {ROWS.map((row) => (
        <li
          key={row.id}
          className="downbeat-leds__row"
          title={tooltips[row.id]}
          data-testid={`${testIdPrefix}-led-${row.id}`}
          data-on={leds[row.id]}
        >
          <ConsoleLed on={leds[row.id]} color={row.color} />
          <span className="downbeat-leds__label">{t(row.labelKey)}</span>
          <span className="sd-visually-hidden">{t(leds[row.id] ? 'dj.downbeat_led_on' : 'dj.downbeat_led_off')}</span>
        </li>
      ))}
    </ul>
  );
};
