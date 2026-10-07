import React, { InputHTMLAttributes } from 'react';
import './Switch.css';
import { clsx } from 'clsx';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, ...props }, ref) => {
    return (
      <label className={clsx('switch-wrapper', className)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
        <div className="switch">
          <input type="checkbox" ref={ref} {...props} />
          <span className="switch-slider"></span>
        </div>
        {label && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{label}</span>}
      </label>
    );
  }
);

Switch.displayName = 'Switch';
