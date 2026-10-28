import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Badge, type BadgeProps } from '../ui/Badge';
import { extractAudioFromYouTube, YouTubeImportError, type ExtractedAudio } from '../../services/youtubeService';
import { URL_INPUT_MAX_LENGTH } from '../../config/constants';
import '../auth/AuthForm.css';

type ImportStatus = 'idle' | 'downloading' | 'importing' | 'success' | 'error';

const STATUS_BADGE: Record<Exclude<ImportStatus, 'idle'>, BadgeProps['variant']> = {
  downloading: 'warning',
  importing: 'warning',
  success: 'success',
  error: 'error',
};

export interface YouTubeImportResult {
  ok: boolean;
  error?: string;
}

export interface YouTubeImportModalProps {
  open: boolean;
  onClose: () => void;
  // Ingresa el audio en la biblioteca (decodificación + IndexedDB); el modal se cierra si ok
  onAudioReceived: (audio: ExtractedAudio) => Promise<YouTubeImportResult>;
}

export const YouTubeImportModal: React.FC<YouTubeImportModalProps> = ({ open, onClose, onAudioReceived }) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancelar la petición en curso si el componente se desmonta
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleClose = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUrl('');
    setStatus('idle');
    setMessage(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('downloading');
    setMessage(null);
    try {
      const audio = await extractAudioFromYouTube(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setStatus('importing');
      const result = await onAudioReceived(audio);
      if (controller.signal.aborted) return;
      if (result.ok) {
        handleClose();
        return;
      }
      setStatus('error');
      setMessage(result.error ?? t('library.youtube.errors.import_failed'));
    } catch (err) {
      if (controller.signal.aborted) return;
      const code = err instanceof YouTubeImportError ? err.code : 'server';
      const detail = err instanceof YouTubeImportError ? err.detail : undefined;
      setStatus('error');
      // Los 400 traen el motivo concreto del backend (p. ej. límite de 10 minutos)
      setMessage(code === 'rejected' && detail ? detail : t(`library.youtube.errors.${code}`));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const downloading = status === 'downloading' || status === 'importing';

  return (
    <Modal open={open} onClose={handleClose} title={t('library.youtube.title')}>
      <form className="auth-form" onSubmit={handleSubmit}>
        <p className="auth-form-message">{t('library.youtube.description')}</p>
        <Input
          type="url"
          maxLength={URL_INPUT_MAX_LENGTH}
          label={t('library.youtube.url_label')}
          placeholder="https://www.youtube.com/watch?v=..."
          icon={<Link2 size={16} />}
          required
          disabled={downloading}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {status !== 'idle' && (
          <div role="status" aria-live="polite">
            <Badge variant={STATUS_BADGE[status]}>{t(`library.youtube.status.${status}`)}</Badge>
            {message && (
              <p className={status === 'error' ? 'auth-form-message auth-form-message-error' : 'auth-form-message auth-form-message-success'}>
                {message}
              </p>
            )}
          </div>
        )}
        <Button type="submit" fullWidth disabled={downloading || !url.trim()}>
          {downloading ? t(`library.youtube.status.${status}`) : t('library.youtube.submit')}
        </Button>
      </form>
    </Modal>
  );
};
