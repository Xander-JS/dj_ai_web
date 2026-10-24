import React from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SignUpForm } from '../components/auth/SignUpForm';
import { AuthTemplate, AuthUnavailableNotice } from '../components/templates/AuthTemplate';
import { useAuth } from '../context/AuthContext';
import type { AuthLocationState } from './Login';

// Página de registro: el formulario de alta existente sobre la misma plantilla que el acceso
export const SignUp: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isConfigured } = useAuth();
  const destination = (location.state as AuthLocationState)?.from ?? '/dashboard';

  if (user) return <Navigate to={destination} replace />;

  const goToLogIn = () => navigate('/login', { state: location.state });

  return (
    <AuthTemplate
      title={t('auth.signup_title')}
      intro={t('auth.page.signup_intro')}
      field="accent"
      statement={t('auth.page.signup_statement')}
      onLogIn={goToLogIn}
      onSignUp={() => undefined}
      current="signup"
    >
      {!isConfigured ? (
        <AuthUnavailableNotice />
      ) : (
        <SignUpForm onSuccess={() => navigate(destination, { replace: true })} onSwitchToLogin={goToLogIn} />
      )}
    </AuthTemplate>
  );
};
