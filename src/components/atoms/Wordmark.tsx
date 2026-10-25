import React from 'react';
import { clsx } from 'clsx';
import './Wordmark.css';

export interface WordmarkProps {
  name: string;
  className?: string;
}

// Marca de SYSTEM DJ: un disco geométrico (plato visto desde arriba) junto al nombre
export const Wordmark: React.FC<WordmarkProps> = ({ name, className }) => (
  <span className={clsx('sd-wordmark', className)}>
    <svg className="sd-wordmark__disc" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="16" fill="currentColor" />
      <circle cx="16" cy="16" r="6" fill="var(--sd-accent)" />
      <circle cx="16" cy="16" r="1.75" fill="currentColor" />
    </svg>
    <span className="sd-wordmark__name">{name}</span>
  </span>
);
