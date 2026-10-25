import { Notice } from './Notice';
import { useToasts } from '../../services/notifications/toastService';
import './ToastViewport.css';

// Pila fija en la esquina superior derecha del área visible; no participa en el flujo
export const ToastViewport: React.FC = () => {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <ol className="sd-toasts">
      {toasts.map((toast) => (
        <li key={toast.id} className="sd-toasts__item">
          <Notice tone={toast.tone} className="sd-toasts__notice">{toast.text}</Notice>
        </li>
      ))}
    </ol>
  );
};
