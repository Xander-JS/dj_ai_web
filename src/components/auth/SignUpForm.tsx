import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Lock } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { getAuthErrorMessage, MIN_PASSWORD_LENGTH } from './authErrors';
import './AuthForm.css';

export interface SignUpFormProps {
  onSuccess: () => void;
  onSwitchToLogin: () => void;
}

export const SignUpForm: React.FC<SignUpFormProps> = ({ onSuccess, onSwitchToLogin }) => {
  const { t } = useTranslation();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.errors.password_short', { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.errors.password_mismatch'));
      return;
    }
    setSubmitting(true);
    try {
      // El trigger de Supabase crea la fila en public.profiles al insertar el usuario
      const { needsConfirmation } = await signUp(email.trim(), password);
      if (needsConfirmation) setConfirmationSent(true);
      else onSuccess();
    } catch (err) {
      setError(getAuthErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmationSent) {
    return (
      <div className="auth-form">
        <p role="status" className="auth-form-message auth-form-message-success">{t('auth.signup_confirm_sent', { email })}</p>
        <Button type="button" variant="outline" fullWidth onClick={onSwitchToLogin}>
          {t('auth.to_login')}
        </Button>
      </div>
    );
  }

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
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Input
        type="password"
        label={t('auth.confirm_password')}
        icon={<Lock size={16} />}
        autoComplete="new-password"
        required
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {error && <p role="alert" className="auth-form-message auth-form-message-error">{error}</p>}
      <Button type="submit" fullWidth disabled={submitting}>
        {submitting ? t('auth.submitting') : t('auth.sign_up')}
      </Button>
      <div className="auth-form-links">
        <Button type="button" variant="ghost" size="sm" onClick={onSwitchToLogin}>
          {t('auth.to_login')}
        </Button>
      </div>
    </form>
  );
};
