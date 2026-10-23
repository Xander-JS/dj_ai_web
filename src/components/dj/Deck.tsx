import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '../ui/Slider';
import { Badge } from '../ui/Badge';
import { Waveform } from './Waveform';
import { clsx } from 'clsx';
import { useDJStore, djStore, HOT_CUE_COLORS } from '../../store/useDJStore';
import { useSeedStore } from '../../store/useSeedStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { Target } from 'lucide-react';
import { formatDuration } from '../../utils/formatters';
import type { AnalysisStatus } from '../../types/track';
import { isDownbeatConfirmed } from '../../utils/downbeat';
import { formatMeter, getBarSyncReadiness, getDeckMeter } from '../../utils/barSyncReadiness';
import type { BeatUnit } from '../../types/track';
import '../ui/Badge.css';
import './Deck.css';

/** Meters offered by the downbeat editor as [beatsPerBar, beatUnit]. */
const METER_OPTIONS: ReadonlyArray<readonly [number, BeatUnit]> = [[4, 4], [3, 4], [2, 4], [6, 8]];

export interface DeckProps {
  deckName: 'A' | 'B';
  trackTitle?: string;
  trackArtist?: string;
  bpm?: number;
  keyStr?: string;
  timeRemaining?: string;
}

export const Deck: React.FC<DeckProps> = ({ 
  deckName, 
  trackTitle, 
  trackArtist,
  timeRemaining = '-0:00'
}) => {
  const { t } = useTranslation();
  const { settings } = useSettingsStore();
  const pitchRangePercent = Math.round(settings.pitchRange * 100);
  const syncLimitPercent = Math.round(settings.syncRange * 100);
  const { 
    deckA, 
    deckB, 
    syncMasterDeck,
    toggleSync,
    alignPhase,
    cancelPhaseAlignment,
    prepareBarSync,
    cancelBarSync,
    confirmDownbeat,
    clearDownbeat,
    togglePlayDeck, 
    seekDeck, 
    setPitchDeck,
    pitchBend,
    unloadDeck,
    analyzeTrack,
    handleCueDown,
    handleCueUp,
    cancelCup,
    setHotCue,
    jumpToHotCue,
    deleteHotCue,
  } = useDJStore();

  const [isTriggeringAnalysis, setIsTriggeringAnalysis] = useState(false);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [isPreparingBarSync, setIsPreparingBarSync] = useState(false);
  const [editDownbeatPos, setEditDownbeatPos] = useState<string>('0.000');
  const [editBeatsPerBar, setEditBeatsPerBar] = useState<number>(4);
  const [editBeatUnit, setEditBeatUnit] = useState<BeatUnit>(4);
  const [isSavingDownbeat, setIsSavingDownbeat] = useState<boolean>(false);
  const [downbeatError, setDownbeatError] = useState<string | null>(null);
  const isCuePressedRef = useRef(false);

  const handlePitchBendDown = (direction: 'up' | 'down') => {
    pitchBend(deckName, direction);
  };

  const handlePitchBendRelease = () => {
    pitchBend(deckName, 'release');
  };

  const deck = deckName === 'A' ? deckA : deckB;
  const { seedTrackIds, toggleSeed } = useSeedStore();
  const loadedTrackId = deck.track?.id ?? null;
  const seedIndex = loadedTrackId ? seedTrackIds.indexOf(loadedTrackId) : -1;
  const isSeed = seedIndex !== -1;

  const handleToggleSeed = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (loadedTrackId) toggleSeed(loadedTrackId);
  };
  const hasTrack = Boolean(deck.track);
  const track = deck.track;
  const analysis = track?.analysis;
  const isAnalyzed = analysis?.status === 'analyzed';

  const isPlaying = deck.playbackState === 'playing';
  const isLoading = deck.playbackState === 'loading';
  const isError = deck.playbackState === 'error';

  const finalTitle = track?.title || trackTitle || t('dj.no_track');
  const finalArtist = track
    ? (track.artist || t('dj.unknown_artist'))
    : (trackArtist || (trackTitle ? t('dj.unknown_artist') : ''));

  const currentPitch = deck.pitch;
  const isMaster = deck.isMaster || syncMasterDeck === deckName;
  const isSyncActive = deck.isSyncActive;
  const otherDeckName: 'A' | 'B' = deckName === 'A' ? 'B' : 'A';
  const otherDeck = deckName === 'A' ? deckB : deckA;
  const isOtherMaster = otherDeck.isMaster || syncMasterDeck === otherDeckName;
  // Rol explícito: MASTER marca el tempo; SLAVE sigue el BPM del Master con SYNC activo.
  const syncRole: 'master' | 'slave' | null = isMaster ? 'master' : isSyncActive ? 'slave' : null;
  const pitchPercentLabel = `${deck.playbackRate >= 1 ? '+' : ''}${((deck.playbackRate - 1) * 100).toFixed(2)}%`;
  const masterBpmLabel = otherDeck.calculatedBpm !== null ? otherDeck.calculatedBpm.toFixed(1) : '—';
  const phaseAlignment = deck.phaseAlignment;
  const isPhaseActive = phaseAlignment?.status === 'active';
  const hasProvisionalGrid = isAnalyzed && typeof analysis?.firstBeatTime === 'number' && typeof analysis?.bpm === 'number';

  const handleSyncToggle = () => {
    if (!hasTrack || isLoading) return;
    toggleSync(deckName);
  };

  const handlePhaseAlign = () => {
    if (!hasTrack || isLoading || !isPlaying) return;
    if (isPhaseActive) {
      cancelPhaseAlignment(deckName);
    } else {
      alignPhase(deckName);
    }
  };

  const barSync = deck.barSync;
  const barSyncStatus = barSync?.status || 'idle';
  const isBarSyncArmed = barSyncStatus === 'armed';
  const isBarSyncAligned = barSyncStatus === 'already_aligned';
  const isDownbeatManuallyConfirmed = hasTrack && isDownbeatConfirmed(track?.downbeat, track?.fileMeta?.contentHash);
  const meter = getDeckMeter(track);
  const meterLabel = formatMeter(meter);
  const isMeterConfirmed = meter.downbeatConfirmed && meter.beatUnit !== null;
  const barSyncReadiness = getBarSyncReadiness(
    { track: track ?? null, playbackState: deck.playbackState, isMaster, effectiveBpm: deck.calculatedBpm },
    { track: otherDeck.track ?? null, playbackState: otherDeck.playbackState, isMaster: isOtherMaster, effectiveBpm: otherDeck.calculatedBpm },
  );
  const barSyncBlockMessage = barSyncReadiness.ready
    ? null
    : t(`dj.bar_sync_block_${barSyncReadiness.reason}`, { master: otherDeckName, ...barSyncReadiness.values });
  const hasValidHash = Boolean(
    track?.fileMeta?.contentHash &&
    typeof track.fileMeta.contentHash === 'string' &&
    track.fileMeta.contentHash.length === 64 &&
    /^[0-9a-f]{64}$/i.test(track.fileMeta.contentHash)
  );
  const suggestedPos = track?.downbeat?.suggestedPosition ?? (typeof analysis?.firstBeatTime === 'number' ? analysis.firstBeatTime : null);
  const hasSuggested = typeof suggestedPos === 'number' && Number.isFinite(suggestedPos) && suggestedPos >= 0;

  const barSyncReasonKey = barSyncStatus === 'rejected_state' || barSyncStatus === 'rejected_unconfirmed' ||
    barSyncStatus === 'rejected_no_downbeat' || barSyncStatus === 'rejected_metric_mismatch' ||
    barSyncStatus === 'rejected_limits' || barSyncStatus === 'rejected_confidence' ||
    barSyncStatus === 'rejected_tempo_mismatch'
    ? `dj.bar_sync_reason_${barSyncStatus}`
    : 'dj.bar_sync_reason_generic';

  const phaseStatusLabel = phaseAlignment?.status === 'active'
    ? `${t('dj.phase_align_active')} (${Math.round(phaseAlignment.progressPercent)}%)`
    : phaseAlignment?.status === 'completed'
    ? t('dj.phase_align_completed')
    : phaseAlignment?.status === 'cancelled'
    ? t('dj.phase_align_cancelled')
    : phaseAlignment?.status === 'rejected_limits'
    ? t('dj.phase_align_rejected_limits')
    : phaseAlignment?.status === 'rejected_confidence'
    ? t('dj.phase_align_rejected_confidence')
    : phaseAlignment?.status === 'already_aligned'
    ? t('dj.phase_align_already_aligned')
    : phaseAlignment?.status === 'rejected_state'
    ? t('dj.phase_align_rejected_state')
    : phaseAlignment?.status;

  const phaseStatusTooltip = phaseAlignment?.status === 'rejected_limits'
    ? t('dj.phase_align_rejected_limits')
    : phaseAlignment?.status === 'rejected_confidence'
    ? t('dj.phase_align_rejected_confidence')
    : phaseAlignment?.status === 'rejected_state'
    ? t('dj.phase_align_rejected_state')
    : phaseAlignment?.status === 'already_aligned'
    ? t('dj.phase_align_already_aligned')
    : phaseAlignment?.status === 'cancelled'
    ? t('dj.phase_align_cancelled')
    : phaseAlignment?.status === 'completed'
    ? t('dj.phase_align_completed_tooltip')
    : t('dj.phase_align_tooltip');

  const formatDeltaSeconds = (val: number | null | undefined): string => {
    if (val === null || val === undefined || Math.abs(val) < 0.0005) return '0.00s';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}s`;
  };

  const formatDeltaSigned = (val: number | null | undefined): string => {
    if (val === null || val === undefined || Math.abs(val) < 0.0005) return '0.000';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(3)}`;
  };

  const handleBarSync = () => {
    if (!hasTrack || isLoading || isPreparingBarSync) return;
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

  // 4.1 Información musical en los decks:
  // BPM: efectivo con pitch aplicado o '—' si no hay análisis
  const currentBpm = deck.calculatedBpm !== null
    ? deck.calculatedBpm.toFixed(1)
    : '—';

  // Tonalidad (Key): nota musical canónica o '—'
  const currentKey = isAnalyzed && analysis?.key
    ? analysis.key
    : '—';

  // Camelot: código armónico Camelot Wheel o null
  const currentCamelot = isAnalyzed && analysis?.camelot
    ? analysis.camelot
    : null;

  // Energía: intensidad acústica en escala 0 a 10 o '—'
  const currentEnergy = isAnalyzed && typeof analysis?.energy === 'number'
    ? analysis.energy.toFixed(1)
    : '—';

  const duration = deck.duration;
  const currentTime = deck.currentTime;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const formattedTimeRemaining = duration > 0 
    ? `-${formatDuration(Math.max(0, duration - currentTime))}` 
    : timeRemaining;

  const timeStatTooltip = t('dj.bar_sync_time_tooltip', {
    current: currentTime.toFixed(3),
    total: duration.toFixed(3),
  });

  const barSyncBadgeTooltip = barSync && barSync.status !== 'idle'
    ? (barSync.status as string) === 'preparing'
      ? t('dj.bar_sync_badge_preparing')
      : barSync.status === 'armed'
      ? t('dj.bar_sync_armed_badge_tooltip', {
          prepared: barSync.preparedPosition?.toFixed(3) ?? '0.000',
          prev: barSync.previousPosition?.toFixed(3) ?? '0.000',
          disp: formatDeltaSigned(barSync.displacementSec),
          target: barSync.targetDownbeatSec?.toFixed(3) ?? '0.000',
          beats: barSync.beatsPerBar ?? 4,
        })
      : barSync.status === 'already_aligned'
      ? t('dj.bar_sync_already_aligned_badge_tooltip', {
          prepared: barSync.preparedPosition?.toFixed(3) ?? '0.000',
          prev: barSync.previousPosition?.toFixed(3) ?? '0.000',
          disp: formatDeltaSigned(barSync.displacementSec),
          beats: barSync.beatsPerBar ?? 4,
        })
      : barSync.status === 'completed'
      ? t('dj.bar_sync_completed_tooltip')
      : barSync.status === 'cancelled'
      ? t('dj.bar_sync_cancelled_tooltip')
      : t(barSyncReasonKey)
    : undefined;

  // 4.2 Estado del análisis:
  const analysisStatus: AnalysisStatus | null = analysis?.status || (hasTrack ? 'pending' : null);
  const isAnalyzing = analysisStatus === 'analyzing' || isTriggeringAnalysis;
  const canTriggerAnalysis = hasTrack && !isAnalyzing && (analysisStatus === 'pending' || analysisStatus === 'failed');

  // Cancelar reproducción CUP ante pérdida de foco de la ventana o desmontaje.
  // Usa djStore directamente: las acciones de useDJStore() cambian de identidad en cada render y
  // la limpieza del efecto cancelaría la preview justo al iniciarse.
  useEffect(() => {
    const handleWindowBlur = () => {
      if (isCuePressedRef.current) {
        isCuePressedRef.current = false;
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
    if (!hasTrack || isLoading) return;
    await togglePlayDeck(deckName);
  };

  // Sin pointer capture: salir del botón con el puntero debe soltar el CUE
  const handleCueButtonDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!hasTrack || isLoading) return;
    if (e.pointerType === 'touch') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignorar si el navegador no soporta pointer capture
      }
    }
    isCuePressedRef.current = true;
    handleCueDown(deckName);
  };

  // Soltar CUE (pointer, mouse, touch o salida del botón): detiene y vuelve al marcador una sola vez
  const releaseCue = () => {
    if (!isCuePressedRef.current) return;
    isCuePressedRef.current = false;
    handleCueUp(deckName);
  };

  const handleCueKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!hasTrack || isLoading || e.repeat) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      isCuePressedRef.current = true;
      handleCueDown(deckName);
    }
  };

  const handleCueKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      releaseCue();
    }
  };

  const handleHotCueClick = (slotNumber: number, e: React.MouseEvent<HTMLButtonElement>) => {
    if (!hasTrack || isLoading) return;
    const existingCue = deck.hotCues?.find((c) => c.id === slotNumber);
    const shouldDelete = isDeleteMode || e.shiftKey;

    if (shouldDelete) {
      if (existingCue) {
        deleteHotCue(deckName, slotNumber);
      }
      return;
    }

    if (existingCue) {
      jumpToHotCue(deckName, slotNumber);
    } else {
      setHotCue(deckName, slotNumber);
    }
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration > 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, clickX / rect.width));
      seekDeck(deckName, percent * duration);
    }
  };

  const handlePitchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPitchDeck(deckName, Number(e.target.value));
  };

  const handleUnloadTrack = () => {
    if (isLoading) return;
    unloadDeck(deckName);
  };

  const handleTriggerAnalysis = async () => {
    if (!track || isAnalyzing) return;
    setIsTriggeringAnalysis(true);
    try {
      await analyzeTrack(track, analysisStatus === 'failed', deckName);
    } catch (err) {
      console.error(`[Deck ${deckName}] Error solicitando análisis musical:`, err);
    } finally {
      setIsTriggeringAnalysis(false);
    }
  };

  const currentTrackId = track?.id ?? null;
  const [prevTrackId, setPrevTrackId] = useState<string | null>(null);
  const [prevConfirmed, setPrevConfirmed] = useState<boolean>(false);
  const [selectedSource, setSelectedSource] = useState<'suggested' | 'playhead' | null>(null);

  // Sincronización del editor manual de downbeat (reflejo inmediato al cambiar de pista o confirmar/limpiar)
  if (currentTrackId !== prevTrackId || isDownbeatManuallyConfirmed !== prevConfirmed) {
    setPrevTrackId(currentTrackId);
    setPrevConfirmed(isDownbeatManuallyConfirmed);
    setDownbeatError(null);
    setIsSavingDownbeat(false);
    setSelectedSource(null);

    if (!hasTrack || !track) {
      setEditDownbeatPos('0.000');
      setEditBeatsPerBar(4);
      setEditBeatUnit(4);
    } else if (isDownbeatManuallyConfirmed && track.downbeat?.confirmation) {
      setEditDownbeatPos(track.downbeat.confirmation.position.toFixed(3));
      setEditBeatsPerBar(track.downbeat.confirmation.beatsPerBar);
      setEditBeatUnit(meter.beatUnit ?? 4);
    } else {
      if (hasSuggested && typeof suggestedPos === 'number') {
        setEditDownbeatPos(suggestedPos.toFixed(3));
      } else {
        setEditDownbeatPos('0.000');
      }
      setEditBeatsPerBar(4);
      setEditBeatUnit(4);
    }
  }

  const handleUseSuggested = () => {
    if (!hasTrack || isLoading || isSavingDownbeat || !hasSuggested || typeof suggestedPos !== 'number') return;
    setDownbeatError(null);
    setSelectedSource('suggested');
    setEditDownbeatPos(suggestedPos.toFixed(3));
  };

  const handleCapturePlayhead = () => {
    if (!hasTrack || isLoading || isSavingDownbeat) return;
    setDownbeatError(null);
    setSelectedSource('playhead');
    setEditDownbeatPos(Math.max(0, currentTime).toFixed(3));
  };

  const handleConfirmDownbeat = async () => {
    if (!hasTrack || !hasValidHash || isSavingDownbeat || isLoading) return;
    setDownbeatError(null);

    const parsedPos = parseFloat(editDownbeatPos);
    if (isNaN(parsedPos) || parsedPos < 0 || (duration > 0 && parsedPos > duration)) {
      setDownbeatError(t('dj.downbeat_error_invalid_pos'));
      return;
    }

    setIsSavingDownbeat(true);
    try {
      const success = await confirmDownbeat(deckName, {
        position: parsedPos,
        beatsPerBar: editBeatsPerBar,
        beatUnit: editBeatUnit,
        suggestedPosition: hasSuggested && typeof suggestedPos === 'number' ? suggestedPos : null,
      });
      if (!success) {
        setDownbeatError(t('dj.downbeat_error_persist'));
      }
    } catch {
      setDownbeatError(t('dj.downbeat_error_persist'));
    } finally {
      setIsSavingDownbeat(false);
    }
  };

  const handleClearDownbeat = async () => {
    if (!hasTrack || isSavingDownbeat || isLoading || !isDownbeatManuallyConfirmed) return;
    setDownbeatError(null);
    setIsSavingDownbeat(true);
    try {
      const success = await clearDownbeat(deckName);
      if (!success) {
        setDownbeatError(t('dj.downbeat_error_persist'));
      }
    } catch {
      setDownbeatError(t('dj.downbeat_error_persist'));
    } finally {
      setIsSavingDownbeat(false);
    }
  };

  return (

    <div className={clsx('dj-deck', 'deck-real', `deck-${deckName.toLowerCase()}`, isError && 'deck-has-error')}>
      
      {/* Header Info */}
      <div className="deck-header">
        <div className="deck-title-group">
          <div className="deck-title-row">
            <span className="deck-track-title">{finalTitle}</span>
            {hasTrack && (
              <button
                type="button"
                className="deck-eject-btn"
                onClick={handleUnloadTrack}
                title={t('dj.eject_title')}
                aria-label={t('dj.eject')}
                data-testid={`deck-eject-${deckName.toLowerCase()}`}
              >
                ⏏
              </button>
            )}
            {hasTrack && loadedTrackId && (
              <button
                type="button"
                className="deck-eject-btn"
                onClick={handleToggleSeed}
                aria-pressed={isSeed}
                title={isSeed ? t('seed.unmark') : t('seed.mark')}
                aria-label={isSeed ? t('seed.unmark') : t('seed.mark')}
                data-testid={`deck-seed-${deckName.toLowerCase()}`}
              >
                <Target size={13} aria-hidden="true" fill={isSeed ? 'currentColor' : 'none'} />
              </button>
            )}
            {syncRole && (
              <Badge
                variant={syncRole === 'master' ? 'primary' : 'success'}
                className={clsx('deck-role-badge', 'deck-tooltip-trigger', `deck-role-${syncRole}`)}
                data-tooltip={syncRole === 'master'
                  ? t('dj.role_master_tooltip')
                  : t('dj.role_slave_tooltip', { master: otherDeckName, bpm: masterBpmLabel, pitch: pitchPercentLabel, limit: syncLimitPercent })}
                tabIndex={0}
                role="status"
                data-testid={`deck-${deckName.toLowerCase()}-role-badge`}
              >
                {syncRole === 'master'
                  ? t('dj.role_master')
                  : t('dj.role_slave', { master: otherDeckName })}
              </Badge>
            )}
            {isSeed && (
              <Badge variant="warning" title={t('seed.badge_title')} data-testid={`deck-seed-badge-${deckName.toLowerCase()}`}>
                {t('seed.badge', { index: seedIndex + 1 })}
              </Badge>
            )}
          </div>

          <div className="deck-subtitle-row">
            <span className="deck-track-artist">
              {deck.errorCode === 'sync_failed' && deck.syncFeedback ? (
                <span className="deck-error-badge" title={t(deck.syncFeedback.key, deck.syncFeedback.values)} role="alert">
                  {t(deck.syncFeedback.key, deck.syncFeedback.values)}
                </span>
              ) : isError && deck.errorMessage ? (
                <span className="deck-error-badge" title={deck.errorMessage} role="alert">
                  {deck.errorMessage}
                </span>
              ) : (
                finalArtist
              )}
            </span>

            {/* Indicador de estado del análisis musical */}
            {hasTrack && analysisStatus && (
              <span
                className={clsx(
                  'status-badge',
                  `status-badge-${analysisStatus}`,
                  canTriggerAnalysis && 'interactive'
                )}
                onClick={canTriggerAnalysis ? handleTriggerAnalysis : undefined}
                title={
                  analysisStatus === 'pending'
                    ? t('library.status_pending_title')
                    : analysisStatus === 'analyzing'
                    ? t('library.status_analyzing_title')
                    : analysisStatus === 'analyzed'
                    ? t('library.status_analyzed_title')
                    : analysisStatus === 'unsupported'
                    ? (analysis?.analysisError || t('library.status_unsupported_title'))
                    : (analysis?.analysisError || t('library.status_failed_title'))
                }
                role={canTriggerAnalysis ? 'button' : undefined}
                tabIndex={canTriggerAnalysis ? 0 : undefined}
                onKeyDown={
                  canTriggerAnalysis
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleTriggerAnalysis();
                        }
                      }
                    : undefined
                }
                data-testid={`deck-status-${deckName.toLowerCase()}`}
              >
                {isAnalyzing ? (
                  <>
                    <span className="spin-anim" aria-hidden="true">⏳</span>
                    <span>{t('library.status_analyzing')}</span>
                  </>
                ) : analysisStatus === 'analyzed' ? (
                  <>
                    <span aria-hidden="true">✓</span>
                    <span>{t('library.status_analyzed')}</span>
                  </>
                ) : analysisStatus === 'pending' ? (
                  <>
                    <span aria-hidden="true">🕒</span>
                    <span>{t('library.status_pending')}</span>
                  </>
                ) : analysisStatus === 'unsupported' ? (
                  <>
                    <span aria-hidden="true">ℹ️</span>
                    <span>{t('library.status_unsupported')}</span>
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">⚠️</span>
                    <span>{t('library.status_failed')}</span>
                  </>
                )}
              </span>
            )}

            {/* Indicador explícito de Beatgrid Provisional (no downbeat confirmado) */}
            {hasProvisionalGrid && (
              <span
                className="status-badge deck-grid-prov-badge"
                title={t('dj.phase_align_grid_tooltip')}
                data-testid={`deck-${deckName.toLowerCase()}-grid-badge`}
              >
                {t('dj.phase_align_badge_prov')}
              </span>
            )}

            {/* Indicador de estado de Fase / Micro-Slew */}
            {phaseAlignment && phaseAlignment.status !== 'idle' && (
              <span
                className={clsx(
                  'status-badge',
                  'deck-phase-badge',
                  `phase-badge-${phaseAlignment.status}`
                )}
                title={phaseStatusTooltip}
                data-testid={`deck-${deckName.toLowerCase()}-phase-badge`}
              >
                {phaseStatusLabel}
              </span>
            )}

            {/* Indicador explícito de Downbeat Confirmado Manualmente (nunca mostrar sugerencias no confirmadas) */}
            {isDownbeatManuallyConfirmed && (
              <span
                className="status-badge deck-downbeat-badge"
                title={`${t('dj.bar_sync_badge_downbeat_title', 'Downbeat confirmado manualmente')}: ${track?.downbeat?.confirmation?.position.toFixed(3)}s (${meterLabel ?? '?'})`}
                data-testid={`deck-${deckName.toLowerCase()}-downbeat-badge`}
              >
                {t('dj.bar_sync_badge_downbeat', 'DOWNBEAT ✓')} {meterLabel}
              </span>
            )}

            {/* Compás pendiente: sin downbeat + unidad confirmados, BAR SYNC no puede prepararse */}
            {hasTrack && !isMeterConfirmed && (
              <span
                className="status-badge deck-meter-pending-badge deck-tooltip-trigger"
                data-tooltip={meter.downbeatConfirmed ? t('dj.meter_unit_pending_tooltip') : t('dj.meter_pending_tooltip')}
                tabIndex={0}
                role="note"
                data-testid={`deck-${deckName.toLowerCase()}-meter-pending-badge`}
              >
                {meter.downbeatConfirmed ? t('dj.meter_unit_pending') : t('dj.meter_pending')}
              </span>
            )}

            {/* Indicador de estado de BAR SYNC V1 */}
            {barSync && barSync.status !== 'idle' && (
              <span
                className={clsx(
                  'status-badge',
                  'deck-barsync-badge',
                  'deck-tooltip-trigger',
                  `barsync-badge-${barSync.status}`
                )}
                title={barSyncBadgeTooltip}
                data-tooltip={barSyncBadgeTooltip}
                tabIndex={0}
                role="note"
                aria-label={barSyncBadgeTooltip}
                data-testid={`deck-${deckName.toLowerCase()}-barsync-badge`}
              >
                {(barSync.status as string) === 'preparing'
                  ? t('dj.bar_sync_badge_preparing')
                  : barSync.status === 'armed'
                  ? t('dj.bar_sync_badge_armed', { prepared: barSync.preparedPosition?.toFixed(2) ?? '0.00', disp: formatDeltaSeconds(barSync.displacementSec) })
                  : barSync.status === 'already_aligned'
                  ? t('dj.bar_sync_badge_aligned', { prepared: barSync.preparedPosition?.toFixed(2) ?? '0.00', disp: formatDeltaSeconds(barSync.displacementSec) })
                  : barSync.status === 'completed'
                  ? t('dj.bar_sync_badge_completed')
                  : barSync.status === 'cancelled'
                  ? t('dj.bar_sync_badge_cancelled')
                  : t('dj.bar_sync_badge_rejected')}
              </span>
            )}
          </div>
        </div>

        {/* Métricas musicales y estadísticas */}
        <div className="deck-stats">
          <div className="deck-stat-item" data-testid={`deck-${deckName.toLowerCase()}-bpm`}>
            <span className="deck-stat-label">{t('dj.tempo')}</span>
            <span className="deck-stat-value deck-bpm-value">{currentBpm}</span>
          </div>
          <div className="deck-stat-item" data-testid={`deck-${deckName.toLowerCase()}-key`}>
            <span className="deck-stat-label">{t('dj.key_lock')}</span>
            <span className="deck-stat-value deck-key-value">{currentKey}</span>
          </div>
          <div className="deck-stat-item" data-testid={`deck-${deckName.toLowerCase()}-camelot`}>
            <span className="deck-stat-label">{t('dj.camelot')}</span>
            <span className="deck-stat-value deck-camelot-value">
              {currentCamelot ? (
                <span className="track-camelot-badge">{currentCamelot}</span>
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="deck-stat-item" data-testid={`deck-${deckName.toLowerCase()}-energy`}>
            <span className="deck-stat-label">{t('dj.energy')}</span>
            <span className="deck-stat-value deck-energy-value">
              {currentEnergy !== '—' ? `${currentEnergy}/10` : '—'}
            </span>
          </div>
          <div
            className="deck-stat-item deck-stat-time deck-tooltip-trigger"
            data-testid={`deck-${deckName.toLowerCase()}-time`}
            title={timeStatTooltip}
            data-tooltip={timeStatTooltip}
            tabIndex={0}
            role="note"
            aria-label={timeStatTooltip}
          >
            <span className="deck-stat-label">{t('dj.time')}</span>
            <span className="deck-stat-value">{formattedTimeRemaining}</span>
          </div>
        </div>
      </div>

      {/* Waveform y Barra de Progreso Temporal Interactiva */}
      <div 
        className={clsx('deck-waveform-container', duration > 0 && 'waveform-interactive')}
        onClick={handleWaveformClick}
        title={duration > 0 ? t('dj.seek_title') : undefined}
        role="slider"
        aria-label={t('dj.seek_title')}
        aria-valuenow={currentTime}
        aria-valuemin={0}
        aria-valuemax={duration}
        data-testid={`deck-${deckName.toLowerCase()}-waveform`}
      >
        {/* Renderizado de forma de onda real con picos precalculados */}
        <Waveform
          peaks={analysis?.waveformPeaks}
          durationSec={duration}
          peaksDurationSec={analysis?.waveformDurationSec}
          isAnalyzing={isAnalyzing}
        />

        {/* Relleno de progreso transcurrido */}
        {duration > 0 && (
          <div 
            className="deck-waveform-progress" 
            style={{ width: `${progressPercent}%` }}
          ></div>
        )}

        {/* Marcadores de Hot Cues superpuestos en la forma de onda */}
        {duration > 0 && deck.hotCues && deck.hotCues.map((cue) => {
          const cuePercent = Math.min(100, Math.max(0, (cue.position / duration) * 100));
          return (
            <div
              key={cue.id}
              className="deck-waveform-marker-hotcue"
              style={{ left: `${cuePercent}%`, '--marker-color': cue.color } as React.CSSProperties}
              title={`Hot Cue ${cue.id} (${formatDuration(cue.position)})`}
              data-testid={`deck-${deckName.toLowerCase()}-waveform-marker-${cue.id}`}
            >
              <span className="deck-waveform-marker-tag" style={{ backgroundColor: cue.color }}>
                {cue.id}
              </span>
            </div>
          );
        })}

        {/* Marcador del CUE principal en la forma de onda */}
        {duration > 0 && deck.mainCue !== null && (
          <div
            className="deck-waveform-marker-maincue"
            style={{ left: `${Math.min(100, Math.max(0, (deck.mainCue / duration) * 100))}%` }}
            title={`CUE (${formatDuration(deck.mainCue)})`}
            data-testid={`deck-${deckName.toLowerCase()}-waveform-marker-cue`}
          >
            <span className="deck-waveform-marker-cue-tag">C</span>
          </div>
        )}

        {/* Cursor Playhead */}
        <div 
          className="deck-playhead" 
          style={duration > 0 ? { left: `${progressPercent}%` } : undefined}
        ></div>
      </div>

      {/* Banco de 8 Hot Cues */}
      <div
        className="deck-hotcues-section"
        data-testid={`deck-${deckName.toLowerCase()}-hotcues-section`}
      >
        <div className="deck-hotcues-header">
          <span className="deck-hotcues-title">{t('dj.hot_cues')}</span>
          <button
            type="button"
            className={clsx('deck-hotcues-clear-toggle', isDeleteMode && 'active')}
            onClick={() => setIsDeleteMode(!isDeleteMode)}
            disabled={!hasTrack || isLoading || (deck.hotCues?.length ?? 0) === 0}
            title={t('dj.hotcue_clear_title')}
            data-testid={`deck-${deckName.toLowerCase()}-hotcue-clear-btn`}
          >
            {t('dj.hotcue_clear')}
          </button>
        </div>
        <div className="deck-hotcues-grid">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => {
            const cue = deck.hotCues?.find((c) => c.id === slot);
            const isDefined = Boolean(cue);
            const cueColor = cue?.color || HOT_CUE_COLORS[slot - 1];
            return (
              <button
                key={slot}
                type="button"
                className={clsx(
                  'deck-hotcue-pad',
                  isDefined ? 'pad-defined' : 'pad-empty',
                  isDeleteMode && isDefined && 'pad-delete-mode'
                )}
                style={isDefined ? ({ '--pad-color': cueColor } as React.CSSProperties) : undefined}
                onClick={(e) => handleHotCueClick(slot, e)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (isDefined && hasTrack && !isLoading) {
                    deleteHotCue(deckName, slot);
                  }
                }}
                disabled={!hasTrack || isLoading}
                title={
                  isDeleteMode
                    ? t('dj.hotcue_delete', { slot })
                    : isDefined
                      ? `${t('dj.hotcue_jump', { slot })} (${formatDuration(cue!.position)})`
                      : t('dj.hotcue_set', { slot })
                }
                data-testid={`deck-${deckName.toLowerCase()}-hotcue-${slot}`}
                data-defined={isDefined}
              >
                <span className="pad-slot-num">{slot}</span>
                {isDefined && (
                  <span className="pad-cue-time">
                    {formatDuration(cue!.position)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Editor Manual de Downbeat & Compás (Fase 23.4 — Etapa C.8.2) */}
      {hasTrack && (
        <div
          className="deck-downbeat-editor"
          data-testid={`deck-${deckName.toLowerCase()}-downbeat-editor`}
        >
          <div className="deck-downbeat-header">
            <span className="deck-downbeat-title">{t('dj.downbeat_editor_title')}</span>
            <div className="deck-downbeat-status-wrapper">
              <span
                className={clsx(
                  'downbeat-status-badge',
                  isDownbeatManuallyConfirmed
                    ? 'badge-confirmed'
                    : hasSuggested
                    ? 'badge-suggested'
                    : 'badge-none'
                )}
                data-testid={`deck-${deckName.toLowerCase()}-downbeat-status-badge`}
              >
                {isDownbeatManuallyConfirmed
                  ? t('dj.downbeat_badge_confirmed')
                  : hasSuggested
                  ? t('dj.downbeat_badge_suggested')
                  : t('dj.downbeat_badge_none')}
              </span>
              {isDownbeatManuallyConfirmed && track?.downbeat?.confirmation && (
                <span
                  className="downbeat-status-detail"
                  data-testid={`deck-${deckName.toLowerCase()}-downbeat-status-detail`}
                >
                  {track.downbeat.confirmation.position.toFixed(3)}s ({meterLabel ?? '?'})
                </span>
              )}
              {!isDownbeatManuallyConfirmed && hasSuggested && typeof suggestedPos === 'number' && (
                <span
                  className="downbeat-status-detail"
                  data-testid={`deck-${deckName.toLowerCase()}-downbeat-status-detail`}
                >
                  {suggestedPos.toFixed(3)}s
                </span>
              )}
            </div>
          </div>

          <div className="deck-downbeat-controls-row">
            <div className="deck-downbeat-input-group">
              <label htmlFor={`deck-${deckName.toLowerCase()}-downbeat-input`}>
                {t('dj.downbeat_pos_label')}
              </label>
              <input
                id={`deck-${deckName.toLowerCase()}-downbeat-input`}
                type="number"
                step="0.001"
                min="0"
                max={duration > 0 ? duration : undefined}
                value={editDownbeatPos}
                onChange={(e) => {
                  setEditDownbeatPos(e.target.value);
                  setSelectedSource(null);
                }}
                disabled={!hasTrack || isLoading || isSavingDownbeat}
                className="deck-downbeat-input"
                data-testid={`deck-${deckName.toLowerCase()}-downbeat-pos-input`}
              />
            </div>

            <button
              type="button"
              className={clsx(
                'btn-downbeat-action',
                'btn-downbeat-source',
                selectedSource === 'playhead' && 'selected'
              )}
              onClick={handleCapturePlayhead}
              disabled={!hasTrack || isLoading || isSavingDownbeat}
              aria-pressed={selectedSource === 'playhead'}
              title={t('dj.downbeat_btn_capture_tooltip')}
              data-testid={`deck-${deckName.toLowerCase()}-downbeat-capture-btn`}
              data-selected={selectedSource === 'playhead'}
            >
              {selectedSource === 'playhead' && (
                <span className="source-indicator-dot" aria-hidden="true" />
              )}
              {t('dj.downbeat_btn_capture')}
            </button>

            <button
              type="button"
              className={clsx(
                'btn-downbeat-action',
                'btn-downbeat-source',
                selectedSource === 'suggested' && 'selected'
              )}
              onClick={handleUseSuggested}
              disabled={!hasTrack || isLoading || isSavingDownbeat || !hasSuggested}
              aria-pressed={selectedSource === 'suggested'}
              title={t('dj.downbeat_btn_use_suggested_tooltip')}
              data-testid={`deck-${deckName.toLowerCase()}-downbeat-suggested-btn`}
              data-selected={selectedSource === 'suggested'}
            >
              {selectedSource === 'suggested' && (
                <span className="source-indicator-dot" aria-hidden="true" />
              )}
              {t('dj.downbeat_btn_use_suggested')}
            </button>

            <div className="deck-downbeat-input-group">
              <label htmlFor={`deck-${deckName.toLowerCase()}-downbeat-metric-select`}>
                {t('dj.downbeat_metric_label')}
              </label>
              <select
                id={`deck-${deckName.toLowerCase()}-downbeat-metric-select`}
                value={`${editBeatsPerBar}/${editBeatUnit}`}
                onChange={(e) => {
                  const [beats, unit] = e.target.value.split('/').map(Number);
                  setEditBeatsPerBar(beats);
                  setEditBeatUnit(unit as BeatUnit);
                }}
                disabled={!hasTrack || isLoading || isSavingDownbeat}
                className="deck-downbeat-select"
                title={t('dj.downbeat_metric_tooltip')}
                data-testid={`deck-${deckName.toLowerCase()}-downbeat-metric-select`}
              >
                {METER_OPTIONS.map(([beats, unit]) => (
                  <option key={`${beats}/${unit}`} value={`${beats}/${unit}`}>{beats}/{unit}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn-downbeat-action btn-downbeat-confirm"
              onClick={handleConfirmDownbeat}
              disabled={!hasTrack || isLoading || isSavingDownbeat || !hasValidHash}
              title={!hasValidHash ? t('dj.downbeat_btn_confirm_disabled_hash') : t('dj.downbeat_btn_confirm_tooltip')}
              data-testid={`deck-${deckName.toLowerCase()}-downbeat-confirm-btn`}
            >
              {t('dj.downbeat_btn_confirm')}
            </button>

            <button
              type="button"
              className="btn-downbeat-action btn-downbeat-clear"
              onClick={handleClearDownbeat}
              disabled={!hasTrack || isLoading || isSavingDownbeat || !isDownbeatManuallyConfirmed}
              title={t('dj.downbeat_btn_clear_tooltip')}
              data-testid={`deck-${deckName.toLowerCase()}-downbeat-clear-btn`}
            >
              {t('dj.downbeat_btn_clear')}
            </button>
          </div>

          {meter.downbeatConfirmed && meter.beatUnit === null && (
            <div
              className="downbeat-hash-warning"
              role="note"
              data-testid={`deck-${deckName.toLowerCase()}-downbeat-unit-warning`}
            >
              {t('dj.meter_unit_pending_tooltip')}
            </div>
          )}

          {!hasValidHash && (
            <div
              className="downbeat-hash-warning"
              data-testid={`deck-${deckName.toLowerCase()}-downbeat-hash-warning`}
            >
              {t('dj.downbeat_missing_hash_explanation')}
            </div>
          )}

          {downbeatError && (
            <div
              className="downbeat-error-msg"
              data-testid={`deck-${deckName.toLowerCase()}-downbeat-error`}
            >
              {downbeatError}
            </div>
          )}
        </div>
      )}

      {/* Main Deck Controls */}
      <div className="deck-controls">
        
        {/* Transport buttons */}
        <div className="deck-transport">
          <button 
            type="button"
            className={clsx(
              'btn btn-dj btn-dj-sync',
              isSyncActive && 'sync-active',
              isMaster && 'sync-master'
            )}
            onClick={handleSyncToggle}
            disabled={!hasTrack || isLoading}
            aria-pressed={isSyncActive}
            title={
              isMaster
                ? t('dj.sync_master_tooltip')
                : isSyncActive
                ? t('dj.sync_active_tooltip_detail', { master: otherDeckName, bpm: masterBpmLabel, pitch: pitchPercentLabel, limit: syncLimitPercent })
                : t('dj.sync_tooltip', { limit: syncLimitPercent })
            }
            data-testid={`deck-${deckName.toLowerCase()}-sync`}
          >
            {isMaster ? t('dj.master') : isSyncActive ? t('dj.sync_on') : t('dj.sync')}
          </button>
          <button
            type="button"
            className={clsx(
              'btn btn-dj btn-dj-align',
              isPhaseActive && 'align-active',
              phaseAlignment?.status === 'completed' && 'align-completed',
              phaseAlignment?.status?.startsWith('rejected_') && 'align-rejected'
            )}
            onClick={handlePhaseAlign}
            disabled={!hasTrack || isLoading || !isPlaying}
            title={
              phaseAlignment?.status === 'rejected_limits'
                ? t('dj.phase_align_rejected_limits')
                : phaseAlignment?.status === 'rejected_confidence'
                ? t('dj.phase_align_rejected_confidence')
                : phaseAlignment?.status === 'already_aligned'
                ? t('dj.phase_align_already_aligned')
                : phaseAlignment?.status === 'rejected_state'
                ? t('dj.phase_align_rejected_state')
                : phaseAlignment?.status === 'cancelled'
                ? t('dj.phase_align_cancelled')
                : phaseAlignment?.status === 'completed'
                ? (t('dj.phase_align_completed_tooltip') || t('dj.phase_align_completed'))
                : t('dj.phase_align_tooltip')
            }
            data-testid={`deck-${deckName.toLowerCase()}-align`}
          >
            {isPhaseActive
              ? `${Math.round(phaseAlignment?.progressPercent || 0)}%`
              : t('dj.phase_align')}
          </button>
          <button
            type="button"
            className={clsx(
              'btn btn-dj btn-dj-barsync',
              (isPreparingBarSync || (barSyncStatus as string) === 'preparing') && 'barsync-preparing',
              isBarSyncArmed && 'barsync-armed',
              isBarSyncAligned && 'barsync-aligned',
              barSyncStatus === 'completed' && 'barsync-completed',
              barSyncStatus?.startsWith('rejected_') && 'barsync-rejected',
              barSyncStatus === 'cancelled' && 'barsync-cancelled'
            )}
            onClick={handleBarSync}
            disabled={!hasTrack || isLoading || isPreparingBarSync}
            title={
              isPreparingBarSync || (barSyncStatus as string) === 'preparing'
                ? t('dj.bar_sync_preparing')
                : isBarSyncArmed
                ? t('dj.bar_sync_armed_btn_tooltip', {
                    prepared: barSync?.preparedPosition?.toFixed(3) ?? '0.000',
                    prev: barSync?.previousPosition?.toFixed(3) ?? '0.000',
                    disp: formatDeltaSigned(barSync?.displacementSec),
                    beats: barSync?.beatsPerBar ?? 4,
                  })
                : isBarSyncAligned
                ? t('dj.bar_sync_aligned_btn_tooltip', {
                    prepared: barSync?.preparedPosition?.toFixed(3) ?? '0.000',
                    prev: barSync?.previousPosition?.toFixed(3) ?? '0.000',
                    disp: formatDeltaSigned(barSync?.displacementSec),
                    beats: barSync?.beatsPerBar ?? 4,
                  })
                : barSyncStatus === 'completed'
                ? t('dj.bar_sync_completed_tooltip')
                : barSyncStatus === 'cancelled'
                ? t('dj.bar_sync_cancelled_tooltip')
                : barSyncStatus?.startsWith('rejected_')
                ? t(barSyncReasonKey)
                : barSyncBlockMessage
                ? `${t('dj.bar_sync_tooltip')} — ${barSyncBlockMessage}`
                : t('dj.bar_sync_tooltip')
            }
            aria-describedby={barSyncBlockMessage || barSyncStatus.startsWith('rejected_') ? `deck-${deckName.toLowerCase()}-barsync-hint` : undefined}
            aria-label={t('dj.bar_sync')}
            data-testid={`deck-${deckName.toLowerCase()}-barsync`}
          >
            {isPreparingBarSync || (barSyncStatus as string) === 'preparing'
              ? t('dj.bar_sync_preparing')
              : isBarSyncArmed
              ? t('dj.bar_sync_armed')
              : isBarSyncAligned
              ? t('dj.bar_sync_already_aligned')
              : barSyncStatus === 'completed'
              ? t('dj.bar_sync_completed')
              : barSyncStatus?.startsWith('rejected_')
              ? t('dj.bar_sync_rejected')
              : t('dj.bar_sync')}
          </button>
          <button 
            type="button"
            className="btn btn-dj btn-dj-cue"
            onPointerDown={handleCueButtonDown}
            onPointerUp={releaseCue}
            onPointerCancel={releaseCue}
            onPointerLeave={releaseCue}
            onMouseUp={releaseCue}
            onMouseLeave={releaseCue}
            onTouchEnd={releaseCue}
            onTouchCancel={releaseCue}
            onKeyDown={handleCueKeyDown}
            onKeyUp={handleCueKeyUp}
            onBlur={() => {
              if (isCuePressedRef.current) {
                isCuePressedRef.current = false;
                cancelCup(deckName);
              }
            }}
            title={t('dj.cue_pro_title')}
            aria-label={t('dj.cue')}
            disabled={!hasTrack || isLoading}
            data-testid={`deck-${deckName.toLowerCase()}-cue`}
          >
            {t('dj.cue')}
          </button>
          <button 
            type="button"
            className={clsx('btn btn-dj', isPlaying ? 'btn-dj-play' : 'btn-outline')}
            onClick={handlePlayToggle}
            disabled={!hasTrack || isLoading}
            data-testid={`deck-${deckName.toLowerCase()}-play`}
          >
            {isLoading ? '...' : (isPlaying ? t('dj.pause') : t('dj.play'))}
          </button>
        </div>

        {/* Jog Wheel */}
        <div className="deck-jog-wheel-container">
          <div className={clsx('deck-jog-wheel', isPlaying && 'playing-anim-spin')}>
            <div className="deck-jog-wheel-inner">
              <span className="deck-jog-wheel-text">
                {deckName}
              </span>
            </div>
            <div className="deck-jog-marker"></div>
          </div>
        </div>

        {/* Pitch Controls: Slider + Pitch Bend Buttons */}
        <div className="deck-pitch-controls-container">
          <div className="deck-pitch-slider">
            <span className="deck-pitch-label top">-{pitchRangePercent}%</span>
            <div className="deck-pitch-slider-wrapper">
              <Slider
                orientation="vertical"
                value={currentPitch}
                onChange={handlePitchChange}
                disabled={!hasTrack || isLoading}
              />
            </div>
            <span className="deck-pitch-label bottom">+{pitchRangePercent}%</span>
          </div>

          <div
            className="deck-pitch-bend-controls"
            role="group"
            aria-label={t('dj.pitch_bend_label')}
          >
            <button
              type="button"
              className={clsx(
                'btn-pitch-bend',
                'btn-pitch-bend-down',
                deck.pitchBend < 0 && 'btn-pitch-bend-active'
              )}
              onPointerDown={() => handlePitchBendDown('down')}
              onPointerUp={handlePitchBendRelease}
              onPointerLeave={handlePitchBendRelease}
              onPointerCancel={handlePitchBendRelease}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handlePitchBendDown('down');
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handlePitchBendRelease();
                }
              }}
              disabled={!hasTrack || isLoading}
              title={t('dj.pitch_bend_down_tooltip')}
              aria-label={t('dj.pitch_bend_down')}
              data-testid={`deck-${deckName.toLowerCase()}-pitchbend-down`}
            >
              −
            </button>
            <button
              type="button"
              className={clsx(
                'btn-pitch-bend',
                'btn-pitch-bend-up',
                deck.pitchBend > 0 && 'btn-pitch-bend-active'
              )}
              onPointerDown={() => handlePitchBendDown('up')}
              onPointerUp={handlePitchBendRelease}
              onPointerLeave={handlePitchBendRelease}
              onPointerCancel={handlePitchBendRelease}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handlePitchBendDown('up');
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handlePitchBendRelease();
                }
              }}
              disabled={!hasTrack || isLoading}
              title={t('dj.pitch_bend_up_tooltip')}
              aria-label={t('dj.pitch_bend_up')}
              data-testid={`deck-${deckName.toLowerCase()}-pitchbend-up`}
            >
              +
            </button>
          </div>
        </div>

      </div>

      {/* Feedback rítmico visible: por qué BAR SYNC no puede prepararse o por qué se rechazó */}
      {hasTrack && (barSyncBlockMessage || barSyncStatus.startsWith('rejected_')) && (
        <p
          id={`deck-${deckName.toLowerCase()}-barsync-hint`}
          className={clsx('deck-sync-hint', barSyncStatus.startsWith('rejected_') && 'deck-sync-hint-rejected')}
          role={barSyncStatus.startsWith('rejected_') ? 'alert' : 'note'}
          data-testid={`deck-${deckName.toLowerCase()}-barsync-hint`}
        >
          <strong>{t('dj.bar_sync')}:</strong>{' '}
          {barSyncStatus.startsWith('rejected_') ? t(barSyncReasonKey) : barSyncBlockMessage}
        </p>
      )}


    </div>
  );
};
