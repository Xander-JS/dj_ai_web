/**
 * SYSTEM DJ — Digital screen menu model
 * Lógica pura del menú de carga de la pantalla digital: filas de la lista, búsqueda por título,
 * selección inicial, navegación con las ocho teclas y decisión de carga. Sin React ni DOM.
 */

import type { DeckId, PlaybackState } from '../../types/deck.ts';
import type { Track } from '../../types/track.ts';
import { formatDuration } from '../../utils/formatters.ts';

/** Teclas de navegación de la pantalla (`KeyboardEvent.key`). */
export type ScreenNavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'Enter' | 'Escape';
export const SCREEN_NAV_KEYS: ReadonlySet<string> = new Set<ScreenNavKey>([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Escape',
]);

/** Las mismas teclas como `KeyboardEvent.code`, para los atajos globales. */
export const SCREEN_NAV_CODES: ReadonlySet<string> = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'NumpadEnter', 'Escape',
]);

/** Subapartados del menú, de arriba abajo. Abierto a nuevas entradas. */
export const SCREEN_SUBSECTIONS: readonly DeckId[] = ['A', 'B'];

/** Zona del menú con el foco lógico. */
export type MenuZone = 'subsections' | 'search' | 'list';

const EMPTY = '—';

export interface MenuRow {
  id: string;
  title: string;
  bpm: string;
  camelot: string;
  duration: string;
}

export function toMenuRow(track: Track): MenuRow {
  const bpm = track.analysis?.bpm;
  const camelot = track.analysis?.status === 'analyzed' ? track.analysis.camelot : undefined;
  return {
    id: track.id,
    title: track.title,
    bpm: typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 ? String(Math.round(bpm)) : EMPTY,
    camelot: camelot ?? EMPTY,
    duration: Number.isFinite(track.duration) && track.duration > 0 ? formatDuration(track.duration) : EMPTY,
  };
}

/** Minúsculas y sin acentos: «Canción» coincide con «cancion». */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Filtra solo por título (no por artista), sin distinguir mayúsculas ni acentos. */
export function filterTracksByTitle<T extends { title: string }>(tracks: readonly T[], query: string): T[] {
  const needle = normalizeSearchText(query.trim());
  if (!needle) return [...tracks];
  return tracks.filter((track) => normalizeSearchText(track.title).includes(needle));
}

/** Fila seleccionada al abrir o cambiar de subapartado: la pista cargada en el deck, si no la primera. */
export function initialSelectionIndex(rows: readonly { id: string }[], loadedTrackId: string | null): number {
  if (rows.length === 0) return -1;
  const loaded = loadedTrackId ? rows.findIndex((row) => row.id === loadedTrackId) : -1;
  return loaded >= 0 ? loaded : 0;
}

export type LoadIntent = 'none' | 'load' | 'confirm';

/** Misma pista ya cargada: nada; deck sonando: confirmar; parado, en pausa o vacío: cargar. */
export function resolveLoadIntent(
  target: { trackId: string | null; playbackState: PlaybackState },
  trackId: string,
): LoadIntent {
  if (target.trackId === trackId) return 'none';
  return target.playbackState === 'playing' ? 'confirm' : 'load';
}

export type MenuCommand =
  | { type: 'none' }
  /** La tecla conserva su comportamiento nativo (cursor del buscador). */
  | { type: 'native' }
  | { type: 'subsection'; deckId: DeckId }
  | { type: 'focus'; zone: MenuZone }
  | { type: 'select'; index: number }
  | { type: 'load' }
  | { type: 'clear-search' }
  | { type: 'close' };

export interface MenuKeyContext {
  subsection: DeckId;
  selectedIndex: number;
  rowCount: number;
  searchText: string;
}

/** Traduce una de las ocho teclas a la acción del menú según la zona con el foco. */
export function resolveMenuKey(zone: MenuZone, key: string, ctx: MenuKeyContext): MenuCommand {
  if (zone === 'subsections') {
    const index = SCREEN_SUBSECTIONS.indexOf(ctx.subsection);
    const last = SCREEN_SUBSECTIONS.length - 1;
    switch (key) {
      case 'ArrowUp': return { type: 'subsection', deckId: SCREEN_SUBSECTIONS[Math.max(0, index - 1)] };
      case 'ArrowDown': return { type: 'subsection', deckId: SCREEN_SUBSECTIONS[Math.min(last, index + 1)] };
      case 'Home': return { type: 'subsection', deckId: SCREEN_SUBSECTIONS[0] };
      case 'End': return { type: 'subsection', deckId: SCREEN_SUBSECTIONS[last] };
      case 'ArrowRight':
      case 'Enter': return { type: 'focus', zone: 'list' };
      case 'Escape': return { type: 'close' };
      default: return { type: 'none' };
    }
  }

  if (zone === 'search') {
    switch (key) {
      case 'ArrowDown':
      case 'Enter': return ctx.rowCount > 0 ? { type: 'select', index: 0 } : { type: 'none' };
      case 'Escape': return ctx.searchText ? { type: 'clear-search' } : { type: 'close' };
      case 'Home':
      case 'End':
      case 'ArrowLeft':
      case 'ArrowRight': return { type: 'native' };
      default: return { type: 'none' };
    }
  }

  const last = ctx.rowCount - 1;
  switch (key) {
    case 'ArrowUp':
      if (ctx.selectedIndex <= 0) return { type: 'focus', zone: 'search' };
      return { type: 'select', index: ctx.selectedIndex - 1 };
    case 'ArrowDown':
      return last >= 0 ? { type: 'select', index: Math.min(last, ctx.selectedIndex + 1) } : { type: 'none' };
    case 'Home': return last >= 0 ? { type: 'select', index: 0 } : { type: 'none' };
    case 'End': return last >= 0 ? { type: 'select', index: last } : { type: 'none' };
    case 'ArrowLeft': return { type: 'focus', zone: 'subsections' };
    case 'Enter': return ctx.selectedIndex >= 0 && ctx.selectedIndex <= last ? { type: 'load' } : { type: 'none' };
    case 'Escape': return { type: 'close' };
    default: return { type: 'none' };
  }
}
