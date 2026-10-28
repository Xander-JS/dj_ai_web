/**
 * SYSTEM DJ — Settings Effects
 * Aplica las preferencias de settingsStore a sus destinos: atributos y tokens CSS del
 * documento, idioma de i18next, motor de audio, DJ store, atajos de teclado y transición automática.
 * Se inicializa una sola vez desde main.tsx y reacciona a cada cambio posterior.
 */

import i18n from '../../i18n/config';
import { audioEngine } from '../../audio';
import { djStore } from '../../store/useDJStore';
import { settingsStore, type AppSettings } from '../../store/useSettingsStore';
import { applyAppearanceToRoot } from './appearance';
import { installKeyboardShortcuts } from '../keyboard/keyboardShortcuts';
import { createDJShortcutTarget } from '../keyboard/djShortcutTarget';
import { transitionPlayer } from '../../audio/transitionPlayer';
import { navigateToSection } from '../navigation/consoleNavigator';
import { toggleSessionCaptureWithFeedback } from '../session/sessionCaptureFeedback';
import { zoomedWaveformLoop } from '../console/zoomedWaveform';

let uninstallShortcuts: (() => void) | null = null;

function setShortcutsEnabled(enabled: boolean): void {
  if (enabled && !uninstallShortcuts && typeof window !== 'undefined') {
    uninstallShortcuts = installKeyboardShortcuts(
      createDJShortcutTarget({
        toggleRecording: () => toggleSessionCaptureWithFeedback(),
        navigate: (section) => {
          navigateToSection(section);
        },
      }),
      () => settingsStore.getSnapshot().shortcutBindings,
      window,
      () => settingsStore.getSnapshot().navigationBindings,
    );
  } else if (!enabled && uninstallShortcuts) {
    uninstallShortcuts();
    uninstallShortcuts = null;
  }
}

function apply(next: AppSettings, previous: AppSettings | null): void {
  applyAppearanceToRoot(next, document.documentElement);
  if (i18n.language !== next.language) void i18n.changeLanguage(next.language);
  // El idioma del documento sigue al de la interfaz (lectores de pantalla, separación silábica)
  document.documentElement.lang = next.language;
  audioEngine.setPreferredBufferSize(next.bufferSize);
  djStore.setPitchRange(next.pitchRange);
  djStore.setCueMode(next.cueMode);
  djStore.setSyncRateLimit(next.syncRange);
  transitionPlayer.configure(next.autoTransitionBeats);
  // Tras aplicar la apariencia: la pantalla relee también sus colores
  zoomedWaveformLoop.configure(next.waveformZoom);
  // La curva guardada es la predeterminada de cada sesión; la consola puede cambiarla en vivo
  if (!previous || previous.crossfaderCurve !== next.crossfaderCurve) {
    djStore.setCrossfaderCurve(next.crossfaderCurve);
  }
  setShortcutsEnabled(next.shortcutsEnabled);
}

let initialized = false;

export function initSettingsEffects(): void {
  if (initialized) return;
  initialized = true;
  // Destino de la transición automática; se dispara cuando la sesión la active
  transitionPlayer.connect({
    getCrossfader: () => djStore.getSnapshot().mixer.crossfader,
    setCrossfader: (position) => djStore.setCrossfader(position),
    getDeckBpm: (deckId) => (deckId === 'A' ? djStore.getSnapshot().deckA : djStore.getSnapshot().deckB).calculatedBpm,
  });
  apply(settingsStore.getSnapshot(), null);
  settingsStore.subscribe(apply);
}
