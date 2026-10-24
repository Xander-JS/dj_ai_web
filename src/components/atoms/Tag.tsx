import React, { type HTMLAttributes } from 'react';
import { clsx } from 'clsx';
import './Tag.css';

export type TagTone = 'surface' | 'paper' | 'sage' | 'acid' | 'accent' | 'ink';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  /** surface/paper: dato neutro · sage: correcto · acid: requiere atención · accent: en curso · ink: estado activo */
  tone?: TagTone;
}

// Píldora pequeña para datos y estados dentro de filas y cabeceras; nunca encima de un título
export const Tag = React.forwardRef<HTMLSpanElement, TagProps>(
  ({ tone = 'surface', className, children, ...props }, ref) => (
    <span ref={ref} className={clsx('sd-tag', `sd-tag--${tone}`, className)} {...props}>
      {children}
    </span>
  ),
);

Tag.displayName = 'Tag';
