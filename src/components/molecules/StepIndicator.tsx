import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Check } from 'lucide-react';
import { Icon } from '../atoms/Icon';
import './StepIndicator.css';

export type StepState = 'done' | 'current' | 'upcoming' | 'attention';

export interface StepItem {
  id: string;
  label: ReactNode;
  /** Estado o siguiente paso en una línea */
  hint?: ReactNode;
  state: StepState;
}

export interface StepIndicatorProps {
  steps: StepItem[];
  /** Nombre accesible de la secuencia */
  label: string;
  className?: string;
}

// Secuencia de pasos de un flujo: hecho (salvia + check), en curso (aro de tinta), pendiente o con aviso (ácido)
export const StepIndicator: React.FC<StepIndicatorProps> = ({ steps, label, className }) => (
  <ol className={clsx('sd-steps', className)} aria-label={label}>
    {steps.map((step, index) => (
      <li
        key={step.id}
        className={clsx('sd-step', `sd-step--${step.state}`)}
        aria-current={step.state === 'current' || step.state === 'attention' ? 'step' : undefined}
      >
        <span
          className={clsx(
            'sd-step__marker sd-num',
            step.state === 'done' && 'sd-field-sage',
            step.state === 'attention' && 'sd-field-acid',
          )}
          aria-hidden="true"
        >
          {step.state === 'done' ? (
            <Icon icon={Check} size="sm" />
          ) : step.state === 'attention' ? (
            <Icon icon={AlertTriangle} size="sm" />
          ) : (
            index + 1
          )}
        </span>
        <span className="sd-step__copy">
          <span className="sd-step__label">{step.label}</span>
          {step.hint && <span className="sd-step__hint">{step.hint}</span>}
        </span>
      </li>
    ))}
  </ol>
);
