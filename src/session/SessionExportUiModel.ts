import type { RecordedSession } from './SessionRecorder.ts';

/** A session becomes exportable only after capture has ended and produced events and duration. */
export function isExportableSession(session: RecordedSession | null): session is RecordedSession {
  return Boolean(session
    && Number.isFinite(session.durationMs)
    && (session.durationMs ?? 0) > 0
    && Array.isArray(session.events)
    && session.events.length > 0);
}
