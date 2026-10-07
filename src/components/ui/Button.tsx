import React, { type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', fullWidth, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          'btn',
          `btn-${variant}`,
          `btn-${size}`,
          fullWidth && 'w-full',
          className
        )}
        style={{ width: fullWidth ? '100%' : undefined }}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
