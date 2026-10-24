import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AudioWaveform,
  Bell,
  Disc3,
  FolderInput,
  KeyRound,
  ListMusic,
  Music,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { Tag } from '../atoms/Tag';
import { EmptyState } from '../molecules/EmptyState';
import { notificationCenter, type AppNotification } from '../../services/notifications/notificationCenter';
import './NotificationsPopover.css';

type NotificationCategory = 'analysis' | 'import' | 'session' | 'playlist' | 'account' | 'library' | 'system';

const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  analysis: AudioWaveform,
  import: FolderInput,
  session: Disc3,
  playlist: ListMusic,
  account: KeyRound,
  library: Music,
  system: Bell,
};

/** El origen sale de la clave i18n con la que cada módulo publica su evento. */
function categoryOf(messageKey: string): NotificationCategory {
  if (messageKey.startsWith('notifications.analysis_')) return 'analysis';
  if (messageKey.startsWith('notifications.import_')) return 'import';
  if (messageKey.startsWith('notifications.session_')) return 'session';
  if (messageKey.startsWith('notifications.playlist_') || messageKey === 'notifications.seed_mix_generated') return 'playlist';
  if (messageKey.startsWith('auth.')) return 'account';
  if (messageKey.startsWith('library.')) return 'library';
  return 'system';
}

const RELATIVE_TICK_MS = 30_000;

function formatRelative(createdAt: number, now: number, language: string): string {
  const seconds = Math.round((createdAt - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (Math.abs(seconds) < 45) return rtf.format(0, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  return rtf.format(Math.round(minutes / 60), 'hour');
}

/**
 * Campana del Header y su panel. Los avisos viven en memoria (notificationCenter):
 * al abrir se marcan como leídos, pero los que llegaron sin leer conservan la marca «Nueva»
 * mientras el panel siga abierto, para que se vea qué ha cambiado.
 */
export const NotificationsPopover: React.FC = () => {
  const { t, i18n } = useTranslation();
  const notifications = useSyncExternalStore(notificationCenter.subscribe, notificationCenter.getSnapshot);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const [open, setOpen] = useState(false);
  const [freshIds, setFreshIds] = useState<ReadonlySet<number>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Cerrar al hacer clic fuera o pulsar Escape (el foco vuelve a la campana)
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Tiempos relativos al día solo mientras el panel está visible
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), RELATIVE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [open]);

  // Lo que llega con el panel abierto también se marca como nuevo y se da por leído
  useEffect(() => {
    if (!open) return;
    return notificationCenter.subscribe(() => {
      const incoming = notificationCenter.getSnapshot().filter((n) => !n.read).map((n) => n.id);
      if (incoming.length === 0) return;
      setFreshIds((current) => new Set([...current, ...incoming]));
      notificationCenter.markAllRead();
    });
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setFreshIds(new Set(notifications.filter((n) => !n.read).map((n) => n.id)));
    setNow(Date.now());
    notificationCenter.markAllRead();
    setOpen(true);
  };

  return (
    <div ref={rootRef} className="sd-notifications">
      <IconButton
        ref={triggerRef}
        icon={<Icon icon={Bell} size="md" />}
        label={t('common.notifications')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={clsx(open && 'is-open')}
        onClick={toggle}
      />
      {unreadCount > 0 && (
        // La clave reinicia el pulso del contador cada vez que llega un aviso
        <span key={unreadCount} className="header-notification-count sd-notifications__count" role="status">
          <span aria-hidden="true">{unreadCount}</span>
          <span className="sd-visually-hidden">{t('notifications.unread', { count: unreadCount })}</span>
        </span>
      )}

      {/* Las entradas del panel y de cada aviso son animaciones CSS: la campana vive en el shell
          y no debe arrastrar framer-motion al paquete inicial */}
      {open && (
        <div role="dialog" aria-labelledby={titleId} className="sd-notifications__panel">
          <header className="sd-notifications__header">
            <div className="sd-notifications__heading">
              <h2 id={titleId} className="sd-notifications__title">
                {t('common.notifications')}
                {notifications.length > 0 && <span className="sd-notifications__total sd-num">{notifications.length}</span>}
              </h2>
              <p className="sd-notifications__scope">{t('notifications.session_scope')}</p>
            </div>
            {notifications.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => notificationCenter.clear()}>
                {t('notifications.clear')}
              </Button>
            )}
          </header>

          {notifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={t('notifications.empty_title')}
              description={t('notifications.empty_desc')}
              className="sd-notifications__empty"
            />
          ) : (
            <ol className="sd-notifications__list" aria-label={t('common.notifications')}>
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  fresh={freshIds.has(n.id)}
                  now={now}
                  language={i18n.language}
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
};

interface NotificationItemProps {
  notification: AppNotification;
  fresh: boolean;
  now: number;
  language: string;
}

// Fila de aviso: el mensaje manda; origen y hora debajo. Un error ocupa un campo ácido, un aviso lleva su etiqueta
const NotificationItem: React.FC<NotificationItemProps> = ({ notification: n, fresh, now, language }) => {
  const { t } = useTranslation();
  const category = categoryOf(n.messageKey);
  const isError = n.type === 'error';

  return (
    <li className="sd-notification-wrap">
      <article
        className={clsx(
          'sd-notification',
          `sd-notification--${n.type}`,
          isError && 'sd-field-acid',
          fresh && 'is-fresh',
        )}
      >
        <span className="sd-notification__icon">
          <Icon icon={CATEGORY_ICON[category]} size="md" />
        </span>
        <div className="sd-notification__body">
          <p className="sd-notification__message">{t(n.messageKey, n.params)}</p>
          <p className="sd-notification__meta">
            <span>{t(`notifications.category.${category}`)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={new Date(n.createdAt).toISOString()} title={new Date(n.createdAt).toLocaleString(language)}>
              {formatRelative(n.createdAt, now, language)}
            </time>
          </p>
        </div>
        <div className="sd-notification__status">
          {n.type === 'warning' && <Tag tone="acid">{t('notifications.status.warning')}</Tag>}
          {isError && <Tag tone="ink">{t('notifications.status.error')}</Tag>}
          {fresh && (
            <span className="sd-notification__fresh">
              <span className="sd-notification__dot" aria-hidden="true" />
              <span className="sd-visually-hidden">{t('notifications.new')}</span>
            </span>
          )}
        </div>
      </article>
    </li>
  );
};
