/**
 * SYSTEM DJ — Auto Loop del deck
 * Reglas puras: longitudes en pulsos, paso con − / + y la región A→B en tiempo de pista.
 */

/** Longitudes en pulsos: − divide a la mitad y + dobla, sin pasar de los extremos. */
export const LOOP_BEATS: readonly number[] = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
export const DEFAULT_LOOP_BEATS = 1;

export function stepLoopBeats(beats: number, direction: 1 | -1): number {
  const index = LOOP_BEATS.indexOf(beats);
  const from = index === -1 ? LOOP_BEATS.indexOf(DEFAULT_LOOP_BEATS) : index;
  return LOOP_BEATS[Math.max(0, Math.min(LOOP_BEATS.length - 1, from + direction))];
}

/** Longitud tal como se serigrafía: ¼ y ½ como fracciones. */
export function formatLoopBeats(beats: number): string {
  return beats === 0.25 ? '¼' : beats === 0.5 ? '½' : String(beats);
}

/**
 * A = posición (o el pulso más cercano de la rejilla confirmada, si `beatOrigin` no es null);
 * B = A + longitud × 60 / BPM analizado, en tiempo de pista (no cambia con el pitch).
 */
export function loopRegion(position: number, beats: number, bpm: number, beatOrigin: number | null): { start: number; end: number } {
  const beat = 60 / bpm;
  const start = beatOrigin === null
    ? position
    : Math.max(0, beatOrigin + Math.round((position - beatOrigin) / beat) * beat);
  return { start, end: start + beats * beat };
}
