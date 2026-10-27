/**
 * SYSTEM DJ — Digital screen state
 * Estado compartido de la pantalla digital de la consola: vista (normal / menú), subapartado
 * activo del menú, GRID y ventana de confirmación de reemplazo. Lo leen la pantalla montada en el
 * Mixer y los atajos de teclado, que se instalan fuera del árbol de React.
 *
 * Reglas:
 * - Fuera del Mixer no hay pantalla: sin una pantalla montada, los botones (y sus atajos V / N)
 *   no hacen nada.
 * - Con el menú abierto la pantalla consume las ocho teclas de navegación; los atajos globales
 *   consultan isCapturingNavigation() antes de actuar.
 * - Pulsar MENU, LOAD A o LOAD B con la confirmación abierta equivale a Cancelar y después
 *   aplica la acción del botón.
 */

import type { DeckId } from '../../types/deck.ts';

export type ScreenView = 'normal' | 'menu';

/** Reemplazo pendiente de confirmar: el deck destino estaba sonando al pedir la carga. */
export interface ScreenReplaceRequest {
  deckId: DeckId;
  trackId: string;
  /** Instante (reloj monótono, ms) en que se abrió; Enter se ignora durante ENTER_GUARD_MS. */
  openedAt: number;
}

export interface DigitalScreenSnapshot {
  view: ScreenView;
  /** Subapartado activo del menú (último usado cuando el menú está cerrado). */
  subsection: DeckId;
  gridEnabled: boolean;
  replace: ScreenReplaceRequest | null;
  /** Aumenta cada vez que un botón abre el menú o cambia de subapartado: la lista recibe el foco. */
  focusRequest: number;
}

/** Tras abrir la confirmación, Enter no confirma durante este tiempo (doble pulsación accidental). */
export const ENTER_GUARD_MS = 300;

type Listener = () => void;

const INITIAL: DigitalScreenSnapshot = {
  view: 'normal',
  subsection: 'A',
  gridEnabled: false,
  replace: null,
  focusRequest: 0,
};

export class DigitalScreenStore {
  private snapshot: DigitalScreenSnapshot = INITIAL;
  private listeners = new Set<Listener>();
  private attachedCount = 0;
  private readonly now: () => number;

  public constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  public getSnapshot = (): DigitalScreenSnapshot => this.snapshot;

  public subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** La pantalla montada se registra; al retirarse vuelve a la vista normal (GRID se conserva). */
  public attach(): () => void {
    this.attachedCount += 1;
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.attachedCount -= 1;
      if (this.attachedCount === 0) this.set({ view: 'normal', replace: null });
    };
  }

  public get isAttached(): boolean {
    return this.attachedCount > 0;
  }

  /** Con el menú abierto, las ocho teclas de navegación pertenecen a la pantalla. */
  public isCapturingNavigation(): boolean {
    return this.isAttached && this.snapshot.view === 'menu';
  }

  /** MENU: abre el menú en el último subapartado o lo cierra si ya está abierto. */
  public pressMenu(): boolean {
    if (!this.isAttached) return false;
    if (this.snapshot.view === 'menu') this.set({ view: 'normal', replace: null });
    else this.openMenu(this.snapshot.subsection);
    return true;
  }

  /** LOAD A / LOAD B (y sus atajos): abre, cambia de subapartado o cierra el menú. */
  public pressLoad(deckId: DeckId): boolean {
    if (!this.isAttached) return false;
    const { view, subsection } = this.snapshot;
    if (view === 'menu' && subsection === deckId) this.set({ view: 'normal', replace: null });
    else this.openMenu(deckId);
    return true;
  }

  /** GRID: alterna gridEnabled; con el menú abierto queda atenuado y no responde. */
  public toggleGrid(): boolean {
    if (!this.isAttached || this.snapshot.view === 'menu') return false;
    this.set({ gridEnabled: !this.snapshot.gridEnabled });
    return true;
  }

  /** Cambia de subapartado desde la propia lista (clic o flechas); el foco se gestiona allí. */
  public selectSubsection(deckId: DeckId): void {
    if (this.snapshot.view !== 'menu' || this.snapshot.subsection === deckId) return;
    this.set({ subsection: deckId });
  }

  public closeMenu(): void {
    if (this.snapshot.view === 'normal') return;
    this.set({ view: 'normal', replace: null });
  }

  public requestReplace(deckId: DeckId, trackId: string): void {
    if (this.snapshot.view !== 'menu') return;
    this.set({ replace: { deckId, trackId, openedAt: this.now() } });
  }

  public cancelReplace(): void {
    if (this.snapshot.replace) this.set({ replace: null });
  }

  /** Enter solo confirma pasado ENTER_GUARD_MS desde que se abrió la ventana. */
  public isEnterGuarded(): boolean {
    const { replace } = this.snapshot;
    return replace !== null && this.now() - replace.openedAt < ENTER_GUARD_MS;
  }

  /** Vuelve al estado inicial (pruebas). */
  public reset(): void {
    this.attachedCount = 0;
    this.set(INITIAL);
  }

  private openMenu(deckId: DeckId): void {
    this.set({ view: 'menu', subsection: deckId, replace: null, focusRequest: this.snapshot.focusRequest + 1 });
  }

  private set(patch: Partial<DigitalScreenSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export const digitalScreenStore = new DigitalScreenStore();
