import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Loader2, type LucideIcon } from 'lucide-react';
import { Icon } from '../atoms/Icon';
import './EmptyState.css';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** loading muestra un indicador giratorio y se anuncia como estado */
  status?: 'empty' | 'loading';
  action?: ReactNode;
  className?: string;
}

// Estado vacío o de carga dentro del marco de su bloque: explica qué falta y cuál es el siguiente paso
export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon, status = 'empty', action, className }) => {
  const glyph = status === 'loading' ? Loader2 : icon;
  return (
    <div
      className={clsx('sd-empty-state', `sd-empty-state--${status}`, className)}
      role={status === 'loading' ? 'status' : undefined}
    >
      {glyph && <Icon icon={glyph} size="lg" className="sd-empty-state__icon" />}
      <p className="sd-empty-state__title">{title}</p>
      {description && <p className="sd-empty-state__description">{description}</p>}
      {action && <div className="sd-empty-state__action">{action}</div>}
    </div>
  );
};
