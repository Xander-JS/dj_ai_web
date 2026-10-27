import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '../atoms/Button';
import { Icon } from '../atoms/Icon';
import { Switch } from '../atoms/Switch';
import { Notice } from '../molecules/Notice';
import { Panel } from '../molecules/Panel';
import { SettingRow } from '../molecules/SettingRow';
import { settingsStore, useSettingsStore } from '../../store/useSettingsStore';
import {
  CONSOLE_SHORTCUT_IDS,
  DEFAULT_NAVIGATION_BINDINGS,
  DEFAULT_SHORTCUT_BINDINGS,
  KEYBOARD_SHORTCUTS,
  MIX_PARAMS,
  MIX_SHORTCUT_IDS,
  NAV_SECTIONS,
  formatKeyCode,
  validateBinding,
  validateNavigationBinding,
  type ConsoleShortcutId,
  type MixShortcutId,
  type NavSection,
  type ShortcutBindings,
} from '../../services/keyboard/keyboardShortcuts';

type Feedback = { type: 'error' | 'success'; text: string } | null;

/** Teclas físicas de un atajo como teclas sueltas: «Shift + Space» → [Shift] [Space]. */
const Keycaps: React.FC<{ keys: string }> = ({ keys }) => (
  <span className="sd-keycaps">
    {keys.split(' + ').map((key) => (
      <kbd key={key} className="sd-keycap">{key}</kbd>
    ))}
  </span>
);

/** Los atajos fijos se agrupan por el deck al que actúan (sufijo _a / _b) o la consola (_mix). */
const FIXED_GROUPS = (['a', 'b', 'mix'] as const).map((group) => ({
  group,
  shortcuts: KEYBOARD_SHORTCUTS.filter((shortcut) => shortcut.labelKey.endsWith(`_${group}`)),
}));

