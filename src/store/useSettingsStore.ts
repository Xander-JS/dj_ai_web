/**
 * SYSTEM DJ — User Preferences Store
 * Preferencias de la aplicación (apariencia, audio, reproducción, atajos, biblioteca e idioma)
 * persistidas en localStorage. Se mantiene separado de useDJStore para que cambiar una
 * preferencia no dependa del transporte ni dispare renders a ritmo de animación.
 *
 * Reglas:
 * - Todo valor leído de almacenamiento se sanea; un valor desconocido vuelve al predeterminado.
 * - Los efectos (DOM, i18n, motor de audio) se aplican en services/settings/settingsEffects.ts.
 */

import { useSyncExternalStore } from 'react';
import type { CrossfaderCurve } from '../types/mixer';
import {
  DEFAULT_SHORTCUT_BINDINGS,
  sanitizeShortcutBindings,
  type ShortcutBindings,
} from '../services/keyboard/keyboardShortcuts.ts';

export type ThemeMode = 'light' | 'dark';
export type AccentColor = 'cyan' | 'violet' | 'neon' | 'orange';
export type InterfaceDensity = 'standard' | 'compact';
export type AppLanguage = 'es' | 'en';
/** Rango del fader de pitch como fracción (0.06 = ±6 %). */
export type PitchRange = 0.06 | 0.08 | 0.16;
/** Tamaño de búfer objetivo en muestras; se traduce a `latencyHint` del AudioContext. */
export type AudioBufferSize = 256 | 512 | 1024;
export type AutoTransitionBeats = 8 | 16 | 32;
/** `cdj`: CUE en reproducción pausa y vuelve al marcador. `standard`: vuelve al marcador sin detenerse. */
export type CueMode = 'cdj' | 'standard';

export interface AppSettings {
  theme: ThemeMode;
  accentColor: AccentColor;
  density: InterfaceDensity;
  language: AppLanguage;
  crossfaderCurve: CrossfaderCurve;
  pitchRange: PitchRange;
  bufferSize: AudioBufferSize;
  autoTransitionBeats: AutoTransitionBeats;
  cueMode: CueMode;
  /** Tolerancia máxima de SYNC como fracción (0.08 = ±8 %), entre SYNC_RANGE_MIN y SYNC_RANGE_MAX. */
  syncRange: number;
  shortcutsEnabled: boolean;
  /** Teclas selectoras de GAIN / HI / MID / LOW / FILTER por deck. */
  shortcutBindings: ShortcutBindings;
  autoAnalyzeOnImport: boolean;
}

export const SETTINGS_STORAGE_KEY = 'systemdj.settings';

export const ACCENT_COLORS: readonly AccentColor[] = ['cyan', 'violet', 'neon', 'orange'];
/** Matiz HSL de cada acento; alimenta `--hue-primary` y `--color-accent`. */
export const ACCENT_HUES: Record<AccentColor, number> = {
  cyan: 190,
  violet: 260,
  neon: 130,
  orange: 28,
};
export const CROSSFADER_CURVES: readonly CrossfaderCurve[] = ['constant-power', 'linear', 'cut'];
export const PITCH_RANGES: readonly PitchRange[] = [0.06, 0.08, 0.16];
export const BUFFER_SIZES: readonly AudioBufferSize[] = [256, 512, 1024];
export const AUTO_TRANSITION_BEATS: readonly AutoTransitionBeats[] = [8, 16, 32];
export const SYNC_RANGE_MIN = 0.04;
export const SYNC_RANGE_MAX = 0.2;
export const SYNC_RANGE_STEP = 0.01;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  accentColor: 'violet',
  density: 'standard',
  language: 'es',
  crossfaderCurve: 'constant-power',
  pitchRange: 0.08,
  bufferSize: 512,
  autoTransitionBeats: 16,
  cueMode: 'cdj',
  syncRange: 0.08,
  shortcutsEnabled: true,
  shortcutBindings: DEFAULT_SHORTCUT_BINDINGS,
  autoAnalyzeOnImport: true,
};

