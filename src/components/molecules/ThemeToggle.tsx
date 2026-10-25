import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { IconButton } from '../atoms/IconButton';
import { DURATION, EASE_OUT } from '../../design-system/motion';

export interface ThemeToggleProps {
  theme: 'light' | 'dark';
  onToggle: () => void;
  /** Nombres accesibles que describen la acción: cambiar a oscuro / cambiar a claro */
  labelToDark: string;
  labelToLight: string;
}

// Conmutador claro/oscuro: el icono muestra el tema al que se cambiará
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, onToggle, labelToDark, labelToLight }) => {
  const reduceMotion = useReducedMotion();
  const isLight = theme === 'light';

  return (
    <IconButton
      label={isLight ? labelToDark : labelToLight}
      onClick={onToggle}
      icon={(
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={theme}
            style={{ display: 'grid' }}
            initial={{ opacity: 0, rotate: reduceMotion ? 0 : -60 }}
            animate={{ opacity: 1, rotate: 0 }}
            exit={{ opacity: 0, rotate: reduceMotion ? 0 : 60 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
          >
            {isLight ? <Moon size={20} aria-hidden="true" /> : <Sun size={20} aria-hidden="true" />}
          </motion.span>
        </AnimatePresence>
      )}
    />
  );
};
