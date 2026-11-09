/**
 * SYSTEM DJ — View transitions
 * Cambios que alteran toda la página a la vez (tema, idioma) se aplican dentro de una
 * View Transition: el navegador funde la captura anterior con la nueva. `data-view-transition`
 * en <html> elige la coreografía en tokens.css. Sin soporte del navegador, o con «Animaciones»
 * apagado en Ajustes, el cambio se aplica directamente.
 */

import { flushSync } from 'react-dom';
import { settingsStore } from '../store/useSettingsStore';

export type ViewTransitionKind = 'theme' | 'language';

export function withViewTransition(kind: ViewTransitionKind, update: () => void): void {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  if (!root || typeof document.startViewTransition !== 'function' || !settingsStore.getSnapshot().animations) {
    update();
    return;
  }
  root.dataset.viewTransition = kind;
  // flushSync: React debe pintar el nuevo estado antes de que se tome la captura final
  const transition = document.startViewTransition(() => flushSync(update));
  void transition.finished.finally(() => {
    delete root.dataset.viewTransition;
  });
}
