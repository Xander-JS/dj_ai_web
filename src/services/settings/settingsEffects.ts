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
import { installKeyboardShortcuts, type MixParam } from '../keyboard/keyboardShortcuts';
import { transitionPlayer } from '../../audio/transitionPlayer';
import type { DeckId } from '../../types/deck';

let uninstallShortcuts: (() => void) | null = null;

function getMixValue(deckId: DeckId, param: MixParam): number {
  const channel = deckId === 'A' ? djStore.getSnapshot().mixer.channelA : djStore.getSnapshot().mixer.channelB;
  return param === 'gain' ? channel.gain : channel.eq[param];
}

function setMixValue(deckId: DeckId, param: MixParam, value: number): void {
  if (param === 'gain') djStore.setChannelGain(deckId, value);
  else if (param === 'filter') djStore.setChannelFilter(deckId, value);
  else djStore.setChannelEq(deckId, param, value);
}

function setShortcutsEnabled(enabled: boolean): void {
  if (enabled && !uninstallShortcuts && typeof window !== 'undefined') {
    uninstallShortcuts = installKeyboardShortcuts({
      togglePlayDeck: (deckId) => djStore.togglePlayDeck(deckId),
      handleCueDown: (deckId) => djStore.handleCueDown(deckId),
      handleCueUp: (deckId) => djStore.handleCueUp(deckId),
      toggleSync: (deckId) => djStore.toggleSync(deckId),
      getCrossfader: () => djStore.getSnapshot().mixer.crossfader,
      setCrossfader: (position) => djStore.setCrossfader(position),
      hasHotCue: (deckId, slot) => {
        const deck = deckId === 'A' ? djStore.getSnapshot().deckA : djStore.getSnapshot().deckB;
        return deck.hotCues.some((cue) => cue.id === slot);
      },
      jumpToHotCue: (deckId, slot) => djStore.jumpToHotCue(deckId, slot),
      setHotCue: (deckId, slot) => djStore.setHotCue(deckId, slot),
      getMixValue,
      setMixValue,
    }, () => settingsStore.getSnapshot().shortcutBindings);
  } else if (!enabled && uninstallShortcuts) {
    uninstallShortcuts();
    uninstallShortcuts = null;
  }
}

function apply(next: AppSettings, previous: AppSettings | null): void {
  applyAppearanceToRoot(next, document.documentElement);
  if (i18n.language !== next.language) void i18n.changeLanguage(next.language);
  audioEngine.setPreferredBufferSize(next.bufferSize);
  djStore.setPitchRange(next.pitchRange);
  djStore.setCueMode(next.cueMode);
  djStore.setSyncRateLimit(next.syncRange);
  transitionPlayer.configure(next.autoTransitionBeats);
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
