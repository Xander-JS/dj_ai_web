/**
 * SYSTEM DJ — Toasts
 * Confirmaciones rápidas (p. ej. «pista cargada en Deck A») que el shell de la consola muestra
 * en la esquina superior derecha, fuera del flujo del documento: no desplazan listas ni
 * cabeceras. Cada aviso se retira solo; el más reciente queda arriba, así que al expirar el
 * más antiguo (abajo) los demás no se mueven.
 *
 * Avisos repetidos del mismo grupo (por defecto, mismo tono y texto) no se apilan: el aviso
 * visible —o el que espera turno— suma uno a su contador y actualiza su texto en el sitio.
 * Avisos distintos que llegan a la vez entran en cola, uno cada TOAST_STAGGER_MS.
 */

import { useSyncExternalStore } from 'react';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
  /** Repeticiones agrupadas en este aviso */
  count: number;
  group: string;
}

/** Texto fijo, o una función que lo compone a partir del contador del grupo. */
export type ToastText = string | ((count: number) => string);

export interface ToastOptions {
  /** Clave de agrupación; por defecto, tono + texto. */
  group?: string;
  /** Contador absoluto del grupo (si el que llama lleva la cuenta); si no, suma uno. */
  count?: number;
  /** Cada actualización del grupo reinicia la cuenta atrás. */
  durationMs?: number;
}

type ToastListener = () => void;

/** Duración por defecto: la misma que usaban los avisos en línea de Inicio. */
export const TOAST_DURATION_MS = 3500;
/** Separación entre entradas de avisos distintos que llegan a la vez. */
export const TOAST_STAGGER_MS = 250;
const MAX_TOASTS = 3;

interface QueuedToast extends Toast {
  durationMs: number;
}

/** Texto final: con función, la función decide; con texto fijo, el contador va entre paréntesis. */
function composeText(text: ToastText, count: number): string {
  if (typeof text === 'function') return text(count);
  return count > 1 ? `${text} (${count})` : text;
}

export class ToastStore {
  private toasts: readonly Toast[] = [];
  private queue: QueuedToast[] = [];
  private listeners: Set<ToastListener> = new Set();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private staggerTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;

  public show(tone: ToastTone, text: ToastText, options: ToastOptions = {}): number {
    const group = options.group ?? `${tone}:${typeof text === 'string' ? text : text(1)}`;
    const durationMs = options.durationMs ?? TOAST_DURATION_MS;

    const visible = this.toasts.find((toast) => toast.group === group);
    if (visible) {
      const count = options.count ?? visible.count + 1;
      this.toasts = this.toasts.map((toast) =>
        toast.id === visible.id ? { ...toast, tone, count, text: composeText(text, count) } : toast,
      );
      this.schedule(visible.id, durationMs);
      this.emit();
      return visible.id;
    }

    const queued = this.queue.find((toast) => toast.group === group);
    if (queued) {
      queued.count = options.count ?? queued.count + 1;
      queued.tone = tone;
      queued.text = composeText(text, queued.count);
      queued.durationMs = durationMs;
      return queued.id;
    }

    const count = options.count ?? 1;
    const id = this.nextId++;
    this.queue.push({ id, tone, group, count, text: composeText(text, count), durationMs });
    if (this.staggerTimer === null) this.enterNext();
    return id;
  }

  public dismiss(id: number): void {
    this.clearTimer(id);
    this.queue = this.queue.filter((toast) => toast.id !== id);
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

  // Hace visible el primero de la cola y espera TOAST_STAGGER_MS antes del siguiente
  private enterNext(): void {
    const next = this.queue.shift();
    if (!next) {
      this.staggerTimer = null;
      return;
    }
    const { durationMs, ...toast } = next;
    const stack = [toast, ...this.toasts];
    // Los que salen por el tope se retiran ya, con su temporizador
    for (const dropped of stack.slice(MAX_TOASTS)) this.clearTimer(dropped.id);
    this.toasts = stack.slice(0, MAX_TOASTS);
    this.schedule(toast.id, durationMs);
    this.emit();
    this.staggerTimer = setTimeout(() => this.enterNext(), TOAST_STAGGER_MS);
  }

  private schedule(id: number, durationMs: number): void {
    this.clearTimer(id);
    this.timers.set(id, setTimeout(() => this.dismiss(id), durationMs));
  }

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
