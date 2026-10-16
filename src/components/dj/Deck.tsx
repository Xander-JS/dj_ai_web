import React from 'react';
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
  const { 
    deckA, 
    deckB, 
    togglePlayDeck, 
    stopDeck, 
    seekDeck, 
    setPitchDeck 
  } = useDJStore();

  const deck = deckName === 'A' ? deckA : deckB;

  const isPlaying = deck.playbackState === 'playing';
  const isLoading = deck.playbackState === 'loading';
  const hasTrack = Boolean(deck.track);
  const isError = deck.playbackState === 'error';

  const finalTitle = deck.track?.title || trackTitle || t('dj.no_track');
  const finalArtist = deck.track 
    ? (deck.track.artist || t('dj.unknown_artist')) 
    : (trackArtist || (trackTitle ? t('dj.unknown_artist') : ''));

  const currentPitch = deck.pitch;

  const currentBpm = deck.calculatedBpm !== null 
    ? deck.calculatedBpm.toFixed(1) 
    : (deck.track ? '—' : bpm.toFixed(1));

  const currentKey = deck.keyStr || (deck.track ? '—' : keyStr);

  const duration = deck.duration;
  const currentTime = deck.currentTime;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const formattedTimeRemaining = duration > 0 
    ? `-${formatDuration(Math.max(0, duration - currentTime))}` 
    : timeRemaining;

  const handlePlayToggle = async () => {
    if (!deck.track || isLoading) return;
    await togglePlayDeck(deckName);
  };

  const handleStopOrCue = () => {
    if (!hasTrack || isLoading) return;
    stopDeck(deckName);
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

  return (
    <div className={clsx('dj-deck', 'deck-real', `deck-${deckName.toLowerCase()}`, isError && 'deck-has-error')}>
      
      {/* Header Info */}
      <div className="deck-header">
        <div className="deck-title-group">
          <span className="deck-track-title">{finalTitle}</span>
          <span className="deck-track-artist">
            {isError && deck.errorMessage ? (
              <span className="deck-error-badge" title={deck.errorMessage}>
                {deck.errorMessage}
              </span>
            ) : (
              finalArtist
            )}
          </span>
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
        className={clsx('deck-waveform-container', duration > 0 && 'waveform-interactive')}
        onClick={handleWaveformClick}
        title={duration > 0 ? t('dj.seek_title') : undefined}
      >
        <div className={clsx('deck-waveform-mock', isPlaying && 'playing-anim-wave')}></div>
        
        {/* Relleno de progreso transcurrido */}
        {duration > 0 && (
          <div 
            className="deck-waveform-progress" 
            style={{ width: `${progressPercent}%` }}
          ></div>
        )}

        <div 
          className="deck-playhead" 
          style={duration > 0 ? { left: `${progressPercent}%` } : undefined}
        ></div>
      </div>

      {/* Main Deck Controls */}
      <div className="deck-controls">
        
        {/* Transport buttons */}
        <div className="deck-transport">
          <button 
            className="btn btn-dj btn-dj-sync"
            title="Función SYNC (En desarrollo)"
            disabled
          >
            {t('dj.sync')}
          </button>
          <button 
            className="btn btn-dj btn-dj-cue"
            onClick={handleStopOrCue}
            title={t('dj.cue_stop_title')}
            disabled={!hasTrack || isLoading}
          >
            {t('dj.cue_stop')}
          </button>
          <button 
            className={clsx('btn btn-dj', isPlaying ? 'btn-dj-play' : 'btn-outline')}
            onClick={handlePlayToggle}
            disabled={!hasTrack || isLoading}
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
              disabled={!hasTrack || isLoading}
            />
          </div>
          <span className="deck-pitch-label bottom">+8%</span>
        </div>

      </div>

    </div>
  );
};
