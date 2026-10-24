import React, { type HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './ProgressBar.css';

export interface ProgressBarProps extends HTMLAttributes<HTMLDivElement> {
  /** 0 a 100 */
  value?: number;
  indeterminate?: boolean;
}

// Barra de progreso plana: tinta sobre la superficie, sin brillo ni degradado
export const ProgressBar = React.forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ value = 0, indeterminate = false, className, ...props }, ref) => {
    const clamped = Math.min(100, Math.max(0, value));
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : clamped}
        className={clsx('sd-progress', indeterminate && 'sd-progress--indeterminate', className)}
        {...props}
      >
        <div className="sd-progress__fill" style={indeterminate ? undefined : { transform: `scaleX(${clamped / 100})` }} />
      </div>
    );
  },
);

ProgressBar.displayName = 'ProgressBar';
