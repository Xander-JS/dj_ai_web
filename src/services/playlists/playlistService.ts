/**
 * SYSTEM DJ — Local Playlist Service
 * CRUD de playlists locales sobre IndexedDB. Las operaciones de edición son funciones
 * puras e inmutables; el servicio las persiste y avisa a las vistas suscritas
 * (Biblioteca y Playlists) para que se mantengan sincronizadas sin recargar.
 */

import type { Playlist } from '../../types/playlist.ts';
import { indexedDBStorage, type IndexedDBStorage } from '../storage/IndexedDBStorage.ts';

const COVER_COLORS = [
  'hsl(260, 70%, 55%)',
  'hsl(348, 80%, 50%)',
  'hsl(38, 90%, 50%)',
  'hsl(142, 70%, 45%)',
  'hsl(200, 80%, 50%)',
  'hsl(300, 60%, 50%)',
];

export const MAX_PLAYLIST_NAME_LENGTH = 80;

/** Normaliza el nombre; devuelve null si queda vacío. */
export function normalizePlaylistName(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, ' ').slice(0, MAX_PLAYLIST_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

function generatePlaylistId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `pl_${crypto.randomUUID()}`;
  }
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPlaylist(name: string, existingCount: number, now = Date.now()): Playlist {
  const normalized = normalizePlaylistName(name);
  if (!normalized) throw new Error('El nombre de la playlist no puede estar vacío');
  return {
    id: generatePlaylistId(),
    name: normalized,
    coverColor: COVER_COLORS[existingCount % COVER_COLORS.length],
    trackIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function renamePlaylist(playlist: Playlist, name: string, now = Date.now()): Playlist {
  const normalized = normalizePlaylistName(name);
  if (!normalized) throw new Error('El nombre de la playlist no puede estar vacío');
  return { ...playlist, name: normalized, updatedAt: now };
}

/** Añade pistas al final, ignorando las que ya forman parte de la playlist. */
export function addTracksToPlaylist(playlist: Playlist, trackIds: readonly string[], now = Date.now()): Playlist {
  const present = new Set(playlist.trackIds);
  const additions: string[] = [];
  for (const id of trackIds) {
    if (!present.has(id)) {
      present.add(id);
      additions.push(id);
    }
  }
  if (additions.length === 0) return playlist;
  return { ...playlist, trackIds: [...playlist.trackIds, ...additions], updatedAt: now };
}

export function removeTrackFromPlaylist(playlist: Playlist, trackId: string, now = Date.now()): Playlist {
  if (!playlist.trackIds.includes(trackId)) return playlist;
  return { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId), updatedAt: now };
}

/** Mueve la pista de `fromIndex` a `toIndex`; índices fuera de rango no producen cambios. */
export function moveTrackInPlaylist(playlist: Playlist, fromIndex: number, toIndex: number, now = Date.now()): Playlist {
  const length = playlist.trackIds.length;
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= length || toIndex >= length) {
    return playlist;
  }
  const trackIds = [...playlist.trackIds];
  const [moved] = trackIds.splice(fromIndex, 1);
  trackIds.splice(toIndex, 0, moved);
  return { ...playlist, trackIds, updatedAt: now };
}

/** Misma referencia = mismas semillas en el mismo orden (la 1.ª abre la sesión y la 2.ª la cierra). */
export function isSameSeedReference(playlist: Playlist, seedTrackIds: readonly string[]): boolean {
  const seeds = playlist.seedTrackIds;
  return !!seeds && seeds.length === seedTrackIds.length && seeds.every((id, index) => id === seedTrackIds[index]);
}

type PlaylistChangeListener = () => void;

export class PlaylistService {
  private listeners: Set<PlaylistChangeListener> = new Set();
  // Referencias en creación: dos peticiones simultáneas no generan la misma mezcla dos veces
  private pendingSeedReferences = new Set<string>();
  private storage: IndexedDBStorage;

  constructor(storage: IndexedDBStorage = indexedDBStorage) {
    this.storage = storage;
  }

  public subscribe(listener: PlaylistChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getAll(): Promise<Playlist[]> {
    return this.storage.getAllPlaylists();
  }

  public async create(name: string): Promise<Playlist> {
    const existing = await this.storage.getAllPlaylists();
    return this.persist(buildPlaylist(name, existing.length));
  }

  /** Mezcla ya generada (y no eliminada) por el Modo referencia con estas semillas. */
  public async findBySeeds(seedTrackIds: readonly string[]): Promise<Playlist | null> {
    const existing = await this.storage.getAllPlaylists();
    return existing.find((p) => isSameSeedReference(p, seedTrackIds)) ?? null;
  }

  /**
   * Guarda la mezcla de una referencia con sus pistas. Devuelve null, sin crear nada, si esa
   * referencia ya existe o se está creando en este momento.
   */
  public async createSeedMix(name: string, seedTrackIds: readonly string[], trackIds: readonly string[]): Promise<Playlist | null> {
    const key = JSON.stringify(seedTrackIds);
    if (this.pendingSeedReferences.has(key)) return null;
    this.pendingSeedReferences.add(key);
    try {
      const existing = await this.storage.getAllPlaylists();
      if (existing.some((p) => isSameSeedReference(p, seedTrackIds))) return null;
      const playlist = addTracksToPlaylist(buildPlaylist(name, existing.length), trackIds);
      return await this.persist({ ...playlist, seedTrackIds: [...seedTrackIds] });
    } finally {
      this.pendingSeedReferences.delete(key);
    }
  }

  /** Aplica una edición pura sobre la versión almacenada y la persiste. */
  public async update(id: string, edit: (playlist: Playlist) => Playlist): Promise<Playlist | null> {
    const current = (await this.storage.getAllPlaylists()).find((p) => p.id === id);
    if (!current) return null;
    const next = edit(current);
    if (next === current) return current;
    return this.persist(next);
  }

  public async remove(id: string): Promise<void> {
    await this.storage.deletePlaylist(id);
    this.emit();
  }

  /** Notifica cambios realizados fuera del servicio (p. ej. pistas eliminadas de la biblioteca). */
  public notifyExternalChange(): void {
    this.emit();
  }

  private async persist(playlist: Playlist): Promise<Playlist> {
    const result = await this.storage.savePlaylist(playlist);
    if (!result.persisted && result.reason !== 'unsupported') {
      throw new Error(`No se pudo guardar la playlist "${playlist.name}" (${result.reason})`);
    }
    this.emit();
    return playlist;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const playlistService = new PlaylistService();
