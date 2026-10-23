import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, Search, Bell, CheckCircle2, AlertCircle } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { StateView } from '../components/ui/StateView';
import { notificationCenter } from '../services/notifications/notificationCenter';
import { connectAnalysisNotifications } from '../services/notifications/analysisNotifications';

export const Header: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notifications = useSyncExternalStore(notificationCenter.subscribe, notificationCenter.getSnapshot);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // El Header vive durante toda la sesión: punto único para escuchar análisis completados
  useEffect(() => connectAnalysisNotifications(), []);

  // Cerrar el panel al hacer clic fuera o pulsar Escape
  useEffect(() => {
    if (!isNotificationsOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (!notificationsRef.current?.contains(e.target as Node)) setIsNotificationsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsNotificationsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
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
            SYSTEM DJ
          </h1>
        </Link>
      </div>

      <Input
        placeholder={t('common.search')}
        icon={<Search size={18} />}
        wrapperClassName="header-search-container"
      />

      <div className="header-actions">
        <div ref={notificationsRef} style={{ position: 'relative' }}>
          <IconButton
            icon={<Bell size={20} />}
            title={t('common.notifications')}
            aria-label={t('common.notifications')}
            aria-haspopup="true"
            aria-expanded={isNotificationsOpen}
            onClick={toggleNotifications}
          />
          {unreadCount > 0 && (
            <Badge
              variant="error"
              aria-label={t('notifications.unread', { count: unreadCount })}
              style={{ position: 'absolute', top: 0, right: 0, pointerEvents: 'none' }}
            >
              {unreadCount}
            </Badge>
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
          icon={<Settings size={20} />}
          title={t('navigation.settings')}
          onClick={() => navigate('/settings')}
        />
        <div
          className="header-profile"
          onClick={() => navigate('/profile')}
          title={t('navigation.profile')}
        >
          <Avatar fallback="DJ" size="sm" />
        </div>
      </div>
    </header>
  );
};
