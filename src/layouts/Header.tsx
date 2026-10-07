import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Settings, Search, Bell } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { Avatar } from '../components/ui/Avatar';

export const Header: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <header className="layout-header" style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <Link to="/dashboard" style={{ textDecoration: 'none' }}>
          <h1 style={{ fontSize: 'var(--text-xl)', margin: 0, color: 'var(--color-primary-500)' }}>
            SYSTEM DJ
          </h1>
        </Link>
      </div>
      
      <div style={{ flex: 1, maxWidth: '400px', margin: '0 var(--space-8)' }}>
        <div style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '11px', color: 'var(--text-tertiary)' }} />
          <Input placeholder={t('common.search')} style={{ paddingLeft: '38px' }} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <IconButton 
          icon={<Bell size={20} />} 
          title={t('common.notifications')} 
        />
        <IconButton 
          icon={<Settings size={20} />} 
          title={t('navigation.settings')}
          onClick={() => navigate('/settings')}
        />
        <div 
          style={{ marginLeft: 'var(--space-2)', cursor: 'pointer' }}
          onClick={() => navigate('/profile')}
          title={t('navigation.profile')}
        >
          <Avatar fallback="DJ" size="sm" />
        </div>
      </div>
    </header>
  );
};
