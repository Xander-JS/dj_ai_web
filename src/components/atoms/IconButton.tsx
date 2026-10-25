import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import './IconButton.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode;
  /** Nombre accesible obligatorio: el botón no tiene texto visible */
  label: string;
  /** ghost: sin relleno (predeterminado) · surface: relleno neutro · ink: relleno de tinta, para el estado activo
   *  · accent: la acción principal de la región */
  variant?: 'ghost' | 'surface' | 'ink' | 'accent';
  /** sm: filas y barras densas de la consola */
  size?: 'sm' | 'md';
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, className, variant = 'ghost', size = 'md', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={clsx(
        'sd-icon-button',
        variant !== 'ghost' && `sd-icon-button--${variant}`,
        size === 'sm' && 'sd-icon-button--sm',
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  ),
);

IconButton.displayName = 'IconButton';
