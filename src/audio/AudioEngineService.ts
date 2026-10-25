/**
 * SYSTEM DJ — Audio Engine Service
 * Implementación desacoplada del motor de audio basada en Web Audio API.
 * Administra el ciclo de vida de AudioContext, grafos de nodos por deck,
 * decodificación de buffers y control de transporte de alta precisión.
 */

import type { DeckId } from '../types/deck';
import type { ChannelEq, CrossfaderCurve } from '../types/mixer';
import { calculateCrossfaderGains, getBipolarFilterSettings } from './djAudioMath.ts';
import type { AudioEngineStatus, DeckAudioGraph, MasterAudioGraph, IAudioEngineService, ActiveDeckSlew } from '../types/audio';
import {
  type SlewProfilePlan,
  evaluateSlewRateAt,
  integrateSlewTrajectory,
} from './analysis/phaseAlignment.ts';

/**
 * Representa la automatización activa de micro-slew sobre un deck.
 */
export interface ActiveSlewInternal {
  slewId: string;
  slewEpoch: number;
  readonly epoch?: number;
  plan: SlewProfilePlan;
  startedAtCtxTime: number;
  timerId: ReturnType<typeof setTimeout> | null;
  onCompleted?: () => void;
}

/**
 * Estado interno de transporte y seguimiento temporal por deck.
 */
interface DeckTransportInternal {
  isPlaying: boolean;
  startedAt: number;        // audioContext.currentTime en el momento de reproducir
  startOffset: number;      // Desplazamiento en segundos dentro del buffer
  playbackRate: number;     // Multiplicador de velocidad base fijado por pitch (0.92 a 1.08 para ±8%)
  bendAmount: number;       // Desviación momentánea de pitch bend (-0.08 a +0.08)
  slewEpoch: number;        // Contador monotónico para invalidación de automatizaciones obsoletas
  activeSlew: ActiveSlewInternal | null; // Perfil de micro-slew activo en ejecución
}

/**
 * Obtiene el constructor de AudioContext soportado por el navegador o entorno.
 */
function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window !== 'undefined') {
    return window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext || null;
  }
  return null;
}


/** Antelación de un arranque en fase: cubre la latencia del hilo principal hasta source.start(). */
export const PHASE_LOCK_LEAD_SECONDS = 0.03;

/** Frecuencia de referencia para traducir el tamaño de búfer a segundos de latencia. */
const PREFERRED_SAMPLE_RATE = 48000;
/** Rangos de pitch admitidos por el motor (±6 %, ±8 %, ±16 %). */
export const SUPPORTED_PITCH_RANGES: readonly number[] = [0.06, 0.08, 0.16];
/** Límites de la tolerancia configurable de SYNC (±4 % a ±20 %). */
export const MIN_SYNC_RATE_LIMIT = 0.04;
export const MAX_SYNC_RATE_LIMIT = 0.2;

export class AudioEngineService implements IAudioEngineService {
  private static instance: AudioEngineService | null = null;

  private audioContext: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
  private masterAnalyserNode: AnalyserNode | null = null;
  private limiterNode: DynamicsCompressorNode | null = null;
  private masterVolumeLevel: number = 0.8; // 80% volumen maestro inicial

  private crossfaderPosition: number = 0.5; // Centro exacto inicial
  private crossfaderCurve: CrossfaderCurve = 'constant-power';
  /** Rango del fader de pitch (fracción); acota playbackRate a [1 - rango, 1 + rango]. */
  private pitchRange: number = 0.08;
  /** Tolerancia de SYNC (fracción); un Esclavo puede superar el rango del fader hasta este límite. */
  private syncRateLimit: number = 0.08;
  /** Tamaño de búfer preferido; se aplica como latencyHint al crear el AudioContext. */
  private bufferSize: number | null = null;

  private deckGraphs: Map<DeckId, DeckAudioGraph> = new Map();
  private deckTransports: Map<DeckId, DeckTransportInternal> = new Map();

  // Callbacks desacoplados para eventos del ciclo de vida
  private playbackEndedListeners: Map<DeckId, Set<() => void>> = new Map([
    ['A', new Set()],
    ['B', new Set()],
  ]);
  private stateChangeListeners: Set<(status: AudioEngineStatus) => void> = new Set();

  public constructor() {
    this.initTransport('A');
    this.initTransport('B');
  }

  /**
   * Patrón Singleton para acceso global ordenado.
   */
  public static getInstance(): AudioEngineService {
    if (!AudioEngineService.instance) {
      AudioEngineService.instance = new AudioEngineService();
    }
    return AudioEngineService.instance;
  }

  /**
   * Estado actual del motor de audio y del AudioContext subyacente.
   */
  public get status(): AudioEngineStatus {
    if (!this.audioContext) {
      return 'uninitialized';
    }
    return this.audioContext.state as AudioEngineStatus;
  }

