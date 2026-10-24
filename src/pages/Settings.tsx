import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Check,
  Globe,
  Keyboard,
  Library,
  Palette,
  PlayCircle,
  UserRound,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Icon } from '../components/atoms/Icon';
import { Fader } from '../components/atoms/Fader';
import { Tag } from '../components/atoms/Tag';
import { ChoiceTiles } from '../components/molecules/ChoiceTiles';
import { Panel } from '../components/molecules/Panel';
import { SegmentedControl } from '../components/molecules/SegmentedControl';
import { SettingRow } from '../components/molecules/SettingRow';
import { ConsoleTemplate } from '../components/templates/ConsoleTemplate';
import { AccountSettings } from '../components/settings/AccountSettings';
import { LibrarySettings } from '../components/settings/LibrarySettings';
import { readStorageUsage, toMb, type StorageUsage } from '../components/settings/storageUsage';
import { ShortcutSettings } from '../components/settings/ShortcutSettings';
import { BeatLengthPreview, CrossfaderCurvePreview } from '../components/settings/SettingsPreviews';
import { DURATION, EASE_OUT } from '../design-system/motion';
import { useAuth } from '../context/AuthContext';
import {
  ACCENT_COLORS,
  ACCENT_HUES,
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
  type AppSettings,
  type ThemeMode,
} from '../store/useSettingsStore';
import './Settings.css';

type Tab = 'general' | 'appearance' | 'language' | 'audio' | 'playback' | 'shortcuts' | 'library';

const TABS: { id: Tab; icon: LucideIcon }[] = [
  { id: 'general', icon: UserRound },
  { id: 'appearance', icon: Palette },
  { id: 'language', icon: Globe },
  { id: 'audio', icon: Volume2 },
  { id: 'playback', icon: PlayCircle },
  { id: 'shortcuts', icon: Keyboard },
  { id: 'library', icon: Library },
];

const isTab = (value: string | null): value is Tab => TABS.some((tab) => tab.id === value);

const AUDIO_SAMPLE_RATE = 48000;
const APPLIED_STAMP_MS = 2400;
const percent = (fraction: number) => `±${Math.round(fraction * 100)}%`;
const latencyMs = (size: number) => ((size / AUDIO_SAMPLE_RATE) * 1000).toFixed(1);

interface Readout {
  label: string;
  value: string;
}

/** Lecturas de consola: el valor vigente de cada ajuste de la vista; al cambiar, la cifra se reemplaza */
const ReadoutStrip: React.FC<{ readouts: Readout[] }> = ({ readouts }) => {
  const reduceMotion = useReducedMotion();
  if (readouts.length === 0) return null;
  return (
    <dl className="sd-settings-readouts">
      {readouts.map((readout) => (
        <div key={readout.label} className="sd-settings-readout">
          <dt className="sd-settings-readout__label">{readout.label}</dt>
          <dd className="sd-settings-readout__value sd-num">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={readout.value}
                className="sd-settings-readout__text"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                transition={{ duration: DURATION.base, ease: EASE_OUT }}
              >
                {readout.value}
              </motion.span>
            </AnimatePresence>
          </dd>
        </div>
      ))}
    </dl>
  );
};

/** Sello «Aplicado» durante unos segundos tras cada cambio de preferencias */
function useAppliedStamp(): boolean {
  const [applied, setApplied] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = settingsStore.subscribe(() => {
      setApplied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setApplied(false), APPLIED_STAMP_MS);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timerRef.current);
    };
  }, []);

  return applied;
}

/** Miniatura de la consola en un tema: se dibuja con los tokens del ámbito data-theme */
const ThemePreview: React.FC<{ theme: ThemeMode }> = ({ theme }) => (
  <span className="sd-theme-preview" data-theme={theme}>
    <span className="sd-theme-preview__bar">
      <span className="sd-theme-preview__mark" />
      <span className="sd-theme-preview__line sd-theme-preview__line--short" />
    </span>
    <span className="sd-theme-preview__body">
      <span className="sd-theme-preview__rail">
        <span className="sd-theme-preview__pill sd-theme-preview__pill--active" />
        <span className="sd-theme-preview__pill" />
        <span className="sd-theme-preview__pill" />
      </span>
      <span className="sd-theme-preview__panel">
        <span className="sd-theme-preview__line" />
        <span className="sd-theme-preview__line sd-theme-preview__line--short" />
        <span className="sd-theme-preview__button" />
      </span>
    </span>
  </span>
);

