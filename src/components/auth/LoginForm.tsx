import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Lock } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { getAuthErrorMessage } from './authErrors';
import './AuthForm.css';

export interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToSignUp: () => void;
  onForgotPassword: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSuccess, onSwitchToSignUp, onForgotPassword }) => {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
      onSuccess();
    } catch (err) {
      setError(getAuthErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <Input
        type="email"
        label={t('auth.email')}
        icon={<Mail size={16} />}
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Input
        type="password"
        label={t('auth.password')}
        icon={<Lock size={16} />}
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p role="alert" className="auth-form-message auth-form-message-error">{error}</p>}
      <Button type="submit" fullWidth disabled={submitting}>
        {submitting ? t('auth.submitting') : t('auth.sign_in')}
      </Button>
      <div className="auth-form-links">
        <Button type="button" variant="ghost" size="sm" onClick={onForgotPassword}>
          {t('auth.forgot_link')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onSwitchToSignUp}>
          {t('auth.to_signup')}
        </Button>
      </div>
    </form>
  );
};
