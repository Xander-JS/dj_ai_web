/**
 * Deck de referencia de Home: lo comparten «Recomendaciones de mezcla» (pista de referencia)
 * y «Añadidas recientemente» (destino del clic en una fila).
 */
export type ReferenceDeck = 'A' | 'B';

/** El deck elegido explícitamente o, si no, el que tiene pista (A primero). */
export function resolveReferenceDeck(selected: ReferenceDeck | null, hasTrackA: boolean, hasTrackB: boolean): ReferenceDeck {
  return selected ?? (hasTrackA ? 'A' : (hasTrackB ? 'B' : 'A'));
}
