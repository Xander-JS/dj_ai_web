import React, { useRef } from 'react';
import { clsx } from 'clsx';
import { KNOB_MAIN_GEOMETRY as K, MIXER_ASSETS } from './mixerAssets';
import './consoleTheme.css';
import './ConsoleKnob.css';

export type ConsoleTone = 'a' | 'b' | 'master';

export interface ConsoleKnobProps {
  value: number;
  min?: number;
  max?: number;
  /** Valor al que vuelve con doble clic; en controles bipolares es también el origen del arco. */
  defaultValue?: number;
  /** El arco nace en el centro (EQ, filtro, ganancia) en lugar de en el mínimo. */
  bipolar?: boolean;
  label: string;
  'aria-label': string;
  'aria-valuetext'?: string;
  'data-testid'?: string;
  size?: 'main' | 'compact';
  tone: ConsoleTone;
  disabled?: boolean;
  onValueChange: (value: number) => void;
}

const SWEEP = 135;
/** Píxeles de arrastre vertical para recorrer el rango completo (Shift: ajuste fino ×4). */
const DRAG_RANGE_PX = 160;
const FINE_FACTOR = 4;

const polar = (angle: number, radius: number) => {
  const rad = (angle * Math.PI) / 180;
  return { x: K.centerX + radius * Math.sin(rad), y: K.centerY - radius * Math.cos(rad) };
};

/** Arco SVG entre dos ángulos (0 = arriba, sentido horario) sobre la corona de la escala. */
function arcPath(from: number, to: number): string {
  const start = polar(Math.min(from, to), K.scaleRadius);
  const end = polar(Math.max(from, to), K.scaleRadius);
  const largeArc = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${K.scaleRadius} ${K.scaleRadius} 0 ${largeArc} 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

const TRACK_PATH = arcPath(-SWEEP, SWEEP);
const VIEWBOX = `0 0 ${K.width} ${K.height}`;
// Recorte del pomo: la imagen completa se amplía dentro de un círculo centrado en el pomo
const CAP_DIAMETER = K.capRadius * 2;
const CAP_IMAGE_STYLE: React.CSSProperties = {
  width: `${(K.width / CAP_DIAMETER) * 100}%`,
  left: `${(-(K.centerX - K.capRadius) / CAP_DIAMETER) * 100}%`,
  top: `${(-(K.centerY - K.capRadius) / CAP_DIAMETER) * 100}%`,
};
const CAP_BOX_STYLE: React.CSSProperties = {
  width: `${(CAP_DIAMETER / K.width) * 100}%`,
  left: `${((K.centerX - K.capRadius) / K.width) * 100}%`,
  top: `${((K.centerY - K.capRadius) / K.height) * 100}%`,
};

/**
 * Potenciómetro rotativo con knob-main.png. El valor vive en un <input type="range"> nativo
 * (teclado, lectores de pantalla, atajos) y el giro del pomo y el arco luminoso se derivan
 * siempre de `value`, así que reflejan también los cambios que llegan del store o de los atajos.
 * Arrastre vertical con puntero; doble clic restablece `defaultValue`.
 */
export const ConsoleKnob: React.FC<ConsoleKnobProps> = ({
  value,
  min = 0,
  max = 100,
  defaultValue,
  bipolar = false,
  label,
  size = 'main',
  tone,
  disabled = false,
  onValueChange,
  ...aria
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startValue: number } | null>(null);

  const span = max - min || 1;
  const clamped = Math.min(max, Math.max(min, value));
  const ratio = (clamped - min) / span;
  const angle = -SWEEP + ratio * SWEEP * 2;
  const originAngle = bipolar ? -SWEEP + (((defaultValue ?? (min + max) / 2) - min) / span) * SWEEP * 2 : -SWEEP;
  const hasArc = Math.abs(angle - originAngle) >= 0.5;

  const commit = (next: number) => {
    const rounded = Math.round(Math.min(max, Math.max(min, next)));
    if (rounded !== clamped) onValueChange(rounded);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    inputRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startValue: clamped };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const pixels = DRAG_RANGE_PX * (e.shiftKey ? FINE_FACTOR : 1);
    commit(drag.startValue + ((drag.startY - e.clientY) / pixels) * span);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  return (
    <div
      className={clsx('console-knob', `console-knob--${size}`, `console-tone-${tone}`, disabled && 'is-disabled')}
      style={{ '--knob-angle': `${angle - K.indicatorAngle}deg` } as React.CSSProperties}
    >
      <div
        className="console-knob__dial"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={defaultValue !== undefined && !disabled ? () => commit(defaultValue) : undefined}
      >
        <img className="console-knob__scale" src={MIXER_ASSETS.knobMain} alt="" draggable={false} decoding="async" />
        <svg className="console-knob__arc" viewBox={VIEWBOX} aria-hidden="true">
          <path className="console-knob__arc-track" d={TRACK_PATH} />
        </svg>
        {hasArc && (
          <svg className="console-knob__arc console-knob__arc--value" viewBox={VIEWBOX} aria-hidden="true">
            <path className="console-knob__arc-value" d={arcPath(originAngle, angle)} />
          </svg>
        )}
        <span className="console-knob__cap" style={CAP_BOX_STYLE} aria-hidden="true">
          <img src={MIXER_ASSETS.knobMain} alt="" draggable={false} decoding="async" style={CAP_IMAGE_STYLE} />
        </span>
        <input
          ref={inputRef}
          type="range"
          className="console-knob__input"
          min={min}
          max={max}
          step={1}
          value={clamped}
          disabled={disabled}
          onChange={(e) => onValueChange(Number(e.target.value))}
          {...aria}
        />
      </div>
      <span className="console-knob__label" aria-hidden="true">{label}</span>
    </div>
  );
};
