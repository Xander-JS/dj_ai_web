import React, { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import type { DeckId } from '../../../types/deck';
import { DISC_ASSETS, MIXER_ASSETS, discImageStyle } from '../mixerAssets';
import type { JogDisc } from '../../../store/useSettingsStore';
import { BACKSPIN_SECONDS, backspinTravel } from '../../../audio/AudioEngineService';
import { useAnimationsEnabled } from '../../../design-system/motionPreference';
import './JogWheel.css';

/** Segundos por vuelta del disco a velocidad nominal: 33⅓ rpm. */
export const JOG_SECONDS_PER_TURN = 1.8;

/** Tiempo que tarda la flecha en volver a su posición tras el backspin. */
const ARROW_SETTLE_MS = 350;

export interface JogWheelProps {
  deckId: DeckId;
  /** Gira solo mientras el deck reproduce. */
  spinning: boolean;
  /** Velocidad real del deck: escala las 33⅓ rpm. */
  playbackRate: number;
  /** Disco elegido en Ajustes: es el plato que gira, tal cual, sin nada encima. */
  disc: JogDisc;
  /** El centro del disco responde: hay pista y suena. */
  backspinEnabled: boolean;
  /** Backspin en curso: el disco gira hacia atrás frenándose. */
  backspinning: boolean;
  onBackspin: () => void;
}

/**
 * Disco del deck. Decorativo salvo su centro, que lanza el backspin (flecha ↺ flotando sobre el
 * disco). Capas: aro metálico con marcas radiales y el plato con el disco de Ajustes.
 */
export const JogWheel: React.FC<JogWheelProps> = ({ deckId, spinning, playbackRate, disc, backspinEnabled, backspinning, onBackspin }) => {
  const { t } = useTranslation();
  const animations = useAnimationsEnabled();
  const platterRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLSpanElement>(null);
  const asset = DISC_ASSETS[disc];

  // Backspin: mueve la animación CSS del plato hacia atrás desde su ángulo actual con la misma
  // curva que el audio (vueltas = pista recorrida / s por vuelta); la flecha gira con el disco
  useEffect(() => {
    const platter = platterRef.current;
    const arrow = arrowRef.current;
    const spin = platter?.getAnimations?.()[0];
    const turnMs = Number(spin?.effect?.getComputedTiming().duration);
    if (!backspinning || !animations || !arrow || !spin || !(turnMs > 0)) return undefined;
    const base = Number(spin.currentTime) || 0;
    const start = performance.now();
    let turns = 0;
    let raf = 0;
    const frame = (now: number) => {
      turns = backspinTravel((now - start) / 1000) / JOG_SECONDS_PER_TURN;
      spin.currentTime = (((base - turns * turnMs) % turnMs) + turnMs) % turnMs;
      arrow.style.transform = `rotate(${-turns * 360}deg)`;
      if (now - start < BACKSPIN_SECONDS * 1000) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      // La flecha vuelve derecha por el camino corto
      const settleFrom = ((((-turns * 360) % 360) + 540) % 360) - 180;
      arrow.style.transition = 'none';
      arrow.style.transform = `rotate(${settleFrom}deg)`;
      void arrow.offsetWidth;
      arrow.style.transition = `transform ${ARROW_SETTLE_MS}ms ease-out`;
      arrow.style.transform = '';
    };
  }, [backspinning, animations]);

  return (
    <div
      className={clsx('jog-wheel', `console-tone-${deckId.toLowerCase()}`, spinning && 'is-spinning', backspinning && 'is-backspinning')}
      style={{
        '--jog-spin-duration': `${(JOG_SECONDS_PER_TURN / Math.max(0.5, playbackRate)).toFixed(3)}s`,
        '--jog-metal': `url(${MIXER_ASSETS.brushedMetal})`,
      } as React.CSSProperties}
      data-testid={`deck-${deckId.toLowerCase()}-jog`}
      data-disc={disc}
    >
      <div className="jog-wheel__ring" aria-hidden="true" />
      <div ref={platterRef} className="jog-wheel__platter" aria-hidden="true">
        <div className="jog-wheel__disc">
          <img src={asset.src} alt="" draggable={false} decoding="async" style={discImageStyle(asset)} />
        </div>
      </div>
      <button
        type="button"
        className="jog-wheel__backspin"
        disabled={!backspinEnabled}
        aria-label={t('dj.backspin')}
        title={t('dj.backspin')}
        data-testid={`deck-${deckId.toLowerCase()}-backspin`}
        onClick={onBackspin}
      >
        <span ref={arrowRef} className="jog-wheel__backspin-icon" aria-hidden="true">
          <RotateCcw />
        </span>
      </button>
    </div>
  );
};
