import type { MixPlan } from '../ai/mixPlan.ts';
import type { djStore, DeckStoreState } from '../../store/useDJStore.ts';
import type { DeckId } from '../../types/deck.ts';
import type { Track } from '../../types/track.ts';
import type { ConsoleActions, ConsoleControl } from '../console/consoleActions.ts';
import type { getTrackRecommendations } from '../ai/geminiRecommendationService.ts';

export type AutomaticStatus = 'ai' | 'off' | 'preparing' | 'playing' | 'mixing' | 'fallback' | 'manual' | 'waiting' | 'error';
export interface AutomaticState { active: boolean; status: AutomaticStatus }

type Store = Pick<typeof djStore, 'getSnapshot' | 'loadTrackToDeck' | 'playDeck' | 'pauseDeck' | 'seekDeck'
  | 'setCrossfader' | 'setCrossfaderCurve' | 'setChannelVolume' | 'setChannelGain' | 'setChannelEq'
  | 'setChannelFilter' | 'setPitchDeck' | 'stepLoop' | 'toggleLoop' | 'jumpToHotCue' | 'toggleKeyLock' | 'syncDeck' | 'prepareBarSync' | 'alignPhase'
  | 'cancelPhaseAlignment' | 'setHotCue'>;
export interface AutomaticDependencies {
  store: Store;
  actions: ConsoleActions;
  getTracks(): Promise<Track[]>;
  resumeAudio(): Promise<void>;
  recommend: typeof getTrackRecommendations;
  plan?: (reference: Track, candidates: Track[], signal: AbortSignal) => Promise<MixPlan | null>;
  transitionBeats(): number;
  cancelTransition(): void;
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}
interface Mix { from: DeckId; to: DeckId; fromId: string; toId: string; started: number; seconds: number; synced: boolean; crossFrom: number; crossManual: boolean }
const other = (id: DeckId): DeckId => id === 'A' ? 'B' : 'A';
const edge = (id: DeckId) => id === 'A' ? 0 : 100;
const HOLD_MS = 5000;

/** One cancellable session; the audio timeline never depends on a network request. */
export class AutomaticMixer {
  private readonly deps: AutomaticDependencies;
  private state: AutomaticState = { active: false, status: 'off' };
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private timer: unknown = null;
  private controller = new AbortController();
  private version = 0;
  private session = 0;
  private working = false;
  private audioReady = false;
  private locks = new Map<ConsoleControl, number>();
  private held = new Set<ConsoleControl>();
  private interacting = false;
  private mix: Mix | null = null;
  private lead: DeckId | null = null;
  private retired = new Map<DeckId, string>();
  private recent: string[] = [];
  private failed = new Set<string>();
  private library: Track[] = [];
  private libraryAt = -Infinity;
  private lastTick = 0;
  private nextDecision = 0;
  private initialized = new Set<string>();
  private planned: { referenceId: string; plan: MixPlan; started: number } | null = null;
  private planAttempts = new Set<string>();
  private fired = new Set<number>();
  private automaticLoop: { deckId: DeckId; until: number } | null = null;
  private alignedByAuto = new Set<DeckId>();
  private cueAttempts = new Set<string>();
  private localStarted = 0;
  private remote = false;
  private planController: AbortController | null = null;

