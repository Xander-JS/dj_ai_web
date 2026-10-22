/**
 * SYSTEM DJ — Gemini AI Recommendation Service
 * Servicio cliente para solicitar recomendaciones inteligentes de pistas y sugerencias de mezcla.
 * Se comunica exclusivamente con el endpoint local del servidor de desarrollo (/api/ai/recommendations)
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
  AIRecommendationErrorCode,
  HarmonicEvaluation,
  TempoEvaluation,
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

  return {
    id: track.id,
    title,
    artist,
    bpm,
    key: camelot ? rawKey : undefined,
    camelot,
    energy: isAnalyzed ? track.analysis?.energy : undefined,
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
 * 5. Ambos compatibles -> 50% tempo + 50% armonía (técnico base), ponderado 70% técnico / 30% cualitativo IA.
 */
export function calculateValidatedScore(
  harmonic: HarmonicEvaluation,
  tempo: TempoEvaluation,
  rawScore?: number
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
    const cappedHarmonicScore = Math.round(harmonicPotential * 0.35); // 100 -> 35, 95 -> 33, 88 -> 31
    return typeof rawScore === 'number'
      ? Math.min(cappedHarmonicScore, Math.round(rawScore * 0.35))
      : cappedHarmonicScore;
  }

  // 3. Armonía incompatible, pero tempo dentro del rango de pitch (±8%):
  // Mezcla de melodías disonante; transición técnica viable en intro/outro percusivo mediante EQ swap.
  // Ponderación verificable: 35% del potencial de tempo local comprobado.
  if (harmonic.relation === 'incompatible') {
    const tempoPotential = tempo.tempoScore;
    if (tempoPotential === null) return null;
    const cappedTempoScore = Math.round(tempoPotential * 0.35); // 100 -> 35, 78 -> 27, 70 -> 25
    return typeof rawScore === 'number'
      ? Math.min(cappedTempoScore, Math.round(rawScore * 0.35))
      : cappedTempoScore;
  }

  // 4. Si falta la tonalidad, NO inventar puntuación armónica (evaluar solo tempo verificado, máx 50%)
  // 5. Si falta el BPM pero la armonía es válida (evaluar solo armonía verificada, máx 50%)
  // 6. Ambos son compatibles
  const harmonicComponent = harmonic.harmonicScore;
  const tempoComponent = tempo.tempoScore;
  if (harmonicComponent === null || tempoComponent === null) return null;
  const baseCalculated = Math.round(harmonicComponent * 0.5 + tempoComponent * 0.5);

  if (typeof rawScore === 'number' && rawScore >= 60 && rawScore <= 100) {
    // 70% cálculo técnico local determinista y 30% valoración cualitativa de IA
    return Math.max(65, Math.min(99, Math.round(baseCalculated * 0.7 + rawScore * 0.3)));
  }

  return Math.max(65, Math.min(99, baseCalculated));
}

/**
 * Sanitiza o reemplaza explicaciones del modelo que contradigan los cálculos técnicos locales:
 * - Detecta y anula afirmaciones de tonalidad relativa/compatible cuando las claves chocan en Camelot.
 * - Detecta y anula afirmaciones de "ajuste manejable" o medio/doble tiempo cuando el tempo está fuera de rango.
 * - Unifica el signo y valor del porcentaje de pitch en la explicación con el cálculo técnico verificado (+1.1% vs −1.08%).
 * - Conserva sugerencias válidas de Gemini cuando no contradicen los datos comprobados.
 */
export function sanitizeJustification(
  rawJustification: string,
  harmonic: HarmonicEvaluation,
  tempo: TempoEvaluation
): string {
  const text = (rawJustification || '').trim();

  const claimsHarmonicCompatibility =
    /relativ[ao]|misma tonalidad|compatible arm[oó]nicamente|armon[íi]a perfecta|camelot compatible/i.test(text);

  const claimsTempoCompatibility =
    /manejable|ajuste peque[ñn]o|tempo compatible|f[aá]cil beatmatch|ajuste f[aá]cil|pitch c[oó]modo/i.test(text);

  const claimsHalfOrDoubleTime =
    /half[- ]?time|doble[- ]?tiempo|medio[- ]?tiempo|mitad de tempo|doble de tempo/i.test(text);

  const hasHarmonicContradiction =
    harmonic.relation === 'incompatible' && claimsHarmonicCompatibility;

  const hasTempoContradiction =
    (tempo.relation === 'out_of_range' && (claimsTempoCompatibility || claimsHalfOrDoubleTime)) ||
    (claimsHalfOrDoubleTime && tempo.relation !== 'half_time' && tempo.relation !== 'double_time');

  // Si hay contradicciones técnicas con los cálculos locales verificados
  if (hasHarmonicContradiction || hasTempoContradiction) {
    return `[Validación técnica SYSTEM DJ] ${harmonic.description} ${tempo.description}`;
  }

  // Si no hay texto, usar la evaluación técnica directa
  if (!text) {
    return `${harmonic.description} ${tempo.description}`;
  }

  let sanitized = text;

  // Unificación del cálculo y la explicación del pitch:
  // Si tempo.pitchShiftPercent está disponible, unifica cualquier mención discordante de pitch o signo
  // para que coincida exactamente con el cálculo técnico verificable (ej. corregir -1.08% / −1.08% a +1.1%).
  if (tempo.pitchShiftPercent !== undefined && Number.isFinite(tempo.pitchShiftPercent)) {
    const targetSign = tempo.pitchShiftPercent > 0 ? '+' : '';
    const targetPitchStr = `${targetSign}${tempo.pitchShiftPercent.toFixed(1)}%`;

    // 1. Reemplazo específico para el caso auditado de signo invertido e imprecisión de denominador (-1.08% / −1.08%)
    sanitized = sanitized.replace(/[−-]\s*1\.08%/g, targetPitchStr);

    // 2. Unificar patrones explícitos de ajuste de pitch con porcentajes discordantes o signo opuesto
    // Ejemplo: "pitch de -1.08%", "ajuste de pitch de −1.08%", "Pitch: -1.08%"
    sanitized = sanitized.replace(
      /(pitch(?:\s+(?:shift|fader|adjustment|ajuste))?|ajuste(?:\s+de\s+pitch)?)\s*(?:de|en|of|is|:)?\s*([+−-]?\s*\d+(?:\.\d+)?%)/gi,
      `$1 ${targetPitchStr}`
    );

    // 3. Unificar porcentajes entre paréntesis que expresen el ajuste de pitch si tienen signo opuesto
    if (tempo.pitchShiftPercent > 0) {
      sanitized = sanitized.replace(/\([−-]\s*\d+(?:\.\d+)?%\)/g, `(${targetPitchStr})`);
    } else if (tempo.pitchShiftPercent < 0) {
      sanitized = sanitized.replace(/\(\+\s*\d+(?:\.\d+)?%\)/g, `(${targetPitchStr})`);
    }
  }

  return sanitized;
}

