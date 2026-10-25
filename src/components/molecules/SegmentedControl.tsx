import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import './SegmentedControl.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  /** Nombre accesible del grupo */
  label: string;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

// Control segmentado de la consola: mismo patrón que LanguageSwitch (botones con aria-pressed)
export function SegmentedControl<T extends string>({ value, options, label, onChange, disabled, className }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={clsx('sd-segmented', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          disabled={disabled}
          className="sd-segmented__option"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
