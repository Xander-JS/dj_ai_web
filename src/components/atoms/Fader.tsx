import React, { type InputHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './Fader.css';

export interface FaderTick {
  value: number;
  label: string;
}

export interface FaderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max'> {
  value: number;
  min: number;
  max: number;
  /** Marcas de escala bajo la pista, como las serigrafías de un fader de mesa */
  ticks?: FaderTick[];
  wrapperClassName?: string;
}

const percentOf = (value: number, min: number, max: number) =>
  max === min ? 0 : ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;

// Fader horizontal: <input type="range"> nativo sobre una pista plana con relleno de tinta hasta el valor
export const Fader = React.forwardRef<HTMLInputElement, FaderProps>(
  ({ value, min, max, ticks, className, wrapperClassName, style, ...props }, ref) => {
    const percent = percentOf(value, min, max);
    return (
      <span
        className={clsx('sd-fader', wrapperClassName)}
        style={{ ...style, '--sd-fader-percent': `${percent}%` } as React.CSSProperties}
      >
        <span className="sd-fader__rail">
          <span className="sd-fader__track" aria-hidden="true">
            <span className="sd-fader__fill" />
          </span>
          <input
            ref={ref}
            type="range"
            min={min}
            max={max}
            value={value}
            className={clsx('sd-fader__input', className)}
            {...props}
          />
        </span>
        {ticks && ticks.length > 0 && (
          <span className="sd-fader__ticks" aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.value}
                className={clsx('sd-fader__tick', tick.value === value && 'is-current')}
                style={{ left: `${percentOf(tick.value, min, max)}%` }}
              >
                {tick.label}
              </span>
            ))}
          </span>
        )}
      </span>
    );
  },
);

Fader.displayName = 'Fader';