const LanguagePreview: React.FC<{ code: string }> = ({ code }) => (
  <span className="sd-language-preview">
    <span className="sd-language-preview__code">{code}</span>
  </span>
);

export const Settings: React.FC = () => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { user, profile } = useAuth();
  const { settings, updateSettings } = useSettingsStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('section');
  const activeTab: Tab = isTab(requested) ? requested : 'general';
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const baseId = useId();
  const applied = useAppliedStamp();
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [storageToken, setStorageToken] = useState(0);
  const refreshStorage = useCallback(() => setStorageToken((n) => n + 1), []);

  // Uso de almacenamiento: se lee al abrir Biblioteca y tras un borrado
  useEffect(() => {
    if (activeTab !== 'library') return;
    let active = true;
    void readStorageUsage().then((usage) => { if (active) setStorage(usage); });
    return () => { active = false; };
  }, [activeTab, storageToken]);

  const selectTab = (tab: Tab, focus = false) => {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.set('section', tab);
      return next;
    }, { replace: true });
    if (focus) tabRefs.current[tab]?.focus();
  };

  // Navegación de pestañas con flechas, Inicio y Fin (activación automática)
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const last = TABS.length - 1;
    const target = {
      ArrowDown: index === last ? 0 : index + 1,
      ArrowRight: index === last ? 0 : index + 1,
      ArrowUp: index === 0 ? last : index - 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    selectTab(TABS[target].id, true);
  };

  const readouts = buildReadouts(activeTab, settings, storage, user ? (profile?.username ? `@${profile.username}` : user.email ?? '') : null, t);
  const tabLabel = (tab: Tab) => t(`settings.tabs.${tab}`);
  const panelId = `${baseId}-panel`;
  const tabId = (tab: Tab) => `${baseId}-tab-${tab}`;

  return (
    <ConsoleTemplate className="sd-settings">
      <div className="sd-settings__layout">
        <aside className="sd-settings__aside">
          <h2 className="sd-settings__title">{t('settings.title')}</h2>
          <p className="sd-settings__intro">{t('settings.page_desc')}</p>
          <div role="tablist" aria-orientation="vertical" aria-label={t('settings.categories_label')} className="sd-settings__tabs">
            {TABS.map((tab) => {
              const selected = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  ref={(el) => { tabRefs.current[tab.id] = el; }}
                  id={tabId(tab.id)}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  className={clsx('sd-settings__tab', selected && 'is-active')}
                  onClick={() => selectTab(tab.id)}
                  onKeyDown={handleTabKeyDown}
                >
                  <Icon icon={tab.icon} size="md" />
                  <span className="sd-settings__tab-label">{tabLabel(tab.id)}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <motion.section
          key={activeTab}
          id={panelId}
          role="tabpanel"
          aria-labelledby={tabId(activeTab)}
          className="sd-settings__view"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
        >
          <header className="sd-settings__view-header">
            <div className="sd-settings__view-heading">
              <h3 className="sd-settings__view-title">{tabLabel(activeTab)}</h3>
              <p className="sd-settings__view-desc">{t(`settings.tab_desc.${activeTab}`)}</p>
            </div>
            <div className="sd-settings__applied" role="status">
              <AnimatePresence>
                {applied && (
                  <motion.span
                    initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: DURATION.base, ease: EASE_OUT }}
                  >
                    <Tag tone="sage">
                      <Icon icon={Check} size="xs" />
                      {t('settings.applied')}
                    </Tag>
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <ReadoutStrip readouts={readouts} />
          </header>

          <div className="sd-settings__view-body">
            {activeTab === 'general' && <AccountSettings />}

            {activeTab === 'appearance' && (
              <Panel>
                <SettingRow
                  layout="stacked"
                  title={t('settings.theme_title')}
                  description={t('settings.theme_desc')}
                  control={(
                    <ChoiceTiles<ThemeMode>
                      label={t('settings.theme_title')}
                      value={settings.theme}
                      onChange={(theme) => updateSettings({ theme })}
                      options={(['light', 'dark'] as const).map((theme) => ({
                        value: theme,
                        label: t(`settings.theme_option.${theme}`),
                        preview: <ThemePreview theme={theme} />,
                      }))}
                    />
                  )}
                />
                <SettingRow
                  layout="stacked"
                  title={t('settings.accent_title')}
                  description={t('settings.accent_desc')}
                  control={(
                    <ChoiceTiles
                      variant="swatch"
                      label={t('settings.accent_title')}
                      value={settings.accentColor}
                      onChange={(accentColor) => updateSettings({ accentColor })}
                      options={ACCENT_COLORS.map((color) => ({
                        value: color,
                        label: t(`settings.accent.${color}`),
                        // Mismo color que appearance.ts escribe en --color-accent
                        preview: <span className="sd-accent-swatch" style={{ backgroundColor: `hsl(${ACCENT_HUES[color]}, 70%, 55%)` }} />,
                      }))}
                    />
                  )}
                />
                <SettingRow
                  title={t('settings.density_title')}
                  description={t('settings.density_desc')}
                  control={(
                    <SegmentedControl
                      label={t('settings.density_title')}
                      value={settings.density}
                      onChange={(density) => updateSettings({ density })}
                      options={(['standard', 'compact'] as const).map((density) => ({ value: density, label: t(`settings.density.${density}`) }))}
                    />
                  )}
                />
              </Panel>
            )}

            {activeTab === 'language' && (
              <Panel>
                <SettingRow
                  layout="stacked"
                  title={t('settings.language_title')}
                  description={t('settings.language_desc')}
                  control={(
                    <ChoiceTiles<AppLanguage>
                      label={t('settings.language_title')}
                      value={settings.language}
                      onChange={(language) => updateSettings({ language })}
                      options={(['es', 'en'] as const).map((language) => ({
                        value: language,
                        label: t(`settings.language_${language}`),
                        preview: <LanguagePreview code={language.toUpperCase()} />,
                      }))}
                    />
                  )}
                />
              </Panel>
            )}

            {activeTab === 'audio' && (
              <>
                <Panel title={t('settings.audio_mixer_title')} headingLevel="h4">
                  <SettingRow
                    title={t('settings.crossfader_curve_title')}
                    description={t('settings.crossfader_curve_desc')}
                    control={(
                      <SegmentedControl
                        label={t('settings.crossfader_curve_title')}
                        value={settings.crossfaderCurve}
                        onChange={(crossfaderCurve) => updateSettings({ crossfaderCurve })}
                        options={CROSSFADER_CURVES.map((curve) => ({ value: curve, label: t(`settings.crossfader_curve.${curve}`) }))}
                      />
                    )}
                    preview={<CrossfaderCurvePreview curve={settings.crossfaderCurve} />}
                  />
                  <SettingRow
                    title={t('settings.pitch_range_title')}
                    description={t('settings.pitch_range_desc')}
                    control={(
                      <SegmentedControl
                        label={t('settings.pitch_range_title')}
                        value={String(settings.pitchRange)}
                        onChange={(value) => updateSettings({ pitchRange: Number(value) as AppSettings['pitchRange'] })}
                        options={PITCH_RANGES.map((range) => ({ value: String(range), label: <span className="sd-num">{percent(range)}</span> }))}
                      />
                    )}
                  />
                  <SettingRow
                    layout="stacked"
                    title={t('settings.sync_range_title')}
                    description={t('settings.sync_range_desc')}
                    control={({ titleId }) => (
                      <div className="sd-settings__fader-row">
                        <Fader
                          min={SYNC_RANGE_MIN * 100}
                          max={SYNC_RANGE_MAX * 100}
                          step={SYNC_RANGE_STEP * 100}
                          value={Math.round(settings.syncRange * 100)}
                          aria-labelledby={titleId}
                          aria-valuetext={percent(settings.syncRange)}
                          ticks={[4, 8, 12, 16, 20].map((value) => ({ value, label: `±${value}` }))}
                          onChange={(e) => updateSettings({ syncRange: Number(e.target.value) / 100 })}
                        />
                        <output className="sd-settings__fader-value sd-num" aria-hidden="true">{percent(settings.syncRange)}</output>
                      </div>
                    )}
                  />
                </Panel>
                <Panel title={t('settings.audio_engine_title')} headingLevel="h4">
                  <SettingRow
                    title={t('settings.buffer_title')}
                    description={t('settings.buffer_desc')}
                    control={(
                      <SegmentedControl
                        label={t('settings.buffer_title')}
                        value={String(settings.bufferSize)}
                        onChange={(value) => updateSettings({ bufferSize: Number(value) as AppSettings['bufferSize'] })}
                        options={BUFFER_SIZES.map((size) => ({ value: String(size), label: <span className="sd-num">{size}</span> }))}
                      />
                    )}
                    preview={(
                      <p className="sd-settings__value-line sd-num">
                        {t('settings.buffer_option', { size: settings.bufferSize, ms: latencyMs(settings.bufferSize) })}
                      </p>
                    )}
                  />
                </Panel>
              </>
            )}

            {activeTab === 'playback' && (
              <Panel>
                <SettingRow
                  title={t('settings.auto_transition_title')}
                  description={t('settings.auto_transition_desc')}
                  control={(
                    <SegmentedControl
                      label={t('settings.auto_transition_title')}
                      value={String(settings.autoTransitionBeats)}
                      onChange={(value) => updateSettings({ autoTransitionBeats: Number(value) as AppSettings['autoTransitionBeats'] })}
                      options={AUTO_TRANSITION_BEATS.map((count) => ({ value: String(count), label: t('settings.auto_transition_beats', { count }) }))}
                    />
                  )}
                  preview={<BeatLengthPreview beats={settings.autoTransitionBeats} />}
                />
                <SettingRow
                  title={t('settings.cue_mode_title')}
                  description={t('settings.cue_mode_desc')}
                  control={(
                    <SegmentedControl
                      label={t('settings.cue_mode_title')}
                      value={settings.cueMode}
                      onChange={(cueMode) => updateSettings({ cueMode })}
                      options={(['cdj', 'standard'] as const).map((mode) => ({ value: mode, label: t(`settings.cue_mode.${mode}`) }))}
                    />
                  )}
                />
              </Panel>
            )}

            {activeTab === 'shortcuts' && <ShortcutSettings />}

            {activeTab === 'library' && <LibrarySettings storage={storage} onStorageChange={refreshStorage} />}
          </div>
        </motion.section>
      </div>
    </ConsoleTemplate>
  );
};

function buildReadouts(
  tab: Tab,
  settings: AppSettings,
  storage: StorageUsage | null,
  account: string | null,
  t: TFunction,
): Readout[] {
  switch (tab) {
    case 'general':
      return account ? [{ label: t('settings.readout.account'), value: account }] : [];
    case 'appearance':
      return [
        { label: t('settings.readout.theme'), value: t(`settings.theme_option.${settings.theme}`) },
        { label: t('settings.readout.accent'), value: t(`settings.accent.${settings.accentColor}`) },
        { label: t('settings.readout.density'), value: t(`settings.density.${settings.density}`) },
      ];
    case 'language':
      // La muestra del idioma ya es la lectura: no se duplica
      return [];
    case 'audio':
      return [
        { label: t('settings.readout.curve'), value: t(`settings.crossfader_curve.${settings.crossfaderCurve}`) },
        { label: t('settings.readout.pitch'), value: percent(settings.pitchRange) },
        { label: t('settings.readout.sync'), value: percent(settings.syncRange) },
        { label: t('settings.readout.buffer'), value: t('settings.readout.buffer_value', { ms: latencyMs(settings.bufferSize) }) },
      ];
    case 'playback':
      return [
        { label: t('settings.readout.transition'), value: t('settings.auto_transition_beats', { count: settings.autoTransitionBeats }) },
        { label: t('settings.readout.cue'), value: t(`settings.cue_mode.${settings.cueMode}`) },
      ];
    case 'shortcuts':
      return [{ label: t('settings.readout.shortcuts'), value: t(settings.shortcutsEnabled ? 'settings.readout.on' : 'settings.readout.off') }];
    case 'library':
      return [
        { label: t('settings.readout.tracks'), value: storage ? String(storage.trackCount) : '—' },
        { label: t('settings.readout.tracks_size'), value: storage ? `${toMb(storage.trackBytes)} MB` : '—' },
        { label: t('settings.readout.auto_analyze'), value: t(settings.autoAnalyzeOnImport ? 'settings.readout.on' : 'settings.readout.off') },
      ];
  }
}
