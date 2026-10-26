/**
 * SYSTEM DJ — DJ store shortcut target
 * Conecta las acciones de los atajos con el DJ store: los mismos parámetros que mueven los
 * controles de la consola (volumen de canal, Master, Pitch Bend, curva, EQ…). La grabación, el
 * selector de canciones y la navegación se inyectan porque dependen de la interfaz.
 */

import { djStore } from '../../store/useDJStore.ts';
import { stepCrossfaderCurve } from '../../store/useSettingsStore.ts';
import type { DeckId } from '../../types/deck.ts';
import type { MixParam, ShortcutTarget } from './keyboardShortcuts.ts';

const channelOf = (deckId: DeckId) => (deckId === 'A' ? djStore.getSnapshot().mixer.channelA : djStore.getSnapshot().mixer.channelB);

function getMixValue(deckId: DeckId, param: MixParam): number {
  const channel = channelOf(deckId);
  return param === 'gain' ? channel.gain : channel.eq[param];
}

function setMixValue(deckId: DeckId, param: MixParam, value: number): void {
  if (param === 'gain') djStore.setChannelGain(deckId, value);
  else if (param === 'filter') djStore.setChannelFilter(deckId, value);
  else djStore.setChannelEq(deckId, param, value);
}

export function createDJShortcutTarget(
  ui: Pick<ShortcutTarget, 'toggleRecording' | 'toggleTrackPicker' | 'navigate'> = {},
): ShortcutTarget {
  return {
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
    getChannelVolume: (deckId) => channelOf(deckId).volume,
    setChannelVolume: (deckId, volume) => djStore.setChannelVolume(deckId, volume),
    getMasterVolume: () => djStore.getSnapshot().masterVolume,
    setMasterVolume: (volume) => djStore.setMasterVolume(volume),
    toggleMasterMute: () => djStore.toggleMasterMute(),
    pitchBend: (deckId, direction) => djStore.pitchBend(deckId, direction),
    // Igual que los botones CP / LIN / CUT: cambia la curva en vivo, no la predeterminada guardada
    cycleCrossfaderCurve: (direction) => {
      djStore.setCrossfaderCurve(stepCrossfaderCurve(djStore.getSnapshot().mixer.crossfaderCurve, direction));
    },
    ...ui,
  };
}
