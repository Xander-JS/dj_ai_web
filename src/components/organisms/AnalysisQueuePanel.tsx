import React, { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, RefreshCw, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { ProgressBar } from '../atoms/ProgressBar';
import { bulkAnalysisQueue, summarizeQueue, type QueueResult } from '../../services/analysis';
import './AnalysisQueuePanel.css';

const COLLAPSED_ROWS = 5;

/**
 * Estado de la cola de reanálisis en la Biblioteca. En marcha: una tira discreta con el progreso
 * real y la pista en curso (sin bloquear nada). Al terminar: el resumen consolidado con los
 * resultados de cada pista y el detalle de los errores, hasta que se cierra.
 */
export const AnalysisQueuePanel: React.FC = () => {
  const { t } = useTranslation();
  const queue = useSyncExternalStore(bulkAnalysisQueue.subscribe, bulkAnalysisQueue.getSnapshot);
  const [expanded, setExpanded] = useState(false);

  if (queue.status === 'idle') return null;

  if (queue.status === 'running') {
    const done = queue.results.length;
    const position = Math.min(queue.total, done + (queue.current ? 1 : 0));
    return (
      <div className="sd-queue sd-queue--running" role="region" aria-label={t('library.queue.region')}>
        <Icon icon={RefreshCw} size="md" className="sd-queue__icon" />
        <div className="sd-queue__body">
          <p className="sd-queue__title sd-num" aria-live="polite">
            {t('library.queue.running', { done: position, total: queue.total })}
            {queue.current && <span className="sd-queue__current">{t('library.queue.current', { title: queue.current.title })}</span>}
          </p>
          <ProgressBar value={queue.total > 0 ? (done / queue.total) * 100 : 0} aria-label={t('library.queue.region')} />
          <p className="sd-queue__hint">
            {queue.stopRequested ? t('library.queue.stopping') : t('library.queue.background_hint')}
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={queue.stopRequested} onClick={() => bulkAnalysisQueue.stop()}>
          {t('library.queue.stop')}
        </Button>
      </div>
    );
  }

  const { analyzed, failed, skipped } = summarizeQueue(queue.results);
  const failures = queue.results.filter((r) => r.outcome === 'failed' || r.outcome === 'unsupported');
  const skippedRows = queue.results.filter((r) => r.outcome === 'skipped');
  const rows = [...failures, ...skippedRows];
  const shownRows = expanded ? rows : rows.slice(0, COLLAPSED_ROWS);

  const describe = (result: QueueResult): string => {
    if (result.outcome === 'skipped') return t(`library.queue.reason_${result.reason ?? 'cancelled'}`);
    const detail = result.error || t('library.queue.error_unknown');
    return result.outcome === 'unsupported' ? `${t('library.queue.unsupported')} · ${detail}` : detail;
  };

  const stats = [
    { key: 'analyzed', label: t('library.queue.stat_analyzed'), value: analyzed },
    { key: 'failed', label: t('library.queue.stat_failed'), value: failed },
    { key: 'skipped', label: t('library.queue.stat_skipped'), value: skipped },
    { key: 'total', label: t('library.queue.stat_total'), value: queue.total },
  ];

  return (
    <section
      className={clsx('sd-queue sd-queue--summary', failed > 0 ? 'sd-field-acid' : 'sd-field-sage')}
      role="status"
      aria-label={t('library.queue.region')}
    >
      <Icon icon={failed > 0 ? AlertCircle : CheckCircle2} size="md" className="sd-queue__icon" />
      <div className="sd-queue__body">
        <h3 className="sd-queue__title">
          {queue.stopRequested ? t('library.queue.summary_stopped_title') : t('library.queue.summary_title')}
        </h3>
        <dl className="sd-queue__stats">
          {stats.map((stat) => (
            <div key={stat.key} className={clsx('sd-queue__stat', stat.key === 'total' && 'sd-queue__stat--total')}>
              <dt>{stat.label}</dt>
              <dd className="sd-num">{stat.value}</dd>
            </div>
          ))}
        </dl>
        {rows.length > 0 && (
          <>
            <ul className="sd-queue__list" aria-label={failures.length > 0 ? t('library.queue.failures_title') : t('library.queue.skipped_title')}>
              {shownRows.map((result) => (
                <li key={result.trackId} className="sd-queue__row">
                  <span className="sd-queue__row-title" title={result.title}>{result.title}</span>
                  <span className="sd-queue__row-detail">{describe(result)}</span>
                </li>
              ))}
            </ul>
            {rows.length > COLLAPSED_ROWS && (
              <Button variant="ghost" size="sm" className="sd-queue__more" onClick={() => setExpanded((v) => !v)}>
                {expanded ? t('library.queue.show_less') : t('library.queue.show_all', { count: rows.length })}
              </Button>
            )}
          </>
        )}
      </div>
      <IconButton
        icon={<Icon icon={X} size="sm" />}
        size="sm"
        label={t('library.queue.dismiss')}
        onClick={() => {
          setExpanded(false);
          bulkAnalysisQueue.dismiss();
        }}
      />
    </section>
  );
};
