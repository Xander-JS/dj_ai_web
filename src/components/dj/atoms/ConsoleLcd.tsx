import React from 'react';
import { clsx } from 'clsx';
import './ConsoleLcd.css';

export interface ConsoleLcdProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode;
}

/**
 * Mini display LCD de la consola: fondo azul muy oscuro, borde fino y dígitos cian monoespaciados.
 * Solo muestra su valor; la etiqueta va serigrafiada fuera.
 */
export const ConsoleLcd: React.FC<ConsoleLcdProps> = ({ className, children, ...rest }) => (
  <span className={clsx('console-lcd', className)} {...rest}>
    {children}
  </span>
);
