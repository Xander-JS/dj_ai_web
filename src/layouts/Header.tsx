import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, Search } from 'lucide-react';
import { IconButton } from '../components/atoms/IconButton';
import { Icon } from '../components/atoms/Icon';
import { TextField } from '../components/atoms/TextField';
import { Wordmark } from '../components/atoms/Wordmark';
import { Avatar } from '../components/ui/Avatar';
import { NotificationsPopover } from '../components/organisms/NotificationsPopover';
import { connectAnalysisNotifications } from '../services/notifications/analysisNotifications';
import { useAuth } from '../context/AuthContext';

export const Header: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [query, setQuery] = useState('');

  // El Header vive durante toda la sesión: punto único para escuchar análisis completados
  useEffect(() => connectAnalysisNotifications(), []);

  // La búsqueda global lleva a la Biblioteca con el término (en la URL, ?q=), que filtra en vivo.
  // Al escribir se reemplaza la entrada del historial; Enter deja una entrada propia.
  const goToSearch = (value: string, replace: boolean) => {
    const term = value.trim();
    navigate(term ? `/library?q=${encodeURIComponent(term)}` : '/library', { replace });
  };

  const handleSearchChange = (value: string) => {
    setQuery(value);
    goToSearch(value, true);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    goToSearch(query, false);
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

      <form role="search" className="header-search-form" onSubmit={submitSearch}>
        <TextField
          type="search"
          placeholder={t('common.search')}
          aria-label={t('common.search')}
          icon={<Icon icon={Search} size="sm" />}
          value={query}
          onChange={(e) => handleSearchChange(e.target.value)}
          wrapperClassName="header-search-container"
        />
      </form>

      <div className="header-actions">
        <NotificationsPopover />
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
