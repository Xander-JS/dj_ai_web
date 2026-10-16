/**
 * SYSTEM DJ — Central DJ Session Store
 * Estado compartido reactivo para coordinar la Biblioteca, Deck A, Deck B y PlayerBar
 * sin dependencias externas mediante useSyncExternalStore nativo de React.
 *
 * Reglas:
 * - Nunca se guarda un AudioBuffer aquí; el buffer vive solo en AudioEngineService.
 * - No se inventan datos musicales: BPM y tonalidad son `null` mientras no existan
 *   en un análisis real (`analysis.status === 'analyzed'`).
 * - Solo se cargan pistas con archivo de audio real (Blob en IndexedDB o memoria).
 */

import { useSyncExternalStore } from 'react';
import type { Track } from '../types/track';
import type { DeckId } from '../types/deck';
import { audioEngine } from '../audio/index.ts';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage.ts';

export type DeckPlaybackStatus = 'stopped' | 'playing' | 'paused' | 'loading' | 'error';

/** Códigos de error traducibles por la interfaz. */
export type DeckErrorCode = 'file_missing' | 'decode_failed' | 'playback_failed';

export interface DeckStoreState {
  deckId: DeckId;
  track: Track | null;
  playbackState: DeckPlaybackStatus;
  currentTime: number;
  duration: number;
  pitch: number;          // 0 a 100, 50 es centro (0%)
  playbackRate: number;   // 0.92 a 1.08 (±8%)
  /** BPM efectivo (BPM analizado × playbackRate). `null` si no hay BPM analizado. */
  calculatedBpm: number | null;
  /** Tonalidad analizada. `null` si no hay análisis real. */
  keyStr: string | null;
  errorCode: DeckErrorCode | null;
  errorMessage: string | null;
}

export interface DJStoreState {
  deckA: DeckStoreState;
  deckB: DeckStoreState;
  masterVolume: number;   // 0 a 100
  isMasterMuted: boolean;
}

/** Margen para que un Seek al 100 % no reinicie la pista desde 0:00. */
const SEEK_END_MARGIN_SECONDS = 0.05;
/** Frecuencia de refresco de la posición en la interfaz. */
const TIME_UPDATE_INTERVAL_MS = 100;
const PITCH_RANGE = 0.08;

const safeRequestAnimationFrame = (callback: (time: number) => void): number => {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(callback);
  }
  return setTimeout(() => callback(Date.now()), TIME_UPDATE_INTERVAL_MS) as unknown as number;
};

const safeCancelAnimationFrame = (id: number): void => {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
};

const INITIAL_DECK_A: DeckStoreState = {
  deckId: 'A',
  track: null,
  playbackState: 'stopped',
  currentTime: 0,
  duration: 0,
  pitch: 50,
  playbackRate: 1.0,
  calculatedBpm: null,
  keyStr: null,
  errorCode: null,
  errorMessage: null,
};

const INITIAL_DECK_B: DeckStoreState = {
  deckId: 'B',
  track: null,
  playbackState: 'stopped',
  currentTime: 0,
  duration: 0,
  pitch: 50,
  playbackRate: 1.0,
  calculatedBpm: null,
  keyStr: null,
  errorCode: null,
  errorMessage: null,
};

const INITIAL_STATE: DJStoreState = {
  deckA: INITIAL_DECK_A,
  deckB: INITIAL_DECK_B,
  masterVolume: 80,
  isMasterMuted: false,
};

/** BPM analizado real, o null si la pista no tiene BPM analizado/almacenado. */
function getAnalyzedBpm(track: Track | null): number | null {
  if (!track || typeof track.analysis?.bpm !== 'number' || track.analysis.bpm <= 0) return null;
  return track.analysis.bpm;
}

function getAnalyzedKey(track: Track | null): string | null {
  if (!track || !track.analysis?.key) return null;
  return track.analysis.key;
}

function computeEffectiveBpm(track: Track | null, rate: number): number | null {
  const bpm = getAnalyzedBpm(track);
  return bpm === null ? null : Number((bpm * rate).toFixed(1));
}

