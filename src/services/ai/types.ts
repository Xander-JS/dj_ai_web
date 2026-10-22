/**
 * SYSTEM DJ — Smart Track Recommendation Types
 * Tipos tipados para el servicio de recomendación musical inteligente asistido por IA (Gemini).
 */

import type { MusicalKeyCamelot } from '../../types/track.ts';

export interface TrackCandidateMetadata {
  id: string;
  title: string;
  artist: string;
  bpm?: number;
  key?: string;
  camelot?: MusicalKeyCamelot;
  energy?: number;
  isAnalysisVerified?: boolean;
}

export type HarmonicRelationType =
  | 'same_key'
  | 'relative'
  | 'adjacent'
  | 'incompatible'
  | 'unknown';

export type TempoRelationType =
  | 'exact'
  | 'in_range'
  | 'half_time'
  | 'double_time'
  | 'out_of_range'
  | 'unknown';

export interface HarmonicEvaluation {
  compatible: boolean | null; // null si la tonalidad es desconocida
  relation: HarmonicRelationType;
  description: string;
  harmonicScore: number | null;
}

export interface TempoEvaluation {
  compatible: boolean | null; // null si el BPM es desconocido
  relation: TempoRelationType;
  pitchShiftPercent?: number;  // Porcentaje de pitch shift requerido en la pista recomendada
  effectiveBpm?: number;       // BPM efectivo en casos de medio tiempo o doble tiempo
  description: string;
  tempoScore: number | null;
}

export interface TrackRecommendation {
  trackId: string;
  title: string;
  artist: string;
  bpm?: number;
  key?: string;
  camelot?: MusicalKeyCamelot;
  energy?: number;
  compatibilityScore: number | null; // null cuando no hay datos para calcular compatibilidad
  justification: string;       // Razón musical verificada (armonía, tempo, energía)
  transitionSuggestion: string; // Sugerencia práctica de técnica de transición
  isMock: boolean;             // Indica explícitamente si procede de simulación o de llamada real a Gemini
  isAnalysisVerified?: boolean; // Indica explícitamente si BPM, Key y Energía provienen de análisis local verificado
  harmonicEvaluation?: HarmonicEvaluation;
  tempoEvaluation?: TempoEvaluation;
}

export interface TrackRecommendationRequest {
  referenceTrack: TrackCandidateMetadata;
  candidateTracks: TrackCandidateMetadata[];
  forceMock?: boolean;
}

export type AIRecommendationErrorCode =
  | 'quota_exceeded'
  | 'auth_error'
  | 'network_error'
  | 'timeout'
  | 'empty_response'
  | 'invalid_response'
  | 'server_error';

export interface AIRecommendationResponse {
  success: boolean;
  recommendations: TrackRecommendation[];
  isMock: boolean;
  model?: string;
  warning?: string;
  error?: string;
  errorCode?: AIRecommendationErrorCode;
  details?: string;
}

