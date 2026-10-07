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
  trackTitle = 'No Track Loaded', 
  trackArtist = 'Unknown',
  bpm = 120.0,
  keyStr = 'Am',
  timeRemaining = '-0:00'
}) => {
  const { t } = useTranslation();
  const [isPlaying, setIsPlaying] = useState(false);
  const [pitch, setPitch] = useState(50); // 0-100, 50 is center

  const calculatedBpm = (bpm * (1 + (pitch - 50) / 100 * 0.16)).toFixed(1); // +/- 8% pitch

  return (
    <div className="dj-deck">
      
      {/* Header Info */}
      <div className="deck-header">
        <div className="deck-title-group">
          <span className="deck-track-title">{trackTitle}</span>
          <span className="deck-track-artist">{trackArtist}</span>
        </div>
        <div className="deck-stats">
          <div className="deck-stat-item">
            <span className="deck-stat-label">{t('dj.tempo')}</span>
            <span>{calculatedBpm}</span>
          </div>
          <div className="deck-stat-item">
            <span className="deck-stat-label">{t('dj.key_lock')}</span>
            <span style={{ color: 'var(--color-primary-500)' }}>{keyStr}</span>
          </div>
          <div className="deck-stat-item">
            <span className="deck-stat-label">TIME</span>
            <span>{timeRemaining}</span>
          </div>
        </div>
      </div>

      {/* Waveform Placeholder */}
      <div className="deck-waveform-container">
        <div className="deck-waveform-mock" style={{ animation: isPlaying ? 'moveWave 2s linear infinite' : 'none' }}></div>
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
            {isPlaying ? 'PAUSE' : t('dj.play')}
          </button>
        </div>

        {/* Jog Wheel */}
        <div className="deck-jog-wheel-container">
          <div className="deck-jog-wheel" style={{ animation: isPlaying ? 'spin 1.8s linear infinite' : 'none' }}>
            <div className="deck-jog-wheel-inner">
              <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--border-strong)' }}>
                {deckName}
              </span>
            </div>
            <div className="deck-jog-marker"></div>
          </div>
        </div>

        {/* Pitch Slider */}
        <div className="deck-pitch-slider">
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>-8%</span>
          <div style={{ flex: 1, padding: 'var(--space-2) 0' }}>
            <Slider 
              orientation="vertical" 
              value={pitch} 
              onChange={(e) => setPitch(Number(e.target.value))} 
            />
          </div>
          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>+8%</span>
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
