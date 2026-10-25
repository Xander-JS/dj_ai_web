/**
 * SYSTEM DJ — Player visualizer model
 * Cálculos puros del visualizador de la barra: agrupa el espectro real del Master en bandas
 * logarítmicas, las suaviza (ataque rápido, caída lenta) y decide si el bucle debe seguir.
 * Sin DOM ni Web Audio, para poder probarlo con datos sintéticos.
 */

import type { VisualizerIntensity } from '../../store/useSettingsStore';

export const VISUALIZER_BANDS = 28;
/** Primera banda útil del analizador (la 0 es casi continua). */
const FIRST_BIN = 1;
/** Fracción del espectro representada: por encima de ~16 kHz apenas hay energía musical. */
const SPECTRUM_COVERAGE = 0.75;
const ATTACK = 0.55;
const RELEASE = 0.12;
/** Por debajo de este nivel una banda se considera en reposo. */
export const REST_LEVEL = 0.004;

export interface VisualizerStyle {
  /** Opacidad del relleno de la onda. */
  fillAlpha: number;
  /** Opacidad del trazo superior. */
  lineAlpha: number;
  /** Altura máxima de la onda como fracción del alto de la barra. */
  gain: number;
}

export const VISUALIZER_STYLES: Record<VisualizerIntensity, VisualizerStyle> = {
  subtle: { fillAlpha: 0.1, lineAlpha: 0.32, gain: 0.55 },
  balanced: { fillAlpha: 0.17, lineAlpha: 0.5, gain: 0.78 },
  vivid: { fillAlpha: 0.26, lineAlpha: 0.7, gain: 0.95 },
};

/** Límites [inicio, fin) de cada banda sobre `binCount` bandas del analizador, en escala logarítmica. */
export function bandRanges(binCount: number, bands: number = VISUALIZER_BANDS): [number, number][] {
  const last = Math.max(FIRST_BIN + 1, Math.floor(binCount * SPECTRUM_COVERAGE));
  const ranges: [number, number][] = [];
  let start = FIRST_BIN;
  for (let i = 0; i < bands; i++) {
    const end = Math.max(start + 1, Math.round(FIRST_BIN * (last / FIRST_BIN) ** ((i + 1) / bands)));
    ranges.push([Math.min(start, binCount - 1), Math.min(end, binCount)]);
    start = end;
  }
  return ranges;
}

/**
 * Actualiza `levels` (0–1) en el sitio a partir del espectro (0–255) o, sin señal (`null`),
 * los deja caer hacia cero. Devuelve el nivel máximo resultante.
 */
export function updateLevels(
  levels: Float32Array,
  spectrum: ArrayLike<number> | null,
  ranges: readonly [number, number][],
): number {
  let max = 0;
  for (let i = 0; i < levels.length; i++) {
    let target = 0;
    if (spectrum && ranges[i]) {
      const [start, end] = ranges[i];
      let sum = 0;
      for (let bin = start; bin < end; bin++) sum += spectrum[bin] ?? 0;
      const mean = end > start ? sum / (end - start) / 255 : 0;
      // Curva > 1: la música suave queda baja y los pasajes intensos se despegan
      target = mean ** 1.6;
    }
    const current = levels[i];
    const next = current + (target - current) * (target > current ? ATTACK : RELEASE);
    levels[i] = next < REST_LEVEL && target === 0 ? 0 : next;
    if (levels[i] > max) max = levels[i];
  }
  return max;
}

/**
 * Nivel en la posición horizontal `x` (0–1) de la barra: graves en el centro y agudos hacia
 * los bordes, en espejo, para que la energía se reparta por todo el ancho.
 */
export function levelAt(levels: ArrayLike<number>, x: number): number {
  const distance = Math.min(1, Math.abs(x - 0.5) * 2);
  const position = distance * (levels.length - 1);
  const index = Math.floor(position);
  const fraction = position - index;
  const a = levels[index] ?? 0;
  const b = levels[Math.min(levels.length - 1, index + 1)] ?? 0;
  return a + (b - a) * fraction;
}

/** El bucle de dibujo solo corre con animaciones permitidas y mientras haya audio o una caída en curso. */
export function shouldKeepAnimating(options: { enabled: boolean; playing: boolean; peak: number }): boolean {
  return options.enabled && (options.playing || options.peak > 0);
}