  /**
   * Inicializa de forma perezosa el AudioContext y los grafos de canales.
   */
  public async initialize(): Promise<void> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      return;
    }

    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass) {
      throw new Error('Web Audio API no está disponible en este entorno.');
    }

    this.audioContext = this.createContext(AudioContextClass);

    // Configurar etapa Master (Gain -> Analyser / Limiter -> Destination)
    this.setupMasterStage(this.audioContext);

    // Inicializar grafos de audio para Deck A y Deck B
    this.deckGraphs.set('A', this.buildDeckAudioGraph('A'));
    this.deckGraphs.set('B', this.buildDeckAudioGraph('B'));

    // Configurar oyente de cambios de estado del hardware
    this.audioContext.onstatechange = () => {
      this.notifyStateChange(this.status);
    };

    this.notifyStateChange(this.status);
  }

  /**
   * Desbloquea y reanuda el AudioContext respetando las políticas de autoplay del navegador.
   */
  public async resume(): Promise<void> {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      await this.initialize();
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
      this.notifyStateChange(this.status);
    }
  }

  /**
   * Decodifica un ArrayBuffer de audio binario a un AudioBuffer utilizable.
   */
  public async decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
    await this.resume();
    if (!this.audioContext) {
      throw new Error('No fue posible inicializar el AudioContext para decodificación.');
    }

    try {
      // Clona el buffer para evitar que algunos navegadores dejen el ArrayBuffer neutro/detenido
      const bufferClone = arrayBuffer.slice(0);
      return await this.audioContext.decodeAudioData(bufferClone);
    } catch (error) {
      throw new Error(
        `Fallo al decodificar los datos de audio: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  /**
   * Carga un AudioBuffer en el deck especificado y reinicia su transporte.
   * Libera cualquier buffer y nodo anterior.
   */
  public loadBufferToDeck(deckId: DeckId, buffer: AudioBuffer): void {
    this.ensureInitialized();
    this.cancelDeckSlew(deckId);
    const graph = this.getDeckGraph(deckId);
    const transport = this.getDeckTransport(deckId);

    // Detener reproducción en curso y liberar recursos previos
    this.stopSourceNode(graph);

    // Desvincular buffer previo para recolección de basura
    graph.buffer = null;

    // Asignar nuevo buffer
    graph.buffer = buffer;

    // Reiniciar posición de transporte
    transport.isPlaying = false;
    transport.startOffset = 0;
    transport.startedAt = 0;
    transport.activeSlew = null;
  }

  /**
   * Descarga la pista del deck y libera la memoria del AudioBuffer.
   */
  public unloadDeck(deckId: DeckId): void {
    this.cancelDeckSlew(deckId);
    const graph = this.deckGraphs.get(deckId);
    if (!graph) return;

    this.stopSourceNode(graph);
    graph.buffer = null;

    const transport = this.deckTransports.get(deckId);
    if (transport) {
      transport.isPlaying = false;
      transport.startOffset = 0;
      transport.startedAt = 0;
      transport.bendAmount = 0;
      transport.activeSlew = null;
    }
  }

  /**
   * Inicia o continúa la reproducción en el deck especificado.
   * `when` (tiempo de AudioContext) programa un arranque con precisión de muestra;
   * el transporte contabiliza la posición desde ese instante.
   */
  public playDeck(deckId: DeckId, startOffsetSeconds?: number, when?: number): void {
    this.ensureInitialized();
    const graph = this.getDeckGraph(deckId);
    const transport = this.getDeckTransport(deckId);

    if (!graph.buffer) {
      console.warn(`[AudioEngineService] No se puede reproducir el Deck ${deckId}: no hay buffer cargado.`);
      return;
    }

    // Reanudar contexto si está suspendido por autoplay
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch((err) => {
        console.error('[AudioEngineService] Error reanudando AudioContext:', err);
      });
    }

    // Si ya está reproduciendo y no se especificó un nuevo offset, no hacer nada
    if (transport.isPlaying && startOffsetSeconds === undefined) {
      return;
    }

    // Detener nodo anterior si existía
    this.stopSourceNode(graph);

    const duration = graph.buffer.duration;
    let offset = startOffsetSeconds !== undefined ? startOffsetSeconds : transport.startOffset;

    // Normalizar offset dentro de los límites del buffer
    if (offset < 0 || offset >= duration) {
      offset = 0;
    }

    const ctx = this.audioContext!;
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = graph.buffer;
    const effectiveRate = this.calculateEffectiveRate(transport.playbackRate, transport.bendAmount);
    sourceNode.playbackRate.setValueAtTime(effectiveRate, ctx.currentTime);
    sourceNode.connect(graph.gainNode);

    // Manejar finalización natural de la reproducción
    sourceNode.onended = () => {
      if (graph.sourceNode === sourceNode) {
        this.cancelDeckSlew(deckId);
        graph.sourceNode = null;
        transport.isPlaying = false;
        transport.startOffset = 0;
        this.notifyPlaybackEnded(deckId);
      }
    };

    const startAt = when !== undefined && Number.isFinite(when) && when > ctx.currentTime ? when : ctx.currentTime;
    graph.sourceNode = sourceNode;
    transport.isPlaying = true;
    transport.startedAt = startAt;
    transport.startOffset = offset;

    sourceNode.start(when !== undefined ? startAt : 0, offset);
  }

  /**
   * Arranca `deckId` en fase con `referenceDeckId` (BAR SYNC).
   *
   * El arranque se programa `leadSeconds` en el futuro del reloj de audio y el offset se
   * calcula para la posición que tendrá la referencia exactamente en ese instante. Así no
   * influyen la latencia del hilo principal ni el tiempo transcurrido desde la preparación,
   * y ambos decks comparten latencia de salida. Devuelve el offset usado, o null si la
   * referencia no está sonando o `resolveOffset` no da una posición válida.
   */
  public playDeckPhaseLocked(
    deckId: DeckId,
    referenceDeckId: DeckId,
    resolveOffset: (referencePositionAtStart: number) => number | null,
    leadSeconds = PHASE_LOCK_LEAD_SECONDS,
  ): number | null {
    this.ensureInitialized();
    const ctx = this.audioContext;
    const graph = this.getDeckGraph(deckId);
    const reference = this.deckTransports.get(referenceDeckId);
    if (!ctx || !graph.buffer || !reference?.isPlaying) return null;

    const when = ctx.currentTime + Math.max(0, leadSeconds);
    const offset = resolveOffset(this.getDeckPositionAt(referenceDeckId, when));
    if (offset === null || !Number.isFinite(offset) || offset < 0 || offset >= graph.buffer.duration) return null;

    this.playDeck(deckId, offset, when);
    return offset;
  }

  /** Posición del deck (s de buffer) en un instante del reloj de audio, a velocidad actual. */
  public getDeckPositionAt(deckId: DeckId, contextTime: number): number {
    const transport = this.deckTransports.get(deckId);
    const current = this.getDeckCurrentTime(deckId);
    if (!transport?.isPlaying || !this.audioContext) return current;
    const effectiveRate = this.calculateEffectiveRate(transport.playbackRate, transport.bendAmount);
    return current + Math.max(0, contextTime - Math.max(this.audioContext.currentTime, transport.startedAt)) * effectiveRate;
  }

  /**
   * Pausa la reproducción reteniendo la posición temporal exacta en segundos.
   */
  public pauseDeck(deckId: DeckId): void {
    const graph = this.deckGraphs.get(deckId);
    const transport = this.deckTransports.get(deckId);
    if (!graph || !transport || !transport.isPlaying) {
      return;
    }

    this.cancelDeckSlew(deckId);
    const currentPosition = this.getDeckCurrentTime(deckId);
    transport.isPlaying = false;
    transport.startOffset = currentPosition;
    transport.startedAt = 0;

    this.stopSourceNode(graph);
  }

  /**
   * Detiene la reproducción y rebobina el cursor al inicio (0:00).
   */
  public stopDeck(deckId: DeckId): void {
    const graph = this.deckGraphs.get(deckId);
    const transport = this.deckTransports.get(deckId);
    if (!graph || !transport) {
      return;
    }

    this.cancelDeckSlew(deckId);
    transport.isPlaying = false;
    transport.startOffset = 0;
    transport.startedAt = 0;
    transport.bendAmount = 0;

    this.stopSourceNode(graph);
  }

  /**
   * Salta a una posición específica de la pista en segundos.
   */
  public seekDeck(deckId: DeckId, positionSeconds: number): void {
    this.ensureInitialized();
    this.cancelDeckSlew(deckId);
    const graph = this.getDeckGraph(deckId);
    const transport = this.getDeckTransport(deckId);

    if (!graph.buffer) {
      transport.startOffset = 0;
      return;
    }

    const duration = graph.buffer.duration;
    const clampedOffset = Math.max(0, Math.min(positionSeconds, duration));

    if (transport.isPlaying) {
      // Reinicia la reproducción en la nueva posición
      this.playDeck(deckId, clampedOffset);
    } else {
      // Actualiza la posición de espera en pausa/stop
      transport.startOffset = clampedOffset;
    }
  }

  /**
   * Modifica el factor de velocidad de reproducción (playbackRate) del deck.
   * Respeta el rango de pitch configurado (±8 % por defecto: factor 0.92 a 1.08).
   * Tiene prioridad absoluta sobre cualquier micro-slew activo, cancelándolo inmediatamente.
   */
  public setDeckPlaybackRate(deckId: DeckId, rate: number): void {
    this.ensureInitialized();
    this.cancelDeckSlew(deckId, false);
    const transport = this.getDeckTransport(deckId);
    const graph = this.getDeckGraph(deckId);

    // Limitar estrictamente al rango de pitch configurado
    const limit = this.getRateLimit();
    const clampedRate = Math.max(1 - limit, Math.min(1 + limit, rate));
    const previousEffective = this.calculateEffectiveRate(transport.playbackRate, transport.bendAmount);

    // Si está sonando, actualizar el offset acumulado antes del cambio de ritmo
    if (transport.isPlaying && this.audioContext) {
      const now = this.audioContext.currentTime;
      const elapsed = (now - transport.startedAt) * previousEffective;
      transport.startOffset += elapsed;
      transport.startedAt = now;
    }

    transport.playbackRate = clampedRate;
    const newEffective = this.calculateEffectiveRate(clampedRate, transport.bendAmount);

    if (graph.sourceNode && this.audioContext) {
      const now = this.audioContext.currentTime;
      const param = graph.sourceNode.playbackRate;
      const paramWithHold = param as AudioParam & { cancelAndHoldAtTime?: (cancelTime: number) => AudioParam };
      try {
        if (typeof paramWithHold.cancelAndHoldAtTime === 'function') {
          paramWithHold.cancelAndHoldAtTime(now);
        } else {
          param.cancelScheduledValues(now);
        }
      } catch {
        try {
          param.cancelScheduledValues(now);
        } catch {
          // Ignorar si el nodo ya no está activo
        }
      }
      param.setValueAtTime(newEffective, now);
    }
  }

  /**
   * Fija el rango del fader de pitch (0.06, 0.08 o 0.16). Los decks que ya excedan
   * el nuevo rango se recortan en su siguiente cambio de velocidad.
   */
  public setPitchRange(range: number): void {
    if (SUPPORTED_PITCH_RANGES.includes(range)) this.pitchRange = range;
  }

  public getPitchRange(): number {
    return this.pitchRange;
  }

  /** Fija la tolerancia de SYNC, acotada a ±4–20 %. */
  public setSyncRateLimit(limit: number): void {
    if (!Number.isFinite(limit)) return;
    this.syncRateLimit = Math.max(MIN_SYNC_RATE_LIMIT, Math.min(MAX_SYNC_RATE_LIMIT, limit));
  }

  public getSyncRateLimit(): number {
    return this.syncRateLimit;
  }

  /** Cota absoluta de playbackRate: la mayor entre el rango del fader y la tolerancia de SYNC. */
  public getRateLimit(): number {
    return Math.max(this.pitchRange, this.syncRateLimit);
  }

  /**
   * Fija el tamaño de búfer preferido (256, 512 o 1024 muestras). Se aplica la próxima vez
   * que se cree el AudioContext; un contexto activo conserva su latencia.
   */
  public setPreferredBufferSize(size: number): void {
    if ([256, 512, 1024].includes(size)) this.bufferSize = size;
  }

  /**
   * Calcula la velocidad de reproducción efectiva combinando el pitch base y el bend momentáneo.
   * Acota estrictamente al rango de pitch configurado (±8 % por defecto).
   */
  public calculateEffectiveRate(baseRate: number, bendAmount: number = 0): number {
    const safeBase = typeof baseRate === 'number' && !Number.isNaN(baseRate) ? baseRate : 1.0;
    const safeBend = typeof bendAmount === 'number' && !Number.isNaN(bendAmount) ? bendAmount : 0;
    const rawRate = safeBase * (1 + safeBend);
    const limit = this.getRateLimit();
    const clamped = Math.max(1 - limit, Math.min(1 + limit, rawRate));
    return Number(clamped.toFixed(4));
  }

  /**
   * Modifica temporalmente la velocidad de reproducción mediante Pitch Bend (+ / - momentáneo).
   * Al soltar el control (bendAmount = 0), retorna suavemente al playbackRate nominal.
   * Acota estrictamente la velocidad efectiva al rango global de pitch: ±8% (0.92 a 1.08).
   * Cancela inmediatamente cualquier micro-slew activo para evitar colisiones en AudioParam.
   */
  public setDeckPitchBend(deckId: DeckId, bendAmount: number): void {
    this.ensureInitialized();
    this.cancelDeckSlew(deckId, false);
    const transport = this.getDeckTransport(deckId);
    const graph = this.getDeckGraph(deckId);

    const clampedBend = Math.max(-0.08, Math.min(0.08, bendAmount));
    const previousBend = transport.bendAmount;
    const previousEffective = this.calculateEffectiveRate(transport.playbackRate, transport.bendAmount);

    if (transport.isPlaying && this.audioContext) {
      const now = this.audioContext.currentTime;
      const elapsed = (now - transport.startedAt) * previousEffective;
      transport.startOffset += elapsed;
      transport.startedAt = now;
    }

    transport.bendAmount = clampedBend;
    const newEffective = this.calculateEffectiveRate(transport.playbackRate, clampedBend);

    if (graph.sourceNode && this.audioContext) {
      const now = this.audioContext.currentTime;
      const param = graph.sourceNode.playbackRate;
      const paramWithHold = param as AudioParam & { cancelAndHoldAtTime?: (cancelTime: number) => AudioParam };
      try {
        if (typeof paramWithHold.cancelAndHoldAtTime === 'function') {
          paramWithHold.cancelAndHoldAtTime(now);
        } else {
          param.cancelScheduledValues(now);
        }
      } catch {
        try {
          param.cancelScheduledValues(now);
        } catch {
          // Ignorar si el nodo ya no está activo
        }
      }
      if (clampedBend === 0 && previousBend !== 0 && transport.isPlaying && typeof param.linearRampToValueAtTime === 'function') {
        param.setValueAtTime(previousEffective, now);
        param.linearRampToValueAtTime(newEffective, now + 0.04);
      } else {
        param.setValueAtTime(newEffective, now);
      }
    }
  }

  /**
   * Obtiene la cantidad de pitch bend momentánea activa en el deck.
   */
  public getDeckPitchBend(deckId: DeckId): number {
    const transport = this.deckTransports.get(deckId);
    return transport?.bendAmount ?? 0;
  }

  /**
   * Ajusta la ganancia / trim de entrada del canal (0 a 100, centro 50 = unitario 1.0x).
   * Rango resultante: 0.0 a 2.0 (+6 dB de realce máximo).
   */
  public setChannelGain(deckId: DeckId, gainValue: number): void {
    this.ensureInitialized();
    const graph = this.getDeckGraph(deckId);
    if (!this.audioContext) return;

    // 0..100 -> ganancia lineal 0.0 a 2.0 (50 = 1.0)
    const clamped = Math.max(0, Math.min(100, gainValue));
    const normalizedGain = Number((clamped / 50).toFixed(4));
    graph.gainNode.gain.setValueAtTime(normalizedGain, this.audioContext.currentTime);
  }

  /**
   * Ajusta una banda del ecualizador de 3 bandas (-12 dB a +12 dB).
   * - high: Highshelf en 2500 Hz
   * - mid: Peaking en 1000 Hz (Q = 1.0)
   * - low: Lowshelf en 300 Hz
   */
  public setChannelEq(deckId: DeckId, band: keyof Omit<ChannelEq, 'filter'>, dbValue: number): void {
    this.ensureInitialized();
    const graph = this.getDeckGraph(deckId);
    if (!this.audioContext) return;

    const clampedDb = Math.max(-12, Math.min(12, dbValue));
    const now = this.audioContext.currentTime;

    switch (band) {
      case 'high':
        graph.eqHighNode.gain.setValueAtTime(clampedDb, now);
        break;
      case 'mid':
        graph.eqMidNode.gain.setValueAtTime(clampedDb, now);
        break;
      case 'low':
        graph.eqLowNode.gain.setValueAtTime(clampedDb, now);
        break;
    }
  }

  /**
   * Ajusta el filtro bipolar de canal (-100 LowPass a +100 HighPass, 0 bypass allpass).
   */
  public setChannelFilter(deckId: DeckId, filterNormalized: number): void {
    this.ensureInitialized();
    const graph = this.getDeckGraph(deckId);
    if (!this.audioContext) return;

    const filter = graph.filterNode;
    const now = this.audioContext.currentTime;
    const settings = getBipolarFilterSettings(filterNormalized);
    filter.type = settings.type;
    if (settings.frequency !== undefined) filter.frequency.setValueAtTime(settings.frequency, now);
  }

  /**
   * Ajusta el volumen del fader lineal del canal (0 a 100 -> ganancia 0.0 a 1.0).
   */
  public setChannelVolume(deckId: DeckId, volumeLinear: number): void {
    this.ensureInitialized();
    const graph = this.getDeckGraph(deckId);
    if (!this.audioContext) return;

    const normalizedVol = Math.max(0, Math.min(100, volumeLinear)) / 100;
    graph.volumeNode.gain.setValueAtTime(Number(normalizedVol.toFixed(4)), this.audioContext.currentTime);
  }

  /**
   * Ajusta la atenuación del crossfader entre Deck A y Deck B según la posición y curva seleccionada.
   * positionNormalized: 0.0 a 1.0 (o 0 a 100). 0 = 100% Deck A, 1 = 100% Deck B.
   */
  public setCrossfader(positionNormalized: number, curve: CrossfaderCurve = this.crossfaderCurve): void {
    this.ensureInitialized();
    this.crossfaderPosition = positionNormalized;
    this.crossfaderCurve = curve;

    if (!this.audioContext) return;

    const { gainA, gainB } = calculateCrossfaderGains(positionNormalized, curve);
    const now = this.audioContext.currentTime;

    const graphA = this.deckGraphs.get('A');
    const graphB = this.deckGraphs.get('B');

    if (graphA) {
      graphA.crossfaderGainNode.gain.setValueAtTime(gainA, now);
    }
    if (graphB) {
      graphB.crossfaderGainNode.gain.setValueAtTime(gainB, now);
    }
  }

  /**
   * Cambia la curva matemática de atenuación del crossfader y recalcula las ganancias.
   */
  public setCrossfaderCurve(curve: CrossfaderCurve): void {
    this.setCrossfader(this.crossfaderPosition, curve);
  }

  /**
   * Ajusta el volumen de salida maestro (0 a 100 -> ganancia 0.0 a 1.0).
   */
  public setMasterVolume(volumeLinear: number): void {
    this.ensureInitialized();
    const normalized = Math.max(0, Math.min(100, volumeLinear)) / 100;
    this.masterVolumeLevel = Number(normalized.toFixed(4));

    if (this.audioContext && this.masterGainNode) {
      this.masterGainNode.gain.setValueAtTime(this.masterVolumeLevel, this.audioContext.currentTime);
    }
  }

  /**
   * Obtiene la posición actual de reproducción en segundos con precisión matemática.
   * Integra analíticamente la trayectoria del micro-slew cuando se encuentra activo,
   * preservando continuidad matemática C^0 en todo momento.
   */
  public getDeckCurrentTime(deckId: DeckId): number {
    const graph = this.deckGraphs.get(deckId);
    const transport = this.deckTransports.get(deckId);
    if (!graph || !transport) return 0;

    if (!transport.isPlaying || !this.audioContext) {
      return transport.startOffset;
    }

    // Si hay un micro-slew activo en ejecución, integrar su trayectoria analítica
    if (transport.activeSlew) {
      const now = this.audioContext.currentTime;
      const relTime = now - transport.activeSlew.startedAtCtxTime;
      const plan = transport.activeSlew.plan;
      let elapsedInSlew: number;

      if (relTime >= plan.tSlew) {
        const totalSlewArea = integrateSlewTrajectory(plan, 0, plan.tSlew);
        const postSlewTime = now - (transport.activeSlew.startedAtCtxTime + plan.tSlew);
        const effectiveBase = this.calculateEffectiveRate(plan.baseRate, transport.bendAmount);
        elapsedInSlew = totalSlewArea + (postSlewTime * effectiveBase);
      } else {
        elapsedInSlew = integrateSlewTrajectory(plan, 0, Math.max(0, relTime));
      }

      const current = transport.startOffset + elapsedInSlew;
      if (graph.buffer) {
        return Math.min(current, graph.buffer.duration);
      }
      return current;
    }

    const effectiveRate = this.calculateEffectiveRate(transport.playbackRate, transport.bendAmount);
    const elapsed = Math.max(0, this.audioContext.currentTime - transport.startedAt) * effectiveRate;
    const current = transport.startOffset + elapsed;

    if (graph.buffer) {
      return Math.min(current, graph.buffer.duration);
    }
    return current;
  }

  /**
   * Obtiene la duración total de la pista cargada en segundos.
   */
  public getDeckDuration(deckId: DeckId): number {
    const graph = this.deckGraphs.get(deckId);
    return graph?.buffer ? graph.buffer.duration : 0;
  }

  /**
   * Obtiene el valor RMS matemático puro (0.0 a 1.0+) de la señal del deck
   * medido en el dominio del tiempo antes del crossfader.
   */
  public getDeckRMS(deckId: DeckId): number {
    const graph = this.deckGraphs.get(deckId);
    const transport = this.deckTransports.get(deckId);
    if (!graph || !transport || !transport.isPlaying) {
      return 0;
    }

    return this.calculateRMSFromAnalyser(graph.analyserNode);
  }

  /**
   * Obtiene el valor RMS matemático puro (0.0 a 1.0+) de la mezcla combinada Master.
   */
  public getMasterRMS(): number {
    const aPlaying = this.isDeckPlaying('A');
    const bPlaying = this.isDeckPlaying('B');
    if ((!aPlaying && !bPlaying) || !this.masterAnalyserNode) {
      return 0;
    }

    return this.calculateRMSFromAnalyser(this.masterAnalyserNode);
  }

  /**
   * Convierte un valor RMS matemático a un porcentaje de escala visual para vúmetros (0 a 100).
   * Calibrado de tal forma que una onda senoidal pura a 0 dBFS (RMS ≈ 0.7071) alcance el nivel nominal (~99%).
   */
  public rmsToVUMeterLevel(rms: number): number {
    if (rms <= 0.0001) return 0;
    return Math.min(100, Math.round(rms * 140));
  }

  /**
   * Obtiene el nivel para el medidor VU visual del deck (0 a 100) medido pre-crossfader.
   */
  public getDeckVUMeter(deckId: DeckId): number {
    return this.rmsToVUMeterLevel(this.getDeckRMS(deckId));
  }

  /**
   * Obtiene el nivel para el medidor VU visual del Master (0 a 100).
   */
  public getMasterVUMeter(): number {
    return this.rmsToVUMeterLevel(this.getMasterRMS());
  }

  /** Número de bandas de frecuencia que entrega `readMasterSpectrum` (0 si el motor no arrancó). */
  public getMasterSpectrumSize(): number {
    return this.masterAnalyserNode?.frequencyBinCount ?? 0;
  }

  /**
   * Copia en `target` el espectro de la mezcla Master (0–255 por banda) desde el analizador
   * en derivación que ya alimenta el VU Master. Solo lectura: no crea nodos ni toca el grafo.
   * Devuelve false (sin escribir) si el motor no está iniciado o ningún deck suena.
   */
  public readMasterSpectrum(target: Uint8Array<ArrayBuffer>): boolean {
    if (!this.masterAnalyserNode || (!this.isDeckPlaying('A') && !this.isDeckPlaying('B'))) {
      return false;
    }
    this.masterAnalyserNode.getByteFrequencyData(target);
    return true;
  }

  /**
   * Permite inspeccionar el grafo DSP de un canal (uso en pruebas de topología).
   */
  public getDeckAudioGraph(deckId: DeckId): DeckAudioGraph {
    this.ensureInitialized();
    return this.getDeckGraph(deckId);
  }

  /**
   * Permite inspeccionar los nodos de la etapa Master (uso en pruebas de topología).
   */
  public getMasterGraph(): MasterAudioGraph {
    this.ensureInitialized();
    return {
      masterGainNode: this.masterGainNode!,
      masterAnalyserNode: this.masterAnalyserNode!,
      limiterNode: this.limiterNode,
    };
  }

  /**
   * Indica si el deck especificado se encuentra en reproducción activa.
   */
  public isDeckPlaying(deckId: DeckId): boolean {
    return this.deckTransports.get(deckId)?.isPlaying ?? false;
  }

  /**
   * Obtiene la velocidad de reproducción / factor de pitch actual del deck (0.92 a 1.08).
   */
  public getDeckPlaybackRate(deckId: DeckId): number {
    const transport = this.deckTransports.get(deckId);
    if (!transport) return 1.0;
    return this.calculateEffectiveRate(transport.playbackRate, transport.bendAmount);
  }

  /**
   * Aplica un perfil de corrección progresiva de velocidad (micro-slew) al AudioParam
   * del deck para compensar el desfase temporal con el Master.
   *
   * CONTRATO DE GESTIÓN Y EXCLUSIÓN MUTUA DE AUTOMATIZACIONES:
   * 1. Invalida lógicamente callbacks y timers anteriores mediante el incremento de slewEpoch.
   * 2. Si existía una automatización previa en curso, la cancela consolidando la posición del transporte.
   * 3. Programa en la cola de AudioParam los tramos (rampa subida, meseta, rampa retorno).
   * 4. Registra un temporizador de finalización condicionado a que el slewEpoch coincida.
   * 5. Al expirar, consolida la posición final del transporte y notifica a los oyentes.
   */
  public applyDeckSlew(
    deckId: DeckId,
    plan: SlewProfilePlan,
    onCompleted?: () => void
  ): boolean {
    this.ensureInitialized();
    const transport = this.getDeckTransport(deckId);
    const graph = this.getDeckGraph(deckId);

    if (!transport.isPlaying || !this.audioContext || !graph.sourceNode) {
      console.warn(`[AudioEngineService] No se puede aplicar micro-slew al Deck ${deckId}: no se encuentra en reproducción activa.`);
      return false;
    }

    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const t0 = now;

    // Si había un micro-slew previo en curso, cancelarlo consolidando su avance
    if (transport.activeSlew) {
      this.cancelDeckSlew(deckId, false);
    } else {
      // Consolidar el tiempo de reproducción nominal acumulado antes de activar el nuevo micro-slew
      const effectiveRate = this.calculateEffectiveRate(transport.playbackRate, transport.bendAmount);
      const elapsed = Math.max(0, now - transport.startedAt) * effectiveRate;
      transport.startOffset += elapsed;
      transport.startedAt = now;
    }

    // Incrementar epoch para aislar de forma estricta los callbacks
    transport.slewEpoch++;
    const currentEpoch = transport.slewEpoch;

    const t1 = t0 + plan.tRamp;
    const t2 = t1 + plan.tPlateau;
    const t3 = t2 + plan.tRamp;

    // Calcular tasas efectivas combinando pitch base y bend momentáneo
    const effectiveBase = this.calculateEffectiveRate(plan.baseRate, transport.bendAmount);
    const effectivePeak = this.calculateEffectiveRate(plan.peakRate, transport.bendAmount);

    const playbackRateParam = graph.sourceNode.playbackRate;

    // Programar la trayectoria en AudioParam
    try {
      playbackRateParam.setValueAtTime(effectiveBase, t0);
      playbackRateParam.linearRampToValueAtTime(effectivePeak, t1);
      if (plan.tPlateau > 0) {
        playbackRateParam.setValueAtTime(effectivePeak, t2);
      }
      playbackRateParam.linearRampToValueAtTime(effectiveBase, t3);
    } catch (err) {
      console.error(`[AudioEngineService] Error programando automatización en AudioParam para Deck ${deckId}:`, err);
      return false;
    }

    // Configurar temporizador de consolidación al finalizar el slew
    const timeoutMs = Math.max(10, Math.ceil(plan.tSlew * 1000));
    const timerId = setTimeout(() => {
      // Comprobar invariante de generación: si el epoch cambió, descartar
      if (transport.slewEpoch !== currentEpoch || !transport.activeSlew) {
        return;
      }

      // Consolidar matemáticamente el transporte al término de la maniobra en t3
      const totalSlewBuffer = integrateSlewTrajectory(plan, 0, plan.tSlew);
      transport.startOffset += totalSlewBuffer;
      transport.startedAt = t3;
      transport.activeSlew = null;

      if (onCompleted) {
        try {
          onCompleted();
        } catch (cbErr) {
          console.error(`[AudioEngineService] Error en callback de finalización de slew para Deck ${deckId}:`, cbErr);
        }
      }
    }, timeoutMs);

    transport.activeSlew = {
      slewId: `slew_${deckId}_${Date.now()}_${currentEpoch}`,
      slewEpoch: currentEpoch,
      epoch: currentEpoch,
      plan,
      startedAtCtxTime: t0,
      timerId,
      onCompleted,
    };

    return true;
  }

  /**
   * Cancela de forma inmediata y coordinada el micro-slew activo en el deck.
   *
   * ACCIONES COORDINADAS:
   * 1. Invalida callbacks pendientes incrementando slewEpoch y cancelando el temporizador.
   * 2. Calcula de forma analítica exacta el desplazamiento acumulado hasta el instante t_cut.
   * 3. Consolida startOffset y startedAt para mantener estricta continuidad matemática C^0 de posición.
   * 4. Cancela los eventos programados en AudioParam mediante cancelAndHoldAtTime o fallback con setValueAtTime.
   * 5. Restaura la velocidad nominal efectiva del transporte si restoreRamp es verdadero.
   */
  public cancelDeckSlew(deckId: DeckId, restoreRamp: boolean = true): void {
    const transport = this.deckTransports.get(deckId);
    if (!transport) return;

    // Incrementar epoch para invalidar cualquier callback asíncrono
    transport.slewEpoch++;

    const activeSlew = transport.activeSlew;
    if (!activeSlew) {
      return;
    }

    if (activeSlew.timerId !== null) {
      clearTimeout(activeSlew.timerId);
      activeSlew.timerId = null;
    }

    const graph = this.deckGraphs.get(deckId);

    if (transport.isPlaying && this.audioContext) {
      const now = this.audioContext.currentTime;
      const tCut = now;
      const relTime = tCut - activeSlew.startedAtCtxTime;
      const plan = activeSlew.plan;

      let elapsedBuffer: number;
      let instantaneousRate: number;

      if (relTime <= 0) {
        elapsedBuffer = 0;
        instantaneousRate = plan.baseRate;
      } else if (relTime >= plan.tSlew) {
        elapsedBuffer = integrateSlewTrajectory(plan, 0, plan.tSlew);
        instantaneousRate = plan.baseRate;
      } else {
        elapsedBuffer = integrateSlewTrajectory(plan, 0, relTime);
        instantaneousRate = evaluateSlewRateAt(plan, relTime);
      }

      // Consolidación continua de la posición del transporte
      transport.startOffset += elapsedBuffer;
      transport.startedAt = tCut;

      const effectiveVcut = this.calculateEffectiveRate(instantaneousRate, transport.bendAmount);
      const effectiveBase = this.calculateEffectiveRate(transport.playbackRate, transport.bendAmount);

      if (graph?.sourceNode) {
        const param = graph.sourceNode.playbackRate;
        try {
          const RESTORE_RAMP_SEC = 0.030; // Micro-rampa de 30 ms para atenuar discontinuidades en AudioParam
          const paramWithHold = param as AudioParam & { cancelAndHoldAtTime?: (cancelTime: number) => AudioParam };
          const needsRamp = restoreRamp && Math.abs(effectiveVcut - effectiveBase) > 0.0001;

          if (typeof paramWithHold.cancelAndHoldAtTime === 'function') {
            try {
              paramWithHold.cancelAndHoldAtTime(tCut);
              if (needsRamp) {
                param.linearRampToValueAtTime(effectiveBase, tCut + RESTORE_RAMP_SEC);
              } else if (restoreRamp) {
                param.setValueAtTime(effectiveBase, tCut);
              }
            } catch {
              param.cancelScheduledValues(tCut);
              param.setValueAtTime(effectiveVcut, tCut);
              if (needsRamp) {
                param.linearRampToValueAtTime(effectiveBase, tCut + RESTORE_RAMP_SEC);
              } else if (restoreRamp) {
                param.setValueAtTime(effectiveBase, tCut);
              }
            }
          } else {
            // LIMITACIÓN DE PLATAFORMA (FALLBACK):
            // cancelScheduledValues cancela eventos futuros pero no retiene la interpolación del hilo de audio;
            // se inyecta la velocidad analítica estimada en JS (effectiveVcut) antes de transicionar al valor base.
            param.cancelScheduledValues(tCut);
            param.setValueAtTime(effectiveVcut, tCut);
            if (needsRamp) {
              param.linearRampToValueAtTime(effectiveBase, tCut + RESTORE_RAMP_SEC);
            } else if (restoreRamp) {
              param.setValueAtTime(effectiveBase, tCut);
            }
          }
        } catch (paramErr) {
          console.warn(`[AudioEngineService] Aviso cancelando automatización en AudioParam Deck ${deckId}:`, paramErr);
        }
      }
    }

    transport.activeSlew = null;
  }

  /**
   * Indica si hay una maniobra de micro-slew activa en el deck indicado.
   */
  public isDeckSlewActive(deckId: DeckId): boolean {
    return Boolean(this.deckTransports.get(deckId)?.activeSlew);
  }

  /**
   * Obtiene la información del micro-slew activo en el deck indicado.
   */
  public getDeckActiveSlew(deckId: DeckId): ActiveDeckSlew | null {
    const internal = this.deckTransports.get(deckId)?.activeSlew;
    if (!internal) return null;
    return {
      plan: internal.plan,
      startedAtCtxTime: internal.startedAtCtxTime,
      slewEpoch: internal.slewEpoch,
      epoch: internal.slewEpoch,
    };
  }

  /**
   * Obtiene el identificador monotónico de generación (slewEpoch) del deck.
   */
  public getDeckSlewEpoch(deckId: DeckId): number {
    return this.deckTransports.get(deckId)?.slewEpoch ?? 0;
  }

  /**
   * Obtiene el porcentaje de avance estimado (0 a 100) del micro-slew activo.
   */
  public getDeckSlewProgressPercent(deckId: DeckId): number {
    const slew = this.deckTransports.get(deckId)?.activeSlew;
    if (!slew || !this.audioContext || slew.plan.tSlew <= 0) return 0;
    const elapsed = this.audioContext.currentTime - slew.startedAtCtxTime;
    return Math.min(100, Math.max(0, Math.round((elapsed / slew.plan.tSlew) * 100)));
  }

  /**
   * Registra un callback desacoplado para cuando una pista termine naturalmente.
   */
  public onPlaybackEnded(deckId: DeckId, callback: () => void): () => void {
    const listeners = this.playbackEndedListeners.get(deckId);
    if (listeners) {
      listeners.add(callback);
    }
    return () => {
      listeners?.delete(callback);
    };
  }

  /**
   * Registra un callback para cambios en el estado del AudioContext.
   */
  public onStateChange(callback: (status: AudioEngineStatus) => void): () => void {
    this.stateChangeListeners.add(callback);
    return () => {
      this.stateChangeListeners.delete(callback);
    };
  }

  /**
   * Libera todos los recursos de audio, grafos de nodos y cierra el AudioContext.
   */
  public async dispose(): Promise<void> {
    this.unloadDeck('A');
    this.unloadDeck('B');

    // Desconectar y limpiar etapa Master
    if (this.masterGainNode) {
      try {
        this.masterGainNode.disconnect();
      } catch {
        // Ignorar si ya estaba desconectado
      }
      this.masterGainNode = null;
    }

    if (this.masterAnalyserNode) {
      try {
        this.masterAnalyserNode.disconnect();
      } catch {
        // Ignorar
      }
      this.masterAnalyserNode = null;
    }

    if (this.limiterNode) {
      try {
        this.limiterNode.disconnect();
      } catch {
        // Ignorar
      }
      this.limiterNode = null;
    }

    // Desconectar y limpiar nodos de cada deck
    for (const graph of this.deckGraphs.values()) {
      try {
        graph.gainNode.disconnect();
        graph.filterNode.disconnect();
        graph.eqHighNode.disconnect();
        graph.eqMidNode.disconnect();
        graph.eqLowNode.disconnect();
        graph.volumeNode.disconnect();
        graph.crossfaderGainNode.disconnect();
        graph.analyserNode.disconnect();
      } catch {
        // Ignorar
      }
    }

    this.deckGraphs.clear();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch (err) {
        console.warn('[AudioEngineService] Error cerrando AudioContext:', err);
      }
    }
    this.audioContext = null;
  }

  // --- MÉTODOS PRIVADOS DE SOPORTE ---

  private initTransport(deckId: DeckId): void {
    this.deckTransports.set(deckId, {
      isPlaying: false,
      startedAt: 0,
      startOffset: 0,
      playbackRate: 1.0,
      bendAmount: 0,
      slewEpoch: 0,
      activeSlew: null,
    });
  }

  private setupMasterStage(ctx: AudioContext): void {
    const now = ctx.currentTime;

    // 1. Nodo Maestro de Ganancia
    this.masterGainNode = ctx.createGain();
    this.masterGainNode.gain.setValueAtTime(this.masterVolumeLevel, now);

    // 2. Analizador Master (mezcla combinada)
    this.masterAnalyserNode = ctx.createAnalyser();
    this.masterAnalyserNode.fftSize = 256;
    this.masterAnalyserNode.smoothingTimeConstant = 0.8;

    // Conectar masterGainNode al masterAnalyserNode en derivación (tap de medición)
    this.masterGainNode.connect(this.masterAnalyserNode);

    // 3. Etapa de limitación de seguridad / compresión dinámica contra picos
    // NOTA TÉCNICA: DynamicsCompressorNode actúa como un supresor dinámico de picos
    // y sobrecargas sostenidas (threshold -1.0 dBFS, ratio 20:1, ataque 1 ms, release 200 ms).
    // No constituye un limitador brickwall garantizado con lookahead de cero muestras;
    // por ello, la protección contra distorsión se sustenta conjuntamente en una
    // estructura de ganancias calibrada (headroom nominal) y límites estrictos.
    if (typeof ctx.createDynamicsCompressor === 'function') {
      try {
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.setValueAtTime(-1.0, now);
        limiter.knee.setValueAtTime(0.0, now);
        limiter.ratio.setValueAtTime(20.0, now);
        limiter.attack.setValueAtTime(0.001, now);
        // 200 ms: con 50 ms la ganancia se recuperaba dentro de unos pocos ciclos de bajo
        // (40–60 Hz ≈ 17–25 ms) y modulaba la onda del bombo sumado: golpe áspero con rebote.
        limiter.release.setValueAtTime(0.2, now);

        this.limiterNode = limiter;
        this.masterGainNode.connect(this.limiterNode);
        this.limiterNode.connect(ctx.destination);
      } catch (err) {
        console.warn('[AudioEngineService] Fallo al configurar DynamicsCompressorNode:', err);
        this.limiterNode = null;
        this.masterGainNode.connect(ctx.destination);
      }
    } else {
      this.limiterNode = null;
      this.masterGainNode.connect(ctx.destination);
    }
  }

  /** Crea el AudioContext con el latencyHint derivado del tamaño de búfer preferido. */
  private createContext(AudioContextClass: typeof AudioContext): AudioContext {
    return this.bufferSize
      ? new AudioContextClass({ latencyHint: this.bufferSize / PREFERRED_SAMPLE_RATE })
      : new AudioContextClass();
  }

  private ensureInitialized(): void {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioContextClass = getAudioContextConstructor();
      if (!AudioContextClass) {
        throw new Error('Web Audio API no está disponible en este entorno.');
      }
      this.audioContext = this.createContext(AudioContextClass);
      this.setupMasterStage(this.audioContext);

      this.deckGraphs.set('A', this.buildDeckAudioGraph('A'));
      this.deckGraphs.set('B', this.buildDeckAudioGraph('B'));
    }
  }

  private buildDeckAudioGraph(deckId: DeckId): DeckAudioGraph {
    if (!this.audioContext || !this.masterGainNode) {
      throw new Error('AudioContext o masterGainNode no disponibles para crear el grafo de audio.');
    }
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // 1. Ganancia / Trim de entrada (0 a 100, centro 50 = unitario 1.0)
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(1.0, now);

    // 2. Filtro Dual (Lowpass / Highpass con inicio allpass/bypass)
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'allpass';

    // 3. Ecualizador de 3 bandas (-12 dB a +12 dB, centro 0 dB)
    const eqHighNode = ctx.createBiquadFilter();
    eqHighNode.type = 'highshelf';
    eqHighNode.frequency.setValueAtTime(2500, now);
    eqHighNode.gain.setValueAtTime(0, now);

    const eqMidNode = ctx.createBiquadFilter();
    eqMidNode.type = 'peaking';
    eqMidNode.frequency.setValueAtTime(1000, now);
    eqMidNode.Q.setValueAtTime(1.0, now);
    eqMidNode.gain.setValueAtTime(0, now);

    const eqLowNode = ctx.createBiquadFilter();
    eqLowNode.type = 'lowshelf';
    eqLowNode.frequency.setValueAtTime(300, now);
    eqLowNode.gain.setValueAtTime(0, now);

    // 4. Fader de volumen de canal (0 a 100, defecto 80% = 0.8)
    const volumeNode = ctx.createGain();
    volumeNode.gain.setValueAtTime(0.8, now);

    // 5. Analizador para VU Meter de canal (Pre-crossfader, post-volume)
    const analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.8;

    // 6. Atenuador del crossfader
    const crossfaderGainNode = ctx.createGain();
    const gains = calculateCrossfaderGains(this.crossfaderPosition, this.crossfaderCurve);
    const initialCrossGain = deckId === 'A' ? gains.gainA : gains.gainB;
    crossfaderGainNode.gain.setValueAtTime(initialCrossGain, now);

    // Enlazar cadena en serie: gain -> filter -> eqHigh -> eqMid -> eqLow -> volume
    gainNode.connect(filterNode);
    filterNode.connect(eqHighNode);
    eqHighNode.connect(eqMidNode);
    eqMidNode.connect(eqLowNode);
    eqLowNode.connect(volumeNode);

    // Tapping del analizador de canal: Pre-crossfader, post-volume
    volumeNode.connect(analyserNode);

    // Enrutamiento al crossfader y salida al master
    volumeNode.connect(crossfaderGainNode);
    crossfaderGainNode.connect(this.masterGainNode);

    return {
      deckId,
      sourceNode: null,
      buffer: null,
      gainNode,
      filterNode,
      eqHighNode,
      eqMidNode,
      eqLowNode,
      volumeNode,
      crossfaderGainNode,
      analyserNode,
    };
  }

  private calculateRMSFromAnalyser(analyser: AnalyserNode): number {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128; // -1.0 a 1.0
      sumSquares += normalized * normalized;
    }
    return Math.sqrt(sumSquares / dataArray.length);
  }


  private stopSourceNode(graph: DeckAudioGraph): void {
    if (graph.sourceNode) {
      try {
        graph.sourceNode.onended = null;
        graph.sourceNode.stop();
        graph.sourceNode.disconnect();
      } catch {
        // Ignorar si ya estaba detenido
      }
      graph.sourceNode = null;
    }
  }

  private getDeckGraph(deckId: DeckId): DeckAudioGraph {
    let graph = this.deckGraphs.get(deckId);
    if (!graph) {
      graph = this.buildDeckAudioGraph(deckId);
      this.deckGraphs.set(deckId, graph);
    }
    return graph;
  }

  private getDeckTransport(deckId: DeckId): DeckTransportInternal {
    let transport = this.deckTransports.get(deckId);
    if (!transport) {
      this.initTransport(deckId);
      transport = this.deckTransports.get(deckId)!;
    }
    return transport;
  }

  private notifyPlaybackEnded(deckId: DeckId): void {
    const listeners = this.playbackEndedListeners.get(deckId);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback();
        } catch (err) {
          console.error(`[AudioEngineService] Error en listener de playbackEnded para Deck ${deckId}:`, err);
        }
      });
    }
  }

  private notifyStateChange(status: AudioEngineStatus): void {
    this.stateChangeListeners.forEach((callback) => {
      try {
        callback(status);
      } catch (err) {
        console.error('[AudioEngineService] Error en listener de stateChange:', err);
      }
    });
  }
}

/**
 * Instancia singleton exportada para uso general del sistema.
 */
export const audioEngine = AudioEngineService.getInstance();
