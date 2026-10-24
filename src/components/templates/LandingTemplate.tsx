import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentScroll } from '../../design-system/documentScroll';
import { LandingNavbar } from '../organisms/LandingNavbar';
import { HeroSection } from '../organisms/HeroSection';
import { TempoBand } from '../organisms/TempoBand';
import { PrivacySection } from '../organisms/PrivacySection';
import { FeaturesSection } from '../organisms/FeaturesSection';
import { ClosingSection } from '../organisms/ClosingSection';
import './LandingTemplate.css';

export interface LandingTemplateProps {
  onLogIn: () => void;
  onSignUp: () => void;
  onOpenConsole: () => void;
}

// Plantilla de la Home: orden de secciones y modo de scroll de documento (ver documentScroll.ts).
export const LandingTemplate: React.FC<LandingTemplateProps> = ({ onLogIn, onSignUp, onOpenConsole }) => {
  const { t } = useTranslation();
  useDocumentScroll();

  return (
    <div className="sd-landing">
      <a href="#sd-landing-main" className="sd-landing__skip">{t('landing.skip_to_content')}</a>
      <LandingNavbar onLogIn={onLogIn} onSignUp={onSignUp} />
      <main id="sd-landing-main" tabIndex={-1} className="sd-landing__main">
        <HeroSection onOpenConsole={onOpenConsole} />
        <TempoBand />
        <PrivacySection />
        <FeaturesSection />
      </main>
      <ClosingSection onOpenConsole={onOpenConsole} onSignUp={onSignUp} />
    </div>
  );
};
