import type { RecordedSession } from './SessionRecorder.ts';
import { SessionRenderError } from './OfflineSessionRenderer.ts';
import { SessionExportBusyError } from './SessionExportCoordinator.ts';
import { SessionExportCanceledError, SessionExportError, type SessionExportProgress } from './SessionExporter.ts';

/** A session becomes exportable only after capture has ended and produced events and duration. */
export function isExportableSession(session: RecordedSession | null): session is RecordedSession {
  return Boolean(session
    && Number.isFinite(session.durationMs)
    && (session.durationMs ?? 0) > 0
    && Array.isArray(session.events)
    && session.events.length > 0);
}

/** Share of the overall 0–100 bar assigned to each phase: [start, end]. */
const PHASE_RANGES: Record<SessionExportProgress['phase'], [number, number]> = {
  preparing: [0, 0],
  rendering: [0, 50],
  encoding: [50, 95],
  finalizing: [95, 100],
};

/** Maps per-phase measured progress onto one bar; null while the phase is unmeasured. */
export function getOverallExportPercent(progress: SessionExportProgress): number | null {
  const [start, end] = PHASE_RANGES[progress.phase];
  if (progress.phase === 'preparing') return 0;
  if (progress.percent === null) return progress.phase === 'finalizing' ? start : null;
  return start + ((end - start) * Math.max(0, Math.min(100, progress.percent))) / 100;
}

export type SessionExportErrorKey =
  | 'busy'
  | 'canceled'
  | 'missingAudio'
  | 'invalidSession'
  | 'offlineUnavailable'
  | 'renderFailed'
  | 'resourceLimit'
  | 'workerUnavailable'
  | 'encodeFailed'
  | 'invalidRequest'
  | 'unknown';

/** Translates typed export failures into a stable i18n key under `sessions.errors`. */
export function getSessionExportErrorKey(error: unknown): SessionExportErrorKey {
  if (error instanceof SessionExportBusyError) return 'busy';
  if (error instanceof SessionExportCanceledError) return 'canceled';
  if (!(error instanceof SessionExportError)) return 'unknown';
  const cause = error.cause;
  if (cause instanceof SessionRenderError) {
    switch (cause.code) {
      case 'MISSING_BUFFER':
      case 'INVALID_BUFFER':
        return 'missingAudio';
      case 'INVALID_SESSION':
      case 'UNKNOWN_VERSION':
      case 'EMPTY_SESSION':
      case 'INVALID_TIMELINE':
      case 'UNSUPPORTED_EVENT':
      case 'INVALID_DURATION':
        return 'invalidSession';
      case 'OFFLINE_AUDIO_UNAVAILABLE':
        return 'offlineUnavailable';
      case 'RESOURCE_LIMIT':
        return 'resourceLimit';
      default:
        return 'renderFailed';
    }
  }
  switch (error.code) {
    case 'RESOURCE_LIMIT':
      return 'resourceLimit';
    case 'WORKER_UNAVAILABLE':
      return 'workerUnavailable';
    case 'RENDER_FAILED':
      return 'renderFailed';
    case 'ENCODE_FAILED':
    case 'BLOB_UNAVAILABLE':
      return 'encodeFailed';
    case 'INVALID_REQUEST':
      return 'invalidRequest';
    case 'CANCELED':
      return 'canceled';
    default:
      return 'unknown';
  }
}
