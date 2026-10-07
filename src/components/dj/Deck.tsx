import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '../ui/Slider';
import { clsx } from 'clsx';
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [pitch, setPitch] = useState(50); // 0-100, 50 is center

  const finalTitle = trackTitle || t('dj.no_track');
  const finalArtist = trackArtist || t('dj.unknown_artist');

  const calculatedBpm = (bpm * (1 + (pitch - 50) / 100 * 0.16)).toFixed(1); // +/- 8% pitch

  return (
    <div className="dj-deck">
      
      {/* Header Info */}
      <div className="deck-header">
        <div className="deck-title-group">
          <span className="deck-track-title">{finalTitle}</span>
          <span className="deck-track-artist">{finalArtist}</span>
        </div>
        <div className="deck-stats">
          <div className="deck-stat-item">
            <span className="deck-stat-label">{t('dj.tempo')}</span>
            <span>{calculatedBpm}</span>
          </div>
          <div className="deck-stat-item">
            <span className="deck-stat-label">{t('dj.key_lock')}</span>
            <span className="deck-key-str">{keyStr}</span>
          </div>
          <div className="deck-stat-item">
            <span className="deck-stat-label">{t('dj.time')}</span>
            <span>{timeRemaining}</span>
          </div>
        </div>
      </div>

      {/* Waveform Placeholder */}
      <div className="deck-waveform-container">
        <div className={clsx("deck-waveform-mock", isPlaying && "playing-anim-wave")}></div>
        <div className="deck-playhead"></div>
      </div>

      {/* Main Deck Controls */}
      <div className="deck-controls">
        
        {/* Transport buttons */}
        <div className="deck-transport">
          <button 
            className="btn btn-dj btn-dj-sync"
          >
            {t('dj.sync')}
          </button>
          <button 
            className="btn btn-dj btn-dj-cue"
          >
            {t('dj.cue')}
          </button>
          <button 
            className={clsx('btn btn-dj', isPlaying ? 'btn-dj-play' : 'btn-outline')}
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? t('dj.pause') : t('dj.play')}
          </button>
        </div>

        {/* Jog Wheel */}
        <div className="deck-jog-wheel-container">
          <div className={clsx("deck-jog-wheel", isPlaying && "playing-anim-spin")}>
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
              value={pitch} 
              onChange={(e) => setPitch(Number(e.target.value))} 
            />
          </div>
          <span className="deck-pitch-label bottom">+8%</span>
        </div>

      </div>

      {/* CSS Animations directly in a style tag for simplicity of the mockup */}
      <style>{`
        @keyframes spin { 100% { transform: rotate(360deg); } }
        @keyframes moveWave { 100% { background-position: 100px 0; } }
      `}</style>
    </div>
  );
};
