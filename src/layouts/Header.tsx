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
