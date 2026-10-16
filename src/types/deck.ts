/**
 * SYSTEM DJ — Domain Model: Decks
 * Contratos y estados para las tornamesas digitales Deck A y Deck B.
 */

import type { Track, HotCue } from './track';

export type DeckId = 'A' | 'B';

export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'loading' | 'error';

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
  isSyncActive: boolean;        // Sincronización automática de BPM activada
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
  setCue: () => Promise<void>;
  jumpToCue: () => void;
  handleCueDown: () => Promise<void>;
  handleCueUp: () => void;
  setHotCue: (slotNumber: number, position?: number) => Promise<boolean>;
  jumpToHotCue: (slotNumber: number) => void;
  deleteHotCue: (slotNumber: number) => Promise<boolean>;
  toggleSync: () => void;
  toggleKeyLock: () => void;
}
