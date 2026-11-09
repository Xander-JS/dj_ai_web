/** Semantic user intent, shared by mouse, touch, keyboard and other console clients. */
export type ConsoleControl = 'crossfader' | 'curve' | 'master' | 'mute' | 'reset'
  | `${'A' | 'B'}.${'track' | 'transport' | 'seek' | 'pitch' | 'sync' | 'keyLock' | 'loop' | 'cue' | 'bar' | 'gain' | 'volume' | 'low' | 'mid' | 'high' | 'filter'}`;

export class ConsoleActions {
  private automaticDepth = 0;
  private listeners = new Set<(control: ConsoleControl) => void>();

  subscribe(listener: (control: ConsoleControl) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  manual(control: ConsoleControl): void {
    if (!this.automaticDepth) for (const listener of this.listeners) listener(control);
  }

  /** Only the synchronous command invocation is scoped, never unrelated work during an await. */
  automatic<T>(command: () => T): T {
    this.automaticDepth++;
    try { return command(); } finally { this.automaticDepth--; }
  }
}

export const consoleActions = new ConsoleActions();
