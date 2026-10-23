import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings as SettingsIcon, Palette, Globe, Volume2, PlayCircle, Keyboard, Library, Camera, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { Switch } from '../components/ui/Switch';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Slider } from '../components/ui/Slider';
import { useAuth } from '../context/AuthContext';
import { ALLOWED_AVATAR_TYPES, isValidAvatarFile } from '../utils/avatarFile';
import {
  ACCENT_COLORS,
  AUTO_TRANSITION_BEATS,
  BUFFER_SIZES,
  CROSSFADER_CURVES,
  PITCH_RANGES,
  SYNC_RANGE_MAX,
  SYNC_RANGE_MIN,
  SYNC_RANGE_STEP,
  settingsStore,
  useSettingsStore,
  type AppLanguage,
} from '../store/useSettingsStore';
import { djStore } from '../store/useDJStore';
import { seedStore } from '../store/useSeedStore';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { playlistService } from '../services/playlists/playlistService';
import {
  DEFAULT_SHORTCUT_BINDINGS,
  KEYBOARD_SHORTCUTS,
  MIX_PARAMS,
  formatKeyCode,
  validateBinding,
  type MixShortcutId,
} from '../services/keyboard/keyboardShortcuts';
import { clsx } from 'clsx';
import '../components/ui/Table.css';
import '../components/auth/AuthForm.css';
import './Settings.css';

type Tab = 'general' | 'appearance' | 'language' | 'audio' | 'playback' | 'shortcuts' | 'library';

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,30}$/;
const BYTES_PER_MB = 1024 * 1024;

type Feedback = { type: 'error' | 'success'; text: string } | null;

/** Selector de opciones excluyentes con los botones existentes (primary = activo). */
function OptionSelector<T extends string | number>({ options, value, onChange, label }: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
}) {
  return (
    <div className="settings-button-group" role="radiogroup">
      {options.map((option) => (
        <Button
          key={option}
          size="sm"
          role="radio"
          aria-checked={option === value}
          variant={option === value ? 'primary' : 'outline'}
          onClick={() => onChange(option)}
        >
          {label(option)}
        </Button>
      ))}
    </div>
  );
}

const OptionCard: React.FC<{ title: string; desc?: string; children: React.ReactNode }> = ({ title, desc, children }) => (
  <div className="settings-option-card">
    <div>
      <div className="settings-option-title">{title}</div>
      {desc && <div className="settings-option-desc">{desc}</div>}
    </div>
    {children}
  </div>
);

const FeedbackMessage: React.FC<{ feedback: Feedback }> = ({ feedback }) => feedback && (
  <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`auth-form-message auth-form-message-${feedback.type}`}>
    {feedback.text}
  </p>
);

const GeneralSettings: React.FC = () => {
  const { t } = useTranslation();
  const { user, profile, updateProfile, uploadAvatar } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Borradores: null = sin editar, se muestra el valor vigente del perfil (también si cambia desde Perfil)
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const [fullNameDraft, setFullNameDraft] = useState<string | null>(null);
  const [djAliasDraft, setDjAliasDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  if (!user) {
    return <div className="settings-placeholder">{t('settings.general_sign_in')}</div>;
  }

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

  return (
    <form className="settings-group" onSubmit={(e) => { void handleSave(e); }}>
      <h3 className="settings-group-title">{t('settings.general_title')}</h3>
      <div className="settings-option-card">
        <Avatar size="xl" src={profile?.avatar_url ?? undefined} alt={trimmedDjAlias || trimmedFullName || user.email || ''} />
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_AVATAR_TYPES.join(',')}
          hidden
          onChange={(e) => { void handleFileChange(e); }}
        />
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
          <Camera size={14} />
          {uploading ? t('profile.uploading') : t('profile.change_avatar')}
        </Button>
      </div>
      <Input
        label={t('settings.username')}
        placeholder={t('settings.username_placeholder')}
        value={username}
        maxLength={30}
        autoComplete="username"
        aria-invalid={usernameInvalid}
        onChange={(e) => setUsernameDraft(e.target.value)}
      />
      {usernameInvalid && <p role="alert" className="auth-form-message auth-form-message-error">{t('settings.username_invalid')}</p>}
      <Input
        label={t('settings.dj_alias')}
        placeholder={t('settings.dj_alias_placeholder')}
        value={djAlias}
        maxLength={60}
        onChange={(e) => setDjAliasDraft(e.target.value)}
      />
      <Input
        label={t('settings.full_name')}
        placeholder={t('settings.full_name_placeholder')}
        value={fullName}
        maxLength={60}
        autoComplete="name"
        onChange={(e) => setFullNameDraft(e.target.value)}
      />
      <div className="settings-button-group">
        <Button type="submit" disabled={saving || usernameInvalid || !isDirty}>
          {saving ? t('settings.profile_saving') : t('settings.profile_save')}
        </Button>
      </div>
      <FeedbackMessage feedback={feedback} />
    </form>
  );
};

