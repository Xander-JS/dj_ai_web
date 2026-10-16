/**
 * SYSTEM DJ — Analysis Sync Manager
 * Coordina la persistencia en IndexedDB y la sincronización reactiva de los análisis musicales
 * con useDJStore y la Biblioteca, manteniendo desacoplado el motor matemático de la UI.
 */

import type { Track, TrackAnalysis } from '../../types/track.ts';
import { AnalysisService, analysisService } from './AnalysisService.ts';
import { IndexedDBStorage, indexedDBStorage } from '../storage/IndexedDBStorage.ts';
import { audioEngine } from '../../audio/index.ts';

export type AudioDecoder = (arrayBuffer: ArrayBuffer) => Promise<AudioBuffer>;
export type AnalysisUpdateListener = (trackId: string, analysis: TrackAnalysis) => void;

/**
 * Determina si un objeto de análisis contiene resultados musicales reales y válidos.
 */
export function isAnalysisValid(analysis?: TrackAnalysis | null): boolean {
  if (!analysis) return false;
  if (analysis.status !== 'analyzed') return false;
  const hasBpm = typeof analysis.bpm === 'number' && analysis.bpm > 0;
  const hasKey = typeof analysis.key === 'string' && analysis.key.length > 0;
  return hasBpm || hasKey;
}

export class AnalysisSyncManager {
  private static instance: AnalysisSyncManager | null = null;

  private service: AnalysisService;
  private storage: IndexedDBStorage;
  private decodeAudio: AudioDecoder;

  // Tokens de solicitud por pista para prevenir escrituras obsoletas por re-análisis
  private activeTokens: Map<string, number> = new Map();
  private listeners: Set<AnalysisUpdateListener> = new Set();

  constructor(
    service: AnalysisService = analysisService,
    storage: IndexedDBStorage = indexedDBStorage,
    decodeAudio: AudioDecoder = (buf) => audioEngine.decodeAudioData(buf)
  ) {
    this.service = service;
    this.storage = storage;
    this.decodeAudio = decodeAudio;

    // Escuchar actualizaciones directas del servicio de análisis (p. ej. 'analyzing', 'failed', 'unsupported')
    this.service.subscribe((update) => {
      if (update.result) {
        this.notifyListeners(update.trackId, update.result);
      } else if (update.status === 'failed' || update.status === 'unsupported') {
        const failureAnalysis: TrackAnalysis = {
          status: update.status,
          analysisError: update.error || 'Fallo en servicio de análisis',
        };
        this.notifyListeners(update.trackId, failureAnalysis);
      }
    });
  }

  public static getInstance(): AnalysisSyncManager {
    if (!AnalysisSyncManager.instance) {
      AnalysisSyncManager.instance = new AnalysisSyncManager();
    }
    return AnalysisSyncManager.instance;
  }

  /**
   * Suscripción a cambios de análisis de pistas.
   */
  public subscribe(listener: AnalysisUpdateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Solicita el análisis musical de una pista y persiste el resultado en IndexedDB.
   * - Si ya existe un análisis válido y no se especifica `force`, se devuelve sin reanalizar.
   * - Si el archivo físico cambió bajo el mismo trackId, se invalida el análisis anterior y se reanaliza.
   * - Si la pista se elimina durante el análisis, la escritura se descarta para evitar registros huérfanos.
   * - Si ocurre un error, se guarda con status: 'failed' sin inventar métricas.
   */
  public async analyzeTrack(track: Track, options: { force?: boolean } = {}): Promise<TrackAnalysis> {
    const trackId = track.id;

    // Registrar nuevo token activo inmediatamente para indicar isAnalyzing y descartar desfasados
    const currentToken = (this.activeTokens.get(trackId) ?? 0) + 1;
    this.activeTokens.set(trackId, currentToken);

    // 1. Evitar reanalizar si el resultado vigente ya está en memoria (salvo reemplazo de archivo)
    if (!options.force && isAnalysisValid(track.analysis)) {
      try {
        const storedTrack = await this.storage.getTrack(trackId);
        const fileChanged =
          storedTrack &&
          track.fileMeta &&
          storedTrack.fileMeta &&
          (track.fileMeta.fileSize !== storedTrack.fileMeta.fileSize ||
            track.fileMeta.fileName !== storedTrack.fileMeta.fileName ||
            track.fileMeta.lastModified !== storedTrack.fileMeta.lastModified);

        if (fileChanged) {
          await this.invalidateAnalysis(trackId);
          options = { ...options, force: true };
        } else {
          this.activeTokens.delete(trackId);
          return track.analysis;
        }
      } catch {
        this.activeTokens.delete(trackId);
        return track.analysis;
      }
    }

    // 2. Comprobar si IndexedDB ya contiene un análisis válido persistido
    if (!options.force) {
      try {
        const storedTrack = await this.storage.getTrack(trackId);
        if (storedTrack) {
          const fileChanged =
            track.fileMeta &&
            storedTrack.fileMeta &&
            (track.fileMeta.fileSize !== storedTrack.fileMeta.fileSize ||
              track.fileMeta.fileName !== storedTrack.fileMeta.fileName ||
              track.fileMeta.lastModified !== storedTrack.fileMeta.lastModified);

          if (fileChanged) {
            await this.invalidateAnalysis(trackId);
            options = { ...options, force: true };
          } else if (isAnalysisValid(storedTrack.analysis)) {
            this.activeTokens.delete(trackId);
            track.analysis = storedTrack.analysis;
            this.notifyListeners(trackId, storedTrack.analysis);
            return storedTrack.analysis;
          }
        }
      } catch (err) {
        console.warn(`[AnalysisSyncManager] Error consultando análisis previo de ${trackId}:`, err);
      }
    }

    // 3. Marcar estado transitorio 'analyzing'
    const analyzingState: TrackAnalysis = {
      status: 'analyzing',
    };
    track.analysis = analyzingState;
    this.notifyListeners(trackId, analyzingState);

    // 4. Recuperar el Blob binario de audio
    let audioBlob: Blob | null = track.source.blob || track.source.file || null;
    if (!audioBlob) {
      try {
        audioBlob = await this.storage.getTrackBlob(trackId);
      } catch (err) {
        console.warn(`[AnalysisSyncManager] Error recuperando Blob de ${trackId}:`, err);
        audioBlob = null;
      }
    }

    if (!audioBlob) {
      const failureResult: TrackAnalysis = {
        status: 'failed',
        analysisError: 'Archivo de audio no disponible para decodificación',
      };
      return this.handleAnalysisCompletion(trackId, currentToken, failureResult, track);
    }

    // 6. Decodificar audio a PCM Float32Array
    let pcm: Float32Array;
    let sampleRate: number;
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      if (this.activeTokens.get(trackId) !== currentToken) {
        // Solicitud descartada por un nuevo análisis o cancelación
        return track.analysis;
      }

      const audioBuffer = await this.decodeAudio(arrayBuffer);
      pcm = audioBuffer.getChannelData(0);
      sampleRate = audioBuffer.sampleRate;
    } catch (decodeErr) {
      const failureResult: TrackAnalysis = {
        status: 'failed',
        analysisError: `Fallo al decodificar audio para análisis: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`,
      };
      return this.handleAnalysisCompletion(trackId, currentToken, failureResult, track);
    }

    // 7. Encolar en el Worker mediante AnalysisService
    try {
      const rawResult = await this.service.queueAnalysis(trackId, pcm, sampleRate, {
        transferBuffer: false,
      });

      return await this.handleAnalysisCompletion(trackId, currentToken, rawResult, track);
    } catch (analysisErr) {
      const failureResult: TrackAnalysis = {
        status: 'failed',
        analysisError: analysisErr instanceof Error ? analysisErr.message : String(analysisErr),
      };
      return await this.handleAnalysisCompletion(trackId, currentToken, failureResult, track);
    }
  }

