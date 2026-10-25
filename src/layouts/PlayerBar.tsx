import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Disc3, Heart, ListMusic, Pause, Play, Repeat, Repeat1, Shuffle,
  SkipBack, SkipForward, Volume1, Volume2, VolumeX,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Fader } from '../components/atoms/Fader';
import { Icon } from '../components/atoms/Icon';
import { IconButton } from '../components/atoms/IconButton';
import { QueuePanel } from '../components/player/QueuePanel';
import { useDJStore } from '../store/useDJStore';
import { favoritesStore, useIsFavorite } from '../services/favorites/favoritesService';
import { PLAYER_DECK, playerQueue, usePlayerQueue } from '../services/player/playerService';
import type { DeckId } from '../types/deck';
import { formatDuration } from '../utils/formatters';
import './PlayerBar.css';

export interface PlayerBarProps {
  /** Retirada (Mixer): sigue montada, pero fuera del puntero, del teclado y del árbol accesible */
  hidden?: boolean;
}

/**
 * Barra de reproducción. Muestra el deck que arrancó la reproducción más reciente (Deck A por
 * defecto, el de la cola): Play/Pausa y la línea de tiempo actúan sobre él, Anterior/Siguiente/Aleatorio/Repetir sobre la cola
 * compartida (playerService) y el volumen sobre el Master del motor, sin tocar los faders de
 * canal de los decks.
 */
