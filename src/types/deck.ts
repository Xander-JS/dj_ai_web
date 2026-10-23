/**
 * SYSTEM DJ — Domain Model: Decks
 * Contratos y estados para las tornamesas digitales Deck A y Deck B.
 */

import type { Track, HotCue } from './track';

export type DeckId = 'A' | 'B';

export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'loading' | 'error';

export type PhaseAlignmentStatus =
  | 'idle'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'rejected_limits'
  | 'rejected_confidence'
  | 'rejected_state'
  | 'already_aligned';

export interface PhaseAlignmentState {
  status: PhaseAlignmentStatus;
  progressPercent: number;          // 0 a 100
  targetDisplacementSec?: number;   // Δx_target en segundos de buffer
  estimatedDurationSec?: number;    // T_slew en segundos
  deviationPercent?: number;        // δR_peak en porcentaje (ej. +2.5%)
  arrivalErrorSec?: number;         // Δt_arr de llegada inicial
  reason?: string | null;
}

export type BarSyncStatus =
  | 'idle'
  | 'armed'
  | 'completed'
  | 'cancelled'
  | 'already_aligned'
  | 'rejected_state'
  | 'rejected_unconfirmed'
  | 'rejected_no_downbeat'
  | 'rejected_metric_mismatch'
  | 'rejected_limits'
  | 'rejected_confidence'
  | 'rejected_tempo_mismatch';

export interface BarSyncState {
  status: BarSyncStatus;
  preparedPosition?: number | null;
  previousPosition?: number | null;
  displacementSec?: number | null;
  targetDownbeatSec?: number | null;
  beatsPerBar?: number | null;
  reason?: string | null;
}

export interface DeckState {
  deckId: DeckId;
  track: Track | null;
  playbackState: PlaybackState;
  currentTime: number;          // Posición actual en segundos
  duration: number;             // Duración de la pista cargada en segundos
  pitch: number;                // Porcentaje de variación (-8% a +8%, 0 = centro)
  calculatedBpm: number;        // BPM resultante tras aplicar pitch
  isKeyLocked: boolean;         // Conservación de tono al variar pitch (Master Tempo)
  cuePoint: number | null;      // Posición de CUE en segundos (mainCue)
  hotCues: HotCue[];            // 8 Hot Cues (vacíos o definidos)
  pitchBend: number;            // Desviación porcentual momentánea de pitch bend (+3.5, -3.5 o 0)
  isSyncActive: boolean;        // Sincronización automática de BPM activada
  isMaster: boolean;            // Indica si el deck actúa como referencia Master de tempo
  phaseAlignment?: PhaseAlignmentState; // Estado de alineación de pulsos mediante micro-slew
  barSync?: BarSyncState;               // Estado de preparación de compás (BAR SYNC)
  volume: number;               // Nivel de fader asignado al deck (0 a 100)
  errorMessage?: string | null; // Mensajes de fallo al decodificar o reproducir
}

export interface DeckActions {
  loadTrack: (track: Track) => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seek: (timeSeconds: number) => void;
  setPitch: (pitchPercent: number) => void;
  pitchBend: (direction: 'up' | 'down' | 'release') => void;
  setCue: () => Promise<void>;
  jumpToCue: () => void;
  handleCueDown: () => Promise<void>;
  handleCueUp: () => void;
  setHotCue: (slotNumber: number, position?: number) => Promise<boolean>;
  jumpToHotCue: (slotNumber: number) => void;
  deleteHotCue: (slotNumber: number) => Promise<boolean>;
  toggleSync: () => void;
  syncDeck: (deckId: DeckId) => boolean;
  alignPhase?: (deckId: DeckId) => boolean;
  cancelPhaseAlign?: (deckId: DeckId) => void;
  toggleKeyLock: () => void;
}
