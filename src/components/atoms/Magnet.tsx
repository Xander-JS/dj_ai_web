import React, { useEffect, useRef, type ReactNode } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { MAGNET_SPRING } from '../../design-system/motion';
import { prefersFinePointer } from '../../design-system/documentScroll';

export interface MagnetProps {
  children: ReactNode;
  className?: string;
  /** Distancia en píxeles alrededor del elemento en la que el imán se activa */
  padding?: number;
  /** Divisor del desplazamiento: cuanto mayor, más sutil el seguimiento */
  strength?: number;
}

/**
 * Efecto magnético: el contenido sigue al cursor cuando éste se acerca.
 * Solo con puntero fino (ratón/trackpad) y sin movimiento reducido; en pantallas
 * táctiles el contenido queda quieto. El contenedor exterior no se transforma, así
 * que su caja sirve de referencia estable y no hay saltos de layout.
 */
export const Magnet: React.FC<MagnetProps> = ({ children, className, padding = 120, strength = 6 }) => {
  const anchorRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const x = useSpring(useMotionValue(0), MAGNET_SPRING);
  const y = useSpring(useMotionValue(0), MAGNET_SPRING);

  useEffect(() => {
    if (reduceMotion || !prefersFinePointer()) return;
    let frame = 0;

    const handlePointerMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        const rect = anchor.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const inside = Math.abs(dx) < rect.width / 2 + padding && Math.abs(dy) < rect.height / 2 + padding;
        x.set(inside ? dx / strength : 0);
        y.set(inside ? dy / strength : 0);
      });
    };
    const reset = () => {
      x.set(0);
      y.set(0);
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', reset);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', handlePointerMove);
      document.documentElement.removeEventListener('pointerleave', reset);
      reset();
    };
  }, [reduceMotion, padding, strength, x, y]);

  return (
    <div ref={anchorRef} className={className}>
      <motion.div style={{ x, y, willChange: 'transform' }}>{children}</motion.div>
    </div>
  );
};
