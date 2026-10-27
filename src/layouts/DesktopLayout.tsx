import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import './DesktopLayout.css';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { PlayerBar } from './PlayerBar';
import { ToastViewport } from '../components/molecules/ToastViewport';
import { IconButton } from '../components/atoms/IconButton';
import { Icon } from '../components/atoms/Icon';
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

/**
 * Barra lateral en Mixer: se retira y la consola ocupa todo el ancho; una pestaña en el borde
 * izquierdo la muestra encima de la consola, sin moverla. Cambiar de sección o Esc la cierra.
 */
function useSidebarPeek(isMixer: boolean, pathname: string) {
  // Abierta solo en la ruta donde se abrió: al navegar se cierra sola. `open: false` marca que la
  // cerró el usuario, para que se retire rápido y no con los tiempos de la entrada del Mixer
  const [peek, setPeek] = useState<{ path: string; open: boolean } | null>(null);
  if (peek && peek.path !== pathname) setPeek(null);
  const isOpen = isMixer && peek?.open === true;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPeek({ path: pathname, open: false });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, pathname]);

  return {
    isOpen,
    wasClosed: isMixer && peek?.open === false,
    toggle: () => setPeek({ path: pathname, open: !isOpen }),
  };
}

export const DesktopLayout: React.FC<DesktopLayoutProps> = ({ children }) => {
  useConsoleNavigator();
  const { t } = useTranslation();
  // Mixer ya tiene su propio transporte por deck: la barra se retira (sin desmontarse, para no
  // perder su estado) y su fila del shell se pliega. La barra lateral también se retira. La
  // ruta es la sección activa del router.
  const { pathname } = useLocation();
  const isMixer = pathname === NAV_SECTION_PATHS.mixer;
  const isPlayerHidden = isMixer;
  const sidebarPeek = useSidebarPeek(isMixer, pathname);
  // Cambio de módulo: la vista saliente se funde y, al terminar, entra la nueva subiendo
  // levemente. Solo se anima el contenido de <main>; cabecera, barra lateral y reproductor
  // no se mueven. Sin animaciones (Ajustes o movimiento reducido) el cambio es inmediato.
  const animationsEnabled = useAnimationsEnabled();
  return (
    <div
      className={clsx(
        'desktop-layout',
        isPlayerHidden && 'desktop-layout--player-hidden',
        isMixer && 'desktop-layout--mixer',
        sidebarPeek.isOpen && 'desktop-layout--sidebar-open',
        sidebarPeek.wasClosed && 'desktop-layout--sidebar-closed',
      )}
    >
      <Header />
      <Sidebar inert={isMixer && !sidebarPeek.isOpen} />
      {isMixer && (
        <IconButton
          className="layout-sidebar-tab"
          variant="surface"
          size="sm"
          icon={<Icon icon={sidebarPeek.isOpen ? PanelLeftClose : PanelLeftOpen} size="sm" />}
          label={t(sidebarPeek.isOpen ? 'navigation.sidebar_hide' : 'navigation.sidebar_show')}
          aria-expanded={sidebarPeek.isOpen}
          aria-controls="app-sidebar"
          onClick={sidebarPeek.toggle}
          data-testid="sidebar-tab"
        />
      )}
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
