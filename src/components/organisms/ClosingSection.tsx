import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../atoms/Button';
import { FadeIn } from '../atoms/FadeIn';
import { FloatingImage } from '../atoms/FloatingImage';
import { Wordmark } from '../atoms/Wordmark';
import { CLOSING_IMAGE } from './landingAssets';
import './ClosingSection.css';

export interface ClosingSectionProps {
  onOpenConsole: () => void;
  onSignUp: () => void;
}

// Cierre de la página: un campo naranja que repite la acción principal y firma con la marca
export const ClosingSection: React.FC<ClosingSectionProps> = ({ onOpenConsole, onSignUp }) => {
  const { t } = useTranslation();

  return (
    <div className="sd-closing sd-on-field">
      <section className="sd-closing__call" aria-labelledby="sd-closing-title">
        <div className="sd-closing__content">
          <FadeIn as="h2" id="sd-closing-title" className="sd-closing__title" y={40}>
            {t('landing.closing.title')}
          </FadeIn>
          <FadeIn className="sd-closing__actions" delay={0.12}>
            <Button variant="ink" size="lg" onClick={onOpenConsole}>
              {t('landing.hero.cta')}
              <ArrowRight size={20} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="lg" onClick={onSignUp}>
              {t('landing.closing.secondary')}
            </Button>
          </FadeIn>
        </div>
        <FloatingImage {...CLOSING_IMAGE} className="sd-closing__visual" drift={90} tilt={9} />
      </section>

      <footer className="sd-closing__footer">
        <Wordmark name={t('landing.brand')} />
        <small>{t('landing.closing.copyright', { year: new Date().getFullYear() })}</small>
      </footer>
    </div>
  );
};
