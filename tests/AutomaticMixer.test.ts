import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticMixer, type AutomaticDependencies } from '../src/services/automix/AutomaticMixer.ts';
import { ConsoleActions } from '../src/services/console/consoleActions.ts';
import type { DeckId } from '../src/types/deck.ts';
import type { Track } from '../src/types/track.ts';
import type { DeckStoreState, DJStoreState } from '../src/store/useDJStore.ts';

const track = (id: string): Track => ({ id, title: id, artist: 'Artist', duration: 60, durationFormatted: '1:00', type: 'audio',
  source: { type: 'blob', blob: new Blob(['audio']) }, analysis: { status: 'analyzed', bpm: 120, camelot: '8A' } });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(library = [track('one'), track('two'), track('three')]) {
  let now = 0, timer: (() => void) | null = null, reads = 0, recommendations = 0;
  const actions = new ConsoleActions();
  const initial = (id: DeckId) => ({ deckId: id, track: null, playbackState: 'stopped', duration: 0, currentTime: 0,
    calculatedBpm: null, pitch: 50, playbackRate: 1, isKeyLocked: false, isSyncActive: false,
    isCupPlaying: false, isBackspinning: false, hotCues: [], loop: { region: null, beats: 4 }, barSync: { status: 'idle' },
  } as DeckStoreState);
  const channel = (id: DeckId) => ({ deckId: id, volume: 100, gain: 50, eq: { low: 50, mid: 50, high: 50, filter: 50 }, cuePfl: false });
  const state = { deckA: initial('A'), deckB: initial('B'), masterVolume: 75, isMasterMuted: false,
    mixer: { channelA: channel('A'), channelB: channel('B'), crossfader: 50, crossfaderCurve: 'constant-power', masterVolume: 75 }, syncMasterDeck: null } as DJStoreState;
  const deck = (id: DeckId) => id === 'A' ? state.deckA : state.deckB;
  const ch = (id: DeckId) => id === 'A' ? state.mixer.channelA : state.mixer.channelB;
  const loads: string[] = [];
  const store: AutomaticDependencies['store'] = {
    getSnapshot: () => state,
    async loadTrackToDeck(id, t, signal) {
      actions.manual(`${id}.track`);
      if (signal?.aborted) return false;
      loads.push(`${id}:${t.id}`);
      Object.assign(deck(id), { track: t, hotCues: t.hotCues ?? [], duration: t.duration, currentTime: 0, playbackState: 'stopped', calculatedBpm: t.analysis.bpm ?? null, isSyncActive: false });
      return true;
    },
    async playDeck(id, signal) { actions.manual(`${id}.transport`); if (!signal?.aborted) deck(id).playbackState = 'playing'; },
    pauseDeck(id) { actions.manual(`${id}.transport`); deck(id).playbackState = 'paused'; },
    seekDeck(id, value) { actions.manual(`${id}.seek`); deck(id).currentTime = value; },
    setCrossfader(v) { actions.manual('crossfader'); state.mixer.crossfader = v; },
    setCrossfaderCurve(v) { actions.manual('curve'); state.mixer.crossfaderCurve = v; },
    setChannelEq(id, band, v) { actions.manual(`${id}.${band}`); ch(id).eq[band] = v; },
    setChannelFilter(id, v) { actions.manual(`${id}.filter`); ch(id).eq.filter = v; },
    setChannelGain(id, v) { actions.manual(`${id}.gain`); ch(id).gain = v; },
    setChannelVolume(id, v) { actions.manual(`${id}.volume`); ch(id).volume = v; },
    setPitchDeck(id, v) { actions.manual(`${id}.pitch`); deck(id).pitch = v; },
    toggleKeyLock(id) { actions.manual(`${id}.keyLock`); deck(id).isKeyLocked = !deck(id).isKeyLocked; },
    syncDeck(id) { actions.manual(`${id}.sync`); deck(id).isSyncActive = true; return true; },
    prepareBarSync() { return { status: 'armed' } as ReturnType<AutomaticDependencies['store']['prepareBarSync']>; },
    alignPhase() { return true; },
    cancelPhaseAlignment() {},
    async setHotCue(id, slot, position, vacant, signal) {
      if (signal?.aborted || (vacant && deck(id).hotCues.some(c => c.id === slot))) return false;
      deck(id).hotCues.push({id:slot,position:position ?? 0} as never); return true;
    },
    jumpToHotCue(id, slot) { deck(id).currentTime = deck(id).hotCues.find(c => c.id === slot)?.position ?? deck(id).currentTime; },
    stepLoop(id, direction) { deck(id).loop.beats *= direction > 0 ? 2 : .5; },
    toggleLoop(id) { deck(id).loop.region = deck(id).loop.region ? null : {start:0,end:2} as never; },
  };
  const deps: AutomaticDependencies = {
    store, actions, resumeAudio: async () => {}, getTracks: async () => { reads++; return library; },
    recommend: async (_reference, candidates, options) => {
      recommendations++;
      assert.equal(options?.mode, 'local', 'autonomous decisions cannot request remote explanations');
      assert.ok(options?.signal);
      return { success: true, recommendations: candidates.map(t => ({ trackId: t.id })) as never, isMock: true };
    },
    transitionBeats: () => 16, cancelTransition() {}, now: () => now,
    setInterval(fn) { assert.equal(timer, null, 'only one interval per active session'); timer = fn; return 1; },
    clearInterval() { timer = null; },
  };
  const auto = new AutomaticMixer(deps);
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 50) {
      now += 50;
      for (const id of ['A', 'B'] as const) {
        const d = deck(id);
        if (d.playbackState === 'playing') { d.currentTime = Math.min(d.duration, d.currentTime + .05); if (d.currentTime === d.duration) d.playbackState = 'stopped'; }
      }
      await auto.tick();
    }
  };
  return { auto, deps, state, store, deck, ch, loads, advance, actions, get timer() { return timer; }, get reads() { return reads; }, get recommendations() { return recommendations; } };
}

