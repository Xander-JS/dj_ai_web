/**
 * SYSTEM DJ — Appearance Settings
 * Traduce las preferencias de apariencia a atributos y Design Tokens del elemento raíz.
 */

import { ACCENT_HUES, type AppSettings } from '../../store/useSettingsStore.ts';

/** Escribe tema, densidad, acento, movimiento e interfaz en el elemento raíz (`<html>`). */
export function applyAppearanceToRoot(
  settings: Pick<AppSettings, 'theme' | 'density' | 'accentColor' | 'consoleDesign'> & Partial<Pick<AppSettings, 'animations' | 'experimentalInterface'>>,
  root: Pick<HTMLElement, 'setAttribute' | 'style'>,
): void {
  root.setAttribute('data-theme', settings.theme);
  root.setAttribute('data-density', settings.density);
  // data-accent selecciona los valores --sd-accent* de tokens.css (identidad v2)
  root.setAttribute('data-accent', settings.accentColor);
  // data-console-design elige el reskin plano de la consola (consoleDesignSystem.css).
  // La consola Classic solo aplica en modo oscuro; en modo claro se usa siempre system.
  const effectiveConsoleDesign = settings.theme === 'light' && settings.consoleDesign === 'classic' ? 'system' : settings.consoleDesign;
  root.setAttribute('data-console-design', effectiveConsoleDesign);
  // Las animaciones opcionales se apagan desde CSS con :root[data-animations='off']
  root.setAttribute('data-animations', settings.animations === false ? 'off' : 'on');
  // Solo marca la preferencia; la disposición alternativa todavía no existe
  root.setAttribute('data-interface', settings.experimentalInterface ? 'experimental' : 'standard');
  const hue = ACCENT_HUES[settings.accentColor];
  // --hue-primary recalcula la escala heredada --color-primary-* (Mixer, decks, barra de reproducción)
  root.style.setProperty('--hue-primary', String(hue));
  root.style.setProperty('--color-accent', 'var(--sd-accent)');
}
