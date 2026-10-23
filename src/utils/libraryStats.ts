/**
 * SYSTEM DJ — Library Stats Utility
 * Métricas derivadas exclusivamente de las pistas importadas y persistidas en el navegador.
 */

import type { Track } from '../types/track';

export interface LibraryStats {
  totalTracks: number;
  analyzedTracks: number;
  totalHours: number;                // Duración acumulada de la biblioteca, redondeada a 1 decimal
}

/**
 * Calcula estadísticas reales de la biblioteca local a partir de las pistas almacenadas.
 */
export function computeLibraryStats(tracks: readonly Track[]): LibraryStats {
  let analyzedTracks = 0;
  let totalSeconds = 0;

  for (const track of tracks) {
    if (track.analysis?.status === 'analyzed') analyzedTracks++;
    if (Number.isFinite(track.duration) && track.duration > 0) totalSeconds += track.duration;
  }

  return {
    totalTracks: tracks.length,
    analyzedTracks,
    totalHours: Math.round((totalSeconds / 3600) * 10) / 10,
  };
}

/**
 * Devuelve las pistas incorporadas más recientemente, ordenadas de más nueva a más antigua.
 */
export function getRecentlyAddedTracks(tracks: readonly Track[], limit: number): Track[] {
  return [...tracks]
    .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0))
    .slice(0, Math.max(0, limit));
}
