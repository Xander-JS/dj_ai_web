/**
 * SYSTEM DJ — Audio Engine Service
 * Implementación desacoplada del motor de audio basada en Web Audio API.
 * Administra el ciclo de vida de AudioContext, grafos de nodos por deck,
 * decodificación de buffers y control de transporte de alta precisión.
 */

import type { DeckId } from '../types/deck';
import type { ChannelEq, CrossfaderCurve } from '../types/mixer';
import type { AudioEngineStatus, DeckAudioGraph, IAudioEngineService } from '../types/audio';

/**
 * Estado interno de transporte y seguimiento temporal por deck.
 */
interface DeckTransportInternal {
  isPlaying: boolean;
  startedAt: number;        // audioContext.currentTime en el momento de reproducir
  startOffset: number;      // Desplazamiento en segundos dentro del buffer
  playbackRate: number;     // Multiplicador de velocidad (0.92 a 1.08 para ±8% pitch)
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

export class AudioEngineService implements IAudioEngineService {
  private static instance: AudioEngineService | null = null;

  private audioContext: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;
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

    this.audioContext = new AudioContextClass();

    // Configurar nodo maestro
    this.masterGainNode = this.audioContext.createGain();
    this.masterGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);
    this.masterGainNode.connect(this.audioContext.destination);

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
  }

  /**
   * Descarga la pista del deck y libera la memoria del AudioBuffer.
   */
  public unloadDeck(deckId: DeckId): void {
    const graph = this.deckGraphs.get(deckId);
    if (!graph) return;

    this.stopSourceNode(graph);
    graph.buffer = null;

    const transport = this.deckTransports.get(deckId);
    if (transport) {
      transport.isPlaying = false;
      transport.startOffset = 0;
      transport.startedAt = 0;
    }
  }

  /**
   * Inicia o continúa la reproducción en el deck especificado.
   */
  public playDeck(deckId: DeckId, startOffsetSeconds?: number): void {
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
    sourceNode.playbackRate.setValueAtTime(transport.playbackRate, ctx.currentTime);
    sourceNode.connect(graph.filterNode);

    // Manejar finalización natural de la reproducción
    sourceNode.onended = () => {
      if (graph.sourceNode === sourceNode) {
        graph.sourceNode = null;
        transport.isPlaying = false;
        transport.startOffset = 0;
        this.notifyPlaybackEnded(deckId);
      }
    };

    graph.sourceNode = sourceNode;
    transport.isPlaying = true;
    transport.startedAt = ctx.currentTime;
    transport.startOffset = offset;

    sourceNode.start(0, offset);
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

    transport.isPlaying = false;
    transport.startOffset = 0;
    transport.startedAt = 0;

    this.stopSourceNode(graph);
  }

  /**
   * Salta a una posición específica de la pista en segundos.
   */
  public seekDeck(deckId: DeckId, positionSeconds: number): void {
    this.ensureInitialized();
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
   * Respeta el rango de pitch definido en el plan: ±8% (factor 0.92 a 1.08).
   */
  public setDeckPlaybackRate(deckId: DeckId, rate: number): void {
    this.ensureInitialized();
    const transport = this.getDeckTransport(deckId);
    const graph = this.getDeckGraph(deckId);

    // Limitar estrictamente al rango ±8%: 0.92 a 1.08
    const clampedRate = Math.max(0.92, Math.min(1.08, rate));

    // Si está sonando, actualizar el offset acumulado antes del cambio de ritmo
    if (transport.isPlaying && this.audioContext) {
      const now = this.audioContext.currentTime;
      const elapsed = (now - transport.startedAt) * transport.playbackRate;
      transport.startOffset += elapsed;
      transport.startedAt = now;
    }

    transport.playbackRate = clampedRate;

    if (graph.sourceNode && this.audioContext) {
      graph.sourceNode.playbackRate.setValueAtTime(clampedRate, this.audioContext.currentTime);
    }
  }

  /**
   * Ajusta la ganancia / trim del canal (0 a 100, centro 50 = unitario).
   */
  public setChannelGain(deckId: DeckId, gainValue: number): void {
    this.ensureInitialized();
    const graph = this.getDeckGraph(deckId);
    if (!this.audioContext) return;

    // 0..100 -> ganancia lineal 0.0 a 2.0 (50 = 1.0)
    const normalizedGain = Math.max(0, Math.min(100, gainValue)) / 50;
    graph.gainNode.gain.setValueAtTime(normalizedGain, this.audioContext.currentTime);
  }

  /**
   * Ajusta una banda del ecualizador de 3 bandas (-12 dB a +12 dB).
   */
  public setChannelEq(deckId: DeckId, band: keyof Omit<ChannelEq, 'filter'>, dbValue: number): void {
    this.ensureInitialized();
    const graph = this.getDeckGraph(deckId);
    if (!this.audioContext) return;

    const clampedDb = Math.max(-12, Math.min(12, dbValue));

    switch (band) {
      case 'high':
        graph.eqHighNode.gain.setValueAtTime(clampedDb, this.audioContext.currentTime);
        break;
      case 'mid':
        graph.eqMidNode.gain.setValueAtTime(clampedDb, this.audioContext.currentTime);
        break;
      case 'low':
        graph.eqLowNode.gain.setValueAtTime(clampedDb, this.audioContext.currentTime);
        break;
    }
  }

  /**
   * Ajusta el filtro bipolar de canal (-100 LowPass a +100 HighPass, 0 bypass).
   */
  public setChannelFilter(deckId: DeckId, filterNormalized: number): void {
    this.ensureInitialized();
    const graph = this.getDeckGraph(deckId);
    if (!this.audioContext) return;

    const val = Math.max(-100, Math.min(100, filterNormalized));
    const filter = graph.filterNode;
    const now = this.audioContext.currentTime;

    if (val === 0) {
      // Centro = Bypass (allpass)
      filter.type = 'allpass';
    } else if (val < 0) {
      // Filtro Lowpass (corte de agudos progresivo de 20 kHz a 200 Hz)
      filter.type = 'lowpass';
      const factor = (val + 100) / 100; // 0.0 a 1.0
      const freq = 200 * Math.pow(20000 / 200, factor);
      filter.frequency.setValueAtTime(freq, now);
    } else {
      // Filtro Highpass (corte de graves progresivo de 20 Hz a 8 kHz)
      filter.type = 'highpass';
      const factor = val / 100; // 0.0 a 1.0
      const freq = 20 * Math.pow(8000 / 20, factor);
      filter.frequency.setValueAtTime(freq, now);
    }
  }

  /**
   * Ajusta el volumen del fader lineal del canal (0 a 100).
   */
  public setChannelVolume(deckId: DeckId, volumeLinear: number): void {
    this.ensureInitialized();
    const graph = this.getDeckGraph(deckId);
    if (!this.audioContext) return;

    const normalizedVol = Math.max(0, Math.min(100, volumeLinear)) / 100;
    graph.volumeNode.gain.setValueAtTime(normalizedVol, this.audioContext.currentTime);
  }

  /**
   * Ajusta la atenuación del crossfader entre Deck A y Deck B según la curva seleccionada.
   */
  public setCrossfader(positionNormalized: number, curve: CrossfaderCurve): void {
    this.ensureInitialized();
    if (!this.audioContext) return;

    // Normaliza a rango 0.0 (Deck A) a 1.0 (Deck B)
    const pos = positionNormalized > 1
      ? Math.max(0, Math.min(100, positionNormalized)) / 100
      : Math.max(0, Math.min(1, positionNormalized));

    let gainA = 1.0;
    let gainB = 1.0;

    switch (curve) {
      case 'linear':
        gainA = 1.0 - pos;
        gainB = pos;
        break;
      case 'constant-power':
        gainA = Math.cos(pos * 0.5 * Math.PI);
        gainB = Math.sin(pos * 0.5 * Math.PI);
        break;
      case 'cut':
        gainA = pos < 0.95 ? 1.0 : (1.0 - pos) * 20;
        gainB = pos > 0.05 ? 1.0 : pos * 20;
        break;
    }

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
   * Ajusta el volumen de salida maestro (0 a 100).
   */
  public setMasterVolume(volumeLinear: number): void {
    this.ensureInitialized();
    if (!this.audioContext || !this.masterGainNode) return;

    const normalized = Math.max(0, Math.min(100, volumeLinear)) / 100;
    this.masterGainNode.gain.setValueAtTime(normalized, this.audioContext.currentTime);
  }

  /**
   * Obtiene la posición actual de reproducción en segundos con precisión matemática.
   */
  public getDeckCurrentTime(deckId: DeckId): number {
    const graph = this.deckGraphs.get(deckId);
    const transport = this.deckTransports.get(deckId);
    if (!graph || !transport) return 0;

    if (!transport.isPlaying || !this.audioContext) {
      return transport.startOffset;
    }

    const elapsed = (this.audioContext.currentTime - transport.startedAt) * transport.playbackRate;
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
   * Obtiene el nivel RMS calculado del medidor VU del deck (0 a 100).
   */
  public getDeckVUMeter(deckId: DeckId): number {
    const graph = this.deckGraphs.get(deckId);
    const transport = this.deckTransports.get(deckId);
    if (!graph || !transport || !transport.isPlaying) {
      return 0;
    }

    const analyser = graph.analyserNode;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128; // Rango -1.0 a 1.0
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);
    return Math.min(100, Math.round(rms * 140));
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

    this.playbackEndedListeners.get('A')?.clear();
    this.playbackEndedListeners.get('B')?.clear();
    this.stateChangeListeners.clear();

    if (this.masterGainNode) {
      try {
        this.masterGainNode.disconnect();
      } catch {
        // Ignorar si ya estaba desconectado
      }
      this.masterGainNode = null;
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
    });
  }

  private ensureInitialized(): void {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      // Inicialización síncrona de recursos base
      const AudioContextClass = getAudioContextConstructor();
      if (!AudioContextClass) {
        throw new Error('Web Audio API no está disponible en este entorno.');
      }
      this.audioContext = new AudioContextClass();
      this.masterGainNode = this.audioContext.createGain();
      this.masterGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);
      this.masterGainNode.connect(this.audioContext.destination);

      this.deckGraphs.set('A', this.buildDeckAudioGraph('A'));
      this.deckGraphs.set('B', this.buildDeckAudioGraph('B'));
    }
  }

  private buildDeckAudioGraph(deckId: DeckId): DeckAudioGraph {
    if (!this.audioContext || !this.masterGainNode) {
      throw new Error('AudioContext o masterGainNode no disponibles para crear el grafo de audio.');
    }
    const ctx = this.audioContext;

    // 1. Filtro Dual (Lowpass / Highpass con inicio allpass/bypass)
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'allpass';

    // 2. Ecualizador de 3 bandas
    const eqHighNode = ctx.createBiquadFilter();
    eqHighNode.type = 'highshelf';
    eqHighNode.frequency.setValueAtTime(2500, ctx.currentTime);
    eqHighNode.gain.setValueAtTime(0, ctx.currentTime);

    const eqMidNode = ctx.createBiquadFilter();
    eqMidNode.type = 'peaking';
    eqMidNode.frequency.setValueAtTime(1000, ctx.currentTime);
    eqMidNode.Q.setValueAtTime(1.0, ctx.currentTime);
    eqMidNode.gain.setValueAtTime(0, ctx.currentTime);

    const eqLowNode = ctx.createBiquadFilter();
    eqLowNode.type = 'lowshelf';
    eqLowNode.frequency.setValueAtTime(300, ctx.currentTime);
    eqLowNode.gain.setValueAtTime(0, ctx.currentTime);

    // 3. Ganancia / Trim de entrada
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(1.0, ctx.currentTime);

    // 4. Fader de volumen de canal
    const volumeNode = ctx.createGain();
    volumeNode.gain.setValueAtTime(0.8, ctx.currentTime);

    // 5. Atenuador del crossfader
    const crossfaderGainNode = ctx.createGain();
    crossfaderGainNode.gain.setValueAtTime(1.0, ctx.currentTime);

    // 6. Analizador para VU Meter y formas de onda
    const analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.8;

    // Enlazar cadena en serie: filter -> eqHigh -> eqMid -> eqLow -> gain -> volume -> crossfader -> analyser -> master
    filterNode.connect(eqHighNode);
    eqHighNode.connect(eqMidNode);
    eqMidNode.connect(eqLowNode);
    eqLowNode.connect(gainNode);
    gainNode.connect(volumeNode);
    volumeNode.connect(crossfaderGainNode);
    crossfaderGainNode.connect(analyserNode);
    analyserNode.connect(this.masterGainNode);

    return {
      deckId,
      sourceNode: null,
      buffer: null,
      filterNode,
      eqHighNode,
      eqMidNode,
      eqLowNode,
      gainNode,
      volumeNode,
      crossfaderGainNode,
      analyserNode,
    };
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
