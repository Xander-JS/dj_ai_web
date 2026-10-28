/**
 * SYSTEM DJ — Recommendation Store
 * Último resultado de «Recomendaciones de mezcla» (Inicio). Vive fuera de la tarjeta para que
 * sobreviva al cambiar de sección: al volver se muestra tal cual, sin recalcular. Solo se
 * sustituye cuando el usuario vuelve a calcular; el estado vive en memoria durante la sesión.
 */

import { useSyncExternalStore } from 'react';
import type { TrackRecommendation } from '../services/ai/types.ts';

export interface RecommendationResult {
  /** Pista de referencia para la que se calculó */
  referenceTrackId: string;
  recommendations: TrackRecommendation[];
  insufficientCandidateCount: number;
  isMock: boolean;
  model: string | null;
  explanationsUnavailable: boolean;
}

type RecommendationListener = () => void;

export class RecommendationStore {
  private result: RecommendationResult | null = null;
  private listeners: Set<RecommendationListener> = new Set();

  public getSnapshot = (): RecommendationResult | null => this.result;

  public subscribe = (listener: RecommendationListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public set(next: RecommendationResult | null): void {
    this.result = next;
    for (const listener of this.listeners) listener();
  }

  /** Actualiza el resultado guardado (p. ej. con las explicaciones que llegan después). */
  public update(patch: Partial<RecommendationResult>): void {
    if (this.result) this.set({ ...this.result, ...patch });
  }
}

export const recommendationStore = new RecommendationStore();

export function useRecommendationStore(): RecommendationResult | null {
  return useSyncExternalStore(recommendationStore.subscribe, recommendationStore.getSnapshot, recommendationStore.getSnapshot);
}
