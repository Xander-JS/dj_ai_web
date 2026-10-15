import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '../ui/Slider';
import { clsx } from 'clsx';
import { useDJStore } from '../../store/useDJStore';
import { formatDuration } from '../../utils/formatters';
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
  bpm = 120.0,
  keyStr = 'Am',
  timeRemaining = '-0:00'
}) => {
  const { t } = useTranslation();
  const { deckA, togglePlayDeckA, stopDeckA, seekDeckA, setPitchDeckA } = useDJStore();

  // Estado mock local exclusivo para Deck B (hasta la Fase 21)
  const [mockPlayingB, setMockPlayingB] = useState(false);
  const [mockPitchB, setMockPitchB] = useState(50);

  const isDeckA = deckName === 'A';

  // Variables calculadas según sea Deck A (Real) o Deck B (Mock)
  const isPlaying = isDeckA ? (deckA.playbackState === 'playing') : mockPlayingB;
  const isLoading = isDeckA && deckA.playbackState === 'loading';
  const hasTrack = isDeckA ? Boolean(deckA.track) : true;

  const finalTitle = isDeckA 
    ? (deckA.track?.title || t('dj.no_track')) 
    : (trackTitle || t('dj.no_track'));

  const finalArtist = isDeckA 
    ? (deckA.track ? (deckA.track.artist || t('dj.unknown_artist')) : '') 
    : (trackArtist || t('dj.unknown_artist'));

  const currentPitch = isDeckA ? deckA.pitch : mockPitchB;

  const currentBpm = isDeckA 
    ? (deckA.calculatedBpm !== null ? deckA.calculatedBpm.toFixed(1) : '—')
    : (bpm * (1 + (mockPitchB - 50) / 100 * 0.16)).toFixed(1);

  const currentKey = isDeckA ? (deckA.keyStr || '—') : keyStr;

  // Cálculo de tiempo real para Deck A
  const duration = isDeckA ? deckA.duration : 0;
  const currentTime = isDeckA ? deckA.currentTime : 0;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const formattedTimeRemaining = isDeckA
    ? (duration > 0 ? `-${formatDuration(Math.max(0, duration - currentTime))}` : '-0:00')
    : timeRemaining;

  const handlePlayToggle = async () => {
    if (isDeckA) {
      if (!deckA.track) return;
      await togglePlayDeckA();
    } else {
      setMockPlayingB(!mockPlayingB);
    }
  };

  const handleStopOrCue = () => {
    if (isDeckA) {
      stopDeckA();
    } else {
      setMockPlayingB(false);
    }
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDeckA && duration > 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, clickX / rect.width));
      seekDeckA(percent * duration);
    }
  };

  const handlePitchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (isDeckA) {
      setPitchDeckA(val);
    } else {
      setMockPitchB(val);
    }
  };

  return (
    <div className={clsx('dj-deck', isDeckA && 'deck-real')}>
      
      {/* Header Info */}
      <div className="deck-header">
        <div className="deck-title-group">
          <span className="deck-track-title">{finalTitle}</span>
          <span className="deck-track-artist">{finalArtist}</span>
        </div>
        <div className="deck-stats">
          <div className="deck-stat-item">
            <span className="deck-stat-label">{t('dj.tempo')}</span>
            <span>{currentBpm}</span>
          </div>
          <div className="deck-stat-item">
            <span className="deck-stat-label">{t('dj.key_lock')}</span>
            <span className="deck-key-str">{currentKey}</span>
          </div>
          <div className="deck-stat-item">
            <span className="deck-stat-label">{t('dj.time')}</span>
            <span>{formattedTimeRemaining}</span>
          </div>
        </div>
      </div>

      {/* Waveform y Barra de Progreso Temporal Interactiva */}
      <div 
        className={clsx('deck-waveform-container', isDeckA && 'waveform-interactive')}
        onClick={handleWaveformClick}
        title={isDeckA && duration > 0 ? 'Haz clic para buscar posición (Seek)' : undefined}
      >
        <div className={clsx('deck-waveform-mock', isPlaying && 'playing-anim-wave')}></div>
        
        {/* Relleno de progreso transcurrido */}
        {isDeckA && (
          <div 
            className="deck-waveform-progress" 
            style={{ width: `${progressPercent}%` }}
          ></div>
        )}

        <div 
          className="deck-playhead" 
          style={isDeckA ? { left: `${progressPercent}%` } : undefined}
        ></div>
      </div>

      {/* Main Deck Controls */}
      <div className="deck-controls">
        
        {/* Transport buttons */}
        <div className="deck-transport">
          <button 
            className="btn btn-dj btn-dj-sync"
            title="Función SYNC (En desarrollo para Fase 23)"
            disabled
          >
            {t('dj.sync')}
          </button>
          <button 
            className="btn btn-dj btn-dj-cue"
            onClick={handleStopOrCue}
            title={isDeckA ? 'Detener y rebobinar al inicio (0:00)' : t('dj.cue')}
            disabled={isDeckA && !hasTrack}
          >
            {isDeckA ? 'CUE / STOP' : t('dj.cue')}
          </button>
          <button 
            className={clsx('btn btn-dj', isPlaying ? 'btn-dj-play' : 'btn-outline')}
            onClick={handlePlayToggle}
            disabled={isDeckA && (!hasTrack || isLoading)}
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

        {/* Pitch Slider */}
        <div className="deck-pitch-slider">
          <span className="deck-pitch-label top">-8%</span>
          <div className="deck-pitch-slider-wrapper">
            <Slider 
              orientation="vertical" 
              value={currentPitch} 
              onChange={handlePitchChange}
              disabled={isDeckA && !hasTrack}
            />
          </div>
          <span className="deck-pitch-label bottom">+8%</span>
        </div>

      </div>

    </div>
  );
};
