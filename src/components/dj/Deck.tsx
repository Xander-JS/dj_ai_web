import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '../ui/Slider';
import { clsx } from 'clsx';
import { useDJStore, HOT_CUE_COLORS } from '../../store/useDJStore';
import { formatDuration } from '../../utils/formatters';
import type { AnalysisStatus } from '../../types/track';
import './Deck.css';

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
  const { 
    deckA, 
    deckB, 
    syncMasterDeck,
    toggleSync,
    alignPhase,
    cancelPhaseAlignment,
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
  const isCuePressedRef = useRef(false);

  const handlePitchBendDown = (direction: 'up' | 'down') => {
    pitchBend(deckName, direction);
  };

  const handlePitchBendRelease = () => {
    pitchBend(deckName, 'release');
  };

  const deck = deckName === 'A' ? deckA : deckB;
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

  // 4.2 Estado del análisis:
  const analysisStatus: AnalysisStatus | null = analysis?.status || (hasTrack ? 'pending' : null);
  const isAnalyzing = analysisStatus === 'analyzing' || isTriggeringAnalysis;
  const canTriggerAnalysis = hasTrack && !isAnalyzing && (analysisStatus === 'pending' || analysisStatus === 'failed');

  // Cancelar reproducción CUP ante pérdida de foco de la ventana o desmontaje
  useEffect(() => {
    const handleWindowBlur = () => {
      if (isCuePressedRef.current) {
        isCuePressedRef.current = false;
        cancelCup(deckName);
      }
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('blur', handleWindowBlur);
      cancelCup(deckName);
    };
  }, [deckName, cancelCup]);

  const handlePlayToggle = async () => {
    if (!hasTrack || isLoading) return;
    await togglePlayDeck(deckName);
  };

  const handleCueButtonDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!hasTrack || isLoading) return;
    isCuePressedRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignorar si el navegador no soporta pointer capture
    }
    handleCueDown(deckName);
  };

  const handleCueButtonUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!hasTrack || isLoading) return;
    if (isCuePressedRef.current) {
      isCuePressedRef.current = false;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignorar
      }
      handleCueUp(deckName);
    }
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
    if (!hasTrack || isLoading) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      if (isCuePressedRef.current) {
        isCuePressedRef.current = false;
        handleCueUp(deckName);
      }
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
      await analyzeTrack(track, analysisStatus === 'failed');
    } catch (err) {
      console.error(`[Deck ${deckName}] Error solicitando análisis musical:`, err);
    } finally {
      setIsTriggeringAnalysis(false);
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
          </div>

          <div className="deck-subtitle-row">
            <span className="deck-track-artist">
              {isError && deck.errorMessage ? (
                <span className="deck-error-badge" title={deck.errorMessage}>
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
                title="Beatgrid provisional basado en primer transitorio detectado (no representa compás o downbeat garantizado)"
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
                title={phaseAlignment.reason || undefined}
                data-testid={`deck-${deckName.toLowerCase()}-phase-badge`}
              >
                {phaseAlignment.status === 'active'
                  ? `${t('dj.phase_align_active')} (${Math.round(phaseAlignment.progressPercent)}%)`
                  : phaseAlignment.status === 'completed'
                  ? t('dj.phase_align_completed')
                  : phaseAlignment.status === 'cancelled'
                  ? t('dj.phase_align_cancelled')
                  : phaseAlignment.status === 'rejected_limits'
                  ? t('dj.phase_align_rejected_limits')
                  : phaseAlignment.status === 'rejected_confidence'
                  ? t('dj.phase_align_rejected_confidence')
                  : phaseAlignment.status === 'already_aligned'
                  ? t('dj.phase_align_already_aligned')
                  : phaseAlignment.status === 'rejected_state'
                  ? (phaseAlignment.reason || 'Rechazado')
                  : phaseAlignment.status}
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
          <div className="deck-stat-item">
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
        <svg
          className={clsx('deck-waveform-svg', isAnalyzing && 'waveform-analyzing')}
          viewBox="0 0 100 60"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line x1="0" y1="30" x2="100" y2="30" className="deck-waveform-baseline" />
          {analysis?.waveformPeaks && analysis.waveformPeaks.length > 0 && (
            analysis.waveformPeaks.map((peak, idx) => {
              const clampedPeak = Math.max(0, Math.min(1, peak));
              const barHeight = Math.max(2, clampedPeak * 54);
              const y = (60 - barHeight) / 2;
              return (
                <rect
                  key={idx}
                  x={idx}
                  y={y}
                  width={0.75}
                  height={barHeight}
                  rx={0.3}
                  className="deck-waveform-bar"
                />
              );
            })
          )}
        </svg>

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
            title={
              isMaster
                ? t('dj.sync_master_tooltip')
                : isSyncActive
                ? t('dj.sync_active_tooltip')
                : t('dj.sync')
            }
            data-testid={`deck-${deckName.toLowerCase()}-sync`}
          >
            {isMaster ? 'MASTER' : t('dj.sync')}
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
                ? (phaseAlignment.reason || t('dj.phase_align_tooltip'))
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
            className="btn btn-dj btn-dj-cue"
            onPointerDown={handleCueButtonDown}
            onPointerUp={handleCueButtonUp}
            onPointerCancel={() => handleCueUp(deckName)}
            onKeyDown={handleCueKeyDown}
            onKeyUp={handleCueKeyUp}
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
            <span className="deck-pitch-label top">-8%</span>
            <div className="deck-pitch-slider-wrapper">
              <Slider
                orientation="vertical"
                value={currentPitch}
                onChange={handlePitchChange}
                disabled={!hasTrack || isLoading}
              />
            </div>
            <span className="deck-pitch-label bottom">+8%</span>
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


    </div>
  );
};
