/**
 * SYSTEM DJ — Gemini AI Recommendation Service
 * Servicio cliente para solicitar recomendaciones inteligentes de pistas y sugerencias de mezcla.
 * Se comunica exclusivamente con el endpoint local del servidor de desarrollo (/api/ai/explanations)
 * sin exponer jamás la API key al cliente.
 *
 * Incluye validación local determinista de tonalidad Camelot, límites de pitch fader (±8%),
 * cálculo de medio/doble tiempo y resolución rigurosa de metadatos (artista y título).
 */

import type { Track, MusicalKeyCamelot } from '../../types/track.ts';
import { keyToCamelot } from '../../audio/analysis/camelotMapper.ts';
import type {
  TrackCandidateMetadata,
  TrackRecommendation,
  AIRecommendationResponse,
  AIExplanationResponse,
  HarmonicEvaluation,
  TempoEvaluation,
  RecommendationEvidenceStatus,
} from './types.ts';

/**
 * Límite estricto de pitch fader en SYSTEM DJ (±8%), equivalente a PITCH_RANGE = 0.08
 */
export const PITCH_LIMIT_PERCENT = 8.0;

/**
 * Resuelve y limpia el artista y título de una pista:
 * - Si el artista está ausente y el título es compuesto ("Artista - Título"), extrae el artista y el título.
 * - Si el artista ya está presente y el título lo duplica ("Artista - Título"), evita la duplicación.
 * - No inventa cadenas artificiales como "Unknown Artist" o "Untitled Track" cuando los datos faltan.
 */
export function resolveTrackArtistAndTitle(
  rawArtist?: string,
  rawTitle?: string
): { artist: string; title: string } {
  let title = (rawTitle || '').trim();
  let artist = (rawArtist || '').trim();

  // Limpiar comodines preexistentes para no propagar datos inventados
  if (/^unknown(\s+artist)?$/i.test(artist)) {
    artist = '';
  }
  if (/^untitled(\s+track)?$/i.test(title)) {
    title = '';
  }

  // Caso 1: Artista ausente con título compuesto "Artista - Título"
  if (!artist && title) {
    const separatorMatch = title.match(/\s+[-–—]\s+/);
    if (separatorMatch && separatorMatch.index !== undefined) {
      const parsedArtist = title.slice(0, separatorMatch.index).trim();
      const parsedTitle = title.slice(separatorMatch.index + separatorMatch[0].length).trim();
      if (parsedArtist && parsedTitle) {
        artist = parsedArtist;
        title = parsedTitle;
      }
    }
  } else if (artist && title) {
    // Caso 2: Artista presente pero duplicado dentro del título "Artista - Título"
    const separatorMatch = title.match(/\s+[-–—]\s+/);
    if (separatorMatch && separatorMatch.index !== undefined) {
      const prefix = title.slice(0, separatorMatch.index).trim();
      if (prefix.toLowerCase() === artist.toLowerCase()) {
        const remaining = title.slice(separatorMatch.index + separatorMatch[0].length).trim();
        if (remaining) {
          title = remaining;
        }
      }
    }
  }

  return { artist, title };
}

/**
 * Extrae de forma segura y estricta solo los metadatos musicales necesarios.
 * Nunca incluye AudioBuffers, blobs binarios, datos de waveform ni archivos en memoria.
 * No inventa artistas ni títulos cuando los datos están ausentes.
 */
export function extractCandidateMetadata(track: Track): TrackCandidateMetadata {
  const { artist, title } = resolveTrackArtistAndTitle(track.artist, track.title);
  const isAnalyzed = track.analysis?.status === 'analyzed';
  const bpm = isAnalyzed && Number.isFinite(track.analysis?.bpm) && (track.analysis?.bpm ?? 0) > 0
    ? track.analysis?.bpm
    : undefined;
  const rawKey = isAnalyzed ? track.analysis?.key : undefined;
  const rawCamelot = isAnalyzed ? track.analysis?.camelot : undefined;
  const camelot = keyToCamelot(rawCamelot || rawKey || '');
  const rawEnergy = isAnalyzed ? track.analysis?.energy : undefined;
  const energy = typeof rawEnergy === 'number' && Number.isFinite(rawEnergy) && rawEnergy >= 0 && rawEnergy <= 10
    ? rawEnergy
    : undefined;

  return {
    id: track.id,
    title,
    artist,
    bpm,
    key: camelot ? rawKey : undefined,
    camelot,
    energy,
    isAnalysisVerified: Boolean(
      isAnalyzed &&
      bpm !== undefined &&
      camelot !== undefined
    ),
  };
}

