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
import type { Track, TrackAnalysis, HotCue, TrackDownbeat } from '../types/track.ts';
import type { DeckId, PhaseAlignmentState, BarSyncState, BarSyncStatus } from '../types/deck.ts';
import type { ChannelEq, ChannelStripState, CrossfaderCurve, MixerState } from '../types/mixer';
import { audioEngine } from '../audio/index.ts';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage.ts';
import { analysisSyncManager } from '../services/analysis/index.ts';
import {
  calculatePhaseAlignmentPlan,
} from '../audio/analysis/phaseAlignment.ts';
import {
  calculateBarSyncPlan,
  type BarSyncPlanResult,
  type BarSyncPlanInput,
} from '../audio/analysis/barSync.ts';
import {
  createManualDownbeatConfirmation,
  createSuggestedDownbeat,
  validateDownbeatForContent,
} from '../utils/downbeat.ts';

/** Parámetros explícitos para la confirmación manual de downbeat y métrica de compás. */
export interface ConfirmDownbeatParams {
  position: number;
  beatsPerBar: number;
  suggestedPosition?: number | null;
  confirmedAt?: number;
}

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
  /** Estado de preparación de compás (BAR SYNC V1). */
  barSync: BarSyncState;
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
  barSync: {
    status: 'idle',
    preparedPosition: null,
    previousPosition: null,
    displacementSec: null,
    targetDownbeatSec: null,
    beatsPerBar: null,
    reason: null,
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
  barSync: {
    status: 'idle',
    preparedPosition: null,
    previousPosition: null,
    displacementSec: null,
    targetDownbeatSec: null,
    beatsPerBar: null,
    reason: null,
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
  /** Identidad de selección activa por deck para protección contra resultados obsoletos (secuencia A -> B -> A). */
  private deckSelections: Record<DeckId, { trackId: string; selectionToken: number; contentHash?: string } | null> = {
    A: null,
    B: null,
  };
  /** Indicador de reproducción momentánea CUP activa por deck. */
  private isCupPlaying: Record<DeckId, boolean> = { A: false, B: false };
  private cupPressTokens: Record<DeckId, number> = { A: 0, B: 0 };

  private constructor() {
    // Escuchar la finalización natural de la reproducción en ambos decks
    audioEngine.onPlaybackEnded('A', () => {
      this.handlePlaybackEnded('A');
    });
    audioEngine.onPlaybackEnded('B', () => {
      this.handlePlaybackEnded('B');
    });

    // Escuchar actualizaciones de análisis de pistas para sincronizar reactivamente los decks
    analysisSyncManager.subscribe((trackId, analysis, metadata) => {
      this.handleAnalysisUpdated(trackId, analysis, metadata);
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

  /** Publishes the Master/Slave relationship and both role flags as one store snapshot. */
  private setSyncRoles(
    masterDeckId: DeckId | null,
    deckUpdates: Partial<Record<DeckId, Partial<DeckStoreState>>> = {}
  ): void {
    this.setState({
      syncMasterDeck: masterDeckId,
      deckA: {
        ...this.state.deckA,
        ...deckUpdates.A,
        isMaster: masterDeckId === 'A',
        isSyncActive: masterDeckId === 'B',
      },
      deckB: {
        ...this.state.deckB,
        ...deckUpdates.B,
        isMaster: masterDeckId === 'B',
        isSyncActive: masterDeckId === 'A',
      },
    });
  }

  private applyHotCuesToMatchingDecks(trackId: string, hotCues: HotCue[]): void {
    for (const deckId of ['A', 'B'] as const) {
      const deck = this.getDeckState(deckId);
      if (deck.track?.id === trackId) {
        this.setDeck(deckId, { hotCues, track: { ...deck.track, hotCues } });
      }
    }
  }

  /** Remove the SYNC link involving a deck whose track is being replaced. */
  private decoupleSyncForDeck(deckId: DeckId): void {
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    if (this.state.syncMasterDeck !== deckId && this.state.syncMasterDeck !== otherDeckId) return;

    const nextState: Partial<DJStoreState> = {
      syncMasterDeck: null,
      [deckId === 'A' ? 'deckA' : 'deckB']: {
        ...this.getDeckState(deckId),
        isMaster: false,
        isSyncActive: false,
      },
    };
    if (this.state.syncMasterDeck === deckId) {
      nextState[otherDeckId === 'A' ? 'deckA' : 'deckB'] = {
        ...this.getDeckState(otherDeckId),
        isMaster: false,
        isSyncActive: false,
      };
    } else {
      nextState[otherDeckId === 'A' ? 'deckA' : 'deckB'] = {
        ...this.getDeckState(otherDeckId),
        isMaster: false,
      };
    }
    this.setState(nextState);
  }

  /**
   * Actualiza el estado reactivo de Deck A o Deck B cuando finaliza o cambia el análisis de una pista.
   * Valida selección activa y concordancia de contentHash para evitar contaminación por resultados obsoletos.
   */
  public handleAnalysisUpdated(
    trackId: string,
    analysis: TrackAnalysis,
    metadata?: { contentHash?: string; deckId?: DeckId; selectionToken?: number }
  ): void {
    let hasChanged = false;
    const updates: Partial<DJStoreState> = {};

    const updateDeckIfValid = (targetDeckId: DeckId, deckState: DeckStoreState): DeckStoreState | null => {
      if (!deckState.track || deckState.track.id !== trackId) return null;

      const currentSelection = this.deckSelections[targetDeckId];

      // 1. Caso: Notificación vinculada explícitamente a un deck
      if (metadata?.deckId) {
        // Si no está dirigida a este deck, descartar
        if (metadata.deckId !== targetDeckId) {
          return null;
        }

        // Si el deck no tiene selección activa o el token no coincide (p. ej. A -> B -> A), descartar
        if (!currentSelection || currentSelection.selectionToken !== metadata.selectionToken) {
          return null;
        }

        // Si ambos disponen de contentHash y difieren, el contenido físico cambió: descartar
        if (
          metadata.contentHash &&
          deckState.track.fileMeta?.contentHash &&
          metadata.contentHash !== deckState.track.fileMeta.contentHash
        ) {
          return null;
        }
      } else {
        // 2. Caso: Notificación no vinculada a un deck específico (global de biblioteca o huérfana)
        // a) Si es una invalidación (status === 'pending'), se aplica para no retener métricas inválidas
        if (analysis.status === 'pending') {
          // Permitir invalidación en el deck
        } else {
          // b) Si el deck tiene una selección activa vinculada con un token:
          // Una notificación incompleta (sin deckId ni selectionToken) no puede demostrar vigencia sobre la selección activa.
          // Solo se acepta si dispone de contentHash verificado idéntico al de la selección activa.
          if (currentSelection?.selectionToken !== undefined) {
            const hasMatchingHash =
              Boolean(metadata?.contentHash) &&
              Boolean(currentSelection.contentHash) &&
              metadata?.contentHash === currentSelection.contentHash;

            if (!hasMatchingHash) {
              return null;
            }
          } else if (
            metadata?.contentHash &&
            deckState.track.fileMeta?.contentHash &&
            metadata.contentHash !== deckState.track.fileMeta.contentHash
          ) {
            return null;
          }
        }
      }

      const updatedTrack: Track = {
        ...deckState.track,
        analysis,
      };

      return {
        ...deckState,
        track: updatedTrack,
        calculatedBpm: computeEffectiveBpm(updatedTrack, deckState.playbackRate),
        keyStr: getAnalyzedKey(updatedTrack),
      };
    };

    const newDeckA = updateDeckIfValid('A', this.state.deckA);
    if (newDeckA) {
      updates.deckA = newDeckA;
      hasChanged = true;
    }

    const newDeckB = updateDeckIfValid('B', this.state.deckB);
    if (newDeckB) {
      updates.deckB = newDeckB;
      hasChanged = true;
    }

    if (hasChanged) {
      this.setState(updates);
    }
  }

  /**
   * Solicita el análisis musical de una pista sincronizado con IndexedDB y el store.
   * Si se especifica deckId, asocia la solicitud con el selectionToken actual del deck.
   */
  public async analyzeTrack(track: Track, force = false, deckId?: DeckId): Promise<TrackAnalysis> {
    const selectionToken = deckId ? this.deckSelections[deckId]?.selectionToken : undefined;
    return analysisSyncManager.analyzeTrack(track, { force, deckId, selectionToken });
  }

  /**
   * Actualiza el análisis de una pista atómicamente y sincroniza los decks si está cargada.
   */
  public async updateTrackAnalysis(trackId: string, analysis: TrackAnalysis): Promise<boolean> {
    const success = await indexedDBStorage.updateTrackAnalysis(trackId, analysis);
    const metaA = this.deckSelections.A?.trackId === trackId
      ? { deckId: 'A' as DeckId, selectionToken: this.deckSelections.A.selectionToken, contentHash: this.deckSelections.A.contentHash }
      : undefined;
    const metaB = this.deckSelections.B?.trackId === trackId
      ? { deckId: 'B' as DeckId, selectionToken: this.deckSelections.B.selectionToken, contentHash: this.deckSelections.B.contentHash }
      : undefined;

    if (metaA) {
      this.handleAnalysisUpdated(trackId, analysis, metaA);
    }
    if (metaB) {
      this.handleAnalysisUpdated(trackId, analysis, metaB);
    }
    if (!metaA && !metaB) {
      this.handleAnalysisUpdated(trackId, analysis);
    }
    return success;
  }

  /**
   * Carga una pista en el deck especificado recuperando su audio binario desde IndexedDB o respaldo.
   * Devuelve `true` si la pista quedó cargada y lista para reproducirse.
   */
  public async loadTrackToDeck(deckId: DeckId, track: Track): Promise<boolean> {
    const oppositeDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    const token = ++this.loadTokens[deckId];

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
      const validPosition = (position: unknown): position is number =>
        typeof position === 'number' && Number.isFinite(position) && position >= 0 && position <= effectiveTrack.duration;
      const mainCueCandidate = persistedCues?.mainCue ?? effectiveTrack.mainCue;
      const mainCue = validPosition(mainCueCandidate) ? mainCueCandidate : null;
      const sourceHotCues = persistedCues?.hotCues.length ? persistedCues.hotCues : (effectiveTrack.hotCues ?? []);
      const hotCues = sourceHotCues.filter((cue) =>
        Number.isInteger(cue.id) && cue.id >= 1 && cue.id <= 8 && cue.trackId === track.id && validPosition(cue.position)
      ).slice(0, 8);
      effectiveTrack = { ...effectiveTrack, mainCue, hotCues };
    } catch {
      // Ignorar si no está disponible
    }

    // Recuperar Downbeat guardado si existe en almacenamiento persistente
    try {
      const persistedDownbeat = await indexedDBStorage.getTrackDownbeat(track.id);
      if (persistedDownbeat) {
        const validatedDownbeat = validateDownbeatForContent(
          persistedDownbeat,
          effectiveTrack.fileMeta?.contentHash
        );
        effectiveTrack = {
          ...effectiveTrack,
          downbeat: validatedDownbeat ?? persistedDownbeat,
        };
      }
    } catch {
      // Ignorar si no está disponible
    }

    if (token !== this.loadTokens[deckId]) return false;

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
      return false;
    }

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();

      // 2. Reanudar contexto si fuera necesario
      await audioEngine.resume();

      // 3. Decodificar audio
      const audioBuffer = await audioEngine.decodeAudioData(arrayBuffer);

      if (token !== this.loadTokens[deckId]) return false;

      // Commit only after the replacement is decoded. Until here, the current
      // track, transport, pitch and SYNC relationship remain untouched.
      this.cancelCup(deckId);
      this.cancelPhaseAlignment(deckId);
      this.cancelPhaseAlignment(oppositeDeckId);
      this.decoupleSyncForDeck(deckId);

      // 4. Replace the audio and synchronize the current pitch and volume.
      audioEngine.loadBufferToDeck(deckId, audioBuffer);
      audioEngine.setDeckPitchBend(deckId, 0);
      audioEngine.setDeckPlaybackRate(deckId, this.getDeckState(deckId).playbackRate);
      audioEngine.setMasterVolume(this.state.isMasterMuted ? 0 : this.state.masterVolume);

      this.setDeck(deckId, {
        track: effectiveTrack,
        duration: audioBuffer.duration,
        currentTime: 0,
        playbackState: 'stopped',
        calculatedBpm: computeEffectiveBpm(effectiveTrack, this.getDeckState(deckId).playbackRate),
        keyStr: getAnalyzedKey(effectiveTrack),
        mainCue: effectiveTrack.mainCue ?? null,
        hotCues: effectiveTrack.hotCues ? [...effectiveTrack.hotCues] : [],
        pitchBend: 0,
        isSyncActive: false,
        isMaster: false,
        phaseAlignment: { status: 'idle', progressPercent: 0 },
        barSync: { status: 'idle', preparedPosition: null, previousPosition: null, displacementSec: null, targetDownbeatSec: null, beatsPerBar: null, reason: null },
        errorCode: null,
        errorMessage: null,
      });

      // Si el otro deck tenía una preparación de BAR SYNC armada o alineada,
      // invalidarla porque su contexto métrico / Master ha cambiado.
      const otherDeck = this.getDeckState(oppositeDeckId);
      if (otherDeck.barSync?.status === 'armed' || otherDeck.barSync?.status === 'already_aligned') {
        this.setDeck(oppositeDeckId, {
          barSync: { status: 'idle', preparedPosition: null, previousPosition: null, displacementSec: null, targetDownbeatSec: null, beatsPerBar: null, reason: null },
        });
      }

      this.deckSelections[deckId] = {
        trackId: effectiveTrack.id,
        selectionToken: token,
        contentHash: effectiveTrack.fileMeta?.contentHash,
      };
      this.checkStopTimeLoop();

      return true;
    } catch (err) {
      if (token !== this.loadTokens[deckId]) return false;
      console.error(`[useDJStore] Error decodificando la pista en Deck ${deckId}:`, err);
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
      const updates: Partial<DeckStoreState> = { playbackState: 'playing' };
      if (deckState.barSync?.status === 'armed' || deckState.barSync?.status === 'already_aligned') {
        updates.barSync = {
          status: 'completed',
          preparedPosition: deckState.barSync.preparedPosition,
          previousPosition: deckState.barSync.previousPosition,
          displacementSec: deckState.barSync.displacementSec,
          targetDownbeatSec: deckState.barSync.targetDownbeatSec,
          beatsPerBar: deckState.barSync.beatsPerBar,
          reason: null,
        };
      }
      this.setDeck(deckId, updates);
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
    const updates: Partial<DeckStoreState> = { playbackState: 'stopped', currentTime: 0, isCupPlaying: false };
    if (deckState.barSync?.status === 'armed' || deckState.barSync?.status === 'already_aligned') {
      updates.barSync = {
        status: 'idle',
        preparedPosition: null,
        previousPosition: null,
        displacementSec: null,
        targetDownbeatSec: null,
        beatsPerBar: null,
        reason: null,
      };
    }
    this.setDeck(deckId, updates);
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
    const updates: Partial<DeckStoreState> = { currentTime: clamped, isCupPlaying: false };
    if (deckState.barSync?.status === 'armed' || deckState.barSync?.status === 'already_aligned') {
      updates.barSync = {
        status: 'idle',
        preparedPosition: null,
        previousPosition: null,
        displacementSec: null,
        targetDownbeatSec: null,
        beatsPerBar: null,
        reason: null,
      };
    }
    this.setDeck(deckId, updates);
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

    const barSyncReset = (deck.barSync?.status === 'armed' || deck.barSync?.status === 'already_aligned')
      ? { status: 'idle' as const, preparedPosition: null, previousPosition: null, displacementSec: null, targetDownbeatSec: null, beatsPerBar: null, reason: null }
      : undefined;

    if (deck.playbackState === 'playing') {
      audioEngine.pauseDeck(deckId);
      audioEngine.seekDeck(deckId, targetPos);
      this.setDeck(deckId, {
        playbackState: 'paused',
        currentTime: targetPos,
        isCupPlaying: false,
        ...(barSyncReset ? { barSync: barSyncReset } : {}),
      });
      this.checkStopTimeLoop();
    } else {
      audioEngine.seekDeck(deckId, targetPos);
      this.setDeck(deckId, {
        currentTime: targetPos,
        isCupPlaying: false,
        ...(barSyncReset ? { barSync: barSyncReset } : {}),
      });
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

    if (this.isCupPlaying[deckId]) return;
    const pressToken = ++this.cupPressTokens[deckId];
    const trackId = deck.track.id;
    this.isCupPlaying[deckId] = true;
    this.setDeck(deckId, { isCupPlaying: true });

    // Estado paused o stopped:
    // Si no había mainCue, o si la posición actual se movió más de 50 ms del CUE existente, actualizar CUE
    const currentCue = deck.mainCue ?? 0;
    if (deck.mainCue === null || Math.abs(deck.currentTime - currentCue) > 0.05) {
      await this.setMainCue(deckId, deck.currentTime);
    }

    if (this.cupPressTokens[deckId] !== pressToken || !this.isCupPlaying[deckId] || this.getDeckState(deckId).track?.id !== trackId) return;

    // Iniciar reproducción CUP
    const cueToPlay = this.getDeckState(deckId).mainCue ?? 0;
    try {
      await audioEngine.resume();
      if (this.cupPressTokens[deckId] !== pressToken || !this.isCupPlaying[deckId] || this.getDeckState(deckId).track?.id !== trackId) return;
      audioEngine.playDeck(deckId, cueToPlay);
      const updates: Partial<DeckStoreState> = { playbackState: 'playing', currentTime: cueToPlay, isCupPlaying: true };
      if (deck.barSync?.status === 'armed' || deck.barSync?.status === 'already_aligned') {
        updates.barSync = {
          status: 'completed',
          preparedPosition: deck.barSync.preparedPosition,
          previousPosition: deck.barSync.previousPosition,
          displacementSec: deck.barSync.displacementSec,
          targetDownbeatSec: deck.barSync.targetDownbeatSec,
          beatsPerBar: deck.barSync.beatsPerBar,
          reason: null,
        };
      }
      this.setDeck(deckId, updates);
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
    this.cupPressTokens[deckId] += 1;
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

    try {
      const persisted = await indexedDBStorage.updateTrackCues(deck.track.id, { hotCues: updatedCues });
      if (!persisted) return false;
      this.applyHotCuesToMatchingDecks(deck.track.id, updatedCues);
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
    try {
      const persisted = await indexedDBStorage.updateTrackCues(deck.track.id, { hotCues: updatedCues });
      if (!persisted) return false;
      this.applyHotCuesToMatchingDecks(deck.track.id, updatedCues);
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
    }

    const pitchUpdate: Partial<DeckStoreState> = {
      pitch: clampedPitch,
      playbackRate: rate,
      calculatedBpm: computeEffectiveBpm(deckState.track, rate),
      isSyncActive,
    };
    if (deckState.isSyncActive && this.state.syncMasterDeck === otherDeckId) {
      this.setSyncRoles(null, { [deckId]: pitchUpdate });
    } else {
      this.setDeck(deckId, pitchUpdate);
    }

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
          this.setSyncRoles(null, {
            [otherDeckId]: {
              errorMessage: 'SYNC desactivado: el tempo del Master excedió el rango de pitch alcanzable (±8%).',
            },
          });
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

    let effectiveBendPercent = bendPercent;
    if (deckState.track && deckState.duration > 0) {
      audioEngine.setDeckPitchBend(deckId, bendAmount);
      const effectiveRate = audioEngine.calculateEffectiveRate(deckState.playbackRate, bendAmount);
      effectiveBendPercent = Number((((effectiveRate / deckState.playbackRate) - 1) * 100).toFixed(4));
    }

    this.setDeck(deckId, {
      pitchBend: effectiveBendPercent,
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
   * 2. Si ambos están en reproducción o detenidos, el opuesto al pulsado actúa como MASTER.
   *
   * Reglas de validación:
   * 1. No utiliza relaciones de medio/doble tiempo automáticamente.
   * 2. Rechaza si falta pista o BPM analizado en cualquiera de los dos decks.
   * 3. Rechaza si la velocidad requerida excede [0.92, 1.08] (±8%) sin recortar silenciosamente.
   * 4. Asimetría estricta: Master inmutable (isMaster: true, isSyncActive: false),
   *    Slave dependiente (isMaster: false, isSyncActive: true).
   */
  public syncDeck(deckId: DeckId): boolean {
    let slaveDeckId: DeckId = deckId;
    let masterDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    const deckA = this.getDeckState('A');
    const deckB = this.getDeckState('B');
    const aPlaying = deckA.playbackState === 'playing';
    const bPlaying = deckB.playbackState === 'playing';
    if (aPlaying !== bPlaying) {
      masterDeckId = aPlaying ? 'A' : 'B';
      slaveDeckId = masterDeckId === 'A' ? 'B' : 'A';
    }
    const slaveDeck = this.getDeckState(slaveDeckId);
    const masterDeck = this.getDeckState(masterDeckId);

    // 1. Si SYNC ya está activo en este deck: DESACTIVAR conservando la velocidad actual
    if (slaveDeckId === deckId && slaveDeck.isSyncActive) {
      // Si el otro deck era el Master y ya no tiene esclavos, liberar rol de Master
      if (this.state.syncMasterDeck === masterDeckId) {
        this.setSyncRoles(null);
      } else {
        this.setDeck(slaveDeckId, { isSyncActive: false });
      }
      return false;
    }

    // Validate both selected roles before changing synchronization state.
    if (!slaveDeck.track || slaveDeck.duration <= 0) {
      this.setDeck(slaveDeckId, {
        errorCode: 'sync_failed',
        errorMessage: 'No es posible sincronizar: este deck no tiene una pista cargada.',
      });
      return false;
    }

    const slaveBaseBpm = getAnalyzedBpm(slaveDeck.track);
    if (typeof slaveBaseBpm !== 'number' || slaveBaseBpm <= 0) {
      this.setDeck(slaveDeckId, {
        errorCode: 'sync_failed',
        errorMessage: 'No es posible sincronizar: la pista no tiene un BPM analizado válido.',
      });
      return false;
    }

    // 3. Validación de la pista del deck de referencia (Maestro)
    if (!masterDeck.track || masterDeck.duration <= 0) {
      this.setDeck(slaveDeckId, {
        errorCode: 'sync_failed',
        errorMessage: 'No es posible sincronizar: el deck opuesto no tiene una pista cargada para actuar como Master.',
      });
      return false;
    }

    const masterBaseBpm = getAnalyzedBpm(masterDeck.track);
    if (typeof masterBaseBpm !== 'number' || masterBaseBpm <= 0) {
      this.setDeck(slaveDeckId, {
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
      this.setDeck(slaveDeckId, {
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
    // Cancelar micro-slew solo tras validar ambos decks y el ratio requerido.
    this.cancelPhaseAlignment(slaveDeckId);
    this.cancelPhaseAlignment(masterDeckId);
    audioEngine.setDeckPlaybackRate(slaveDeckId, requiredRate);

    // 9. Actualizar estado garantizando asimetría Maestro/Esclavo
    this.setSyncRoles(masterDeckId, {
      [slaveDeckId]: {
        pitch: targetPitch,
        playbackRate: requiredRate,
        calculatedBpm: Number((slaveBaseBpm * requiredRate).toFixed(1)),
        errorCode: null,
        errorMessage: null,
      },
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

    const slaveFirstBeat = slaveAnalysis?.firstBeatTime;
    const masterFirstBeat = masterAnalysis?.firstBeatTime;
    if (
      typeof slaveFirstBeat !== 'number' || !Number.isFinite(slaveFirstBeat) || slaveFirstBeat < 0 || slaveFirstBeat > slaveState.duration ||
      typeof masterFirstBeat !== 'number' || !Number.isFinite(masterFirstBeat) || masterFirstBeat < 0 || masterFirstBeat > masterState.duration ||
      slaveAnalysis?.isAmbiguous === true || masterAnalysis?.isAmbiguous === true
    ) {
      this.setDeck(slaveDeckId, {
        phaseAlignment: {
          status: 'rejected_confidence',
          progressPercent: 0,
          reason: 'Ambos decks requieren un primer beat válido y una referencia métrica no ambigua.',
        },
      });
      return false;
    }

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
      masterIsAmbiguous: Boolean(masterAnalysis?.isAmbiguous),

      slaveCurrentTime: audioEngine.getDeckCurrentTime(slaveDeckId),
      slaveBpm,
      slaveFirstBeatTime: slaveFirstBeat,
      slaveDuration: slaveState.duration,
      slavePlaybackRate: slaveState.playbackRate,
      slaveBendAmount: slaveBend,
      slaveBpmConfidence: slaveAnalysis?.bpmConfidence,
      slaveIsAmbiguous: Boolean(slaveAnalysis?.isAmbiguous),
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
   * Prepara el deck Esclavo detenido o pausado en la frontera de compás (Downbeat)
   * calculada con base en la fase musical del deck Maestro en reproducción.
   *
   * Cumple rigurosamente el contrato de BAR SYNC V1 (Fase 23.4 — Etapa C.4):
   * 1. Asimetría estricta: Master en reproducción ('playing'), Slave detenido ('stopped') o pausado ('paused').
   * 2. No inicia reproducción automáticamente (ni PLAY ni CUP).
   * 3. No altera tempo, pitch, playbackRate, SYNC ni asignación de Master.
   * 4. Exige confirmación manual explícita ('manual') vinculada al contentHash verificado en ambos decks.
   * 5. Exige compatibilidad métrica idéntica (beatsPerBar).
   * 6. Prepara el Slave en targetPosition utilizando exclusivamente la API segura seekDeck sobre deck detenido/pausado.
   * 7. Si ya está alineado dentro de la tolerancia, no reposiciona el transporte ('already_aligned').
   * 8. Si falla el cálculo o el posicionamiento, no declara 'armed' y registra el estado de rechazo correspondiente.
   * 9. Invalida operaciones obsoletas si la selección o el hash del archivo cambian concurrentemente.
   */
  public prepareBarSync(deckId: DeckId, toleranceSec?: number): BarSyncPlanResult {
    const slaveDeckId: DeckId = deckId;
    const masterDeckId: DeckId = deckId === 'A' ? 'B' : 'A';

    const slaveState = this.getDeckState(slaveDeckId);
    const masterState = this.getDeckState(masterDeckId);

    const reject = (status: BarSyncStatus, reason: string): BarSyncPlanResult => {
      const result: BarSyncPlanResult = {
        status,
        targetPosition: null,
        targetDownbeatSec: null,
        beatsPerBar: null,
        masterBarPhase: null,
        masterBarPeriodSec: null,
        timeToNextMasterDownbeatSec: null,
        slaveBarPeriodSec: null,
        targetBarIndex: null,
        reason,
      };
      this.setDeck(slaveDeckId, {
        barSync: {
          status,
          preparedPosition: null,
          previousPosition: null,
          displacementSec: null,
          targetDownbeatSec: null,
          beatsPerBar: null,
          reason,
        },
      });
      return result;
    };

    // 0. Comprobación estricta de roles: el deck designado como Master no puede prepararse como Esclavo
    if (slaveState.isMaster || this.state.syncMasterDeck === slaveDeckId) {
      return reject(
        'rejected_state',
        'El deck actúa como Master de sincronización; solo el deck esclavo puede prepararse con BAR SYNC.'
      );
    }

    // 1. Validar estados de transporte: Master debe estar en reproducción activa ('playing')
    if (masterState.playbackState !== 'playing') {
      return reject(
        'rejected_state',
        `El deck Master debe estar en reproducción activa (estado actual: ${masterState.playbackState})`
      );
    }

    // 2. Slave debe estar detenido o pausado (nunca 'playing')
    if (slaveState.playbackState === 'playing') {
      return reject(
        'rejected_state',
        'El deck Slave está reproduciéndose. BAR SYNC V1 solo prepara decks detenidos o pausados (micro-slew de compás no permitido en V1)'
      );
    }

    if (slaveState.playbackState === 'loading' || slaveState.playbackState === 'error') {
      return reject(
        'rejected_state',
        `El deck Slave no está listo para preparación de transporte (estado actual: ${slaveState.playbackState})`
      );
    }

    // 3. Capturar instantánea de identidad y token para detección de operaciones obsoletas
    const slaveSelection = this.deckSelections[slaveDeckId];
    const slaveTrack = slaveState.track;
    const slaveToken = slaveSelection?.selectionToken;
    const slaveTrackId = slaveTrack?.id;
    const slaveContentHash = slaveTrack?.fileMeta?.contentHash ?? slaveSelection?.contentHash;

    const masterSelection = this.deckSelections[masterDeckId];
    const masterTrack = masterState.track;
    const masterToken = masterSelection?.selectionToken;
    const masterTrackId = masterTrack?.id;
    const masterContentHash = masterTrack?.fileMeta?.contentHash ?? masterSelection?.contentHash;

    // Verificar presencia de pistas cargadas
    if (!slaveTrack || slaveState.duration <= 0) {
      return reject('rejected_limits', 'El deck Slave no tiene una pista válida cargada');
    }
    if (!masterTrack || masterState.duration <= 0) {
      return reject('rejected_limits', 'El deck Master no tiene una pista válida cargada');
    }

    // 4. Obtener posiciones reales de transporte desde el motor de audio
    const masterCurrentTime = audioEngine.getDeckCurrentTime(masterDeckId);
    const slaveCurrentTime = audioEngine.getDeckCurrentTime(slaveDeckId);

    // Obtener BPM base y calcular BPM efectivo
    const masterBaseBpm = getAnalyzedBpm(masterTrack);
    const slaveBaseBpm = getAnalyzedBpm(slaveTrack);

    if (typeof masterBaseBpm !== 'number' || masterBaseBpm <= 0) {
      return reject('rejected_limits', 'El deck Master no dispone de un BPM analizado válido');
    }
    if (typeof slaveBaseBpm !== 'number' || slaveBaseBpm <= 0) {
      return reject('rejected_limits', 'El deck Slave no dispone de un BPM analizado válido');
    }

    const masterEffectiveBpm = Number((masterBaseBpm * masterState.playbackRate).toFixed(4));
    const slaveEffectiveBpm = Number((slaveBaseBpm * slaveState.playbackRate).toFixed(4));

    // 5. Construir parámetros para calculateBarSyncPlan
    const planInput: BarSyncPlanInput = {
      master: {
        playbackState: masterState.playbackState,
        currentTime: masterCurrentTime,
        duration: masterState.duration,
        bpm: masterBaseBpm,
        playbackRate: masterState.playbackRate,
        effectiveBpm: masterEffectiveBpm,
        downbeat: masterTrack.downbeat,
        contentHash: masterContentHash,
      },
      slave: {
        playbackState: slaveState.playbackState,
        currentTime: slaveCurrentTime,
        duration: slaveState.duration,
        bpm: slaveBaseBpm,
        playbackRate: slaveState.playbackRate,
        effectiveBpm: slaveEffectiveBpm,
        downbeat: slaveTrack.downbeat,
        contentHash: slaveContentHash,
      },
      toleranceSec,
    };

    // 6. Invocar el algoritmo puro
    const plan = calculateBarSyncPlan(planInput);

    // 7. Si fue rechazado por el planificador puro, registrar y retornar sin mover transporte
    if (plan.status !== 'armed' && plan.status !== 'already_aligned') {
      return reject(plan.status, plan.reason ?? 'Cálculo de BAR SYNC rechazado');
    }

    // 8. Verificación anti-carrera (comprobar que la pista, token y contentHash no hayan cambiado)
    const currentSlaveSelection = this.deckSelections[slaveDeckId];
    const currentSlaveState = this.getDeckState(slaveDeckId);
    const currentMasterSelection = this.deckSelections[masterDeckId];
    const currentMasterState = this.getDeckState(masterDeckId);

    if (
      currentSlaveSelection?.selectionToken !== slaveToken ||
      currentSlaveState.track?.id !== slaveTrackId ||
      (currentSlaveState.track?.fileMeta?.contentHash ?? currentSlaveSelection?.contentHash) !== slaveContentHash ||
      currentMasterSelection?.selectionToken !== masterToken ||
      currentMasterState.track?.id !== masterTrackId ||
      (currentMasterState.track?.fileMeta?.contentHash ?? currentMasterSelection?.contentHash) !== masterContentHash ||
      currentSlaveState.playbackState === 'playing' ||
      currentMasterState.playbackState !== 'playing'
    ) {
      return reject('rejected_state', 'La pista o el estado de transporte cambiaron durante la preparación; operación obsoleta descartada');
    }

    // 9. Si el estado es 'already_aligned', registrar posición real y diferencia sin ejecutar seek
    if (plan.status === 'already_aligned') {
      const realPosition = Number(slaveCurrentTime.toFixed(3));
      const targetPos = plan.targetPosition ?? realPosition;
      const diffToTarget = Number((realPosition - targetPos).toFixed(3));
      this.setDeck(slaveDeckId, {
        barSync: {
          status: 'already_aligned',
          preparedPosition: realPosition,
          previousPosition: realPosition,
          displacementSec: diffToTarget,
          targetDownbeatSec: plan.targetDownbeatSec,
          beatsPerBar: plan.beatsPerBar,
          reason: null,
        },
      });
      return plan;
    }

    // 10. Si el estado es 'armed', aplicar posicionamiento estático seguro en el transporte
    const targetPos = plan.targetPosition;
    if (typeof targetPos !== 'number' || !Number.isFinite(targetPos) || targetPos < 0 || targetPos > slaveState.duration) {
      return reject('rejected_limits', `Posición objetivo calculada (${targetPos}) fuera de límites válidos`);
    }

    try {
      audioEngine.seekDeck(slaveDeckId, targetPos);
      const verifiedTime = audioEngine.getDeckCurrentTime(slaveDeckId);
      // Validar que el motor realmente aceptó y posicionó el cabezal dentro de un margen seguro (10 ms)
      if (Math.abs(verifiedTime - targetPos) > 0.01) {
        throw new Error(`Posición reportada por el transporte (${verifiedTime.toFixed(3)}s) discrepa de la posición objetivo (${targetPos.toFixed(3)}s)`);
      }
    } catch (err) {
      const errorReason = `Fallo al posicionar el cabezal en el motor de audio: ${err instanceof Error ? err.message : String(err)}`;
      return reject('rejected_state', errorReason);
    }

    // 11. Registrar en el store el estado exitosamente armado sin alterar playbackState (conserva stopped o paused)
    const verifiedPos = Number(audioEngine.getDeckCurrentTime(slaveDeckId).toFixed(3));
    const prevPos = Number(slaveCurrentTime.toFixed(3));
    const displacement = Number((verifiedPos - prevPos).toFixed(3));

    this.setDeck(slaveDeckId, {
      currentTime: targetPos,
      isCupPlaying: false,
      barSync: {
        status: 'armed',
        preparedPosition: verifiedPos,
        previousPosition: prevPos,
        displacementSec: displacement,
        targetDownbeatSec: plan.targetDownbeatSec,
        beatsPerBar: plan.beatsPerBar,
        reason: null,
      },
    });

    return plan;
  }

  public prepareBarSyncDeckA(toleranceSec?: number): BarSyncPlanResult {
    return this.prepareBarSync('A', toleranceSec);
  }

  public prepareBarSyncDeckB(toleranceSec?: number): BarSyncPlanResult {
    return this.prepareBarSync('B', toleranceSec);
  }

  public cancelBarSync(deckId: DeckId): void {
    const currentDeck = this.getDeckState(deckId);
    if (currentDeck.barSync?.status === 'armed' || currentDeck.barSync?.status === 'already_aligned') {
      this.setDeck(deckId, {
        barSync: {
          status: 'cancelled',
          preparedPosition: null,
          previousPosition: null,
          displacementSec: null,
          targetDownbeatSec: null,
          beatsPerBar: null,
          reason: 'Preparación de BAR SYNC cancelada manualmente',
        },
      });
    }
  }

  // =========================================================================
  // Confirmación Manual y Limpieza de Downbeat (BAR SYNC V1 — Fase 23.4)
  // =========================================================================

  /**
   * Confirma manualmente el downbeat y la métrica de compás para la pista actualmente cargada en el deck.
   *
   * Invariantes y protecciones:
   * 1. Exige posición no negativa finita (dentro de la duración si es conocida) y métrica entera positiva >= 1.
   * 2. Exige un contentHash SHA-256 válido (64 caracteres hex) asociado a la pista cargada.
   * 3. Valida la identidad y el token de selección antes y después de la persistencia asíncrona.
   * 4. Persiste atómicamente a través de IndexedDBStorage.updateTrackDownbeat sin duplicar lógica de almacenamiento.
   * 5. Actualiza inmediatamente el estado reactivo del deck tras persistencia satisfactoria.
   * 6. Si la misma pista está cargada en el otro deck, mantiene ambos estados coherentes.
   * 7. Ante fallo, discrepancia de hash o cambio de pista concurrente, aborta y retorna false sin mutar el estado.
   * 8. Invalida preparaciones de BAR SYNC que hayan quedado obsoletas en cualquiera de los decks.
   */
  public async confirmDownbeat(
    deckId: DeckId,
    positionOrParams: number | ConfirmDownbeatParams,
    metric?: number
  ): Promise<boolean> {
    let position: number;
    let beatsPerBar: number;
    let suggestedPositionOverride: number | null | undefined;
    let confirmedAtOverride: number | undefined;

    if (typeof positionOrParams === 'object' && positionOrParams !== null) {
      position = positionOrParams.position;
      beatsPerBar = positionOrParams.beatsPerBar;
      suggestedPositionOverride = positionOrParams.suggestedPosition;
      confirmedAtOverride = positionOrParams.confirmedAt;
    } else {
      position = positionOrParams;
      beatsPerBar = metric as number;
    }

    // 1. Validar parámetros de posición y métrica
    if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
      return false;
    }
    if (
      typeof beatsPerBar !== 'number' ||
      !Number.isFinite(beatsPerBar) ||
      !Number.isInteger(beatsPerBar) ||
      beatsPerBar < 1
    ) {
      return false;
    }

    // 2. Verificar estado inicial del deck
    const preDeckState = this.getDeckState(deckId);
    if (!preDeckState.track || preDeckState.playbackState === 'loading' || preDeckState.playbackState === 'error') {
      return false;
    }

    if (preDeckState.duration > 0 && position > preDeckState.duration) {
      return false;
    }

    // 3. Capturar instantánea de identidad y token para detección de operaciones obsoletas
    const preSelection = this.deckSelections[deckId];
    const preToken = preSelection?.selectionToken;
    const preTrack = preDeckState.track;
    const preTrackId = preTrack.id;
    const preContentHash = preTrack.fileMeta?.contentHash ?? preSelection?.contentHash;

    if (
      typeof preContentHash !== 'string' ||
      preContentHash.length !== 64 ||
      !/^[0-9a-f]{64}$/i.test(preContentHash)
    ) {
      return false;
    }

    const effectiveSuggestedPosition =
      suggestedPositionOverride !== undefined
        ? suggestedPositionOverride
        : (preTrack.downbeat?.suggestedPosition ?? null);

    let newDownbeat: TrackDownbeat;
    try {
      newDownbeat = createManualDownbeatConfirmation({
        position,
        beatsPerBar,
        contentHash: preContentHash,
        confirmedAt: confirmedAtOverride,
        suggestedPosition: effectiveSuggestedPosition,
      });
    } catch {
      return false;
    }

    return this.applyTrackDownbeatUpdate(deckId, preTrackId, preToken, preContentHash, newDownbeat);
  }

  public confirmDownbeatDeckA(
    positionOrParams: number | ConfirmDownbeatParams,
    metric?: number
  ): Promise<boolean> {
    return this.confirmDownbeat('A', positionOrParams, metric);
  }

  public confirmDownbeatDeckB(
    positionOrParams: number | ConfirmDownbeatParams,
    metric?: number
  ): Promise<boolean> {
    return this.confirmDownbeat('B', positionOrParams, metric);
  }

  public confirmDownbeatA(
    positionOrParams: number | ConfirmDownbeatParams,
    metric?: number
  ): Promise<boolean> {
    return this.confirmDownbeat('A', positionOrParams, metric);
  }

  public confirmDownbeatB(
    positionOrParams: number | ConfirmDownbeatParams,
    metric?: number
  ): Promise<boolean> {
    return this.confirmDownbeat('B', positionOrParams, metric);
  }

  /**
   * Limpia una confirmación manual existente, respetando el modelo de estados none / suggested / confirmed.
   * Si la pista poseía una posición preliminar sugerida válida, pasa a 'suggested' sin confirmación.
   * Si no la poseía, pasa a 'none'.
   */
  public async clearDownbeat(deckId: DeckId): Promise<boolean> {
    const preDeckState = this.getDeckState(deckId);
    if (!preDeckState.track || preDeckState.playbackState === 'loading' || preDeckState.playbackState === 'error') {
      return false;
    }

    const preSelection = this.deckSelections[deckId];
    const preToken = preSelection?.selectionToken;
    const preTrack = preDeckState.track;
    const preTrackId = preTrack.id;
    const preContentHash = preTrack.fileMeta?.contentHash ?? preSelection?.contentHash;

    if (
      typeof preContentHash !== 'string' ||
      preContentHash.length !== 64 ||
      !/^[0-9a-f]{64}$/i.test(preContentHash)
    ) {
      return false;
    }

    const clearedDownbeat: TrackDownbeat = createSuggestedDownbeat(preTrack.downbeat?.suggestedPosition);

    return this.applyTrackDownbeatUpdate(deckId, preTrackId, preToken, preContentHash, clearedDownbeat);
  }

  public clearDownbeatDeckA(): Promise<boolean> {
    return this.clearDownbeat('A');
  }

  public clearDownbeatDeckB(): Promise<boolean> {
    return this.clearDownbeat('B');
  }

  public clearDownbeatA(): Promise<boolean> {
    return this.clearDownbeat('A');
  }

  public clearDownbeatB(): Promise<boolean> {
    return this.clearDownbeat('B');
  }

  /**
   * Aplica atómicamente la actualización persistida de downbeat y coordina el estado de ambos decks.
   */
  private async applyTrackDownbeatUpdate(
    deckId: DeckId,
    preTrackId: string,
    preToken: number | undefined,
    preContentHash: string,
    targetDownbeat: TrackDownbeat
  ): Promise<boolean> {
    // 1. Persistir atómicamente en IndexedDB validando coincidencia de contentHash
    let persisted: boolean;
    try {
      persisted = await indexedDBStorage.updateTrackDownbeat(preTrackId, targetDownbeat, preContentHash);
    } catch (err) {
      console.warn(`[useDJStore] Error al persistir downbeat para pista ${preTrackId}:`, err);
      persisted = false;
    }

    if (!persisted) {
      return false;
    }

    // 2. Verificación anti-carrera post-asíncrona
    const postDeckState = this.getDeckState(deckId);
    const postSelection = this.deckSelections[deckId];
    const postTrack = postDeckState.track;
    const postToken = postSelection?.selectionToken;
    const postTrackId = postTrack?.id;
    const postContentHash = postTrack?.fileMeta?.contentHash ?? postSelection?.contentHash;

    if (
      !postTrack ||
      postTrackId !== preTrackId ||
      postToken !== preToken ||
      postContentHash !== preContentHash
    ) {
      // La pista cambió o fue descargada concurrentemente durante la persistencia: descartar mutación de deck
      return false;
    }

    // 3. Preparar mutaciones reactivas
    const updatedTrack: Track = {
      ...postTrack,
      downbeat: targetDownbeat,
    };

    const updates: Partial<DJStoreState> = {};
    const otherDeckId: DeckId = deckId === 'A' ? 'B' : 'A';
    const otherDeckState = this.getDeckState(otherDeckId);
    const otherSelection = this.deckSelections[otherDeckId];
    const otherHash = otherDeckState.track?.fileMeta?.contentHash ?? otherSelection?.contentHash;

    const isSameTrackInOtherDeck =
      Boolean(otherDeckState.track) &&
      otherDeckState.track?.id === preTrackId &&
      otherHash === preContentHash;

    const deckBarSyncNeedsReset =
      postDeckState.barSync?.status === 'armed' || postDeckState.barSync?.status === 'already_aligned';

    const otherBarSyncNeedsReset =
      otherDeckState.barSync?.status === 'armed' || otherDeckState.barSync?.status === 'already_aligned';

    const idleBarSync: BarSyncState = {
      status: 'idle',
      preparedPosition: null,
      previousPosition: null,
      displacementSec: null,
      targetDownbeatSec: null,
      beatsPerBar: null,
      reason: null,
    };

    if (deckId === 'A') {
      updates.deckA = {
        ...postDeckState,
        track: updatedTrack,
        ...(deckBarSyncNeedsReset ? { barSync: idleBarSync } : {}),
      };
      if (isSameTrackInOtherDeck && otherDeckState.track) {
        updates.deckB = {
          ...otherDeckState,
          track: { ...otherDeckState.track, downbeat: targetDownbeat },
          ...(otherBarSyncNeedsReset ? { barSync: idleBarSync } : {}),
        };
      } else if (otherBarSyncNeedsReset) {
        updates.deckB = {
          ...otherDeckState,
          barSync: idleBarSync,
        };
      }
    } else {
      updates.deckB = {
        ...postDeckState,
        track: updatedTrack,
        ...(deckBarSyncNeedsReset ? { barSync: idleBarSync } : {}),
      };
      if (isSameTrackInOtherDeck && otherDeckState.track) {
        updates.deckA = {
          ...otherDeckState,
          track: { ...otherDeckState.track, downbeat: targetDownbeat },
          ...(otherBarSyncNeedsReset ? { barSync: idleBarSync } : {}),
        };
      } else if (otherBarSyncNeedsReset) {
        updates.deckA = {
          ...otherDeckState,
          barSync: idleBarSync,
        };
      }
    }

    this.setState(updates);
    return true;
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
    this.deckSelections[deckId] = null;

    const initialDeck = deckId === 'A' ? INITIAL_DECK_A : INITIAL_DECK_B;
    const currentDeck = this.getDeckState(deckId);
    const unloadedDeck: DeckStoreState = {
      ...initialDeck,
      pitch: currentDeck.pitch,
      playbackRate: currentDeck.playbackRate,
      isSyncActive: false,
      isMaster: false,
      phaseAlignment: { status: 'idle', progressPercent: 0 },
      barSync: { status: 'idle', preparedPosition: null, previousPosition: null, displacementSec: null, targetDownbeatSec: null, beatsPerBar: null, reason: null },
    };
    const currentOtherDeck = this.getDeckState(otherDeckId);
    const otherBarSync = currentOtherDeck.barSync?.status === 'armed' || currentOtherDeck.barSync?.status === 'already_aligned'
      ? { status: 'idle' as const, preparedPosition: null, previousPosition: null, displacementSec: null, targetDownbeatSec: null, beatsPerBar: null, reason: null }
      : currentOtherDeck.barSync;
    const otherDeck = {
      ...currentOtherDeck,
      isSyncActive: false,
      isMaster: false,
      barSync: otherBarSync,
    };
    this.setState({
      syncMasterDeck: null,
      [deckId === 'A' ? 'deckA' : 'deckB']: unloadedDeck,
      [otherDeckId === 'A' ? 'deckA' : 'deckB']: otherDeck,
    });
    this.checkStopTimeLoop();
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
    this.setDeck(deckId, {
      playbackState: 'stopped',
      currentTime: 0,
      barSync: { status: 'idle', preparedPosition: null, previousPosition: null, displacementSec: null, targetDownbeatSec: null, beatsPerBar: null, reason: null },
    });
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
  analyzeTrack: (track: Track, force?: boolean, deckId?: DeckId) => Promise<TrackAnalysis>;
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

  // Preparación de compás (BAR SYNC V1)
  prepareBarSyncA: (toleranceSec?: number) => BarSyncPlanResult;
  prepareBarSyncB: (toleranceSec?: number) => BarSyncPlanResult;
  prepareBarSync: (deckId: DeckId, toleranceSec?: number) => BarSyncPlanResult;
  cancelBarSync: (deckId: DeckId) => void;

  // Confirmación y limpieza de downbeat (BAR SYNC V1)
  confirmDownbeatA: (positionOrParams: number | ConfirmDownbeatParams, metric?: number) => Promise<boolean>;
  confirmDownbeatB: (positionOrParams: number | ConfirmDownbeatParams, metric?: number) => Promise<boolean>;
  confirmDownbeatDeckA: (positionOrParams: number | ConfirmDownbeatParams, metric?: number) => Promise<boolean>;
  confirmDownbeatDeckB: (positionOrParams: number | ConfirmDownbeatParams, metric?: number) => Promise<boolean>;
  confirmDownbeat: (deckId: DeckId, positionOrParams: number | ConfirmDownbeatParams, metric?: number) => Promise<boolean>;
  clearDownbeatA: () => Promise<boolean>;
  clearDownbeatB: () => Promise<boolean>;
  clearDownbeatDeckA: () => Promise<boolean>;
  clearDownbeatDeckB: () => Promise<boolean>;
  clearDownbeat: (deckId: DeckId) => Promise<boolean>;
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

    // Preparación de compás (BAR SYNC V1)
    prepareBarSyncA: djStore.prepareBarSyncDeckA.bind(djStore),
    prepareBarSyncB: djStore.prepareBarSyncDeckB.bind(djStore),
    prepareBarSync: djStore.prepareBarSync.bind(djStore),
    cancelBarSync: djStore.cancelBarSync.bind(djStore),

    // Confirmación y limpieza de downbeat (BAR SYNC V1)
    confirmDownbeatA: djStore.confirmDownbeatA.bind(djStore),
    confirmDownbeatB: djStore.confirmDownbeatB.bind(djStore),
    confirmDownbeatDeckA: djStore.confirmDownbeatDeckA.bind(djStore),
    confirmDownbeatDeckB: djStore.confirmDownbeatDeckB.bind(djStore),
    confirmDownbeat: djStore.confirmDownbeat.bind(djStore),
    clearDownbeatA: djStore.clearDownbeatA.bind(djStore),
    clearDownbeatB: djStore.clearDownbeatB.bind(djStore),
    clearDownbeatDeckA: djStore.clearDownbeatDeckA.bind(djStore),
    clearDownbeatDeckB: djStore.clearDownbeatDeckB.bind(djStore),
    clearDownbeat: djStore.clearDownbeat.bind(djStore),

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