  /**
   * Finaliza el análisis protegiendo contra escrituras obsoletas si la pista fue eliminada
   * o superada por una nueva solicitud.
   */
  private async handleAnalysisCompletion(
    trackId: string,
    token: number,
    result: TrackAnalysis,
    trackRef?: Track
  ): Promise<TrackAnalysis> {
    // Si el token ya no es el actual, descartar escritura (hubo un análisis más reciente)
    if (this.activeTokens.get(trackId) !== token) {
      return result;
    }

    this.activeTokens.delete(trackId);

    // Verificar si la pista aún existe en el almacenamiento (evitar resucitar pistas eliminadas)
    const trackExists = await this.storage.hasTrack(trackId);
    if (!trackExists) {
      // Pista eliminada durante el procesamiento: descartar persistencia
      return result;
    }

    // Persistir el resultado atómicamente en IndexedDB
    try {
      await this.storage.updateTrackAnalysis(trackId, result);
    } catch (err) {
      console.warn(`[AnalysisSyncManager] Error persistiendo análisis de ${trackId}:`, err);
    }

    // Actualizar referencia de memoria si está presente
    if (trackRef) {
      trackRef.analysis = result;
    }

    // Notificar reactivamente a los suscriptores (useDJStore, Decks, Biblioteca)
    this.notifyListeners(trackId, result);

    return result;
  }

  /**
   * Invalida los metadatos de análisis de una pista (p. ej. si el archivo cambió).
   */
  public async invalidateAnalysis(trackId: string): Promise<void> {
    this.service.cancelAnalysis(trackId);
    this.activeTokens.delete(trackId);

    const pendingAnalysis: TrackAnalysis = {
      status: 'pending',
    };

    const exists = await this.storage.hasTrack(trackId);
    if (exists) {
      await this.storage.updateTrackAnalysis(trackId, pendingAnalysis);
    }

    this.notifyListeners(trackId, pendingAnalysis);
  }

  /**
   * Indica si una pista está actualmente en proceso de análisis o en cola.
   */
  public isAnalyzing(trackId: string): boolean {
    return this.activeTokens.has(trackId) || this.service.isAnalyzing(trackId);
  }

  /**
   * Cancela cualquier análisis activo, en preparación o pendiente para la pista
   * y restablece su estado a 'pending' para que no quede indefinidamente en 'analyzing'.
   */
  public cancelAnalysis(trackId: string): boolean {
    const wasActiveInManager = this.activeTokens.has(trackId);
    this.activeTokens.delete(trackId);
    const wasActiveInService = this.service.cancelAnalysis(trackId);

    const pendingAnalysis: TrackAnalysis = {
      status: 'pending',
    };

    void this.storage.hasTrack(trackId).then((exists) => {
      if (exists) {
        void this.storage.updateTrackAnalysis(trackId, pendingAnalysis);
      }
    });

    this.notifyListeners(trackId, pendingAnalysis);
    return wasActiveInManager || wasActiveInService;
  }

  private notifyListeners(trackId: string, analysis: TrackAnalysis): void {
    for (const listener of this.listeners) {
      try {
        listener(trackId, analysis);
      } catch (err) {
        console.warn('[AnalysisSyncManager] Error en suscriptor de análisis:', err);
      }
    }
  }
}

export const analysisSyncManager = AnalysisSyncManager.getInstance();
