import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, ArrowRight, CheckCircle2, ChevronDown, CircleDot, Download, Disc3, History, Info, Loader2, Radio, Square, XCircle, type LucideIcon } from 'lucide-react';
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
import { StepIndicator, type StepItem } from '../components/molecules/StepIndicator';
import { ConsoleTemplate } from '../components/templates/ConsoleTemplate';
import { DURATION, EASE_OUT } from '../design-system/motion';
import { useAnimationsEnabled } from '../design-system/motionPreference';
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

/** Inicio (reloj de pared) de la captura en curso, solo para mostrar su duración en vivo. */
function initialCaptureStartedAt(): number | null {
  return sessionRecorder.isActive ? (sessionRecorder.getSession()?.createdAtEpochMs ?? Date.now()) : null;
}

const CAPTURE_CLOCK_TICK_MS = 1000;

function phaseStatus(phase: SessionExportPhase): SessionPageStatus {
  return phase;
}

// Icono y tono de la línea de estado de la exportación (presentación, no lógica)
const STATUS_ICON: Record<SessionPageStatus, LucideIcon> = {
  empty: Info,
  ready: CircleDot,
  recording: Radio,
  preparing: Loader2,
  rendering: Loader2,
  encoding: Loader2,
  finalizing: Loader2,
  completed: CheckCircle2,
  cancelled: XCircle,
  error: AlertCircle,
};

