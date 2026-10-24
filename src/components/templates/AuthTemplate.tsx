import React, { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentScroll } from '../../design-system/documentScroll';
import { FadeIn } from '../atoms/FadeIn';
import { Speaker3D } from '../atoms/Speaker3D';
import { LandingNavbar } from '../organisms/LandingNavbar';
import { SPEAKER_IMAGE } from '../organisms/landingAssets';
import { useSettingsStore } from '../../store/useSettingsStore';
// Base de página compartida con la Home: fondo, tipografía, selección y enlace de salto
import './LandingTemplate.css';
import './AuthTemplate.css';

export interface AuthTemplateProps {
  title: string;
  intro?: string;
  /** Campo plano que aloja el altavoz: salvia en el acceso, naranja en el registro */
  field: 'sage' | 'accent';
  statement: string;
  onLogIn: () => void;
  onSignUp: () => void;
  current: 'login' | 'signup';
  /** El formulario existente; el template solo le da el lenguaje visual del Design System v2 */
  children: ReactNode;
}

// Plantilla de Login y Registro: formulario sobre papel a la izquierda y el altavoz 3D
// en un campo de color a la derecha, con la misma barra superior que la Home.
export const AuthTemplate: React.FC<AuthTemplateProps> = ({ title, intro, field, statement, onLogIn, onSignUp, current, children }) => {
  const { t } = useTranslation();
  const { settings } = useSettingsStore();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousTitle = useRef(title);
  useDocumentScroll();

  // Al cambiar de vista (acceso ↔ recuperar contraseña) el botón pulsado desaparece:
  // el foco pasa al nuevo título en lugar de perderse en el documento
  useEffect(() => {
    if (previousTitle.current === title) return;
    previousTitle.current = title;
    if (document.activeElement === document.body) titleRef.current?.focus();
  }, [title]);

  return (
    <div className="sd-landing sd-auth">
      <a href="#sd-auth-main" className="sd-landing__skip">{t('landing.skip_to_content')}</a>
      <LandingNavbar onLogIn={onLogIn} onSignUp={onSignUp} current={current} />
      <main id="sd-auth-main" tabIndex={-1} className="sd-landing__main sd-auth__main">
        <section className="sd-auth__panel" aria-labelledby="sd-auth-title">
          <div className="sd-auth__content">
            <FadeIn y={32} amount={0}>
              <h1 ref={titleRef} id="sd-auth-title" tabIndex={-1} className="sd-auth__title">{title}</h1>
            </FadeIn>
            {intro && (
              <FadeIn as="p" className="sd-auth__intro" delay={0.08} y={20} amount={0}>
                {intro}
              </FadeIn>
            )}
            <FadeIn className="sd-auth__form" delay={0.16} y={20} amount={0}>
              {children}
            </FadeIn>
          </div>
        </section>

        <div className={`sd-auth__stage sd-auth__stage--${field} sd-on-field`}>
          <Speaker3D className="sd-auth__speaker" theme={settings.theme} fallback={SPEAKER_IMAGE} />
          <p className="sd-auth__statement">{statement}</p>
        </div>
      </main>
    </div>
  );
};

// Sin Supabase no hay cuentas: el aviso ocupa el lugar del formulario, como hacía el modal
export const AuthUnavailableNotice: React.FC = () => {
  const { t } = useTranslation();
  return (
    <p role="status" className="auth-form-message auth-form-message-error">
      <strong>{t('auth.not_configured_title')}.</strong> {t('auth.not_configured_desc')}
    </p>
  );
};
