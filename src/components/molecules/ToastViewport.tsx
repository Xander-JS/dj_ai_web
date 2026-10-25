import { AnimatePresence, motion } from 'framer-motion';
import { Notice } from './Notice';
import { useToasts } from '../../services/notifications/toastService';
import { DURATION, EASE_OUT } from '../../design-system/motion';
import { useAnimationsEnabled } from '../../design-system/motionPreference';
import './ToastViewport.css';

// Pila fija en la esquina superior derecha del área visible; no participa en el flujo.
// La lista permanece montada para que el aviso que expira o se descarta pueda animar su salida.
export const ToastViewport: React.FC = () => {
  const toasts = useToasts();
  const animationsEnabled = useAnimationsEnabled();
  const transition = { duration: animationsEnabled ? DURATION.base : 0, ease: EASE_OUT };
  return (
    <ol className="sd-toasts">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.li
            key={toast.id}
            className="sd-toasts__item"
            initial={{ opacity: 0, y: '-0.5rem' }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            // Sale hacia el borde derecho sin capturar el puntero mientras se desvanece
            exit={{ opacity: 0, x: '1rem', pointerEvents: 'none' }}
            transition={transition}
          >
            <Notice tone={toast.tone} className="sd-toasts__notice">{toast.text}</Notice>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
};
