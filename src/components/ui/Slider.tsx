import React, { InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './Slider.css';

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  orientation?: 'horizontal' | 'vertical';
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, orientation = 'horizontal', ...props }, ref) => {
    return (
      <div className="slider-wrapper" style={{ height: orientation === 'vertical' ? '100%' : 'auto' }}>
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
