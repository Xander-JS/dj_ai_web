import React from 'react';
import { clsx } from 'clsx';
import './Progress.css';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number; // 0 to 100
  indeterminate?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, indeterminate = false, size = 'md', ...props }, ref) => {
    // Ensure value is between 0 and 100
    const clampedValue = Math.min(100, Math.max(0, value));

    return (
      <div
        ref={ref}
        className={clsx('progress-root', `progress-${size}`, indeterminate && 'progress-indeterminate', className)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : clampedValue}
        {...props}
      >
        <div
          className="progress-indicator"
          style={{ transform: `translateX(-${100 - clampedValue}%)` }}
        />
      </div>
    );
  }
);

Progress.displayName = 'Progress';
