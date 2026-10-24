import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Camera, LogIn } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { AvatarDisc } from '../molecules/AvatarDisc';
import { EmptyState } from '../molecules/EmptyState';
import { Notice } from '../molecules/Notice';
import { Panel } from '../molecules/Panel';
import { ProfileForm } from '../profile/ProfileForm';
import { useAuth } from '../../context/AuthContext';
import { useAvatarUpload } from '../../hooks/useAvatarUpload';

// Ajustes → General: identidad de la cuenta y el mismo formulario de perfil que la pantalla Perfil
export const AccountSettings: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, loading, isConfigured } = useAuth();
  const avatar = useAvatarUpload();

  if (!isConfigured) {
    return (
      <Panel>
        <Notice tone="info">
          <strong>{t('auth.not_configured_title')}.</strong> {t('auth.not_configured_desc')}
        </Notice>
      </Panel>
    );
  }

  if (!user) {
    return (
      <Panel>
        <EmptyState
          status={loading ? 'loading' : 'empty'}
          title={loading ? t('states.loading') : t('settings.general_sign_in')}
          action={!loading && (
            <Button variant="accent" onClick={() => navigate('/login', { state: { from: '/settings' } })}>
              <Icon icon={LogIn} size="md" />
              {t('auth.sign_in')}
            </Button>
          )}
        />
      </Panel>
    );
  }

  const displayName = profile?.dj_alias || profile?.full_name || profile?.username || user.email || '';

  return (
    <>
      <Panel className="sd-account">
        <div className="sd-account__identity">
          <AvatarDisc
            size="md"
            src={profile?.avatar_url}
            name={displayName}
            spinning={avatar.uploading}
          />
          <div className="sd-account__copy">
            <p className="sd-account__name">{displayName || t('profile.no_name')}</p>
            <p className="sd-account__email">{user.email}</p>
          </div>
          <div className="sd-account__actions">
            <input {...avatar.inputProps} />
            <IconButton
              icon={<Icon icon={Camera} size="md" />}
              label={avatar.uploading ? t('profile.uploading') : t('profile.change_avatar')}
              variant="surface"
              disabled={avatar.uploading}
              aria-busy={avatar.uploading}
              onClick={avatar.openPicker}
            />
            <Button variant="ghost" onClick={() => navigate('/profile')}>
              {t('settings.view_profile')}
              <Icon icon={ArrowRight} size="md" />
            </Button>
          </div>
        </div>
        {avatar.feedback && <Notice tone={avatar.feedback.type}>{avatar.feedback.text}</Notice>}
      </Panel>

      <Panel title={t('profile.edit')} description={t('settings.account_desc')} headingLevel="h4">
        <ProfileForm />
      </Panel>
    </>
  );
};
