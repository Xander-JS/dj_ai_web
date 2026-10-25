/**
 * SYSTEM DJ — Toasts
 * Confirmaciones rápidas (p. ej. «pista cargada en Deck A») que el shell de la consola muestra
 * en la esquina superior derecha, fuera del flujo del documento: no desplazan listas ni
 * cabeceras. Cada aviso se retira solo; el más reciente queda arriba, así que al expirar el
 * más antiguo (abajo) los demás no se mueven.
 */

import { useSyncExternalStore } from 'react';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

type ToastListener = () => void;

/** Duración por defecto: la misma que usaban los avisos en línea de Inicio. */
export const TOAST_DURATION_MS = 3500;
const MAX_TOASTS = 3;

export class ToastStore {
  private toasts: readonly Toast[] = [];
  private listeners: Set<ToastListener> = new Set();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextId = 1;

  public show(tone: ToastTone, text: string, durationMs: number = TOAST_DURATION_MS): number {
    const id = this.nextId++;
    const next = [{ id, tone, text }, ...this.toasts];
    // Los que salen por el tope se retiran ya, con su temporizador
    for (const dropped of next.slice(MAX_TOASTS)) this.clearTimer(dropped.id);
    this.toasts = next.slice(0, MAX_TOASTS);
    this.timers.set(id, setTimeout(() => this.dismiss(id), durationMs));
    this.emit();
    return id;
  }

  public dismiss(id: number): void {
    this.clearTimer(id);
    if (!this.toasts.some((toast) => toast.id === id)) return;
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
    this.emit();
  }

  /** Instantánea inmutable compatible con useSyncExternalStore. */
  public getSnapshot = (): readonly Toast[] => this.toasts;

  public subscribe = (listener: ToastListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(id);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const toastStore = new ToastStore();

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot);
}
