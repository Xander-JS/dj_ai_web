import React, { type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './Switch.css';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  /** Nombre accesible cuando no hay <label htmlFor> asociado */
  label?: string;
}

// Interruptor píldora del Design System v2: checkbox nativo con role="switch" (teclado y lectores incluidos)
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ label, className, ...props }, ref) => (
    <span className={clsx('sd-switch', className)}>
      <input ref={ref} type="checkbox" role="switch" aria-label={label} className="sd-switch__input" {...props} />
      <span className="sd-switch__track" aria-hidden="true">
        <span className="sd-switch__thumb" />
      </span>
    </span>
  ),
);

Switch.displayName = 'Switch';
