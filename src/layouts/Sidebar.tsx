import React, { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Music, ListMusic, SlidersHorizontal, Disc3 } from 'lucide-react';
import { clsx } from 'clsx';
import { Icon } from '../components/atoms/Icon';
import { useAnimationsEnabled } from '../design-system/motionPreference';
import './Sidebar.css';

/**
 * Luz que sigue al cursor sobre la rejilla del panel. Solo escribe dos variables CSS por
 * fotograma (sin estado de React); la geometría se mide al entrar, no en cada movimiento.
 * Los punteros táctiles no tienen hover y se ignoran.
 */
function useCursorLight(ref: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let frame = 0;
    let rect = el.getBoundingClientRect();
    let x = 0;
    let y = 0;

    const write = () => {
      frame = 0;
      el.style.setProperty('--sd-light-x', `${x}px`);
      el.style.setProperty('--sd-light-y', `${y}px`);
    };

    const track = (event: PointerEvent) => {
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
    };

    const handleEnter = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      rect = el.getBoundingClientRect();
      track(event);
      // La luz aparece donde está el cursor, sin deslizarse desde la última posición
      el.classList.add('is-light-snapping');
      write();
      el.dataset.light = 'on';
      requestAnimationFrame(() => el.classList.remove('is-light-snapping'));
    };

    const handleMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      track(event);
      if (el.dataset.light !== 'on') el.dataset.light = 'on';
      if (!frame) frame = requestAnimationFrame(write);
    };

    const handleLeave = () => {
      delete el.dataset.light;
    };

    el.addEventListener('pointerenter', handleEnter);
    el.addEventListener('pointermove', handleMove, { passive: true });
    el.addEventListener('pointerleave', handleLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointerenter', handleEnter);
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerleave', handleLeave);
      delete el.dataset.light;
      el.style.removeProperty('--sd-light-x');
      el.style.removeProperty('--sd-light-y');
    };
  }, [ref, enabled]);
}

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  useCursorLight(panelRef, useAnimationsEnabled());

  const getNavClass = ({ isActive }: { isActive: boolean }) =>
    clsx('sidebar-nav-item', isActive && 'active');

  return (
    <aside className="layout-sidebar sidebar-aside">
      <div ref={panelRef} className="sidebar-panel">
        <span className="sidebar-panel__edge" aria-hidden="true" />
        <nav className="sidebar-nav">

          <NavLink to="/dashboard" className={getNavClass} title={t('navigation.home')}>
            <Icon icon={Home} size="md" />
            <span className="sidebar-nav-label">{t('navigation.home')}</span>
          </NavLink>

          <NavLink to="/library" className={getNavClass} title={t('navigation.library')}>
            <Icon icon={Music} size="md" />
            <span className="sidebar-nav-label">{t('navigation.library')}</span>
          </NavLink>

          <NavLink to="/playlists" className={getNavClass} title={t('navigation.playlists')}>
            <Icon icon={ListMusic} size="md" />
            <span className="sidebar-nav-label">{t('navigation.playlists')}</span>
          </NavLink>

          <NavLink to="/mixer" className={getNavClass} title={t('navigation.mixer')}>
            <Icon icon={SlidersHorizontal} size="md" />
            <span className="sidebar-nav-label">{t('navigation.mixer')}</span>
          </NavLink>

          <NavLink to="/sessions" className={getNavClass} title={t('navigation.sessions')}>
            <Icon icon={Disc3} size="md" />
            <span className="sidebar-nav-label">{t('navigation.sessions')}</span>
          </NavLink>

        </nav>
      </div>
    </aside>
  );
};
