import React from 'react';
import { clsx } from 'clsx';
import { CLIP_LEVEL } from '../../../services/console/mixerPanelModel';
import './LevelMeter.css';

export interface LevelMeterProps {
  /** Nivel real 0–100 (se recorta a ese rango). */
  level: number;
  label: string;
  className?: string;
  'data-testid'?: string;
  fillTestId?: string;
}

/**
 * Vúmetro vertical de LEDs segmentados: verde abajo, ámbar en medio y rojo arriba. Pinta el
 * nivel que recibe por props (sin estado propio): la escala de colores es fija y solo se recorta
 * la parte encendida. El segmento superior de clip se enciende desde CLIP_LEVEL.
 */
export const LevelMeter: React.FC<LevelMeterProps> = ({ level, label, className, fillTestId, ...rest }) => {
  const clamped = Math.max(0, Math.min(100, level));
  return (
    <div
      className={clsx('level-meter', className)}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      {...rest}
    >
      <span className="level-meter__scale" aria-hidden="true" />
      <span
        className="level-meter__fill"
        aria-hidden="true"
        data-testid={fillTestId}
        style={{ clipPath: `inset(${100 - clamped}% 0 0 0)` }}
      />
      <span className={clsx('level-meter__clip', clamped >= CLIP_LEVEL && 'is-on')} aria-hidden="true" />
    </div>
  );
};
