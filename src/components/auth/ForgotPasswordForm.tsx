import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { getAuthErrorMessage } from './authErrors';
import './AuthForm.css';

export interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({ onBackToLogin }) => {
  const { t } = useTranslation();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(getAuthErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <p className="auth-form-message">{t('auth.forgot_desc')}</p>
      <Input
        type="email"
        label={t('auth.email')}
        icon={<Mail size={16} />}
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {error && <p role="alert" className="auth-form-message auth-form-message-error">{error}</p>}
      {sent && <p role="status" className="auth-form-message auth-form-message-success">{t('auth.reset_sent', { email })}</p>}
      <Button type="submit" fullWidth disabled={submitting}>
        {submitting ? t('auth.submitting') : t('auth.send_reset')}
      </Button>
      <div className="auth-form-links">
        <Button type="button" variant="ghost" size="sm" onClick={onBackToLogin}>
          {t('auth.to_login')}
        </Button>
      </div>
    </form>
  );
};
