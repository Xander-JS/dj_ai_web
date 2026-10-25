/**
 * SYSTEM DJ — Player queue
 * Cola única de la barra de reproducción. No reproduce audio por sí misma: decide qué pista
 * suena y la entrega al transporte existente (Deck A de djStore, ver playerService.ts), así
 * Home, Playlists, la barra y el panel de la cola comparten el mismo estado.
 *
 * Reglas:
 * - `entries` es el orden en que van a sonar las pistas; `sourceOrder` conserva el orden del
 *   contexto (p. ej. el de la playlist guardada) para volver a él al apagar el aleatorio.
 *   El aleatorio nunca modifica datos persistidos.
 * - El aleatorio baraja todas las pendientes con Fisher–Yates: ninguna se repite ni se pierde.
 * - Quitar pendientes o vaciar la cola nunca toca la pista en curso.
 * - El fin natural de la pista solo avanza la cola si el deck sigue teniendo la pista de la
 *   cola (si el DJ cargó otra a mano, la cola no la sustituye).
 */

import type { Track } from '../../types/track';

export type RepeatMode = 'off' | 'all' | 'one';
export const REPEAT_MODES: readonly RepeatMode[] = ['off', 'all', 'one'];

/** Segundos tras los que «Anterior» reinicia la pista en vez de volver a la previa. */
export const PREVIOUS_RESTART_THRESHOLD_SEC = 3;

export interface QueueEntry {
  /** Identidad de la entrada: la misma pista puede aparecer en contextos distintos. */
  uid: string;
  track: Track;
}

export interface PlayerQueueState {
  entries: readonly QueueEntry[];
  sourceOrder: readonly string[];
  /** Índice en `entries` de la pista en curso; -1 si la cola está vacía. */
  currentIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Origen de la cola (`playlist:<id>`, `recent`); permite a cada vista saber si suena lo suyo. */
  contextId: string | null;
}

/** Transporte que reproduce de verdad la pista elegida (inyectable en pruebas). */
export interface PlayerTransport {
  load(track: Track): Promise<boolean>;
  play(): Promise<void>;
  /** Vuelve al inicio de la pista cargada sin cambiar el estado de reproducción. */
  restart(): void;
  getLoadedTrackId(): string | null;
  getCurrentTime(): number;
}

export interface PlayTracksOptions {
  startIndex?: number;
  /** true: orden aleatorio · false: orden guardado · omitido: conserva el modo actual. */
  shuffle?: boolean;
  contextId?: string | null;
}

export const INITIAL_QUEUE_STATE: PlayerQueueState = {
  entries: [],
  sourceOrder: [],
  currentIndex: -1,
  shuffle: false,
  repeat: 'off',
  contextId: null,
};

/** Baraja una copia con Fisher–Yates; `random` devuelve [0, 1). */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

type Listener = () => void;

export class PlayerQueue {
  private state: PlayerQueueState = INITIAL_QUEUE_STATE;
  private listeners = new Set<Listener>();
  private uidCounter = 0;
  /** Descarta cargas superadas por una petición posterior (dos clics rápidos). */
  private startToken = 0;
  private transport: PlayerTransport;
  private random: () => number;
  private onLoadError: (track: Track) => void;

  public constructor(
    transport: PlayerTransport,
    options: { random?: () => number; onLoadError?: (track: Track) => void } = {},
  ) {
    this.transport = transport;
    this.random = options.random ?? Math.random;
    this.onLoadError = options.onLoadError ?? (() => {});
  }

  public getSnapshot = (): PlayerQueueState => this.state;

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getCurrentEntry(): QueueEntry | null {
    return this.state.entries[this.state.currentIndex] ?? null;
  }

  /** Pistas que sonarán después de la actual, en orden. */
  public getUpcoming(): readonly QueueEntry[] {
    return this.state.entries.slice(this.state.currentIndex + 1);
  }

  public hasNext(): boolean {
    const { entries, currentIndex, repeat } = this.state;
    return currentIndex >= 0 && (currentIndex < entries.length - 1 || (repeat === 'all' && entries.length > 0));
  }

  /** La pista de la cola es la que está cargada en el transporte. */
  public isCurrentLoaded(): boolean {
    const current = this.getCurrentEntry();
    return current !== null && this.transport.getLoadedTrackId() === current.track.id;
  }

  /** Sustituye la cola por `tracks` y empieza a reproducir. Devuelve si la pista arrancó. */
  public playTracks(tracks: readonly Track[], options: PlayTracksOptions = {}): Promise<boolean> {
    if (tracks.length === 0) return Promise.resolve(false);
    const shuffle = options.shuffle ?? this.state.shuffle;
    const source = tracks.map((track) => ({ uid: `q${++this.uidCounter}`, track }));
    const hasStart = options.startIndex !== undefined;
    const startIndex = Math.min(Math.max(0, options.startIndex ?? 0), source.length - 1);

    let entries: QueueEntry[];
    if (!shuffle) {
      entries = source;
    } else if (hasStart) {
      // La pista elegida suena primero; el resto se baraja detrás
      const first = source[startIndex];
      entries = [first, ...shuffled(source.filter((entry) => entry !== first), this.random)];
    } else {
      entries = shuffled(source, this.random);
    }

    this.setState({
      entries,
      sourceOrder: source.map((entry) => entry.uid),
      currentIndex: shuffle ? 0 : startIndex,
      shuffle,
      contextId: options.contextId ?? null,
    });
    return this.startCurrent();
  }