class DJStore {
  private static instance: DJStore | null = null;
  private state: DJStoreState = INITIAL_STATE;
  private listeners: Set<() => void> = new Set();
  private rafId: number | null = null;
  private lastRafUpdate = 0;
  /** Identificadores de carga por deck para descartar cargas obsoletas sin interferencia cruzada. */
  private loadTokens: Record<DeckId, number> = { A: 0, B: 0 };

  private constructor() {
    // Escuchar la finalización natural de la reproducción en ambos decks
    audioEngine.onPlaybackEnded('A', () => {
      this.handlePlaybackEnded('A');
    });
    audioEngine.onPlaybackEnded('B', () => {
      this.handlePlaybackEnded('B');
    });
  }

  public static getInstance(): DJStore {
    if (!DJStore.instance) {
      DJStore.instance = new DJStore();
    }
    return DJStore.instance;
  }

  public getSnapshot = (): DJStoreState => {
    return this.state;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Actualización inmutable: nunca se muta un snapshot ya entregado a React. */
  private setState(partial: Partial<DJStoreState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener());
  }

  private getDeckState(deckId: DeckId): DeckStoreState {
    return deckId === 'A' ? this.state.deckA : this.state.deckB;
  }

  private setDeck(deckId: DeckId, partial: Partial<DeckStoreState>): void {
    if (deckId === 'A') {
      this.setState({ deckA: { ...this.state.deckA, ...partial } });
    } else {
      this.setState({ deckB: { ...this.state.deckB, ...partial } });
    }
  }

