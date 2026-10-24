import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AtSign } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { TextField } from '../atoms/TextField';
import { Notice } from '../molecules/Notice';
import { useAuth } from '../../context/AuthContext';
import './ProfileForm.css';

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,30}$/;

type Feedback = { type: 'error' | 'success'; text: string } | null;

/**
 * Edición de usuario, alias de DJ y nombre real. Compartido por Perfil y Ajustes → General.
 * Borradores: null = sin editar, se muestra el valor vigente del perfil (también si cambia desde otra vista).
 */
export const ProfileForm: React.FC = () => {
  const { t } = useTranslation();
  const { profile, updateProfile } = useAuth();
  const baseId = useId();
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [fullNameDraft, setFullNameDraft] = useState<string | null>(null);
  const [djAliasDraft, setDjAliasDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const username = usernameDraft ?? profile?.username ?? '';
  const fullName = fullNameDraft ?? profile?.full_name ?? '';
  const djAlias = djAliasDraft ?? profile?.dj_alias ?? '';
  const trimmedUsername = username.trim();
  const trimmedFullName = fullName.trim();
  const trimmedDjAlias = djAlias.trim();
  const usernameInvalid = trimmedUsername !== '' && !USERNAME_PATTERN.test(trimmedUsername);
  const isDirty = trimmedUsername !== (profile?.username ?? '')
    || trimmedFullName !== (profile?.full_name ?? '')
    || trimmedDjAlias !== (profile?.dj_alias ?? '');

  const discard = () => {
    setUsernameDraft(null);
    setFullNameDraft(null);
    setDjAliasDraft(null);
    setFeedback(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usernameInvalid || !isDirty) return;
    setSaving(true);
    setFeedback(null);
    try {
      await updateProfile({
        username: trimmedUsername || null,
        full_name: trimmedFullName || null,
        dj_alias: trimmedDjAlias || null,
      });
      setUsernameDraft(null);
      setFullNameDraft(null);
      setDjAliasDraft(null);
      setFeedback({ type: 'success', text: t('settings.profile_saved') });
    } catch (err) {
      const taken = (err as { code?: string } | null)?.code === '23505';
      setFeedback({ type: 'error', text: t(taken ? 'settings.profile_username_taken' : 'settings.profile_error') });
    } finally {
      setSaving(false);
    }
  };

  const ids = {
    alias: `${baseId}-alias`,
    username: `${baseId}-username`,
    usernameHint: `${baseId}-username-hint`,
    fullName: `${baseId}-full-name`,
  };

  return (
    <form className="sd-profile-form" onSubmit={(e) => { void handleSave(e); }} noValidate>
      <div className="sd-profile-form__grid">
        <div className="sd-profile-form__field sd-profile-form__field--wide">
          <label htmlFor={ids.alias} className="sd-profile-form__label">{t('settings.dj_alias')}</label>
          <TextField
            id={ids.alias}
            placeholder={t('settings.dj_alias_placeholder')}
            value={djAlias}
            maxLength={60}
            onChange={(e) => { setDjAliasDraft(e.target.value); setFeedback(null); }}
          />
        </div>

        <div className="sd-profile-form__field">
          <label htmlFor={ids.username} className="sd-profile-form__label">{t('settings.username')}</label>
          <TextField
            id={ids.username}
            icon={<Icon icon={AtSign} size="sm" />}
            placeholder={t('settings.username_placeholder')}
            value={username}
            maxLength={30}
            autoComplete="username"
            spellCheck={false}
            aria-invalid={usernameInvalid}
            aria-describedby={ids.usernameHint}
            onChange={(e) => { setUsernameDraft(e.target.value); setFeedback(null); }}
          />
          <p
            id={ids.usernameHint}
            className={usernameInvalid ? 'sd-profile-form__hint is-invalid' : 'sd-profile-form__hint'}
            role={usernameInvalid ? 'alert' : undefined}
          >
            {t('settings.username_invalid')}
          </p>
        </div>

        <div className="sd-profile-form__field">
          <label htmlFor={ids.fullName} className="sd-profile-form__label">{t('settings.full_name')}</label>
          <TextField
            id={ids.fullName}
            placeholder={t('settings.full_name_placeholder')}
            value={fullName}
            maxLength={60}
            autoComplete="name"
            onChange={(e) => { setFullNameDraft(e.target.value); setFeedback(null); }}
          />
        </div>

        <div className="sd-profile-form__footer">
          <p className="sd-profile-form__status" aria-live="polite">
            {isDirty && !saving ? t('profile.unsaved_changes') : ''}
          </p>
          <div className="sd-profile-form__actions">
            {isDirty && (
              <Button variant="ghost" disabled={saving} onClick={discard}>
                {t('profile.discard_changes')}
              </Button>
            )}
            <Button type="submit" variant="accent" disabled={saving || usernameInvalid || !isDirty} aria-busy={saving}>
              {saving ? t('settings.profile_saving') : t('settings.profile_save')}
            </Button>
          </div>
        </div>

        {feedback && (
          <Notice tone={feedback.type} className="sd-profile-form__notice">
            {feedback.text}
          </Notice>
        )}
      </div>
    </form>
  );
};