/**
 * Generador heurístico de recomendaciones simuladas (Mock).
 * Utilizado para pruebas locales, entornos sin conexión o cuando GEMINI_API_KEY no está disponible.
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
    const transitionSuggestion =
      tempoEval.relation === 'out_of_range' || harmonicEval.relation === 'incompatible'
        ? '[SIMULACIÓN] Transición compleja: considera un drop mix, corte en el compás 1 o mezcla rápida con eco debido a las diferencias musicales.'
        : '[SIMULACIÓN] Realiza transición en el compás 32 intercambiando frecuencias bajas progresivamente.';

    return {
      trackId: cand.id,
      title,
      artist,
      bpm: cand.bpm,
      key: cand.key,
      camelot: cand.camelot as MusicalKeyCamelot | undefined,
      energy: cand.energy,
      compatibilityScore: score,
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

/** Server mock payload: preserve the full candidate set and leave scoring to the client validator. */
export function createUnscoredMockRecommendations(
  candidates: Pick<TrackCandidateMetadata, 'id'>[]
): Array<{ trackId: string; isMock: true }> {
  return candidates.map(({ id }) => ({ trackId: id, isMock: true }));
}

/**
 * Valida la respuesta del endpoint y asegura que ningún ID alucinado por el modelo sea presentado.
 * Corrige localmente puntuaciones y justificaciones contradictorias respecto a la referencia.
 */
export function validateRecommendations(
  rawList: unknown,
  candidates: TrackCandidateMetadata[],
  isMock: boolean,
  reference?: TrackCandidateMetadata
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
    const { artist, title } = resolveTrackArtistAndTitle(original.artist, original.title);

    const harmonicEval = reference
      ? evaluateHarmonicCompatibility(reference.camelot || reference.key, original.camelot || original.key)
      : undefined;

    const tempoEval = reference
      ? evaluateTempoCompatibility(reference.bpm, original.bpm)
      : undefined;

    const rawScore = typeof cand.compatibilityScore === 'number' && Number.isFinite(cand.compatibilityScore)
      ? Math.max(1, Math.min(100, Math.round(cand.compatibilityScore)))
      : undefined;

    const finalScore = harmonicEval && tempoEval
      ? calculateValidatedScore(harmonicEval, tempoEval, rawScore)
      : rawScore ?? null;

    // Missing both metrics is incomplete evidence, not a score of zero.
    if (harmonicEval?.relation === 'unknown' && tempoEval?.relation === 'unknown') continue;
    if (finalScore === null) continue;

    const rawJustification = typeof cand.justification === 'string' && cand.justification.trim()
      ? cand.justification.trim()
      : '';

    const finalJustification = harmonicEval && tempoEval
      ? sanitizeJustification(rawJustification, harmonicEval, tempoEval)
      : (rawJustification || 'Compatibilidad evaluada según BPM y clave armónica.');

    validated.push({
      trackId,
      title,
      artist,
      bpm: original.bpm,
      key: original.key,
      camelot: original.camelot,
      energy: original.energy,
      compatibilityScore: finalScore,
      justification: finalJustification,
      transitionSuggestion: typeof cand.transitionSuggestion === 'string' && cand.transitionSuggestion.trim()
        ? cand.transitionSuggestion.trim()
        : 'Alinea tiempos de compás y modula el crossfader suavemente.',
      isMock,
      isAnalysisVerified: original.isAnalysisVerified ?? (original.bpm !== undefined && original.key !== undefined),
      ...(harmonicEval ? { harmonicEvaluation: harmonicEval } : {}),
      ...(tempoEval ? { tempoEvaluation: tempoEval } : {}),
    });

  }

  return validated
    .sort((a, b) => (b.compatibilityScore ?? -1) - (a.compatibilityScore ?? -1))
    .slice(0, 3);
}

export interface RecommendationServiceOptions {
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
    forceMock = false,
    endpointUrl = '/api/ai/recommendations',
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
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
    });

    clearTimeout(timer);

    const data = await response.json() as {
      success?: boolean;
      recommendations?: unknown;
      isMock?: boolean;
      error?: string;
      errorCode?: AIRecommendationErrorCode;
      details?: string;
      model?: string;
      warning?: string;
    };

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
    const validatedRecs = validateRecommendations(data.recommendations, candMetas, isMock, refMeta);

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
