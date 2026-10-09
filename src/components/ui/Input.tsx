import React, { type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './Input.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ReactNode;
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, icon, wrapperClassName, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;

    return (
      <div className={clsx("input-wrapper", wrapperClassName)}>
        {label && (
          <label htmlFor={inputId} className="input-label">
            {label}
          </label>
        )}
        <div className="input-field-container">
          {icon && <div className="input-icon">{icon}</div>}
          <input
            ref={ref}
            id={inputId}
            className={clsx('input-field', icon && 'input-field-with-icon', className)}
            {...props}
          />
        </div>
      </div>
    );
  }
);

Input.displayName = 'Input';
