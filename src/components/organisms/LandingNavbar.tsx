import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../atoms/Button';
import { FadeIn } from '../atoms/FadeIn';
import { Wordmark } from '../atoms/Wordmark';
import { LanguageSwitch, type LanguageOption } from '../molecules/LanguageSwitch';
import { ThemeToggle } from '../molecules/ThemeToggle';
import { useSettingsStore, type AppLanguage } from '../../store/useSettingsStore';
import './LandingNavbar.css';

export interface LandingNavbarProps {
  onLogIn: () => void;
  onSignUp: () => void;
  /** Página de cuenta abierta ahora mismo (Login o Registro): su botón se marca como actual */
  current?: 'login' | 'signup';
}

// Barra superior de la Home: marca, idioma, tema y acceso a la cuenta.
// Idioma y tema se guardan en settingsStore, igual que en Configuración.
export const LandingNavbar: React.FC<LandingNavbarProps> = ({ onLogIn, onSignUp, current }) => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();

  const languages: LanguageOption<AppLanguage>[] = [
    { value: 'es', short: 'ES', name: t('landing.nav.language_es') },
    { value: 'en', short: 'EN', name: t('landing.nav.language_en') },
  ];

  return (
    <FadeIn as="div" className="sd-navbar" y={-20} duration={0.5} amount={0}>
      <nav aria-label={t('landing.nav.label')} className="sd-navbar__inner">
        <Link to="/" className="sd-navbar__brand" aria-label={t('landing.nav.home')}>
          <Wordmark name={t('landing.brand')} />
        </Link>
        <div className="sd-navbar__actions">
          <LanguageSwitch
            value={settings.language}
            options={languages}
            label={t('landing.nav.language')}
            onChange={(language) => updateSettings({ language })}
          />
          <ThemeToggle
            theme={settings.theme}
            onToggle={() => updateSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' })}
            labelToDark={t('landing.nav.theme_to_dark')}
            labelToLight={t('landing.nav.theme_to_light')}
          />
          <Button variant="ghost" onClick={onLogIn} className="sd-navbar__login" aria-current={current === 'login' ? 'page' : undefined}>
            {t('landing.nav.log_in')}
          </Button>
          <Button variant="ink" onClick={onSignUp} aria-current={current === 'signup' ? 'page' : undefined}>
            {t('landing.nav.sign_up')}
          </Button>
        </div>
      </nav>
    </FadeIn>
  );
};
