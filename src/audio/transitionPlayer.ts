/**
 * SYSTEM DJ — Transition Player
 * Ejecuta la transición automática entre decks desplazando el crossfader durante un número
 * de beats (8, 16 o 32, según Ajustes → Reproducción) al tempo efectivo del deck saliente.
 *
 * Reglas:
 * - No depende del DJ store: el destino (crossfader y BPM) se inyecta con `connect`.
 * - Una sola transición a la vez; `start` reemplaza la anterior y `cancel` la detiene donde esté.
 * - Sin BPM válido en el deck saliente no hay duración en beats y la transición se rechaza.
 */

import type { DeckId } from '../types/deck';

/** Destino que la transición manipula (inyectable en pruebas). */
export interface TransitionTarget {
  getCrossfader(): number;
  setCrossfader(position: number): void;
  /** Tempo efectivo (BPM × velocidad) del deck, o null si no está analizado. */
  getDeckBpm(deckId: DeckId): number | null;
}

/** Reloj inyectable; por defecto setInterval/clearInterval y performance.now. */
export interface TransitionClock {
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const TICK_MS = 50;

const defaultClock: TransitionClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class TransitionPlayer {
  private beats = 16;
  private target: TransitionTarget | null = null;
  private timer: unknown = null;
  private readonly clock: TransitionClock;

  public constructor(clock: TransitionClock = defaultClock) {
    this.clock = clock;
  }

  /** Conecta el destino real (lo hace settingsEffects al iniciar la app). */
  public connect(target: TransitionTarget): void {
    this.target = target;
  }

  /** Fija la duración en beats; se aplica a la siguiente transición, no a la que esté en curso. */
  public configure(beats: number): void {
    if (Number.isInteger(beats) && beats > 0) this.beats = beats;
  }

  public getBeats(): number {
    return this.beats;
  }

  /** Duración en segundos de `beats` pulsos a `bpm`, o null si el tempo no es válido. */
  public computeDurationSeconds(bpm: number | null): number | null {
    if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) return null;
    return (this.beats * 60) / bpm;
  }

  public isActive(): boolean {
    return this.timer !== null;
  }

  /**
   * Lleva el crossfader del deck saliente al opuesto en `beats` pulsos.
   * Devuelve false si no hay destino conectado o el deck saliente no tiene BPM.
   */
  public start(fromDeck: DeckId): boolean {
    const target = this.target;
    if (!target) return false;
    const durationSec = this.computeDurationSeconds(target.getDeckBpm(fromDeck));
    if (durationSec === null) return false;

    this.cancel();
    const from = target.getCrossfader();
    const to = fromDeck === 'A' ? 100 : 0;
    const startedAt = this.clock.now();
    const durationMs = durationSec * 1000;

    const tick = (): void => {
      const progress = Math.min(1, (this.clock.now() - startedAt) / durationMs);
      target.setCrossfader(Number((from + (to - from) * progress).toFixed(2)));
      if (progress >= 1) this.cancel();
    };
    this.timer = this.clock.setInterval(tick, TICK_MS);
    return true;
  }

  public cancel(): void {
    if (this.timer === null) return;
    this.clock.clearInterval(this.timer);
    this.timer = null;
  }
}

export const transitionPlayer = new TransitionPlayer();