/** Acota la tolerancia de SYNC a ±4–20 % en pasos de 1 %. */
export function sanitizeSyncRange(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SETTINGS.syncRange;
  const clamped = Math.max(SYNC_RANGE_MIN, Math.min(SYNC_RANGE_MAX, value));
  return Number((Math.round(clamped / SYNC_RANGE_STEP) * SYNC_RANGE_STEP).toFixed(2));
}

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Normaliza un objeto arbitrario (p. ej. JSON de localStorage) a preferencias válidas. */
export function sanitizeSettings(raw: unknown): AppSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AppSettings, unknown>>;
  const d = DEFAULT_SETTINGS;
  return {
    theme: pick(source.theme, ['light', 'dark'] as const, d.theme),
    accentColor: pick(source.accentColor, ACCENT_COLORS, d.accentColor),
    density: pick(source.density, ['standard', 'compact'] as const, d.density),
    language: pick(source.language, ['es', 'en'] as const, d.language),
    crossfaderCurve: pick(source.crossfaderCurve, CROSSFADER_CURVES, d.crossfaderCurve),
    pitchRange: pick(source.pitchRange, PITCH_RANGES, d.pitchRange),
    bufferSize: pick(source.bufferSize, BUFFER_SIZES, d.bufferSize),
    autoTransitionBeats: pick(source.autoTransitionBeats, AUTO_TRANSITION_BEATS, d.autoTransitionBeats),
    cueMode: pick(source.cueMode, ['cdj', 'standard'] as const, d.cueMode),
    syncRange: sanitizeSyncRange(source.syncRange),
    shortcutsEnabled: typeof source.shortcutsEnabled === 'boolean' ? source.shortcutsEnabled : d.shortcutsEnabled,
    shortcutBindings: sanitizeShortcutBindings(source.shortcutBindings),
    autoAnalyzeOnImport: typeof source.autoAnalyzeOnImport === 'boolean' ? source.autoAnalyzeOnImport : d.autoAnalyzeOnImport,
  };
}

/** Las asignaciones de atajos son objetos planos: se comparan por contenido. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
}

/** Almacenamiento mínimo compatible con localStorage (inyectable en pruebas). */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): SettingsStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

type SettingsListener = (next: AppSettings, previous: AppSettings) => void;

export class SettingsStore {
  private settings: AppSettings;
  private listeners: Set<SettingsListener> = new Set();
  private storage: SettingsStorage | null;

  public constructor(storage: SettingsStorage | null = getDefaultStorage()) {
    this.storage = storage;
    this.settings = this.load();
  }

  public getSnapshot = (): AppSettings => this.settings;

  public subscribe = (listener: SettingsListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public update(patch: Partial<AppSettings>): void {
    const next = sanitizeSettings({ ...this.settings, ...patch });
    const changed = (Object.keys(next) as (keyof AppSettings)[]).some((key) => !sameValue(next[key], this.settings[key]));
    if (!changed) return;
    const previous = this.settings;
    this.settings = next;
    this.persist();
    for (const listener of this.listeners) listener(next, previous);
  }

  public reset(): void {
    this.update(DEFAULT_SETTINGS);
  }

  private load(): AppSettings {
    try {
      const raw = this.storage?.getItem(SETTINGS_STORAGE_KEY);
      return sanitizeSettings(raw ? JSON.parse(raw) : null);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Cuota llena o almacenamiento bloqueado: la preferencia sigue vigente en memoria
    }
  }
}

export const settingsStore = new SettingsStore();

/**
 * Hook reactivo para consumir y modificar las preferencias.
 */
export function useSettingsStore(): {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;
} {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  return {
    settings,
    updateSettings: settingsStore.update.bind(settingsStore),
    resetSettings: settingsStore.reset.bind(settingsStore),
  };
}
