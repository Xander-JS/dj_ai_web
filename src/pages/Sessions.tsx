import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Disc3, History, Radio, XCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Progress } from '../components/ui/Progress';
import { createSessionAudioBufferResolver } from '../session/SessionAudioBufferResolver';
import { sessionExportCoordinator } from '../session/SessionExportCoordinator';
import {
  createSessionDownload,
  createSessionExportFilename,
  initiateSessionDownload,
  releaseSessionDownload,
  type SessionDownloadDescriptor,
} from '../session/SessionExportDownload';
import { SessionExportCanceledError, type SessionExportPhase } from '../session/SessionExporter';
import { getOverallExportPercent, getSessionExportErrorKey, isExportableSession } from '../session/SessionExportUiModel';
import { sessionRecorder, type RecordedSession } from '../session/SessionRecorder';
import { createStoredSessionRecord, MAX_STORED_SESSIONS, type StoredSessionFormat, type StoredSessionRecord } from '../session/SessionHistory';
import type { SessionExportResult } from '../session/SessionExporter';
import { notificationCenter } from '../services/notifications/notificationCenter';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { formatDuration } from '../utils/formatters';
import { useDJStore } from '../store/useDJStore';
import './Sessions.css';

type SessionPageStatus = 'empty' | 'ready' | 'recording' | 'preparing' | 'rendering' | 'encoding' | 'finalizing' | 'completed' | 'cancelled' | 'error';
type ExportFormat = 'wav' | 'mp3';

const MP3_BITRATES_AT_48_KHZ = [96, 128, 160, 192, 224, 256, 320];
const STORED_FORMATS: StoredSessionFormat[] = ['wav', 'mp3'];
// Margen antes de revocar la URL temporal para que el navegador termine de iniciar la descarga
const STORED_DOWNLOAD_URL_TTL_MS = 60_000;

function initialSessionSnapshot(): { active: boolean; session: RecordedSession | null } {
  const active = sessionRecorder.isActive;
  return { active, session: active ? null : sessionRecorder.getSession() };
}

function phaseStatus(phase: SessionExportPhase): SessionPageStatus {
  return phase;
}

