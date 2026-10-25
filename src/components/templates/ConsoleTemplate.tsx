import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { clsx } from 'clsx';
import './ConsoleTemplate.css';

export interface ConsoleTemplateProps extends HTMLAttributes<HTMLDivElement> {
  /** Ocupa el alto del área de trabajo y deja que un hijo gestione su propio desplazamiento */
  fill?: boolean;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}

/**
 * Plantilla de las pantallas de la consola rediseñadas con el Design System v2
 * (Inicio, Biblioteca, Playlists, Sesiones). Todo el estilo queda acotado a .sd-console:
 * el shell compartido y Mixer no heredan nada de aquí.
 */
export const ConsoleTemplate: React.FC<ConsoleTemplateProps> = ({ fill = false, className, children, ...props }) => (
  <div className={clsx('sd-console', fill && 'sd-console--fill', className)} {...props}>
    {children}
  </div>
);
