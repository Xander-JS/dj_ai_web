import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Check,
  Dot,
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
import { Switch } from '../components/atoms/Switch';
import { Tag } from '../components/atoms/Tag';
import { ChoiceTiles } from '../components/molecules/ChoiceTiles';
import { Notice } from '../components/molecules/Notice';
import { Panel } from '../components/molecules/Panel';
import { SegmentedControl } from '../components/molecules/SegmentedControl';
import { SettingRow } from '../components/molecules/SettingRow';
import { ConsoleTemplate } from '../components/templates/ConsoleTemplate';
import { AccountSettings } from '../components/settings/AccountSettings';
import { LibrarySettings } from '../components/settings/LibrarySettings';
import { readStorageUsage, toMb, type StorageUsage } from '../components/settings/storageUsage';
import { ShortcutSettings } from '../components/settings/ShortcutSettings';
import { BeatLengthPreview, CrossfaderCurvePreview } from '../components/settings/SettingsPreviews';
import { DISC_ASSETS, discImageStyle } from '../components/dj/mixerAssets';
import { DURATION, EASE_OUT } from '../design-system/motion';
import { useSystemReducedMotion } from '../design-system/motionPreference';
import { useSmoothScroll } from '../design-system/smoothScroll';
import { useAuth } from '../context/AuthContext';
import {
  ACCENT_COLORS,
  AUTO_TRANSITION_BEATS,
  DEFAULT_SETTINGS,
  BUFFER_SIZES,
  CROSSFADER_CURVES,
  JOG_DISCS,
  PITCH_RANGES,
  SYNC_RANGE_MAX,
  SYNC_RANGE_MIN,
  SYNC_RANGE_STEP,
  WAVEFORM_ZOOMS,
  settingsStore,
  useSettingsStore,
  type AppLanguage,
  type AppSettings,
  type JogDisc,
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

/** Animaciones gobernadas por la preferencia global; cada nueva se añade aquí y en su CSS */
const ANIMATED_SURFACES = ['sidebar', 'selection_bar', 'mixer'] as const;

/** Muestra real del disco (rotating-disc-*.png); el elegido gira despacio como en los decks */
const DiscPreview: React.FC<{ disc: JogDisc }> = ({ disc }) => (
  <span className="sd-disc-preview">
    <span className="sd-disc-preview__platter">
      <img src={DISC_ASSETS[disc].src} alt="" loading="lazy" decoding="async" draggable={false} style={discImageStyle(DISC_ASSETS[disc])} />
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
  const systemReducedMotion = useSystemReducedMotion();
  const smoothScrollRef = useSmoothScroll<HTMLDivElement>();
  // Desplazamiento propio del contenido de la categoría: el menú queda fijo y cada categoría
  // nueva empieza arriba (se reinicia mientras ninguna está a la vista, entre salida y entrada)
  const viewScrollRef = useRef<HTMLDivElement | null>(null);
  const setViewScroll = useCallback((element: HTMLDivElement | null) => {
    viewScrollRef.current = element;
    return smoothScrollRef(element);
  }, [smoothScrollRef]);
  const [interfaceNotice, setInterfaceNotice] = useState<'reloading' | 'not_saved' | null>(null);

  // Modo experimental: al activarlo se guarda y se recarga una sola vez, solo por acción del usuario.
  // Si el almacenamiento no conserva el valor, no se recarga (se perdería y no tendría efecto).
  const handleExperimentalChange = (enabled: boolean) => {
    updateSettings({ experimentalInterface: enabled });
    if (!enabled) {
      setInterfaceNotice(null);
      return;
    }
    if (settingsStore.readPersisted()?.experimentalInterface !== true) {
      setInterfaceNotice('not_saved');
      return;
    }
    setInterfaceNotice('reloading');
    window.location.reload();
  };
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
    <ConsoleTemplate fill className="sd-settings">
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

        {/* Cambio de categoría: la saliente se desvanece brevemente y la entrante llega desde la derecha */}
        <div ref={setViewScroll} className="sd-settings__view-scroll sd-scroll-area">
        <AnimatePresence mode="wait" initial={false} onExitComplete={() => viewScrollRef.current?.scrollTo({ top: 0 })}>
        <motion.section
          key={activeTab}
          id={panelId}
          role="tabpanel"
          aria-labelledby={tabId(activeTab)}
          className="sd-settings__view"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduceMotion ? 0 : -8, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
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
                        hint: color === DEFAULT_SETTINGS.accentColor ? t('settings.accent_default') : undefined,
                        // El ámbito data-accent pinta el mismo --sd-accent que recibirá la consola
                        preview: <span className="sd-accent-swatch" data-accent={color} />,
                      }))}
                    />
                  )}
                />
                <SettingRow
                  layout="stacked"
                  title={t('settings.disc_title')}
                  description={t('settings.disc_desc')}
                  control={(
                    <ChoiceTiles<JogDisc>
                      className="sd-disc-tiles"
                      hideLabels
                      label={t('settings.disc_title')}
                      value={settings.jogDisc}
                      onChange={(jogDisc) => updateSettings({ jogDisc })}
                      options={JOG_DISCS.map((disc) => ({
                        value: disc,
                        label: t('settings.disc_option', { n: JOG_DISCS.indexOf(disc) + 1 }),
                        preview: <DiscPreview disc={disc} />,
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

            {activeTab === 'appearance' && (
              <Panel title={t('settings.motion_title')} headingLevel="h4">
                <SettingRow
                  title={t('settings.animations_title')}
                  description={t('settings.animations_desc')}
                  control={({ titleId, descriptionId }) => (
                    <Switch
                      checked={settings.animations}
                      aria-labelledby={titleId}
                      aria-describedby={descriptionId}
                      onChange={(e) => updateSettings({ animations: e.target.checked })}
                    />
                  )}
                  preview={(
                    <div className="sd-settings__motion">
                      <p id={`${baseId}-motion-scope`} className="sd-settings__motion-label">{t('settings.animations_scope')}</p>
                      <ul className="sd-settings__motion-list" aria-labelledby={`${baseId}-motion-scope`}>
                        {ANIMATED_SURFACES.map((surface) => (
                          <li key={surface} className="sd-settings__motion-item">
                            <Icon icon={Dot} size="sm" />
                            {t(`settings.animations_list.${surface}`)}
                          </li>
                        ))}
                      </ul>
                      {systemReducedMotion && (
                        <Notice tone="info">{t('settings.animations_reduced')}</Notice>
                      )}
                    </div>
                  )}
                />
              </Panel>
            )}

            {activeTab === 'appearance' && (
              <Panel title={t('settings.lab_title')} headingLevel="h4" aside={<Tag tone="acid">{t('settings.experimental_tag')}</Tag>}>
                <SettingRow
                  title={t('settings.experimental_title')}
                  description={t('settings.experimental_desc')}
                  control={({ titleId, descriptionId }) => (
                    <Switch
                      checked={settings.experimentalInterface}
                      disabled={interfaceNotice === 'reloading'}
                      aria-labelledby={titleId}
                      aria-describedby={descriptionId}
                      onChange={(e) => handleExperimentalChange(e.target.checked)}
                    />
                  )}
                  preview={
                    interfaceNotice === 'not_saved' ? (
                      <Notice tone="error">{t('settings.experimental_not_saved')}</Notice>
                    ) : interfaceNotice === 'reloading' ? (
                      <p className="sd-settings__value-line" role="status">{t('settings.experimental_reloading')}</p>
                    ) : settings.experimentalInterface ? (
                      <p className="sd-settings__value-line">{t('settings.experimental_on_note')}</p>
                    ) : undefined
                  }
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
                  <SettingRow
                    title={t('settings.waveform_zoom_title')}
                    description={t('settings.waveform_zoom_desc')}
                    control={(
                      <SegmentedControl
                        label={t('settings.waveform_zoom_title')}
                        value={String(settings.waveformZoom)}
                        onChange={(value) => updateSettings({ waveformZoom: Number(value) as AppSettings['waveformZoom'] })}
                        options={WAVEFORM_ZOOMS.map((zoom) => ({ value: String(zoom), label: t(`settings.waveform_zoom.${zoom}`) }))}
                      />
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
        </AnimatePresence>
        </div>
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
        { label: t('settings.readout.disc'), value: t('settings.disc_option', { n: JOG_DISCS.indexOf(settings.jogDisc) + 1 }) },
        { label: t('settings.readout.animations'), value: t(settings.animations ? 'settings.readout.on' : 'settings.readout.off') },
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
