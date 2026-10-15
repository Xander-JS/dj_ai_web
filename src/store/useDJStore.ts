/**
 * SYSTEM DJ — Central DJ Session Store
 * Estado compartido reactivo para coordinar la Biblioteca, Deck A y PlayerBar
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
import { audioEngine } from '../audio/index.ts';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage.ts';

export type DeckPlaybackStatus = 'stopped' | 'playing' | 'paused' | 'loading' | 'error';

/** Códigos de error traducibles por la interfaz. */
export type DeckErrorCode = 'file_missing' | 'decode_failed' | 'playback_failed';

export interface DeckStoreState {
  deckId: 'A';
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

const INITIAL_STATE: DJStoreState = {
  deckA: INITIAL_DECK_A,
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
  /** Identificador de la carga en curso para descartar cargas obsoletas (clics rápidos). */
  private loadToken = 0;

  private constructor() {
    // Escuchar la finalización natural de la reproducción en Deck A
    audioEngine.onPlaybackEnded('A', () => {
      this.handlePlaybackEnded();
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

  private setDeckA(partial: Partial<DeckStoreState>): void {
    this.setState({ deckA: { ...this.state.deckA, ...partial } });
  }

  /**
   * Carga una pista en el Deck A recuperando su audio binario desde IndexedDB o respaldo.
   * Devuelve `true` si la pista quedó cargada y lista para reproducirse.
   */
  public async loadTrackToDeckA(track: Track): Promise<boolean> {
    const token = ++this.loadToken;

    // Detener y liberar el audio anterior ANTES de cargar: evita que siga sonando
    // durante la decodificación y que tras un fallo se reproduzca el buffer viejo.
    this.stopTimeLoop();
    audioEngine.unloadDeck('A');

    this.setDeckA({
      track,
      playbackState: 'loading',
      currentTime: 0,
      duration: 0,
      calculatedBpm: computeEffectiveBpm(track, this.state.deckA.playbackRate),
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
      console.error('[useDJStore] Error leyendo el almacenamiento local:', err);
      audioBlob = null;
    }

    if (token !== this.loadToken) return false; // Otra carga más reciente tomó el control

    if (!audioBlob) {
      this.setDeckA({
        playbackState: 'error',
        errorCode: 'file_missing',
        errorMessage: `El archivo de audio no se encuentra disponible para "${track.title}".`,
      });
      return false;
    }

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();

      // 2. Reanudar contexto (la carga se dispara con un clic del usuario)
      await audioEngine.resume();

      // 3. Decodificar
      const audioBuffer = await audioEngine.decodeAudioData(arrayBuffer);

      if (token !== this.loadToken) return false;

      // 4. Cargar en el motor y aplicar ajustes vigentes
      audioEngine.loadBufferToDeck('A', audioBuffer);
      audioEngine.setDeckPlaybackRate('A', this.state.deckA.playbackRate);
      audioEngine.setMasterVolume(this.state.isMasterMuted ? 0 : this.state.masterVolume);

      this.setDeckA({
        duration: audioBuffer.duration,
        currentTime: 0,
        playbackState: 'stopped',
        errorCode: null,
        errorMessage: null,
      });
      return true;
    } catch (err) {
      if (token !== this.loadToken) return false;
      console.error('[useDJStore] Error decodificando la pista en Deck A:', err);
      audioEngine.unloadDeck('A');
      this.setDeckA({
        playbackState: 'error',
        duration: 0,
        errorCode: 'decode_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Inicia la reproducción real en Deck A.
   */
  public async playDeckA(): Promise<void> {
    const { track, duration, playbackState } = this.state.deckA;
    if (!track || duration === 0 || playbackState === 'loading' || playbackState === 'error') {
      return;
    }

    try {
      await audioEngine.resume();
      audioEngine.playDeck('A', this.state.deckA.currentTime);
      this.setDeckA({ playbackState: 'playing' });
      this.startTimeLoop();
    } catch (err) {
      console.error('[useDJStore] Error al reproducir Deck A:', err);
      this.stopTimeLoop();
      this.setDeckA({
        playbackState: 'error',
        errorCode: 'playback_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Pausa la reproducción reteniendo el segundo exacto.
   */
  public pauseDeckA(): void {
    if (this.state.deckA.playbackState !== 'playing') {
      return;
    }

    this.stopTimeLoop();
    audioEngine.pauseDeck('A');
    this.setDeckA({
      playbackState: 'paused',
      currentTime: audioEngine.getDeckCurrentTime('A'),
    });
  }

  /**
   * Alterna entre Play y Pause en Deck A.
   */
  public async togglePlayDeckA(): Promise<void> {
    if (this.state.deckA.playbackState === 'playing') {
      this.pauseDeckA();
    } else {
      await this.playDeckA();
    }
  }

  /**
   * Detiene la reproducción y regresa al inicio (0:00).
   */
  public stopDeckA(): void {
    const { playbackState } = this.state.deckA;
    if (playbackState === 'loading' || playbackState === 'error') return;

    this.stopTimeLoop();
    audioEngine.stopDeck('A');
    this.setDeckA({ playbackState: 'stopped', currentTime: 0 });
  }

  /**
   * Desplaza la posición de reproducción (Seek) en segundos.
   */
  public seekDeckA(positionSeconds: number): void {
    const { track, duration, playbackState } = this.state.deckA;
    if (!track || duration === 0 || playbackState === 'loading' || playbackState === 'error') {
      return;
    }

    const maxPosition = Math.max(0, duration - SEEK_END_MARGIN_SECONDS);
    const clamped = Math.max(0, Math.min(positionSeconds, maxPosition));
    audioEngine.seekDeck('A', clamped);
    this.setDeckA({ currentTime: clamped });
  }

  /**
   * Modifica el slider de pitch (0 a 100, 50 = centro) alterando el playbackRate real (±8%).
   */
  public setPitchDeckA(pitchValue: number): void {
    const clampedPitch = Math.max(0, Math.min(100, pitchValue));
    const rate = Number((1.0 + ((clampedPitch - 50) / 50) * PITCH_RANGE).toFixed(4));

    if (this.state.deckA.track && this.state.deckA.duration > 0) {
      audioEngine.setDeckPlaybackRate('A', rate);
    }

    this.setDeckA({
      pitch: clampedPitch,
      playbackRate: rate,
      calculatedBpm: computeEffectiveBpm(this.state.deckA.track, rate),
    });
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

  /**
   * Descarga la pista del Deck A y libera sus recursos en memoria.
   */
  public unloadDeckA(): void {
    this.loadToken++;
    this.stopTimeLoop();
    audioEngine.unloadDeck('A');
    this.setDeckA({
      ...INITIAL_DECK_A,
      // El ajuste de pitch es del deck, no de la pista: se conserva
      pitch: this.state.deckA.pitch,
      playbackRate: this.state.deckA.playbackRate,
    });
  }

  /** Indica si hay un bucle de actualización temporal activo (uso en pruebas). */
  public isTimeLoopActive(): boolean {
    return this.rafId !== null;
  }

  // --- MÉTODOS PRIVADOS DE SINCRONIZACIÓN ---

  private startTimeLoop(): void {
    this.stopTimeLoop();
    this.lastRafUpdate = 0;

    const loop = (timestamp: number) => {
      if (this.state.deckA.playbackState !== 'playing') {
        this.rafId = null;
        return;
      }

      if (timestamp - this.lastRafUpdate >= TIME_UPDATE_INTERVAL_MS) {
        this.setDeckA({ currentTime: audioEngine.getDeckCurrentTime('A') });
        this.lastRafUpdate = timestamp;
      }

      this.rafId = safeRequestAnimationFrame(loop);
    };

    this.rafId = safeRequestAnimationFrame(loop);
  }

  private stopTimeLoop(): void {
    if (this.rafId !== null) {
      safeCancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private handlePlaybackEnded(): void {
    this.stopTimeLoop();
    this.setDeckA({ playbackState: 'stopped', currentTime: 0 });
  }
}

export const djStore = DJStore.getInstance();

/**
 * Hook reactivo para consumir el estado y las acciones del motor de DJ.
 */
export function useDJStore(): {
  deckA: DeckStoreState;
  masterVolume: number;
  isMasterMuted: boolean;
  loadTrackToDeckA: (track: Track) => Promise<boolean>;
  playDeckA: () => Promise<void>;
  pauseDeckA: () => void;
  togglePlayDeckA: () => Promise<void>;
  stopDeckA: () => void;
  seekDeckA: (positionSeconds: number) => void;
  setPitchDeckA: (pitchValue: number) => void;
  setMasterVolume: (volume: number) => void;
  toggleMasterMute: () => void;
  unloadDeckA: () => void;
} {
  const state = useSyncExternalStore(djStore.subscribe, djStore.getSnapshot);

  return {
    deckA: state.deckA,
    masterVolume: state.masterVolume,
    isMasterMuted: state.isMasterMuted,
    loadTrackToDeckA: djStore.loadTrackToDeckA.bind(djStore),
    playDeckA: djStore.playDeckA.bind(djStore),
    pauseDeckA: djStore.pauseDeckA.bind(djStore),
    togglePlayDeckA: djStore.togglePlayDeckA.bind(djStore),
    stopDeckA: djStore.stopDeckA.bind(djStore),
    seekDeckA: djStore.seekDeckA.bind(djStore),
    setPitchDeckA: djStore.setPitchDeckA.bind(djStore),
    setMasterVolume: djStore.setMasterVolume.bind(djStore),
    toggleMasterMute: djStore.toggleMasterMute.bind(djStore),
    unloadDeckA: djStore.unloadDeckA.bind(djStore),
  };
}
