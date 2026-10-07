import React from 'react';
import { useTranslation } from 'react-i18next';

export const Settings: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <h2>{t('navigation.settings')}</h2>
      <p style={{ color: 'var(--text-secondary)' }}>Configuración general...</p>
    </div>
  );
};
