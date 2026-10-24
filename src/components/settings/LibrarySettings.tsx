import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { Switch } from '../atoms/Switch';
import { Notice } from '../molecules/Notice';
import { Panel } from '../molecules/Panel';
import { SettingRow } from '../molecules/SettingRow';
import { Modal } from '../ui/Modal';
import { StorageMeter } from './SettingsPreviews';
import { toMb, type StorageUsage } from './storageUsage';
import { useSettingsStore } from '../../store/useSettingsStore';
import { djStore } from '../../store/useDJStore';
import { seedStore } from '../../store/useSeedStore';
import { indexedDBStorage } from '../../services/storage/IndexedDBStorage';
import { playlistService } from '../../services/playlists/playlistService';

type Feedback = { type: 'error' | 'success'; text: string } | null;

export interface LibrarySettingsProps {
  storage: StorageUsage | null;
  /** Vuelve a leer el uso tras un borrado */
  onStorageChange: () => void;
}

export const LibrarySettings: React.FC<LibrarySettingsProps> = ({ storage, onStorageChange }) => {
  const { t } = useTranslation();
  const { settings, updateSettings, resetSettings } = useSettingsStore();
  const [confirm, setConfirm] = useState<'mixer' | 'factory' | null>(null);
  const [resetting, setResetting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const dangerTitleId = useId();

  const quotaKnown = storage?.usage != null && Boolean(storage.quota);
  const ratio = quotaKnown && storage ? storage.usage! / storage.quota! : null;

  /** Restablece decks (transporte, cues, sync) y mixer sin descargar pistas ni borrar datos. */
  const handleResetMixer = () => {
    djStore.resetMixerControls();
    setFeedback({ type: 'success', text: t('settings.reset_mixer_done') });
    setConfirm(null);
  };

  /** Borra pistas, sesiones, playlists y preferencias. */
  const handleFactoryReset = async () => {
    setResetting(true);
    try {
      djStore.unloadDeck('A');
      djStore.unloadDeck('B');
      seedStore.clearSeeds();
      await indexedDBStorage.clearAll();
      resetSettings();
      playlistService.notifyExternalChange();
      setFeedback({ type: 'success', text: t('settings.factory_reset_done') });
    } catch {
      setFeedback({ type: 'error', text: t('states.error_desc') });
    } finally {
      setResetting(false);
      setConfirm(null);
      onStorageChange();
    }
  };

  const closeConfirm = () => { if (!resetting) setConfirm(null); };

  return (
    <>
      <Panel
        headingLevel="h4"
        title={t('settings.storage_used')}
        description={t('settings.storage_desc')}
        aside={storage == null ? <span className="sd-settings__muted">{t('states.loading')}</span> : null}
      >
        <div className="sd-storage">
          <StorageMeter ratio={ratio} label={t('settings.storage_used')} />
          <dl className="sd-storage__figures">
            <div className="sd-storage__figure">
              <dt>{t('settings.storage_browser')}</dt>
              <dd className="sd-num">
                {storage == null
                  ? '—'
                  : quotaKnown
                    ? t('settings.storage_used_value', { used: toMb(storage.usage!), quota: toMb(storage.quota!) })
                    : t('settings.storage_unavailable')}
              </dd>
            </div>
            <div className="sd-storage__figure">
              <dt>{t('settings.storage_tracks')}</dt>
              <dd className="sd-num">
                {storage == null ? '—' : t('settings.storage_tracks_value', { used: toMb(storage.trackBytes), count: storage.trackCount })}
              </dd>
            </div>
            {ratio != null && (
              <div className="sd-storage__figure">
                <dt>{t('settings.storage_share')}</dt>
                <dd className="sd-num">{t('settings.storage_percent', { percent: (ratio * 100).toFixed(1) })}</dd>
              </div>
            )}
          </dl>
        </div>
      </Panel>

      <Panel>
        <SettingRow
          title={t('settings.auto_analyze')}
          description={t('settings.auto_analyze_desc')}
          control={({ titleId, descriptionId }) => (
            <Switch
              checked={settings.autoAnalyzeOnImport}
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              onChange={(e) => updateSettings({ autoAnalyzeOnImport: e.target.checked })}
            />
          )}
        />
      </Panel>

      <Panel title={t('settings.maintenance_title')} headingLevel="h4">
        <SettingRow
          title={t('settings.reset_mixer')}
          description={t('settings.reset_mixer_desc')}
          control={(
            <Button variant="ink" onClick={() => { setFeedback(null); setConfirm('mixer'); }}>
              <Icon icon={SlidersHorizontal} size="sm" />
              {t('settings.reset_mixer_action')}
            </Button>
          )}
        />
        {feedback && <Notice tone={feedback.type}>{feedback.text}</Notice>}
      </Panel>

      {/* Borrado de datos: al final y en su propio bloque, con la consecuencia en palabras */}
      <section className="sd-danger-zone sd-field-acid" aria-labelledby={dangerTitleId}>
        <div className="sd-danger-zone__copy">
          <h4 id={dangerTitleId} className="sd-danger-zone__title">{t('settings.factory_reset')}</h4>
          <p className="sd-danger-zone__description">{t('settings.factory_reset_desc')}</p>
        </div>
        <Button variant="ink" onClick={() => { setFeedback(null); setConfirm('factory'); }}>
          <Icon icon={Trash2} size="sm" />
          {t('settings.factory_reset_action')}
        </Button>
      </section>

      <Modal open={confirm === 'mixer'} onClose={closeConfirm} title={t('settings.reset_mixer_confirm_title')}>
        <p className="sd-settings__dialog-text">{t('settings.reset_mixer_confirm_desc')}</p>
        <div className="sd-settings__dialog-actions">
          <Button variant="ghost" onClick={closeConfirm}>
            {t('common.cancel')}
          </Button>
          <Button variant="ink" onClick={handleResetMixer}>
            <Icon icon={SlidersHorizontal} size="sm" />
            {t('settings.reset_mixer_confirm')}
          </Button>
        </div>
      </Modal>

      <Modal open={confirm === 'factory'} onClose={closeConfirm} title={t('settings.factory_reset_confirm_title')}>
        <p className="sd-settings__dialog-text">{t('settings.factory_reset_confirm_desc')}</p>
        <div className="sd-settings__dialog-actions">
          <Button variant="ghost" disabled={resetting} onClick={closeConfirm}>
            {t('common.cancel')}
          </Button>
          <Button variant="ink" disabled={resetting} aria-busy={resetting} onClick={() => { void handleFactoryReset(); }}>
            <Icon icon={RotateCcw} size="sm" />
            {t('settings.factory_reset_confirm')}
          </Button>
        </div>
      </Modal>
    </>
  );
};
