/**
 * SYSTEM DJ — Seed Tracks Store
 * Estado compartido de las pistas de referencia (semillas) que consume el secuenciador
 * `engine/playlistBuilder.ts`. Se mantiene separado de useDJStore, que se actualiza a ritmo
 * de animación, para que marcar semillas no dependa del transporte.
 *
 * Reglas:
 * - Máximo MAX_SEED_TRACKS semillas; el orden importa (1.ª = inicio, 2.ª = cierre).
 * - Marcar una tercera reemplaza a la más antigua y conserva la más reciente.
 * - Solo se guardan ids; el estado vive en memoria durante la sesión.
 */

import { useSyncExternalStore } from 'react';
import { MAX_SEED_TRACKS } from '../engine/playlistBuilder.ts';

export type SeedToggleResult =
  | { action: 'added' }
  | { action: 'removed' }
  | { action: 'replaced'; replacedId: string };

type SeedListener = () => void;

export class SeedStore {
  private seedTrackIds: readonly string[] = [];
  private listeners: Set<SeedListener> = new Set();

  public getSnapshot = (): readonly string[] => this.seedTrackIds;

  public subscribe = (listener: SeedListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public toggleSeed(trackId: string): SeedToggleResult {
    if (this.seedTrackIds.includes(trackId)) {
      this.set(this.seedTrackIds.filter((id) => id !== trackId));
      return { action: 'removed' };
    }
    if (this.seedTrackIds.length >= MAX_SEED_TRACKS) {
      const [replacedId, ...kept] = this.seedTrackIds;
      this.set([...kept, trackId]);
      return { action: 'replaced', replacedId };
    }
    this.set([...this.seedTrackIds, trackId]);
    return { action: 'added' };
  }

  public removeSeed(trackId: string): void {
    if (this.seedTrackIds.includes(trackId)) {
      this.set(this.seedTrackIds.filter((id) => id !== trackId));
    }
  }

  /** Invierte inicio y cierre cuando hay dos semillas. */
  public swapSeeds(): void {
    if (this.seedTrackIds.length === 2) this.set([this.seedTrackIds[1], this.seedTrackIds[0]]);
  }

  public clearSeeds(): void {
    if (this.seedTrackIds.length > 0) this.set([]);
  }

  private set(next: readonly string[]): void {
    this.seedTrackIds = next;
    for (const listener of this.listeners) listener();
  }
}

export const seedStore = new SeedStore();

/**
 * Hook reactivo para consumir y modificar las pistas de referencia.
 */
export function useSeedStore(): {
  seedTrackIds: readonly string[];
  toggleSeed: (trackId: string) => SeedToggleResult;
  removeSeed: (trackId: string) => void;
  swapSeeds: () => void;
  clearSeeds: () => void;
} {
  const seedTrackIds = useSyncExternalStore(seedStore.subscribe, seedStore.getSnapshot);
  return {
    seedTrackIds,
    toggleSeed: seedStore.toggleSeed.bind(seedStore),
    removeSeed: seedStore.removeSeed.bind(seedStore),
    swapSeeds: seedStore.swapSeeds.bind(seedStore),
    clearSeeds: seedStore.clearSeeds.bind(seedStore),
  };
}
