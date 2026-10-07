import React from 'react';
import { useTranslation } from 'react-i18next';

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <h2>{t('navigation.home')}</h2>
      <p style={{ color: 'var(--text-secondary)' }}>Contenido del dashboard...</p>
    </div>
  );
};
