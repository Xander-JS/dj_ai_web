import React, { useState } from 'react';
import { clsx } from 'clsx';
import './HardwareButton.css';

export interface HardwareButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> {
  /**
   * Solo cambia la luz: momentary, blanca y con un destello al pulsarlo · latching, queda
   * enclavado y se enciende en ámbar mientras está activo.
   */
  variant: 'momentary' | 'latching';
  /** La retroiluminación del icono está encendida. */
  lit: boolean;
  /** Icono impreso en la goma. */
  icon: React.ReactNode;
  /** Serigrafía bajo el botón, sobre la placa; sin ella (botones agrupados) no se imprime. */
  caption?: string;
}

/**
 * Botón de goma retroiluminado, como el de un CDJ: goma oscura mate hundida en un bisel (protegida
 * de pulsaciones accidentales) y la luz sale del icono, nunca del borde ni del fondo. Al pulsarlo
 * baja y la goma se aplasta.
 */
export const HardwareButton: React.FC<HardwareButtonProps> = ({ variant, lit, icon, caption, className, onClick, ...rest }) => {
  // Cada pulsación del botón momentáneo reinicia el destello (cambia la `key` del icono)
  const [flashCount, setFlashCount] = useState(0);
  const flashes = variant === 'momentary';

  return (
    <span className={clsx('hw-button', `hw-button--${variant}`, className)}>
      <span className="hw-button__well">
        <button
          type="button"
          className={clsx('hw-button__cap', lit && 'is-lit')}
          onClick={(e) => {
            if (flashes) setFlashCount((n) => n + 1);
            onClick?.(e);
          }}
          {...rest}
        >
          <span key={flashCount} className={clsx('hw-button__icon', flashCount > 0 && 'is-flashing')} aria-hidden="true">
            {icon}
          </span>
        </button>
      </span>
      {caption && <span className="hw-button__caption" aria-hidden="true">{caption}</span>}
    </span>
  );
};
