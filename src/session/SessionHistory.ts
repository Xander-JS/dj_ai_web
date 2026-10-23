import type { SessionExportResult } from './SessionExporter.ts';
import type { RecordedSession } from './SessionRecorder.ts';

/** Número máximo de sesiones grabadas que se conservan en IndexedDB (política FIFO). */
export const MAX_STORED_SESSIONS = 5;

export type StoredSessionFormat = 'wav' | 'mp3';

export interface StoredSessionAudio {
  blob: Blob;
  mimeType: 'audio/wav' | 'audio/mpeg';
  byteLength: number;
  sampleRate: number;
  channels: number;
  bitrateKbps?: number;
}

/**
 * Sesión grabada persistida: metadatos del snapshot finalizado más el audio exportado.
 * Una misma sesión exportada en WAV y MP3 ocupa un único registro con ambos archivos.
 */
export interface StoredSessionRecord {
  id: string;                    // sessionId del snapshot grabado
  title?: string;
  recordedAt: number;            // Momento de creación de la grabación (epoch ms)
  savedAt: number;               // Primer guardado: define el orden FIFO
  durationMs: number;
  eventCount: number;
  files: Partial<Record<StoredSessionFormat, StoredSessionAudio>>;
}

export interface SaveSessionResult {
  persisted: boolean;
  /** Sesiones descartadas para respetar el límite (las más antiguas). */
  evicted: StoredSessionRecord[];
  reason?: 'unsupported' | 'quota' | 'error';
}

/** Construye el registro a guardar tras una exportación completada. */
export function createStoredSessionRecord(
  session: RecordedSession,
  result: SessionExportResult,
  savedAt: number = Date.now(),
): StoredSessionRecord {
  return {
    id: session.sessionId,
    title: session.metadata.title,
    recordedAt: session.createdAtEpochMs,
    savedAt,
    durationMs: session.durationMs ?? result.durationMs,
    eventCount: session.events.length,
    files: {
      [result.format]: {
        blob: result.blob,
        mimeType: result.mimeType,
        byteLength: result.byteLength,
        sampleRate: result.sampleRate,
        channels: result.channels,
        bitrateKbps: result.bitrateKbps,
      },
    },
  };
}

/**
 * Calcula el estado del historial tras guardar `incoming`.
 * - Si la sesión ya existe, se fusionan sus archivos y conserva su posición FIFO.
 * - Si es nueva y el historial está lleno, se descartan las más antiguas por savedAt.
 */
export function planSessionHistoryInsert(
  existing: readonly StoredSessionRecord[],
  incoming: StoredSessionRecord,
  limit: number = MAX_STORED_SESSIONS,
): { record: StoredSessionRecord; evicted: StoredSessionRecord[] } {
  const previous = existing.find((record) => record.id === incoming.id);
  if (previous) {
    return {
      record: { ...previous, ...incoming, savedAt: previous.savedAt, files: { ...previous.files, ...incoming.files } },
      evicted: [],
    };
  }

  const oldestFirst = [...existing].sort((a, b) => a.savedAt - b.savedAt);
  const overflow = Math.max(0, oldestFirst.length + 1 - Math.max(1, limit));
  return { record: incoming, evicted: oldestFirst.slice(0, overflow) };
}

/** Orden de presentación: la sesión más reciente primero. */
export function sortSessionsNewestFirst(records: StoredSessionRecord[]): StoredSessionRecord[] {
  return records.sort((a, b) => b.savedAt - a.savedAt);
}
