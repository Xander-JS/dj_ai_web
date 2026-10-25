import React, { useId, type ReactNode } from 'react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../atoms/Icon';
import './Panel.css';

export type PanelTone = 'surface' | 'paper' | 'sage' | 'acid' | 'accent' | 'inverse';

export interface PanelProps {
  title?: string;
  /** Línea breve bajo el título: qué contiene el bloque o su estado */
  description?: ReactNode;
  icon?: LucideIcon;
  /** Contenido a la derecha de la cabecera: contador, estado o acciones */
  aside?: ReactNode;
  tone?: PanelTone;
  /** Nivel del título dentro de la página */
  headingLevel?: 'h2' | 'h3' | 'h4';
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

// Bloque de la consola: un campo plano con radio de panel; la cabecera nombra lo que responde el bloque
export const Panel: React.FC<PanelProps> = ({
  title,
  description,
  icon,
  aside,
  tone = 'surface',
  headingLevel: Heading = 'h3',
  className,
  bodyClassName,
  children,
}) => {
  const titleId = useId();
  const field = tone === 'surface' || tone === 'paper' ? undefined : `sd-field-${tone}`;

  return (
    <section
      className={clsx('sd-panel', `sd-panel--${tone}`, field, className)}
      aria-labelledby={title ? titleId : undefined}
    >
      {(title || aside) && (
        <header className="sd-panel__header">
          {title && (
            <div className="sd-panel__heading">
              <Heading id={titleId} className="sd-panel__title">
                {icon && <Icon icon={icon} size="md" />}
                {title}
              </Heading>
              {description && <p className="sd-panel__description">{description}</p>}
            </div>
          )}
          {aside && <div className="sd-panel__aside">{aside}</div>}
        </header>
      )}
      {children && <div className={clsx('sd-panel__body', bodyClassName)}>{children}</div>}
    </section>
  );
};
