/**
 * SYSTEM DJ — Seed-based Playlist Builder
 * Secuenciador determinista que construye una sesión a partir de 1 o 2 pistas de referencia
 * (semillas), reutilizando la evaluación local de armonía Camelot y tempo (±8%).
 * - 1 semilla: la sesión arranca en la semilla y encadena la mejor transición disponible.
 * - 2 semillas: arranca en la primera y avanza hacia la segunda, que cierra la sesión.
 * No consulta servicios externos ni inventa métricas: los candidatos sin evidencia se omiten.
 */

import type { Track } from '../types/track.ts';
import {
  extractCandidateMetadata,
  evaluateHarmonicCompatibility,
  evaluateTempoCompatibility,
  calculateValidatedScore,
} from '../services/ai/geminiRecommendationService.ts';

export const MAX_SEED_TRACKS = 2;
export const DEFAULT_SESSION_LENGTH = 12;
/** Puntuación mínima de transición aceptada (excluye combinaciones sin viabilidad técnica). */
export const MIN_TRANSITION_SCORE = 30;

export interface PlaylistBuildOptions {
  seedTracks: readonly Track[];
  candidates: readonly Track[];
  maxLength?: number;
}

export type PlaylistBuildError = 'no_seeds' | 'too_many_seeds';

export interface PlaylistBuildResult {
  trackIds: string[];
  /** Candidatos descartados por no tener BPM ni tonalidad analizados. */
  skippedWithoutAnalysis: number;
  error?: PlaylistBuildError;
}

/** Puntuación de transición `from → to`, o null si no hay evidencia para evaluarla. */
export function scoreTransition(from: Track, to: Track): number | null {
  const a = extractCandidateMetadata(from);
  const b = extractCandidateMetadata(to);
  const harmonic = evaluateHarmonicCompatibility(a.camelot || a.key, b.camelot || b.key);
  const tempo = evaluateTempoCompatibility(a.bpm, b.bpm);
  return calculateValidatedScore(harmonic, tempo);
}

function energyDistance(a: Track, b: Track): number {
  const ea = extractCandidateMetadata(a).energy;
  const eb = extractCandidateMetadata(b).energy;
  return ea === undefined || eb === undefined ? 10 : Math.abs(ea - eb);
}

function hasMusicalEvidence(track: Track): boolean {
  const meta = extractCandidateMetadata(track);
  return meta.bpm !== undefined || meta.camelot !== undefined;
}

export function buildPlaylistFromSeeds(options: PlaylistBuildOptions): PlaylistBuildResult {
  const seeds = options.seedTracks;
  if (seeds.length === 0) return { trackIds: [], skippedWithoutAnalysis: 0, error: 'no_seeds' };
  if (seeds.length > MAX_SEED_TRACKS) return { trackIds: [], skippedWithoutAnalysis: 0, error: 'too_many_seeds' };

  const maxLength = Math.max(seeds.length, options.maxLength ?? DEFAULT_SESSION_LENGTH);
  const start = seeds[0];
  const end = seeds.length === 2 ? seeds[1] : null;
  const seedIds = new Set(seeds.map((s) => s.id));

  let skippedWithoutAnalysis = 0;
  const pool: Track[] = [];
  const seen = new Set<string>();
  for (const candidate of options.candidates) {
    if (seedIds.has(candidate.id) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    if (hasMusicalEvidence(candidate)) pool.push(candidate);
    else skippedWithoutAnalysis++;
  }

  const sequence: Track[] = [start];
  const slotsForMiddle = maxLength - (end ? 2 : 1);

  while (sequence.length - 1 < slotsForMiddle && pool.length > 0) {
    const current = sequence[sequence.length - 1];
    let best: { index: number; score: number; energy: number } | null = null;

    for (let index = 0; index < pool.length; index++) {
      const candidate = pool[index];
      const fromCurrent = scoreTransition(current, candidate);
      if (fromCurrent === null || fromCurrent < MIN_TRANSITION_SCORE) continue;
      let score = fromCurrent;
      if (end) {
        // Con dos semillas se favorecen candidatos que también conecten con la pista de cierre
        const toEnd = scoreTransition(candidate, end) ?? 0;
        score = fromCurrent * 0.6 + toEnd * 0.4;
      }
      const energy = energyDistance(current, candidate);
      const isBetter = !best
        || score > best.score
        || (score === best.score && energy < best.energy)
        || (score === best.score && energy === best.energy && candidate.id < pool[best.index].id);
      if (isBetter) best = { index, score, energy };
    }

    if (!best) break;
    sequence.push(pool.splice(best.index, 1)[0]);
  }

  if (end) sequence.push(end);
  return { trackIds: sequence.map((t) => t.id), skippedWithoutAnalysis };
}
