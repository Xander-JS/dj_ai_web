import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Music, ListMusic, SlidersHorizontal, Disc3 } from 'lucide-react';
import { clsx } from 'clsx';
import './Sidebar.css';

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();

  const getNavClass = ({ isActive }: { isActive: boolean }) => 
    clsx('sidebar-nav-item', isActive && 'active');

  return (
    <aside className="layout-sidebar sidebar-aside">
      <nav className="sidebar-nav">
        
        <NavLink to="/dashboard" className={getNavClass} title={t('navigation.home')}>
          <Home size={20} />
          <span className="sidebar-nav-label">{t('navigation.home')}</span>
        </NavLink>

        <NavLink to="/library" className={getNavClass} title={t('navigation.library')}>
          <Music size={20} />
          <span className="sidebar-nav-label">{t('navigation.library')}</span>
        </NavLink>

        <NavLink to="/playlists" className={getNavClass} title={t('navigation.playlists')}>
          <ListMusic size={20} />
          <span className="sidebar-nav-label">{t('navigation.playlists')}</span>
        </NavLink>

        <NavLink to="/mixer" className={getNavClass} title={t('navigation.mixer')}>
          <SlidersHorizontal size={20} />
          <span className="sidebar-nav-label">{t('navigation.mixer')}</span>
        </NavLink>

        <NavLink to="/sessions" className={getNavClass} title={t('navigation.sessions')}>
          <Disc3 size={20} />
          <span className="sidebar-nav-label">{t('navigation.sessions')}</span>
        </NavLink>

      </nav>
    </aside>
  );
};