/**
 * Evalúa localmente la compatibilidad armónica basada en la rueda Camelot.
 * Reglas de mezcla armónica DJ:
 * 1. Misma tonalidad (mismo código Camelot).
 * 2. Tonalidad relativa mayor/menor (mismo número, diferente letra A/B).
 * 3. Tonalidad vecina / adyacente (misma letra, ±1 hora cíclica en 1..12).
 * Cualquier otra relación se dictamina como incompatible.
 * Si falta información, devuelve relation = 'unknown' sin inventar compatibilidad.
 */
export function evaluateHarmonicCompatibility(
  refKeyOrCamelot?: string,
  candKeyOrCamelot?: string
): HarmonicEvaluation {
  const codeA = refKeyOrCamelot ? keyToCamelot(refKeyOrCamelot) : undefined;
  const codeB = candKeyOrCamelot ? keyToCamelot(candKeyOrCamelot) : undefined;

  if (!codeA || !codeB) {
    return {
      compatible: null,
      relation: 'unknown',
      description: 'Tonalidad no disponible para comprobar compatibilidad armónica.',
      harmonicScore: null,
    };
  }

  if (codeA === codeB) {
    return {
      compatible: true,
      relation: 'same_key',
      description: `Misma tonalidad armónica (${codeA}).`,
      harmonicScore: 100,
    };
  }

  const numA = parseInt(codeA.slice(0, -1), 10);
  const letterA = codeA.slice(-1) as 'A' | 'B';
  const numB = parseInt(codeB.slice(0, -1), 10);
  const letterB = codeB.slice(-1) as 'A' | 'B';

  // Mismo número, diferente letra: relativo mayor/menor
  if (numA === numB && letterA !== letterB) {
    const relName = letterA === 'A' ? 'relativa mayor' : 'relativa menor';
    return {
      compatible: true,
      relation: 'relative',
      description: `Tonalidad ${relName} (${codeB}).`,
      harmonicScore: 95,
    };
  }

  // Misma letra, número adyacente (+1 o -1 cíclico en la rueda 1..12)
  if (letterA === letterB) {
    const diff = Math.abs(numA - numB);
    if (diff === 1 || diff === 11) {
      return {
        compatible: true,
        relation: 'adjacent',
        description: `Tonalidad vecina en rueda Camelot (${codeB}).`,
        harmonicScore: 88,
      };
    }
  }

  return {
    compatible: false,
    relation: 'incompatible',
    description: `Tonalidades incompatibles en rueda Camelot (${codeA} vs ${codeB}).`,
    harmonicScore: 30,
  };
}

/**
 * Evalúa localmente la compatibilidad de tempo respetando el límite estricto de pitch (±8%).
 * Calcula el ajuste de pitch requerido sobre la pista candidata para empatar a la referencia.
 * Identifica medio tiempo y doble tiempo únicamente cuando se justifiquen matemáticamente,
 * advirtiendo que no garantizan una mezcla automática.
 */
