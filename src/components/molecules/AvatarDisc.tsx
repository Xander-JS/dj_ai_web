import { useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import './AvatarDisc.css';

export interface AvatarDiscProps {
  src?: string | null;
  /** Nombre visible: texto alternativo de la foto y origen de la inicial */
  name: string;
  /** Texto de la etiqueta cuando no hay foto ni nombre */
  fallback?: string;
  /** El plato gira mientras dura una operación (subida de foto) */
  spinning?: boolean;
  size?: 'md' | 'lg';
  /** Acción superpuesta en el borde del disco (cambiar foto) */
  action?: ReactNode;
  className?: string;
}

// Avatar como galleta de un vinilo visto desde arriba: el mismo plato del Wordmark, a escala de perfil
export const AvatarDisc: React.FC<AvatarDiscProps> = ({ src, name, fallback = 'DJ', spinning = false, size = 'lg', action, className }) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  const initial = name.trim().charAt(0).toUpperCase() || fallback;

  return (
    <div className={clsx('sd-avatar-disc', `sd-avatar-disc--${size}`, spinning && 'is-spinning', className)}>
      <div className="sd-avatar-disc__platter">
        <svg className="sd-avatar-disc__grooves" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <circle cx="50" cy="50" r="49" className="sd-avatar-disc__vinyl" />
          {[44, 40, 36].map((r) => (
            <circle key={r} cx="50" cy="50" r={r} className="sd-avatar-disc__groove" />
          ))}
          {/* Marca de posición: hace visible el giro del plato */}
          <rect x="49" y="3" width="2" height="7" rx="1" className="sd-avatar-disc__marker" />
        </svg>
        <div className="sd-avatar-disc__label">
          {showImage ? (
            <img src={src ?? undefined} alt={name} className="sd-avatar-disc__image" onError={() => setFailedSrc(src ?? null)} />
          ) : (
            <span className="sd-avatar-disc__initial" aria-hidden={name ? true : undefined}>{initial}</span>
          )}
        </div>
      </div>
      {action && <div className="sd-avatar-disc__action">{action}</div>}
    </div>
  );
};
