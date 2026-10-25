/**
 * SYSTEM DJ — Favorites
 * Pistas marcadas como favoritas, por id, persistidas en localStorage. Es la única fuente de
 * verdad del corazón de la barra (y de cualquier vista que lo muestre), así que marcar en
 * un sitio se refleja en todos.
 *
 * La biblioteca vive en IndexedDB; los favoritos guardan solo ids y no tocan su esquema.
 * Un id cuya pista se eliminó queda inerte (no coincide con ninguna pista).
 */

import { useSyncExternalStore } from 'react';

export const FAVORITES_STORAGE_KEY = 'systemdj.favorites';

export interface FavoritesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): FavoritesStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

type Listener = () => void;

export class FavoritesStore {
  private ids: ReadonlySet<string>;
  private listeners = new Set<Listener>();
  private storage: FavoritesStorage | null;

  public constructor(storage: FavoritesStorage | null = getDefaultStorage()) {
    this.storage = storage;
    this.ids = this.load();
  }

  public getSnapshot = (): ReadonlySet<string> => this.ids;

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public isFavorite(trackId: string): boolean {
    return this.ids.has(trackId);
  }

  public setFavorite(trackId: string, favorite: boolean): void {
    if (!trackId || this.ids.has(trackId) === favorite) return;
    const next = new Set(this.ids);
    if (favorite) next.add(trackId);
    else next.delete(trackId);
    this.ids = next;
    this.persist();
    for (const listener of this.listeners) listener();
  }

  public toggle(trackId: string): boolean {
    const favorite = !this.ids.has(trackId);
    this.setFavorite(trackId, favorite);
    return favorite;
  }

  private load(): ReadonlySet<string> {
    try {
      const raw = this.storage?.getItem(FAVORITES_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && id !== '') : []);
    } catch {
      return new Set();
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...this.ids]));
    } catch {
      // Almacenamiento bloqueado o lleno: el favorito sigue vigente en memoria
    }
  }
}

export const favoritesStore = new FavoritesStore();

export function useIsFavorite(trackId: string | null | undefined): boolean {
  const ids = useSyncExternalStore(favoritesStore.subscribe, favoritesStore.getSnapshot, favoritesStore.getSnapshot);
  return trackId ? ids.has(trackId) : false;
}
