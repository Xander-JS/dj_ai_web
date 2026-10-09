import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Play, Pause, SkipBack, SkipForward, 
  Volume2, VolumeX, Shuffle, Repeat, ListMusic, Heart 
} from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Slider } from '../components/ui/Slider';
import { clsx } from 'clsx';
import './PlayerBar.css';

export const PlayerBar: React.FC = () => {
  const { t } = useTranslation();
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  
  // Simulated playback progress
  const [progress, setProgress] = useState(35); // 0-100%

  const togglePlay = () => setIsPlaying(!isPlaying);
  const toggleMute = () => setIsMuted(!isMuted);

  return (
    <footer className="layout-player">
      <div className="player-bar-container">
        
        {/* Track Info */}
        <div className="player-track-info">
          <div className="player-cover"></div>
          <div className="player-text-info">
            <div className="player-title">Strobe (Club Edit)</div>
            <div className="player-artist">deadmau5</div>
          </div>
          <IconButton 
            icon={<Heart size={16} className={clsx('player-heart-icon', isLiked && 'liked')} />} 
            size="sm" 
            onClick={() => setIsLiked(!isLiked)}
          />
        </div>

        {/* Main Controls & Progress */}
        <div className="player-main-controls">
          <div className="player-buttons">
            <IconButton 
              icon={<Shuffle size={18} />} 
              title={t('player.shuffle')}
              className={clsx('player-btn player-btn-subtle', isShuffle && 'active')}
              onClick={() => setIsShuffle(!isShuffle)}
            />
            <IconButton 
              icon={<SkipBack size={20} />} 
              title={t('player.prev')} 
              className="player-btn"
            />
            
            <button 
              className="player-play-btn" 
              onClick={togglePlay}
              title={isPlaying ? t('player.pause') : t('player.play')}
            >
              {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="play-icon-offset" />}
            </button>
            
            <IconButton 
              icon={<SkipForward size={20} />} 
              title={t('player.next')} 
              className="player-btn"
            />
            <IconButton 
              icon={<Repeat size={18} />} 
              title={t('player.repeat')}
              className={clsx('player-btn player-btn-subtle', isRepeat && 'active')}
              onClick={() => setIsRepeat(!isRepeat)}
            />
          </div>

          <div className="player-timeline">
            <span className="player-time left">2:11</span>
            <div className="player-timeline-slider-container">
              <Slider 
                value={progress} 
                onChange={(e) => setProgress(Number(e.target.value))}
              />
            </div>
            <span className="player-time">6:15</span>
          </div>
        </div>

        {/* Extra Controls */}
        <div className="player-extra-controls">
          <IconButton 
            icon={<ListMusic size={18} />} 
            title={t('player.queue')} 
            className="player-btn player-btn-subtle"
          />
          <div className="player-volume-container">
            <IconButton 
              icon={isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />} 
              size="sm" 
              className="player-btn player-btn-subtle"
              onClick={toggleMute}
              title={t('player.volume')}
            />
            <Slider 
              value={isMuted ? 0 : volume} 
              onChange={(e) => {
                setVolume(Number(e.target.value));
                if (isMuted) setIsMuted(false);
              }}
            />
          </div>
        </div>

      </div>
    </footer>
  );
};