  /**
   * Carga una pista en el deck especificado recuperando su audio binario desde IndexedDB o respaldo.
   * Devuelve `true` si la pista quedó cargada y lista para reproducirse.
   */
  public async loadTrackToDeck(deckId: DeckId, track: Track): Promise<boolean> {
    const token = ++this.loadTokens[deckId];
    const initialPitch = this.getDeckState(deckId).playbackRate;

    // Detener y liberar el audio anterior en este deck ANTES de decodificar
    audioEngine.unloadDeck(deckId);
    this.checkStopTimeLoop();

    this.setDeck(deckId, {
      track,
      playbackState: 'loading',
      currentTime: 0,
      duration: 0,
      calculatedBpm: computeEffectiveBpm(track, initialPitch),
      keyStr: getAnalyzedKey(track),
      errorCode: null,
      errorMessage: null,
    });

    // 1. Obtener el blob de audio binario real
    let audioBlob: Blob | null = track.source.blob || track.source.file || null;
    try {
      if (!audioBlob && track.source.indexedDbKey) {
        audioBlob = await indexedDBStorage.getTrackBlob(track.source.indexedDbKey);
      }
      if (!audioBlob) {
        audioBlob = await indexedDBStorage.getTrackBlob(track.id);
      }
    } catch (err) {
      console.error(`[useDJStore] Error leyendo el almacenamiento local para Deck ${deckId}:`, err);
      audioBlob = null;
    }

    if (token !== this.loadTokens[deckId]) return false; // Carga descartada por una más reciente en este deck

    if (!audioBlob) {
      this.setDeck(deckId, {
        playbackState: 'error',
        errorCode: 'file_missing',
        errorMessage: `El archivo de audio no se encuentra disponible para "${track.title}".`,
      });
      return false;
    }

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();

      // 2. Reanudar contexto si fuera necesario
      await audioEngine.resume();

      // 3. Decodificar audio
      const audioBuffer = await audioEngine.decodeAudioData(arrayBuffer);

      if (token !== this.loadTokens[deckId]) return false;

      // 4. Cargar en el motor y sincronizar velocidad y volumen
      audioEngine.loadBufferToDeck(deckId, audioBuffer);
      audioEngine.setDeckPlaybackRate(deckId, this.getDeckState(deckId).playbackRate);
      audioEngine.setMasterVolume(this.state.isMasterMuted ? 0 : this.state.masterVolume);

      this.setDeck(deckId, {
        duration: audioBuffer.duration,
        currentTime: 0,
        playbackState: 'stopped',
        errorCode: null,
        errorMessage: null,
      });
      return true;
    } catch (err) {
      if (token !== this.loadTokens[deckId]) return false;
      console.error(`[useDJStore] Error decodificando la pista en Deck ${deckId}:`, err);
      audioEngine.unloadDeck(deckId);
      this.setDeck(deckId, {
        playbackState: 'error',
        duration: 0,
        errorCode: 'decode_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  public loadTrackToDeckA(track: Track): Promise<boolean> {
    return this.loadTrackToDeck('A', track);
  }

  public loadTrackToDeckB(track: Track): Promise<boolean> {
    return this.loadTrackToDeck('B', track);
  }

  /**
   * Inicia la reproducción real en el deck especificado.
   */
  public async playDeck(deckId: DeckId): Promise<void> {
    const deckState = this.getDeckState(deckId);
    if (!deckState.track || deckState.duration === 0 || deckState.playbackState === 'loading' || deckState.playbackState === 'error') {
      return;
    }

    try {
      await audioEngine.resume();
      audioEngine.playDeck(deckId, deckState.currentTime);
      this.setDeck(deckId, { playbackState: 'playing' });
      this.ensureTimeLoop();
    } catch (err) {
      console.error(`[useDJStore] Error al reproducir Deck ${deckId}:`, err);
      this.checkStopTimeLoop();
      this.setDeck(deckId, {
        playbackState: 'error',
        errorCode: 'playback_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public playDeckA(): Promise<void> {
    return this.playDeck('A');
  }

  public playDeckB(): Promise<void> {
    return this.playDeck('B');
  }

  /**
   * Pausa la reproducción del deck reteniendo el segundo exacto.
   */
  public pauseDeck(deckId: DeckId): void {
    const deckState = this.getDeckState(deckId);
    if (deckState.playbackState !== 'playing') {
      return;
    }

    audioEngine.pauseDeck(deckId);
    this.setDeck(deckId, {
      playbackState: 'paused',
      currentTime: audioEngine.getDeckCurrentTime(deckId),
    });
    this.checkStopTimeLoop();
  }

  public pauseDeckA(): void {
    this.pauseDeck('A');
  }

  public pauseDeckB(): void {
    this.pauseDeck('B');
  }

  /**
   * Alterna entre Play y Pause en el deck indicado.
   */
  public async togglePlayDeck(deckId: DeckId): Promise<void> {
    const deckState = this.getDeckState(deckId);
    if (deckState.playbackState === 'playing') {
      this.pauseDeck(deckId);
    } else {
      await this.playDeck(deckId);
    }
  }

  public togglePlayDeckA(): Promise<void> {
    return this.togglePlayDeck('A');
  }

  public togglePlayDeckB(): Promise<void> {
    return this.togglePlayDeck('B');
  }

  /**
   * Detiene la reproducción del deck y regresa al inicio (0:00).
   */
  public stopDeck(deckId: DeckId): void {
    const deckState = this.getDeckState(deckId);
    if (deckState.playbackState === 'loading' || deckState.playbackState === 'error') return;

    audioEngine.stopDeck(deckId);
    this.setDeck(deckId, { playbackState: 'stopped', currentTime: 0 });
    this.checkStopTimeLoop();
  }

  public stopDeckA(): void {
    this.stopDeck('A');
  }

  public stopDeckB(): void {
    this.stopDeck('B');
  }

  /**
   * Desplaza la posición de reproducción (Seek) en segundos para el deck indicado.
   */
  public seekDeck(deckId: DeckId, positionSeconds: number): void {
    const deckState = this.getDeckState(deckId);
    if (!deckState.track || deckState.duration === 0 || deckState.playbackState === 'loading' || deckState.playbackState === 'error') {
      return;
    }

    const maxPosition = Math.max(0, deckState.duration - SEEK_END_MARGIN_SECONDS);
    const clamped = Math.max(0, Math.min(positionSeconds, maxPosition));
    audioEngine.seekDeck(deckId, clamped);
    this.setDeck(deckId, { currentTime: clamped });
  }

  public seekDeckA(positionSeconds: number): void {
    this.seekDeck('A', positionSeconds);
  }

  public seekDeckB(positionSeconds: number): void {
    this.seekDeck('B', positionSeconds);
  }

  /**
   * Modifica el slider de pitch (0 a 100, 50 = centro) alterando el playbackRate real (±8%).
   */
  public setPitchDeck(deckId: DeckId, pitchValue: number): void {
    const clampedPitch = Math.max(0, Math.min(100, pitchValue));
    const rate = Number((1.0 + ((clampedPitch - 50) / 50) * PITCH_RANGE).toFixed(4));
    const deckState = this.getDeckState(deckId);

    if (deckState.track && deckState.duration > 0) {
      audioEngine.setDeckPlaybackRate(deckId, rate);
    }

    this.setDeck(deckId, {
      pitch: clampedPitch,
      playbackRate: rate,
      calculatedBpm: computeEffectiveBpm(deckState.track, rate),
    });
  }

  public setPitchDeckA(pitchValue: number): void {
    this.setPitchDeck('A', pitchValue);
  }

  public setPitchDeckB(pitchValue: number): void {
    this.setPitchDeck('B', pitchValue);
  }

  /**
   * Descarga la pista del deck indicado y libera sus recursos en memoria.
   */
  public unloadDeck(deckId: DeckId): void {
    this.loadTokens[deckId]++;
    audioEngine.unloadDeck(deckId);
    this.checkStopTimeLoop();
    const initialDeck = deckId === 'A' ? INITIAL_DECK_A : INITIAL_DECK_B;
    const currentDeck = this.getDeckState(deckId);
    this.setDeck(deckId, {
      ...initialDeck,
      pitch: currentDeck.pitch,
      playbackRate: currentDeck.playbackRate,
    });
  }

  public unloadDeckA(): void {
    this.unloadDeck('A');
  }

  public unloadDeckB(): void {
    this.unloadDeck('B');
  }

  /**
   * Ajusta el volumen maestro general (0 a 100).
   */
  public setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(100, volume));
    audioEngine.setMasterVolume(clamped);
    this.setState({ masterVolume: clamped, isMasterMuted: false });
  }

  /**
   * Alterna el silencio del volumen maestro.
   */
  public toggleMasterMute(): void {
    const isMasterMuted = !this.state.isMasterMuted;
    audioEngine.setMasterVolume(isMasterMuted ? 0 : this.state.masterVolume);
    this.setState({ isMasterMuted });
  }

  /** Indica si hay un bucle de actualización temporal activo (uso en pruebas). */
  public isTimeLoopActive(): boolean {
    return this.rafId !== null;
  }

  // --- MÉTODOS PRIVADOS DE SINCRONIZACIÓN TEMPORAL ---

  public startTimeLoop(): void {
    this.ensureTimeLoop();
  }

  public stopTimeLoop(): void {
    if (this.rafId !== null) {
      safeCancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private ensureTimeLoop(): void {
    if (this.rafId !== null) return;
    this.lastRafUpdate = 0;

    const loop = (timestamp: number) => {
      const aPlaying = this.state.deckA.playbackState === 'playing';
      const bPlaying = this.state.deckB.playbackState === 'playing';

      if (!aPlaying && !bPlaying) {
        this.rafId = null;
        return;
      }

      if (timestamp - this.lastRafUpdate >= TIME_UPDATE_INTERVAL_MS) {
        const updates: Partial<DJStoreState> = {};
        if (aPlaying) {
          updates.deckA = {
            ...this.state.deckA,
            currentTime: audioEngine.getDeckCurrentTime('A'),
          };
        }
        if (bPlaying) {
          updates.deckB = {
            ...this.state.deckB,
            currentTime: audioEngine.getDeckCurrentTime('B'),
          };
        }
        this.setState(updates);
        this.lastRafUpdate = timestamp;
      }

      this.rafId = safeRequestAnimationFrame(loop);
    };

    this.rafId = safeRequestAnimationFrame(loop);
  }

  private checkStopTimeLoop(): void {
    const aPlaying = this.state.deckA.playbackState === 'playing';
    const bPlaying = this.state.deckB.playbackState === 'playing';
    if (!aPlaying && !bPlaying) {
      this.stopTimeLoop();
    }
  }

  private handlePlaybackEnded(deckId: DeckId): void {
    this.setDeck(deckId, { playbackState: 'stopped', currentTime: 0 });
    this.checkStopTimeLoop();
  }
}

export const djStore = DJStore.getInstance();

/**
 * Hook reactivo para consumir el estado y las acciones del motor de DJ.
 */
export function useDJStore(): {
  deckA: DeckStoreState;
  deckB: DeckStoreState;
  masterVolume: number;
  isMasterMuted: boolean;
  loadTrackToDeckA: (track: Track) => Promise<boolean>;
  playDeckA: () => Promise<void>;
  pauseDeckA: () => void;
  togglePlayDeckA: () => Promise<void>;
  stopDeckA: () => void;
  seekDeckA: (positionSeconds: number) => void;
  setPitchDeckA: (pitchValue: number) => void;
  unloadDeckA: () => void;
  loadTrackToDeckB: (track: Track) => Promise<boolean>;
  playDeckB: () => Promise<void>;
  pauseDeckB: () => void;
  togglePlayDeckB: () => Promise<void>;
  stopDeckB: () => void;
  seekDeckB: (positionSeconds: number) => void;
  setPitchDeckB: (pitchValue: number) => void;
  unloadDeckB: () => void;
  loadTrackToDeck: (deckId: DeckId, track: Track) => Promise<boolean>;
  playDeck: (deckId: DeckId) => Promise<void>;
  pauseDeck: (deckId: DeckId) => void;
  togglePlayDeck: (deckId: DeckId) => Promise<void>;
  stopDeck: (deckId: DeckId) => void;
  seekDeck: (deckId: DeckId, positionSeconds: number) => void;
  setPitchDeck: (deckId: DeckId, pitchValue: number) => void;
  unloadDeck: (deckId: DeckId) => void;
  setMasterVolume: (volume: number) => void;
  toggleMasterMute: () => void;
} {
  const state = useSyncExternalStore(djStore.subscribe, djStore.getSnapshot);

  return {
    deckA: state.deckA,
    deckB: state.deckB,
    masterVolume: state.masterVolume,
    isMasterMuted: state.isMasterMuted,

    // Deck A
    loadTrackToDeckA: djStore.loadTrackToDeckA.bind(djStore),
    playDeckA: djStore.playDeckA.bind(djStore),
    pauseDeckA: djStore.pauseDeckA.bind(djStore),
    togglePlayDeckA: djStore.togglePlayDeckA.bind(djStore),
    stopDeckA: djStore.stopDeckA.bind(djStore),
    seekDeckA: djStore.seekDeckA.bind(djStore),
    setPitchDeckA: djStore.setPitchDeckA.bind(djStore),
    unloadDeckA: djStore.unloadDeckA.bind(djStore),

    // Deck B
    loadTrackToDeckB: djStore.loadTrackToDeckB.bind(djStore),
    playDeckB: djStore.playDeckB.bind(djStore),
    pauseDeckB: djStore.pauseDeckB.bind(djStore),
    togglePlayDeckB: djStore.togglePlayDeckB.bind(djStore),
    stopDeckB: djStore.stopDeckB.bind(djStore),
    seekDeckB: djStore.seekDeckB.bind(djStore),
    setPitchDeckB: djStore.setPitchDeckB.bind(djStore),
    unloadDeckB: djStore.unloadDeckB.bind(djStore),

    // Acciones genéricas por deckId
    loadTrackToDeck: djStore.loadTrackToDeck.bind(djStore),
    playDeck: djStore.playDeck.bind(djStore),
    pauseDeck: djStore.pauseDeck.bind(djStore),
    togglePlayDeck: djStore.togglePlayDeck.bind(djStore),
    stopDeck: djStore.stopDeck.bind(djStore),
    seekDeck: djStore.seekDeck.bind(djStore),
    setPitchDeck: djStore.setPitchDeck.bind(djStore),
    unloadDeck: djStore.unloadDeck.bind(djStore),

    // Master
    setMasterVolume: djStore.setMasterVolume.bind(djStore),
    toggleMasterMute: djStore.toggleMasterMute.bind(djStore),
  };
}
