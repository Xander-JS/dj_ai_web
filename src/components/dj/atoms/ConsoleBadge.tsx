import React from 'react';
import { clsx } from 'clsx';
import './ConsoleBadge.css';

export type ConsoleBadgeLight = 'tone' | 'amber' | 'green' | 'red' | 'neutral';

export interface ConsoleBadgeProps {
  /** Color del borde y de la serigrafía: su significado (correcto, aviso, rechazo, deck, información). */
  light: ConsoleBadgeLight;
  /** Explicación completa: se muestra al pasar el puntero o al enfocar, y forma parte del nombre accesible. */
  tooltip: string;
  /** Con `onActivate` el aviso es un botón (clic, Enter o Espacio). */
  onActivate?: () => void;
  /** El estado avanza solo: el borde late. */
  busy?: boolean;
  className?: string;
  'data-testid'?: string;
  children: React.ReactNode;
}

/**
 * Aviso de estado serigrafiado: rectángulo pequeño con borde fino de color y texto en mayúsculas.
 * Enfocable para que el tooltip también llegue por teclado.
 */
export const ConsoleBadge: React.FC<ConsoleBadgeProps> = ({ light, tooltip, onActivate, busy = false, className, children, ...rest }) => {
  const classes = clsx('console-badge', `console-badge--${light}`, busy && 'is-busy', onActivate && 'is-interactive', className);
  if (onActivate) {
    return (
      <button type="button" className={classes} data-tooltip={tooltip} aria-description={tooltip} onClick={onActivate} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <span className={classes} data-tooltip={tooltip} role="note" tabIndex={0} aria-description={tooltip} {...rest}>
      {children}
    </span>
  );
};
