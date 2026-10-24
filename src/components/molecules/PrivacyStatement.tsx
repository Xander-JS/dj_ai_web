import React from 'react';
import { FadeIn } from '../atoms/FadeIn';
import { ScrollRevealText } from '../atoms/ScrollRevealText';
import './PrivacyStatement.css';

export interface PrivacyStatementProps {
  title: string;
  body: string;
  titleId: string;
}

// Mensaje de privacidad: titular corto y una declaración que se enciende con el scroll
export const PrivacyStatement: React.FC<PrivacyStatementProps> = ({ title, body, titleId }) => (
  <div className="sd-privacy">
    <FadeIn as="h2" id={titleId} className="sd-privacy__title" y={40}>
      {title}
    </FadeIn>
    <ScrollRevealText text={body} className="sd-privacy__body" />
  </div>
);
