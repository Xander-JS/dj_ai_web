import React from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Play, Pause, SkipBack, SkipForward, 
  Volume2, VolumeX, Shuffle, Repeat, ListMusic, Heart 
} from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { Slider } from '../components/ui/Slider';
import { clsx } from 'clsx';
import { useDJStore } from '../store/useDJStore';
import { formatDuration } from '../utils/formatters';
import './PlayerBar.css';

export const PlayerBar: React.FC = () => {
  const { t } = useTranslation();
  const { 
    deckA, 
    togglePlayDeckA, 
    seekDeckA, 
    masterVolume, 
    isMasterMuted, 
    setMasterVolume, 
    toggleMasterMute 
  } = useDJStore();

  const [isShuffle, setIsShuffle] = React.useState(false);
  const [isRepeat, setIsRepeat] = React.useState(false);
  const [isLiked, setIsLiked] = React.useState(false);

  const isPlaying = deckA.playbackState === 'playing';
  const hasTrack = Boolean(deckA.track);
  const progressPercent = deckA.duration > 0 
    ? Math.min(100, Math.max(0, (deckA.currentTime / deckA.duration) * 100)) 
    : 0;

  const trackTitle = deckA.track ? deckA.track.title : 'SYSTEM DJ';
  const trackArtist = deckA.track 
    ? (deckA.track.artist || t('dj.unknown_artist')) 
    : t('dj.no_track');

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (deckA.duration > 0) {
      const percent = Number(e.target.value);
      seekDeckA((percent / 100) * deckA.duration);
    }
  };

  return (
    <footer className="layout-player">
      <div className="player-bar-container">
        
        {/* Track Info (sincronizada con Deck A) */}
        <div className="player-track-info">
          <div className="player-cover"></div>
          <div className="player-text-info">
            <div className="player-title">{trackTitle}</div>
            <div className="player-artist">{trackArtist}</div>
          </div>
          <IconButton 
            icon={<Heart size={16} className={clsx('player-heart-icon', isLiked && 'liked')} />} 
            size="sm" 
            onClick={() => setIsLiked(!isLiked)}
          />
        </div>

        {/* Main Controls & Real Progress */}
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
              onClick={() => togglePlayDeckA()}
              title={isPlaying ? t('player.pause') : t('player.play')}
              disabled={!hasTrack}
            >
              {isPlaying ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" className="play-icon-offset" />
              )}
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
            <span className="player-time left">{formatDuration(deckA.currentTime)}</span>
            <div className="player-timeline-slider-container">
              <Slider 
                value={progressPercent} 
                onChange={handleSeekChange}
                disabled={!hasTrack}
              />
            </div>
            <span className="player-time">{formatDuration(deckA.duration)}</span>
          </div>
        </div>

        {/* Master Output Volume */}
        <div className="player-extra-controls">
          <IconButton 
            icon={<ListMusic size={18} />} 
            title={t('player.queue')} 
            className="player-btn player-btn-subtle"
          />
          <div className="player-volume-container">
            <IconButton 
              icon={isMasterMuted || masterVolume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />} 
              size="sm" 
              className="player-btn player-btn-subtle"
              onClick={toggleMasterMute}
              title={t('player.volume')}
            />
            <Slider 
              value={isMasterMuted ? 0 : masterVolume} 
              onChange={(e) => setMasterVolume(Number(e.target.value))}
            />
          </div>
        </div>

      </div>
    </footer>
  );
};
