import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { audioEngine } from '../../../audio';
import { formatDuration } from '../../../utils/formatters';
import { getAnalyzedBpm, SEEK_END_MARGIN_SECONDS, type DeckStoreState } from '../../../store/useDJStore';
import {
  DRAG_THRESHOLD_PX,
  dragPosition,
  firstBarAtOrAfter,
  getBarGrid,
  sampleAmplitude,
  zoomedWaveformLoop,
  type BarGrid,
} from '../../../services/console/zoomedWaveform';
import { getWaveformDetail, subscribeWaveformDetail, waveformDetailKey } from '../../../services/console/waveformDetail';
import './ScreenWaveform.css';

export interface ScreenWaveformProps {
  deck: DeckStoreState;
  onSeek(positionSeconds: number): void;
}

const HOT_CUE_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8'];
const LOOP_BAND_OPACITY = 0.24;
const LOOP_EDGE_OPACITY = 0.9;

interface Palette {
  tone: string;
  baseline: string;
  barLine: string;
  playhead: string;
  cue: string;
  loop: string;
  tagInk: string;
  cueTagInk: string;
  font: string;
  playedOpacity: number;
  playheadWidth: number;
  markerWidth: number;
  cueWidth: number;
  tagSize: number;
}

/** Tokens de la consola en píxeles de dispositivo (consoleTheme.css y DigitalScreen.css). */
function readPalette(element: HTMLElement, dpr: number): Palette {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const px = (name: string) => (parseFloat(token(name)) || 0) * dpr;
  return {
    tone: token('--console-tone'),
    baseline: token('--screen-ink-faint'),
    barLine: token('--screen-wave-bar-line'),
    playhead: token('--screen-playhead'),
    cue: token('--console-led-amber'),
    loop: token('--console-loop'),
    tagInk: token('--screen-wave-tag-ink'),
    cueTagInk: token('--screen-wave-cue-tag-ink'),
    font: `${token('--font-weight-bold')} ${px('--screen-text-xs')}px ${token('--font-family-mono')}`,
    playedOpacity: parseFloat(token('--screen-wave-played-opacity')) || 1,
    playheadWidth: px('--screen-wave-playhead-width'),
    markerWidth: px('--screen-wave-marker-width'),
    cueWidth: px('--screen-wave-cue-width'),
    tagSize: px('--screen-wave-tag-size'),
  };
}

