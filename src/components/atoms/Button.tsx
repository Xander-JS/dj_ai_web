import React, { type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** accent: acción principal · ink: acción secundaria rellena · ghost: acción terciaria sin relleno */
  variant?: 'accent' | 'ink' | 'ghost';
  /** sm: barras y filas densas de la consola · md: predeterminado · lg: llamadas a la acción */
  size?: 'sm' | 'md' | 'lg';
}

// Botón píldora del Design System v2: una sola forma para todas las acciones
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'accent', size = 'md', type = 'button', children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={clsx('sd-button', `sd-button--${variant}`, `sd-button--${size}`, className)}
      {...props}
    >
      {children}
    </button>
  ),
);

Button.displayName = 'Button';