test('empty console loads A and B immediately, starts A, and preloads a different compatible B', async () => {
  const h = harness(); h.auto.start(); await flush();
  assert.deepEqual(h.loads, ['A:one', 'B:two']);
  assert.equal(h.state.deckA.playbackState, 'playing');
  assert.equal(h.state.deckB.playbackState, 'stopped');
  assert.equal(h.state.mixer.crossfader, 0);
  await h.advance(10000);
  assert.equal(h.reads, 1, 'no library polling while both decks are prepared');
  assert.equal(h.recommendations, 1, 'selection is not repeated by the audio timer');
  h.auto.stop();
});

test('loaded but paused songs start automatically and user selections survive activation', async () => {
  const h = harness(); await h.store.loadTrackToDeck('A', track('custom-a')); await h.store.loadTrackToDeck('B', track('custom-b'));
  h.loads.length = 0; h.auto.start(); await flush();
  assert.equal(h.state.deckA.playbackState, 'playing'); assert.deepEqual(h.loads, []);
  assert.equal(h.state.deckB.track?.id, 'custom-b'); h.auto.stop();
});

test('B already playing is preserved and empty A is filled', async () => {
  const h = harness(); await h.store.loadTrackToDeck('B', track('custom-b')); await h.store.playDeck('B');
  h.state.deckB.currentTime = 10; h.state.mixer.crossfader = 100;
  h.auto.start(); await flush();
  assert.equal(h.state.deckB.currentTime, 10); assert.ok(h.state.deckA.track); h.auto.stop();
});

test('full overlap moves EQ/filter/crossfader and refills the retired deck for continuous mixing', async () => {
  const h = harness(); h.auto.start(); await flush();
  h.state.deckA.currentTime = 51;
  await h.advance(4000);
  assert.equal(h.state.deckB.playbackState, 'playing');
  assert.ok(h.state.mixer.crossfader > 0 && h.state.mixer.crossfader < 100);
  assert.ok(h.ch('A').eq.low < 50); assert.ok(h.ch('A').eq.filter > 50);
  assert.ok(h.state.deckB.isKeyLocked); assert.ok(h.state.deckB.isSyncActive);
  await h.advance(6000);
  assert.equal(h.state.mixer.crossfader, 100);
  assert.equal(h.state.deckA.track?.id, 'three'); assert.equal(h.state.deckB.track?.id, 'two');
  assert.equal(h.state.deckA.playbackState, 'stopped');
  h.auto.stop();
});

test('manual EQ owns only its knob; hold and release are honored while other controls continue', async () => {
  const h = harness(); h.auto.start(); await flush(); h.state.deckA.currentTime = 51; await h.advance(1000);
  h.auto.setInteracting(true); h.store.setChannelEq('B', 'low', 23);
  const before = h.state.mixer.crossfader;
  await h.advance(6000);
  assert.equal(h.ch('B').eq.low, 23); assert.ok(h.state.mixer.crossfader > before);
  h.auto.setInteracting(false); await h.advance(4000); assert.equal(h.ch('B').eq.low, 23);
  await h.advance(2000); assert.ok(h.ch('B').eq.low > 23); h.auto.stop();
});

