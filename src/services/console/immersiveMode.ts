/**
 * SYSTEM DJ — Modo móvil del Mixer (REFACTOR_PROMPT §7)
 *
 * En un teléfono, la sección Mixer pasa a pantalla completa en horizontal y solo deja la
 * consola. La API de pantalla completa exige un gesto del usuario, y el bloqueo de orientación
 * no existe en todos los navegadores (iOS Safari), así que hay dos capas de respaldo:
 * «toca para empezar» y «gira el dispositivo».
 */

/** Teléfono: pantalla táctil cuyo lado corto mide como mucho 540 px (en cualquier orientación). */
export const PHONE_QUERY = '(pointer: coarse) and (max-width: 540px), (pointer: coarse) and (max-height: 540px)';
export const PORTRAIT_QUERY = '(orientation: portrait)';

/** Clase en `<html>` que retira el resto de la aplicación (cabecera, barra lateral, reproductor). */
export const IMMERSIVE_ROOT_CLASS = 'mixer-immersive';

export type ImmersiveOverlay = 'tap' | 'rotate' | null;

export interface ImmersiveState {
  isPhone: boolean;
  /** El navegador permite poner un elemento en pantalla completa. */
  fullscreenSupported: boolean;
  isFullscreen: boolean;
  /** El navegador rechazó la petición de pantalla completa: se sigue sin ella. */
  fullscreenDeclined: boolean;
  isPortrait: boolean;
}

/**
 * Capa que se muestra sobre la consola: primero «toca para empezar» (la pantalla completa
 * necesita un gesto); después, si el dispositivo sigue en vertical porque no se pudo bloquear la
 * orientación, «gira el dispositivo».
 */
export function getImmersiveOverlay(state: ImmersiveState): ImmersiveOverlay {
  if (!state.isPhone) return null;
  if (state.fullscreenSupported && !state.isFullscreen && !state.fullscreenDeclined) return 'tap';
  if (state.isPortrait) return 'rotate';
  return null;
}
