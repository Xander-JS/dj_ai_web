import React from 'react';
import { useTranslation } from 'react-i18next';
import { PrivacyStatement } from '../molecules/PrivacyStatement';
import './PrivacySection.css';

// Sección de privacidad: solo el mensaje, centrado y con aire, como pausa entre la banda y las funciones
export const PrivacySection: React.FC = () => {
  const { t } = useTranslation();

  return (
    <section className="sd-privacy-section" aria-labelledby="sd-privacy-title">
      <PrivacyStatement
        titleId="sd-privacy-title"
        title={t('landing.privacy.title')}
        body={t('landing.privacy.body')}
      />
    </section>
  );
};
