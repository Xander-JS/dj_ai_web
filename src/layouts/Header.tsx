import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, Search, Bell, CheckCircle2, AlertCircle } from 'lucide-react';
import { IconButton } from '../components/atoms/IconButton';
import { Icon } from '../components/atoms/Icon';
import { TextField } from '../components/atoms/TextField';
import { Wordmark } from '../components/atoms/Wordmark';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { StateView } from '../components/ui/StateView';
import { notificationCenter } from '../services/notifications/notificationCenter';
import { connectAnalysisNotifications } from '../services/notifications/analysisNotifications';
import { useAuth } from '../context/AuthContext';

export const Header: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const notifications = useSyncExternalStore(notificationCenter.subscribe, notificationCenter.getSnapshot);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // El Header vive durante toda la sesión: punto único para escuchar análisis completados
  useEffect(() => connectAnalysisNotifications(), []);

  // Cerrar el panel al hacer clic fuera o pulsar Escape
  useEffect(() => {
    if (!isNotificationsOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!notificationsRef.current?.contains(e.target as Node)) setIsNotificationsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsNotificationsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNotificationsOpen]);

  const toggleNotifications = () => {
    // Al abrir, las alertas visibles pasan a leídas; el contador se reinicia
    if (!isNotificationsOpen) notificationCenter.markAllRead();
    setIsNotificationsOpen((open) => !open);
  };

  return (
    <header className="layout-header layout-header-spaced">
      <div className="header-logo-container">
        <Link to="/dashboard" className="header-logo-link">
          <h1 className="header-logo-text">
            <Wordmark name={t('landing.brand')} />
          </h1>
        </Link>
      </div>

      <TextField
        type="search"
        placeholder={t('common.search')}
        aria-label={t('common.search')}
        icon={<Icon icon={Search} size="sm" />}
        wrapperClassName="header-search-container"
      />

      <div className="header-actions">
        <div ref={notificationsRef} style={{ position: 'relative' }}>
          <IconButton
            icon={<Icon icon={Bell} size="md" />}
            label={t('common.notifications')}
            aria-haspopup="true"
            aria-expanded={isNotificationsOpen}
            onClick={toggleNotifications}
          />
          {unreadCount > 0 && (
            <span
              className="header-notification-count"
              aria-label={t('notifications.unread', { count: unreadCount })}
            >
              {unreadCount}
            </span>
          )}
          {isNotificationsOpen && (
            <Card
              elevated
              role="dialog"
              aria-label={t('common.notifications')}
              style={{ position: 'absolute', right: 0, top: '100%', width: 340, zIndex: 100 }}
            >
              <CardBody>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                  <h3 style={{ margin: 0 }}>{t('common.notifications')}</h3>
                  {notifications.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => notificationCenter.clear()}>
                      {t('notifications.clear')}
                    </Button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <StateView
                    status="empty"
                    icon={Bell}
                    title={t('notifications.empty_title')}
                    description={t('notifications.empty_desc')}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxHeight: 360, overflowY: 'auto' }}>
                    {notifications.map((n) => (
                      <div key={n.id} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
                        {n.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                        <div>
                          <div>{t(n.messageKey, n.params)}</div>
                          <small style={{ color: 'var(--text-secondary)' }}>{new Date(n.createdAt).toLocaleTimeString()}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
        <IconButton
          icon={<Icon icon={Settings} size="md" />}
          label={t('navigation.settings')}
          onClick={() => navigate('/settings')}
        />
        <button
          type="button"
          className="header-profile"
          onClick={() => navigate('/profile')}
          title={t('navigation.profile')}
          aria-label={t('navigation.profile')}
        >
          <Avatar
            size="sm"
            src={profile?.avatar_url ?? undefined}
            alt={profile?.dj_alias || profile?.full_name || user?.email || ''}
            fallback={user ? undefined : 'DJ'}
          />
        </button>
      </div>
    </header>
  );
};
