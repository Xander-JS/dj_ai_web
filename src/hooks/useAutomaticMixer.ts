import { useEffect, useState, useSyncExternalStore } from 'react';
import { audioEngine } from '../audio';
import { djStore } from '../store/useDJStore';
import { indexedDBStorage } from '../services/storage/IndexedDBStorage';
import { getTrackRecommendations } from '../services/ai/geminiRecommendationService';
import { transitionPlayer } from '../audio/transitionPlayer';
import { consoleActions } from '../services/console/consoleActions';
import { requestMixPlan } from '../services/ai/mixPlan';
import { AutomaticMixer } from '../services/automix/AutomaticMixer';

export function useAutomaticMixer() {
  const [automatic] = useState(() => new AutomaticMixer({
    store: djStore,
    actions: consoleActions,
    resumeAudio: () => audioEngine.resume(),
    getTracks: () => indexedDBStorage.getAllTracks(),
    recommend: getTrackRecommendations,
    plan: (reference, candidates, signal) => {
      const state = djStore.getSnapshot();
      const deck = state.deckA.track?.id === reference.id ? state.deckA : state.deckB;
      return requestMixPlan(reference, candidates, signal, {
        position: deck.currentTime, duration: deck.duration,
        playbackRate: deck.playbackRate, crossfader: state.mixer.crossfader,
        hotCues: deck.hotCues.map(cue => cue.id),
        downbeatConfirmed: deck.track?.downbeat?.status === 'confirmed' && deck.track.analysis.beatUnit?.status === 'confirmed',
        lead: deck === state.deckA ? 'A' : 'B',
        decks: [state.deckA, state.deckB].filter(d => d.track).map(d => ({
          deck: d === state.deckA ? 'A' : 'B', trackId: d.track!.id,
          hotCues: d.hotCues.map(c => c.id),
          downbeatConfirmed: d.track?.downbeat?.status === 'confirmed' && d.track.analysis.beatUnit?.status === 'confirmed',
        })),
      });
    },
    transitionBeats: () => transitionPlayer.getBeats(),
    cancelTransition: () => transitionPlayer.cancel(),
    now: () => performance.now(),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: handle => window.clearInterval(handle as number),
  }));
  const state = useSyncExternalStore(automatic.subscribe, automatic.getSnapshot, automatic.getSnapshot);
  useEffect(() => {
    const press = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.dj-console') && !target.closest('.screen-button-row__automatic')) automatic.setInteracting(true);
    };
    const release = () => automatic.setInteracting(false);
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release);
    return () => {
      automatic.stop();
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
      window.removeEventListener('blur', release);
    };
  }, [automatic]);
  return { ...state, toggle: () => automatic.getSnapshot().active ? automatic.stop() : automatic.start() };
}
