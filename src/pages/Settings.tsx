import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Palette, Globe, Volume2, PlayCircle, Keyboard, Library } from 'lucide-react';
import { Switch } from '../components/ui/Switch';
import { Button } from '../components/ui/Button';
import { clsx } from 'clsx';
import './Settings.css';

type Tab = 'general' | 'appearance' | 'language' | 'audio' | 'playback' | 'shortcuts' | 'library';

export const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('appearance');
  const [isDarkTheme, setIsDarkTheme] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark' || 
    !document.documentElement.hasAttribute('data-theme')
  );

  const toggleTheme = () => {
    const newTheme = !isDarkTheme;
    setIsDarkTheme(newTheme);
    if (newTheme) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const tabs = [
    { id: 'general', icon: SettingsIcon, label: t('settings.tabs.general') },
    { id: 'appearance', icon: Palette, label: t('settings.tabs.appearance') },
    { id: 'language', icon: Globe, label: t('settings.tabs.language') },
    { id: 'audio', icon: Volume2, label: t('settings.tabs.audio') },
    { id: 'playback', icon: PlayCircle, label: t('settings.tabs.playback') },
    { id: 'shortcuts', icon: Keyboard, label: t('settings.tabs.shortcuts') },
    { id: 'library', icon: Library, label: t('settings.tabs.library') }
  ];

  return (
    <div className="settings-container">
      
      <div className="settings-sidebar">
        {tabs.map(tab => (
          <div 
            key={tab.id}
            className={clsx('settings-tab', activeTab === tab.id && 'active')}
            onClick={() => setActiveTab(tab.id as Tab)}
          >
            <tab.icon size={20} />
            {tab.label}
          </div>
        ))}
      </div>

      <div className="settings-content">
        <h2 className="settings-section-title">
          {tabs.find(t => t.id === activeTab)?.label}
        </h2>

        {activeTab === 'appearance' && (
          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.appearance_title')}</h3>
            <div className="settings-option-card">
              <div>
                <div className="settings-option-title">{t('settings.theme_dark')}</div>
                <div className="settings-option-desc">
                  {t('settings.theme_dark_desc')}
                </div>
              </div>
              <Switch checked={isDarkTheme} onChange={toggleTheme} />
            </div>
          </div>
        )}

        {activeTab === 'language' && (
          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.language_title')}</h3>
            <div className="settings-button-group">
              <Button 
                variant={i18n.language === 'es' ? 'primary' : 'outline'}
                onClick={() => changeLanguage('es')}
              >
                {t('settings.language_es')}
              </Button>
              <Button 
                variant={i18n.language === 'en' ? 'primary' : 'outline'}
                onClick={() => changeLanguage('en')}
              >
                {t('settings.language_en')}
              </Button>
            </div>
          </div>
        )}

        {/* Placeholders for other tabs */}
        {['general', 'audio', 'playback', 'shortcuts', 'library'].includes(activeTab) && (
          <div className="settings-placeholder">
            {t('settings.under_construction', { tab: tabs.find(t => t.id === activeTab)?.label })}
          </div>
        )}

      </div>
    </div>
  );
};
