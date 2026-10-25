import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../../audio';
import type { VisualizerIntensity } from '../../store/useSettingsStore';
import {
  VISUALIZER_BANDS,
  VISUALIZER_STYLES,
  bandRanges,
  levelAt,
  shouldKeepAnimating,
  updateLevels,
} from './visualizerModel';
import './PlayerVisualizer.css';

export interface PlayerVisualizerProps {
  /** Algún deck suena (el Master puede tener señal). */
  playing: boolean;
  /** Preferencia «Animaciones» y `prefers-reduced-motion` ya combinadas. */
  enabled: boolean;
  intensity: VisualizerIntensity;
}

/** Puntos de la onda por cada 1000 px de ancho; la curva se suaviza entre ellos. */
const POINTS_PER_1000PX = 56;
const MAX_PIXEL_RATIO = 2;

function readAccent(element: HTMLElement): string {
  return getComputedStyle(element).getPropertyValue('--sd-accent').trim() || '#fe7141';
}

/**
 * Onda de energía detrás de la barra de reproducción. Lee el espectro real del analizador
 * Master (en derivación, sin tocar el audio) una vez por fotograma y dibuja en un canvas,
 * sin estado de React. Sin señal no hay bucle; con Animaciones apagadas no se dibuja nada.
 */
export const PlayerVisualizer: React.FC<PlayerVisualizerProps> = ({ playing, enabled, intensity }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef(new Float32Array(VISUALIZER_BANDS));
  const playingRef = useRef(playing);
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    playingRef.current = playing;
    if (playing) kickRef.current();
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const levels = levelsRef.current;
    if (!enabled) {
      levels.fill(0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const style = VISUALIZER_STYLES[intensity];
    let accent = readAccent(canvas);
    let width = 0;
    let height = 0;
    let ratio = 1;
    let spectrum: Uint8Array<ArrayBuffer> | null = null;
    let ranges: [number, number][] = [];
    let frame = 0;

    const resize = () => {
      ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;
      const points = Math.max(12, Math.round((width / 1000) * POINTS_PER_1000PX));
      const ys: number[] = [];
      for (let i = 0; i <= points; i++) {
        ys.push(height - levelAt(levels, i / points) * height * style.gain);
      }
      if (ys.every((y) => y >= height - 0.5)) return;

      // Curva suave por puntos medios (cuadráticas), cerrada contra el borde inferior
      context.beginPath();
      context.moveTo(0, ys[0]);
      for (let i = 1; i <= points; i++) {
        const x0 = ((i - 1) / points) * width;
        const x1 = (i / points) * width;
        context.quadraticCurveTo(x0, ys[i - 1], (x0 + x1) / 2, (ys[i - 1] + ys[i]) / 2);
      }
      context.lineTo(width, ys[points]);
      context.strokeStyle = accent;
      context.globalAlpha = style.lineAlpha;
      context.lineWidth = 1.5;
      context.stroke();
      context.lineTo(width, height);
      context.lineTo(0, height);
      context.closePath();
      context.fillStyle = accent;
      context.globalAlpha = style.fillAlpha;
      context.fill();
      context.globalAlpha = 1;
    };

    const tick = () => {
      frame = 0;
      const size = audioEngine.getMasterSpectrumSize();
      let hasSignal = false;
      if (size > 0) {
        if (!spectrum || spectrum.length !== size) {
          spectrum = new Uint8Array(size);
          ranges = bandRanges(size);
        }
        hasSignal = audioEngine.readMasterSpectrum(spectrum);
      }
      const peak = updateLevels(levels, hasSignal ? spectrum : null, ranges);
      draw();
      if (shouldKeepAnimating({ enabled: true, playing: playingRef.current, peak })) {
        frame = requestAnimationFrame(tick);
      }
    };

    const kick = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    kickRef.current = kick;

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    // El color sigue al acento y al tema elegidos en Ajustes sin volver a montar el canvas
    const accentObserver = new MutationObserver(() => {
      accent = readAccent(canvas);
      draw();
    });
    accentObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent', 'data-theme'] });

    resize();
    if (playingRef.current || levels.some((level) => level > 0)) kick();

    return () => {
      cancelAnimationFrame(frame);
      frame = 0;
      kickRef.current = () => {};
      resizeObserver.disconnect();
      accentObserver.disconnect();
    };
  }, [enabled, intensity]);

  return <canvas ref={canvasRef} className="sd-player-visualizer" aria-hidden="true" data-active={enabled ? 'on' : 'off'} />;
};