export function evaluateTempoCompatibility(
  refBpm?: number,
  candBpm?: number
): TempoEvaluation {
  if (
    typeof refBpm !== 'number' ||
    typeof candBpm !== 'number' ||
    !Number.isFinite(refBpm) ||
    !Number.isFinite(candBpm) ||
    refBpm <= 0 ||
    candBpm <= 0
  ) {
    return {
      compatible: null,
      relation: 'unknown',
      description: 'BPM no disponible para validar tempo.',
      tempoScore: null,
    };
  }

  // BPM iguales o prácticamente idénticos (< 0.05 de diferencia)
  if (Math.abs(refBpm - candBpm) < 0.05) {
    return {
      compatible: true,
      relation: 'exact',
      pitchShiftPercent: 0,
      description: `Tempo idéntico (${refBpm.toFixed(1)} BPM). No requiere ajuste de pitch.`,
      tempoScore: 100,
    };
  }

  // Ajuste de fader requerido en la pista candidata:
  // requiredRate = refBpm / candBpm
  // pitchShift = ((refBpm - candBpm) / candBpm) * 100
  const pitchShift = ((refBpm - candBpm) / candBpm) * 100;
  const roundedShift = Number(pitchShift.toFixed(1));

  // Comprobar si está dentro del límite de pitch de SYSTEM DJ (±8%)
  if (Math.abs(pitchShift) <= PITCH_LIMIT_PERCENT) {
    const score = Math.max(70, Math.round(100 - Math.abs(pitchShift) * 3.5));
    const sign = roundedShift > 0 ? '+' : '';
    return {
      compatible: true,
      relation: 'in_range',
      pitchShiftPercent: roundedShift,
      description: `Ajuste de pitch de ${sign}${roundedShift}%, dentro del límite de ±8% del fader.`,
      tempoScore: score,
    };
  }

  // Comprobar alternativa de medio tiempo (la pista candidata tiene aproximadamente el doble de tempo)
  const halfCandBpm = candBpm / 2;
  const halfPitchShift = ((refBpm - halfCandBpm) / halfCandBpm) * 100;
  if (Math.abs(halfPitchShift) <= PITCH_LIMIT_PERCENT) {
    return {
      compatible: true,
      relation: 'half_time',
      pitchShiftPercent: Number(halfPitchShift.toFixed(1)),
      effectiveBpm: Number(halfCandBpm.toFixed(1)),
      description: `Alternativa de medio tiempo (${candBpm.toFixed(1)} BPM → ~${halfCandBpm.toFixed(1)} BPM efectivo). Requiere evaluar compás y estilo; no es automática.`,
      tempoScore: 78,
    };
  }

  // Comprobar alternativa de doble tiempo (la pista candidata tiene aproximadamente la mitad de tempo)
  const doubleCandBpm = candBpm * 2;
  const doublePitchShift = ((refBpm - doubleCandBpm) / doubleCandBpm) * 100;
  if (Math.abs(doublePitchShift) <= PITCH_LIMIT_PERCENT) {
    return {
      compatible: true,
      relation: 'double_time',
      pitchShiftPercent: Number(doublePitchShift.toFixed(1)),
      effectiveBpm: Number(doubleCandBpm.toFixed(1)),
      description: `Alternativa de doble tiempo (${candBpm.toFixed(1)} BPM → ~${doubleCandBpm.toFixed(1)} BPM efectivo). Requiere evaluar compás y estilo; no es automática.`,
      tempoScore: 78,
    };
  }

  // Fuera del rango de pitch de ±8%
  const diffPercent = Number((((candBpm - refBpm) / refBpm) * 100).toFixed(1));
  const sign = roundedShift > 0 ? '+' : '';
  return {
    compatible: false,
    relation: 'out_of_range',
    pitchShiftPercent: roundedShift,
    description: `Diferencia de BPM excesiva (${candBpm.toFixed(1)} vs ${refBpm.toFixed(1)} BPM, cambio del ${Math.abs(diffPercent)}%, ajuste ${sign}${roundedShift}%), fuera del rango de pitch de ±8%.`,
    tempoScore: 25,
  };
}

/**
 * Calcula la puntuación técnica de compatibilidad validada mediante criterios objetivos y verificables:
 * 1. Doble incompatibilidad estricta: tempo fuera de ±8% Y claves armónicas incompatibles en Camelot -> 0%.
 *    (Beatmatching imposible por hardware y armonía disonante; cero viabilidad de mezcla tradicional).
 * 2. Tempo fuera de ±8% pero armonía compatible -> puntuación armónica escalada al 35% máx (drop mix / corte).
 * 3. Armonía incompatible pero tempo en rango -> puntuación de tempo escalada al 35% máx (intro/outro percusivo EQ).
 * 4. Metadatos faltantes (tonalidad o BPM desconocido) -> no inventa factores no verificados, escala máx 50%.
 * 5. Ambos compatibles -> 50% tempo + 50% armonía (técnico base). El proveedor no participa en el score.
 */
