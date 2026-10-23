import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, Sparkles, SlidersHorizontal, Disc3, LogIn, UserPlus, type LucideIcon } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { AuthModal, type AuthView } from '../components/auth/AuthModal';
import { useAuth } from '../context/AuthContext';
import './Landing.css';

const FEATURES: { key: string; icon: LucideIcon }[] = [
  { key: 'analysis', icon: Activity },
  { key: 'sync', icon: SlidersHorizontal },
  { key: 'ai', icon: Sparkles },
  { key: 'export', icon: Disc3 },
];

// Página pública de presentación: solo ofrece iniciar sesión o registrarse
export const Landing: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { user, isConfigured } = useAuth();
  const [requestedView, setRequestedView] = useState<AuthView | null>(null);
  const [redirectDismissed, setRedirectDismissed] = useState(false);

  // Llegada desde una ruta protegida sin sesión: se abre el login y luego se vuelve allí
  const redirectedFrom = (location.state as { from?: string } | null)?.from;
  const authView = requestedView ?? (redirectedFrom && !redirectDismissed ? 'login' : null);

  if (user) return <Navigate to={redirectedFrom ?? '/dashboard'} replace />;
  // Sin Supabase no hay cuentas: la consola funciona en modo local
  if (!isConfigured) return <Navigate to="/dashboard" replace />;

  const closeAuth = () => {
    // El state se conserva para volver a la ruta original tras iniciar sesión
    setRequestedView(null);
    setRedirectDismissed(true);
  };

  return (
    <div className="landing">
      <header className="landing-header">
        <span className="header-logo-text">SYSTEM DJ</span>
        <div className="landing-header-actions">
          <Button variant="ghost" onClick={() => setRequestedView('login')}>
            <LogIn size={16} />
            {t('auth.sign_in')}
          </Button>
          <Button variant="outline" onClick={() => setRequestedView('signup')}>
            <UserPlus size={16} />
            {t('auth.sign_up')}
          </Button>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <Badge variant="secondary">{t('landing.badge')}</Badge>
          <h1 className="landing-title">{t('landing.title')}</h1>
          <p className="landing-subtitle">{t('landing.subtitle')}</p>
          <div className="landing-cta">
            <Button size="lg" onClick={() => setRequestedView('signup')}>
              <UserPlus size={18} />
              {t('auth.sign_up')}
            </Button>
            <Button size="lg" variant="outline" onClick={() => setRequestedView('login')}>
              <LogIn size={18} />
              {t('auth.sign_in')}
            </Button>
          </div>
          <p className="landing-note">{t('landing.privacy_note')}</p>
        </section>

        <section className="landing-features" aria-labelledby="landing-features-title">
          <h2 id="landing-features-title" className="landing-section-title">{t('landing.features_title')}</h2>
          <div className="landing-features-grid">
            {FEATURES.map(({ key, icon: Icon }) => (
              <Card key={key}>
                <CardBody className="landing-feature">
                  <Icon size={24} className="landing-feature-icon" />
                  <h3 className="landing-feature-title">{t(`landing.features.${key}_title`)}</h3>
                  <p className="landing-feature-desc">{t(`landing.features.${key}_desc`)}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      </main>

      {authView && (
        <AuthModal key={authView} open initialView={authView} onClose={closeAuth} />
      )}
    </div>
  );
};
