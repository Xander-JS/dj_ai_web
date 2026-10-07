import React from 'react';
import { Settings, Search, Bell } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { Avatar } from '../components/ui/Avatar';

export const Header: React.FC = () => {
  return (
    <header className="layout-header" style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0, color: 'var(--color-primary-500)' }}>
          SYSTEM DJ
        </h1>
      </div>
      
      <div style={{ flex: 1, maxWidth: '400px', margin: '0 var(--space-8)' }}>
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '11px', color: 'var(--text-tertiary)' }} />
          <Input placeholder="Buscar pistas, artistas..." style={{ paddingLeft: '38px' }} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <IconButton icon={<Bell size={20} />} title="Notificaciones" />
        <IconButton icon={<Settings size={20} />} title="Configuración" />
        <div style={{ marginLeft: 'var(--space-2)' }}>
          <Avatar fallback="DJ" size="sm" />
        </div>
      </div>
    </header>
  );
};
