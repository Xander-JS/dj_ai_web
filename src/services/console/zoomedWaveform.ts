/**
 * SYSTEM DJ — Forma de onda ampliada de la pantalla digital
 * Cálculos puros de la ventana (muestreo de picos, compases, arrastre) y el único bucle de
 * requestAnimationFrame que dibuja ambos decks. El desplazamiento es información, no
 * decoración: no depende de prefers-reduced-motion ni del ajuste de animaciones.
 */

import type { Track } from '../../types/track.ts';
import { getDeckMeter } from '../../utils/barSyncReadiness.ts';
import { MAX_EFFECTIVE_BPM, MIN_EFFECTIVE_BPM } from '../../audio/analysis/barSync.ts';
import { DEFAULT_SETTINGS, type WaveformZoom } from '../../store/useSettingsStore.ts';

/** Movimiento mínimo (px) para que una pulsación cuente como arrastre. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * Amplitud 0–1 del tramo [tStart, tEnd) s: máximo de los picos que caen dentro o, si el tramo
 * es más estrecho que un pico, interpolación lineal entre picos vecinos (picos de baja resolución).
 */
export function sampleAmplitude(
  peaks: ArrayLike<number>,
  scale: number,
  peaksPerSecond: number,
  tStart: number,
  tEnd: number,
): number {
  const count = peaks.length;
  if (count === 0) return 0;
  const first = Math.max(0, Math.floor(tStart * peaksPerSecond));
  const last = Math.min(count, Math.floor(tEnd * peaksPerSecond));
  if (last > first) {
    let max = 0;
    for (let i = first; i < last; i++) if (peaks[i] > max) max = peaks[i];
    return max * scale;
  }
  const x = Math.max(0, Math.min(count - 1, tStart * peaksPerSecond - 0.5));
  const a = Math.floor(x);
  const b = Math.min(count - 1, a + 1);
  return (peaks[a] + (peaks[b] - peaks[a]) * (x - a)) * scale;
}

export interface BarGrid {
  /** Downbeat confirmado (s de buffer). */
  origin: number;
  /** Duración de un compás (s de buffer). */
  period: number;
}

/**
 * Rejilla de compases solo con downbeat y métrica confirmados y un BPM válido.
 * La rejilla provisional del análisis nunca cuenta.
 */
export function getBarGrid(track: Track | null | undefined, bpm: number | null): BarGrid | null {
  const meter = getDeckMeter(track);
  const origin = track?.downbeat?.confirmation?.position;
  if (!meter.downbeatConfirmed || meter.beatUnit === null || !meter.beatsPerBar || origin === undefined) return null;
  if (bpm === null || !Number.isFinite(bpm) || bpm < MIN_EFFECTIVE_BPM || bpm > MAX_EFFECTIVE_BPM) return null;
  return { origin, period: (meter.beatsPerBar * 60) / bpm };
}

/** Primer compás de la rejilla en o después de `time`. */
export function firstBarAtOrAfter(grid: BarGrid, time: number): number {
  return grid.origin + Math.ceil((time - grid.origin) / grid.period) * grid.period;
}

/** Posición al arrastrar: mover la onda a la derecha retrocede en la pista. */
export function dragPosition(startPosition: number, deltaX: number, widthPx: number, windowSec: number): number {
  return widthPx > 0 ? startPosition - (deltaX / widthPx) * windowSec : startPosition;
}

/** Un deck que la pantalla dibuja en cada fotograma mientras está activo. */
export interface WaveformClient {
  draw(now: number): void;
  /** Reproduciendo o arrastrándose: necesita fotogramas continuos. */
  isActive(): boolean;
}

/**
 * Bucle compartido: un solo requestAnimationFrame para todos los clientes. Corre solo mientras
 * la página es visible y algún cliente está activo; `invalidate` pide un fotograma suelto.
 */
class ZoomedWaveformLoop {
  private clients = new Set<WaveformClient>();
  private frame: number | null = null;
  private windowSec: WaveformZoom = DEFAULT_SETTINGS.waveformZoom;
  private styleRevision = 0;

  public getWindowSeconds = (): WaveformZoom => this.windowSec;

  /** Cambia con cada ajuste aplicado (acento, tema…): los clientes releen sus tokens. */
  public getStyleRevision = (): number => this.styleRevision;

  /** Desde settingsEffects: zoom de la ventana y aviso de que la apariencia pudo cambiar. */
  public configure(windowSec: WaveformZoom): void {
    this.windowSec = windowSec;
    this.styleRevision++;
    this.invalidate();
  }

  public register(client: WaveformClient): () => void {
    this.clients.add(client);
    if (this.clients.size === 1 && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.invalidate);
    }
    this.invalidate();
    return () => {
      this.clients.delete(client);
      if (this.clients.size === 0) {
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.invalidate);
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
      }
    };
  }

  public invalidate = (): void => {
    if (this.frame !== null || this.clients.size === 0 || typeof requestAnimationFrame === 'undefined') return;
    this.frame = requestAnimationFrame(this.tick);
  };

  private tick = (now: number): void => {
    this.frame = null;
    let active = false;
    for (const client of this.clients) {
      client.draw(now);
      if (client.isActive()) active = true;
    }
    if (active && document.visibilityState !== 'hidden') this.frame = requestAnimationFrame(this.tick);
  };
}

export const zoomedWaveformLoop = new ZoomedWaveformLoop();
