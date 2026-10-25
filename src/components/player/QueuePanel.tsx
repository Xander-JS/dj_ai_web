import React, { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ListMusic, Shuffle, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { Tag } from '../atoms/Tag';
import { EmptyState } from '../molecules/EmptyState';
import { playerQueue, usePlayerQueue } from '../../services/player/playerService';
import './QueuePanel.css';

export interface QueuePanelProps {
  /** La pista en curso de la cola es la que tiene cargada el reproductor. */
  isCurrentLoaded: boolean;
  isPlaying: boolean;
  onClose: () => void;
}

/**
 * Panel de la cola de la barra: la pista en curso y las pendientes en el orden en que van a
 * sonar (ya barajado si el aleatorio está activo). Lee y modifica la misma cola que usan los
 * botones Anterior/Siguiente, Home y Playlists.
 */
export const QueuePanel: React.FC<QueuePanelProps> = ({ isCurrentLoaded, isPlaying, onClose }) => {
  const { t } = useTranslation();
  const queue = usePlayerQueue();
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const current = queue.entries[queue.currentIndex] ?? null;
  const upcoming = queue.entries.slice(queue.currentIndex + 1);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section className="sd-queue" role="dialog" aria-labelledby={titleId}>
      <header className="sd-queue__header">
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="sd-queue__title">
          <Icon icon={ListMusic} size="sm" />
          <span className="sd-queue__title-text">{t('player.queue')}</span>
        </h2>
        {queue.shuffle && (
          <Tag tone="ink" className="sd-queue__mode">
            <Icon icon={Shuffle} size="xs" />
            {t('player.shuffle_on')}
          </Tag>
        )}
        <IconButton icon={<Icon icon={X} size="sm" />} size="sm" label={t('common.close')} className="sd-queue__close" onClick={onClose} />
      </header>

      {!current ? (
        <EmptyState
          icon={ListMusic}
          className="sd-queue__empty"
          title={t('player.queue_empty_title')}
          description={t('player.queue_empty_desc')}
        />
      ) : (
        <div className="sd-queue__body">
          <section className="sd-queue__section" aria-label={t('player.queue_now')}>
            <p className="sd-queue__section-label">{t('player.queue_now')}</p>
            <div className={clsx('sd-queue-row sd-queue-row--current', isCurrentLoaded && 'is-loaded')}>
              <span className="sd-queue-row__info">
                <span className="sd-queue-row__title">{current.track.title}</span>
                <span className="sd-queue-row__artist">{current.track.artist || t('dj.unknown_artist')}</span>
              </span>
              <Tag tone={isCurrentLoaded && isPlaying ? 'accent' : 'surface'} className="sd-queue-row__status">
                {isCurrentLoaded && isPlaying ? t('player.status_playing') : t('player.status_paused')}
              </Tag>
            </div>
          </section>

          {/* Pendientes: el recuento vive junto a su sección y solo la lista desplaza */}
          <section className="sd-queue__section sd-queue__section--next" aria-label={t('player.queue_next')}>
            <div className="sd-queue__section-head">
              <p className="sd-queue__section-label">
                {t('player.queue_next')}
                {upcoming.length > 0 && (
                  <span className="sd-queue__count sd-num">{t('player.queue_pending_count', { count: upcoming.length })}</span>
                )}
              </p>
              {upcoming.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => playerQueue.clearUpcoming()}>
                  <Icon icon={Trash2} size="sm" />
                  {t('player.queue_clear')}
                </Button>
              )}
            </div>

            {upcoming.length === 0 ? (
              <p className="sd-queue__none">{t('player.queue_no_pending')}</p>
            ) : (
              <ol className="sd-queue__list">
                {upcoming.map((entry, index) => (
                  <li key={entry.uid} className="sd-queue-row">
                    <span className="sd-queue-row__index sd-num" aria-hidden="true">{index + 1}</span>
                    <button
                      type="button"
                      className="sd-queue-row__main"
                      title={t('player.queue_play_now')}
                      onClick={() => void playerQueue.playEntry(entry.uid)}
                    >
                      <span className="sd-queue-row__title">{entry.track.title}</span>
                      <span className="sd-queue-row__artist">{entry.track.artist || t('dj.unknown_artist')}</span>
                    </button>
                    <IconButton
                      icon={<Icon icon={X} size="sm" />}
                      size="sm"
                      label={t('player.queue_remove', { title: entry.track.title })}
                      onClick={() => playerQueue.remove(entry.uid)}
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </section>
  );
};
