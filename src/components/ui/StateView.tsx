import React from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { AlertCircle, CheckCircle, SearchX, Loader2, AlertTriangle, LucideIcon } from 'lucide-react';
import './StateView.css';

export type StatusType = 'loading' | 'empty' | 'error' | 'success' | 'warning';

export interface StateViewProps {
  status: StatusType;
  title?: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
}

export const StateView: React.FC<StateViewProps> = ({ 
  status, 
  title, 
  description, 
  icon: CustomIcon,
  action 
}) => {
  const { t } = useTranslation();

  let Icon = CustomIcon;
  let defaultTitle = '';
  let defaultDesc = '';

  switch (status) {
    case 'loading':
      Icon = Icon || Loader2;
      defaultTitle = t('states.loading');
      break;
    case 'error':
      Icon = Icon || AlertCircle;
      defaultTitle = t('states.error_title');
      defaultDesc = t('states.error_desc');
      break;
    case 'success':
      Icon = Icon || CheckCircle;
      break;
    case 'warning':
      Icon = Icon || AlertTriangle;
      break;
    case 'empty':
    default:
      Icon = Icon || SearchX;
      defaultTitle = t('states.empty_title');
      defaultDesc = t('states.empty_desc');
      break;
  }

  const finalTitle = title || defaultTitle;
  const finalDesc = description || defaultDesc;

  return (
    <div className={clsx('state-view-container', `state-${status}`)}>
      <div className="state-icon-wrapper">
        <Icon size={32} className={status === 'loading' && !CustomIcon ? 'spinner' : ''} />
      </div>
      {finalTitle && <h3 className="state-view-title">{finalTitle}</h3>}
      {finalDesc && <p className="state-view-desc">{finalDesc}</p>}
      {action && <div style={{ marginTop: 'var(--space-4)' }}>{action}</div>}
    </div>
  );
};
