import React, { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { clsx } from 'clsx';
import { DURATION, EASE_OUT } from '../../design-system/motion';
import './FloatingImage.css';

export interface FloatingImageProps {
  /** Ruta PNG original (respaldo) */
  src: string;
  /** Versión WebP ligera, servida primero cuando el navegador la admite */
  webp?: string;
  width: number;
  height: number;
  className?: string;
  /** Recorrido vertical del parallax en píxeles (mitad hacia cada lado) */
  drift?: number;
  /** Inclinación de reposo en grados */
  tilt?: number;
}

/**
 * Objeto 3D decorativo: entra con escala y deriva en vertical al ritmo del scroll.
 * Es puramente decorativo (alt vacío, oculto a lectores) y nunca captura el puntero.
 * Sin bucles: solo se mueve cuando el usuario hace scroll.
 */
export const FloatingImage: React.FC<FloatingImageProps> = ({
  src,
  webp,
  width,
  height,
  className,
  drift = 60,
  tilt = 0,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], reduceMotion ? [0, 0] : [drift / 2, -drift / 2]);

  return (
    <motion.div
      ref={ref}
      aria-hidden="true"
      className={clsx('sd-floating-image', className)}
      style={{ y, rotate: tilt }}
      initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.85 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: DURATION.entrance + 0.2, ease: EASE_OUT }}
    >
      <picture>
        {webp && <source srcSet={webp} type="image/webp" />}
        <img src={src} alt="" width={width} height={height} loading="lazy" decoding="async" draggable={false} />
      </picture>
    </motion.div>
  );
};
