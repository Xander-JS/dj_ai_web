/**
 * SYSTEM DJ — Session capture control
 * Estado compartido de la grabación de sesión para la consola, el atajo de teclado y la página
 * Sesiones. No graba nada por sí mismo: delega en la captura existente del DJ store
 * (startSessionCapture / finalizeSessionCapture) y solo publica si está activa y desde cuándo.
 *
 * Reglas:
 * - Nunca hay dos capturas a la vez: iniciar con una activa se rechaza sin tocar la grabación.
 * - Igual que en Sesiones, solo se inicia mientras suena algún deck y sin una exportación en curso.
 * - Al detener, la sesión finalizada queda disponible en Sesiones para exportarla y guardarla.
 */

import { djStore } from '../../store/useDJStore.ts';
import { sessionExportCoordinator } from '../../session/SessionExportCoordinator.ts';
import { isExportableSession } from '../../session/SessionExportUiModel.ts';
import { sessionRecorder, type RecordedSession } from '../../session/SessionRecorder.ts';

export interface SessionCaptureSnapshot {
  active: boolean;
  /** Inicio (reloj de pared) de la captura en curso o de la última finalizada. */
  startedAtEpochMs: number | null;
  /** Duración real de la última captura finalizada; null mientras graba o si no hay ninguna. */
  durationMs: number | null;
}

export type SessionCaptureResult =
  | { status: 'started'; session: RecordedSession }
  | { status: 'saved'; session: RecordedSession }
  /** La captura terminó sin eventos ni duración: no hay nada que exportar. */
  | { status: 'empty' }
  | { status: 'blocked'; reason: 'already-active' | 'no-audio' | 'export-busy' }
  | { status: 'error'; error: unknown };

export interface SessionCaptureDeps {
  start(): RecordedSession;
  finalize(): RecordedSession | null;
  isActive(): boolean;
  getSession(): RecordedSession | null;
  isAudioPlaying(): boolean;
  isExportBusy(): boolean;
}

type CaptureListener = () => void;

export class SessionCaptureControl {
  private readonly deps: SessionCaptureDeps;
  private snapshot: SessionCaptureSnapshot;
  private listeners: Set<CaptureListener> = new Set();

  public constructor(deps: SessionCaptureDeps) {
    this.deps = deps;
    this.snapshot = this.read();
  }

  public getSnapshot = (): SessionCaptureSnapshot => this.snapshot;

  public subscribe = (listener: CaptureListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public start(): SessionCaptureResult {
    if (this.deps.isActive()) return { status: 'blocked', reason: 'already-active' };
    if (this.deps.isExportBusy()) return { status: 'blocked', reason: 'export-busy' };
    if (!this.deps.isAudioPlaying()) return { status: 'blocked', reason: 'no-audio' };
    try {
      const session = this.deps.start();
      this.sync();
      return { status: 'started', session };
    } catch (error) {
      this.sync();
      return { status: 'error', error };
    }
  }

  public stop(): SessionCaptureResult {
    try {
      const session = this.deps.finalize();
      this.sync();
      return isExportableSession(session) ? { status: 'saved', session } : { status: 'empty' };
    } catch (error) {
      this.sync();
      return { status: 'error', error };
    }
  }

  /** Inicia si está detenida y detiene si está activa, según el estado real del grabador. */
  public toggle(): SessionCaptureResult {
    return this.deps.isActive() ? this.stop() : this.start();
  }

  private read(): SessionCaptureSnapshot {
    const active = this.deps.isActive();
    const session = this.deps.getSession();
    return {
      active,
      startedAtEpochMs: session?.createdAtEpochMs ?? null,
      durationMs: !active && session && Number.isFinite(session.durationMs) ? session.durationMs! : null,
    };
  }

  private sync(): void {
    const next = this.read();
    const previous = this.snapshot;
    if (
      next.active === previous.active
      && next.startedAtEpochMs === previous.startedAtEpochMs
      && next.durationMs === previous.durationMs
    ) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export const sessionCaptureControl = new SessionCaptureControl({
  start: () => djStore.startSessionCapture(),
  finalize: () => djStore.finalizeSessionCapture(),
  isActive: () => sessionRecorder.isActive,
  getSession: () => sessionRecorder.getSession(),
  isAudioPlaying: () => {
    const { deckA, deckB } = djStore.getSnapshot();
    return deckA.playbackState === 'playing' || deckB.playbackState === 'playing';
  },
  isExportBusy: () => sessionExportCoordinator.getSnapshot(),
});
