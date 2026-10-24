import { clsx } from 'clsx';
import './LanguageSwitch.css';

export interface LanguageOption<T extends string> {
  value: T;
  /** Código corto visible (ES, EN) */
  short: string;
  /** Nombre del idioma en su propia lengua, para lectores de pantalla */
  name: string;
}

export interface LanguageSwitchProps<T extends string> {
  value: T;
  options: LanguageOption<T>[];
  label: string;
  onChange: (value: T) => void;
  className?: string;
}

// Selector segmentado de idioma: cada opción es un botón conmutador (aria-pressed)
export function LanguageSwitch<T extends string>({ value, options, label, onChange, className }: LanguageSwitchProps<T>) {
  return (
    <div role="group" aria-label={label} className={clsx('sd-language-switch', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.value}
          aria-label={option.name}
          aria-pressed={option.value === value}
          className="sd-language-switch__option"
          onClick={() => onChange(option.value)}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}
