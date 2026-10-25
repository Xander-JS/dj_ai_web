import { useId, type ReactNode } from 'react';
import { clsx } from 'clsx';
import './SettingRow.css';

export interface SettingRowProps {
  title: string;
  description?: ReactNode;
  /** Control de la preferencia; recibe el id del título para aria-labelledby */
  control: ReactNode | ((ids: { titleId: string; descriptionId?: string }) => ReactNode);
  /** Vista previa o lectura de lo que produce el valor actual, bajo la descripción */
  preview?: ReactNode;
  /** stacked: el control ocupa todo el ancho bajo el texto (tablas, faders, mosaicos) */
  layout?: 'inline' | 'stacked';
  className?: string;
}

// Fila de ajuste: qué es y qué efecto tiene a la izquierda; el control a la derecha o debajo
export const SettingRow: React.FC<SettingRowProps> = ({ title, description, control, preview, layout = 'inline', className }) => {
  const titleId = useId();
  const descriptionId = useId();
  const ids = { titleId, descriptionId: description ? descriptionId : undefined };

  return (
    <div className={clsx('sd-setting-row', `sd-setting-row--${layout}`, className)}>
      <div className="sd-setting-row__copy">
        <p id={titleId} className="sd-setting-row__title">{title}</p>
        {description && <p id={descriptionId} className="sd-setting-row__description">{description}</p>}
      </div>
      <div className="sd-setting-row__control">
        {typeof control === 'function' ? control(ids) : control}
      </div>
      {preview && <div className="sd-setting-row__preview">{preview}</div>}
    </div>
  );
};
