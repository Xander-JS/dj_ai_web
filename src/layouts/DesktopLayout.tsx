import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import './DesktopLayout.css';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { PlayerBar } from './PlayerBar';
import { ToastViewport } from '../components/molecules/ToastViewport';
import { registerConsoleNavigator } from '../services/navigation/consoleNavigator';
import { NAV_SECTION_PATHS } from '../services/keyboard/keyboardShortcuts';
import { DURATION, EASE_OUT } from '../design-system/motion';
import { useAnimationsEnabled } from '../design-system/motionPreference';

export interface DesktopLayoutProps {
  children: React.ReactNode;
}

/**
 * Atajos de sección (Shift + 1–5): el shell persiste entre rutas, así que navegar no
 * desmonta la barra de reproducción ni toca el audio, que vive en djStore/playerQueue.
 */
function useConsoleNavigator(): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => registerConsoleNavigator((path) => {
    // Repetir la sección actual no añade entradas al historial
    if (pathnameRef.current !== path) navigate(path);
  }), [navigate]);
}

export const DesktopLayout: React.FC<DesktopLayoutProps> = ({ children }) => {
  useConsoleNavigator();
  // Mixer ya tiene su propio transporte por deck: la barra se retira (sin desmontarse, para no
  // perder su estado) y su fila del shell se pliega. La ruta es la sección activa del router.
  const { pathname } = useLocation();
  const isPlayerHidden = pathname === NAV_SECTION_PATHS.mixer;
  // Cambio de módulo: la vista saliente se funde y, al terminar, entra la nueva subiendo
  // levemente. Solo se anima el contenido de <main>; cabecera, barra lateral y reproductor
  // no se mueven. Sin animaciones (Ajustes o movimiento reducido) el cambio es inmediato.
  const animationsEnabled = useAnimationsEnabled();
  return (
    <div className={clsx('desktop-layout', isPlayerHidden && 'desktop-layout--player-hidden')}>
      <Header />
      <Sidebar />
      <main className="layout-main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname}
            className="layout-view"
            initial={animationsEnabled ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0, transition: { duration: animationsEnabled ? DURATION.base : 0, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: animationsEnabled ? DURATION.fast : 0, ease: 'easeIn' } }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      <PlayerBar hidden={isPlayerHidden} />
      <ToastViewport />
    </div>
  );
};
