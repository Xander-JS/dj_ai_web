import React from 'react';
import { clsx } from 'clsx';
import type { DeckId } from '../../../types/deck';
import { DISC_ASSETS, MIXER_ASSETS, discImageStyle } from '../mixerAssets';
import type { JogDisc } from '../../../store/useSettingsStore';
import './JogWheel.css';

/** Segundos por vuelta del disco a velocidad nominal: 33⅓ rpm. */
export const JOG_SECONDS_PER_TURN = 1.8;

export interface JogWheelProps {
  deckId: DeckId;
  /** Gira solo mientras el deck reproduce. */
  spinning: boolean;
  /** Velocidad real del deck: escala las 33⅓ rpm. */
  playbackRate: number;
  /** Disco elegido en Ajustes: es el plato que gira bajo la etiqueta central. */
  disc: JogDisc;
}

/**
 * Disco del deck. Decorativo: no responde a clics, arrastres ni teclado (sin scratch ni nudge).
 * Capas: aro metálico con marcas radiales, plato (el disco de Ajustes), aro interior y la etiqueta
 * central en el color del deck con el marcador de posición, la letra y `JOG`.
 */
export const JogWheel: React.FC<JogWheelProps> = ({ deckId, spinning, playbackRate, disc }) => {
  const asset = DISC_ASSETS[disc];
  return (
    <div
      className={clsx('jog-wheel', `console-tone-${deckId.toLowerCase()}`, spinning && 'is-spinning')}
      style={{
        '--jog-spin-duration': `${(JOG_SECONDS_PER_TURN / Math.max(0.5, playbackRate)).toFixed(3)}s`,
        '--jog-metal': `url(${MIXER_ASSETS.brushedMetal})`,
      } as React.CSSProperties}
      aria-hidden="true"
      data-testid={`deck-${deckId.toLowerCase()}-jog`}
      data-disc={disc}
    >
      <div className="jog-wheel__ring" />
      <div className="jog-wheel__platter">
        <div className="jog-wheel__disc">
          <img src={asset.src} alt="" draggable={false} decoding="async" style={discImageStyle(asset)} />
        </div>
        <div className="jog-wheel__inner-ring" />
        <div className="jog-wheel__label">
          <span className="jog-wheel__marker" />
          <span className="jog-wheel__letter">{deckId}</span>
          <span className="jog-wheel__caption">JOG</span>
        </div>
      </div>
    </div>
  );
};
