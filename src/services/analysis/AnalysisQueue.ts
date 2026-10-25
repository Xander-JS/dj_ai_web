/**
 * SYSTEM DJ — Analysis Queue
 * Cola de reanálisis en segundo plano para varias pistas. Procesa una pista cada vez con el
 * flujo de análisis existente (AnalysisSyncManager → worker) y guarda el resultado real de
 * cada una; el resumen solo existe cuando la última ha terminado.
 *
 * Reglas:
 * - Ejecución estrictamente secuencial: la siguiente pista no empieza hasta que la anterior acaba.
 * - Sin duplicados: una pista ya en cola (o en curso) no se vuelve a añadir.
 * - Si la pista ya se está analizando por otra vía (p. ej. al cargarla en un deck), se espera a
 *   que termine y después se reanaliza, para que el resultado sea el pedido.
 * - Una pista eliminada antes o durante su turno se registra como omitida, nunca como analizada.
 * - Vive a nivel de módulo: sobrevive a la navegación entre pantallas, no a una recarga.
 */

import type { Track, TrackAnalysis } from '../../types/track.ts';

export type QueueOutcome = 'analyzed' | 'failed' | 'unsupported' | 'skipped';
/** deleted: la pista ya no existe · stopped: se detuvo la cola antes de su turno · cancelled: su análisis se canceló */
export type QueueSkipReason = 'deleted' | 'stopped' | 'cancelled';

export interface QueueItem {
  trackId: string;
  title: string;
}

export interface QueueResult extends QueueItem {
  outcome: QueueOutcome;
  error?: string;
  reason?: QueueSkipReason;
}

export type QueueStatus = 'idle' | 'running' | 'finished';

export interface AnalysisQueueSnapshot {
  status: QueueStatus;
  /** Pistas de la tanda actual (terminadas + en curso + pendientes) */
  total: number;
  current: QueueItem | null;
  pending: readonly QueueItem[];
  results: readonly QueueResult[];
  stopRequested: boolean;
}

export interface AnalysisQueueDeps {
  /** Lectura fresca de la pista; undefined si fue eliminada */
  getTrack: (trackId: string) => Promise<Track | undefined | null>;
  /** Flujo de análisis existente, forzando reanálisis */
  analyze: (track: Track) => Promise<TrackAnalysis>;
  isAnalyzing: (trackId: string) => boolean;
  /** Resuelve cuando un análisis iniciado por otra vía deja de estar en curso */
  waitUntilIdle: (trackId: string) => Promise<void>;
  /** Una sola llamada al terminar la tanda (resumen en el centro de notificaciones) */
  onFinished?: (snapshot: AnalysisQueueSnapshot) => void;
}

type QueueListener = () => void;

const IDLE: AnalysisQueueSnapshot = {
  status: 'idle',
  total: 0,
  current: null,
  pending: [],
  results: [],
  stopRequested: false,
};

export function summarizeQueue(results: readonly QueueResult[]): {
  analyzed: number;
  failed: number;
  skipped: number;
  processed: number;
} {
  const analyzed = results.filter((r) => r.outcome === 'analyzed').length;
  const failed = results.filter((r) => r.outcome === 'failed' || r.outcome === 'unsupported').length;
  const skipped = results.filter((r) => r.outcome === 'skipped').length;
  return { analyzed, failed, skipped, processed: analyzed + failed };
}

export class AnalysisQueue {
  private deps: AnalysisQueueDeps;
  private snapshot: AnalysisQueueSnapshot = IDLE;
  private listeners: Set<QueueListener> = new Set();

  constructor(deps: AnalysisQueueDeps) {
    this.deps = deps;
  }

  public getSnapshot = (): AnalysisQueueSnapshot => this.snapshot;

