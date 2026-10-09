import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Music, ListMusic, SlidersHorizontal } from 'lucide-react';
import { clsx } from 'clsx';
import './Sidebar.css';

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();

  const getNavClass = ({ isActive }: { isActive: boolean }) => 
    clsx('sidebar-nav-item', isActive && 'active');

  return (
    <aside className="layout-sidebar sidebar-aside">
      <nav className="sidebar-nav">
        
        <NavLink to="/dashboard" className={getNavClass}>
          <Home size={20} />
          <span>{t('navigation.home')}</span>
        </NavLink>

        <NavLink to="/library" className={getNavClass}>
          <Music size={20} />
          <span>{t('navigation.library')}</span>
        </NavLink>

        <NavLink to="/playlists" className={getNavClass}>
          <ListMusic size={20} />
          <span>{t('navigation.playlists')}</span>
        </NavLink>

        <NavLink to="/mixer" className={getNavClass}>
          <SlidersHorizontal size={20} />
          <span>{t('navigation.mixer')}</span>
        </NavLink>

      </nav>
    </aside>
  );
};