  constructor(deps: AutomaticDependencies) { this.deps = deps; }
  getSnapshot = (): AutomaticState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(status: AutomaticStatus, active = this.state.active): void {
    if (this.state.status === status && this.state.active === active) return;
    this.state = { active, status };
    for (const listener of this.listeners) listener();
  }
  start(): void {
    if (this.state.active) return;
    this.version++;
    this.controller = new AbortController();
    this.locks.clear(); this.held.clear(); this.initialized.clear(); this.failed.clear();
    this.planned = null; this.planAttempts.clear(); this.fired.clear(); this.automaticLoop = null;
    this.cueAttempts.clear(); this.remote = false;
    this.retired.clear(); this.recent = []; this.lead = null; this.mix = null;
    this.libraryAt = -Infinity; this.nextDecision = 0; this.interacting = false;
    this.lastTick = this.deps.now();
    this.deps.cancelTransition();
    this.unsubscribe = this.deps.actions.subscribe(this.manual);
    this.publish('preparing', true);
    this.timer = this.deps.setInterval(() => { void this.tick(); }, 50);
    const session = ++this.session;
    // Invoke while the activation click still carries the browser's user gesture.
    void this.deps.resumeAudio().then(() => {
      if (!this.state.active || session !== this.session) return;
      this.audioReady = true;
      void this.tick();
    }).catch(() => {
      if (this.state.active && session === this.session) { this.stop(); this.publish('error', false); }
    });
  }
  stop(): void {
    this.session++;
    this.version++;
    this.audioReady = false;
    this.controller.abort();
    this.planController?.abort(); this.planController = null;
    if (this.timer !== null) this.deps.clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.mix = null;
    if (this.automaticLoop && this.deck(this.automaticLoop.deckId).loop.region) this.auto(() => this.deps.store.toggleLoop(this.automaticLoop!.deckId));
    this.automaticLoop = null;
    for (const id of this.alignedByAuto) this.auto(() => this.deps.store.cancelPhaseAlignment(id));
    this.alignedByAuto.clear();
    this.planned = null;
    this.publish('off', false);
  }
  setInteracting(value: boolean): void {
    this.interacting = value;
    if (!value) {
      for (const control of this.held) this.locks.set(control, this.deps.now() + HOLD_MS);
      this.held.clear();
    }
  }
  private auto<T>(command: () => T): T { return this.deps.actions.automatic(command); }
  private deck(id: DeckId): DeckStoreState { return id === 'A' ? this.deps.store.getSnapshot().deckA : this.deps.store.getSnapshot().deckB; }
  private locked(control: ConsoleControl): boolean {
    return this.held.has(control) || (this.locks.get(control) ?? 0) > this.deps.now()
      || (control !== 'reset' && this.locked('reset'));
  }
  private deckLocked(id: DeckId): boolean {
    return (['track', 'transport', 'seek', 'cue', 'loop', 'bar'] as const).some(key => this.locked(`${id}.${key}`));
  }
  private manual = (control: ConsoleControl): void => {
    if (control === 'reset' || control === `${this.automaticLoop?.deckId}.loop` || control === `${this.automaticLoop?.deckId}.track`) this.automaticLoop = null;
    this.locks.set(control, this.deps.now() + HOLD_MS);
    if (this.interacting) this.held.add(control);
    // Invalidate all awaited work before the manual command commits its state.
    this.version++; this.controller.abort(); this.controller = new AbortController();
    this.nextDecision = 0;
    if (control === 'crossfader' && this.mix) this.mix.crossManual = true;
    if (control === 'A.sync') this.alignedByAuto.delete('A');
    if (control === 'B.sync') this.alignedByAuto.delete('B');
    if (control === 'reset' || /\.(track|transport|seek|cue|loop|bar)$/.test(control)) {
      this.mix = null;
      this.planned = null; this.fired.clear();
      const id = control.startsWith('A.') ? 'A' : control.startsWith('B.') ? 'B' : null;
      if (id) this.retired.delete(id);
      this.lead = null;
    }
    this.publish('manual');
  };
  private remaining(id: DeckId): number {
    const d = this.deck(id);
    return Math.max(0, (d.duration - d.currentTime) / Math.max(0.1, d.playbackRate));
  }
  private duration(id: DeckId): number {
    const bpm = this.deck(id).calculatedBpm;
    const plan = this.planned;
    const beats = plan && plan.referenceId === this.deck(id).track?.id ? plan.plan.transitionBeats : this.deps.transitionBeats();
    return bpm && Number.isFinite(bpm) && bpm > 0 ? Math.max(2, beats * 60 / bpm) : 8;
  }
  private move(control: ConsoleControl, current: number, target: number, dt: number, write: (v: number) => void, speed = 20): void {
    if (this.locked(control) || !Number.isFinite(current) || !Number.isFinite(target)) return;
    const value = Math.round((current + Math.sign(target - current) * Math.min(Math.abs(target - current), speed * dt)) * 100) / 100;
    if (Math.abs(value - current) >= 0.01) this.auto(() => write(value));
  }
  private channel(id: DeckId) { return id === 'A' ? this.deps.store.getSnapshot().mixer.channelA : this.deps.store.getSnapshot().mixer.channelB; }
  private shape(id: DeckId, low: number, filter: number, dt: number): void {
    const c = this.channel(id), s = this.deps.store;
    this.move(`${id}.low`, c.eq.low, low, dt, v => s.setChannelEq(id, 'low', v));
    this.move(`${id}.filter`, c.eq.filter, filter, dt, v => s.setChannelFilter(id, v));
  }
  private initializeChannel(id: DeckId): void {
    const track = this.deck(id).track;
    if (!track || this.initialized.has(`${id}:${track.id}`)) return;
    this.initialized.add(`${id}:${track.id}`);
    const s = this.deps.store;
    // Only initialize silent/new channels. Never change master mute or monitoring preferences.
    for (const band of ['low', 'mid', 'high'] as const) {
      if (!this.locked(`${id}.${band}`)) this.auto(() => s.setChannelEq(id, band, 50));
    }
    if (!this.locked(`${id}.filter`)) this.auto(() => s.setChannelFilter(id, 50));
    if (!this.locked(`${id}.gain`)) this.auto(() => s.setChannelGain(id, 45));
    if (!this.locked(`${id}.volume`)) this.auto(() => s.setChannelVolume(id, 85));
  }
  private async tracks(signal: AbortSignal): Promise<Track[]> {
    if (this.deps.now() - this.libraryAt >= 10000) {
      const tracks = await this.deps.getTracks();
      if (signal.aborted) return [];
      this.library = tracks;
      this.libraryAt = this.deps.now();
    }
    return this.library;
  }
  private async choose(reference: Track | null, signal: AbortSignal): Promise<Track | null> {
    let candidates = (await this.tracks(signal)).filter(t => t.id !== reference?.id && !this.failed.has(t.id));
    const fresh = candidates.filter(t => !this.recent.includes(t.id));
    if (fresh.length) candidates = fresh;
    if (signal.aborted) return null;
    if (!reference) return candidates.find(t => t.analysis.status === 'analyzed') ?? candidates[0] ?? null;
    // Explicit local mode: no Gemini explanations, polling, retries or token spending.
    const result = await this.deps.recommend(reference, candidates, { mode: 'local', signal });
    const ranked = result.recommendations.map(r => candidates.find(t => t.id === r.trackId)).filter((t): t is Track => !!t);
    const shortlist = (ranked.length ? ranked : candidates).slice(0, 5);
    return shortlist[0] ?? null;
  }
  private async prepareCues(id: DeckId, signal: AbortSignal): Promise<void> {
    const d = this.deck(id), key = `${id}:${d.track?.id}`;
    if (!d.track || this.cueAttempts.has(key) || this.locked(`${id}.cue`)) return;
    this.cueAttempts.add(key);
    const bpm = d.calculatedBpm;
    const step = bpm ? 60 / bpm : 0;
    const positions = step ? [0, 16 * step, Math.floor(d.duration / 2 / step) * step, Math.max(0, Math.floor(d.duration / step - 32) * step)] : [0];
    for (const position of positions) {
      if (signal.aborted || this.deck(id).track?.id !== d.track.id || this.locked(`${id}.cue`)) return;
      if (position >= d.duration || this.deck(id).hotCues.some(c => Math.abs(c.position - position) < .1)) continue;
      const slot = [5, 6, 7, 8, 1, 2, 3, 4].find(n => !this.deck(id).hotCues.some(c => c.id === n));
      if (!slot) return;
      await this.auto(() => this.deps.store.setHotCue(id, slot, position, true, signal));
    }
  }
  private localPlan(id: DeckId): void {
    const d = this.deck(id);
    if (!d.track || this.planned?.referenceId === d.track.id) return;
    this.localStarted = this.deps.now(); this.remote = false; this.fired.clear();
    this.planController?.abort();
    this.planned = { referenceId: d.track.id, started: this.localStarted, plan: {
      trackId: this.deck(other(id)).track?.id ?? '', enterAfterBeats: 64, transitionBeats: 16,
      adjustments: [
        {beat:0,control:'low',value:50},
        {beat:0,control:'gain',value:45},
        {beat:0,control:'filter',value:43}, {beat:0,control:'mid',value:46},
        {beat:8,control:'filter',value:50}, {beat:8,control:'high',value:56},
        {beat:16,control:'volume',value:78}, {beat:24,control:'volume',value:85},
        {beat:24,control:'mid',value:53}, {beat:32,control:'high',value:50},
        {beat:40,control:'loop',value:4}, {beat:48,control:'filter',value:57},
        {beat:56,control:'filter',value:50},
      ],
    }};
  }
  private async preparePlan(reference: Track, candidates: Track[], signal: AbortSignal): Promise<void> {
    const key = reference.id;
    if (!this.deps.plan || !candidates.length || this.planAttempts.has(key)) return;
    this.planAttempts.add(key);
    this.planController?.abort();
    this.planController = new AbortController();
    signal = AbortSignal.any([signal, this.planController.signal]);
    try {
      const plan = await this.deps.plan(reference, candidates, signal);
      if (!plan || signal.aborted || !this.state.active) return;
      const deck = this.deck('A').track?.id === reference.id ? this.deck('A') : this.deck('B');
      if (deck.track?.id === reference.id && this.planned?.referenceId === reference.id && !this.mix) {
        // Remote beats are relative to acceptance; already performed actions are never replayed.
        this.planned = { referenceId: reference.id, plan, started: this.deps.now() }; this.remote = true; this.fired.clear();
      }
    } catch { /* The local mix continues without retries or extra API usage. */ }
  }
  private applyPlan(id: DeckId, dt: number): void {
    const p = this.planned, d = this.deck(id);
    if (!p || p.referenceId !== d.track?.id) return;
    const beat = (this.deps.now() - p.started) * (d.calculatedBpm ?? d.track.analysis.bpm ?? 120) / 60000;
    for (const [index, a] of p.plan.adjustments.entries()) {
      if (a.beat > beat) continue;
      const targetDeck = a.deck ?? id;
      if (!this.deck(targetDeck).track) continue;
      if (this.mix && (a.control === 'low' || a.control === 'filter' || a.control === 'pitch')) continue;
      if (a.control === 'hotCue' || a.control === 'loop' || a.control === 'barSync') {
        if (this.fired.has(index)) continue;
        this.fired.add(index);
        if (this.deckLocked(targetDeck) || (a.control === 'hotCue' && this.locked(`${targetDeck}.seek`))) continue;
        const s = this.deps.store;
        if (a.control === 'hotCue' && this.deck(targetDeck).hotCues.some(cue => cue.id === a.value)) {
          this.auto(() => s.jumpToHotCue(targetDeck, a.value));
        } else if (a.control === 'loop' && !this.automaticLoop && !this.deck(targetDeck).loop.region && this.deck(targetDeck).calculatedBpm) {
          const loop = this.deck(targetDeck).loop;
          for (let i = 0; i < 8 && loop.beats !== a.value; i++) {
            const dir = loop.beats < a.value ? 1 : -1;
            const next = this.deck(targetDeck).loop.beats;
            if ((dir > 0 && next >= a.value) || (dir < 0 && next <= a.value)) break;
            this.auto(() => s.stepLoop(targetDeck, dir));
          }
          if (this.deck(targetDeck).loop.beats === a.value) {
            this.auto(() => s.toggleLoop(targetDeck));
            this.automaticLoop = { deckId: targetDeck, until: this.deps.now() + a.value * 60000 / (this.deck(targetDeck).calculatedBpm ?? 120) };
          }
        } else if (a.control === 'barSync' && this.deck(targetDeck).track?.downbeat?.status === 'confirmed'
          && this.deck(targetDeck).track?.analysis.beatUnit?.status === 'confirmed') {
          this.auto(() => s.prepareBarSync(targetDeck));
        }
        continue;
      }
      if (p.plan.adjustments.some((next, j) => j !== index && (next.deck ?? id) === targetDeck && next.control === a.control && next.beat <= beat && (next.beat > a.beat || (next.beat === a.beat && j > index)))) continue;
      const c = this.channel(targetDeck), store = this.deps.store;
      const current = a.control === 'volume' ? c.volume : a.control === 'gain' ? c.gain : a.control === 'pitch' ? this.deck(targetDeck).pitch : c.eq[a.control];
      this.move(`${targetDeck}.${a.control === 'pitch' ? 'pitch' : a.control}`, current, a.value, dt, value => {
        if (a.control === 'volume') store.setChannelVolume(targetDeck, value);
        else if (a.control === 'gain') store.setChannelGain(targetDeck, value);
        else if (a.control === 'filter') store.setChannelFilter(targetDeck, value);
        else if (a.control === 'pitch') store.setPitchDeck(targetDeck, value);
        else if (a.control === 'low' || a.control === 'mid' || a.control === 'high') store.setChannelEq(targetDeck, a.control, value);
      }, a.control === 'pitch' ? 1 : 8);
    }
  }
  private beginMix(from: DeckId, to: DeckId, synced: boolean): void {
    const a = this.deck(from), b = this.deck(to);
    if (!a.track || !b.track) return;
    this.mix = { from, to, fromId: a.track.id, toId: b.track.id, started: this.deps.now(),
      seconds: Math.max(0.5, Math.min(this.duration(from), this.remaining(from) || 0.5, this.remaining(to) || 0.5)), synced, crossFrom: this.deps.store.getSnapshot().mixer.crossfader, crossManual: false };
    this.publish(synced ? 'mixing' : 'fallback');
  }
  private advanceMix(dt: number): void {
    const m = this.mix!;
    const a = this.deck(m.from), b = this.deck(m.to), s = this.deps.store;
    if (a.track?.id !== m.fromId || b.track?.id !== m.toId || b.playbackState !== 'playing') {
      this.mix = null; this.lead = null; return;
    }
    const progress = Math.min(1, (this.deps.now() - m.started) / (m.seconds * 1000));
    const target = m.crossManual ? edge(m.to) : m.crossFrom + (edge(m.to) - m.crossFrom) * progress;
    this.move('crossfader', s.getSnapshot().mixer.crossfader, target, dt, v => s.setCrossfader(v), 100 / (m.crossManual ? Math.min(m.seconds, a.playbackState === 'playing' ? Math.max(1, this.remaining(m.from)) : 2) : m.seconds));
    // Exchange bass around the midpoint; reduce the outgoing lows before admitting incoming lows.
    this.shape(m.from, 50 * (1 - Math.min(1, progress * 2)), 50 + 12 * progress, dt);
    this.shape(m.to, 50 * Math.max(0, progress * 2 - 1), 50, dt);
    if (Math.abs(s.getSnapshot().mixer.crossfader - edge(m.to)) < 0.1 && progress === 1 && !this.deckLocked(m.from)) {
      this.auto(() => s.pauseDeck(m.from));
      this.retired.set(m.from, m.fromId);
      this.initialized.delete(`${m.from}:${m.fromId}`);
      this.recent = [...this.recent.slice(-4), m.fromId];
      this.lead = m.to; this.mix = null; this.nextDecision = 0;
      this.publish('playing');
    }
  }
  /** Public for deterministic clock tests; the session owns exactly one timer. */
  async tick(): Promise<void> {
    if (!this.state.active || !this.audioReady) return;
    const now = this.deps.now();
    const dt = Math.max(0.01, Math.min(0.25, (now - this.lastTick) / 1000));
    this.lastTick = now;
    if (this.locked('reset')) return;
    if (this.automaticLoop && now >= this.automaticLoop.until) {
      const { deckId } = this.automaticLoop;
      if (!this.deckLocked(deckId)) {
        if (this.deck(deckId).loop.region) this.auto(() => this.deps.store.toggleLoop(deckId));
        this.automaticLoop = null;
      }
    }
    if (this.mix) {
      try { this.applyPlan(this.mix.from, dt); this.advanceMix(dt); } catch { this.stop(); this.publish('error', false); }
      return;
    }
    // Restore bass/filter gradually after completing an overlap, never snapping touched knobs.
    if (this.lead && this.deck(this.lead).playbackState === 'playing') {
      if (this.planned?.referenceId === this.deck(this.lead).track?.id) this.applyPlan(this.lead, dt);
      else this.shape(this.lead, 50, 50, dt);
    }
    if (this.working || now < this.nextDecision) return;
    this.nextDecision = now + 500;
    this.working = true;
    const version = this.version, signal = this.controller.signal;
    const valid = () => this.state.active && version === this.version && !signal.aborted;
    const s = this.deps.store;
    try {
      const a = this.deck('A'), b = this.deck('B');
      if ([a, b].some(d => d.playbackState === 'loading' || d.isCupPlaying || d.isBackspinning)) return;
      if (a.playbackState === 'playing' && b.playbackState === 'playing') {
        if (this.deckLocked('A') || this.deckLocked('B') || this.locked('crossfader')) return;
        // Recover an interrupted overlap from the actual console, including a manual reversal.
        const to = this.remaining('A') > this.remaining('B') ? 'A' : 'B';
        this.beginMix(other(to), to, a.isSyncActive || b.isSyncActive);
        return;
      }
      let from: DeckId = a.playbackState === 'playing' ? 'A' : b.playbackState === 'playing' ? 'B'
        : this.lead && this.deck(this.lead).track ? this.lead : a.track ? 'A' : b.track ? 'B' : 'A';
      if (this.deckLocked(from)) { this.publish('manual'); return; }
      if (this.deck(from).playbackState !== 'playing') {
        // Prefer an already prepared deck after the previous track has ended.
        if (this.deck(from).track && (this.remaining(from) < 0.5 || this.lead === from) && this.deck(other(from)).track) {
          this.retired.set(from, this.deck(from).track!.id);
          this.recent = [...this.recent.slice(-4), this.deck(from).track!.id];
          this.initialized.delete(`${from}:${this.deck(from).track!.id}`);
          from = other(from);
        }
        if (this.deckLocked(from) || this.locked('crossfader')) return;
        if (!this.deck(from).track || this.deck(from).playbackState === 'error') {
          this.publish('preparing');
          const first = await this.choose(null, signal);
          if (!valid()) return;
          if (!first) { this.publish('waiting'); this.nextDecision = now + 10000; return; }
          const loaded = await this.auto(() => s.loadTrackToDeck(from, first, signal));
          if (!valid()) return;
          if (!loaded) { this.failed.add(first.id); return; }
        }
        this.auto(() => s.setCrossfader(edge(from)));
        this.initializeChannel(from);
        if (this.remaining(from) < 0.5) this.auto(() => s.seekDeck(from, 0));
        await this.auto(() => s.playDeck(from, signal));
        if (!valid()) return;
        if (this.deck(from).playbackState !== 'playing') throw new Error('Automatic playback failed');
      }
      this.lead = from;
      this.localPlan(from);
      const to = other(from), current = this.deck(from);
      if (!current.track || this.deckLocked(to)) { this.publish('manual'); return; }
      const incoming = this.deck(to);
      if (!incoming.track || incoming.playbackState === 'error' || this.retired.get(to) === incoming.track.id) {
        this.publish('preparing');
        const next = await this.choose(current.track, signal);
        if (!valid()) return;
        if (!next) { this.publish('waiting'); this.nextDecision = now + 10000; return; }
        const loaded = await this.auto(() => s.loadTrackToDeck(to, next, signal));
        if (!valid()) return;
        if (!loaded) { this.failed.add(next.id); return; }
        this.retired.delete(to);
      }
      // The second deck is prepared immediately, while the first continues playing.
      this.initializeChannel(to);
      if (!this.deck(to).isKeyLocked && !this.locked(`${to}.keyLock`)) this.auto(() => s.toggleKeyLock(to));
      if (!this.deck(to).isSyncActive && !this.locked(`${to}.pitch`) && !this.locked(`${to}.sync`) && current.calculatedBpm && this.deck(to).calculatedBpm) this.auto(() => s.syncDeck(to));
      await this.prepareCues(from, signal);
      if (!valid()) return;
      await this.prepareCues(to, signal);
      if (!valid()) return;
      if (this.deck(to).currentTime === 0 && !this.deckLocked(to)) {
        const cue = [...this.deck(to).hotCues].sort((a,b) => a.position - b.position).find(c => c.position > 0 && c.position < this.deck(to).duration / 4);
        if (cue) this.auto(() => s.jumpToHotCue(to, cue.id));
      }
      if (this.deck(to).track) void this.preparePlan(current.track, [this.deck(to).track!], signal);
      if ((current.loop.region && this.automaticLoop?.deckId !== from) || (this.deck(to).loop.region && this.automaticLoop?.deckId !== to)) { this.publish('manual'); return; }
      const planned = this.planned?.referenceId === current.track.id ? this.planned : null;
      const early = planned && (now - planned.started) >= planned.plan.enterAfterBeats * 60000 / (current.calculatedBpm ?? 120);
      if (!early && this.remaining(from) > this.duration(from) + 1) { this.publish(this.remote ? 'ai' : 'playing'); return; }
      if (this.locked('crossfader') || this.deckLocked(to)) return;
      if (s.getSnapshot().mixer.crossfaderCurve === 'cut' && !this.locked('curve')) this.auto(() => s.setCrossfaderCurve('constant-power'));
      const target = this.deck(to);
      if (this.remaining(to) < this.duration(from) + 1 && !this.locked(`${to}.seek`)) this.auto(() => s.seekDeck(to, 0));
      if (!target.isKeyLocked && !this.locked(`${to}.keyLock`)) this.auto(() => s.toggleKeyLock(to));
      let synced = target.isSyncActive;
      if (!synced && !this.locked(`${to}.pitch`) && !this.locked(`${to}.sync`) && target.calculatedBpm && current.calculatedBpm) {
        synced = this.auto(() => s.syncDeck(to));
      }
      if (synced && !this.locked(`${to}.bar`) && current.track.downbeat?.status === 'confirmed' && target.track?.downbeat?.status === 'confirmed') {
        this.auto(() => s.prepareBarSync(to));
      }
      if (!this.locked(`${to}.low`)) this.auto(() => s.setChannelEq(to, 'low', 0));
      await this.auto(() => s.playDeck(to, signal));
      if (!valid()) return;
      if (this.deck(to).playbackState !== 'playing') throw new Error('Incoming deck failed to start');
      if (synced && !this.locked(`${to}.sync`) && this.auto(() => s.alignPhase(to))) this.alignedByAuto.add(to);
      this.beginMix(from, to, synced);
    } catch {
      if (valid()) { this.stop(); this.publish('error', false); }
    } finally { this.working = false; }
  }
}