export function calculateValidatedScore(
  harmonic: HarmonicEvaluation,
  tempo: TempoEvaluation
): number | null {
  // Missing metrics are handled before compatibility penalties: absence of a key
  // cannot be treated as either compatible or incompatible harmony.
  if (harmonic.relation === 'unknown') {
    return tempo.tempoScore === null ? null : Math.round(tempo.tempoScore * 0.5);
  }
  if (tempo.relation === 'unknown') {
    return harmonic.harmonicScore === null ? null : Math.round(harmonic.harmonicScore * 0.5);
  }

  // 1. Doble incompatibilidad estricta: tempo fuera de ±8% Y armonía incompatible en rueda Camelot
  if (tempo.relation === 'out_of_range' && harmonic.relation === 'incompatible') {
    return 0;
  }

  // 2. Tempo fuera de rango (pitch > ±8%), pero armonía compatible:
  // Beatmatching inviable; transición técnica limitada a drop mix, corte o transición armónica por fade.
  // Ponderación verificable: 35% del potencial armónico local comprobado.
  if (tempo.relation === 'out_of_range') {
    const harmonicPotential = harmonic.harmonicScore;
    if (harmonicPotential === null) return null;
    return Math.round(harmonicPotential * 0.35); // 100 -> 35, 95 -> 33, 88 -> 31
  }

  // 3. Armonía incompatible, pero tempo dentro del rango de pitch (±8%):
  // Mezcla de melodías disonante; transición técnica viable en intro/outro percusivo mediante EQ swap.
  // Ponderación verificable: 35% del potencial de tempo local comprobado.
  if (harmonic.relation === 'incompatible') {
    const tempoPotential = tempo.tempoScore;
    if (tempoPotential === null) return null;
    return Math.round(tempoPotential * 0.35); // 100 -> 35, 78 -> 27, 70 -> 25
  }

  // 4. Si falta la tonalidad, NO inventar puntuación armónica (evaluar solo tempo verificado, máx 50%)
  // 5. Si falta el BPM pero la armonía es válida (evaluar solo armonía verificada, máx 50%)
  // 6. Ambos son compatibles
  const harmonicComponent = harmonic.harmonicScore;
  const tempoComponent = tempo.tempoScore;
  if (harmonicComponent === null || tempoComponent === null) return null;
  const baseCalculated = Math.round(harmonicComponent * 0.5 + tempoComponent * 0.5);

  return Math.max(65, Math.min(99, baseCalculated));
}

function getEvidenceStatus(
  harmonic: HarmonicEvaluation,
  tempo: TempoEvaluation
): RecommendationEvidenceStatus {
  return harmonic.relation === 'unknown' || tempo.relation === 'unknown' ? 'partial' : 'complete';
}

function hasInsufficientEvidence(
  reference: TrackCandidateMetadata,
  candidate: TrackCandidateMetadata
): boolean {
  return evaluateHarmonicCompatibility(reference.camelot || reference.key, candidate.camelot || candidate.key).relation === 'unknown' &&
    evaluateTempoCompatibility(reference.bpm, candidate.bpm).relation === 'unknown';
}

/** Replaces unverified free-form provider claims with the locally calculated evidence. */
export function sanitizeJustification(
  _rawJustification: string,
  harmonic: HarmonicEvaluation,
  tempo: TempoEvaluation
): string {
  // Text from a model is not evidence. Always show the local calculation so any
  // unparsed phrasing or numerical claim is replaced with verified metrics.
  return `[Validación técnica SYSTEM DJ] ${harmonic.description} ${tempo.description}`;
}

function createTechnicalTransitionSuggestion(
  harmonic: HarmonicEvaluation,
  tempo: TempoEvaluation
): string {
  if (harmonic.relation === 'unknown' || tempo.relation === 'unknown') {
    const missing: string[] = [];
    if (harmonic.relation === 'unknown') missing.push('tonalidad');
    if (tempo.relation === 'unknown') missing.push('BPM');
    return `Falta validar ${missing.join(' y ')} en el análisis local antes de elegir una técnica de transición.`;
  }

  if (harmonic.relation === 'incompatible' || tempo.relation === 'out_of_range') {
    return 'Transición compleja según la validación local: considera un drop mix, corte o mezcla rápida con eco.';
  }

  return 'Alinea tiempos de compás y modula el crossfader suavemente; la recomendación no activa controles automáticamente.';
}

/**
 * Generador heurístico de recomendaciones simuladas (Mock).
 * Utilizado para pruebas locales y entornos sin conexión.
 * Cada recomendación generada por este método queda identificada explícitamente con isMock = true
 * y respaldada por cálculos musicales verificables.
 */
