/**
 * SYSTEM DJ — Domain Model: Mixer Console
 * Contratos de ecualización, ganancia, faders, crossfader y niveles VU.
 */

import type { DeckId } from './deck';

export interface ChannelEq {
  high: number;    // -12dB a +12dB (o normalizado 0 a 100, centro 50)
  mid: number;     // -12dB a +12dB (centro 50)
  low: number;     // -12dB a +12dB (centro 50)
  filter: number;  // -100 (LowPass) a +100 (HighPass), 0 = bypass
}

export interface ChannelStripState {
  deckId: DeckId;
  gain: number;    // Trim / ganancia de entrada (0 a 100, centro 50)
  eq: ChannelEq;
  volume: number;  // Fader lineal de canal (0 a 100)
  cuePfl: boolean; // Pre-escucha en auriculares
}

export type CrossfaderCurve = 'linear' | 'constant-power' | 'cut';

export interface MixerState {
  channelA: ChannelStripState;
  channelB: ChannelStripState;
  crossfader: number;               // 0 (100% Deck A) a 100 (100% Deck B), centro 50
  crossfaderCurve: CrossfaderCurve; // Curva de atenuación
  masterVolume: number;             // Volumen de salida principal (0 a 100)
}

export interface MixerActions {
  setGain: (deckId: DeckId, gain: number) => void;
  setEq: (deckId: DeckId, band: keyof Omit<ChannelEq, 'filter'>, value: number) => void;
  setFilter: (deckId: DeckId, value: number) => void;
  setChannelVolume: (deckId: DeckId, volume: number) => void;
  setCuePfl: (deckId: DeckId, active: boolean) => void;
  setCrossfader: (position: number) => void;
  setCrossfaderCurve: (curve: CrossfaderCurve) => void;
  setMasterVolume: (volume: number) => void;
}
