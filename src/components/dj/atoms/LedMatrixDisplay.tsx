import React, { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import './LedMatrixDisplay.css';

/** Color de CSS (`hsl(…)`, `#…`) o el nombre de una propiedad personalizada (`--console-tone`). */
type LedColor = string;

export interface LedMarker {
  /** Posición en la pista, 0–1. */
  at: number;
  color: LedColor;
}

export type LedMatrixContent =
  | { kind: 'text'; text: string; color: LedColor }
  | {
      kind: 'overview';
      color: LedColor;
      /** Picos 0–1 del análisis; vacío o ausente = solo la línea base. */
      peaks?: number[];
      /** Fracción de la pista que cubren los picos (duración analizada / duración real). */
      coverage: number;
      /** Posición del playhead, 0–1; `null` sin pista. */
      progress: number | null;
      /** Marcadores en orden de dibujo (el último queda encima). */
      markers: LedMarker[];
    };

export interface LedMatrixDisplayProps {
  content: LedMatrixContent;
  /** Sin movimiento: el texto largo se muestra por páginas en lugar de desplazarse. */
  reducedMotion: boolean;
  className?: string;
}

const PITCH = 3.2;
const ROWS = 18;
const DOT_RADIUS = 1.15;
const SCROLL_DOTS_PER_SEC = 70 / PITCH;
const SCROLL_GAP = 24;
const PAGE_MS = 2500;
const TEXT_MARGIN = 1;
const FONT = '700 12px system-ui, sans-serif';
const PLAYHEAD = '--console-led-red';

interface Mask {
  width: number;
  bits: Uint8Array;
}

// Máscaras de texto ya rasterizadas (una por texto o página), compartidas por ambos decks
const maskCache = new Map<string, Mask>();
let measureCtx: CanvasRenderingContext2D | null = null;

function textContext(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  }
  measureCtx.font = FONT;
  return measureCtx;
}

const textWidth = (text: string) => Math.ceil(textContext().measureText(text).width);

/** Rasteriza el texto a 1 px por punto y lo umbraliza: cada píxel opaco es un LED encendido. */
function textMask(text: string): Mask {
  const cached = maskCache.get(text);
  if (cached) return cached;
  const width = Math.max(1, textWidth(text));
  const ctx = textContext();
  ctx.canvas.width = width;
  ctx.canvas.height = ROWS;
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 0, ROWS / 2 + 1);
  const data = ctx.getImageData(0, 0, width, ROWS).data;
  const bits = new Uint8Array(width * ROWS);
  for (let i = 0; i < bits.length; i++) bits[i] = data[i * 4 + 3] > 110 ? 1 : 0;
  const mask = { width, bits };
  if (maskCache.size > 64) maskCache.clear();
  maskCache.set(text, mask);
  return mask;
}

/** Reparte el texto en páginas de palabras que caben en `cols` puntos. */
function paginate(text: string, cols: number): string[] {
  const pages: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next) > cols - TEXT_MARGIN) {
      pages.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) pages.push(line);
  return pages;
}

interface Frame {
  /** Índice de paleta por punto (0 = apagado), fila a fila. */
  cells: Uint8Array;
  palette: { color: LedColor; alpha: number }[];
  /** El fotograma depende del tiempo (desplazamiento o páginas). */
  animated: boolean;
}

function blit(cells: Uint8Array, cols: number, mask: Mask, x0: number, index: number) {
  for (let y = 0; y < ROWS; y++) {
    for (let x = Math.max(0, -x0); x < mask.width && x0 + x < cols; x++) {
      if (mask.bits[y * mask.width + x]) cells[y * cols + x0 + x] = index;
    }
  }
}

