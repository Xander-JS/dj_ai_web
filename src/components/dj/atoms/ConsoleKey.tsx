import React from 'react';
import { clsx } from 'clsx';
import './ConsoleKey.css';

export interface ConsoleKeyProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** Retroiluminación encendida (la tecla está activa). */
  lit?: boolean;
  /** Color de la luz: neutro (blanco frío), el tono del deck del contenedor (`--console-tone`) o fijo. */
  tone?: ConsoleKeyTone;
  /** Encendida y rellena del color de la luz (SYNC ✓), no solo borde y serigrafía. */
  filled?: boolean;
  /** La luz late despacio mientras dura un proceso (ALIGN en curso). */
  pulse?: boolean;
}

export type ConsoleKeyTone = 'neutral' | 'deck' | 'amber' | 'green' | 'red';

/**
 * Tecla rectangular retroiluminada de la consola, como las de un CDJ: cuerpo de goma oscuro,
 * serigrafía clara y una luz detrás que se enciende con su estado. Al pulsarla baja un poco.
 */
export const ConsoleKey: React.FC<ConsoleKeyProps> = ({ lit = false, tone = 'neutral', filled = false, pulse = false, className, children, ...rest }) => (
  <button
    type="button"
    className={clsx('console-key', `console-key--${tone}`, lit && 'is-lit', lit && filled && 'is-filled', lit && pulse && 'is-pulsing', className)}
    {...rest}
  >
    {children}
  </button>
);