test('manual crossfader intervention recovers with both decks still playing instead of deadlocking', async () => {
  const h = harness(); h.auto.start(); await flush(); h.state.deckA.currentTime = 51; await h.advance(1000);
  h.store.setCrossfader(35); await h.advance(4500); assert.equal(h.state.mixer.crossfader, 35);
  await h.advance(13000); assert.equal(h.state.mixer.crossfader, 100); assert.equal(h.state.deckB.playbackState, 'playing'); h.auto.stop();
});

test('cancelled pending load cannot start playback after stop, and all timers/listeners are removed', async () => {
  const h = harness(); let resolve!: () => void;
  const gate = new Promise<void>(r => { resolve = r; });
  const original = h.deps.store.loadTrackToDeck;
  h.deps.store.loadTrackToDeck = async (id, t, signal) => { await gate; return original(id, t, signal); };
  h.auto.start(); await flush(); h.auto.stop(); resolve(); await flush();
  assert.equal(h.timer, null); assert.equal(h.state.deckA.track, null);
  h.store.setCrossfader(20); assert.equal(h.auto.getSnapshot().status, 'off');
});

test('manual load invalidates pending automatic selection', async () => {
  const h = harness(); let resolve!: () => void;
  const gate = new Promise<void>(r => { resolve = r; });
  const original = h.deps.store.loadTrackToDeck;
  h.deps.store.loadTrackToDeck = async (id, t, signal) => { if (signal) await gate; return original(id, t, signal); };
  h.auto.start(); await flush(); await h.store.loadTrackToDeck('A', track('manual')); resolve(); await flush();
  assert.equal(h.state.deckA.track?.id, 'manual'); assert.equal(h.state.deckA.playbackState, 'stopped'); h.auto.stop();
});

test('empty and one-track libraries do not create a retry storm', async () => {
  for (const tracks of [[], [track('only')]]) {
    const h = harness(tracks); h.auto.start(); await flush(); await h.advance(5000);
    assert.equal(h.auto.getSnapshot().status, 'waiting'); assert.equal(h.reads, 1);
    assert.equal(h.state.deckB.track, null); h.auto.stop();
  }
});

test('missing analysis uses a gradual transition and reports fallback', async () => {
  const tracks = [track('one'), track('two')]; tracks.forEach(t => { t.analysis = { status: 'pending' }; });
  const h = harness(tracks); h.auto.start(); await flush(); h.state.deckA.currentTime = 51; await h.advance(1000);
  assert.equal(h.auto.getSnapshot().status, 'fallback');
  await h.advance(8500); assert.equal(h.state.mixer.crossfader, 100); h.auto.stop();
});

test('repeated enable/disable leaves no timer and never duplicates a running interval', async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) { h.auto.start(); h.auto.start(); await flush(); h.auto.stop(); h.auto.stop(); assert.equal(h.timer, null); }
});

test('failed files are skipped without endlessly reloading the same source', async () => {
  const h = harness(); const original = h.store.loadTrackToDeck;
  const attempted: string[] = [];
  h.store.loadTrackToDeck = async (id, t, signal) => { attempted.push(t.id); return t.id === 'one' ? false : original(id, t, signal); };
  h.auto.start(); await flush(); await h.advance(5000);
  assert.deepEqual(attempted, ['one', 'two', 'three']);
  assert.equal(h.state.deckA.track?.id, 'two'); assert.equal(h.state.deckB.track?.id, 'three'); h.auto.stop();
});

test('natural EOF resetting the playhead to zero advances to the prepared deck', async () => {
  const h = harness(); h.auto.start(); await flush();
  h.state.deckA.playbackState = 'stopped'; h.state.deckA.currentTime = 0;
  await h.advance(1000);
  assert.equal(h.state.deckB.playbackState, 'playing'); assert.equal(h.state.deckA.track?.id, 'three'); h.auto.stop();
});

test('audio unlock failure shuts down the session instead of leaving an interval alive', async () => {
  const h = harness(); h.deps.resumeAudio = async () => { throw new Error('blocked'); };
  h.auto.start(); await flush();
  assert.deepEqual(h.auto.getSnapshot(), { active: false, status: 'error' }); assert.equal(h.timer, null);
});

