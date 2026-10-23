import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { notificationCenter } from '../../services/notifications/notificationCenter';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { getAuthErrorMessage, MIN_PASSWORD_LENGTH } from './authErrors';
import './AuthForm.css';

// Se abre solo al volver desde el correo de recuperación (evento PASSWORD_RECOVERY)
export const UpdatePasswordModal: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { passwordRecovery, updatePassword, endPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (passwordRecovery === 'idle') return null;

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
      await updatePassword(password);
      notificationCenter.push({ type: 'success', messageKey: 'auth.password_updated' });
      endPasswordRecovery();
      navigate('/mixer', { replace: true });
    } catch (err) {
      setError(getAuthErrorMessage(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (passwordRecovery === 'expired') {
    return (
      <Modal open onClose={endPasswordRecovery} title={t('auth.link_expired_title')}>
        <p role="alert" className="auth-form-message auth-form-message-error">{t('auth.errors.link_expired')}</p>
        <ForgotPasswordForm onBackToLogin={endPasswordRecovery} />
      </Modal>
    );
  }

  return (
    <Modal open onClose={endPasswordRecovery} title={t('auth.update_password_title')}>
      <form className="auth-form" onSubmit={handleSubmit}>
        <p className="auth-form-message">{t('auth.update_password_desc')}</p>
        <Input
          type="password"
          label={t('auth.new_password')}
          icon={<Lock size={16} />}
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          type="password"
          label={t('auth.confirm_new_password')}
          icon={<Lock size={16} />}
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {error && <p role="alert" className="auth-form-message auth-form-message-error">{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? t('auth.submitting') : t('auth.save_password')}
        </Button>
      </form>
    </Modal>
  );
};
