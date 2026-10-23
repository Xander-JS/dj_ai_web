import React from 'react';
import { clsx } from 'clsx';

export interface WaveformProps {
  peaks?: number[];
  /** Duración real de la pista cargada (s): define la escala temporal del eje X. */
  durationSec: number;
  /** Duración (s) del AudioBuffer analizado que cubren los picos; por defecto, durationSec. */
  peaksDurationSec?: number;
  isAnalyzing?: boolean;
}

const VIEWBOX_WIDTH = 100;
const VIEWBOX_HEIGHT = 60;

/**
 * Forma de onda SVG a partir de picos reales precalculados.
 * Cada pico i ocupa exactamente [i·T/n, (i+1)·T/n) segundos del audio analizado, por lo que
 * su posición coincide con el playhead y los marcadores calculados como tiempo / duración.
 * Memorizado: el Deck se re-renderiza con cada avance del playhead y los picos no cambian.
 */
export const Waveform: React.FC<WaveformProps> = React.memo(({ peaks, durationSec, peaksDurationSec, isAnalyzing }) => {
  const count = peaks?.length ?? 0;
  const coverageSec = peaksDurationSec && peaksDurationSec > 0 ? peaksDurationSec : durationSec;
  const timeScale = durationSec > 0 && coverageSec > 0 ? coverageSec / durationSec : 1;
  const slotWidth = count > 0 ? (VIEWBOX_WIDTH / count) * timeScale : 0;
  const barWidth = slotWidth * 0.75;

  return (
    <svg
      className={clsx('deck-waveform-svg', isAnalyzing && 'waveform-analyzing')}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line x1="0" y1="30" x2="100" y2="30" className="deck-waveform-baseline" />
      {peaks && count > 0 && peaks.map((peak, idx) => {
        const x = idx * slotWidth;
        if (x >= VIEWBOX_WIDTH) return null;
        const clampedPeak = Math.max(0, Math.min(1, peak));
        const barHeight = Math.max(2, clampedPeak * 54);
        const y = (VIEWBOX_HEIGHT - barHeight) / 2;
        return (
          <rect
            key={idx}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            rx={Math.min(0.3, barWidth / 2)}
            className="deck-waveform-bar"
          />
        );
      })}
    </svg>
  );
});

Waveform.displayName = 'Waveform';
