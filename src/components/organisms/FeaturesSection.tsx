import React from 'react';
import { useTranslation } from 'react-i18next';
import { FadeIn } from '../atoms/FadeIn';
import { FloatingImage } from '../atoms/FloatingImage';
import { FeaturePanel } from '../molecules/FeaturePanel';
import { KeyMatcher } from '../molecules/KeyMatcher';
import { STAGGER } from '../../design-system/motion';
import { CONTROLLER_IMAGE, SPEAKER_IMAGE, VINYL_IMAGE } from './landingAssets';
import './FeaturesSection.css';

// Capacidades principales: cuatro campos de color sobre un panel negro con esquinas
// superiores redondeadas; los objetos 3D asoman por las esquinas de cada campo.
export const FeaturesSection: React.FC = () => {
  const { t } = useTranslation();

  return (
    <section className="sd-features" aria-labelledby="sd-features-title">
      <FadeIn as="h2" id="sd-features-title" className="sd-features__title" y={40}>
        {t('landing.features.title')}
      </FadeIn>

      <div className="sd-features__grid">
        <FeaturePanel
          tone="accent"
          title={t('landing.features.analysis_title')}
          description={t('landing.features.analysis_desc')}
          decoration={<FloatingImage {...VINYL_IMAGE} drift={70} tilt={-12} />}
        />
        <FeaturePanel
          tone="sage"
          title={t('landing.features.sync_title')}
          description={t('landing.features.sync_desc')}
          decorationSize="wide"
          decoration={<FloatingImage {...CONTROLLER_IMAGE} drift={50} tilt={8} />}
          delay={STAGGER}
        />
        <FeaturePanel
          tone="acid"
          title={t('landing.features.ai_title')}
          description={t('landing.features.ai_desc')}
          delay={STAGGER * 2}
        >
          <KeyMatcher />
        </FeaturePanel>
        <FeaturePanel
          tone="paper"
          title={t('landing.features.export_title')}
          description={t('landing.features.export_desc')}
          decoration={<FloatingImage {...SPEAKER_IMAGE} drift={70} tilt={10} />}
          delay={STAGGER * 3}
        />
      </div>
    </section>
  );
};
