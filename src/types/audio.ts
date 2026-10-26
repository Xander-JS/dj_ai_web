/**
 * SYSTEM DJ — Domain Model: Web Audio Engine
 * Contratos de ciclo de vida del AudioContext, nodos DSP y servicios de decodificación.
 */

import type { DeckId } from './deck';
import type { CrossfaderCurve, ChannelEq } from './mixer';
import type { SlewProfilePlan } from '../audio/analysis/phaseAlignment.ts';

export type AudioEngineStatus = 'uninitialized' | 'suspended' | 'running' | 'closed';

export interface ActiveDeckSlew {
  readonly plan: SlewProfilePlan;
  readonly startedAtCtxTime: number;
  readonly slewEpoch: number;
  readonly epoch?: number;
}

/**
 * Grafo de nodos Web Audio instanciado para cada canal independiente (Deck A / Deck B).
 * Los nodos se instancian y gestionan exclusivamente dentro del motor de audio (fuera de React).
 */
export interface DeckAudioGraph {
  deckId: DeckId;
  sourceNode: AudioBufferSourceNode | null;
  buffer: AudioBuffer | null;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  eqHighNode: BiquadFilterNode;
  eqMidNode: BiquadFilterNode;
  eqLowNode: BiquadFilterNode;
  volumeNode: GainNode;
  crossfaderGainNode: GainNode;
  analyserNode: AnalyserNode;
  /** Desplazador de tono de KEY LOCK; se crea la primera vez que se activa en el deck. */
  keyLockNode?: AudioWorkletNode | null;
}

/**
 * Topología de la etapa Master de salida combinada.
 */
export interface MasterAudioGraph {
  masterGainNode: GainNode;
  masterAnalyserNode: AnalyserNode;
  limiterNode: DynamicsCompressorNode | null;
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
  setDeckPitchBend(deckId: DeckId, bendAmount: number): void;
  getDeckPitchBend(deckId: DeckId): number;
  setDeckKeyLock?(deckId: DeckId, enabled: boolean): void;
  
  // Mixer y DSP en tiempo real
  setChannelGain(deckId: DeckId, gainValue: number): void;
  setChannelEq(deckId: DeckId, band: keyof Omit<ChannelEq, 'filter'>, dbValue: number): void;
  setChannelFilter(deckId: DeckId, filterNormalized: number): void;
  setChannelVolume(deckId: DeckId, volumeLinear: number): void;
  setCrossfader(positionNormalized: number, curve?: CrossfaderCurve): void;
  setCrossfaderCurve?(curve: CrossfaderCurve): void;
  setMasterVolume(volumeLinear: number): void;
  
  // Telemetría y análisis
  getDeckCurrentTime(deckId: DeckId): number;
  getDeckDuration(deckId: DeckId): number;
  getDeckVUMeter(deckId: DeckId): number; // Nivel visual UI (0 a 100) pre-crossfader
  getMasterVUMeter(): number;             // Nivel visual UI (0 a 100) mezcla Master
  getMasterStereoVUMeter(): { left: number; right: number }; // Niveles L / R (0 a 100) mezcla Master
  getDeckRMS(deckId: DeckId): number;    // Medición matemática RMS pura (0.0 a 1.0+) pre-crossfader
  getMasterRMS(): number;                // Medición matemática RMS pura (0.0 a 1.0+) mezcla Master
  isDeckPlaying(deckId: DeckId): boolean;
  getDeckPlaybackRate(deckId: DeckId): number;
  
  // Micro-Slew y alineación progresiva de fase
  applyDeckSlew(deckId: DeckId, plan: SlewProfilePlan, onCompleted?: () => void): boolean;
  cancelDeckSlew(deckId: DeckId, restoreRamp?: boolean): void;
  isDeckSlewActive(deckId: DeckId): boolean;
  getDeckActiveSlew(deckId: DeckId): ActiveDeckSlew | null;
  getDeckSlewEpoch(deckId: DeckId): number;
  getDeckSlewProgressPercent(deckId: DeckId): number;

  // Inspección para pruebas
  getDeckAudioGraph?(deckId: DeckId): DeckAudioGraph;
  getMasterGraph?(): MasterAudioGraph;
  
  // Liberación de recursos
  dispose(): Promise<void>;
}