  public subscribe = (listener: QueueListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** La pista está en curso o esperando turno en la tanda actual. */
  public isQueued(trackId: string): boolean {
    const { current, pending } = this.snapshot;
    return current?.trackId === trackId || pending.some((item) => item.trackId === trackId);
  }

  /**
   * Añade pistas a la tanda. Con la cola en marcha se suman al final; si había un resumen sin
   * cerrar, empieza una tanda nueva (ese resumen ya quedó en las notificaciones).
   */
  public enqueue(items: QueueItem[]): { added: number; duplicates: number } {
    const base = this.snapshot.status === 'running' ? this.snapshot : IDLE;
    const seen = new Set<string>();
    const fresh: QueueItem[] = [];
    for (const item of items) {
      if (seen.has(item.trackId)) continue;
      seen.add(item.trackId);
      if (base !== IDLE && this.isQueued(item.trackId)) continue;
      fresh.push({ trackId: item.trackId, title: item.title });
    }
    const duplicates = items.length - fresh.length;
    if (fresh.length === 0) return { added: 0, duplicates };

    const wasRunning = base.status === 'running';
    this.set({
      ...base,
      status: 'running',
      total: base.total + fresh.length,
      pending: [...base.pending, ...fresh],
      stopRequested: false,
    });
    if (!wasRunning) void this.run();
    return { added: fresh.length, duplicates };
  }

  /** Detiene la cola: la pista en curso termina; las pendientes se registran como omitidas. */
  public stop(): void {
    if (this.snapshot.status !== 'running') return;
    const stopped: QueueResult[] = this.snapshot.pending.map((item) => ({ ...item, outcome: 'skipped', reason: 'stopped' }));
    this.set({
      ...this.snapshot,
      pending: [],
      results: [...this.snapshot.results, ...stopped],
      stopRequested: true,
    });
  }

  /** Cierra el resumen de una tanda terminada. */
  public dismiss(): void {
    if (this.snapshot.status !== 'finished') return;
    this.set(IDLE);
  }

  private async run(): Promise<void> {
    while (this.snapshot.pending.length > 0) {
      const [item, ...rest] = this.snapshot.pending;
      this.set({ ...this.snapshot, current: item, pending: rest });
      const result = await this.process(item);
      this.set({ ...this.snapshot, current: null, results: [...this.snapshot.results, result] });
    }
    this.set({ ...this.snapshot, status: 'finished', current: null });
    try {
      this.deps.onFinished?.(this.snapshot);
    } catch (err) {
      console.warn('[AnalysisQueue] Error al notificar el final de la cola:', err);
    }
  }

  private async process(item: QueueItem): Promise<QueueResult> {
    try {
      let track = await this.deps.getTrack(item.trackId);
      if (!track) return { ...item, outcome: 'skipped', reason: 'deleted' };

      if (this.deps.isAnalyzing(item.trackId)) {
        await this.deps.waitUntilIdle(item.trackId);
        track = await this.deps.getTrack(item.trackId);
        if (!track) return { ...item, outcome: 'skipped', reason: 'deleted' };
      }

      const title = track.title || item.title;
      const analysis = await this.deps.analyze(track);

      // El gestor devuelve el resultado aunque la pista se borrase durante el análisis
      const stillExists = Boolean(await this.deps.getTrack(item.trackId));
      if (!stillExists) return { trackId: item.trackId, title, outcome: 'skipped', reason: 'deleted' };

      if (analysis.status === 'analyzed') return { trackId: item.trackId, title, outcome: 'analyzed' };
      if (analysis.status === 'failed' || analysis.status === 'unsupported') {
        return { trackId: item.trackId, title, outcome: analysis.status, error: analysis.analysisError };
      }
      // 'pending' o 'analyzing': la solicitud se canceló o fue sustituida antes de terminar
      return { trackId: item.trackId, title, outcome: 'skipped', reason: 'cancelled' };
    } catch (err) {
      return { ...item, outcome: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  private set(next: AnalysisQueueSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.warn('[AnalysisQueue] Error en suscriptor:', err);
      }
    }
  }
}
