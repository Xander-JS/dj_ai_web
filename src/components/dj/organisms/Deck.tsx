import React, { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { useDJStore, djStore } from '../../../store/useDJStore';
import { useSeedStore } from '../../../store/useSeedStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import { ejectDeckWithFeedback, toggleReferenceWithFeedback } from '../../../services/console/deckUtilityFeedback';
import type { DeckId } from '../../../types/deck';
import {
  getDeckAnalysisStatus,
  getDeckNotices,
  getDeckSyncKeys,
  type DeckPanelInput,
} from '../../../services/console/deckPanelModel';
import { toggleDeckDisplayMode } from '../../../hooks/useDeckDisplayMode';
import { JogWheel } from '../atoms/JogWheel';
import { DeckNoticeStrip } from '../molecules/DeckNoticeStrip';
import { DeckUtilityButtons } from '../molecules/DeckUtilityButtons';
import { DeckSyncRow } from '../molecules/DeckSyncRow';
import { DeckHotCues } from '../molecules/DeckHotCues';
import { DeckTransport } from '../molecules/DeckTransport';
import { DeckPitchFader } from '../molecules/DeckPitchFader';
import './Deck.css';

const CUE_KEYS = new Set([' ', 'Enter', 'c', 'C']);

export interface DeckProps {
  deckName: DeckId;
}

/**
 * Deck A / Deck B (secciones 2 y 3): Expulsar, Referencia y Modo (alterna el display LED, sobre
 * DOWNBEAT & COMPÁS) junto a los avisos, disco, fila de sincronización, Hot Cues, CUE y PLAY / PAUSE, y el fader de tempo. Deck B es el espejo horizontal de Deck A. Título, artista,
 * forma de onda e información técnica están en la pantalla digital.
 */
export const Deck: React.FC<DeckProps> = ({ deckName }) => {
  const { settings } = useSettingsStore();
  const pitchRangePercent = Math.round(settings.pitchRange * 100);
  const syncLimitPercent = Math.round(settings.syncRange * 100);
  const {
    deckA,
    deckB,
    syncMasterDeck,
    toggleSync,
    toggleKeyLock,
    alignPhase,
    cancelPhaseAlignment,
    prepareBarSync,
    cancelBarSync,
    togglePlayDeck,
    setPitchDeck,
    pitchBend,
    analyzeTrack,
    handleCueDown,
    handleCueUp,
    cancelCup,
    setHotCue,
    jumpToHotCue,
    deleteHotCue,
  } = useDJStore();

  const [isTriggeringAnalysis, setIsTriggeringAnalysis] = useState(false);
  const [isPreparingBarSync, setIsPreparingBarSync] = useState(false);
  const [isCuePressed, setIsCuePressed] = useState(false);
  const isCuePressedRef = useRef(false);

  const deck = deckName === 'A' ? deckA : deckB;
  const otherDeck = deckName === 'A' ? deckB : deckA;
  const id = deckName.toLowerCase();
  const { seedTrackIds } = useSeedStore();
  const loadedTrackId = deck.track?.id ?? null;
  const seedIndex = loadedTrackId ? seedTrackIds.indexOf(loadedTrackId) : -1;

  const hasTrack = Boolean(deck.track);
  const track = deck.track;
  const isPlaying = deck.playbackState === 'playing';
  const isLoading = deck.playbackState === 'loading';
  const isError = deck.playbackState === 'error';
  const controlsDisabled = !hasTrack || isLoading;

  const panelInput: DeckPanelInput = {
    deckName,
    deck,
    otherDeck,
    syncMasterDeck,
    seedIndex,
    isTriggeringAnalysis,
    isPreparingBarSync,
    syncLimitPercent,
  };
  const notices = getDeckNotices(panelInput);
  const syncKeys = getDeckSyncKeys(panelInput);

  const pitchPercentLabel = `${deck.playbackRate >= 1 ? '+' : ''}${((deck.playbackRate - 1) * 100).toFixed(2)}%`;
  const isPhaseActive = deck.phaseAlignment?.status === 'active';
  const barSyncStatus = deck.barSync?.status || 'idle';
  const isBarSyncArmed = barSyncStatus === 'armed';
  const isBarSyncAligned = barSyncStatus === 'already_aligned';
  const analysisStatus = getDeckAnalysisStatus(deck);

  const handleSyncToggle = () => {
    if (controlsDisabled) return;
    toggleSync(deckName);
  };

  const handlePhaseAlign = () => {
    if (controlsDisabled || !isPlaying) return;
    if (isPhaseActive) {
      cancelPhaseAlignment(deckName);
    } else {
      alignPhase(deckName);
    }
  };

  const handleBarSync = () => {
    if (controlsDisabled || isPreparingBarSync) return;
    if (isBarSyncArmed || isBarSyncAligned) {
      cancelBarSync(deckName);
    } else {
      setIsPreparingBarSync(true);
      try {
        prepareBarSync(deckName);
      } finally {
        setIsPreparingBarSync(false);
      }
    }
  };

  const handleTriggerAnalysis = async () => {
    if (!track || isTriggeringAnalysis || analysisStatus === 'analyzing') return;
    setIsTriggeringAnalysis(true);
    try {
      await analyzeTrack(track, analysisStatus === 'failed', deckName);
    } catch (err) {
      console.error(`[Deck ${deckName}] Error solicitando análisis musical:`, err);
    } finally {
      setIsTriggeringAnalysis(false);
    }
  };

  // Cancelar reproducción CUP ante pérdida de foco de la ventana o desmontaje.
  // Usa djStore directamente: las acciones de useDJStore() cambian de identidad en cada render y
  // la limpieza del efecto cancelaría la preview justo al iniciarse.
  useEffect(() => {
    const handleWindowBlur = () => {
      if (isCuePressedRef.current) {
        isCuePressedRef.current = false;
        setIsCuePressed(false);
        djStore.cancelCup(deckName);
      }
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      djStore.cancelCup(deckName);
    };
  }, [deckName]);

  const handlePlayToggle = async () => {
    if (controlsDisabled) return;
    await togglePlayDeck(deckName);
  };

  const pressCue = () => {
    isCuePressedRef.current = true;
    setIsCuePressed(true);
    handleCueDown(deckName);
  };

  // Soltar CUE (pointer, mouse, touch o salida del botón): detiene y vuelve al marcador una sola vez
  const releaseCue = () => {
    if (!isCuePressedRef.current) return;
    isCuePressedRef.current = false;
    setIsCuePressed(false);
    handleCueUp(deckName);
  };

  // Sin pointer capture: salir del botón con el puntero debe soltar el CUE
  const cueHandlers: React.ButtonHTMLAttributes<HTMLButtonElement> = {
    onPointerDown: (e) => {
      if (controlsDisabled) return;
      if (e.pointerType === 'touch') {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Ignorar si el navegador no soporta pointer capture
        }
      }
      pressCue();
    },
    onPointerUp: releaseCue,
    onPointerCancel: releaseCue,
    onPointerLeave: releaseCue,
    onMouseUp: releaseCue,
    onMouseLeave: releaseCue,
    onTouchEnd: releaseCue,
    onTouchCancel: releaseCue,
    onKeyDown: (e) => {
      if (controlsDisabled || e.repeat || !CUE_KEYS.has(e.key)) return;
      e.preventDefault();
      pressCue();
    },
    onKeyUp: (e) => {
      if (!CUE_KEYS.has(e.key)) return;
      e.preventDefault();
      releaseCue();
    },
    onBlur: () => {
      if (isCuePressedRef.current) {
        isCuePressedRef.current = false;
        setIsCuePressed(false);
        cancelCup(deckName);
      }
    },
  };

  return (
    <div
      className={clsx('dj-deck', `deck-${id}`, `console-tone-${id}`, isError && 'deck-has-error')}
      data-testid={`deck-${id}`}
    >
      <div className="deck-panel">
        <div className="deck-panel__top">
          <div className="deck-panel__utility">
            <DeckUtilityButtons
              deckId={deckName}
              ejectEnabled={hasTrack && !isLoading}
              referenceEnabled={hasTrack}
              isReference={seedIndex !== -1}
              onEject={() => ejectDeckWithFeedback(deckName)}
              onToggleReference={() => {
                if (loadedTrackId) toggleReferenceWithFeedback(deckName, loadedTrackId);
              }}
              onToggleMode={() => toggleDeckDisplayMode(deckName)}
            />
          </div>
          <div className="deck-panel__notices">
            <DeckNoticeStrip deckId={deckName} notices={notices} onAnalyze={handleTriggerAnalysis} />
          </div>
        </div>

        <div className="deck-panel__jog">
          <JogWheel deckId={deckName} spinning={isPlaying} playbackRate={deck.playbackRate} disc={settings.jogDisc} />
        </div>

        <div className="deck-panel__transport">
          <DeckTransport
            deckId={deckName}
            disabled={controlsDisabled}
            isPlaying={isPlaying}
            isCueLit={isCuePressed || deck.isCupPlaying}
            cueHandlers={cueHandlers}
            onPlayToggle={handlePlayToggle}
          />
        </div>

        <div className="deck-panel__sync">
          <DeckSyncRow
            deckId={deckName}
            keys={syncKeys}
            onBarSync={handleBarSync}
            onAlign={handlePhaseAlign}
            onSync={handleSyncToggle}
            onKeyLock={() => toggleKeyLock(deckName)}
          />
        </div>

        <div className="deck-panel__cues">
          <DeckHotCues
            deckId={deckName}
            hotCues={deck.hotCues ?? []}
            disabled={controlsDisabled}
            onSet={(slot) => setHotCue(deckName, slot)}
            onJump={(slot) => jumpToHotCue(deckName, slot)}
            onDelete={(slot) => deleteHotCue(deckName, slot)}
          />
        </div>

        <div className="deck-panel__pitch">
          <DeckPitchFader
            deckId={deckName}
            value={deck.pitch}
            rangePercent={pitchRangePercent}
            valueText={pitchPercentLabel}
            disabled={controlsDisabled}
            bend={deck.pitchBend}
            onChange={(value) => setPitchDeck(deckName, value)}
            onBend={(direction) => pitchBend(deckName, direction)}
            onBendRelease={() => pitchBend(deckName, 'release')}
          />
        </div>
      </div>
    </div>
  );
};