function buildFrame(content: LedMatrixContent, cols: number, reducedMotion: boolean, now: number): Frame {
  const cells = new Uint8Array(cols * ROWS);
  const column = (x: number, index: number, y0 = 0, y1 = ROWS) => {
    if (x < 0 || x >= cols) return;
    for (let y = y0; y < y1; y++) cells[y * cols + x] = index;
  };

  if (content.kind === 'text') {
    const palette = [{ color: '', alpha: 0 }, { color: content.color, alpha: 1 }];
    const mask = textMask(content.text);
    if (mask.width <= cols - TEXT_MARGIN) {
      blit(cells, cols, mask, TEXT_MARGIN, 1);
      return { cells, palette, animated: false };
    }
    if (reducedMotion) {
      const pages = paginate(content.text, cols);
      blit(cells, cols, textMask(pages[Math.floor(now / PAGE_MS) % pages.length]), TEXT_MARGIN, 1);
      return { cells, palette, animated: pages.length > 1 };
    }
    const loop = mask.width + SCROLL_GAP;
    const offset = Math.floor((now / 1000) * SCROLL_DOTS_PER_SEC) % loop;
    blit(cells, cols, mask, TEXT_MARGIN - offset, 1);
    blit(cells, cols, mask, TEXT_MARGIN - offset + loop, 1);
    return { cells, palette, animated: true };
  }

  // 1 pendiente · 2 reproducido · 3 línea base · 4 playhead · 5+ marcadores
  const palette = [
    { color: '', alpha: 0 },
    { color: content.color, alpha: 1 },
    { color: content.color, alpha: 0.32 },
    { color: content.color, alpha: 0.25 },
    { color: PLAYHEAD, alpha: 1 },
  ];
  const peaks = content.peaks ?? [];
  const playCol = content.progress === null ? -1 : Math.min(cols - 1, Math.floor(content.progress * cols));

  if (peaks.length === 0) {
    for (let x = 0; x < cols; x++) cells[Math.floor(ROWS / 2) * cols + x] = 3;
  } else {
    const perCol = peaks.length / (cols * Math.max(content.coverage, 1e-6));
    for (let x = 0; x < cols; x++) {
      const i0 = Math.floor(x * perCol);
      if (i0 >= peaks.length) break;
      const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.floor((x + 1) * perCol)));
      let peak = 0;
      for (let i = i0; i < i1; i++) peak = Math.max(peak, peaks[i]);
      const height = Math.max(1, Math.round(Math.min(1, peak) * ROWS));
      const y0 = Math.floor((ROWS - height) / 2);
      column(x, x < playCol ? 2 : 1, y0, y0 + height);
    }
  }

  for (const marker of content.markers) {
    let index = palette.findIndex((p, i) => i >= 5 && p.color === marker.color);
    if (index === -1) index = palette.push({ color: marker.color, alpha: 1 }) - 1;
    column(Math.min(cols - 1, Math.floor(marker.at * cols)), index);
  }
  column(playCol, 4);
  return { cells, palette, animated: false };
}

function sameFrame(a: Frame | null, b: Frame): boolean {
  if (!a || a.cells.length !== b.cells.length || a.palette.length !== b.palette.length) return false;
  if (a.palette.some((p, i) => p.color !== b.palette[i].color || p.alpha !== b.palette[i].alpha)) return false;
  for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false;
  return true;
}

function paint(canvas: HTMLCanvasElement, frame: Frame, cols: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const style = getComputedStyle(canvas);
  const resolve = (color: LedColor) => (color.startsWith('--') ? style.getPropertyValue(color).trim() : color);
  const offsetX = (canvas.clientWidth - cols * PITCH) / 2;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  const dots = (index: number) => {
    ctx.beginPath();
    for (let i = 0; i < frame.cells.length; i++) {
      if (frame.cells[i] !== index) continue;
      const cx = offsetX + (i % cols) * PITCH + PITCH / 2;
      const cy = Math.floor(i / cols) * PITCH + PITCH / 2;
      ctx.moveTo(cx + DOT_RADIUS, cy);
      ctx.arc(cx, cy, DOT_RADIUS, 0, Math.PI * 2);
    }
  };

  // Puntos apagados: siguen viéndose, sin luz
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'hsl(0 0% 100% / 0.055)';
  dots(0);
  ctx.fill();

  frame.palette.forEach(({ color, alpha }, index) => {
    if (index === 0) return;
    const resolved = resolve(color);
    dots(index);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = resolved;
    ctx.shadowColor = resolved;
    ctx.shadowBlur = (alpha > 0.5 ? 4 : 2) * dpr;
    ctx.fill();
  });
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

/**
 * Display LED de matriz de puntos dibujado en un <canvas> (consciente del devicePixelRatio): texto
 * estático, desplazándose o por páginas, o la vista general de la pista. Solo repinta cuando el
 * fotograma cambia y detiene su bucle con la página oculta. Decorativo y sin interacción: quien lo
 * usa expone el contenido en texto.
 */
export const LedMatrixDisplay: React.FC<LedMatrixDisplayProps> = ({ content, reducedMotion, className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrame = useRef<Frame | null>(null);
  const [cols, setCols] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      lastFrame.current = null;
      setCols(Math.floor(canvas.clientWidth / PITCH));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cols <= 0) return;
    let raf = 0;
    // El desplazamiento y las páginas empiezan desde el principio con cada contenido nuevo
    const start = performance.now();
    const draw = () => {
      const frame = buildFrame(content, cols, reducedMotion, performance.now() - start);
      if (!sameFrame(lastFrame.current, frame)) {
        paint(canvas, frame, cols);
        lastFrame.current = frame;
      }
      raf = frame.animated && !document.hidden ? requestAnimationFrame(draw) : 0;
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) draw();
    };
    draw();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [content, cols, reducedMotion]);

  return (
    <div className={clsx('led-matrix', className)}>
      <canvas ref={canvasRef} className="led-matrix__canvas" aria-hidden="true" />
    </div>
  );
};
