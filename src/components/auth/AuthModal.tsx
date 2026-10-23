import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { StateView } from '../ui/StateView';
import { useAuth } from '../../context/AuthContext';
import { LoginForm } from './LoginForm';
import { SignUpForm } from './SignUpForm';
import { ForgotPasswordForm } from './ForgotPasswordForm';

export type AuthView = 'login' | 'signup' | 'forgot';

export interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  initialView?: AuthView;
}

const TITLE_KEYS: Record<AuthView, string> = {
  login: 'auth.login_title',
  signup: 'auth.signup_title',
  forgot: 'auth.forgot_title',
};

export const AuthModal: React.FC<AuthModalProps> = ({ open, onClose, initialView = 'login' }) => {
  const { t } = useTranslation();
  const { isConfigured } = useAuth();
  const [view, setView] = useState<AuthView>(initialView);

  const handleClose = () => {
    setView(initialView);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={t(TITLE_KEYS[view])}>
      {!isConfigured ? (
        <StateView status="warning" title={t('auth.not_configured_title')} description={t('auth.not_configured_desc')} />
      ) : view === 'login' ? (
        <LoginForm onSuccess={handleClose} onSwitchToSignUp={() => setView('signup')} onForgotPassword={() => setView('forgot')} />
      ) : view === 'signup' ? (
        <SignUpForm onSuccess={handleClose} onSwitchToLogin={() => setView('login')} />
      ) : (
        <ForgotPasswordForm onBackToLogin={() => setView('login')} />
      )}
    </Modal>
  );
};
