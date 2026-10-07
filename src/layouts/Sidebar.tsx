import React from 'react';
import { Home, Music, ListMusic, SlidersHorizontal } from 'lucide-react';

export const Sidebar: React.FC = () => {
  return (
    <aside className="layout-sidebar" style={{ padding: 'var(--space-4) 0' }}>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: '0 var(--space-2)' }}>
        
        {/* Placeholder Nav Items */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-primary-500)',
          backgroundColor: 'var(--bg-surface-active)',
          fontWeight: 'var(--font-weight-medium)',
          cursor: 'pointer'
        }}>
          <Home size={20} />
          <span>Inicio</span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-secondary)',
          fontWeight: 'var(--font-weight-medium)',
          cursor: 'pointer'
        }}>
          <Music size={20} />
          <span>Biblioteca</span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-secondary)',
          fontWeight: 'var(--font-weight-medium)',
          cursor: 'pointer'
        }}>
          <ListMusic size={20} />
          <span>Playlists</span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-secondary)',
          fontWeight: 'var(--font-weight-medium)',
          cursor: 'pointer'
        }}>
          <SlidersHorizontal size={20} />
          <span>Mixer</span>
        </div>

      </nav>
    </aside>
  );
};
