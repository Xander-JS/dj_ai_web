import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Camera, LogOut } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useAuth } from '../../context/AuthContext';
import { ALLOWED_AVATAR_TYPES, isValidAvatarFile } from '../../utils/avatarFile';
import '../auth/AuthForm.css';
import './ProfilePanel.css';

export const ProfilePanel: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, uploadAvatar, signOut } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  if (!user) return null;

  const displayName = profile?.dj_alias || profile?.full_name || profile?.username || user.email || '';

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      navigate('/', { replace: true });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isValidAvatarFile(file)) {
      setMessage({ type: 'error', text: t('profile.avatar_invalid') });
      return;
    }
    setMessage(null);
    setUploading(true);
    try {
      await uploadAvatar(file);
      setMessage({ type: 'success', text: t('profile.avatar_updated') });
    } catch {
      setMessage({ type: 'error', text: t('profile.avatar_error') });
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="profile-header-card profile-panel" aria-label={t('profile.title')}>
      <div className="profile-panel-avatar">
        <Avatar size="xl" src={profile?.avatar_url ?? undefined} alt={displayName} />
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_AVATAR_TYPES.join(',')}
          hidden
          onChange={handleFileChange}
        />
        <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <Camera size={14} />
          {uploading ? t('profile.uploading') : t('profile.change_avatar')}
        </Button>
      </div>

      <div className="profile-info">
        <h1 className="profile-name">{profile?.dj_alias || profile?.full_name || t('profile.no_name')}</h1>
        <span className="profile-username">{profile?.username ? `@${profile.username}` : t('profile.no_username')}</span>
        <dl className="profile-panel-fields">
          {profile?.full_name && (
            <>
              <dt>{t('profile.full_name')}</dt>
              <dd>{profile.full_name}</dd>
            </>
          )}
          <dt>{t('auth.email')}</dt>
          <dd>{user.email}</dd>
        </dl>
        <div>
          <Badge variant="success">{t('profile.audio_local_badge')}</Badge>
        </div>
        {message && (
          <p role={message.type === 'error' ? 'alert' : 'status'} className={`auth-form-message auth-form-message-${message.type}`}>
            {message.text}
          </p>
        )}
      </div>

      <div>
        <Button variant="ghost" onClick={() => { void handleSignOut(); }}>
          <LogOut size={16} />
          {t('auth.sign_out')}
        </Button>
      </div>
    </section>
  );
};