export const Sessions: React.FC = () => {
  const { t } = useTranslation();
  const { deckA, deckB, startSessionCapture, finalizeSessionCapture } = useDJStore();
  // Solo se puede iniciar la captura mientras suena audio en algún deck
  const isAudioPlaying = deckA.playbackState === 'playing' || deckB.playbackState === 'playing';
  const navigate = useNavigate();
  const exportBusy = useSyncExternalStore(
    sessionExportCoordinator.subscribe,
    sessionExportCoordinator.getSnapshot,
    () => false,
  );
  const [capture, setCapture] = useState(initialSessionSnapshot);
  const [captureStartedAt, setCaptureStartedAt] = useState(initialCaptureStartedAt);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const animationsEnabled = useAnimationsEnabled();
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

  // Durante la captura la lectura de duración sigue el tiempo transcurrido
  useEffect(() => {
    if (!capture.active) return;
    const timer = setInterval(() => setClockNow(Date.now()), CAPTURE_CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [capture.active]);

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
      const started = startSessionCapture();
      setCaptureStartedAt(started.createdAtEpochMs);
      setClockNow(started.createdAtEpochMs);
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
  const captureDurationMs = capture.active
    ? Math.max(0, clockNow - (captureStartedAt ?? clockNow))
    : (capture.session?.durationMs ?? 0);
  const readoutTransition = { duration: animationsEnabled ? DURATION.base : 0, ease: EASE_OUT };
  const operationActive = ['preparing', 'rendering', 'encoding', 'finalizing'].includes(status);
  const canCancel = ['preparing', 'rendering', 'encoding'].includes(status) && hasActiveHandle;
  const retryLabel = status === 'error' || status === 'cancelled' ? t('sessions.retryExport') : t('sessions.export');
  const statusText = t(`sessions.status.${status}`);

  const captureTone = capture.active ? 'accent' : canExport ? 'sage' : 'surface';
  const exportSummary = format === 'mp3'
    ? t('sessions.exportSummaryMp3', { bitrate: bitrateKbps })
    : t('sessions.exportSummaryWav');

  // Guía del flujo: grabar → exportar → descargar; refleja el estado real de la página
  const steps: StepItem[] = [
    {
      id: 'capture',
      label: t('sessions.steps.capture'),
      state: capture.active ? 'current' : canExport ? 'done' : 'current',
      hint: capture.active
        ? t('sessions.recording')
        : canExport && capture.session
          ? t('sessions.eventCount', { count: capture.session.events.length })
          : t('sessions.steps.captureHint'),
    },
    {
      id: 'export',
      label: t('sessions.steps.export'),
      state: !canExport ? 'upcoming' : status === 'completed' ? 'done' : status === 'error' ? 'attention' : 'current',
      hint: canExport
        ? (operationActive && progressPercent !== null ? `${statusText} · ${Math.round(progressPercent)}%` : statusText)
        : t('sessions.steps.exportHint'),
    },
    {
      id: 'download',
      label: t('sessions.steps.download'),
      state: status === 'completed' && download ? 'done' : 'upcoming',
      hint: status === 'completed' && download
        ? t('sessions.steps.downloadDone')
        : t('sessions.steps.downloadHint', { max: MAX_STORED_SESSIONS }),
    },
  ];

  return (
    <ConsoleTemplate className="sd-sessions">
      <section className="sd-sessions__page" aria-labelledby="sessions-title">
        <PageHeader
          titleId="sessions-title"
          title={t('sessions.title')}
          description={t('sessions.subtitle')}
        />

        <StepIndicator className="sd-sessions__steps" label={t('sessions.steps.label')} steps={steps} />

        <div className="sd-sessions__grid">
          {/* Paso 1 — Captura: el campo del panel sigue el estado real de la grabación */}
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
            {/* La duración está visible desde el estado inicial (00:00, detenida) y avanza al grabar;
                los eventos guardados salen con un fundido y su columna se conserva, así la duración
                no cambia de sitio ni de ancho */}
            <dl className="sd-sessions-readouts">
              <div className="sd-sessions-readout">
                <dt>{t('sessions.readoutDuration')}</dt>
                <dd className="sd-num">{formatDuration(captureDurationMs / 1000).padStart(5, '0')}</dd>
              </div>
              <AnimatePresence initial={false}>
                {capture.session && !capture.active && (
                  <motion.div
                    key="events"
                    className="sd-sessions-readout"
                    initial={{ opacity: 0, scale: animationsEnabled ? 0.96 : 1 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: animationsEnabled ? 0.96 : 1 }}
                    transition={readoutTransition}
                  >
                    <dt>{t('sessions.readoutEvents')}</dt>
                    <dd className="sd-num">{capture.session.events.length}</dd>
                  </motion.div>
                )}
              </AnimatePresence>
            </dl>

            <div className="sd-sessions-capture__actions">
              {capture.active ? (
                <Button type="button" variant="ink" size="lg" disabled={exportBusy} onClick={handleFinalizeCapture}>
                  <Icon icon={Square} size="md" />
                  {t('sessions.finishCapture')}
                </Button>
              ) : (
                <Button type="button" variant={canExport ? 'ink' : 'accent'} size="lg" disabled={exportBusy || !isAudioPlaying} onClick={handleStartCapture}>
                  <Icon icon={Radio} size="md" />
                  {canExport ? t('sessions.startNewCapture') : t('sessions.startCapture')}
                </Button>
              )}
              {capture.active && (
                <Button type="button" variant="ghost" size="lg" onClick={() => navigate('/mixer')}>
                  {t('sessions.openMixer')}
                  <Icon icon={ArrowRight} size="md" />
                </Button>
              )}
            </div>

            <p className="sd-sessions-note sd-sessions-capture__hint">
              {capture.active ? t('sessions.captureActiveHint') : canExport ? t('sessions.captureReplaceHint') : t('sessions.captureHint')}
            </p>
          </Panel>

          {/* Paso 2 — Exportación de la instantánea finalizada */}
          <Panel
            className="sd-sessions-export"
            icon={Download}
            title={t('sessions.exportTitle')}
            description={t('sessions.exportSubtitle')}
          >
            {!canExport && (
              <Notice tone="info" className="sd-sessions-export__notice">
                {capture.active ? t('sessions.finishBeforeExport') : t('sessions.noExportableSession')}
              </Notice>
            )}

            {/* Ajustes del archivo agrupados en una sola tarjeta */}
            <fieldset className="sd-sessions-export__options" disabled={!canExport || exportBusy}>
              <legend className="sd-sessions-group-label">{t('sessions.settingsTitle')}</legend>
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
            </fieldset>

            {/* Estado de la operación: tono según la fase; los avisos viven aquí */}
            <div
              className={`sd-sessions-export__status sd-sessions-export__status--${status}`}
              aria-live="polite"
              aria-atomic="true"
            >
              {/* Sin sesión exportable el aviso informativo ya explica el estado */}
              {(canExport || status === 'error') && (
                <div className="sd-sessions-export__status-line">
                  <Icon
                    icon={STATUS_ICON[status]}
                    size="md"
                    className={operationActive ? 'sd-sessions-spin' : undefined}
                  />
                  <strong>{statusText}</strong>
                  {operationActive && progressPercent !== null && <span className="sd-sessions-export__percent sd-num">{Math.round(progressPercent)}%</span>}
                </div>
              )}
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
                aria-describedby="session-export-summary"
                onClick={handleStartExport}
              >
                <Icon icon={Download} size="md" />
                {retryLabel}
              </Button>
              {canCancel && (
                <Button type="button" variant="ghost" size="lg" onClick={handleCancelExport}>
                  {t('sessions.cancelExport')}
                </Button>
              )}
              <span id="session-export-summary" className="sd-sessions-export__summary sd-num">{exportSummary}</span>
            </div>

            <details className="sd-sessions-limits">
              <summary>
                <Icon icon={Info} size="sm" />
                {t('sessions.limitsTitle')}
                <Icon icon={ChevronDown} size="sm" className="sd-sessions-limits__chevron" />
              </summary>
              <p className="sd-sessions-note">{t('sessions.limitInfo')}</p>
            </details>
          </Panel>
        </div>

        {/* Paso 3 — Historial de sesiones exportadas */}
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
          {historyNotice && <Notice tone="warning" className="sd-sessions-history__notice">{historyNotice}</Notice>}

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
                    <span className="sd-sessions-history__disc" aria-hidden="true">
                      <Icon icon={Disc3} size="md" />
                    </span>
                    <div className="sd-sessions-history__info">
                      <span className="sd-sessions-history__title">{title || recordedAt}</span>
                      <span className="sd-sessions-history__meta sd-num">
                        {title && <Tag tone="surface">{recordedAt}</Tag>}
                        <Tag tone="surface">{t('sessions.historyDuration', { duration: formatDuration(record.durationMs / 1000) })}</Tag>
                        <Tag tone="surface">{t('sessions.eventCount', { count: record.eventCount })}</Tag>
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
      </section>
    </ConsoleTemplate>
  );
};
