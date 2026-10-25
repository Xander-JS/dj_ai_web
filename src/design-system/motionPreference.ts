/**
 * SYSTEM DJ — Motion preference
 * Punto único para saber si una animación opcional puede ejecutarse: la preferencia
 * «Animaciones» de Ajustes y `prefers-reduced-motion` del sistema. Las reglas CSS usan el
 * mismo criterio con `:root[data-animations='off']` y la media query.
 */

import { useSyncExternalStore } from 'react';
import { settingsStore } from '../store/useSettingsStore';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null;
}

function subscribeReducedMotion(listener: () => void): () => void {
  const query = reducedMotionQuery();
  query?.addEventListener('change', listener);
  return () => query?.removeEventListener('change', listener);
}

const getReducedMotion = (): boolean => reducedMotionQuery()?.matches ?? false;

/** El sistema pide reducir el movimiento. */
export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => false);
}

const getAnimationsSetting = (): boolean => settingsStore.getSnapshot().animations;

/** true solo si el usuario no apagó las animaciones y el sistema no pide reducir movimiento. */
export function useAnimationsEnabled(): boolean {
  const setting = useSyncExternalStore(settingsStore.subscribe, getAnimationsSetting, getAnimationsSetting);
  const reduced = useSystemReducedMotion();
  return setting && !reduced;
}