/** Solo se comparan las entradas que muestra cada editor, para que «Restaurar» sea independiente. */
const sameEntries = (bindings: ShortcutBindings, ids: readonly (keyof ShortcutBindings)[]): boolean =>
  ids.every((id) => bindings[id] === DEFAULT_SHORTCUT_BINDINGS[id]);

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
  const isDefault = sameEntries(bindings, MIX_SHORTCUT_IDS);

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
    <Panel
      headingLevel="h4"
      title={t('settings.shortcuts_mix_title')}
      description={t('settings.shortcuts_mix_desc')}
      aside={(
        <Button
          variant="ghost"
          size="sm"
          disabled={isDefault}
          onClick={() => {
            setListening(null);
            setFeedback(null);
            const restored = { ...settingsStore.getSnapshot().shortcutBindings };
            for (const id of MIX_SHORTCUT_IDS) restored[id] = DEFAULT_SHORTCUT_BINDINGS[id];
            updateSettings({ shortcutBindings: restored });
          }}
        >
          <Icon icon={RotateCcw} size="sm" />
          {t('settings.shortcuts_restore')}
        </Button>
      )}
    >
      <div className="sd-bindings">
        <table className="sd-table sd-bindings__table">
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
                <th scope="row" className="sd-bindings__param">{t(`settings.shortcuts_mix.${param}`)}</th>
                {(['A', 'B'] as const).map((deckId) => {
                  const id: MixShortcutId = `${deckId}.${param}`;
                  const isListening = listening === id;
                  return (
                    <td key={deckId}>
                      <button
                        type="button"
                        className={clsx('sd-binding', isListening && 'is-listening')}
                        aria-pressed={isListening}
                        aria-label={t('settings.shortcuts_binding_aria', {
                          action: t(`settings.shortcuts_mix.${param}`),
                          deck: deckId,
                          key: formatKeyCode(bindings[id]),
                        })}
                        onClick={() => startListening(id)}
                      >
                        {isListening ? (
                          <span className="sd-binding__prompt">{t('settings.shortcuts_press_key')}</span>
                        ) : (
                          <>
                            <kbd className="sd-keycap sd-keycap--strong">{formatKeyCode(bindings[id])}</kbd>
                            <span className="sd-binding__plus" aria-hidden="true">+</span>
                            <kbd className="sd-keycap">←</kbd>
                            <kbd className="sd-keycap">→</kbd>
                          </>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {feedback && <Notice tone={feedback.type}>{feedback.text}</Notice>}
    </Panel>
  );
};

/** Teclas fijas que acompañan a cada comando de consola en su celda (la reasignable va resaltada). */
const CONSOLE_COMMAND_KEYS: Record<ConsoleShortcutId, { before?: string }> = {
  mute: {},
  record: {},
  libraryA: {},
  libraryB: {},
};

/**
 * Comandos de consola reasignables: MUTE, grabación y selector de canciones. Misma
 * captura que las selectoras de mezcla; comparten el mapa y la validación de duplicados.
 */
const ConsoleBindingsEditor: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const [listening, setListening] = useState<ConsoleShortcutId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const bindings = settings.shortcutBindings;
  const isDefault = sameEntries(bindings, CONSOLE_SHORTCUT_IDS);

  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (event: KeyboardEvent) => {
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

  return (
    <Panel
      headingLevel="h4"
      title={t('settings.shortcuts_console_title')}
      description={t('settings.shortcuts_console_desc')}
      aside={(
        <Button
          variant="ghost"
          size="sm"
          disabled={isDefault}
          onClick={() => {
            setListening(null);
            setFeedback(null);
            const restored = { ...settingsStore.getSnapshot().shortcutBindings };
            for (const id of CONSOLE_SHORTCUT_IDS) restored[id] = DEFAULT_SHORTCUT_BINDINGS[id];
            updateSettings({ shortcutBindings: restored });
          }}
        >
          <Icon icon={RotateCcw} size="sm" />
          {t('settings.shortcuts_restore')}
        </Button>
      )}
    >
      <div className="sd-bindings">
        <table className="sd-table sd-bindings__table">
          <thead>
            <tr>
              <th scope="col">{t('settings.shortcuts_action')}</th>
              <th scope="col">{t('settings.shortcuts_key')}</th>
            </tr>
          </thead>
          <tbody>
            {CONSOLE_SHORTCUT_IDS.map((id) => {
              const isListening = listening === id;
              const action = t(`settings.shortcuts_console.${id}`);
              const { before } = CONSOLE_COMMAND_KEYS[id];
              return (
                <tr key={id}>
                  <th scope="row" className="sd-bindings__param">{action}</th>
                  <td>
                    <button
                      type="button"
                      className={clsx('sd-binding', isListening && 'is-listening')}
                      aria-pressed={isListening}
                      aria-label={t('settings.shortcuts_console_binding_aria', { action, key: formatKeyCode(bindings[id]) })}
                      onClick={() => {
                        setFeedback(null);
                        setListening((current) => (current === id ? null : id));
                      }}
                    >
                      {isListening ? (
                        <span className="sd-binding__prompt">{t('settings.shortcuts_press_key')}</span>
                      ) : (
                        <>
                          {before && (
                            <>
                              <kbd className="sd-keycap">{before}</kbd>
                              <span className="sd-binding__plus" aria-hidden="true">+</span>
                            </>
                          )}
                          <kbd className="sd-keycap sd-keycap--strong">{formatKeyCode(bindings[id])}</kbd>
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {feedback && <Notice tone={feedback.type}>{feedback.text}</Notice>}
    </Panel>
  );
};

/**
 * Atajos de sección: Shift + tecla. Misma captura que las selectoras de mezcla (clic en la
 * celda, siguiente tecla; Escape cancela); se reasigna la tecla, Shift es fijo.
 */
const NavigationBindingsEditor: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();
  const [listening, setListening] = useState<NavSection | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const bindings = settings.navigationBindings;
  const isDefault = JSON.stringify(bindings) === JSON.stringify(DEFAULT_NAVIGATION_BINDINGS);

  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Shift solo es el modificador del atajo: se espera la tecla que lo acompaña
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (event.code === 'Escape') {
        setListening(null);
        return;
      }
      const current = settingsStore.getSnapshot().navigationBindings;
      const error = validateNavigationBinding(current, listening, event.code);
      if (error) {
        setFeedback({ type: 'error', text: t(`settings.shortcuts_nav_binding_${error}`, { key: formatKeyCode(event.code) }) });
        return;
      }
      updateSettings({ navigationBindings: { ...current, [listening]: event.code } });
      setFeedback({ type: 'success', text: t('settings.shortcuts_nav_binding_saved', { key: formatKeyCode(event.code) }) });
      setListening(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [listening, t, updateSettings]);

  return (
    <Panel
      headingLevel="h4"
      title={t('settings.shortcuts_nav_title')}
      description={t('settings.shortcuts_nav_desc')}
      aside={(
        <Button
          variant="ghost"
          size="sm"
          disabled={isDefault}
          onClick={() => {
            setListening(null);
            setFeedback(null);
            updateSettings({ navigationBindings: DEFAULT_NAVIGATION_BINDINGS });
          }}
        >
          <Icon icon={RotateCcw} size="sm" />
          {t('settings.shortcuts_restore')}
        </Button>
      )}
    >
      <div className="sd-bindings">
        <table className="sd-table sd-bindings__table">
          <thead>
            <tr>
              <th scope="col">{t('settings.shortcuts_section')}</th>
              <th scope="col">{t('settings.shortcuts_key')}</th>
            </tr>
          </thead>
          <tbody>
            {NAV_SECTIONS.map((section) => {
              const isListening = listening === section;
              const name = t(`navigation.${section}`);
              return (
                <tr key={section}>
                  <th scope="row" className="sd-bindings__param">{name}</th>
                  <td>
                    <button
                      type="button"
                      className={clsx('sd-binding', isListening && 'is-listening')}
                      aria-pressed={isListening}
                      aria-label={t('settings.shortcuts_nav_binding_aria', { section: name, key: formatKeyCode(bindings[section]) })}
                      onClick={() => {
                        setFeedback(null);
                        setListening((current) => (current === section ? null : section));
                      }}
                    >
                      {isListening ? (
                        <span className="sd-binding__prompt">{t('settings.shortcuts_press_key')}</span>
                      ) : (
                        <>
                          <kbd className="sd-keycap">Shift</kbd>
                          <span className="sd-binding__plus" aria-hidden="true">+</span>
                          <kbd className="sd-keycap sd-keycap--strong">{formatKeyCode(bindings[section])}</kbd>
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {feedback && <Notice tone={feedback.type}>{feedback.text}</Notice>}
    </Panel>
  );
};

export const ShortcutSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettingsStore();

  return (
    <>
      <Panel>
        <SettingRow
          title={t('settings.shortcuts_enabled')}
          description={t('settings.shortcuts_enabled_desc')}
          control={({ titleId, descriptionId }) => (
            <Switch
              checked={settings.shortcutsEnabled}
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              onChange={(e) => updateSettings({ shortcutsEnabled: e.target.checked })}
            />
          )}
        />
      </Panel>

      <div className={clsx('sd-shortcuts', !settings.shortcutsEnabled && 'is-disabled')}>
        {!settings.shortcutsEnabled && <Notice tone="info">{t('settings.shortcuts_disabled_note')}</Notice>}

        <Panel headingLevel="h4" title={t('settings.shortcuts_fixed_title')} description={t('settings.shortcuts_fixed_desc')}>
          <div className="sd-shortcut-decks">
            {FIXED_GROUPS.map(({ group, shortcuts }) => (
              <section
                key={group}
                className={clsx('sd-shortcut-deck', group === 'mix' && 'sd-shortcut-deck--mixer')}
                aria-label={group === 'mix' ? t('settings.shortcuts_mixer_group') : t('settings.shortcuts_deck', { deck: group.toUpperCase() })}
              >
                <p className="sd-shortcut-deck__name" aria-hidden="true">{group === 'mix' ? t('settings.shortcuts_mixer_short') : group.toUpperCase()}</p>
                <ul className="sd-shortcut-list">
                  {shortcuts.map((shortcut) => (
                    <li key={shortcut.labelKey} className="sd-shortcut">
                      <Keycaps keys={shortcut.keys} />
                      <span className="sd-shortcut__action">{t(shortcut.labelKey)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Panel>

        <NavigationBindingsEditor />

        <ShortcutBindingsEditor />

        <ConsoleBindingsEditor />
      </div>
    </>
  );
};