export const PlayerBar: React.FC<PlayerBarProps> = ({ hidden = false }) => {
  const { t } = useTranslation();
  const {
    deckA,
    deckB,
    togglePlayDeck,
    seekDeck,
    masterVolume,
    isMasterMuted,
    setMasterVolume,
    toggleMasterMute,
  } = useDJStore();
  const queue = usePlayerQueue();
  // Deck que sigue la barra: el último que pasó a reproducirse, sin copiar su estado
  const [focusDeckId, setFocusDeckId] = useState<DeckId>(PLAYER_DECK);
  const prevPlayingRef = useRef({ A: false, B: false });
  useEffect(() => {
    const prev = prevPlayingRef.current;
    const playingA = deckA.playbackState === 'playing';
    const playingB = deckB.playbackState === 'playing';
    if (playingB && !prev.B) setFocusDeckId('B');
    else if (playingA && !prev.A) setFocusDeckId('A');
    prevPlayingRef.current = { A: playingA, B: playingB };
  }, [deckA.playbackState, deckB.playbackState]);
  const deck = focusDeckId === 'A' ? deckA : deckB;
  const isQueueDeck = focusDeckId === PLAYER_DECK;
  const isLiked = useIsFavorite(deck.track?.id);
  const [queueOpen, setQueueOpen] = useState(false);
  const queueRootRef = useRef<HTMLDivElement>(null);
  const queueTriggerRef = useRef<HTMLButtonElement>(null);

  const isPlaying = deck.playbackState === 'playing';
  const hasTrack = Boolean(deck.track);
  const current = queue.entries[queue.currentIndex] ?? null;
  const isQueueTrackLoaded = Boolean(current && deckA.track?.id === current.track.id);
  const isQueuePlaying = deckA.playbackState === 'playing';
  const canPlay = hasTrack || (isQueueDeck && Boolean(current));
  const hasNext = current !== null && (queue.currentIndex < queue.entries.length - 1 || (queue.repeat === 'all' && queue.entries.length > 0));
  const canGoPrevious = current !== null || hasTrack;
  const effectiveVolume = isMasterMuted ? 0 : masterVolume;

  const trackTitle = deck.track ? deck.track.title : 'SYSTEM DJ';
  const trackArtist = deck.track ? (deck.track.artist || t('dj.unknown_artist')) : t('dj.no_track');

  // Cerrar la cola al hacer clic fuera o con Escape; el foco vuelve al botón
  useEffect(() => {
    if (!queueOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!queueRootRef.current?.contains(e.target as Node)) setQueueOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setQueueOpen(false);
      queueTriggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [queueOpen]);

  const handlePlayPause = () => {
    // Sin pista en el deck (p. ej. tras descargarlo) la cola vuelve a cargar la suya
    if (!hasTrack && isQueueDeck && current) {
      void playerQueue.resume();
      return;
    }
    void togglePlayDeck(focusDeckId);
  };

  const handlePrevious = () => {
    if (isQueueDeck && current) {
      void playerQueue.previous();
    } else if (hasTrack) {
      // Sin cola, «Anterior» vuelve al inicio de la pista cargada
      seekDeck(focusDeckId, 0);
    }
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (deck.duration > 0) seekDeck(focusDeckId, (Number(e.target.value) / 1000) * deck.duration);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const volume = Number(e.target.value);
    setMasterVolume(volume);
    // El fader muestra el volumen efectivo: subirlo estando en silencio debe oírse
    if (isMasterMuted && volume > 0) toggleMasterMute();
  };

  const repeatLabel = t(`player.repeat_mode.${queue.repeat}`);
  const VolumeIcon = effectiveVolume === 0 ? VolumeX : effectiveVolume < 50 ? Volume1 : Volume2;
  const progress = deck.duration > 0 ? Math.min(1000, Math.max(0, (deck.currentTime / deck.duration) * 1000)) : 0;

  return (
    <footer className={clsx('layout-player', hidden && 'is-hidden')} inert={hidden}>
      <div className="sd-player">
        {/* Pista en curso (deck que sigue la barra) */}
        <div className="sd-player__track">
          <span className={clsx('sd-player__cover', hasTrack && 'is-loaded')} aria-hidden="true">
            <Icon icon={Disc3} size="md" />
          </span>
          <span className="sd-player__text">
            <span className="sd-player__title" title={trackTitle}>{trackTitle}</span>
            <span className="sd-player__artist">{trackArtist}</span>
          </span>
          <IconButton
            icon={<Icon icon={Heart} size="sm" className={clsx('sd-player__heart', isLiked && 'is-liked')} />}
            size="sm"
            label={isLiked ? t('player.unfavorite') : t('player.favorite')}
            aria-pressed={isLiked}
            disabled={!hasTrack}
            onClick={() => deck.track && favoritesStore.toggle(deck.track.id)}
          />
        </div>

        {/* Transporte y línea de tiempo */}
        <div className="sd-player__center">
          <div className="sd-player__buttons">
            <IconButton
              icon={<Icon icon={Shuffle} size="sm" />}
              size="sm"
              label={queue.shuffle ? t('player.shuffle_disable') : t('player.shuffle_enable')}
              aria-pressed={queue.shuffle}
              className={clsx('sd-player__mode', queue.shuffle && 'is-on')}
              onClick={() => playerQueue.toggleShuffle()}
            />
            <IconButton
              icon={<Icon icon={SkipBack} size="md" />}
              label={t('player.prev')}
              disabled={!canGoPrevious}
              onClick={handlePrevious}
            />
            <IconButton
              icon={<Icon icon={isPlaying ? Pause : Play} size="md" className={clsx(!isPlaying && 'sd-player__play-glyph')} />}
              label={isPlaying ? t('player.pause') : t('player.play')}
              variant="ink"
              className="sd-player__play"
              disabled={!canPlay}
              onClick={handlePlayPause}
            />
            <IconButton
              icon={<Icon icon={SkipForward} size="md" />}
              label={t('player.next')}
              disabled={!hasNext}
              onClick={() => void playerQueue.next()}
            />
            <IconButton
              icon={<Icon icon={queue.repeat === 'one' ? Repeat1 : Repeat} size="sm" />}
              size="sm"
              label={t('player.repeat_label', { mode: repeatLabel })}
              aria-pressed={queue.repeat !== 'off'}
              className={clsx('sd-player__mode', queue.repeat !== 'off' && 'is-on')}
              onClick={() => playerQueue.cycleRepeat()}
            />
          </div>

          <div className="sd-player__timeline">
            <span className="sd-player__time sd-num">{formatDuration(deck.currentTime)}</span>
            <Fader
              min={0}
              max={1000}
              step={1}
              value={progress}
              disabled={!hasTrack}
              aria-label={t('player.seek')}
              aria-valuetext={`${formatDuration(deck.currentTime)} / ${formatDuration(deck.duration)}`}
              onChange={handleSeekChange}
              wrapperClassName="sd-player__seek"
            />
            <span className="sd-player__time sd-num">{formatDuration(deck.duration)}</span>
          </div>
        </div>

        {/* Cola y volumen Master */}
        <div className="sd-player__extra">
          <div className="sd-player__queue" ref={queueRootRef}>
            <IconButton
              ref={queueTriggerRef}
              icon={<Icon icon={ListMusic} size="sm" />}
              size="sm"
              label={t('player.queue')}
              aria-expanded={queueOpen}
              aria-haspopup="dialog"
              className={clsx('sd-player__mode', queueOpen && 'is-open')}
              onClick={() => setQueueOpen((open) => !open)}
            />
            {queueOpen && (
              <QueuePanel isCurrentLoaded={isQueueTrackLoaded} isPlaying={isQueuePlaying} onClose={() => {
                setQueueOpen(false);
                queueTriggerRef.current?.focus();
              }} />
            )}
          </div>
          <div className="sd-player__volume">
            <IconButton
              icon={<Icon icon={VolumeIcon} size="sm" />}
              size="sm"
              label={isMasterMuted ? t('player.unmute') : t('player.mute')}
              aria-pressed={isMasterMuted}
              onClick={toggleMasterMute}
            />
            <Fader
              min={0}
              max={100}
              step={1}
              value={effectiveVolume}
              aria-label={t('player.volume')}
              aria-valuetext={`${effectiveVolume} %`}
              onChange={handleVolumeChange}
              wrapperClassName="sd-player__volume-fader"
            />
          </div>
        </div>
      </div>
    </footer>
  );
};