  /** Pasa a la siguiente pista. Sin siguiente (y sin repetir la cola) no hace nada. */
  public next(): Promise<boolean> {
    const { entries, currentIndex, repeat } = this.state;
    if (currentIndex < 0) return Promise.resolve(false);
    if (currentIndex < entries.length - 1) return this.jumpTo(currentIndex + 1);
    if (repeat === 'all') return this.jumpTo(0);
    return Promise.resolve(false);
  }

  /** Reinicia la pista si ya avanzó unos segundos; si no, vuelve a la anterior. */
  public previous(): Promise<boolean> {
    const { entries, currentIndex, repeat } = this.state;
    if (currentIndex < 0) return Promise.resolve(false);
    const loaded = this.isCurrentLoaded();
    if (loaded && this.transport.getCurrentTime() > PREVIOUS_RESTART_THRESHOLD_SEC) {
      this.transport.restart();
      return Promise.resolve(true);
    }
    if (currentIndex > 0) return this.jumpTo(currentIndex - 1);
    if (repeat === 'all' && entries.length > 1) return this.jumpTo(entries.length - 1);
    if (loaded) {
      this.transport.restart();
      return Promise.resolve(true);
    }
    return this.startCurrent();
  }

  /** Salta a una entrada concreta de la cola (clic en el panel). */
  public playEntry(uid: string): Promise<boolean> {
    const index = this.state.entries.findIndex((entry) => entry.uid === uid);
    return index < 0 ? Promise.resolve(false) : this.jumpTo(index);
  }

  /** Reproduce la pista en curso de la cola si el transporte no la tiene cargada. */
  public resume(): Promise<boolean> {
    if (this.state.currentIndex < 0) return Promise.resolve(false);
    if (this.isCurrentLoaded()) return this.transport.play().then(() => true);
    return this.startCurrent();
  }

  /** Fin natural de la pista en el transporte. */
  public handleTrackEnded(): Promise<boolean> {
    if (!this.isCurrentLoaded()) return Promise.resolve(false);
    if (this.state.repeat === 'one') {
      return this.transport.play().then(() => true);
    }
    return this.next();
  }

  public setShuffle(shuffle: boolean): void {
    if (shuffle === this.state.shuffle) return;
    const { entries, currentIndex, sourceOrder } = this.state;
    if (entries.length === 0) {
      this.setState({ shuffle });
      return;
    }
    const current = entries[currentIndex];
    if (shuffle) {
      // Lo ya sonado y la actual se quedan; solo se barajan las pendientes
      this.setState({
        shuffle,
        entries: [...entries.slice(0, currentIndex + 1), ...shuffled(entries.slice(currentIndex + 1), this.random)],
      });
      return;
    }
    const byUid = new Map(entries.map((entry) => [entry.uid, entry]));
    const restored = sourceOrder.map((uid) => byUid.get(uid)).filter((entry): entry is QueueEntry => Boolean(entry));
    this.setState({
      shuffle,
      entries: restored,
      currentIndex: current ? restored.indexOf(current) : -1,
    });
  }

  public toggleShuffle(): void {
    this.setShuffle(!this.state.shuffle);
  }

  public setRepeat(repeat: RepeatMode): void {
    if (repeat !== this.state.repeat) this.setState({ repeat });
  }

  /** off → toda la cola → una pista → off. */
  public cycleRepeat(): void {
    const index = REPEAT_MODES.indexOf(this.state.repeat);
    this.setRepeat(REPEAT_MODES[(index + 1) % REPEAT_MODES.length]);
  }

  /** Quita una entrada pendiente o ya sonada; la pista en curso no se puede quitar. */
  public remove(uid: string): boolean {
    const { entries, currentIndex, sourceOrder } = this.state;
    const index = entries.findIndex((entry) => entry.uid === uid);
    if (index < 0 || index === currentIndex) return false;
    this.setState({
      entries: entries.filter((entry) => entry.uid !== uid),
      sourceOrder: sourceOrder.filter((id) => id !== uid),
      currentIndex: index < currentIndex ? currentIndex - 1 : currentIndex,
    });
    return true;
  }

  /** Vacía las pendientes; la pista en curso (y lo ya sonado, para «Anterior») se conserva. */
  public clearUpcoming(): void {
    const { entries, currentIndex, sourceOrder } = this.state;
    if (currentIndex < 0) return;
    if (currentIndex >= entries.length - 1) return;
    const kept = entries.slice(0, currentIndex + 1);
    const keptUids = new Set(kept.map((entry) => entry.uid));
    this.setState({ entries: kept, sourceOrder: sourceOrder.filter((uid) => keptUids.has(uid)) });
  }

  private jumpTo(index: number): Promise<boolean> {
    this.setState({ currentIndex: index });
    return this.startCurrent();
  }

  private async startCurrent(): Promise<boolean> {
    const entry = this.getCurrentEntry();
    if (!entry) return false;
    const token = ++this.startToken;
    const loaded = await this.transport.load(entry.track);
    // Otra petición (siguiente, otra playlist) llegó mientras se decodificaba: gana la última
    if (token !== this.startToken) return false;
    if (!loaded) {
      this.onLoadError(entry.track);
      return false;
    }
    await this.transport.play();
    return true;
  }

  private setState(patch: Partial<PlayerQueueState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
