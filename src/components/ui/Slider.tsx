import React, { type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './Slider.css';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  orientation?: 'horizontal' | 'vertical';
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, orientation = 'horizontal', ...props }, ref) => {
    return (
      <div className={clsx("slider-wrapper", orientation === 'vertical' && "slider-wrapper-vertical")}>
        <input
          ref={ref}
          type="range"
          className={clsx(
            'slider-input',
            orientation === 'vertical' && 'slider-vertical',
            className
          )}
          {...props}
        />
      </div>
    );
  }
);

Slider.displayName = 'Slider';
