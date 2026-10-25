import React, { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, HardDrive, LogIn, LogOut } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { IconButton } from '../atoms/IconButton';
import { Tag } from '../atoms/Tag';
import { AvatarDisc } from '../molecules/AvatarDisc';
import { Notice } from '../molecules/Notice';
import { useAuth } from '../../context/AuthContext';
import { useAvatarUpload } from '../../hooks/useAvatarUpload';
import './ProfilePanel.css';

/**
 * Cabecera del Perfil: un cartel en campo naranja con el avatar como galleta de un vinilo.
 * Sin cuenta (modo local o sin sesión) muestra el mismo cartel con el siguiente paso.
 */
export const ProfilePanel: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, loading, isConfigured, signOut } = useAuth();
  const avatar = useAvatarUpload();
  const titleId = useId();

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      navigate('/', { replace: true });
    }
  };

  if (!user) {
    return (
      <section className="sd-profile-band sd-field-accent" aria-labelledby={titleId}>
        <AvatarDisc name="" fallback="DJ" />
        <div className="sd-profile-band__copy">
          <h2 id={titleId} className="sd-profile-band__name">
            {loading ? t('states.loading') : t('profile.no_account_title')}
          </h2>
          {!loading && (
            <p className="sd-profile-band__lead">
              {isConfigured ? t('profile.sign_in_required_desc') : t('auth.not_configured_desc')}
            </p>
          )}
          {!loading && isConfigured && (
            <div className="sd-profile-band__actions">
              <Button variant="ink" size="lg" onClick={() => navigate('/login', { state: { from: '/profile' } })}>
                <Icon icon={LogIn} size="md" />
                {t('auth.sign_in')}
              </Button>
            </div>
          )}
        </div>
      </section>
    );
  }

  const stageName = profile?.dj_alias || profile?.full_name || '';
  const displayName = stageName || profile?.username || user.email || '';
  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' })
    : null;

  return (
    <section className="sd-profile-band sd-field-accent" aria-labelledby={titleId}>
      <input {...avatar.inputProps} />
      <AvatarDisc
        src={profile?.avatar_url}
        name={displayName}
        spinning={avatar.uploading}
        action={(
          <IconButton
            icon={<Icon icon={Camera} size="md" />}
            label={avatar.uploading ? t('profile.uploading') : t('profile.change_avatar')}
            variant="ink"
            disabled={avatar.uploading}
            aria-busy={avatar.uploading}
            onClick={avatar.openPicker}
          />
        )}
      />

      <div className="sd-profile-band__copy">
        <h2 id={titleId} className={stageName ? 'sd-profile-band__name' : 'sd-profile-band__name is-placeholder'}>
          {stageName || t('profile.no_name')}
        </h2>
        <p className="sd-profile-band__handle">
          {profile?.username ? `@${profile.username}` : t('profile.no_username')}
          {profile?.dj_alias && profile.full_name && (
            <span className="sd-profile-band__real-name">{profile.full_name}</span>
          )}
        </p>

        <dl className="sd-profile-band__facts">
          <div className="sd-profile-band__fact">
            <dt>{t('auth.email')}</dt>
            <dd>{user.email}</dd>
          </div>
          {memberSince && (
            <div className="sd-profile-band__fact">
              <dt>{t('profile.member_since')}</dt>
              <dd>{memberSince}</dd>
            </div>
          )}
        </dl>

        <div className="sd-profile-band__actions">
          <Tag tone="paper">
            <Icon icon={HardDrive} size="xs" />
            {t('profile.audio_local_badge')}
          </Tag>
          <Button variant="ghost" onClick={() => { void handleSignOut(); }}>
            <Icon icon={LogOut} size="md" />
            {t('auth.sign_out')}
          </Button>
        </div>

        {avatar.feedback && (
          <Notice
            tone={avatar.feedback.type}
            className="sd-profile-band__notice"
            onDismiss={avatar.clearFeedback}
            dismissLabel={t('common.close')}
          >
            {avatar.feedback.text}
          </Notice>
        )}
      </div>
    </section>
  );
};