export function generateMockRecommendations(
  reference: TrackCandidateMetadata,
  candidates: TrackCandidateMetadata[]
): TrackRecommendation[] {
  const filtered = candidates.filter((c) => c.id !== reference.id);
  if (filtered.length === 0) return [];

  const scored = filtered.map((cand) => {
    const { artist, title } = resolveTrackArtistAndTitle(cand.artist, cand.title);
    const harmonicEval = evaluateHarmonicCompatibility(
      reference.camelot || reference.key,
      cand.camelot || cand.key
    );
    const tempoEval = evaluateTempoCompatibility(reference.bpm, cand.bpm);
    const score = calculateValidatedScore(harmonicEval, tempoEval);

    const justification = `[SIMULACIÓN] ${harmonicEval.description} ${tempoEval.description}`;
    const transitionSuggestion = `[SIMULACIÓN] ${createTechnicalTransitionSuggestion(harmonicEval, tempoEval)}`;

    return {
      trackId: cand.id,
      title,
      artist,
      bpm: cand.bpm,
      key: cand.key,
      camelot: cand.camelot as MusicalKeyCamelot | undefined,
      energy: cand.energy,
      compatibilityScore: score,
      evidenceStatus: getEvidenceStatus(harmonicEval, tempoEval),
      justification,
      transitionSuggestion,
      isMock: true,
      isAnalysisVerified: cand.isAnalysisVerified ?? (cand.bpm !== undefined && cand.key !== undefined),
      harmonicEvaluation: harmonicEval,
      tempoEvaluation: tempoEval,
    };
  });

  // Ordenar por puntuación descendente y tomar hasta 3
  return scored
    .filter((recommendation) => recommendation.compatibilityScore !== null && recommendation.compatibilityScore > 0)
    .sort((a, b) => (b.compatibilityScore ?? -1) - (a.compatibilityScore ?? -1))
    .slice(0, 3);
}

export interface RecommendationServiceOptions {
  /** Compatibility option: remote mode adds explanations after local scoring only. */
  mode?: 'local' | 'remote';
  forceMock?: boolean;
  endpointUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Solicita recomendaciones inteligentes para una pista de referencia analizada frente a las
 * pistas disponibles en la biblioteca.
 */
export async function getTrackRecommendations(
  referenceTrack: Track,
  candidateTracks: Track[],
  options: RecommendationServiceOptions = {}
): Promise<AIRecommendationResponse> {
  const {
    mode = 'local',
    forceMock = false,
    endpointUrl = '/api/ai/explanations',
    timeoutMs = 15000,
    signal,
  } = options;

  // Filtrar candidatos para excluir la pista de referencia
  const validCandidates = candidateTracks.filter((t) => t.id !== referenceTrack.id);

  const refMeta = extractCandidateMetadata(referenceTrack);
  if (!refMeta.isAnalysisVerified || typeof refMeta.bpm !== 'number' || !(refMeta.camelot || refMeta.key)) {
    return {
      success: true,
      recommendations: [],
      isMock: false,
      warning: 'La pista de referencia necesita un análisis verificado de BPM y tonalidad antes de generar recomendaciones.',
    };
  }

  if (validCandidates.length === 0) {
    return {
      success: true,
      recommendations: [],
      isMock: false,
      warning: 'No hay suficientes pistas candidatas en la biblioteca para comparar.',
    };
  }

  const candMetas = validCandidates.map(extractCandidateMetadata);
  const insufficientCandidateCount = candMetas.filter((candidate) => hasInsufficientEvidence(refMeta, candidate)).length;

  const localRecommendations = generateMockRecommendations(refMeta, candMetas);
  const localResult: AIRecommendationResponse = {
    success: true,
    recommendations: localRecommendations,
    insufficientCandidateCount,
    isMock: true,
    model: 'local-deterministic-engine',
  };

  if (forceMock || mode === 'local' || localRecommendations.length === 0) return localResult;

  const explanationResult = await getTrackRecommendationExplanations(
    refMeta,
    localRecommendations,
    { endpointUrl, timeoutMs, signal }
  );
  if (!explanationResult.success) {
    return { ...localResult, warning: explanationResult.warning };
  }

  const byId = new Map(explanationResult.explanations.map(({ trackId, text }) => [trackId, text]));
  return {
    ...localResult,
    recommendations: localRecommendations.map((recommendation) => ({
      ...recommendation,
      ...(byId.has(recommendation.trackId) ? { aiExplanation: byId.get(recommendation.trackId) } : {}),
    })),
    warning: explanationResult.warning,
  };
}

const MAX_EXPLANATION_LENGTH = 600;

/** Keep provider output plain, bounded, and safe to render as text in React. */
export function sanitizeRecommendationExplanation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const sanitized = Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return !(code < 32 && code !== 9 && code !== 10 && code !== 13) && code !== 127;
    })
    .join('')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .trim()
    .slice(0, MAX_EXPLANATION_LENGTH)
    .trim();
  return sanitized || null;
}

