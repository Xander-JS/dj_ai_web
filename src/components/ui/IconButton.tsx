import React, { ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './Button.css'; // Reuses the button styles
import './IconButton.css'; // Adds specific icon button padding

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon: React.ReactNode;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = 'ghost', size = 'md', icon, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          'btn',
          'icon-btn',
          `btn-${variant}`,
          `icon-btn-${size}`,
          className
        )}
        {...props}
      >
        {icon}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
