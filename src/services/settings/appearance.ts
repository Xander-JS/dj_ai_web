/**
 * SYSTEM DJ — Appearance Settings
 * Traduce las preferencias de apariencia a atributos y Design Tokens del elemento raíz.
 */

import { ACCENT_HUES, type AppSettings } from '../../store/useSettingsStore.ts';

/** Escribe tema, densidad y acento en el elemento raíz (`<html>`). */
export function applyAppearanceToRoot(
  settings: Pick<AppSettings, 'theme' | 'density' | 'accentColor'>,
  root: Pick<HTMLElement, 'setAttribute' | 'style'>,
): void {
  root.setAttribute('data-theme', settings.theme);
  root.setAttribute('data-density', settings.density);
  const hue = ACCENT_HUES[settings.accentColor];
  // --hue-primary recalcula toda la escala --color-primary-* de los Design Tokens
  root.style.setProperty('--hue-primary', String(hue));
  root.style.setProperty('--color-accent', `hsl(${hue}, 70%, 55%)`);
}
