import { useEffect, useLayoutEffect, useState } from 'react';
import { useAnimationsEnabled } from '../design-system/motionPreference';

/** full: encendido completo (primera entrada de la sesión) · short: versión breve (las siguientes). */
export type MixerEntranceMode = 'full' | 'short';

/** Duración total de la entrada en curso, definida en MixerEntrance.css. */
const TOTAL_VAR = '--mixer-entrance-total';

// Una sola vez por sesión de la aplicación (se reinicia al recargar)
let fullEntrancePlayed = false;

/**
 * Coordina la entrada animada del Mixer: elige la versión (completa o breve), la mantiene el
 * tiempo que marca el CSS y la termina antes ante cualquier clic o tecla. Solo es visual: la
 * clase que devuelve no bloquea ni retrasa nada, y sin animaciones (Ajustes o movimiento
 * reducido) la consola aparece directamente en su estado final.
 */
export function useMixerEntrance(rootRef: React.RefObject<HTMLElement | null>): MixerEntranceMode | null {
  const animationsEnabled = useAnimationsEnabled();
  const [mode, setMode] = useState<MixerEntranceMode | null>(() => (fullEntrancePlayed ? 'short' : 'full'));
  const active = animationsEnabled ? mode : null;

  useEffect(() => {
    if (active === 'full') fullEntrancePlayed = true;
  }, [active]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!active || !root) return;
    const finish = () => setMode(null);
    const totalMs = parseFloat(getComputedStyle(root).getPropertyValue(TOTAL_VAR)) || 0;
    const timer = setTimeout(finish, totalMs);
    // Saltar: el evento sigue su curso (atajos, clics), solo se adelanta el estado final
    window.addEventListener('pointerdown', finish, { capture: true, passive: true });
    window.addEventListener('keydown', finish, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', finish, { capture: true });
      window.removeEventListener('keydown', finish, { capture: true });
    };
  }, [active, rootRef]);

  return active;
}
