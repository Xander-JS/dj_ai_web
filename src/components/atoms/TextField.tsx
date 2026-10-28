import React, { type InputHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { INPUT_MAX_LENGTH } from '../../config/constants';
import './TextField.css';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Icono decorativo a la izquierda del texto */
  icon?: ReactNode;
  /** sm: celdas y barras densas · md: predeterminado */
  size?: 'sm' | 'md';
  wrapperClassName?: string;
}

// Campo de texto píldora del Design System v2; el nombre accesible llega por aria-label o <label htmlFor>.
// Longitud máxima común (INPUT_MAX_LENGTH) salvo que el campo pida un límite propio más estricto
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ icon, size = 'md', className, wrapperClassName, maxLength = INPUT_MAX_LENGTH, ...props }, ref) => (
    <span className={clsx('sd-text-field', `sd-text-field--${size}`, icon && 'sd-text-field--with-icon', wrapperClassName)}>
      {icon && <span className="sd-text-field__icon">{icon}</span>}
      <input ref={ref} className={clsx('sd-text-field__input', className)} maxLength={maxLength} {...props} />
    </span>
  ),
);

TextField.displayName = 'TextField';
