/**
 * Imágenes 3D de la Home. El PNG original es la ruta de referencia y el respaldo;
 * el WebP es una copia redimensionada para la carga inicial.
 * Nota: los nombres de archivo no describen el contenido (knob-3d es un vinilo,
 * soundwave-3d un altavoz, mixer-console-3d una controladora).
 */

export interface LandingImage {
  src: string;
  webp: string;
  width: number;
  height: number;
}

export const HERO_IMAGE: LandingImage = {
  src: '/assets/images/hero-dj-alt-3d.png',
  webp: '/assets/images/hero-dj-alt-3d.webp',
  width: 1280,
  height: 1280,
};

export const CLOSING_IMAGE: LandingImage = {
  src: '/assets/images/hero-dj-salt-3d.png',
  webp: '/assets/images/hero-dj-salt-3d.webp',
  width: 800,
  height: 1000,
};

export const VINYL_IMAGE: LandingImage = {
  src: '/assets/images/knob-3d.png',
  webp: '/assets/images/knob-3d.webp',
  width: 640,
  height: 640,
};

export const SPEAKER_IMAGE: LandingImage = {
  src: '/assets/images/soundwave-3d.png',
  webp: '/assets/images/soundwave-3d.webp',
  width: 640,
  height: 640,
};

export const CONTROLLER_IMAGE: LandingImage = {
  src: '/assets/images/mixer-console-3d.png',
  webp: '/assets/images/mixer-console-3d.webp',
  width: 960,
  height: 540,
};
