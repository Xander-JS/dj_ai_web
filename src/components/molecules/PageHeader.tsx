import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import './PageHeader.css';

export interface PageHeaderProps {
  title: ReactNode;
  titleId?: string;
  description?: ReactNode;
  /** Acciones principales de la pantalla, alineadas a la derecha */
  actions?: ReactNode;
  className?: string;
}

// Cabecera de pantalla de la consola: título Kanit Black, una línea de contexto y las acciones de la tarea principal
export const PageHeader: React.FC<PageHeaderProps> = ({ title, titleId, description, actions, className }) => (
  <header className={clsx('sd-page-header', className)}>
    <div className="sd-page-header__copy">
      <h2 id={titleId} className="sd-page-header__title">{title}</h2>
      {description && <p className="sd-page-header__description">{description}</p>}
    </div>
    {actions && <div className="sd-page-header__actions">{actions}</div>}
  </header>
);