/** Enrich the already selected local list without changing membership, order, or any local field. */
export function applyRecommendationExplanations(
  localRecommendations: TrackRecommendation[],
  explanations: unknown
): TrackRecommendation[] {
  if (!Array.isArray(explanations)) return localRecommendations;
  const allowed = new Set(localRecommendations.map(({ trackId }) => trackId));
  const explanationById = new Map<string, string>();
  for (const item of explanations) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as { trackId?: unknown; text?: unknown };
    if (typeof record.trackId !== 'string' || !allowed.has(record.trackId) || explanationById.has(record.trackId)) continue;
    const text = sanitizeRecommendationExplanation(record.text);
    if (text) explanationById.set(record.trackId, text);
  }
  return localRecommendations.map((recommendation) => {
    const explanation = explanationById.get(recommendation.trackId);
    return explanation ? { ...recommendation, aiExplanation: explanation } : recommendation;
  });
}

export interface RecommendationExplanationOptions {
  endpointUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type ExplanationTrackPayload = Pick<
  TrackCandidateMetadata,
  'id' | 'title' | 'artist' | 'bpm' | 'key' | 'camelot' | 'energy'
>;

/**
 * Ask Gemini to explain already selected local results. This function never
 * returns or changes compatibility scores, recommendation membership, or order.
 */
export async function getTrackRecommendationExplanations(
  reference: TrackCandidateMetadata,
  recommendations: TrackRecommendation[],
  options: RecommendationExplanationOptions = {}
): Promise<AIExplanationResponse> {
  const { endpointUrl = '/api/ai/explanations', timeoutMs = 15000, signal } = options;
  if (recommendations.length === 0) return { success: true, explanations: [] };
  if (signal?.aborted) {
    return { success: false, explanations: [], errorCode: 'cancelled' };
  }

  const allowed = new Set(recommendations.map(({ trackId }) => trackId));
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceTrack: explanationMetadata(reference),
        recommendations: recommendations.map(explanationMetadata),
      }),
      signal: requestSignal,
    });

    // Keep the timeout active through full body consumption, not only headers.
    const responseText = await response.text();
    if (!response.ok) {
      return {
        success: false,
        explanations: [],
        errorCode: response.status === 429 ? 'quota_exceeded' : response.status === 503 ? 'missing_api_key' : 'server_error',
        warning: response.status === 429 ? 'quota' : response.status === 503 ? 'not_configured' : 'provider_error',
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return { success: false, explanations: [], errorCode: 'invalid_response', warning: 'invalid_response' };
    }

    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { explanations?: unknown }).explanations)) {
      return { success: false, explanations: [], errorCode: 'invalid_response', warning: 'invalid_response' };
    }

    const explanations: AIExplanationResponse['explanations'] = [];
    const seen = new Set<string>();
    for (const entry of (payload as { explanations: unknown[] }).explanations) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const candidate = entry as { trackId?: unknown; text?: unknown };
      if (typeof candidate.trackId !== 'string' || !allowed.has(candidate.trackId) || seen.has(candidate.trackId)) continue;
      const text = sanitizeRecommendationExplanation(candidate.text);
      if (!text) continue;
      seen.add(candidate.trackId);
      explanations.push({ trackId: candidate.trackId, text });
    }

    if (explanations.length === 0) {
      return { success: false, explanations: [], errorCode: 'empty_response', warning: 'empty_response' };
    }

    const missingCount = recommendations.length - explanations.length;
    return {
      success: true,
      explanations,
      ...(missingCount > 0 ? { warning: 'partial_response' } : {}),
    };
  } catch {
    if (signal?.aborted) return { success: false, explanations: [], errorCode: 'cancelled' };
    return {
      success: false,
      explanations: [],
      errorCode: timedOut ? 'timeout' : 'network_error',
      warning: timedOut ? 'timeout' : 'unavailable',
    };
  } finally {
    clearTimeout(timer);
  }
}

function explanationMetadata(track: TrackCandidateMetadata | TrackRecommendation): ExplanationTrackPayload {
  const id = 'trackId' in track ? track.trackId : track.id;
  return {
    id,
    title: track.title,
    artist: track.artist,
    ...(typeof track.bpm === 'number' ? { bpm: track.bpm } : {}),
    ...(track.key ? { key: track.key } : {}),
    ...(track.camelot ? { camelot: track.camelot } : {}),
    ...(typeof track.energy === 'number' ? { energy: track.energy } : {}),
  };
}
