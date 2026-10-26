/**
 * SYSTEM DJ — Session capture feedback
 * Punto de entrada de la consola y del atajo de grabación: alterna la captura existente y
 * confirma el resultado con un aviso. «Sesión guardada» solo aparece cuando el grabador devolvió
 * una sesión finalizada válida, que queda disponible en Sesiones para exportarla.
 */

import i18n from '../../i18n/config';
import { toastStore } from '../notifications/toastService';
import { sessionCaptureControl, type SessionCaptureResult } from './sessionCaptureControl';

export function toggleSessionCaptureWithFeedback(): SessionCaptureResult {
  const result = sessionCaptureControl.toggle();
  switch (result.status) {
    case 'saved':
      toastStore.show('success', i18n.t('mixer.rec_saved'));
      break;
    case 'empty':
      toastStore.show('warning', i18n.t('mixer.rec_empty'));
      break;
    case 'blocked':
      if (result.reason !== 'already-active') toastStore.show('warning', i18n.t(`mixer.rec_blocked_${result.reason.replace('-', '_')}`));
      break;
    case 'error':
      console.warn('[Recording] Session capture could not change state:', result.error);
      toastStore.show('error', i18n.t('mixer.rec_error'));
      break;
  }
  return result;
}
