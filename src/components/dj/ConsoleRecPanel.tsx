import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { sessionCaptureControl, type SessionCaptureSnapshot } from '../../services/session/sessionCaptureControl';
import { toggleSessionCaptureWithFeedback } from '../../services/session/sessionCaptureFeedback';
import { formatDuration } from '../../utils/formatters';
import './ConsoleRecPanel.css';

/** Refresco del contador; solo afecta a la interfaz, nunca al grabador ni al motor de audio. */
const CLOCK_TICK_MS = 500;

/** Duración de la captura: en vivo mientras graba, la final al detenerse y 0 sin grabaciones. */
function useCaptureElapsedMs(capture: SessionCaptureSnapshot): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!capture.active) return;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [capture.active]);
  if (capture.active) return Math.max(0, now - (capture.startedAtEpochMs ?? now));
  return capture.durationMs ?? 0;
}

/**
 * Panel de grabación de la consola: estado ON / OFF y tiempo de la sesión sobre el botón REC con LED.
 * Usa la captura existente; la sesión detenida queda en Sesiones para exportarla.
 */
export const ConsoleRecPanel: React.FC = () => {
  const { t } = useTranslation();
  const capture = useSyncExternalStore(sessionCaptureControl.subscribe, sessionCaptureControl.getSnapshot);
  const elapsedMs = useCaptureElapsedMs(capture);
  const time = formatDuration(elapsedMs / 1000).padStart(5, '0');

  return (
    <div
      className={clsx('console-rec-panel', capture.active && 'is-recording')}
      role="group"
      aria-label={t('mixer.rec_panel')}
      data-testid="console-rec-panel"
    >
      <div className="console-rec-readout">
        <span className="console-rec-state" role="status" data-testid="console-rec-state">
          <span className="sd-visually-hidden">{t('mixer.rec_status')}: </span>
          {capture.active ? t('mixer.rec_on') : t('mixer.rec_off')}
        </span>
        {/* Fuera de la región viva: el tiempo no se anuncia en cada tic, solo el cambio de estado */}
        <span className="console-rec-time sd-num" data-testid="console-rec-time">
          <span className="sd-visually-hidden">{t('mixer.rec_elapsed')}: </span>
          {time}
        </span>
      </div>
      <button
        type="button"
        className="mixer-cue-btn console-rec-btn"
        aria-pressed={capture.active}
        aria-label={capture.active ? t('mixer.rec_stop') : t('mixer.rec_start')}
        title={capture.active ? t('mixer.rec_stop') : t('mixer.rec_start')}
        data-testid="console-rec-btn"
        onClick={() => toggleSessionCaptureWithFeedback()}
      >
        <span className="mixer-btn-led console-rec-led" aria-hidden="true" />
        {t('mixer.rec_label')}
      </button>
    </div>
  );
};
