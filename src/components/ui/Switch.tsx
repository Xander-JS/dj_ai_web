import React, { type InputHTMLAttributes } from 'react';
import './Switch.css';
import { clsx } from 'clsx';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, ...props }, ref) => {
    return (
      <label className={clsx('switch-wrapper', className)}>
        <div className="switch">
          <input type="checkbox" ref={ref} {...props} />
          <span className="switch-slider"></span>
        </div>
        {label && <span className="switch-label">{label}</span>}
      </label>
    );
  }
);

Switch.displayName = 'Switch';
