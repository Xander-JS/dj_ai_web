import React, { useId, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { FadeIn } from '../atoms/FadeIn';
import './FeaturePanel.css';

export type FeaturePanelTone = 'accent' | 'sage' | 'acid' | 'paper';

export interface FeaturePanelProps {
  tone: FeaturePanelTone;
  title: string;
  description: string;
  /** Objeto 3D decorativo anclado a la esquina superior del panel */
  decoration?: ReactNode;
  /** wide: para objetos apaisados como la controladora */
  decorationSize?: 'square' | 'wide';
  /** Contenido interactivo opcional que ocupa la zona superior en lugar de la decoración */
  children?: ReactNode;
  delay?: number;
}

// Panel de capacidad: un campo de color plano, la decoración arriba y el texto anclado abajo
export const FeaturePanel: React.FC<FeaturePanelProps> = ({ tone, title, description, decoration, decorationSize = 'square', children, delay = 0 }) => {
  const titleId = useId();

  return (
    <FadeIn className={clsx('sd-feature-panel', `sd-feature-panel--${tone}`, 'sd-on-field')} delay={delay} amount={0.2}>
      <article aria-labelledby={titleId} className="sd-feature-panel__inner">
        {children && <div className="sd-feature-panel__interactive">{children}</div>}
        {decoration && (
          <div className={clsx('sd-feature-panel__decoration', `sd-feature-panel__decoration--${decorationSize}`)}>{decoration}</div>
        )}
        <div className="sd-feature-panel__copy">
          <h3 id={titleId} className="sd-feature-panel__title">{title}</h3>
          <p className="sd-feature-panel__description">{description}</p>
        </div>
      </article>
    </FadeIn>
  );
};
