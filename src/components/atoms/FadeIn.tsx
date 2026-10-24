import React, { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { DURATION, EASE_OUT } from '../../design-system/motion';

const MOTION_TAGS = {
  div: motion.div,
  p: motion.p,
  h1: motion.h1,
  h2: motion.h2,
  h3: motion.h3,
  li: motion.li,
  span: motion.span,
} as const;

export interface FadeInProps {
  as?: keyof typeof MOTION_TAGS;
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  x?: number;
  y?: number;
  /** Fracción visible del elemento necesaria para disparar la entrada */
  amount?: number;
  id?: string;
}

/**
 * Entrada al llegar al viewport: sube y aparece una sola vez.
 * Con movimiento reducido conserva el fundido y elimina el desplazamiento.
 */
export const FadeIn: React.FC<FadeInProps> = ({
  as = 'div',
  children,
  className,
  delay = 0,
  duration = DURATION.entrance,
  x = 0,
  y = 24,
  amount = 0.3,
  id,
}) => {
  const reduceMotion = useReducedMotion();
  // Las etiquetas comparten props; se unifican al tipo de motion.div
  const Component = MOTION_TAGS[as] as typeof motion.div;

  return (
    <Component
      id={id}
      className={className}
      initial={{ opacity: 0, x: reduceMotion ? 0 : x, y: reduceMotion ? 0 : y }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{ duration: reduceMotion ? DURATION.base : duration, delay, ease: EASE_OUT }}
    >
      {children}
    </Component>
  );
};
