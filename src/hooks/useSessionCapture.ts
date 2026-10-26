import { useEffect, useState, useSyncExternalStore } from 'react';
import { sessionCaptureControl } from '../services/session/sessionCaptureControl';

/** Refresco del contador; solo afecta a la interfaz, nunca al grabador ni al motor de audio. */
const CLOCK_TICK_MS = 500;

/**
 * Estado real de la grabación de sesión (también cuando se inicia con su atajo) y el tiempo
 * transcurrido de la captura en curso, refrescado cada 500 ms mientras graba.
 */
export function useSessionCapture(): { active: boolean; elapsedMs: number } {
  const capture = useSyncExternalStore(sessionCaptureControl.subscribe, sessionCaptureControl.getSnapshot);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!capture.active) return;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [capture.active]);

  const elapsedMs = capture.active ? Math.max(0, now - (capture.startedAtEpochMs ?? now)) : 0;
  return { active: capture.active, elapsedMs };
}
