import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LedMatrixDisplay, type LedMatrixContent } from '../atoms/LedMatrixDisplay';
import { DisplayModeIndicator } from '../molecules/DisplayModeIndicator';
import { DeckNoticeStrip } from '../molecules/DeckNoticeStrip';
import { useAnimationsEnabled } from '../../../design-system/motionPreference';
import { useDeckDisplayMode } from '../../../hooks/useDeckDisplayMode';
import { useDeckMessage } from '../../../hooks/useDeckMessage';
import { getDeckAnalysisStatus, getDeckNotices, type DeckPanelInput } from '../../../services/console/deckPanelModel';
import { useDJStore } from '../../../store/useDJStore';
import { useSeedStore } from '../../../store/useSeedStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import type { DeckId } from '../../../types/deck';
import './DeckLedPanel.css';

export interface DeckLedPanelProps {
  deckName: DeckId;
}

const LEVEL_COLOR = { error: '--console-led-red', warning: '--console-led-amber', guide: '--console-silkscreen' } as const;

/**
 * Bloque LED del deck: fila de MODO (GUÍA / MAPA) y el display. GUÍA muestra el mensaje del deck
 * en su color de prioridad; MAPA, la vista general de la pista con playhead, Hot Cues, CUE y la
 * región del Auto Loop.
 * El mensaje se repite en texto para lectores de pantalla. Vive sobre DOWNBEAT & COMPÁS de su
 * deck; el botón MODE del deck lo alterna.
 */
export const DeckLedPanel: React.FC<DeckLedPanelProps> = ({ deckName }) => {
  const { i18n } = useTranslation();
  const { deckA, deckB, syncMasterDeck, analyzeTrack } = useDJStore();
  const { settings } = useSettingsStore();
  const { seedTrackIds } = useSeedStore();
  const [isTriggeringAnalysis, setIsTriggeringAnalysis] = useState(false);
  const syncLimitPercent = Math.round(settings.syncRange * 100);

  const deck = deckName === 'A' ? deckA : deckB;
  const otherDeck = deckName === 'A' ? deckB : deckA;
  const track = deck.track;
  const analysisStatus = getDeckAnalysisStatus(deck);
  const message = useDeckMessage({ deckName, deck, otherDeck, syncMasterDeck });
  const mode = useDeckDisplayMode(deckName, message);
  const animations = useAnimationsEnabled();
  const { duration, currentTime, hotCues, mainCue, loop } = deck;
  const analysis = deck.track?.analysis;
  const level = message?.level;
  const text = message?.text.toLocaleUpperCase(i18n.language) ?? '';
  const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : null;

  const loadedTrackId = deck.track?.id ?? null;
  const seedIndex = loadedTrackId ? seedTrackIds.indexOf(loadedTrackId) : -1;

  const handleTriggerAnalysis = useCallback(async () => {
    if (!track || isTriggeringAnalysis || analysisStatus === 'analyzing') return;
    setIsTriggeringAnalysis(true);
    try {
      await analyzeTrack(track, analysisStatus === 'failed', deckName);
    } catch (err) {
      console.error(`[Deck ${deckName}] Error solicitando análisis musical:`, err);
    } finally {
      setIsTriggeringAnalysis(false);
    }
  }, [analyzeTrack, analysisStatus, deckName, isTriggeringAnalysis, track]);

  const panelInput: DeckPanelInput = {
    deckName,
    deck,
    otherDeck,
    syncMasterDeck,
    seedIndex,
    isTriggeringAnalysis,
    isPreparingBarSync: false,
    syncLimitPercent,
  };
  const notices = getDeckNotices(panelInput);

  const textContent = useMemo<LedMatrixContent>(
    () => ({ kind: 'text', text, color: LEVEL_COLOR[level ?? 'guide'] }),
    [text, level],
  );

  const overview: LedMatrixContent | null =
    mode === 'map'
      ? {
          kind: 'overview',
          color: '--console-tone',
          peaks: deck.track ? analysis?.waveformPeaks : undefined,
          coverage: duration > 0 && analysis?.waveformDurationSec ? analysis.waveformDurationSec / duration : 1,
          progress,
          markers: duration > 0
            ? [
                ...hotCues.map((cue) => ({ at: cue.position / duration, color: cue.color })),
                ...(mainCue !== null ? [{ at: mainCue / duration, color: '--console-led-amber' }] : []),
              ]
            : [],
          region: duration > 0 && loop.region ? { from: loop.region.start / duration, to: loop.region.end / duration } : null,
        }
      : null;

  return (
    <div className={`deck-led-panel console-tone-${deckName.toLowerCase()}`}>
      <div className="deck-led-panel__notices">
        <DeckNoticeStrip deckId={deckName} notices={notices} onAnalyze={handleTriggerAnalysis} />
      </div>
      <DisplayModeIndicator
        mode={mode}
        guideColor={level === 'error' ? 'red' : level === 'warning' ? 'amber' : 'tone'}
      />
      <LedMatrixDisplay content={overview ?? textContent} reducedMotion={!animations} />
      <p className="sd-visually-hidden" aria-live="assertive">{level === 'error' ? message?.text : ''}</p>
      <p className="sd-visually-hidden" aria-live="polite">{level && level !== 'error' ? message?.text : ''}</p>
    </div>
  );
};
