import React from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Waveform } from '../atoms/Waveform';
import { formatDuration } from '../../../utils/formatters';
import type { DeckStoreState } from '../../../store/useDJStore';
import './ScreenWaveform.css';

export interface ScreenWaveformProps {
  deck: DeckStoreState;
  isAnalyzing: boolean;
  onSeek(positionSeconds: number): void;
}

const percentOf = (seconds: number, duration: number) => Math.min(100, Math.max(0, (seconds / duration) * 100));

/**
 * Vista general fija de la pista en la pantalla: picos del análisis, relleno de progreso,
 * playhead rojo, marcadores de Hot Cues y del CUE principal, y búsqueda con un clic.
 */
export const ScreenWaveform: React.FC<ScreenWaveformProps> = ({ deck, isAnalyzing, onSeek }) => {
  const { t } = useTranslation();
  const id = deck.deckId.toLowerCase();
  const { duration, currentTime } = deck;
  const hasDuration = duration > 0;
  const progressPercent = hasDuration ? percentOf(currentTime, duration) : 0;
  const analysis = deck.track?.analysis;

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hasDuration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  };

  return (
    <div
      className={clsx('screen-waveform', `console-tone-${id}`, hasDuration && 'is-interactive')}
      onClick={handleClick}
      title={hasDuration ? t('dj.seek_title') : undefined}
      role="slider"
      aria-label={t('dj.seek_title')}
      aria-valuenow={currentTime}
      aria-valuemin={0}
      aria-valuemax={duration}
      data-testid={`screen-waveform-${id}`}
    >
      <Waveform
        peaks={analysis?.waveformPeaks}
        durationSec={duration}
        peaksDurationSec={analysis?.waveformDurationSec}
        isAnalyzing={isAnalyzing}
      />

      {hasDuration && <div className="screen-waveform__progress" style={{ width: `${progressPercent}%` }} />}

      {hasDuration && deck.hotCues.map((cue) => (
        <div
          key={cue.id}
          className="screen-waveform__hotcue"
          style={{ left: `${percentOf(cue.position, duration)}%`, '--marker-color': cue.color } as React.CSSProperties}
          title={`Hot Cue ${cue.id} (${formatDuration(cue.position)})`}
          data-testid={`screen-waveform-${id}-hotcue-${cue.id}`}
        >
          <span className="screen-waveform__hotcue-tag">{cue.id}</span>
        </div>
      ))}

      {hasDuration && deck.mainCue !== null && (
        <div
          className="screen-waveform__cue"
          style={{ left: `${percentOf(deck.mainCue, duration)}%` }}
          title={`CUE (${formatDuration(deck.mainCue)})`}
          data-testid={`screen-waveform-${id}-cue`}
        >
          <span className="screen-waveform__cue-tag">C</span>
        </div>
      )}

      <div className="screen-waveform__playhead" style={hasDuration ? { left: `${progressPercent}%` } : undefined} />
    </div>
  );
};
