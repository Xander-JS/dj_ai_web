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
import type { Track, TrackAnalysis, HotCue } from '../types/track.ts';
import type { DeckId, PhaseAlignmentState } from '../types/deck.ts';
import type { ChannelEq, ChannelStripState, CrossfaderCurve, MixerState } from '../types/mixer';
import { audioEngine } from '../audio/index.ts';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage.ts';
import { analysisSyncManager } from '../services/analysis/index.ts';
import {
  calculatePhaseAlignmentPlan,
} from '../audio/analysis/phaseAlignment.ts';

export type DeckPlaybackStatus = 'stopped' | 'playing' | 'paused' | 'loading' | 'error';

/** Códigos de error traducibles por la interfaz. */
export type DeckErrorCode = 'file_missing' | 'decode_failed' | 'playback_failed' | 'sync_failed';

/** Paleta de 8 colores distintivos para los pads de Hot Cue estilo DJ profesional. */
export const HOT_CUE_COLORS: readonly string[] = [
  '#ff3b30', // Slot 1: Rojo
  '#ff9500', // Slot 2: Naranja
  '#ffcc00', // Slot 3: Amarillo
  '#34c759', // Slot 4: Verde
  '#00c7be', // Slot 5: Turquesa
  '#32ade6', // Slot 6: Azul claro
  '#5856d6', // Slot 7: Púrpura
  '#af52de', // Slot 8: Magenta
];

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
  /** Posición del CUE principal en segundos, o null si aún no se ha fijado. */
  mainCue: number | null;
  /** Lista de 8 Hot Cues definidos para la pista cargada. */
  hotCues: HotCue[];
  /** Desviación porcentual momentánea de pitch bend (+3.5, -3.5 o 0). */
  pitchBend: number;
  /** Indica si el deck se encuentra en reproducción provisional CUP (manteniendo CUE presionado). */
  isCupPlaying: boolean;
  /** Sincronización automática de BPM activada (Esclavo sincronizado). */
  isSyncActive: boolean;
  /** Indica si el deck actúa como referencia Master de tempo. */
  isMaster: boolean;
  /** Estado de alineación progresiva de fase mediante micro-slew. */
  phaseAlignment: PhaseAlignmentState;
  errorCode: DeckErrorCode | null;
  errorMessage: string | null;
}


export interface DJStoreState {
  deckA: DeckStoreState;
  deckB: DeckStoreState;
  syncMasterDeck: DeckId | null;
  masterVolume: number;   // 0 a 100
  isMasterMuted: boolean;
  mixer: MixerState;
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
  mainCue: null,
  hotCues: [],
  pitchBend: 0,
  isCupPlaying: false,
  isSyncActive: false,
  isMaster: false,
  phaseAlignment: {
    status: 'idle',
    progressPercent: 0,
  },
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
  mainCue: null,
  hotCues: [],
  pitchBend: 0,
  isCupPlaying: false,
  isSyncActive: false,
  isMaster: false,
  phaseAlignment: {
    status: 'idle',
    progressPercent: 0,
  },
  errorCode: null,
  errorMessage: null,
};


const INITIAL_CHANNEL_A: ChannelStripState = {
  deckId: 'A',
  gain: 50,    // 50 = 1.0x (unitario)
  eq: {
    high: 50,  // 50 = 0 dB
    mid: 50,   // 50 = 0 dB
    low: 50,   // 50 = 0 dB
    filter: 50 // 50 = bypass allpass
  },
  volume: 80,  // 80% fader inicial
  cuePfl: false,
};

const INITIAL_CHANNEL_B: ChannelStripState = {
  deckId: 'B',
  gain: 50,
  eq: {
    high: 50,
    mid: 50,
    low: 50,
    filter: 50
  },
  volume: 80,
  cuePfl: false,
};

const INITIAL_MIXER_STATE: MixerState = {
  channelA: INITIAL_CHANNEL_A,
  channelB: INITIAL_CHANNEL_B,
  crossfader: 50,
  crossfaderCurve: 'constant-power',
  masterVolume: 80,
};

const INITIAL_STATE: DJStoreState = {
  deckA: INITIAL_DECK_A,
  deckB: INITIAL_DECK_B,
  syncMasterDeck: null,
  masterVolume: 80,
  isMasterMuted: false,
  mixer: INITIAL_MIXER_STATE,
};


/** BPM analizado real, o null si la pista no tiene BPM analizado/almacenado válido. */
function getAnalyzedBpm(track: Track | null): number | null {
  if (!track || !track.analysis) return null;
  // Nunca transformar estados fallidos o no soportados en resultados musicales válidos
  if (track.analysis.status === 'failed' || track.analysis.status === 'unsupported') {
    return null;
  }
  if (typeof track.analysis.bpm !== 'number' || track.analysis.bpm <= 0) return null;
  return track.analysis.bpm;
}

