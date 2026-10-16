/**
 * SYSTEM DJ — Domain Model: Web Audio Engine
 * Contratos de ciclo de vida del AudioContext, nodos DSP y servicios de decodificación.
 */

import type { DeckId } from './deck';
import type { CrossfaderCurve, ChannelEq } from './mixer';

export type AudioEngineStatus = 'uninitialized' | 'suspended' | 'running' | 'closed';

/**
 * Grafo de nodos Web Audio instanciado para cada canal independiente (Deck A / Deck B).
 * Los nodos se instancian y gestionan exclusivamente dentro del motor de audio (fuera de React).
 */
export interface DeckAudioGraph {
  deckId: DeckId;
  sourceNode: AudioBufferSourceNode | null;
  buffer: AudioBuffer | null;
  filterNode: BiquadFilterNode;
  eqHighNode: BiquadFilterNode;
  eqMidNode: BiquadFilterNode;
  eqLowNode: BiquadFilterNode;
  gainNode: GainNode;
  volumeNode: GainNode;
  crossfaderGainNode: GainNode;
  analyserNode: AnalyserNode;
}

/**
 * Contrato de servicio del motor Web Audio para desacoplar el hardware de audio de la interfaz React.
 */
export interface IAudioEngineService {
  readonly status: AudioEngineStatus;
  
  initialize(): Promise<void>;
  resume(): Promise<void>;
  
  // Gestión de buffers y pistas
  decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer>;
  loadBufferToDeck(deckId: DeckId, buffer: AudioBuffer): void;
  unloadDeck(deckId: DeckId): void;
  
  // Transporte y reproducción
  playDeck(deckId: DeckId, startOffsetSeconds?: number): void;
  pauseDeck(deckId: DeckId): void;
  stopDeck(deckId: DeckId): void;
  seekDeck(deckId: DeckId, positionSeconds: number): void;
  setDeckPlaybackRate(deckId: DeckId, rate: number): void;
  
  // Mixer y DSP en tiempo real
  setChannelGain(deckId: DeckId, gainValue: number): void;
  setChannelEq(deckId: DeckId, band: keyof Omit<ChannelEq, 'filter'>, dbValue: number): void;
  setChannelFilter(deckId: DeckId, filterNormalized: number): void;
  setChannelVolume(deckId: DeckId, volumeLinear: number): void;
  setCrossfader(positionNormalized: number, curve: CrossfaderCurve): void;
  setMasterVolume(volumeLinear: number): void;
  
  // Telemetría y análisis
  getDeckCurrentTime(deckId: DeckId): number;
  getDeckDuration(deckId: DeckId): number;
  getDeckVUMeter(deckId: DeckId): number; // Nivel RMS/Pico (0 a 100)
  isDeckPlaying(deckId: DeckId): boolean;
  getDeckPlaybackRate(deckId: DeckId): number;
  
  // Liberación de recursos
  dispose(): Promise<void>;
}
