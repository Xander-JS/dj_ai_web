import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { ALLOWED_AVATAR_TYPES, isValidAvatarFile } from '../utils/avatarFile';

export type AvatarUploadFeedback = { type: 'error' | 'success'; text: string } | null;

/**
 * Selector de archivo, validación y subida de la foto de perfil.
 * Compartido por Perfil y Ajustes → General para no duplicar la lógica.
 */
export function useAvatarUpload() {
  const { t } = useTranslation();
  const { uploadAvatar } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<AvatarUploadFeedback>(null);

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isValidAvatarFile(file)) {
      setFeedback({ type: 'error', text: t('profile.avatar_invalid') });
      return;
    }
    setFeedback(null);
    setUploading(true);
    try {
      await uploadAvatar(file);
      setFeedback({ type: 'success', text: t('profile.avatar_updated') });
    } catch {
      setFeedback({ type: 'error', text: t('profile.avatar_error') });
    } finally {
      setUploading(false);
    }
  };

  return {
    uploading,
    feedback,
    clearFeedback: () => setFeedback(null),
    openPicker: () => inputRef.current?.click(),
    inputProps: {
      ref: inputRef,
      type: 'file' as const,
      accept: ALLOWED_AVATAR_TYPES.join(','),
      hidden: true,
      onChange: (e: ChangeEvent<HTMLInputElement>) => { void handleChange(e); },
    },
  };
}
