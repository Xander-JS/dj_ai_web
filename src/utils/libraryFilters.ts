/**
 * SYSTEM DJ — Library filters
 * Criterios de los filtros de la Biblioteca, sin React, para que la tabla, la selección masiva
 * y las pruebas usen exactamente la misma definición.
 */

import type { AnalysisStatus, Track } from '../types/track';

/** Origen: toda la biblioteca, solo archivos importados del equipo o solo pistas importadas por enlace. */
export type SourceFilter = 'all' | 'local' | 'link';
export const SOURCE_FILTERS: readonly SourceFilter[] = ['all', 'local', 'link'];

/**
 * Estado del análisis musical:
 * - `analyzed`: análisis completado (`analyzed`). Un `unsupported` puede conservar datos
 *   parciales (energía o valores manuales) y no cuenta como analizado.
 * - `pending`: todavía sin resultado (`pending` o `analyzing`, en curso).
 * - `failed`: terminó sin resultado utilizable (`failed` o `unsupported`).
 */
export type AnalysisFilter = 'all' | 'analyzed' | 'pending' | 'failed';
export const ANALYSIS_FILTERS: readonly AnalysisFilter[] = ['all', 'analyzed', 'pending', 'failed'];

const ANALYSIS_GROUPS: Record<Exclude<AnalysisFilter, 'all'>, readonly AnalysisStatus[]> = {
  analyzed: ['analyzed'],
  pending: ['pending', 'analyzing'],
  failed: ['failed', 'unsupported'],
};

export function matchesAnalysisFilter(status: AnalysisStatus | undefined, filter: AnalysisFilter): boolean {
  if (filter === 'all') return true;
  return ANALYSIS_GROUPS[filter].includes(status ?? 'pending');
}

/**
 * Pista importada por enlace (hoy, YouTube): `origin: 'link'`, registrado al importar.
 * El filtro y la etiqueta LOCAL/LINK usan esta misma función.
 */
export function isLinkTrack(track: Pick<Track, 'origin'>): boolean {
  return track.origin === 'link';
}

/**
 * Archivo importado desde el equipo: audio guardado en este dispositivo (archivo, blob o IndexedDB)
 * que no llegó por enlace. Una fuente `url` (stream remoto) no es local. Las pistas históricas
 * sin `origin` cuentan como archivos locales.
 */
export function isLocalTrack(track: Pick<Track, 'source' | 'origin'>): boolean {
  return track.source?.type !== 'url' && !isLinkTrack(track);
}

export interface LibraryFilterRow {
  title: string;
  artist: string;
  album: string;
  status: AnalysisStatus;
  rawLocalTrack: Pick<Track, 'source' | 'origin'>;
}

/** Filas visibles según origen, estado de análisis y búsqueda; también es el alcance de la selección. */
export function filterLibraryRows<T extends LibraryFilterRow>(
  rows: readonly T[],
  source: SourceFilter,
  analysis: AnalysisFilter,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (source === 'local' && !isLocalTrack(row.rawLocalTrack)) return false;
    if (source === 'link' && !isLinkTrack(row.rawLocalTrack)) return false;
    if (!matchesAnalysisFilter(row.status, analysis)) return false;
    if (q === '') return true;
    return row.title.toLowerCase().includes(q)
      || row.artist.toLowerCase().includes(q)
      || row.album.toLowerCase().includes(q);
  });
}
