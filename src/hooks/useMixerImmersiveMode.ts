import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV_SECTION_PATHS } from '../services/keyboard/keyboardShortcuts';
import {
  IMMERSIVE_ROOT_CLASS,
  PHONE_QUERY,
  PORTRAIT_QUERY,
  getImmersiveOverlay,
  type ImmersiveOverlay,
} from '../services/console/immersiveMode';

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
}

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
};

const orientation = (): LockableOrientation | undefined =>
  typeof screen !== 'undefined' ? (screen.orientation as LockableOrientation | undefined) : undefined;

export interface MixerImmersiveMode {
  isPhone: boolean;
  overlay: ImmersiveOverlay;
  /** Gesto de «toca para empezar»: pantalla completa y, si se puede, horizontal bloqueado. */
  start: () => void;
}

/**
 * Modo móvil del Mixer: en un teléfono retira el resto de la aplicación, pide pantalla completa
 * en horizontal y hace que el gesto o botón Atrás vuelva siempre a Inicio. Al salir de la
 * sección se deshace todo.
 */
export function useMixerImmersiveMode(): MixerImmersiveMode {
  const navigate = useNavigate();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const isPortrait = useMediaQuery(PORTRAIT_QUERY);
  const [isFullscreen, setIsFullscreen] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenElement));
  const [fullscreenDeclined, setFullscreenDeclined] = useState(false);
  const fullscreenSupported =
    typeof document !== 'undefined' &&
    document.fullscreenEnabled !== false &&
    typeof document.documentElement.requestFullscreen === 'function';

  const goHomeRef = useRef(() => navigate(NAV_SECTION_PATHS.home, { replace: true }));
  useEffect(() => {
    goHomeRef.current = () => navigate(NAV_SECTION_PATHS.home, { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!isPhone) return;
    const root = document.documentElement;
    root.classList.add(IMMERSIVE_ROOT_CLASS);

    // Atrás: el historial ya apunta a la entrada anterior; se sustituye por Inicio
    const onPopState = () => goHomeRef.current();
    // En Android, Atrás con pantalla completa solo sale de ella: también lleva a Inicio
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active) goHomeRef.current();
    };
    window.addEventListener('popstate', onPopState);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    return () => {
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      root.classList.remove(IMMERSIVE_ROOT_CLASS);
      orientation()?.unlock?.();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [isPhone]);

  const start = useCallback(() => {
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => orientation()?.lock?.('landscape'))
      // Sin bloqueo de orientación (iOS, algunos navegadores) queda la capa «gira el dispositivo»
      .catch(() => {
        if (!document.fullscreenElement) setFullscreenDeclined(true);
      });
  }, []);

  const overlay = getImmersiveOverlay({ isPhone, fullscreenSupported, isFullscreen, fullscreenDeclined, isPortrait });
  return { isPhone, overlay, start };
}