function getAnalyzedKey(track: Track | null): string | null {
  if (!track || !track.analysis) return null;
  if (track.analysis.status === 'failed' || track.analysis.status === 'unsupported') {
    return null;
  }
  if (!track.analysis.key) return null;
  if (track.analysis.camelot) {
    return `${track.analysis.key} (${track.analysis.camelot})`;
  }
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
  /** Indicador de reproducción momentánea CUP activa por deck. */
  private isCupPlaying: Record<DeckId, boolean> = { A: false, B: false };


  private constructor() {
    // Escuchar la finalización natural de la reproducción en ambos decks
    audioEngine.onPlaybackEnded('A', () => {
      this.handlePlaybackEnded('A');
    });
    audioEngine.onPlaybackEnded('B', () => {
      this.handlePlaybackEnded('B');
    });

    // Escuchar actualizaciones de análisis de pistas para sincronizar reactivamente los decks
    analysisSyncManager.subscribe((trackId, analysis) => {
      this.handleAnalysisUpdated(trackId, analysis);
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
   * Actualiza el estado reactivo de Deck A o Deck B cuando finaliza o cambia el análisis de una pista.
   */
  public handleAnalysisUpdated(trackId: string, analysis: TrackAnalysis): void {
    let hasChanged = false;
    const updates: Partial<DJStoreState> = {};

    if (this.state.deckA.track?.id === trackId) {
      const updatedTrack: Track = {
        ...this.state.deckA.track,
        analysis,
      };
      updates.deckA = {
        ...this.state.deckA,
        track: updatedTrack,
        calculatedBpm: computeEffectiveBpm(updatedTrack, this.state.deckA.playbackRate),
        keyStr: getAnalyzedKey(updatedTrack),
      };
      hasChanged = true;
    }

    if (this.state.deckB.track?.id === trackId) {
      const updatedTrack: Track = {
        ...this.state.deckB.track,
        analysis,
      };
      updates.deckB = {
        ...this.state.deckB,
        track: updatedTrack,
        calculatedBpm: computeEffectiveBpm(updatedTrack, this.state.deckB.playbackRate),
        keyStr: getAnalyzedKey(updatedTrack),
      };
      hasChanged = true;
    }

    if (hasChanged) {
      this.setState(updates);
    }
  }

  /**
   * Solicita el análisis musical de una pista sincronizado con IndexedDB y el store.
   */
  public async analyzeTrack(track: Track, force = false): Promise<TrackAnalysis> {
    return analysisSyncManager.analyzeTrack(track, { force });
  }

  /**
   * Actualiza el análisis de una pista atómicamente y sincroniza los decks si está cargada.
   */
  public async updateTrackAnalysis(trackId: string, analysis: TrackAnalysis): Promise<boolean> {
    const success = await indexedDBStorage.updateTrackAnalysis(trackId, analysis);
    this.handleAnalysisUpdated(trackId, analysis);
    return success;
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

    // Recuperar análisis existente de IndexedDB si la pista recibida en memoria aún no lo tenía actualizado
    let effectiveTrack = track;
    if (track.analysis?.status !== 'analyzed') {
      try {
        const persistedAnalysis = await indexedDBStorage.getTrackAnalysis(track.id);
        if (persistedAnalysis && persistedAnalysis.status === 'analyzed') {
          effectiveTrack = { ...effectiveTrack, analysis: persistedAnalysis };
        }
      } catch {
        // Ignorar si no está disponible
      }
    }

    // Recuperar CUEs guardados (mainCue y hotCues) si existen en almacenamiento persistente
    try {
      const persistedCues = await indexedDBStorage.getTrackCues(track.id);
      if (persistedCues) {
        effectiveTrack = {
          ...effectiveTrack,
          mainCue: persistedCues.mainCue !== null ? persistedCues.mainCue : (effectiveTrack.mainCue ?? null),
          hotCues: persistedCues.hotCues && persistedCues.hotCues.length > 0 ? persistedCues.hotCues : (effectiveTrack.hotCues ?? []),
        };
      }
    } catch {
      // Ignorar si no está disponible
    }

    if (token !== this.loadTokens[deckId]) return false;

    this.setDeck(deckId, {
      track: effectiveTrack,
      playbackState: 'loading',
      currentTime: 0,
      duration: 0,
      calculatedBpm: computeEffectiveBpm(effectiveTrack, initialPitch),
      keyStr: getAnalyzedKey(effectiveTrack),
      mainCue: effectiveTrack.mainCue ?? null,
      hotCues: effectiveTrack.hotCues ? [...effectiveTrack.hotCues] : [],
      errorCode: null,
      errorMessage: null,
    });

    // 1. Obtener el blob de audio binario real
    let audioBlob: Blob | null = effectiveTrack.source.blob || effectiveTrack.source.file || null;
    try {
      if (!audioBlob && effectiveTrack.source.indexedDbKey) {
        audioBlob = await indexedDBStorage.getTrackBlob(effectiveTrack.source.indexedDbKey);
      }
      if (!audioBlob) {
        audioBlob = await indexedDBStorage.getTrackBlob(effectiveTrack.id);
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

      // Si este deck era Master o Esclavo, desacoplar vínculos
      const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
      if (this.state.syncMasterDeck === deckId) {
        this.setState({ syncMasterDeck: null });
        this.setDeck(otherDeckId, { isSyncActive: false, isMaster: false });
      } else if (this.state.syncMasterDeck === otherDeckId) {
        this.setState({ syncMasterDeck: null });
        this.setDeck(otherDeckId, { isMaster: false });
      }

      this.setDeck(deckId, {
        duration: audioBuffer.duration,
        currentTime: 0,
        playbackState: 'stopped',
        mainCue: effectiveTrack.mainCue ?? null,
        hotCues: effectiveTrack.hotCues ? [...effectiveTrack.hotCues] : [],
        isSyncActive: false,
        isMaster: false,
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

    // Si estaba en reproducción momentánea CUP y se pulsa PLAY, enclavar en reproducción normal
    if (this.isCupPlaying[deckId]) {
      this.isCupPlaying[deckId] = false;
      this.setDeck(deckId, { isCupPlaying: false });
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
    this.isCupPlaying[deckId] = false;
    this.cancelPhaseAlignment(deckId);
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    this.cancelPhaseAlignment(otherDeckId);

    const deckState = this.getDeckState(deckId);
    if (deckState.playbackState !== 'playing') {
      return;
    }

    audioEngine.pauseDeck(deckId);
    this.setDeck(deckId, {
      playbackState: 'paused',
      currentTime: audioEngine.getDeckCurrentTime(deckId),
      isCupPlaying: false,
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
    this.isCupPlaying[deckId] = false;
    this.cancelPhaseAlignment(deckId);
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    this.cancelPhaseAlignment(otherDeckId);

    const deckState = this.getDeckState(deckId);
    if (deckState.playbackState === 'loading' || deckState.playbackState === 'error') return;

    audioEngine.stopDeck(deckId);
    this.setDeck(deckId, { playbackState: 'stopped', currentTime: 0, isCupPlaying: false });
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
    this.isCupPlaying[deckId] = false;
    this.cancelPhaseAlignment(deckId);
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    this.cancelPhaseAlignment(otherDeckId);

    const deckState = this.getDeckState(deckId);
    if (!deckState.track || deckState.duration === 0 || deckState.playbackState === 'loading' || deckState.playbackState === 'error') {
      return;
    }

    const maxPosition = Math.max(0, deckState.duration - SEEK_END_MARGIN_SECONDS);
    const clamped = Math.max(0, Math.min(positionSeconds, maxPosition));
    audioEngine.seekDeck(deckId, clamped);
    this.setDeck(deckId, { currentTime: clamped, isCupPlaying: false });
  }

  public seekDeckA(positionSeconds: number): void {
    this.seekDeck('A', positionSeconds);
  }

  public seekDeckB(positionSeconds: number): void {
    this.seekDeck('B', positionSeconds);
  }

  /**
   * Fija la posición del CUE principal (mainCue) en el deck.
   * Si no se indica positionSeconds, toma el currentTime actual.
   */
  public async setMainCue(deckId: DeckId, positionSeconds?: number): Promise<void> {
    const deck = this.getDeckState(deckId);
    if (!deck.track || deck.duration <= 0) return;

    const raw = positionSeconds !== undefined ? positionSeconds : deck.currentTime;
    if (!Number.isFinite(raw) || raw < 0 || raw > deck.duration) return;
    const clamped = Number(Math.max(0, Math.min(raw, deck.duration)).toFixed(3));

    const updatedTrack: Track = {
      ...deck.track,
      mainCue: clamped,
    };

    const updates: Partial<DJStoreState> = {};
    if (deckId === 'A') {
      updates.deckA = { ...this.state.deckA, mainCue: clamped, track: updatedTrack };
    } else {
      updates.deckB = { ...this.state.deckB, mainCue: clamped, track: updatedTrack };
    }

    // Si el otro deck tiene cargada la misma pista, sincronizar mainCue reactivamente
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    const otherDeck = this.getDeckState(otherDeckId);
    if (otherDeck.track?.id === deck.track.id) {
      const otherUpdatedTrack: Track = { ...otherDeck.track, mainCue: clamped };
      if (otherDeckId === 'A') {
        updates.deckA = { ...this.state.deckA, mainCue: clamped, track: otherUpdatedTrack };
      } else {
        updates.deckB = { ...this.state.deckB, mainCue: clamped, track: otherUpdatedTrack };
      }
    }

    this.setState(updates);

    try {
      await indexedDBStorage.updateTrackCues(deck.track.id, { mainCue: clamped });
    } catch (err) {
      console.warn(`[useDJStore] Error persistiendo mainCue para ${deck.track.id}:`, err);
    }
  }

  /**
   * Salta al CUE principal.
   * Si está reproduciendo, detiene la reproducción y regresa al CUE.
   * Si está pausado o detenido, reposiciona el cursor en el CUE sin reproducir.
   */
  public jumpToMainCue(deckId: DeckId): void {
    const deck = this.getDeckState(deckId);
    if (!deck.track || deck.duration <= 0) return;

    const targetPos = deck.mainCue ?? 0;
    this.isCupPlaying[deckId] = false;

    if (deck.playbackState === 'playing') {
      audioEngine.pauseDeck(deckId);
      audioEngine.seekDeck(deckId, targetPos);
      this.setDeck(deckId, { playbackState: 'paused', currentTime: targetPos, isCupPlaying: false });
      this.checkStopTimeLoop();
    } else {
      audioEngine.seekDeck(deckId, targetPos);
      this.setDeck(deckId, { currentTime: targetPos, isCupPlaying: false });
    }
  }

  /**
   * Manejador al presionar el botón CUE (pointerdown / mousedown / keydown):
   * - En reproducción: detiene y salta a mainCue.
   * - En pausa: fija el CUE en currentTime (si se desplazó) y activa reproducción CUP mientras se mantenga presionado.
   */
  public async handleCueDown(deckId: DeckId): Promise<void> {
    const deck = this.getDeckState(deckId);
    if (!deck.track || deck.duration <= 0 || deck.playbackState === 'loading' || deck.playbackState === 'error') {
      return;
    }

    if (deck.playbackState === 'playing') {
      this.jumpToMainCue(deckId);
      return;
    }

    // Estado paused o stopped:
    // Si no había mainCue, o si la posición actual se movió más de 50 ms del CUE existente, actualizar CUE
    const currentCue = deck.mainCue ?? 0;
    if (deck.mainCue === null || Math.abs(deck.currentTime - currentCue) > 0.05) {
      await this.setMainCue(deckId, deck.currentTime);
    }

    // Iniciar reproducción CUP
    const cueToPlay = this.getDeckState(deckId).mainCue ?? 0;
    this.isCupPlaying[deckId] = true;
    try {
      await audioEngine.resume();
      audioEngine.playDeck(deckId, cueToPlay);
      this.setDeck(deckId, { playbackState: 'playing', currentTime: cueToPlay, isCupPlaying: true });
      this.ensureTimeLoop();
    } catch (err) {
      this.isCupPlaying[deckId] = false;
      this.setDeck(deckId, { isCupPlaying: false });
      console.error(`[useDJStore] Error en reproducción CUP Deck ${deckId}:`, err);
    }
  }

  /**
   * Manejador al soltar el botón CUE (pointerup / mouseup / keyup):
   * Si CUP estaba activo, detiene la reproducción y regresa a mainCue.
   */
  public handleCueUp(deckId: DeckId): void {
    if (!this.isCupPlaying[deckId]) return;
    this.isCupPlaying[deckId] = false;

    const deck = this.getDeckState(deckId);
    const targetPos = deck.mainCue ?? 0;

    audioEngine.pauseDeck(deckId);
    audioEngine.seekDeck(deckId, targetPos);
    this.setDeck(deckId, { playbackState: 'paused', currentTime: targetPos, isCupPlaying: false });
    this.checkStopTimeLoop();
  }

  /**
   * Cancela de forma segura cualquier reproducción CUP activa (p. ej. pérdida de foco, cambio de pista, blur).
   */
  public cancelCup(deckId: DeckId): void {
    if (this.isCupPlaying[deckId]) {
      this.handleCueUp(deckId);
    }
  }

  /**
   * Retorna si el deck está actualmente en reproducción CUP.
   */
  public getIsCupPlaying(deckId: DeckId): boolean {
    return this.isCupPlaying[deckId];
  }

  /**
   * Guarda o actualiza un Hot Cue (1 a 8) en la posición indicada (o currentTime actual).
   */
  public async setHotCue(deckId: DeckId, slotNumber: number, positionSeconds?: number): Promise<boolean> {
    if (slotNumber < 1 || slotNumber > 8) return false;
    const deck = this.getDeckState(deckId);
    if (!deck.track || deck.duration <= 0) return false;

    const raw = positionSeconds !== undefined ? positionSeconds : deck.currentTime;
    if (!Number.isFinite(raw) || raw < 0 || raw > deck.duration) return false;
    const clamped = Number(Math.max(0, Math.min(raw, deck.duration)).toFixed(3));

    const currentCues = deck.hotCues || [];
    const existingCue = currentCues.find((c) => c.id === slotNumber);
    const color = HOT_CUE_COLORS[slotNumber - 1];
    const newCue: HotCue = {
      id: slotNumber,
      position: clamped,
      trackId: deck.track.id,
      label: `Cue ${slotNumber}`,
      color,
      createdAt: existingCue?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    const filtered = currentCues.filter((c) => c.id !== slotNumber);
    const updatedCues = [...filtered, newCue].sort((a, b) => a.id - b.id);

    const updatedTrack: Track = {
      ...deck.track,
      hotCues: updatedCues,
    };

    const updates: Partial<DJStoreState> = {};
    if (deckId === 'A') {
      updates.deckA = { ...this.state.deckA, hotCues: updatedCues, track: updatedTrack };
    } else {
      updates.deckB = { ...this.state.deckB, hotCues: updatedCues, track: updatedTrack };
    }

    // Sincronizar en el otro deck si comparte la misma pista
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    const otherDeck = this.getDeckState(otherDeckId);
    if (otherDeck.track?.id === deck.track.id) {
      const otherUpdatedTrack: Track = { ...otherDeck.track, hotCues: updatedCues };
      if (otherDeckId === 'A') {
        updates.deckA = { ...this.state.deckA, hotCues: updatedCues, track: otherUpdatedTrack };
      } else {
        updates.deckB = { ...this.state.deckB, hotCues: updatedCues, track: otherUpdatedTrack };
      }
    }

    this.setState(updates);

    try {
      await indexedDBStorage.updateTrackCues(deck.track.id, { hotCues: updatedCues });
      return true;
    } catch (err) {
      console.warn(`[useDJStore] Error persistiendo hotCues para ${deck.track.id}:`, err);
      return false;
    }
  }

  /**
   * Salta al Hot Cue indicado respetando el estado de reproducción o pausa actual.
   */
  public jumpToHotCue(deckId: DeckId, slotNumber: number): void {
    const deck = this.getDeckState(deckId);
    if (!deck.track || deck.duration <= 0) return;

    const cue = deck.hotCues.find((c) => c.id === slotNumber);
    if (!cue) return;

    this.seekDeck(deckId, cue.position);
  }

  /**
   * Elimina un Hot Cue (1 a 8) de la pista y actualiza la persistencia.
   */
  public async deleteHotCue(deckId: DeckId, slotNumber: number): Promise<boolean> {
    if (slotNumber < 1 || slotNumber > 8) return false;
    const deck = this.getDeckState(deckId);
    if (!deck.track) return false;

    const currentCues = deck.hotCues || [];
    const cueExists = currentCues.some((c) => c.id === slotNumber);
    if (!cueExists) return false;

    const updatedCues = currentCues.filter((c) => c.id !== slotNumber);
    const updatedTrack: Track = {
      ...deck.track,
      hotCues: updatedCues,
    };

    const updates: Partial<DJStoreState> = {};
    if (deckId === 'A') {
      updates.deckA = { ...this.state.deckA, hotCues: updatedCues, track: updatedTrack };
    } else {
      updates.deckB = { ...this.state.deckB, hotCues: updatedCues, track: updatedTrack };
    }

    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    const otherDeck = this.getDeckState(otherDeckId);
    if (otherDeck.track?.id === deck.track.id) {
      const otherUpdatedTrack: Track = { ...otherDeck.track, hotCues: updatedCues };
      if (otherDeckId === 'A') {
        updates.deckA = { ...this.state.deckA, hotCues: updatedCues, track: otherUpdatedTrack };
      } else {
        updates.deckB = { ...this.state.deckB, hotCues: updatedCues, track: otherUpdatedTrack };
      }
    }

    this.setState(updates);

    try {
      await indexedDBStorage.updateTrackCues(deck.track.id, { hotCues: updatedCues });
      return true;
    } catch (err) {
      console.warn(`[useDJStore] Error eliminando hotCue en almacenamiento para ${deck.track.id}:`, err);
      return false;
    }
  }

  /**
   * Modifica el slider de pitch (0 a 100, 50 = centro) alterando el playbackRate real (±8%).
   * Al mover manualmente el fader de un deck con SYNC activo (Esclavo), desactiva SYNC
   * de forma inmediata para restaurar el control manual sin saltos de velocidad ni discrepancias.
   * Si el deck modificado es el Master, propaga el nuevo tempo al Esclavo si está dentro de ±8%.
   */
  public setPitchDeck(deckId: DeckId, pitchValue: number): void {
    const clampedPitch = Math.max(0, Math.min(100, pitchValue));
    const rate = Number((1.0 + ((clampedPitch - 50) / 50) * PITCH_RANGE).toFixed(4));
    const deckState = this.getDeckState(deckId);
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    const otherDeck = this.getDeckState(otherDeckId);

    // Cancelar cualquier micro-slew activo ante cambio manual de pitch
    this.cancelPhaseAlignment(deckId);
    this.cancelPhaseAlignment(otherDeckId);

    if (deckState.track && deckState.duration > 0) {
      audioEngine.setDeckPlaybackRate(deckId, rate);
    }

    // 1. Si el usuario mueve manualmente el fader del Esclavo, desacoplar SYNC
    let isSyncActive = deckState.isSyncActive;
    if (isSyncActive) {
      isSyncActive = false;
      if (this.state.syncMasterDeck === otherDeckId) {
        this.setDeck(otherDeckId, { isMaster: false });
        this.setState({ syncMasterDeck: null });
      }
    }

    this.setDeck(deckId, {
      pitch: clampedPitch,
      playbackRate: rate,
      calculatedBpm: computeEffectiveBpm(deckState.track, rate),
      isSyncActive,
    });

    // 2. Si este deck es el Master y el otro deck es Esclavo (isSyncActive), propagar nuevo tempo
    if (this.state.syncMasterDeck === deckId && otherDeck.isSyncActive && otherDeck.track) {
      const masterBaseBpm = getAnalyzedBpm(deckState.track);
      const slaveBaseBpm = getAnalyzedBpm(otherDeck.track);
      if (masterBaseBpm && slaveBaseBpm) {
        const newMasterTargetBpm = masterBaseBpm * rate;
        const newSlaveRate = Number((newMasterTargetBpm / slaveBaseBpm).toFixed(4));
        if (newSlaveRate >= 0.92 && newSlaveRate <= 1.08) {
          const newSlavePitch = Number(
            Math.max(0, Math.min(100, 50 + ((newSlaveRate - 1.0) / PITCH_RANGE) * 50)).toFixed(1)
          );
          audioEngine.setDeckPlaybackRate(otherDeckId, newSlaveRate);
          this.setDeck(otherDeckId, {
            pitch: newSlavePitch,
            playbackRate: newSlaveRate,
            calculatedBpm: Number((slaveBaseBpm * newSlaveRate).toFixed(1)),
          });
        } else {
          // Desacoplar esclavo de forma segura si el Master excede el rango de pitch alcanzable (±8%)
          this.setDeck(otherDeckId, {
            isSyncActive: false,
            errorMessage: 'SYNC desactivado: el tempo del Master excedió el rango de pitch alcanzable (±8%).',
          });
          this.setDeck(deckId, { isMaster: false });
          this.setState({ syncMasterDeck: null });
        }
      }
    }
  }

  public setPitchDeckA(pitchValue: number): void {
    this.setPitchDeck('A', pitchValue);
  }

  public setPitchDeckB(pitchValue: number): void {
    this.setPitchDeck('B', pitchValue);
  }

  /**
   * Modifica temporalmente la velocidad de reproducción mediante Pitch Bend (+ / - momentáneo).
   * direction: 'up' (+3.5%), 'down' (-3.5%), 'release' (0%).
   * Al soltar el control (release), retorna suavemente al playbackRate nominal.
   * Cancela inmediatamente cualquier micro-slew activo en el deck o en el esclavo dependiente.
   */
  public pitchBend(deckId: DeckId, direction: 'up' | 'down' | 'release'): void {
    const PITCH_BEND_PERCENT = 3.5;
    const bendPercent = direction === 'up'
      ? PITCH_BEND_PERCENT
      : direction === 'down'
        ? -PITCH_BEND_PERCENT
        : 0;

    const bendAmount = bendPercent / 100;
    const deckState = this.getDeckState(deckId);
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';

    // Cancelar cualquier micro-slew activo ante intervención manual de Pitch Bend
    this.cancelPhaseAlignment(deckId);
    this.cancelPhaseAlignment(otherDeckId);

    if (deckState.track && deckState.duration > 0) {
      audioEngine.setDeckPitchBend(deckId, bendAmount);
    }

    this.setDeck(deckId, {
      pitchBend: bendPercent,
    });
  }

  public pitchBendDeckA(direction: 'up' | 'down' | 'release'): void {
    this.pitchBend('A', direction);
  }

  public pitchBendDeckB(direction: 'up' | 'down' | 'release'): void {
    this.pitchBend('B', direction);
  }

  /**
   * Sincroniza el tempo (BPM) del deck indicado con el deck de referencia (Master).
   * Si SYNC ya está activo en este deck, lo desactiva conservando exactamente
   * la velocidad escuchada y la posición del fader visual.
   *
   * Reglas de selección de Master:
   * 1. Si un solo deck está en reproducción, ese deck es el MASTER indiscutible.
   * 2. Si ambos están en reproducción, el deck opuesto al que pulsa SYNC actúa como MASTER.
   * 3. Si ambos están detenidos, el deck opuesto actúa como MASTER determinista.
   *
   * Reglas de validación:
   * 1. No utiliza relaciones de medio/doble tiempo automáticamente.
   * 2. Rechaza si falta pista o BPM analizado en cualquiera de los dos decks.
   * 3. Rechaza si la velocidad requerida excede [0.92, 1.08] (±8%) sin recortar silenciosamente.
   * 4. Asimetría estricta: Master inmutable (isMaster: true, isSyncActive: false),
   *    Slave dependiente (isMaster: false, isSyncActive: true).
   */
  public syncDeck(deckId: DeckId): boolean {
    const slaveDeck = this.getDeckState(deckId);
    const masterDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    const masterDeck = this.getDeckState(masterDeckId);

    // Cancelar cualquier micro-slew activo antes de alterar el acoplamiento de sincronización
    this.cancelPhaseAlignment(deckId);
    this.cancelPhaseAlignment(masterDeckId);

    // 1. Si SYNC ya está activo en este deck: DESACTIVAR conservando la velocidad actual
    if (slaveDeck.isSyncActive) {
      this.setDeck(deckId, {
        isSyncActive: false,
      });

      // Si el otro deck era el Master y ya no tiene esclavos, liberar rol de Master
      if (this.state.syncMasterDeck === masterDeckId) {
        this.setDeck(masterDeckId, { isMaster: false });
        this.setState({ syncMasterDeck: null });
      }
      return false;
    }

    // 2. Validación de la pista del deck solicitante (Esclavo)
    if (!slaveDeck.track || slaveDeck.duration <= 0) {
      this.setDeck(deckId, {
        errorCode: 'sync_failed',
        errorMessage: 'No es posible sincronizar: este deck no tiene una pista cargada.',
      });
      return false;
    }

    const slaveBaseBpm = getAnalyzedBpm(slaveDeck.track);
    if (typeof slaveBaseBpm !== 'number' || slaveBaseBpm <= 0) {
      this.setDeck(deckId, {
        errorCode: 'sync_failed',
        errorMessage: 'No es posible sincronizar: la pista no tiene un BPM analizado válido.',
      });
      return false;
    }

    // 3. Validación de la pista del deck de referencia (Maestro)
    if (!masterDeck.track || masterDeck.duration <= 0) {
      this.setDeck(deckId, {
        errorCode: 'sync_failed',
        errorMessage: 'No es posible sincronizar: el deck opuesto no tiene una pista cargada para actuar como Master.',
      });
      return false;
    }

    const masterBaseBpm = getAnalyzedBpm(masterDeck.track);
    if (typeof masterBaseBpm !== 'number' || masterBaseBpm <= 0) {
      this.setDeck(deckId, {
        errorCode: 'sync_failed',
        errorMessage: 'No es posible sincronizar: el deck opuesto no tiene un BPM analizado válido.',
      });
      return false;
    }

    // 4. Determinación del tempo objetivo del Maestro
    // El tempo nominal objetivo se basa en el fader nominal del Maestro (excluye Pitch Bend momentáneo)
    const masterTargetBpm = masterBaseBpm * masterDeck.playbackRate;

    // 5. Cálculo del factor de velocidad requerido para el Esclavo
    // R_req = masterTargetBpm / slaveBaseBpm
    const requiredRate = Number((masterTargetBpm / slaveBaseBpm).toFixed(4));

    // 6. Validación estricta del rango de velocidad [0.92, 1.08] (±8%)
    // No recortar silenciosamente; rechazar si está fuera de rango
    if (requiredRate < 0.92 || requiredRate > 1.08) {
      this.setDeck(deckId, {
        errorCode: 'sync_failed',
        errorMessage: `No es posible sincronizar: el tempo requerido (${masterTargetBpm.toFixed(1)} BPM) excede el rango de pitch (±8%) para la pista actual (${slaveBaseBpm.toFixed(1)} BPM).`,
      });
      return false;
    }

    // 7. Cálculo de la posición del fader visual correspondiente exactamente a requiredRate
    const targetPitch = Number(
      Math.max(0, Math.min(100, 50 + ((requiredRate - 1.0) / PITCH_RANGE) * 50)).toFixed(1)
    );

    // 8. Aplicar la velocidad al motor de audio
    audioEngine.setDeckPlaybackRate(deckId, requiredRate);

    // 9. Actualizar estado garantizando asimetría Maestro/Esclavo
    this.setState({ syncMasterDeck: masterDeckId });

    // Deck Maestro
    this.setDeck(masterDeckId, {
      isMaster: true,
      isSyncActive: false,
    });

    // Deck Esclavo
    this.setDeck(deckId, {
      isMaster: false,
      isSyncActive: true,
      pitch: targetPitch,
      playbackRate: requiredRate,
      calculatedBpm: Number((slaveBaseBpm * requiredRate).toFixed(1)),
      errorCode: null,
      errorMessage: null,
    });

    return true;
  }

  public toggleSync(deckId: DeckId): boolean {
    return this.syncDeck(deckId);
  }

  public syncDeckA(): boolean {
    return this.syncDeck('A');
  }

  public syncDeckB(): boolean {
    return this.syncDeck('B');
  }

  /**
   * Ejecuta la alineación progresiva de fase (micro-slew) entre el deck solicitante y el deck de referencia.
   * Modula suavemente la velocidad del AudioParam sin usar seekDeck destructivo,
   * respetando los límites globales de velocidad [0.92, 1.08] y las retículas provisionales.
   *
   * Distingue claramente:
   * - Beatgrid provisional (no downbeat musical garantizado).
   * - SYNC de tempo nominal de Etapa 3.
   * - Alineación temporal de pulsos estimados mediante micro-slew.
   */
  public alignPhase(deckId: DeckId): boolean {
    const slaveDeckId: DeckId = deckId;
    const masterDeckId: DeckId = deckId === 'A' ? 'B' : 'A';

    const slaveState = this.getDeckState(slaveDeckId);
    const masterState = this.getDeckState(masterDeckId);

    // 0. Comprobación estricta de roles: el deck Master no puede actuar como esclavo ni modular su fase
    if (slaveState.isMaster || this.state.syncMasterDeck === slaveDeckId) {
      this.setDeck(slaveDeckId, {
        phaseAlignment: {
          status: 'rejected_state',
          progressPercent: 0,
          reason: 'El deck actúa como Master de sincronización; solo el deck esclavo modula su fase.',
        },
      });
      return false;
    }

    // 1. Validar que el esclavo esté en reproducción activa
    if (slaveState.playbackState !== 'playing') {
      this.setDeck(slaveDeckId, {
        phaseAlignment: {
          status: 'rejected_state',
          progressPercent: 0,
          reason: 'El deck esclavo debe estar en reproducción activa para alinear fase.',
        },
      });
      return false;
    }

    // 2. Validar que el maestro esté en reproducción activa
    if (masterState.playbackState !== 'playing') {
      this.setDeck(slaveDeckId, {
        phaseAlignment: {
          status: 'rejected_state',
          progressPercent: 0,
          reason: 'El deck maestro debe estar en reproducción activa para alinear fase.',
        },
      });
      return false;
    }

    // 3. Validar pistas y análisis musical en ambos decks
    const slaveTrack = slaveState.track;
    const masterTrack = masterState.track;

    if (!slaveTrack || !masterTrack || slaveState.duration <= 0 || masterState.duration <= 0) {
      this.setDeck(slaveDeckId, {
        phaseAlignment: {
          status: 'rejected_confidence',
          progressPercent: 0,
          reason: 'Ambos decks deben tener pistas cargadas para alinear fase.',
        },
      });
      return false;
    }

    const slaveBpm = getAnalyzedBpm(slaveTrack);
    const masterBpm = getAnalyzedBpm(masterTrack);

    if (!slaveBpm || !masterBpm) {
      this.setDeck(slaveDeckId, {
        phaseAlignment: {
          status: 'rejected_confidence',
          progressPercent: 0,
          reason: 'Ambos decks deben tener un BPM analizado válido.',
        },
      });
      return false;
    }

    const slaveAnalysis = slaveTrack.analysis;
    const masterAnalysis = masterTrack.analysis;

    const slaveFirstBeat = typeof slaveAnalysis?.firstBeatTime === 'number' && Number.isFinite(slaveAnalysis.firstBeatTime)
      ? slaveAnalysis.firstBeatTime
      : 0;

    const masterFirstBeat = typeof masterAnalysis?.firstBeatTime === 'number' && Number.isFinite(masterAnalysis.firstBeatTime)
      ? masterAnalysis.firstBeatTime
      : 0;

    const slaveBend = (slaveState.pitchBend || 0) / 100;
    const masterBend = (masterState.pitchBend || 0) / 100;

    // 4. Calcular el plan de alineación mediante el motor matemático de micro-slew
    const calcResult = calculatePhaseAlignmentPlan({
      masterCurrentTime: audioEngine.getDeckCurrentTime(masterDeckId),
      masterBpm,
      masterFirstBeatTime: masterFirstBeat,
      masterDuration: masterState.duration,
      masterPlaybackRate: masterState.playbackRate,
      masterBendAmount: masterBend,
      masterBpmConfidence: masterAnalysis?.bpmConfidence,
      masterIsAmbiguous: masterAnalysis?.status === 'unsupported',

      slaveCurrentTime: audioEngine.getDeckCurrentTime(slaveDeckId),
      slaveBpm,
      slaveFirstBeatTime: slaveFirstBeat,
      slaveDuration: slaveState.duration,
      slavePlaybackRate: slaveState.playbackRate,
      slaveBendAmount: slaveBend,
      slaveBpmConfidence: slaveAnalysis?.bpmConfidence,
      slaveIsAmbiguous: slaveAnalysis?.status === 'unsupported',
      validateTempoCompatibility: true,
    });

    if (calcResult.status === 'already_aligned') {
      this.setDeck(slaveDeckId, {
        phaseAlignment: {
          status: 'already_aligned',
          progressPercent: 100,
          arrivalErrorSec: calcResult.arrivalErrorSec,
          targetDisplacementSec: 0,
          reason: calcResult.reason,
        },
      });
      return true;
    }

    if (!calcResult.success || !calcResult.plan) {
      this.setDeck(slaveDeckId, {
        phaseAlignment: {
          status: calcResult.status,
          progressPercent: 0,
          arrivalErrorSec: calcResult.arrivalErrorSec,
          targetDisplacementSec: calcResult.targetDisplacementSec,
          reason: calcResult.reason,
        },
      });
      return false;
    }

    const plan = calcResult.plan;

    // 5. Actualizar estado a activo en el esclavo
    this.setDeck(slaveDeckId, {
      phaseAlignment: {
        status: 'active',
        progressPercent: 0,
        targetDisplacementSec: plan.targetDisplacement,
        estimatedDurationSec: plan.tSlew,
        deviationPercent: Number((plan.deltaRPeak * 100).toFixed(2)),
        arrivalErrorSec: plan.arrivalErrorSec,
        reason: null,
      },
    });

    // 6. Aplicar la automatización al motor Web Audio
    const applied = audioEngine.applyDeckSlew(slaveDeckId, plan, () => {
      // Callback de finalización al expirar el tiempo del micro-slew
      const currentDeck = this.getDeckState(slaveDeckId);
      if (currentDeck.phaseAlignment.status === 'active') {
        this.setDeck(slaveDeckId, {
          phaseAlignment: {
            status: 'completed',
            progressPercent: 100,
            targetDisplacementSec: plan.targetDisplacement,
            estimatedDurationSec: plan.tSlew,
            deviationPercent: Number((plan.deltaRPeak * 100).toFixed(2)),
            arrivalErrorSec: plan.arrivalErrorSec,
            reason: null,
          },
        });
      }
    });

    if (!applied) {
      this.setDeck(slaveDeckId, {
        phaseAlignment: {
          status: 'rejected_state',
          progressPercent: 0,
          reason: 'Fallo al programar la automatización de micro-slew en el motor de audio.',
        },
      });
      return false;
    }

    return true;
  }

  public cancelPhaseAlignment(deckId: DeckId): void {
    audioEngine.cancelDeckSlew(deckId);
    const deckState = this.getDeckState(deckId);
    if (deckState.phaseAlignment.status === 'active') {
      this.setDeck(deckId, {
        phaseAlignment: {
          status: 'cancelled',
          progressPercent: 0,
          reason: 'Alineación de fase cancelada por intervención del usuario o cambio de transporte.',
        },
      });
    }
  }

  public alignPhaseDeckA(): boolean {
    return this.alignPhase('A');
  }

  public alignPhaseDeckB(): boolean {
    return this.alignPhase('B');
  }

  /**
   * Descarga la pista del deck indicado y libera sus recursos en memoria.
   */
  public unloadDeck(deckId: DeckId): void {
    this.cancelCup(deckId);
    this.cancelPhaseAlignment(deckId);
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    this.cancelPhaseAlignment(otherDeckId);
    this.loadTokens[deckId]++;
    audioEngine.setDeckPitchBend(deckId, 0);
    audioEngine.unloadDeck(deckId);
    this.checkStopTimeLoop();

    if (this.state.syncMasterDeck === deckId) {
      // El Maestro fue descargado: desacoplar el Esclavo conservando su tempo actual
      this.setState({ syncMasterDeck: null });
      this.setDeck(otherDeckId, { isSyncActive: false, isMaster: false });
    } else if (this.state.syncMasterDeck === otherDeckId) {
      // El Esclavo fue descargado: desvincular el Maestro
      this.setState({ syncMasterDeck: null });
      this.setDeck(otherDeckId, { isMaster: false });
    }

    const initialDeck = deckId === 'A' ? INITIAL_DECK_A : INITIAL_DECK_B;
    const currentDeck = this.getDeckState(deckId);
    this.setDeck(deckId, {
      ...initialDeck,
      pitch: currentDeck.pitch,
      playbackRate: currentDeck.playbackRate,
      isSyncActive: false,
      isMaster: false,
      phaseAlignment: { status: 'idle', progressPercent: 0 },
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
   * Mantiene una única fuente de verdad sincronizando state.masterVolume y state.mixer.masterVolume.
   * Si el master está silenciado, actualiza el nivel nominal pero mantiene la salida física en 0.
   */
  public setMasterVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(100, volume));
    try {
      audioEngine.setMasterVolume(this.state.isMasterMuted ? 0 : clamped);
    } catch {
      // Ignorar si el motor de audio aún no se encuentra inicializado
    }

    this.setState({
      masterVolume: clamped,
      mixer: {
        ...this.state.mixer,
        masterVolume: clamped,
      },
    });
  }

  /**
   * Alterna el silencio del volumen maestro conservando el nivel fijado.
   */
  public toggleMasterMute(): void {
    const isMasterMuted = !this.state.isMasterMuted;
    try {
      audioEngine.setMasterVolume(isMasterMuted ? 0 : this.state.masterVolume);
    } catch {
      // Ignorar si el motor aún no está disponible
    }
    this.setState({ isMasterMuted });
  }

  /**
   * Ajusta la ganancia / trim de entrada del canal especificado (0 a 100, centro 50 = 1.0x).
   */
  public setChannelGain(deckId: DeckId, gain: number): void {
    const clamped = Math.max(0, Math.min(100, gain));
    try {
      audioEngine.setChannelGain(deckId, clamped);
    } catch {
      // Ignorar si el motor aún no está disponible
    }

    const channelKey = deckId === 'A' ? 'channelA' : 'channelB';
    this.setState({
      mixer: {
        ...this.state.mixer,
        [channelKey]: {
          ...this.state.mixer[channelKey],
          gain: clamped,
        },
      },
    });
  }

  /**
   * Ajusta una banda del ecualizador (high, mid, low) para el deck especificado.
   * Acepta escala de slider (0..100 con centro 50 = 0 dB) o valores en dB (-12..+12).
   */
  public setChannelEq(deckId: DeckId, band: keyof Omit<ChannelEq, 'filter'>, value: number): void {
    let sliderValue: number;
    let dbValue: number;

    if (value < 0) {
      dbValue = Math.max(-12, value);
      sliderValue = Number((50 + (dbValue / 12) * 50).toFixed(2));
    } else {
      sliderValue = Math.max(0, Math.min(100, value));
      dbValue = Number((((sliderValue - 50) / 50) * 12).toFixed(2));
    }

    try {
      audioEngine.setChannelEq(deckId, band, dbValue);
    } catch {
      // Ignorar si el motor aún no está disponible
    }

    const channelKey = deckId === 'A' ? 'channelA' : 'channelB';
    this.setState({
      mixer: {
        ...this.state.mixer,
        [channelKey]: {
          ...this.state.mixer[channelKey],
          eq: {
            ...this.state.mixer[channelKey].eq,
            [band]: sliderValue,
          },
        },
      },
    });
  }

  /**
   * Ajusta el filtro bipolar de canal.
   * Acepta escala de slider (0..100 con centro 50 = bypass) o valores bipolares (-100..+100).
   */
  public setChannelFilter(deckId: DeckId, value: number): void {
    let sliderValue: number;
    let bipolarValue: number;

    if (value < 0) {
      bipolarValue = Math.max(-100, value);
      sliderValue = Number((50 + (bipolarValue / 100) * 50).toFixed(2));
    } else {
      sliderValue = Math.max(0, Math.min(100, value));
      bipolarValue = Number((((sliderValue - 50) / 50) * 100).toFixed(2));
    }

    try {
      audioEngine.setChannelFilter(deckId, bipolarValue);
    } catch {
      // Ignorar si el motor aún no está disponible
    }

    const channelKey = deckId === 'A' ? 'channelA' : 'channelB';
    this.setState({
      mixer: {
        ...this.state.mixer,
        [channelKey]: {
          ...this.state.mixer[channelKey],
          eq: {
            ...this.state.mixer[channelKey].eq,
            filter: sliderValue,
          },
        },
      },
    });
  }

  /**
   * Ajusta el fader lineal de volumen del canal (0 a 100).
   */
  public setChannelVolume(deckId: DeckId, volume: number): void {
    const clamped = Math.max(0, Math.min(100, volume));
    try {
      audioEngine.setChannelVolume(deckId, clamped);
    } catch {
      // Ignorar si el motor aún no está disponible
    }

    const channelKey = deckId === 'A' ? 'channelA' : 'channelB';
    this.setState({
      mixer: {
        ...this.state.mixer,
        [channelKey]: {
          ...this.state.mixer[channelKey],
          volume: clamped,
        },
      },
    });
  }

  /**
   * Ajusta la posición del crossfader (0 a 100) y sincroniza con el motor usando la curva actual.
   */
  public setCrossfader(position: number): void {
    const clamped = Math.max(0, Math.min(100, position));
    try {
      audioEngine.setCrossfader(clamped, this.state.mixer.crossfaderCurve);
    } catch {
      // Ignorar si el motor aún no está disponible
    }

    this.setState({
      mixer: {
        ...this.state.mixer,
        crossfader: clamped,
      },
    });
  }

  /**
   * Modifica la curva de atenuación del crossfader y recalcula las ganancias con la posición actual.
   */
  public setCrossfaderCurve(curve: CrossfaderCurve): void {
    try {
      audioEngine.setCrossfader(this.state.mixer.crossfader, curve);
    } catch {
      // Ignorar si el motor aún no está disponible
    }

    this.setState({
      mixer: {
        ...this.state.mixer,
        crossfaderCurve: curve,
      },
    });
  }

  /**
   * Conmuta o establece la pre-escucha (CUE/PFL) del canal.
   */
  public setCuePfl(deckId: DeckId, active: boolean): void {
    const channelKey = deckId === 'A' ? 'channelA' : 'channelB';
    this.setState({
      mixer: {
        ...this.state.mixer,
        [channelKey]: {
          ...this.state.mixer[channelKey],
          cuePfl: active,
        },
      },
    });
  }

  // Aliases compatibles con MixerActions
  public setGain(deckId: DeckId, gain: number): void {
    this.setChannelGain(deckId, gain);
  }

  public setEq(deckId: DeckId, band: keyof Omit<ChannelEq, 'filter'>, value: number): void {
    this.setChannelEq(deckId, band, value);
  }

  public setFilter(deckId: DeckId, value: number): void {
    this.setChannelFilter(deckId, value);
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
          const currentA = audioEngine.getDeckCurrentTime('A');
          let phaseA = this.state.deckA.phaseAlignment;
          if (phaseA.status === 'active') {
            const progress = audioEngine.getDeckSlewProgressPercent('A');
            phaseA = { ...phaseA, progressPercent: progress };
          }
          updates.deckA = {
            ...this.state.deckA,
            currentTime: currentA,
            phaseAlignment: phaseA,
          };
        }
        if (bPlaying) {
          const currentB = audioEngine.getDeckCurrentTime('B');
          let phaseB = this.state.deckB.phaseAlignment;
          if (phaseB.status === 'active') {
            const progress = audioEngine.getDeckSlewProgressPercent('B');
            phaseB = { ...phaseB, progressPercent: progress };
          }
          updates.deckB = {
            ...this.state.deckB,
            currentTime: currentB,
            phaseAlignment: phaseB,
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
  mixer: MixerState;
  loadTrackToDeckA: (track: Track) => Promise<boolean>;
  playDeckA: () => Promise<void>;
  pauseDeckA: () => void;
  togglePlayDeckA: () => Promise<void>;
  stopDeckA: () => void;
  seekDeckA: (positionSeconds: number) => void;
  setPitchDeckA: (pitchValue: number) => void;
  pitchBendDeckA: (direction: 'up' | 'down' | 'release') => void;
  unloadDeckA: () => void;
  loadTrackToDeckB: (track: Track) => Promise<boolean>;
  playDeckB: () => Promise<void>;
  pauseDeckB: () => void;
  togglePlayDeckB: () => Promise<void>;
  stopDeckB: () => void;
  seekDeckB: (positionSeconds: number) => void;
  setPitchDeckB: (pitchValue: number) => void;
  pitchBendDeckB: (direction: 'up' | 'down' | 'release') => void;
  unloadDeckB: () => void;
  loadTrackToDeck: (deckId: DeckId, track: Track) => Promise<boolean>;
  playDeck: (deckId: DeckId) => Promise<void>;
  pauseDeck: (deckId: DeckId) => void;
  togglePlayDeck: (deckId: DeckId) => Promise<void>;
  stopDeck: (deckId: DeckId) => void;
  seekDeck: (deckId: DeckId, positionSeconds: number) => void;
  setPitchDeck: (deckId: DeckId, pitchValue: number) => void;
  pitchBend: (deckId: DeckId, direction: 'up' | 'down' | 'release') => void;
  unloadDeck: (deckId: DeckId) => void;
  setMasterVolume: (volume: number) => void;
  toggleMasterMute: () => void;

  // Acciones del Mixer
  setChannelGain: (deckId: DeckId, gain: number) => void;
  setChannelEq: (deckId: DeckId, band: keyof Omit<ChannelEq, 'filter'>, value: number) => void;
  setChannelFilter: (deckId: DeckId, value: number) => void;
  setChannelVolume: (deckId: DeckId, volume: number) => void;
  setCrossfader: (position: number) => void;
  setCrossfaderCurve: (curve: CrossfaderCurve) => void;
  setCuePfl: (deckId: DeckId, active: boolean) => void;

  // Aliases compatibles con MixerActions
  setGain: (deckId: DeckId, gain: number) => void;
  setEq: (deckId: DeckId, band: keyof Omit<ChannelEq, 'filter'>, value: number) => void;
  setFilter: (deckId: DeckId, value: number) => void;

  // Análisis musical y sincronización
  analyzeTrack: (track: Track, force?: boolean) => Promise<TrackAnalysis>;
  updateTrackAnalysis: (trackId: string, analysis: TrackAnalysis) => Promise<boolean>;

  // CUE principal y CUP
  setMainCue: (deckId: DeckId, positionSeconds?: number) => Promise<void>;
  jumpToMainCue: (deckId: DeckId) => void;
  handleCueDown: (deckId: DeckId) => Promise<void>;
  handleCueUp: (deckId: DeckId) => void;
  cancelCup: (deckId: DeckId) => void;

  // Hot Cues (1 a 8)
  setHotCue: (deckId: DeckId, slotNumber: number, positionSeconds?: number) => Promise<boolean>;
  jumpToHotCue: (deckId: DeckId, slotNumber: number) => void;
  deleteHotCue: (deckId: DeckId, slotNumber: number) => Promise<boolean>;

  // Sincronización de tempo
  syncMasterDeck: DeckId | null;
  syncDeckA: () => boolean;
  syncDeckB: () => boolean;
  syncDeck: (deckId: DeckId) => boolean;
  toggleSync: (deckId: DeckId) => boolean;

  // Alineación de fase mediante micro-slew
  alignPhaseA: () => boolean;
  alignPhaseB: () => boolean;
  alignPhase: (deckId: DeckId) => boolean;
  cancelPhaseAlignment: (deckId: DeckId) => void;
} {
  const state = useSyncExternalStore(djStore.subscribe, djStore.getSnapshot);

  return {
    deckA: state.deckA,
    deckB: state.deckB,
    syncMasterDeck: state.syncMasterDeck,
    masterVolume: state.masterVolume,
    isMasterMuted: state.isMasterMuted,
    mixer: state.mixer,

    // Deck A
    loadTrackToDeckA: djStore.loadTrackToDeckA.bind(djStore),
    playDeckA: djStore.playDeckA.bind(djStore),
    pauseDeckA: djStore.pauseDeckA.bind(djStore),
    togglePlayDeckA: djStore.togglePlayDeckA.bind(djStore),
    stopDeckA: djStore.stopDeckA.bind(djStore),
    seekDeckA: djStore.seekDeckA.bind(djStore),
    setPitchDeckA: djStore.setPitchDeckA.bind(djStore),
    pitchBendDeckA: djStore.pitchBendDeckA.bind(djStore),
    syncDeckA: djStore.syncDeckA.bind(djStore),
    alignPhaseA: djStore.alignPhaseDeckA.bind(djStore),
    unloadDeckA: djStore.unloadDeckA.bind(djStore),

    // Deck B
    loadTrackToDeckB: djStore.loadTrackToDeckB.bind(djStore),
    playDeckB: djStore.playDeckB.bind(djStore),
    pauseDeckB: djStore.pauseDeckB.bind(djStore),
    togglePlayDeckB: djStore.togglePlayDeckB.bind(djStore),
    stopDeckB: djStore.stopDeckB.bind(djStore),
    seekDeckB: djStore.seekDeckB.bind(djStore),
    setPitchDeckB: djStore.setPitchDeckB.bind(djStore),
    pitchBendDeckB: djStore.pitchBendDeckB.bind(djStore),
    syncDeckB: djStore.syncDeckB.bind(djStore),
    alignPhaseB: djStore.alignPhaseDeckB.bind(djStore),
    unloadDeckB: djStore.unloadDeckB.bind(djStore),

    // Acciones genéricas por deckId
    loadTrackToDeck: djStore.loadTrackToDeck.bind(djStore),
    playDeck: djStore.playDeck.bind(djStore),
    pauseDeck: djStore.pauseDeck.bind(djStore),
    togglePlayDeck: djStore.togglePlayDeck.bind(djStore),
    stopDeck: djStore.stopDeck.bind(djStore),
    seekDeck: djStore.seekDeck.bind(djStore),
    setPitchDeck: djStore.setPitchDeck.bind(djStore),
    pitchBend: djStore.pitchBend.bind(djStore),
    syncDeck: djStore.syncDeck.bind(djStore),
    toggleSync: djStore.toggleSync.bind(djStore),
    alignPhase: djStore.alignPhase.bind(djStore),
    cancelPhaseAlignment: djStore.cancelPhaseAlignment.bind(djStore),
    unloadDeck: djStore.unloadDeck.bind(djStore),

    // Master
    setMasterVolume: djStore.setMasterVolume.bind(djStore),
    toggleMasterMute: djStore.toggleMasterMute.bind(djStore),

    // Mixer
    setChannelGain: djStore.setChannelGain.bind(djStore),
    setChannelEq: djStore.setChannelEq.bind(djStore),
    setChannelFilter: djStore.setChannelFilter.bind(djStore),
    setChannelVolume: djStore.setChannelVolume.bind(djStore),
    setCrossfader: djStore.setCrossfader.bind(djStore),
    setCrossfaderCurve: djStore.setCrossfaderCurve.bind(djStore),
    setCuePfl: djStore.setCuePfl.bind(djStore),

    // Aliases MixerActions
    setGain: djStore.setChannelGain.bind(djStore),
    setEq: djStore.setChannelEq.bind(djStore),
    setFilter: djStore.setChannelFilter.bind(djStore),

    // Análisis musical y sincronización
    analyzeTrack: djStore.analyzeTrack.bind(djStore),
    updateTrackAnalysis: djStore.updateTrackAnalysis.bind(djStore),

    // CUE principal y CUP
    setMainCue: djStore.setMainCue.bind(djStore),
    jumpToMainCue: djStore.jumpToMainCue.bind(djStore),
    handleCueDown: djStore.handleCueDown.bind(djStore),
    handleCueUp: djStore.handleCueUp.bind(djStore),
    cancelCup: djStore.cancelCup.bind(djStore),

    // Hot Cues
    setHotCue: djStore.setHotCue.bind(djStore),
    jumpToHotCue: djStore.jumpToHotCue.bind(djStore),
    deleteHotCue: djStore.deleteHotCue.bind(djStore),
  };
}