interface DragState {
  pointerId: number;
  startX: number;
  startPosition: number;
  /** Posición de la vista previa; null mientras no supere el umbral de arrastre. */
  position: number | null;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Forma de onda ampliada de un deck: ventana del zoom centrada en un playhead fijo que se
 * desplaza con la posición real del motor. Arrastrar busca al soltar; ← / → buscan ±1 s
 * (con Shift, ±5 s) mientras tiene el foco.
 */
export const ScreenWaveform: React.FC<ScreenWaveformProps> = ({ deck, onSeek }) => {
  const { t } = useTranslation();
  const { deckId, duration, currentTime } = deck;
  const id = deckId.toLowerCase();
  const hasTrack = Boolean(deck.track) && duration > 0;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const viewRef = useRef<{ deck: DeckStoreState; grid: BarGrid | null; detailKey: string } | null>(null);

  // El bucle lee siempre el último estado del deck; cada render pide un fotograma (en pausa también)
  useLayoutEffect(() => {
    viewRef.current = {
      deck,
      grid: getBarGrid(deck.track, getAnalyzedBpm(deck.track)),
      detailKey: deck.track ? waveformDetailKey(deck.track.id, deck.track.fileMeta?.contentHash) : '',
    };
    zoomedWaveformLoop.invalidate();
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;
    let palette: Palette | null = null;
    let paletteRevision = -1;
    let dpr = 1;
    // Extrapolación: último valor leído del motor y el instante del fotograma en que cambió
    let enginePosition = 0;
    let engineReadAt = 0;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      palette = null;
      zoomedWaveformLoop.invalidate();
    };
    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);

    const readPosition = (now: number, view: DeckStoreState): number => {
      const drag = dragRef.current;
      if (drag?.position != null) return drag.position;
      const position = audioEngine.getDeckCurrentTime(deckId);
      if (position !== enginePosition || !audioEngine.isDeckPlaying(deckId)) {
        enginePosition = position;
        engineReadAt = now;
        return clamp(position, 0, view.duration);
      }
      // El reloj de audio avanza a saltos: entre lecturas iguales se extrapola a la velocidad real
      return clamp(position + ((now - engineReadAt) / 1000) * audioEngine.getDeckPlaybackRate(deckId), 0, view.duration);
    };

    const draw = (now: number) => {
      const view = viewRef.current;
      if (!view) return;
      if (!palette || paletteRevision !== zoomedWaveformLoop.getStyleRevision()) {
        palette = readPalette(canvas, dpr);
        paletteRevision = zoomedWaveformLoop.getStyleRevision();
      }
      const { width, height } = canvas;
      const mid = height / 2;
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = palette.baseline;
      ctx.fillRect(0, Math.floor(mid), width, Math.max(1, Math.round(dpr)));

      const { track, duration: total, hotCues, mainCue, loop } = view.deck;
      if (!track || !(total > 0)) return;

      const position = readPosition(now, view.deck);
      const windowSec = zoomedWaveformLoop.getWindowSeconds();
      const pxPerSec = width / windowSec;
      const start = position - windowSec / 2;
      const end = start + windowSec;
      const center = Math.round(width / 2);
      const xAt = (time: number) => Math.round((time - start) * pxPerSec);

      // Picos de alta resolución si ya están; si no, los del análisis interpolados
      const detail = getWaveformDetail(view.detailKey);
      const lowRes = track.analysis?.waveformPeaks;
      const peaks: ArrayLike<number> | undefined = detail?.peaks ?? lowRes;
      if (peaks && peaks.length > 0) {
        const coverage = detail ? detail.durationSec : track.analysis?.waveformDurationSec || total;
        const peaksPerSecond = peaks.length / coverage;
        const scale = detail ? 1 / 255 : 1;
        const maxHeight = height - 2 * dpr;
        const secPerPx = 1 / pxPerSec;
        const first = clamp(xAt(0), 0, width);
        const last = clamp(xAt(total), 0, width);
        ctx.fillStyle = palette.tone;
        for (let x = first; x < last; x++) {
          if (x === first || x === center) ctx.globalAlpha = x < center ? palette.playedOpacity : 1;
          const time = start + x * secPerPx;
          const barHeight = Math.max(dpr, sampleAmplitude(peaks, scale, peaksPerSecond, time, time + secPerPx) * maxHeight);
          ctx.fillRect(x, mid - barHeight / 2, 1, barHeight);
        }
        ctx.globalAlpha = 1;
      }

      // Región del Auto Loop: banda translúcida sobre la onda (se sigue leyendo a través) y A / B marcados
      if (loop.region) {
        const x0 = clamp(xAt(loop.region.start), 0, width);
        const x1 = clamp(xAt(loop.region.end), 0, width);
        const edge = Math.max(1, Math.round(2 * dpr));
        ctx.fillStyle = palette.loop;
        ctx.globalAlpha = LOOP_BAND_OPACITY;
        ctx.fillRect(x0, 0, x1 - x0, height);
        ctx.globalAlpha = LOOP_EDGE_OPACITY;
        if (xAt(loop.region.start) >= 0) ctx.fillRect(x0, 0, edge, height);
        if (xAt(loop.region.end) <= width) ctx.fillRect(x1 - edge, 0, edge, height);
        ctx.globalAlpha = 1;
      }

      if (view.grid) {
        ctx.fillStyle = palette.barLine;
        const lineWidth = Math.max(1, Math.round(dpr));
        for (let bar = firstBarAtOrAfter(view.grid, Math.max(0, start)); bar <= Math.min(total, end); bar += view.grid.period) {
          ctx.fillRect(xAt(bar), 0, lineWidth, height);
        }
      }

      ctx.font = palette.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tag = palette.tagSize;
      for (const cue of hotCues) {
        if (cue.position < start || cue.position > end) continue;
        const x = xAt(cue.position);
        ctx.fillStyle = cue.color;
        ctx.fillRect(x, 0, palette.markerWidth, height);
        ctx.fillRect(x, dpr, tag, tag);
        ctx.fillStyle = palette.tagInk;
        ctx.fillText(HOT_CUE_LABELS[cue.id - 1] ?? '', x + tag / 2, dpr + tag / 2);
      }
      if (mainCue !== null && mainCue >= start && mainCue <= end) {
        const x = xAt(mainCue);
        ctx.fillStyle = palette.cue;
        ctx.fillRect(x, 0, palette.cueWidth, height);
        ctx.fillRect(x, height - dpr - tag, tag, tag);
        ctx.fillStyle = palette.cueTagInk;
        ctx.fillText('C', x + tag / 2, height - dpr - tag / 2);
      }

      ctx.fillStyle = palette.playhead;
      ctx.fillRect(center - palette.playheadWidth / 2, 0, palette.playheadWidth, height);
    };

    const unregister = zoomedWaveformLoop.register({
      draw,
      isActive: () => dragRef.current?.position != null || audioEngine.isDeckPlaying(deckId),
    });
    const unsubscribe = subscribeWaveformDetail(zoomedWaveformLoop.invalidate);
    return () => {
      unregister();
      unsubscribe();
      observer?.disconnect();
    };
  }, [deckId]);

  // Como seekDeck: la vista previa del arrastre nunca pasa del último punto buscable
  const maxSeek = Math.max(0, duration - SEEK_END_MARGIN_SECONDS);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasTrack || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startPosition: audioEngine.getDeckCurrentTime(deckId),
      position: null,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    if (drag.position === null && Math.abs(deltaX) < DRAG_THRESHOLD_PX) return;
    const width = event.currentTarget.clientWidth;
    drag.position = clamp(dragPosition(drag.startPosition, deltaX, width, zoomedWaveformLoop.getWindowSeconds()), 0, maxSeek);
    zoomedWaveformLoop.invalidate();
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    // Una pulsación sin movimiento real no busca
    if (commit && drag.position !== null) onSeek(drag.position);
    zoomedWaveformLoop.invalidate();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!hasTrack || !direction || event.ctrlKey || event.altKey || event.metaKey) return;
    // defaultPrevented y role="slider" hacen que los atajos globales (crossfader) ignoren la tecla
    event.preventDefault();
    onSeek(audioEngine.getDeckCurrentTime(deckId) + direction * (event.shiftKey ? 5 : 1));
  };

  return (
    <div
      className={clsx('screen-waveform', `console-tone-${id}`, hasTrack && 'is-interactive')}
      role="slider"
      tabIndex={hasTrack ? 0 : -1}
      aria-label={t('mixer.screen.waveform_label', { deck: deckId })}
      aria-disabled={!hasTrack}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={t('mixer.screen.waveform_value', { time: formatDuration(currentTime), duration: formatDuration(duration) })}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      onKeyDown={handleKeyDown}
      data-testid={`screen-waveform-${id}`}
    >
      <canvas ref={canvasRef} className="screen-waveform__canvas" aria-hidden="true" />
    </div>
  );
};
