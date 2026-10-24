import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Disc3, History, Radio, Square, XCircle } from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { Icon } from '../components/atoms/Icon';
import { ProgressBar } from '../components/atoms/ProgressBar';
import { SelectField } from '../components/atoms/SelectField';
import { Tag } from '../components/atoms/Tag';
import { EmptyState } from '../components/molecules/EmptyState';
import { Notice } from '../components/molecules/Notice';
import { PageHeader } from '../components/molecules/PageHeader';
import { Panel } from '../components/molecules/Panel';
import { SegmentedControl } from '../components/molecules/SegmentedControl';
import { ConsoleTemplate } from '../components/templates/ConsoleTemplate';
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

  const captureTone = capture.active ? 'accent' : canExport ? 'sage' : 'surface';

  return (
    <ConsoleTemplate className="sd-sessions">
      <section className="sd-sessions__page" aria-labelledby="sessions-title">
        <PageHeader
          titleId="sessions-title"
          title={t('sessions.title')}
          description={t('sessions.subtitle')}
        />

        <div className="sd-sessions__grid">
          <div className="sd-sessions__column">
            {/* Captura: el campo del panel sigue el estado real de la grabación */}
            <Panel
              tone={captureTone}
              className="sd-sessions-capture"
              icon={Radio}
              title={t('sessions.captureTitle')}
              description={capture.active ? t('sessions.captureActive') : canExport ? t('sessions.captureFinalized') : t('sessions.captureEmpty')}
              aside={
                <Tag tone={capture.active ? 'ink' : 'paper'} className="sd-sessions-capture__status">
                  {capture.active && <span className="sd-sessions-capture__dot" aria-hidden="true" />}
                  {capture.active ? t('sessions.recording') : canExport ? t('sessions.available') : t('sessions.unavailable')}
                </Tag>
              }
            >
              <div className="sd-sessions-capture__actions">
                {capture.active ? (
                  <Button type="button" variant="ink" size="lg" disabled={exportBusy} onClick={handleFinalizeCapture}>
                    <Icon icon={Square} size="md" />
                    {t('sessions.finishCapture')}
                  </Button>
                ) : (
                  <Button type="button" variant={canExport ? 'ink' : 'accent'} size="lg" disabled={exportBusy} onClick={handleStartCapture}>
                    <Icon icon={Radio} size="md" />
                    {canExport ? t('sessions.startNewCapture') : t('sessions.startCapture')}
                  </Button>
                )}
                {capture.session && !capture.active && (
                  <span className="sd-sessions-capture__meta sd-num">
                    {t('sessions.eventCount', { count: capture.session.events.length })}
                  </span>
                )}
              </div>
            </Panel>

          {/* Historial de sesiones exportadas */}
          <Panel
            className="sd-sessions-history"
            icon={History}
            title={t('sessions.historyTitle')}
            description={t('sessions.historySubtitle', { max: MAX_STORED_SESSIONS })}
            aside={
              <Tag tone="paper" className="sd-num">
                {t('sessions.historyCount', { count: storedSessions.length, max: MAX_STORED_SESSIONS })}
              </Tag>
            }
          >
            {historyNotice && <Notice tone="warning">{historyNotice}</Notice>}

            {storedSessions.length === 0 ? (
              <div role="status">
                <EmptyState icon={Disc3} title={t('sessions.historyEmpty')} />
              </div>
            ) : (
              <ul className="sd-sessions-history__list">
                {storedSessions.map((record) => {
                  const recordedAt = new Date(record.recordedAt).toLocaleString();
                  const title = record.title?.trim();
                  return (
                    <li key={record.id} className="sd-sessions-history__row" data-testid={`stored-session-${record.id}`}>
                      <div className="sd-sessions-history__info">
                        <span className="sd-sessions-history__title">{title || recordedAt}</span>
                        <span className="sd-sessions-history__meta sd-num">
                          {title && <>{recordedAt}{' · '}</>}
                          {t('sessions.historyDuration', { duration: formatDuration(record.durationMs / 1000) })}
                          {' · '}
                          {t('sessions.eventCount', { count: record.eventCount })}
                        </span>
                      </div>
                      <div className="sd-sessions-history__actions">
                        {STORED_FORMATS.filter((storedFormat) => record.files[storedFormat]).map((storedFormat) => (
                          <Button
                            key={storedFormat}
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={t('sessions.historyDownload', { format: storedFormat.toUpperCase() })}
                            onClick={() => handleDownloadStored(record, storedFormat)}
                          >
                            <Icon icon={Download} size="sm" />
                            {storedFormat.toUpperCase()}
                          </Button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          </div>

          {/* Exportación de la instantánea finalizada */}
          <Panel
            className="sd-sessions-export"
            icon={Download}
            title={t('sessions.exportTitle')}
            description={t('sessions.exportSubtitle')}
          >
            {!canExport && (
              <Notice tone="info">
                {capture.active ? t('sessions.finishBeforeExport') : t('sessions.noExportableSession')}
              </Notice>
            )}

            <div className="sd-sessions-export__options">
              <div className="sd-sessions-field">
                <span className="sd-sessions-field__label" aria-hidden="true">{t('sessions.format')}</span>
                <SegmentedControl
                  label={t('sessions.format')}
                  value={format}
                  disabled={!canExport || exportBusy}
                  options={[
                    { value: 'wav', label: t('sessions.wav') },
                    { value: 'mp3', label: t('sessions.mp3') },
                  ]}
                  onChange={setFormat}
                />
                <small className="sd-sessions-field__hint">{format === 'wav' ? t('sessions.wavInfo') : t('sessions.mp3Info')}</small>
              </div>

              {format === 'mp3' && (
                <div className="sd-sessions-field">
                  <label className="sd-sessions-field__label" htmlFor="session-export-bitrate">{t('sessions.bitrate')}</label>
                  <SelectField
                    id="session-export-bitrate"
                    value={bitrateKbps}
                    disabled={!canExport || exportBusy}
                    onChange={(event) => setBitrateKbps(Number(event.target.value))}
                    wrapperClassName="sd-sessions-field__select"
                  >
                    {MP3_BITRATES_AT_48_KHZ.map((bitrate) => (
                      <option key={bitrate} value={bitrate}>{t('sessions.bitrateOption', { bitrate })}</option>
                    ))}
                  </SelectField>
                  <small className="sd-sessions-field__hint">{t('sessions.bitrateInfo')}</small>
                </div>
              )}
            </div>

            <div className="sd-sessions-export__status" aria-live="polite" aria-atomic="true">
              <div className="sd-sessions-export__status-line">
                {status === 'completed' && <Icon icon={CheckCircle2} size="md" />}
                {status === 'cancelled' && <Icon icon={XCircle} size="md" />}
                <strong>{statusText}</strong>
                {operationActive && progressPercent !== null && <span className="sd-num">{Math.round(progressPercent)}%</span>}
              </div>
              {operationActive && (
                <ProgressBar
                  value={progressPercent ?? undefined}
                  indeterminate={progressIndeterminate || progressPercent === null}
                  aria-label={t('sessions.progressLabel', { phase: statusText })}
                  aria-valuetext={progressPercent === null ? statusText : `${Math.round(progressPercent)}%`}
                />
              )}
              {status === 'rendering' && progressPercent === null && <p className="sd-sessions-note">{t('sessions.renderingNote')}</p>}
              {exportBusy && !hasActiveHandle && <p className="sd-sessions-note">{t('sessions.cancelRenderWait')}</p>}
              {status === 'error' && <Notice tone="error">{errorMessage}</Notice>}
              {downloadError && <Notice tone="error">{downloadError}</Notice>}
              {status === 'completed' && download && (
                <Notice
                  tone="success"
                  role="status"
                  action={
                    <a className="sd-button sd-button--ink sd-button--sm" href={download.url} download={download.filename} type={download.mimeType}>
                      <Icon icon={Download} size="sm" />{t('sessions.saveFile')}
                    </a>
                  }
                >
                  {t('sessions.fileReady', { filename: download.filename })}
                </Notice>
              )}
            </div>

            <div className="sd-sessions-export__actions">
              <Button
                type="button"
                variant="accent"
                size="lg"
                disabled={!canExport || exportBusy || operationActive}
                aria-busy={operationActive}
                onClick={handleStartExport}
              >
                {retryLabel}
              </Button>
              {canCancel && (
                <Button type="button" variant="ghost" size="lg" onClick={handleCancelExport}>
                  {t('sessions.cancelExport')}
                </Button>
              )}
            </div>

            <p className="sd-sessions-note">{t('sessions.limitInfo')}</p>
          </Panel>
        </div>
      </section>
    </ConsoleTemplate>
  );
};
