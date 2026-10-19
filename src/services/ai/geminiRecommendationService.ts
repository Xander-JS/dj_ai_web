/**
 * SYSTEM DJ — Gemini AI Recommendation Service
 * Servicio cliente para solicitar recomendaciones inteligentes de pistas y sugerencias de mezcla.
 * Se comunica exclusivamente con el endpoint local del servidor de desarrollo (/api/ai/recommendations)
 * sin exponer jamás la API key al cliente.
 */

import type { Track, MusicalKeyCamelot } from '../../types/track';
import type {
  TrackCandidateMetadata,
  TrackRecommendation,
  AIRecommendationResponse,
} from './types';

/**
 * Extrae de forma segura y estricta solo los metadatos musicales necesarios.
 * Nunca incluye AudioBuffers, blobs binarios, datos de waveform ni archivos en memoria.
 */
export function extractCandidateMetadata(track: Track): TrackCandidateMetadata {
  return {
    id: track.id,
    title: track.title || 'Untitled Track',
    artist: track.artist || 'Unknown Artist',
    bpm: track.analysis?.bpm,
    key: track.analysis?.key,
    camelot: track.analysis?.camelot,
    energy: track.analysis?.energy,
  };
}

/**
 * Generador heurístico de recomendaciones simuladas (Mock).
 * Utilizado para pruebas locales, entornos sin conexión o cuando GEMINI_API_KEY no está disponible.
 * Cada recomendación generada por este método queda identificada explícitamente con isMock = true.
 */
export function generateMockRecommendations(
  reference: TrackCandidateMetadata,
  candidates: TrackCandidateMetadata[]
): TrackRecommendation[] {
  const filtered = candidates.filter((c) => c.id !== reference.id);
  if (filtered.length === 0) return [];

  // Ponderación determinista basada en proximidad de BPM y presencia de clave armónica
  const scored = filtered.map((cand, idx) => {
    const refBpm = reference.bpm || 124;
    const candBpm = cand.bpm || 124;
    const bpmDiff = Math.abs(refBpm - candBpm);
    const bpmScore = Math.max(0, 100 - bpmDiff * 4);

    const hasSameKey = cand.camelot && reference.camelot && cand.camelot === reference.camelot;
    const harmonicScore = hasSameKey ? 100 : cand.camelot ? 85 : 70;

    const totalScore = Math.round(bpmScore * 0.5 + harmonicScore * 0.5 - idx * 2);
    const clampedScore = Math.max(65, Math.min(99, totalScore));

    const keyLabel = cand.camelot || cand.key || 'armonía estándar';
    const bpmNote = `${cand.bpm ? `${cand.bpm} BPM` : 'tempo compatible'}`;

    return {
      trackId: cand.id,
      title: cand.title,
      artist: cand.artist,
      bpm: cand.bpm,
      key: cand.key,
      camelot: cand.camelot as MusicalKeyCamelot | undefined,
      energy: cand.energy,
      compatibilityScore: clampedScore,
      justification: `[SIMULACIÓN] Proximidad armónica en ${keyLabel} y tempo cercano a ${bpmNote}.`,
      transitionSuggestion: `[SIMULACIÓN] Realiza transición en el compás 32 intercambiando frecuencias bajas progresivamente.`,
      isMock: true,
    };
  });

  // Ordenar por puntuación descendente y tomar hasta 3
  return scored.sort((a, b) => b.compatibilityScore - a.compatibilityScore).slice(0, 3);
}

/**
 * Valida la respuesta del endpoint y asegura que ningún ID alucinado por el modelo sea presentado.
 */
export function validateRecommendations(
  rawList: unknown,
  candidates: TrackCandidateMetadata[],
  isMock: boolean
): TrackRecommendation[] {
  if (!Array.isArray(rawList)) return [];

  const candidateMap = new Map<string, TrackCandidateMetadata>(
    candidates.map((c) => [c.id, c])
  );

  const validated: TrackRecommendation[] = [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;

    const cand = item as Record<string, unknown>;
    const trackId = typeof cand.trackId === 'string' ? cand.trackId : '';

    if (!trackId || !candidateMap.has(trackId)) {
      // Ignorar IDs que no existen en los candidatos enviados
      continue;
    }

    const original = candidateMap.get(trackId)!;
    const score = typeof cand.compatibilityScore === 'number'
      ? Math.max(1, Math.min(100, Math.round(cand.compatibilityScore)))
      : 80;

    validated.push({
      trackId,
      title: original.title,
      artist: original.artist,
      bpm: original.bpm,
      key: original.key,
      camelot: original.camelot,
      energy: original.energy,
      compatibilityScore: score,
      justification: typeof cand.justification === 'string' && cand.justification.trim()
        ? cand.justification.trim()
        : 'Compatibilidad evaluada según BPM y clave armónica.',
      transitionSuggestion: typeof cand.transitionSuggestion === 'string' && cand.transitionSuggestion.trim()
        ? cand.transitionSuggestion.trim()
        : 'Alinea tiempos de compás y modula el crossfader suavemente.',
      isMock,
    });

    if (validated.length >= 3) break;
  }

  return validated;
}

export interface RecommendationServiceOptions {
  forceMock?: boolean;
  endpointUrl?: string;
  timeoutMs?: number;
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
    forceMock = false,
    endpointUrl = '/api/ai/recommendations',
    timeoutMs = 15000,
  } = options;

  // Filtrar candidatos para excluir la pista de referencia
  const validCandidates = candidateTracks.filter((t) => t.id !== referenceTrack.id);

  if (validCandidates.length === 0) {
    return {
      success: true,
      recommendations: [],
      isMock: false,
      warning: 'No hay suficientes pistas candidatas en la biblioteca para comparar.',
    };
  }

  const refMeta = extractCandidateMetadata(referenceTrack);
  const candMetas = validCandidates.map(extractCandidateMetadata);

  if (forceMock) {
    return {
      success: true,
      recommendations: generateMockRecommendations(refMeta, candMetas),
      isMock: true,
      model: 'local-heuristic-simulator',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        referenceTrack: refMeta,
        candidateTracks: candMetas,
        forceMock: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorMsg = data?.error || `Error del servidor HTTP ${response.status}`;
      const errorCode = data?.errorCode || (
        response.status === 429
          ? 'quota_exceeded'
          : response.status === 401 || response.status === 403
          ? 'auth_error'
          : response.status === 504
          ? 'timeout'
          : 'server_error'
      );
      return {
        success: false,
        errorCode,
        recommendations: [],
        isMock: false,
        error: errorMsg,
        details: data?.details,
      };
    }

    const isMock = Boolean(data.isMock);
    const validatedRecs = validateRecommendations(data.recommendations, candMetas, isMock);

    return {
      success: true,
      recommendations: validatedRecs,
      isMock,
      model: data.model || (isMock ? 'mock' : 'gemini-2.5-flash'),
      warning: data.warning,
    };
  } catch (err: unknown) {
    clearTimeout(timer);
    const error = err as { name?: string; message?: string };
    const isTimeout = error?.name === 'AbortError';
    const isNetwork = error?.name === 'TypeError' || error?.message?.includes('fetch failed');
    const errorCode = isTimeout ? 'timeout' : isNetwork ? 'network_error' : 'server_error';

    return {
      success: false,
      errorCode,
      recommendations: [],
      isMock: false,
      error: isTimeout
        ? 'Tiempo de espera agotado al conectar con el servicio de IA (15s).'
        : 'Fallo de conexión con el endpoint local de recomendaciones.',
      details: error?.message || String(err),
    };
  }
}
