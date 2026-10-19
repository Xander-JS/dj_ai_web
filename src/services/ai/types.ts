/**
 * SYSTEM DJ — Smart Track Recommendation Types
 * Tipos tipados para el servicio de recomendación musical inteligente asistido por IA (Gemini).
 */

import type { MusicalKeyCamelot } from '../../types/track';

export interface TrackCandidateMetadata {
  id: string;
  title: string;
  artist: string;
  bpm?: number;
  key?: string;
  camelot?: MusicalKeyCamelot;
  energy?: number;
}

export interface TrackRecommendation {
  trackId: string;
  title: string;
  artist: string;
  bpm?: number;
  key?: string;
  camelot?: MusicalKeyCamelot;
  energy?: number;
  compatibilityScore: number; // Escala 1 a 100
  justification: string;       // Razón musical comprensible (armonía, tempo, energía)
  transitionSuggestion: string; // Sugerencia práctica de técnica de transición
  isMock: boolean;             // Indica explícitamente si procede de simulación o de llamada real a Gemini
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

