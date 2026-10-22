import {
  startSessionExport,
  type SessionExportHandle,
  type SessionExportOptions,
  type SessionExportRequest,
} from './SessionExporter.ts';

export class SessionExportBusyError extends Error {
  public constructor() {
    super('A previous session export is still releasing its resources.');
    this.name = 'SessionExportBusyError';
  }
}

export type StartSessionExport = (request: SessionExportRequest, options?: SessionExportOptions) => SessionExportHandle;

/** Serializes UI exports through the point where rendering and temporary resources actually stop. */
export class SessionExportCoordinator {
  private readonly start: StartSessionExport;
  private current: SessionExportHandle | null = null;
  private readonly listeners = new Set<() => void>();

  public constructor(start: StartSessionExport = startSessionExport) {
    this.start = start;
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = (): boolean => this.current !== null;

  public startExclusive(request: SessionExportRequest, options?: SessionExportOptions): SessionExportHandle {
    if (this.current) throw new SessionExportBusyError();
    const handle = this.start(request, options);
    this.current = handle;
    this.notify();
    void handle.finished.then(() => {
      if (this.current === handle) {
        this.current = null;
        this.notify();
      }
    });
    return handle;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export const sessionExportCoordinator = new SessionExportCoordinator();
