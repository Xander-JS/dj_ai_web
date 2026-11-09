import test from 'node:test';
import assert from 'node:assert/strict';
import { TransitionPlayer } from '../src/audio/transitionPlayer.ts';

test('fallback transition moves real target and cancellation removes its timer', () => {
  let now = 0;
  let callback: (() => void) | null = null;
  let position = 0;
  const player = new TransitionPlayer({ now: () => now, setInterval: fn => { callback = fn; return 1; }, clearInterval: () => { callback = null; } });
  player.connect({ getCrossfader: () => position, setCrossfader: value => { position = value; }, getDeckBpm: () => null });
  assert.equal(player.start('A'), false);
  assert.equal(player.start('A', 8), true);
  now = 4000;
  (callback as unknown as () => void)();
  assert.equal(position, 50);
  player.cancel();
  assert.equal(callback, null);
  assert.equal(position, 50);
  assert.equal(player.isActive(), false);
});
