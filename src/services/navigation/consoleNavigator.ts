/**
 * SYSTEM DJ — Console navigator bridge
 * Los atajos de teclado se instalan fuera del árbol de React (settingsEffects), pero navegar
 * exige el router. El shell de la consola registra aquí su `navigate` mientras está montado;
 * fuera de la consola (Home pública, Login) no hay navegador y los atajos de sección no actúan.
 */

import { NAV_SECTION_PATHS, type NavSection } from '../keyboard/keyboardShortcuts.ts';

type Navigate = (path: string) => void;

let current: Navigate | null = null;

/** Registra el navegador del shell; devuelve la función que lo retira. */
export function registerConsoleNavigator(navigate: Navigate): () => void {
  current = navigate;
  return () => {
    if (current === navigate) current = null;
  };
}

/** Abre la sección indicada si el shell está montado. Devuelve si se pudo navegar. */
export function navigateToSection(section: NavSection): boolean {
  if (!current) return false;
  current(NAV_SECTION_PATHS[section]);
  return true;
}
