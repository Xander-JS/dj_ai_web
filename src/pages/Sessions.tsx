import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, Disc3, Radio, XCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Progress } from '../components/ui/Progress';
import { createSessionAudioBufferResolver } from '../session/SessionAudioBufferResolver';
import { SessionExportBusyError, sessionExportCoordinator } from '../session/SessionExportCoordinator';
import { createSessionDownload, initiateSessionDownload, releaseSessionDownload, type SessionDownloadDescriptor } from '../session/SessionExportDownload';
import { SessionExportCanceledError, SessionExportError, type SessionExportPhase } from '../session/SessionExporter';
import { isExportableSession } from '../session/SessionExportUiModel';
import { sessionRecorder, type RecordedSession } from '../session/SessionRecorder';
import { notificationCenter } from '../services/notifications/notificationCenter';
import { useDJStore } from '../store/useDJStore';
import './Sessions.css';

type SessionPageStatus = 'empty' | 'ready' | 'recording' | 'preparing' | 'rendering' | 'encoding' | 'finalizing' | 'completed' | 'cancelled' | 'error';
type ExportFormat = 'wav' | 'mp3';

const MP3_BITRATES_AT_48_KHZ = [96, 128, 160, 192, 224, 256, 320];

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationIdRef.current += 1;
      activeHandleRef.current?.cancel();
      void resolverRef.current?.dispose();
      releaseSessionDownload(downloadRef.current);
      downloadRef.current = null;
    };
  }, []);

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
      const handle = sessionExportCoordinator.startExclusive({
        session: finalizedSession,
        resolveBuffer: resolver.resolve,
        format,
        render: { sampleRate: 48_000 },
        mp3: format === 'mp3' ? { bitrateKbps } : undefined,
      }, {
        onProgress: (progress) => {
          if (!mountedRef.current || operationId !== operationIdRef.current) return;
          setStatus(phaseStatus(progress.phase));
          setProgressPercent(progress.percent);
          setProgressIndeterminate(progress.indeterminate);
        },
      });
      activeHandleRef.current = handle;
      setHasActiveHandle(true);

      void handle.result.then((result) => {
        notificationCenter.push({ type: 'success', messageKey: 'notifications.session_exported', params: { format: format.toUpperCase() } });
        if (!mountedRef.current || operationId !== operationIdRef.current) return;
        const descriptor = createSessionDownload(result, finalizedSession);
        downloadRef.current = descriptor;
        setDownload(descriptor);
        setStatus('completed');
        try {
          initiateSessionDownload(descriptor);
        } catch (error) {
          setDownloadError(error instanceof Error ? error.message : String(error));
        }
      }).catch((error: unknown) => {
        if (!(error instanceof SessionExportCanceledError)) {
          notificationCenter.push({
            type: 'error',
            messageKey: 'notifications.session_export_failed',
            params: { error: error instanceof Error ? error.message : String(error) },
          });
        }
        if (!mountedRef.current || operationId !== operationIdRef.current) return;
        if (error instanceof SessionExportCanceledError) {
          setStatus('cancelled');
          return;
        }
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : String(error));
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
      if (error instanceof SessionExportBusyError) {
        setStatus('error');
        setErrorMessage(t('sessions.exportBusy'));
      } else {
        setStatus('error');
        setErrorMessage(error instanceof SessionExportError ? error.message : error instanceof Error ? error.message : String(error));
      }
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
              {status === 'encoding' && progressPercent !== null && <span>{Math.round(progressPercent)}%</span>}
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
            {status === 'rendering' && <p className="session-muted-note">{t('sessions.renderingNote')}</p>}
            {exportBusy && !hasActiveHandle && <p className="session-muted-note">{t('sessions.cancelRenderWait')}</p>}
            {status === 'error' && <p className="session-error-message" role="alert">{errorMessage}</p>}
            {downloadError && <p className="session-error-message" role="alert">{t('sessions.downloadError', { message: downloadError })}</p>}
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
    </section>
  );
};
