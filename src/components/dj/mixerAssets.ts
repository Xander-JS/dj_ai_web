/**
 * SYSTEM DJ — Mixer graphic assets
 * Rutas y geometría medida de las imágenes de public/assets/mixer. La geometría (centro y
 * diámetro en píxeles de la imagen original) permite recortar, centrar y girar cada pieza
 * sin deformarla: los componentes escalan con porcentajes derivados de estos valores.
 */

import type { JogDisc } from '../../store/useSettingsStore';

const BASE = '/assets/mixer';

export const MIXER_ASSETS = {
  knobMain: `${BASE}/knobs/knob-main.png`,
  faderCap: `${BASE}/faders/fader-cap.png`,
  buttonOff: `${BASE}/buttons/button-off.png`,
  buttonOn: `${BASE}/buttons/button-on.png`,
  brushedMetal: `${BASE}/textures/brushed-metal.jpg`,
} as const;

/**
 * knob-main.png (1855×1623): escala de 270° fija alrededor de un pomo cepillado.
 * El pomo se recorta en un círculo y gira sobre su centro; la escala queda quieta.
 */
export const KNOB_MAIN_GEOMETRY = {
  width: 1855,
  height: 1623,
  centerX: 928.5,
  centerY: 929,
  /** Radio del pomo cepillado, incluida su ranura oscura. */
  capRadius: 576,
  /** Radio medio de la corona de marcas, donde se dibuja el arco de valor. */
  scaleRadius: 862,
  /** Ángulo (grados, 0 = arriba, horario) al que apunta la línea indicadora dibujada en la imagen. */
  indicatorAngle: -19,
} as const;

/** fader-cap.png (800×800): el cuerpo opaco del pomo ocupa este rectángulo. */
export const FADER_CAP_GEOMETRY = {
  size: 800,
  left: 287,
  top: 161,
  width: 279,
  height: 470,
} as const;

export interface DiscAsset {
  id: JogDisc;
  src: string;
  /** Dimensiones de la imagen y centro/diámetro del disco medidos sobre su canal alfa. */
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  diameter: number;
}

export const DISC_ASSETS: Record<JogDisc, DiscAsset> = {
  a: { id: 'a', src: `${BASE}/disk/rotating-disc-a.png`, width: 1458, height: 1470, centerX: 728.5, centerY: 734.5, diameter: 1456 },
  b: { id: 'b', src: `${BASE}/disk/rotating-disc-b.png`, width: 1024, height: 1024, centerX: 511.5, centerY: 518, diameter: 980 },
  c: { id: 'c', src: `${BASE}/disk/rotating-disc-c.png`, width: 800, height: 800, centerX: 401.5, centerY: 394.5, diameter: 758 },
};

/**
 * Posición de la imagen de un disco dentro de un contenedor cuadrado: el disco lo llena
 * exactamente y gira sobre su propio centro (no sobre el de la imagen).
 */
export function discImageStyle(disc: DiscAsset): {
  width: string;
  left: string;
  top: string;
  transformOrigin: string;
} {
  return {
    width: `${(disc.width / disc.diameter) * 100}%`,
    left: `${50 - (disc.centerX / disc.diameter) * 100}%`,
    top: `${50 - (disc.centerY / disc.diameter) * 100}%`,
    transformOrigin: `${(disc.centerX / disc.width) * 100}% ${(disc.centerY / disc.height) * 100}%`,
  };
}
