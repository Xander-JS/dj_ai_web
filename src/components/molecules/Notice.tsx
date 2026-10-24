import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from 'lucide-react';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import './Notice.css';

export type NoticeTone = 'success' | 'warning' | 'error' | 'info';

const TONE_ICON: Record<NoticeTone, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

export interface NoticeProps {
  tone: NoticeTone;
  children: ReactNode;
  /** Botón de cierre; requiere dismissLabel */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Acciones a la derecha del mensaje */
  action?: ReactNode;
  /** Por defecto: alert para errores, status para el resto */
  role?: 'alert' | 'status';
  className?: string;
}

// Aviso en línea dentro del bloque que lo origina. success: salvia · error: ácido · warning/info: superficie
export const Notice: React.FC<NoticeProps> = ({ tone, children, onDismiss, dismissLabel, action, role, className }) => (
  <div
    role={role ?? (tone === 'error' ? 'alert' : 'status')}
    className={clsx(
      'sd-notice',
      `sd-notice--${tone}`,
      tone === 'success' && 'sd-field-sage',
      tone === 'error' && 'sd-field-acid',
      className,
    )}
  >
    <Icon icon={TONE_ICON[tone]} size="md" className="sd-notice__icon" />
    <div className="sd-notice__body">{children}</div>
    {action && <div className="sd-notice__action">{action}</div>}
    {onDismiss && dismissLabel && (
      <IconButton icon={<Icon icon={X} size="sm" />} label={dismissLabel} size="sm" onClick={onDismiss} />
    )}
  </div>
);
