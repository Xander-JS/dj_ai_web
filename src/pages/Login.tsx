import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LoginForm } from '../components/auth/LoginForm';
import { ForgotPasswordForm } from '../components/auth/ForgotPasswordForm';
import { AuthTemplate, AuthUnavailableNotice } from '../components/templates/AuthTemplate';
import { useAuth } from '../context/AuthContext';

/** `from`: ruta protegida desde la que llegó el visitante, a la que vuelve tras iniciar sesión */
export type AuthLocationState = { from?: string } | null;

// Página de acceso: el formulario de login existente y, en la misma página, la recuperación de contraseña
export const Login: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isConfigured } = useAuth();
  const [view, setView] = useState<'login' | 'forgot'>('login');
  const destination = (location.state as AuthLocationState)?.from ?? '/dashboard';

  if (user) return <Navigate to={destination} replace />;

  // El destino viaja con el visitante entre acceso y registro
  const goToLogIn = () => setView('login');
  const goToSignUp = () => navigate('/signup', { state: location.state });

  return (
    <AuthTemplate
      title={t(view === 'login' ? 'auth.login_title' : 'auth.forgot_title')}
      intro={view === 'login' ? t('auth.page.login_intro') : undefined}
      field="sage"
      statement={t('auth.page.login_statement')}
      onLogIn={goToLogIn}
      onSignUp={goToSignUp}
      current="login"
    >
      {!isConfigured ? (
        <AuthUnavailableNotice />
      ) : view === 'login' ? (
        <LoginForm
          onSuccess={() => navigate(destination, { replace: true })}
          onSwitchToSignUp={goToSignUp}
          onForgotPassword={() => setView('forgot')}
        />
      ) : (
        <ForgotPasswordForm onBackToLogin={goToLogIn} />
      )}
    </AuthTemplate>
  );
};
