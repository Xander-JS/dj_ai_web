/**
 * SYSTEM DJ — Motion tokens
 * Curvas y duraciones compartidas por los componentes animados con Framer Motion.
 * Espejo de las variables --sd-ease-out / --sd-duration-* de tokens.css.
 */

import type { SpringOptions } from 'framer-motion';

/** Desaceleración exponencial: llegadas seguras, sin rebote. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const DURATION = {
  fast: 0.14,
  base: 0.24,
  entrance: 0.7,
  focal: 1.1,
} as const;

/** Resorte del efecto magnético: sigue al cursor sin latencia perceptible y se asienta sin oscilar. */
export const MAGNET_SPRING: SpringOptions = { stiffness: 160, damping: 18, mass: 0.5 };

/** Separación entre elementos hermanos que entran en secuencia. */
export const STAGGER = 0.08;
