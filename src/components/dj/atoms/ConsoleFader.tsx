import React, { useRef } from 'react';
import { clsx } from 'clsx';
import { FADER_CAP_GEOMETRY as C, MIXER_ASSETS } from '../mixerAssets';
import type { ConsoleTone } from './ConsoleKnob';
import '../consoleTheme.css';
import './ConsoleFader.css';

export interface ConsoleFaderProps {
  value: number;
  min?: number;
  max?: number;
  orientation: 'vertical' | 'horizontal';
  /** Vertical con el mínimo arriba (fader de pitch: − arriba, + abajo). */
  inverted?: boolean;
  /** Relleno luminoso desde este valor (p. ej. el centro del crossfader o del pitch). */
  fillFrom?: number;
  /** Marcas de escala serigrafiadas, como fracción 0–1 del recorrido desde el mínimo. */
  ticks?: readonly number[];
  tone: ConsoleTone;
  disabled?: boolean;
  className?: string;
  'aria-label': string;
  'aria-valuetext'?: string;
  'data-testid'?: string;
  onValueChange: (value: number) => void;
}

const DEFAULT_TICKS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

// Recorte del cuerpo opaco de fader-cap.png dentro de su lienzo de 800×800
const CAP_IMAGE_STYLE: React.CSSProperties = {
  width: `${(C.size / C.width) * 100}%`,
  left: `${(-C.left / C.width) * 100}%`,
  top: `${(-C.top / C.height) * 100}%`,
};

/**
 * Fader de hardware con fader-cap.png. Un <input type="range"> nativo (oculto a la vista) guarda
 * el valor para teclado y lectores de pantalla; el pomo, el relleno y la posición se derivan de
 * `value`. Con el puntero: arrastrar el pomo lo mueve sin saltos; pulsar en la ranura lo lleva ahí.
 */
export const ConsoleFader: React.FC<ConsoleFaderProps> = ({
  value,
  min = 0,
  max = 100,
  orientation,
  inverted = false,
  fillFrom,
  ticks = DEFAULT_TICKS,
  tone,
  disabled = false,
  className,
  onValueChange,
  ...aria
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const capRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<{ pointerId: number; offset: number } | null>(null);

  const span = max - min || 1;
  const clamped = Math.min(max, Math.max(min, value));
  const ratio = (clamped - min) / span;
  const fillRatio = fillFrom === undefined ? 0 : (Math.min(max, Math.max(min, fillFrom)) - min) / span;
  const vertical = orientation === 'vertical';

  /** Fracción 0–1 del recorrido (desde el mínimo) bajo el puntero, compensando el tamaño del pomo. */
  const ratioAt = (track: HTMLElement, clientX: number, clientY: number, offset: number) => {
    const rect = track.getBoundingClientRect();
    const cap = capRef.current?.getBoundingClientRect();
    if (vertical) {
      const capSize = cap?.height ?? 0;
      const travel = Math.max(1, rect.height - capSize);
      const fromTop = (clientY - offset - rect.top - capSize / 2) / travel;
      return inverted ? fromTop : 1 - fromTop;
    }
    const capSize = cap?.width ?? 0;
    const travel = Math.max(1, rect.width - capSize);
    return (clientX - offset - rect.left - capSize / 2) / travel;
  };

  const commitRatio = (next: number) => {
    const rounded = Math.round(min + Math.min(1, Math.max(0, next)) * span);
    if (rounded !== clamped) onValueChange(rounded);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    inputRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const cap = capRef.current?.getBoundingClientRect();
    const onCap = cap && e.clientX >= cap.left && e.clientX <= cap.right && e.clientY >= cap.top && e.clientY <= cap.bottom;
    // Sobre el pomo se conserva la distancia al centro; en la ranura el pomo salta al puntero
    const offset = onCap ? (vertical ? e.clientY - (cap.top + cap.height / 2) : e.clientX - (cap.left + cap.width / 2)) : 0;
    dragRef.current = { pointerId: e.pointerId, offset };
    if (!onCap) commitRatio(ratioAt(e.currentTarget, e.clientX, e.clientY, 0));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    commitRatio(ratioAt(e.currentTarget, e.clientX, e.clientY, drag.offset));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  };

  return (
    <div
      className={clsx(
        'console-fader',
        `console-fader--${orientation}`,
        inverted && 'console-fader--inverted',
        `console-tone-${tone}`,
        disabled && 'is-disabled',
        className,
      )}
      style={{
        '--fader-ratio': ratio,
        '--fader-fill-start': Math.min(ratio, fillRatio),
        '--fader-fill-end': Math.max(ratio, fillRatio),
      } as React.CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="console-fader__ticks" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} className={clsx('console-fader__tick', (tick === 0 || tick === 0.5 || tick === 1) && 'is-major')} style={{ '--tick': tick } as React.CSSProperties} />
        ))}
      </span>
      <span className="console-fader__slot" aria-hidden="true">
        <span className="console-fader__fill" />
      </span>
      <span ref={capRef} className="console-fader__cap" aria-hidden="true">
        <span className="console-fader__cap-body">
          <img src={MIXER_ASSETS.faderCap} alt="" draggable={false} decoding="async" style={CAP_IMAGE_STYLE} />
        </span>
      </span>
      <input
        ref={inputRef}
        type="range"
        className="console-fader__input"
        min={min}
        max={max}
        step={1}
        value={clamped}
        disabled={disabled}
        aria-orientation={orientation}
        onChange={(e) => onValueChange(Number(e.target.value))}
        {...aria}
      />
    </div>
  );
};