export const Sessions: React.FC = () => {
  const { t } = useTranslation();
  const { startSessionCapture, finalizeSessionCapture } = useDJStore();
  const exportBusy = useSyncExternalStore(
    sessionExportCoordinator.subscribe,
    sessionExportCoordinator.getSnapshot,
    () => false,
  );
  const [capture, setCapture] = useState(initialSessionSnapshot);
  const [status, setStatus] = useState<SessionPageStatus>(() => {
    const snapshot = initialSessionSnapshot();
    return snapshot.active ? 'recording' : isExportableSession(snapshot.session) ? 'ready' : 'empty';
  });
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [bitrateKbps, setBitrateKbps] = useState(192);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [progressIndeterminate, setProgressIndeterminate] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [download, setDownload] = useState<SessionDownloadDescriptor | null>(null);
  const [hasActiveHandle, setHasActiveHandle] = useState(false);
  const activeHandleRef = useRef<ReturnType<typeof sessionExportCoordinator.startExclusive> | null>(null);
  const resolverRef = useRef<ReturnType<typeof createSessionAudioBufferResolver> | null>(null);
  const downloadRef = useRef<SessionDownloadDescriptor | null>(null);
  const mountedRef = useRef(false);
  const operationIdRef = useRef(0);
  const [storedSessions, setStoredSessions] = useState<StoredSessionRecord[]>([]);
  const [historyNotice, setHistoryNotice] = useState('');

  const loadStoredSessions = useCallback(async () => {
    try {
      const sessions = await indexedDBStorage.getRecordedSessions();
      if (mountedRef.current) setStoredSessions(sessions);
    } catch (error) {
      console.warn('[Sessions] Could not load stored sessions:', error);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    indexedDBStorage
      .getRecordedSessions()
      .then((sessions) => {
        if (mountedRef.current) setStoredSessions(sessions);
      })
      .catch((error) => console.warn('[Sessions] Could not load stored sessions:', error));
    return () => {
      mountedRef.current = false;
      operationIdRef.current += 1;
      activeHandleRef.current?.cancel();
      void resolverRef.current?.dispose();
      releaseSessionDownload(downloadRef.current);
      downloadRef.current = null;
    };
  }, []);

  // Persiste la sesión exportada en el historial FIFO de IndexedDB (máx. MAX_STORED_SESSIONS)
  const persistExportedSession = async (session: RecordedSession, result: SessionExportResult): Promise<void> => {
    const saved = await indexedDBStorage.saveRecordedSession(createStoredSessionRecord(session, result));
    if (saved.evicted.length > 0) {
      notificationCenter.push({ type: 'warning', messageKey: 'notifications.session_history_limit', params: { max: MAX_STORED_SESSIONS } });
      if (mountedRef.current) setHistoryNotice(t('notifications.session_history_limit', { max: MAX_STORED_SESSIONS }));
    } else if (mountedRef.current) {
      setHistoryNotice('');
    }
    if (!saved.persisted) {
      notificationCenter.push({ type: 'error', messageKey: 'notifications.session_history_save_failed' });
    }
    await loadStoredSessions();
  };

  const handleDownloadStored = (record: StoredSessionRecord, format: StoredSessionFormat): void => {
    const audio = record.files[format];
    if (!audio) return;
    const url = URL.createObjectURL(audio.blob);
    try {
      initiateSessionDownload({
        url,
        filename: createSessionExportFilename({ sessionId: record.id, metadata: { title: record.title } }, format),
        mimeType: audio.mimeType,
      });
    } catch (error) {
      console.warn('[Sessions] Stored session download was blocked:', error);
      setDownloadError(t('sessions.errors.download'));
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), STORED_DOWNLOAD_URL_TTL_MS);
    }
  };

  const clearDownload = (): void => {
    releaseSessionDownload(downloadRef.current);
    downloadRef.current = null;
    setDownload(null);
  };

  const handleStartCapture = (): void => {
    try {
      clearDownload();
      startSessionCapture();
      setCapture({ active: true, session: null });
      setStatus('recording');
      setErrorMessage('');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleFinalizeCapture = (): void => {
    try {
      const finalized = finalizeSessionCapture();
      const valid = isExportableSession(finalized) ? finalized : null;
      setCapture({ active: false, session: valid });
      setStatus(valid ? 'ready' : 'empty');
      setErrorMessage('');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleStartExport = (): void => {
    const finalizedSession = capture.session;
    if (capture.active || !isExportableSession(finalizedSession) || exportBusy) return;

    clearDownload();
    setDownloadError('');
    setErrorMessage('');
    setProgressPercent(null);
    setProgressIndeterminate(true);
    const operationId = ++operationIdRef.current;
    const resolver = createSessionAudioBufferResolver(finalizedSession);
    resolverRef.current = resolver;

    try {
      const describeError = (error: unknown): string => {
        // Technical detail stays in the console; the user gets a localized explanation.
        console.warn('[Sessions] Session export failed:', error);
        return t(`sessions.errors.${getSessionExportErrorKey(error)}`);
      };
      const handle = sessionExportCoordinator.startExclusive({
        session: finalizedSession,
        resolveBuffer: resolver.resolve,
        format,
        render: { sampleRate: 48_000 },
        mp3: format === 'mp3' ? { bitrateKbps } : undefined,
      }, {
        onProgress: (progress) => {
          if (!mountedRef.current || operationId !== operationIdRef.current) return;
          const overall = getOverallExportPercent(progress);
          setStatus(phaseStatus(progress.phase));
          setProgressPercent(overall);
          setProgressIndeterminate(overall === null);
        },
      });
      activeHandleRef.current = handle;
      setHasActiveHandle(true);

      void handle.result.then((result) => {
        notificationCenter.push({ type: 'success', messageKey: 'notifications.session_exported', params: { format: format.toUpperCase() } });
        void persistExportedSession(finalizedSession, result).catch((error: unknown) => {
          console.warn('[Sessions] Could not store the exported session:', error);
          notificationCenter.push({ type: 'error', messageKey: 'notifications.session_history_save_failed' });
        });
        if (!mountedRef.current || operationId !== operationIdRef.current) return;
        let descriptor: SessionDownloadDescriptor;
        try {
          descriptor = createSessionDownload(result, finalizedSession);
        } catch (error) {
          console.warn('[Sessions] Could not prepare the exported file:', error);
          setStatus('error');
          setErrorMessage(t('sessions.errors.download'));
          return;
        }
        downloadRef.current = descriptor;
        setDownload(descriptor);
        setProgressPercent(100);
        setStatus('completed');
        try {
          initiateSessionDownload(descriptor);
        } catch (error) {
          console.warn('[Sessions] Automatic download was blocked:', error);
          setDownloadError(t('sessions.errors.download'));
        }
      }).catch((error: unknown) => {
        const message = describeError(error);
        if (!(error instanceof SessionExportCanceledError)) {
          notificationCenter.push({
            type: 'error',
            messageKey: 'notifications.session_export_failed',
            params: { error: message },
          });
        }
        if (!mountedRef.current || operationId !== operationIdRef.current) return;
        if (error instanceof SessionExportCanceledError) {
          setStatus('cancelled');
          return;
        }
        setStatus('error');
        setErrorMessage(message);
      }).finally(() => {
        void resolver.dispose();
        if (resolverRef.current === resolver) resolverRef.current = null;
        if (activeHandleRef.current === handle) activeHandleRef.current = null;
        if (mountedRef.current && operationId === operationIdRef.current) setHasActiveHandle(false);
      });
    } catch (error) {
      void resolver.dispose();
      resolverRef.current = null;
      setHasActiveHandle(false);
      console.warn('[Sessions] Session export could not start:', error);
      setStatus('error');
      setErrorMessage(t(`sessions.errors.${getSessionExportErrorKey(error)}`));
    }
  };

  const handleCancelExport = (): void => {
    const handle = activeHandleRef.current;
    if (!handle) return;
    if (!handle.cancel()) return;
    setStatus('cancelled');
    setHasActiveHandle(false);
    // OfflineAudioContext rendering may finish in the background after cancellation.
    // The coordinator keeps the slot locked until that underlying work settles.
  };

  const canExport = !capture.active && isExportableSession(capture.session);
  const operationActive = ['preparing', 'rendering', 'encoding', 'finalizing'].includes(status);
  const canCancel = ['preparing', 'rendering', 'encoding'].includes(status) && hasActiveHandle;
  const retryLabel = status === 'error' || status === 'cancelled' ? t('sessions.retryExport') : t('sessions.export');
  const statusText = t(`sessions.status.${status}`);

  return (
    <section className="sessions-page" aria-labelledby="sessions-title">
      <header className="sessions-page-header">
        <div>
          <div className="sessions-eyebrow"><Disc3 size={16} aria-hidden="true" />{t('sessions.eyebrow')}</div>
          <h1 id="sessions-title">{t('sessions.title')}</h1>
          <p>{t('sessions.subtitle')}</p>
        </div>
      </header>

      <Card className="session-capture-card">
        <CardBody>
          <div className="session-card-heading">
            <div className="session-icon"><Radio size={20} aria-hidden="true" /></div>
            <div>
              <h2>{t('sessions.captureTitle')}</h2>
              <p>{capture.active ? t('sessions.captureActive') : canExport ? t('sessions.captureFinalized') : t('sessions.captureEmpty')}</p>
            </div>
            <span className={`session-status-badge ${capture.active ? 'is-recording' : canExport ? 'is-ready' : ''}`}>
              {capture.active ? t('sessions.recording') : canExport ? t('sessions.available') : t('sessions.unavailable')}
            </span>
          </div>

          <div className="session-capture-actions">
            {capture.active ? (
              <Button type="button" variant="secondary" disabled={exportBusy} onClick={handleFinalizeCapture}>
                {t('sessions.finishCapture')}
              </Button>
            ) : (
              <Button type="button" variant="outline" disabled={exportBusy} onClick={handleStartCapture}>
                {canExport ? t('sessions.startNewCapture') : t('sessions.startCapture')}
              </Button>
            )}
            {capture.session && !capture.active && (
              <span className="session-meta">
                {t('sessions.eventCount', { count: capture.session.events.length })}
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      <Card className="session-export-card">
        <CardBody>
          <div className="session-card-heading">
            <div>
              <h2>{t('sessions.exportTitle')}</h2>
              <p>{t('sessions.exportSubtitle')}</p>
            </div>
          </div>

          {!canExport && (
            <div className="session-empty-state" role="status">
              <p>{capture.active ? t('sessions.finishBeforeExport') : t('sessions.noExportableSession')}</p>
            </div>
          )}

          <div className="session-export-options">
            <div className="session-field">
              <label htmlFor="session-export-format">{t('sessions.format')}</label>
              <select
                id="session-export-format"
                value={format}
                disabled={!canExport || exportBusy}
                onChange={(event) => setFormat(event.target.value as ExportFormat)}
              >
                <option value="wav">{t('sessions.wav')}</option>
                <option value="mp3">{t('sessions.mp3')}</option>
              </select>
              <small>{format === 'wav' ? t('sessions.wavInfo') : t('sessions.mp3Info')}</small>
            </div>

            {format === 'mp3' && (
              <div className="session-field">
                <label htmlFor="session-export-bitrate">{t('sessions.bitrate')}</label>
                <select
                  id="session-export-bitrate"
                  value={bitrateKbps}
                  disabled={!canExport || exportBusy}
                  onChange={(event) => setBitrateKbps(Number(event.target.value))}
                >
                  {MP3_BITRATES_AT_48_KHZ.map((bitrate) => (
                    <option key={bitrate} value={bitrate}>{t('sessions.bitrateOption', { bitrate })}</option>
                  ))}
                </select>
                <small>{t('sessions.bitrateInfo')}</small>
              </div>
            )}
          </div>

          <div className="session-export-status" aria-live="polite" aria-atomic="true">
            <div className="session-status-line">
              {status === 'completed' && <CheckCircle2 size={18} aria-hidden="true" />}
              {status === 'cancelled' && <XCircle size={18} aria-hidden="true" />}
              <strong>{statusText}</strong>
              {operationActive && progressPercent !== null && <span>{Math.round(progressPercent)}%</span>}
            </div>
            {operationActive && (
              <Progress
                className="session-export-progress"
                size="md"
                value={progressPercent ?? undefined}
                indeterminate={progressIndeterminate || progressPercent === null}
                aria-label={t('sessions.progressLabel', { phase: statusText })}
                aria-valuetext={progressPercent === null ? statusText : `${Math.round(progressPercent)}%`}
              />
            )}
            {status === 'rendering' && progressPercent === null && <p className="session-muted-note">{t('sessions.renderingNote')}</p>}
            {exportBusy && !hasActiveHandle && <p className="session-muted-note">{t('sessions.cancelRenderWait')}</p>}
            {status === 'error' && <p className="session-error-message" role="alert">{errorMessage}</p>}
            {downloadError && <p className="session-error-message" role="alert">{downloadError}</p>}
            {status === 'completed' && download && (
              <div className="session-download-result">
                <span>{t('sessions.fileReady', { filename: download.filename })}</span>
                <a href={download.url} download={download.filename} type={download.mimeType}>
                  <Download size={16} aria-hidden="true" />{t('sessions.saveFile')}
                </a>
              </div>
            )}
          </div>

          <div className="session-export-actions">
            <Button
              type="button"
              variant="primary"
              disabled={!canExport || exportBusy || operationActive}
              aria-busy={operationActive}
              onClick={handleStartExport}
            >
              {retryLabel}
            </Button>
            {canCancel && (
              <Button type="button" variant="outline" onClick={handleCancelExport}>
                {t('sessions.cancelExport')}
              </Button>
            )}
          </div>

          <p className="session-limit-note">{t('sessions.limitInfo')}</p>
        </CardBody>
      </Card>

      <Card className="session-export-card">
        <CardBody>
          <div className="session-card-heading">
            <div className="session-icon"><History size={20} aria-hidden="true" /></div>
            <div>
              <h2>{t('sessions.historyTitle')}</h2>
              <p>{t('sessions.historySubtitle', { max: MAX_STORED_SESSIONS })}</p>
            </div>
            <span className="session-status-badge">
              {t('sessions.historyCount', { count: storedSessions.length, max: MAX_STORED_SESSIONS })}
            </span>
          </div>

          {historyNotice && <p className="session-muted-note" role="status">{historyNotice}</p>}

          {storedSessions.length === 0 ? (
            <div className="session-empty-state" role="status">
              <p>{t('sessions.historyEmpty')}</p>
            </div>
          ) : (
            storedSessions.map((record) => (
              <div key={record.id} className="session-download-result" data-testid={`stored-session-${record.id}`}>
                <span>
                  {record.title?.trim() && <>{record.title.trim()}{' · '}</>}
                  <strong>{new Date(record.recordedAt).toLocaleString()}</strong>
                  {' · '}
                  {t('sessions.historyDuration', { duration: formatDuration(record.durationMs / 1000) })}
                  {' · '}
                  {t('sessions.eventCount', { count: record.eventCount })}
                </span>
                <div className="session-capture-actions" style={{ marginTop: 0 }}>
                  {STORED_FORMATS.filter((storedFormat) => record.files[storedFormat]).map((storedFormat) => (
                    <Button
                      key={storedFormat}
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={t('sessions.historyDownload', { format: storedFormat.toUpperCase() })}
                      onClick={() => handleDownloadStored(record, storedFormat)}
                    >
                      <Download size={14} aria-hidden="true" />
                      {storedFormat.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </section>
  );
};