test('automatic commands do not claim manual ownership, including nested commands', () => {
  const actions = new ConsoleActions(); const events: string[] = [];
  const unsubscribe = actions.subscribe(control => events.push(control));
  actions.automatic(() => { actions.manual('A.low'); actions.automatic(() => actions.manual('crossfader')); });
  actions.manual('B.transport'); assert.deepEqual(events, ['B.transport']);
  unsubscribe(); actions.manual('master'); assert.equal(events.length, 1);
  assert.throws(() => actions.automatic(() => { throw new Error('expected'); }));
  actions.subscribe(control => events.push(control)); actions.manual('A.track'); assert.equal(events.at(-1), 'A.track');
});

test('DeepSeek plans the prepared compatible pair, moves controls early and starts an early transition with one request', async () => {
  const h = harness(); let calls = 0;
  h.deps.plan = async (_reference, candidates) => {
    calls++;
    return { trackId: candidates.at(-1)!.id, enterAfterBeats: 32, transitionBeats: 8,
      adjustments: [{beat:0,control:'mid',value:40},{beat:8,control:'mid',value:50}] };
  };
  h.auto.start(); await flush();
  assert.equal(h.state.deckB.track?.id, 'two');
  await h.advance(2000); assert.equal(h.ch('A').eq.mid,40);
  await h.advance(15000); assert.equal(h.state.deckB.playbackState,'playing');
  assert.ok(h.state.deckA.currentTime < 30); assert.equal(calls,1);
  h.auto.stop(); const count=calls; await h.advance(30000); assert.equal(calls,count);
});

test('failed planner is not retried every tick or after the local deck is prepared', async () => {
  const h = harness(); let calls=0;
  h.deps.plan=async()=>{calls++;return null;}; h.auto.start(); await flush(); await h.advance(10000);
  assert.equal(calls,1); assert.ok(h.state.deckB.track); h.auto.stop();
});

test('a late DeepSeek reply cannot change decks or restart automation after stopping', async () => {
 const h=harness(); let resolve!: (value: import('../src/services/ai/mixPlan.ts').MixPlan) => void;
 let signal: AbortSignal | undefined;
 h.deps.plan=(_ref,_candidates,s)=>{signal=s; return new Promise(r=>{resolve=r;});};
 h.auto.start(); await flush(); h.auto.stop();
 assert.equal(signal?.aborted,true);
 resolve({trackId:'three',enterAfterBeats:16,transitionBeats:8,adjustments:[]}); await flush();
 assert.equal(h.state.deckB.track?.id,'two'); assert.equal(h.auto.getSnapshot().active,false); assert.equal(h.timer,null);
});

test('pending AI never blocks audible controls, deck preparation or a local mid-track transition', async () => {
 const h=harness(); let calls=0;
 h.deps.plan=(_r,_c,signal)=> { calls++; return new Promise(resolve=>signal.addEventListener('abort',()=>resolve(null),{once:true})); };
 h.auto.start(); await flush();
 await h.advance(2000);
 assert.equal(h.ch('A').eq.filter,43); assert.equal(h.ch('A').eq.mid,46);
 assert.equal(h.deck('B').track?.id,'two');
 assert.deepEqual(h.deck('A').hotCues.map(c=>c.id),[5,6,7,8]);
 await h.advance(32000);
 assert.equal(h.deck('B').playbackState,'playing'); assert.ok(h.state.mixer.crossfader>0);
 assert.equal(calls,1); h.auto.stop();
});

test('new adjustments replace old targets and deck-specific actions respect manual controls', async () => {
 const h=harness(); h.deps.plan=async()=>({trackId:'two',enterAfterBeats:64,transitionBeats:16,adjustments:[
 {beat:0,control:'mid',value:40},{beat:8,control:'mid',value:55},
 {beat:0,control:'high',value:60,deck:'B'},
 ]});
 h.auto.start(); await flush(); await h.advance(6000);
 assert.equal(h.ch('A').eq.mid,55); assert.equal(h.ch('B').eq.high,60);
 h.store.setChannelEq('B','high',30); await h.advance(4000); assert.equal(h.ch('B').eq.high,30);
 h.auto.stop();
});

test('cue creation preserves occupied slots and falls back to free slots 1–4', async () => {
 const first=track('one'); first.hotCues=[{id:5,position:3},{id:7,position:5},{id:8,position:6}] as never;
 const h=harness([first,track('two')]); h.auto.start(); await flush();
 assert.deepEqual(h.deck('A').hotCues.map(c=>c.id),[5,7,8,6,1,2,3]);
 assert.equal(h.deck('A').hotCues.find(c=>c.id===5)?.position,3);
 h.auto.stop();
});
