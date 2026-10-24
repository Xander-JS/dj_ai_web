import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';
import { clsx } from 'clsx';
import { calculateCrossfaderGains } from '../../audio/djAudioMath';
import { DURATION, EASE_OUT } from '../../design-system/motion';
import type { CrossfaderCurve } from '../../types/mixer';
import './SettingsPreviews.css';

const CURVE_SAMPLES = 48;
const CURVE_WIDTH = 240;
const CURVE_HEIGHT = 84;
const CURVE_PAD = 6;

function curvePath(curve: CrossfaderCurve, deck: 'A' | 'B'): string {
  const points: string[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i += 1) {
    const position = i / CURVE_SAMPLES;
    const { gainA, gainB } = calculateCrossfaderGains(position, curve);
    const gain = deck === 'A' ? gainA : gainB;
    const x = CURVE_PAD + position * (CURVE_WIDTH - CURVE_PAD * 2);
    const y = CURVE_PAD + (1 - gain) * (CURVE_HEIGHT - CURVE_PAD * 2);
    points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return points.join(' ');
}

/** Ganancia de A y B a lo largo del recorrido, calculada con la misma ley que usa el motor de audio. */
export const CrossfaderCurvePreview: React.FC<{ curve: CrossfaderCurve }> = ({ curve }) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const center = calculateCrossfaderGains(0.5, curve);
  const transition = reduceMotion ? { duration: 0 } : { duration: DURATION.base * 1.5, ease: EASE_OUT };
  const midX = CURVE_WIDTH / 2;

  return (
    <figure className="sd-curve-preview">
      <svg
        className="sd-curve-preview__plot"
        viewBox={`0 0 ${CURVE_WIDTH} ${CURVE_HEIGHT}`}
        role="img"
        aria-label={t('settings.crossfader_preview_label', { curve: t(`settings.crossfader_curve.${curve}`) })}
      >
        <line x1={CURVE_PAD} x2={CURVE_WIDTH - CURVE_PAD} y1={CURVE_HEIGHT - CURVE_PAD} y2={CURVE_HEIGHT - CURVE_PAD} className="sd-curve-preview__axis" />
        <line x1={midX} x2={midX} y1={CURVE_PAD} y2={CURVE_HEIGHT - CURVE_PAD} className="sd-curve-preview__center" />
        <motion.path d={curvePath(curve, 'B')} className="sd-curve-preview__line sd-curve-preview__line--b" initial={false} animate={{ d: curvePath(curve, 'B') }} transition={transition} />
        <motion.path d={curvePath(curve, 'A')} className="sd-curve-preview__line sd-curve-preview__line--a" initial={false} animate={{ d: curvePath(curve, 'A') }} transition={transition} />
      </svg>
      <figcaption className="sd-curve-preview__caption">
        <span className="sd-curve-preview__legend">
          <span className="sd-curve-preview__swatch sd-curve-preview__swatch--a" aria-hidden="true" />
          {t('settings.shortcuts_deck', { deck: 'A' })}
        </span>
        <span className="sd-curve-preview__legend">
          <span className="sd-curve-preview__swatch sd-curve-preview__swatch--b" aria-hidden="true" />
          {t('settings.shortcuts_deck', { deck: 'B' })}
        </span>
        <span className="sd-curve-preview__center-value sd-num">
          {t('settings.crossfader_center', { a: Math.round(center.gainA * 100), b: Math.round(center.gainB * 100) })}
        </span>
      </figcaption>
    </figure>
  );
};

const BEATS_PER_BAR = 4;
const MAX_PREVIEW_BEATS = 32;

/** Rejilla de tiempos al estilo de un secuenciador: se encienden los que dura la transición. */
export const BeatLengthPreview: React.FC<{ beats: number }> = ({ beats }) => {
  const { t } = useTranslation();
  const bars = Array.from({ length: MAX_PREVIEW_BEATS / BEATS_PER_BAR }, (_, bar) => bar);

  return (
    <figure className="sd-beat-preview">
      <div className="sd-beat-preview__grid" aria-hidden="true">
        {bars.map((bar) => (
          <span key={bar} className="sd-beat-preview__bar">
            {Array.from({ length: BEATS_PER_BAR }, (_, beat) => {
              const index = bar * BEATS_PER_BAR + beat;
              return (
                <span
                  key={beat}
                  className={clsx('sd-beat-preview__beat', index < beats && 'is-on', beat === 0 && 'is-downbeat')}
                  style={{ transitionDelay: `${index * 8}ms` }}
                />
              );
            })}
          </span>
        ))}
      </div>
      <figcaption className="sd-beat-preview__caption sd-num">
        {t('settings.auto_transition_bars', { beats, bars: beats / BEATS_PER_BAR })}
      </figcaption>
    </figure>
  );
};

const METER_SEGMENTS = 32;

/** Medidor segmentado tipo VU: los segmentos encendidos son la proporción real de uso. */
export const StorageMeter: React.FC<{ ratio: number | null; label: string }> = ({ ratio, label }) => {
  const clamped = ratio == null ? 0 : Math.min(1, Math.max(0, ratio));
  // Cualquier uso real enciende al menos un segmento: «casi nada» no es «nada»
  const lit = clamped === 0 ? 0 : Math.max(1, Math.round(clamped * METER_SEGMENTS));

  return (
    <div
      className={clsx('sd-storage-meter', ratio == null && 'is-unknown')}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ratio == null ? undefined : Number((clamped * 100).toFixed(1))}
    >
      {Array.from({ length: METER_SEGMENTS }, (_, i) => (
        <span key={i} className={clsx('sd-storage-meter__segment', i < lit && 'is-on')} style={{ transitionDelay: `${i * 12}ms` }} />
      ))}
    </div>
  );
};