/**
 * Tabla de teclas selectoras de mezcla. Al pulsar una celda se captura la siguiente tecla
 * (Escape cancela); las flechas son fijas y solo se reasigna la tecla selectora.
 */
const ShortcutBindingsEditor: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const [listening, setListening] = useState<MixShortcutId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const bindings = settings.shortcutBindings;

  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Captura antes que los atajos globales para que la tecla no dispare ninguna acción
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') {
        setListening(null);
        return;
      }
      const current = settingsStore.getSnapshot().shortcutBindings;
      const error = validateBinding(current, listening, event.code);
      if (error) {
        setFeedback({ type: 'error', text: t(`settings.shortcuts_binding_${error}`, { key: formatKeyCode(event.code) }) });
        return;
      }
      updateSettings({ shortcutBindings: { ...current, [listening]: event.code } });
      setFeedback({ type: 'success', text: t('settings.shortcuts_binding_saved', { key: formatKeyCode(event.code) }) });
      setListening(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [listening, t, updateSettings]);

  const startListening = (id: MixShortcutId) => {
    setFeedback(null);
    setListening((current) => (current === id ? null : id));
  };

  return (
    <>
      <OptionCard title={t('settings.shortcuts_mix_title')} desc={t('settings.shortcuts_mix_desc')}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setListening(null);
            setFeedback(null);
            updateSettings({ shortcutBindings: DEFAULT_SHORTCUT_BINDINGS });
          }}
        >
          <RotateCcw size={14} />
          {t('settings.shortcuts_restore')}
        </Button>
      </OptionCard>
      <div className="library-table-container">
        <table className="library-table">
          <thead>
            <tr>
              <th scope="col">{t('settings.shortcuts_action')}</th>
              <th scope="col">{t('settings.shortcuts_deck', { deck: 'A' })}</th>
              <th scope="col">{t('settings.shortcuts_deck', { deck: 'B' })}</th>
            </tr>
          </thead>
          <tbody>
            {MIX_PARAMS.map((param) => (
              <tr key={param}>
                <td>{t(`settings.shortcuts_mix.${param}`)}</td>
                {(['A', 'B'] as const).map((deckId) => {
                  const id: MixShortcutId = `${deckId}.${param}`;
                  const isListening = listening === id;
                  return (
                    <td key={deckId}>
                      <Button
                        size="sm"
                        variant={isListening ? 'primary' : 'outline'}
                        aria-pressed={isListening}
                        aria-label={t('settings.shortcuts_binding_aria', {
                          action: t(`settings.shortcuts_mix.${param}`),
                          deck: deckId,
                          key: formatKeyCode(bindings[id]),
                        })}
                        onClick={() => startListening(id)}
                      >
                        {isListening ? t('settings.shortcuts_press_key') : `${formatKeyCode(bindings[id])} + ← / →`}
                      </Button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <FeedbackMessage feedback={feedback} />
    </>
  );
};

interface StorageUsage {
  trackCount: number;
  trackBytes: number;
  usage: number | null;
  quota: number | null;
}

const toMb = (bytes: number): string => (bytes / BYTES_PER_MB).toFixed(1);

const LibrarySettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings, resetSettings } = useSettingsStore();
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [confirm, setConfirm] = useState<'mixer' | 'factory' | null>(null);
  const [resetting, setResetting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate
      ? navigator.storage.estimate().catch(() => null)
      : Promise.resolve(null);
    Promise.all([indexedDBStorage.getAllTracks().catch(() => []), estimate]).then(([tracks, est]) => {
      if (!active) return;
      setStorage({
        trackCount: tracks.length,
        trackBytes: tracks.reduce((sum, track) => sum + (track.fileMeta?.fileSize ?? 0), 0),
        usage: est?.usage ?? null,
        quota: est?.quota ?? null,
      });
    });
    return () => { active = false; };
  }, [refreshToken]);

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
      setRefreshToken((n) => n + 1);
    }
  };

  const closeConfirm = () => { if (!resetting) setConfirm(null); };

  return (
    <div className="settings-group">
      <h3 className="settings-group-title">{t('settings.library_title')}</h3>
      <OptionCard
        title={t('settings.storage_used')}
        desc={storage ? t('settings.storage_tracks_value', { used: toMb(storage.trackBytes), count: storage.trackCount }) : undefined}
      >
        <Badge>
          {storage?.usage != null && storage.quota
            ? t('settings.storage_used_value', { used: toMb(storage.usage), quota: toMb(storage.quota) })
            : storage ? t('settings.storage_unavailable') : t('states.loading')}
        </Badge>
      </OptionCard>
      <OptionCard title={t('settings.auto_analyze')} desc={t('settings.auto_analyze_desc')}>
        <Switch
          checked={settings.autoAnalyzeOnImport}
          onChange={(e) => updateSettings({ autoAnalyzeOnImport: e.target.checked })}
        />
      </OptionCard>
      <OptionCard title={t('settings.reset_mixer')} desc={t('settings.reset_mixer_desc')}>
        <Button variant="outline" onClick={() => setConfirm('mixer')}>
          <SlidersHorizontal size={16} />
          {t('settings.reset_mixer')}
        </Button>
      </OptionCard>
      <OptionCard title={t('settings.factory_reset')} desc={t('settings.factory_reset_desc')}>
        <Button variant="outline" onClick={() => setConfirm('factory')}>
          <RotateCcw size={16} />
          {t('settings.factory_reset')}
        </Button>
      </OptionCard>
      <FeedbackMessage feedback={feedback} />

      <Modal open={confirm === 'mixer'} onClose={closeConfirm} title={t('settings.reset_mixer_confirm_title')}>
        <p className="settings-option-desc">{t('settings.reset_mixer_confirm_desc')}</p>
        <div className="settings-button-group">
          <Button variant="outline" onClick={closeConfirm}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleResetMixer}>
            <SlidersHorizontal size={16} />
            {t('settings.reset_mixer_confirm')}
          </Button>
        </div>
      </Modal>

      <Modal open={confirm === 'factory'} onClose={closeConfirm} title={t('settings.factory_reset_confirm_title')}>
        <p className="settings-option-desc">{t('settings.factory_reset_confirm_desc')}</p>
        <div className="settings-button-group">
          <Button variant="outline" disabled={resetting} onClick={closeConfirm}>
            {t('common.cancel')}
          </Button>
          <Button disabled={resetting} onClick={() => { void handleFactoryReset(); }}>
            <RotateCcw size={16} />
            {t('settings.factory_reset_confirm')}
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export const Settings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<Tab>('general');

  const tabs = [
    { id: 'general', icon: SettingsIcon, label: t('settings.tabs.general') },
    { id: 'appearance', icon: Palette, label: t('settings.tabs.appearance') },
    { id: 'language', icon: Globe, label: t('settings.tabs.language') },
    { id: 'audio', icon: Volume2, label: t('settings.tabs.audio') },
    { id: 'playback', icon: PlayCircle, label: t('settings.tabs.playback') },
    { id: 'shortcuts', icon: Keyboard, label: t('settings.tabs.shortcuts') },
    { id: 'library', icon: Library, label: t('settings.tabs.library') }
  ];

  return (
    <div className="settings-container">

      <div className="settings-sidebar">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={clsx('settings-tab', activeTab === tab.id && 'active')}
            onClick={() => setActiveTab(tab.id as Tab)}
          >
            <tab.icon size={20} />
            {tab.label}
          </div>
        ))}
      </div>

      <div className="settings-content">
        <h2 className="settings-section-title">
          {tabs.find(t => t.id === activeTab)?.label}
        </h2>

        {activeTab === 'general' && <GeneralSettings />}

        {activeTab === 'appearance' && (
          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.appearance_title')}</h3>
            <OptionCard title={t('settings.theme_dark')} desc={t('settings.theme_dark_desc')}>
              <Switch
                checked={settings.theme === 'dark'}
                onChange={(e) => updateSettings({ theme: e.target.checked ? 'dark' : 'light' })}
              />
            </OptionCard>
            <OptionCard title={t('settings.accent_title')} desc={t('settings.accent_desc')}>
              <OptionSelector
                options={ACCENT_COLORS}
                value={settings.accentColor}
                onChange={(accentColor) => updateSettings({ accentColor })}
                label={(color) => t(`settings.accent.${color}`)}
              />
            </OptionCard>
            <OptionCard title={t('settings.density_title')} desc={t('settings.density_desc')}>
              <OptionSelector
                options={['standard', 'compact'] as const}
                value={settings.density}
                onChange={(density) => updateSettings({ density })}
                label={(density) => t(`settings.density.${density}`)}
              />
            </OptionCard>
          </div>
        )}

        {activeTab === 'language' && (
          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.language_title')}</h3>
            <OptionSelector<AppLanguage>
              options={['es', 'en']}
              value={settings.language}
              onChange={(language) => updateSettings({ language })}
              label={(language) => t(`settings.language_${language}`)}
            />
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.audio_title')}</h3>
            <OptionCard title={t('settings.crossfader_curve_title')} desc={t('settings.crossfader_curve_desc')}>
              <OptionSelector
                options={CROSSFADER_CURVES}
                value={settings.crossfaderCurve}
                onChange={(crossfaderCurve) => updateSettings({ crossfaderCurve })}
                label={(curve) => t(`settings.crossfader_curve.${curve}`)}
              />
            </OptionCard>
            <OptionCard title={t('settings.pitch_range_title')} desc={t('settings.pitch_range_desc')}>
              <OptionSelector
                options={PITCH_RANGES}
                value={settings.pitchRange}
                onChange={(pitchRange) => updateSettings({ pitchRange })}
                label={(range) => `±${Math.round(range * 100)}%`}
              />
            </OptionCard>
            <OptionCard title={t('settings.sync_range_title')} desc={t('settings.sync_range_desc')}>
              <div className="settings-button-group">
                <Slider
                  min={SYNC_RANGE_MIN * 100}
                  max={SYNC_RANGE_MAX * 100}
                  step={SYNC_RANGE_STEP * 100}
                  value={Math.round(settings.syncRange * 100)}
                  aria-label={t('settings.sync_range_title')}
                  aria-valuetext={`±${Math.round(settings.syncRange * 100)}%`}
                  onChange={(e) => updateSettings({ syncRange: Number(e.target.value) / 100 })}
                />
                <Badge>{`±${Math.round(settings.syncRange * 100)}%`}</Badge>
              </div>
            </OptionCard>
            <OptionCard title={t('settings.buffer_title')} desc={t('settings.buffer_desc')}>
              <OptionSelector
                options={BUFFER_SIZES}
                value={settings.bufferSize}
                onChange={(bufferSize) => updateSettings({ bufferSize })}
                label={(size) => t('settings.buffer_option', { size, ms: ((size / 48000) * 1000).toFixed(1) })}
              />
            </OptionCard>
          </div>
        )}

        {activeTab === 'playback' && (
          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.playback_title')}</h3>
            <OptionCard title={t('settings.auto_transition_title')} desc={t('settings.auto_transition_desc')}>
              <OptionSelector
                options={AUTO_TRANSITION_BEATS}
                value={settings.autoTransitionBeats}
                onChange={(autoTransitionBeats) => updateSettings({ autoTransitionBeats })}
                label={(count) => t('settings.auto_transition_beats', { count })}
              />
            </OptionCard>
            <OptionCard title={t('settings.cue_mode_title')} desc={t('settings.cue_mode_desc')}>
              <OptionSelector
                options={['cdj', 'standard'] as const}
                value={settings.cueMode}
                onChange={(cueMode) => updateSettings({ cueMode })}
                label={(mode) => t(`settings.cue_mode.${mode}`)}
              />
            </OptionCard>
          </div>
        )}

        {activeTab === 'shortcuts' && (
          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.shortcuts_title')}</h3>
            <OptionCard title={t('settings.shortcuts_enabled')} desc={t('settings.shortcuts_enabled_desc')}>
              <Switch
                checked={settings.shortcutsEnabled}
                onChange={(e) => updateSettings({ shortcutsEnabled: e.target.checked })}
              />
            </OptionCard>
            <div className="library-table-container">
              <table className="library-table">
                <thead>
                  <tr>
                    <th scope="col">{t('settings.shortcuts_key')}</th>
                    <th scope="col">{t('settings.shortcuts_action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {KEYBOARD_SHORTCUTS.map((shortcut) => (
                    <tr key={shortcut.labelKey}>
                      <td><Badge>{shortcut.keys}</Badge></td>
                      <td>{t(shortcut.labelKey)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ShortcutBindingsEditor />
          </div>
        )}

        {activeTab === 'library' && <LibrarySettings />}

      </div>
    </div>
  );
};
