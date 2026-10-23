/**
 * SYSTEM DJ — Domain Model: Local Playlists
 * Playlists persistidas en IndexedDB que referencian pistas locales por id.
 * El orden de `trackIds` es el orden de reproducción; no se duplican metadatos de pista.
 */

export interface Playlist {
  id: string;
  name: string;
  coverColor: string;
  trackIds: string[];                // Ids de pistas del almacén `tracks`, en orden
  createdAt: number;                 // Timestamp de creación
  updatedAt: number;                 // Timestamp de última modificación
}
