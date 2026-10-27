import React from 'react';
import { clsx } from 'clsx';
import './ConsoleSelectorKnob.css';

export interface SelectorKnobPosition<T extends string> {
  id: T;
  /** Serigrafía impresa junto al knob. */
  label: string;
  /** Ángulo del indicador en esta posición (0 = arriba, horario). */
  angle: number;
  placement: 'start' | 'top' | 'end';
  disabled?: boolean;
  title?: string;
}

export interface ConsoleSelectorKnobProps<T extends string> {
  /** Posiciones en orden físico, de izquierda a derecha. */
  positions: ReadonlyArray<SelectorKnobPosition<T>>;
  value: T;
  /** Serigrafía bajo el knob. */
  caption?: string;
  disabled?: boolean;
  'aria-label': string;
  'aria-valuetext': string;
  title?: string;
  'data-testid'?: string;
  /** Pulsar el knob lo gira a la siguiente posición. */
  onPress: () => void;
  /** Pulsar una serigrafía lleva el knob directamente a esa posición. */
  onSelect: (id: T) => void;
  /** Flechas ← / → con el foco en el knob. */
  onStep: (direction: -1 | 1) => void;
}

/**
 * Selector rotativo de posiciones fijas, como un conmutador de hardware: cuerpo redondo oscuro,
 * línea indicadora blanca y serigrafías alrededor (la elegida en blanco, las demás atenuadas).
 */
export function ConsoleSelectorKnob<T extends string>({
  positions,
  value,
  caption,
  disabled = false,
  onPress,
  onSelect,
  onStep,
  ...aria
}: ConsoleSelectorKnobProps<T>): React.ReactElement {
  const index = Math.max(0, positions.findIndex((p) => p.id === value));
  const angle = positions[index]?.angle ?? 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    onStep(e.key === 'ArrowLeft' ? -1 : 1);
  };

  const label = (placement: SelectorKnobPosition<T>['placement']) =>
    positions
      .filter((p) => p.placement === placement)
      .map((p) => (
        <button
          key={p.id}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          className={clsx('console-selector__label', `console-selector__label--${placement}`, p.id === value && 'is-selected')}
          disabled={disabled || p.disabled}
          title={p.title}
          onClick={() => onSelect(p.id)}
        >
          {p.label}
        </button>
      ));

  return (
    <div className={clsx('console-selector', disabled && 'is-disabled')}>
      <div className="console-selector__top">{label('top')}</div>
      <div className="console-selector__row">
        {label('start')}
        <button
          type="button"
          role="slider"
          className="console-selector__knob"
          aria-valuemin={0}
          aria-valuemax={positions.length - 1}
          aria-valuenow={index}
          disabled={disabled}
          style={{ '--selector-angle': `${angle}deg` } as React.CSSProperties}
          onClick={onPress}
          onKeyDown={handleKeyDown}
          {...aria}
        >
          <span className="console-selector__indicator" aria-hidden="true" />
        </button>
        {label('end')}
      </div>
      {caption && <span className="console-selector__caption" aria-hidden="true">{caption}</span>}
    </div>
  );
}
