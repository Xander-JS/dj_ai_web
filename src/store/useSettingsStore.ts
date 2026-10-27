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
  DEFAULT_NAVIGATION_BINDINGS,
  DEFAULT_SHORTCUT_BINDINGS,
  migrateLegacyConsoleBindings,
  migrateLegacyShortcutBindings,
  sanitizeNavigationBindings,
  sanitizeShortcutBindings,
  type NavigationBindings,
  type ShortcutBindings,
} from '../services/keyboard/keyboardShortcuts.ts';

export type ThemeMode = 'light' | 'dark';
/** `neon` es el verde; conserva su clave para no invalidar preferencias ya guardadas. */
export type AccentColor = 'orange' | 'blue' | 'cyan' | 'violet' | 'magenta' | 'neon' | 'amber';
export type InterfaceDensity = 'standard' | 'compact';
export type AppLanguage = 'es' | 'en';
/** Rango del fader de pitch como fracción (0.06 = ±6 %). */
export type PitchRange = 0.06 | 0.08 | 0.16;
/** Tamaño de búfer objetivo en muestras; se traduce a `latencyHint` del AudioContext. */
export type AudioBufferSize = 256 | 512 | 1024;
export type AutoTransitionBeats = 8 | 16 | 32;
/** `cdj`: CUE en reproducción pausa y vuelve al marcador. `standard`: vuelve al marcador sin detenerse. */
export type CueMode = 'cdj' | 'standard';
/** Intensidad del visualizador de la barra de reproducción (opacidad y ganancia de la onda). */
export type VisualizerIntensity = 'subtle' | 'balanced' | 'vivid';
/** Diseño del disco giratorio de los decks (public/assets/mixer/disk/rotating-disc-*.png). */
export type JogDisc = 'a' | 'b' | 'c';

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
  /** Teclas selectoras de GAIN / HI / MID / LOW / FILTER por deck y comandos de consola reasignables. */
  shortcutBindings: ShortcutBindings;
  /** Tecla (con Shift) que abre cada sección principal. */
  navigationBindings: NavigationBindings;
  autoAnalyzeOnImport: boolean;
  /** Animaciones decorativas de la interfaz; `prefers-reduced-motion` las desactiva igualmente. */
  animations: boolean;
  visualizerIntensity: VisualizerIntensity;
  /** Disco que muestran ambos decks; solo es apariencia, no afecta al transporte. */
  jogDisc: JogDisc;
  /** Reserva la futura disposición alternativa de la consola; todavía no cambia la interfaz. */
  experimentalInterface: boolean;
}

export const SETTINGS_STORAGE_KEY = 'systemdj.settings';

export const ACCENT_COLORS: readonly AccentColor[] = ['orange', 'blue', 'cyan', 'violet', 'magenta', 'neon', 'amber'];
/** Matiz HSL aproximado de cada acento; alimenta `--hue-primary` (escala heredada del Mixer y los decks).
    Los colores exactos de la identidad v2 viven en tokens.css bajo `[data-accent]`. */
export const ACCENT_HUES: Record<AccentColor, number> = {
  orange: 15,
  blue: 222,
  cyan: 188,
  violet: 258,
  magenta: 320,
  neon: 147,
  amber: 39,
};
export const VISUALIZER_INTENSITIES: readonly VisualizerIntensity[] = ['subtle', 'balanced', 'vivid'];
export const JOG_DISCS: readonly JogDisc[] = ['a', 'b', 'c'];
/** Mismo orden que el selector de la consola: CP, LIN, CUT. */
export const CROSSFADER_CURVES: readonly CrossfaderCurve[] = ['constant-power', 'linear', 'cut'];

/** Curva anterior (-1) o siguiente (1) en el orden de la consola, de forma circular. */
export function stepCrossfaderCurve(curve: CrossfaderCurve, direction: -1 | 1): CrossfaderCurve {
  const index = Math.max(0, CROSSFADER_CURVES.indexOf(curve));
  return CROSSFADER_CURVES[(index + direction + CROSSFADER_CURVES.length) % CROSSFADER_CURVES.length];
}
export const PITCH_RANGES: readonly PitchRange[] = [0.06, 0.08, 0.16];
export const BUFFER_SIZES: readonly AudioBufferSize[] = [256, 512, 1024];
export const AUTO_TRANSITION_BEATS: readonly AutoTransitionBeats[] = [8, 16, 32];
export const SYNC_RANGE_MIN = 0.04;
export const SYNC_RANGE_MAX = 0.2;
export const SYNC_RANGE_STEP = 0.01;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  accentColor: 'orange',
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
  navigationBindings: DEFAULT_NAVIGATION_BINDINGS,
  autoAnalyzeOnImport: true,
  animations: true,
  visualizerIntensity: 'balanced',
  jogDisc: 'b',
  experimentalInterface: false,
};

/**
 * Versión del formato guardado. Hasta la v1 el acento solo teñía el Mixer y su valor
 * predeterminado era `violet`; desde la v2 el acento es global y el predeterminado es el naranja
 * de la identidad. Un `violet` sin versión casi siempre es el valor por defecto heredado, no una
 * elección, y se migra al naranja; cualquier otro acento guardado se respeta.
 * La v3 cambia las selectoras de mezcla predeterminadas (F y J pasan a identificar los decks):
 * las que seguían en su valor anterior adoptan el nuevo. En la v4 MUTE pasa de Y a B.
 */
export const SETTINGS_VERSION = 4;

export function migrateStoredSettings(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const source = raw as Record<string, unknown>;
  const version = typeof source.settingsVersion === 'number' ? source.settingsVersion : 0;
  if (version >= SETTINGS_VERSION) return raw;
  let migrated = source;
  if (version < 2 && source.accentColor === 'violet') migrated = { ...migrated, accentColor: DEFAULT_SETTINGS.accentColor };
  if (version < 3 && source.shortcutBindings) {
    migrated = { ...migrated, shortcutBindings: migrateLegacyShortcutBindings(source.shortcutBindings) };
  } else if (version < 4 && source.shortcutBindings) {
    migrated = { ...migrated, shortcutBindings: migrateLegacyConsoleBindings(source.shortcutBindings) };
  }
  return migrated;
}

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
    navigationBindings: sanitizeNavigationBindings(source.navigationBindings),
    autoAnalyzeOnImport: typeof source.autoAnalyzeOnImport === 'boolean' ? source.autoAnalyzeOnImport : d.autoAnalyzeOnImport,
    animations: typeof source.animations === 'boolean' ? source.animations : d.animations,
    visualizerIntensity: pick(source.visualizerIntensity, VISUALIZER_INTENSITIES, d.visualizerIntensity),
    jogDisc: pick(source.jogDisc, JOG_DISCS, d.jogDisc),
    experimentalInterface: typeof source.experimentalInterface === 'boolean' ? source.experimentalInterface : d.experimentalInterface,
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

  /**
   * Lee lo que está realmente guardado, sin la copia en memoria. Permite comprobar que una
   * preferencia sobrevivirá a una recarga antes de recargar (p. ej. el modo experimental).
   */
  public readPersisted(): AppSettings | null {
    try {
      const raw = this.storage?.getItem(SETTINGS_STORAGE_KEY);
      return raw ? sanitizeSettings(migrateStoredSettings(JSON.parse(raw))) : null;
    } catch {
      return null;
    }
  }

  private load(): AppSettings {
    return this.readPersisted() ?? { ...DEFAULT_SETTINGS };
  }

  private persist(): void {
    try {
      this.storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...this.settings, settingsVersion: SETTINGS_VERSION }));
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
