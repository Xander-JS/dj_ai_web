/**
 * SYSTEM DJ — Escucha de «Añadidas recientemente»
 * Play en una fila reciente escucha la pista sin cargarla en ningún deck: así no pasa a ser
 * la referencia de «Recomendaciones de mezcla» ni toca la cola de la barra. Usa un elemento
 * <audio> propio, al volumen Master vigente; solo suena una pista a la vez.
 */

import { useSyncExternalStore } from 'react';
import { indexedDBStorage } from '../storage/IndexedDBStorage';
import { djStore } from '../../store/useDJStore';
import type { Track } from '../../types/track';

export interface RecentPreviewState {
  trackId: string | null;
  isPlaying: boolean;
}

type Listener = () => void;

class RecentPreview {
  private state: RecentPreviewState = { trackId: null, isPlaying: false };
  private listeners = new Set<Listener>();
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  /** Descarta lecturas superadas por un clic posterior. */
  private token = 0;

  public getSnapshot = (): RecentPreviewState => this.state;

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Play/Pause de la fila: reanuda o pausa la misma pista; otra pista sustituye a la actual. */
  public async toggle(track: Track): Promise<void> {
    if (this.audio && this.state.trackId === track.id) {
      if (this.state.isPlaying) {
        this.audio.pause();
      } else {
        this.applyVolume();
        await this.audio.play().catch(() => this.setState({ isPlaying: false }));
      }
      return;
    }

    this.stop();
    const token = ++this.token;
    this.setState({ trackId: track.id, isPlaying: true });

    let blob: Blob | null = track.source.blob || track.source.file || null;
    try {
      if (!blob && track.source.indexedDbKey) blob = await indexedDBStorage.getTrackBlob(track.source.indexedDbKey);
      if (!blob) blob = await indexedDBStorage.getTrackBlob(track.id);
    } catch {
      blob = null;
    }
    if (token !== this.token) return;
    if (!blob) {
      this.setState({ trackId: null, isPlaying: false });
      return;
    }

    this.objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(this.objectUrl);
    this.audio = audio;
    audio.addEventListener('play', () => audio === this.audio && this.setState({ isPlaying: true }));
    audio.addEventListener('pause', () => audio === this.audio && this.setState({ isPlaying: false }));
    audio.addEventListener('ended', () => audio === this.audio && this.stop());
    this.applyVolume();
    await audio.play().catch(() => {
      if (audio === this.audio) this.stop();
    });
  }

  /** Detiene y libera la escucha en curso (al salir de Home o al elegir otra pista). */
  public stop(): void {
    this.token++;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.setState({ trackId: null, isPlaying: false });
  }

  private applyVolume(): void {
    if (!this.audio) return;
    const { masterVolume, isMasterMuted } = djStore.getSnapshot();
    this.audio.volume = isMasterMuted ? 0 : Math.min(1, Math.max(0, masterVolume / 100));
  }

  private setState(patch: Partial<RecentPreviewState>): void {
    const next = { ...this.state, ...patch };
    if (next.trackId === this.state.trackId && next.isPlaying === this.state.isPlaying) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

export const recentPreview = new RecentPreview();

export function useRecentPreview(): RecentPreviewState {
  return useSyncExternalStore(recentPreview.subscribe, recentPreview.getSnapshot, recentPreview.getSnapshot);
}
