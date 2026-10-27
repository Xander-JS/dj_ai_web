import { useId, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { Icon } from '../atoms/Icon';
import './ChoiceTiles.css';

export interface ChoiceTile<T extends string> {
  value: T;
  label: ReactNode;
  /** Muestra de lo que produce la opción (tema, idioma, color) */
  preview?: ReactNode;
  /** Nota breve bajo la etiqueta (p. ej. «Predeterminado») */
  hint?: ReactNode;
}

export interface ChoiceTilesProps<T extends string> {
  value: T;
  options: ChoiceTile<T>[];
  /** Nombre accesible del grupo */
  label: string;
  onChange: (value: T) => void;
  /** tile: muestra grande sobre la etiqueta · swatch: círculo compacto de color */
  variant?: 'tile' | 'swatch';
  /** Solo la muestra a la vista; la etiqueta queda como nombre accesible */
  hideLabels?: boolean;
  className?: string;
}

// Grupo de radios nativos con muestra: flechas del teclado, foco y lectores sin lógica propia
export function ChoiceTiles<T extends string>({ value, options, label, onChange, variant = 'tile', hideLabels, className }: ChoiceTilesProps<T>) {
  const name = useId();
  return (
    <fieldset className={clsx('sd-choice-tiles', `sd-choice-tiles--${variant}`, className)}>
      <legend className="sd-visually-hidden">{label}</legend>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label key={option.value} className={clsx('sd-choice-tile', checked && 'is-checked')}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              className="sd-visually-hidden"
              onChange={() => onChange(option.value)}
            />
            {option.preview && (
              <span className="sd-choice-tile__preview" aria-hidden="true">
                {option.preview}
                <span className="sd-choice-tile__check">
                  <Icon icon={Check} size="xs" />
                </span>
              </span>
            )}
            <span className={clsx('sd-choice-tile__label', hideLabels && 'sd-visually-hidden')}>{option.label}</span>
            {option.hint && <span className="sd-choice-tile__hint">{option.hint}</span>}
          </label>
        );
      })}
    </fieldset>
  );
}
