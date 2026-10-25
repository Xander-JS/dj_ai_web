import React from 'react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE, type IconSize } from '../../design-system/icons';
import './Icon.css';

export interface IconProps {
  icon: LucideIcon;
  size?: IconSize;
  /** Nombre accesible. Sin él el icono es decorativo y se oculta a lectores de pantalla */
  label?: string;
  className?: string;
}

// Icono del sistema: un tamaño de la escala, el trazo común y el color heredado del texto
export const Icon: React.FC<IconProps> = ({ icon: Glyph, size = 'md', label, className }) => (
  <Glyph
    size={ICON_SIZE[size]}
    strokeWidth={ICON_STROKE}
    className={clsx('sd-icon', className)}
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
    focusable="false"
  />
);
