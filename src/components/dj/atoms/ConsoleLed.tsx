import React from 'react';
import { clsx } from 'clsx';
import './ConsoleLed.css';

export type ConsoleLedColor = 'red' | 'green' | 'amber' | 'neutral' | 'tone';

export interface ConsoleLedProps {
  on: boolean;
  /** `tone` usa el color del deck del contenedor (`--console-tone`). */
  color?: ConsoleLedColor;
  /** Parpadeo lento (~1 Hz); fijo con movimiento reducido. */
  blink?: boolean;
  /** Encendido a media luz, sin halo (p. ej. pista cargada en pausa). */
  dim?: boolean;
  className?: string;
}

/**
 * LED redondo de la consola. Apagado sigue visible como pieza física sin luz; la luz y su halo
 * solo aparecen encendido. Decorativo: el estado se comunica en el texto o el aria del control.
 */
export const ConsoleLed: React.FC<ConsoleLedProps> = ({ on, color = 'red', blink = false, dim = false, className }) => (
  <span
    className={clsx('console-led', `console-led--${color}`, on && 'is-on', on && dim && 'is-dim', on && blink && 'is-blinking', className)}
    aria-hidden="true"
  />
);
