import React from 'react';
import { useTranslation } from 'react-i18next';

export const Library: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div style={{ padding: 'var(--space-8)' }}>
      <h2>{t('navigation.library')}</h2>
      <p style={{ color: 'var(--text-secondary)' }}>Contenido de la biblioteca...</p>
    </div>
  );
};
