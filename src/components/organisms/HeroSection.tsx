import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../atoms/Button';
import { FadeIn } from '../atoms/FadeIn';
import { Magnet } from '../atoms/Magnet';
import { DURATION, EASE_OUT } from '../../design-system/motion';
import { HERO_IMAGE } from './landingAssets';
import './HeroSection.css';

export interface HeroSectionProps {
  onOpenConsole: () => void;
}

// Primera pantalla: el nombre a todo lo ancho, los auriculares recortados sobre la
// costura entre papel y salvia, y la acción principal en la banda inferior.
export const HeroSection: React.FC<HeroSectionProps> = ({ onOpenConsole }) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  return (
    <section className="sd-hero" aria-labelledby="sd-hero-title">
      <div className="sd-hero__title-wrap">
        <FadeIn as="h1" id="sd-hero-title" className="sd-hero__title" delay={0.15} y={40} amount={0}>
          {t('landing.hero.title')}
        </FadeIn>
      </div>

      <div className="sd-hero__band sd-on-field">
        <Magnet className="sd-hero__visual" padding={160} strength={7}>
          {/* Momento firma: el objeto se descubre desde abajo como una persiana */}
          <motion.div
            className="sd-hero__shutter"
            initial={reduceMotion
              ? { opacity: 0 }
              : { clipPath: 'inset(100% 0% 0% 0%)', scale: 1.12 }}
            animate={reduceMotion
              ? { opacity: 1 }
              : { clipPath: 'inset(0% 0% 0% 0%)', scale: 1 }}
            transition={{ duration: reduceMotion ? DURATION.base : DURATION.focal, delay: 0.5, ease: EASE_OUT }}
          >
            <picture>
              <source srcSet={HERO_IMAGE.webp} type="image/webp" />
              <img
                src={HERO_IMAGE.src}
                alt={t('landing.hero.image_alt')}
                width={HERO_IMAGE.width}
                height={HERO_IMAGE.height}
                fetchPriority="high"
                decoding="async"
                draggable={false}
              />
            </picture>
          </motion.div>
        </Magnet>

        <div className="sd-hero__copy">
          <FadeIn as="p" className="sd-hero__subtitle" delay={0.3} y={20} amount={0}>
            {t('landing.hero.subtitle')}
          </FadeIn>
          <FadeIn as="p" className="sd-hero__description" delay={0.38} y={20} amount={0}>
            {t('landing.hero.description')}
          </FadeIn>
        </div>

        <FadeIn className="sd-hero__cta" delay={0.46} y={20} amount={0}>
          <Button variant="accent" size="lg" onClick={onOpenConsole}>
            {t('landing.hero.cta')}
            <ArrowRight size={20} aria-hidden="true" />
          </Button>
        </FadeIn>
      </div>
    </section>
  );
};
