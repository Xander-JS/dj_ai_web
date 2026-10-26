/**
 * SYSTEM DJ — Modelo del mixer central (sección 4)
 *
 * Reglas puras de lo que muestra el mixer: el LED de señal de cada canal, el texto accesible del
 * FILTER, los niveles efectivos de los vúmetros, el brillo de `← A` / `B →` y los botones de
 * curva. Devuelve claves i18n con sus valores (no texto), así que se prueba en Node sin React.
 */

import type { PlaybackState } from '../../types/deck';
import type { CrossfaderCurve } from '../../types/mixer';
import { calculateCrossfaderGains } from '../../audio/djAudioMath.ts';

/** Nivel (0–100) a partir del cual se enciende el segmento rojo superior (clip) de un vúmetro. */
export const CLIP_LEVEL = 95;

/** Nivel (0–100) a partir del cual el LED de señal de un canal se enciende. */
export const SIGNAL_THRESHOLD = 2;

export type ChannelStateKey = 'empty' | 'loading' | 'playing' | 'paused';

export interface ChannelSignal {
  stateKey: ChannelStateKey;
  hasSignal: boolean;
  /** Luz del LED junto a `CH 1` / `CH 2`: verde con nivel real; a media luz en pausa o cargando. */
  led: { on: boolean; color: 'green' | 'amber' | 'tone'; dim: boolean };
  /** Tooltip y texto para lectores de pantalla: `{estado} · {con señal | sin señal}`. */
  stateMessage: { key: string };
  signalMessage: { key: string };
}

export function getChannelSignal(input: {
  hasTrack: boolean;
  playbackState: PlaybackState;
  isPlaying: boolean;
  level: number;
}): ChannelSignal {
  const stateKey: ChannelStateKey = !input.hasTrack
    ? 'empty'
    : input.playbackState === 'loading'
      ? 'loading'
      : input.isPlaying
        ? 'playing'
        : 'paused';
  const hasSignal = clampLevel(input.level) >= SIGNAL_THRESHOLD;
  const led: ChannelSignal['led'] = hasSignal
    ? { on: true, color: 'green', dim: false }
    : stateKey === 'paused'
      ? { on: true, color: 'amber', dim: true }
      : stateKey === 'loading'
        ? { on: true, color: 'tone', dim: true }
        : { on: false, color: 'green', dim: false };
  return {
    stateKey,
    hasSignal,
    led,
    stateMessage: { key: `mixer.state_${stateKey}` },
    signalMessage: { key: hasSignal ? 'mixer.signal_present' : 'mixer.signal_absent' },
  };
}

/** Texto accesible del FILTER: paso bajo a la izquierda del centro, paso alto a la derecha. */
export function getFilterValueText(filter: number): { key: string; values?: { value: number } } {
  if (filter < 50) return { key: 'mixer.filter_lpf_value', values: { value: Math.round(((50 - filter) / 50) * 100) } };
  if (filter > 50) return { key: 'mixer.filter_hpf_value', values: { value: Math.round(((filter - 50) / 50) * 100) } };
  return { key: 'mixer.filter_off' };
}

export function clampLevel(level: number): number {
  return Number.isFinite(level) ? Math.max(0, Math.min(100, level)) : 0;
}

export interface StereoLevel {
  left: number;
  right: number;
}

export const SILENT_STEREO: StereoLevel = { left: 0, right: 0 };

/**
 * Nivel que pintan los vúmetros: el de canal solo se mueve mientras su deck suena; el Master cae
 * a cero con MUTE o cuando nada suena.
 */
export function getEffectiveLevels(input: {
  isPlayingA: boolean;
  isPlayingB: boolean;
  isMasterMuted: boolean;
  levelA: number;
  levelB: number;
  master: StereoLevel;
}): { a: number; b: number; master: StereoLevel } {
  const masterLive = (input.isPlayingA || input.isPlayingB) && !input.isMasterMuted;
  return {
    a: input.isPlayingA ? clampLevel(input.levelA) : 0,
    b: input.isPlayingB ? clampLevel(input.levelB) : 0,
    master: masterLive
      ? { left: clampLevel(input.master.left), right: clampLevel(input.master.right) }
      : SILENT_STEREO,
  };
}

/** Ganancia real (0–1) de cada lado con la curva activa: fija el brillo de `← A` y `B →`. */
export function getCrossfaderSideLights(position: number, curve: CrossfaderCurve): { a: number; b: number } {
  const gains = calculateCrossfaderGains(position / 100, curve);
  return { a: gains.gainA, b: gains.gainB };
}

export interface CurveButton {
  id: CrossfaderCurve;
  /** Serigrafía de la tecla. */
  labelKey: string;
  /** Tooltip y nombre accesible. */
  titleKey: string;
}

export const CURVE_BUTTONS: readonly CurveButton[] = [
  { id: 'constant-power', labelKey: 'mixer.curve_cp_short', titleKey: 'mixer.curve_constant_power' },
  { id: 'linear', labelKey: 'mixer.curve_lin_short', titleKey: 'mixer.curve_linear' },
  { id: 'cut', labelKey: 'mixer.curve_cut_short', titleKey: 'mixer.curve_cut' },
];
