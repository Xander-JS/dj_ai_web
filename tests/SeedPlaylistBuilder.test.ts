/**
 * SYSTEM DJ — Test Suite: Modo Referencia (Semillas)
 * Secuenciador determinista desde pistas de referencia y almacén de semillas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildPlaylistFromSeeds, scoreTransition, MAX_SEED_TRACKS } from '../src/engine/playlistBuilder.ts';
import { SeedStore } from '../src/store/useSeedStore.ts';
import type { Track } from '../src/types/track.ts';

function track(id: string, bpm?: number, key?: string, energy?: number): Track {
  return {
    id,
    title: id,
    artist: 'Test',
    duration: 300,
    durationFormatted: '5:00',
    type: 'audio',
    source: { type: 'indexeddb' },
    analysis: bpm === undefined && key === undefined
      ? { status: 'pending' }
      : { status: 'analyzed', bpm, key, energy },
    dateAdded: 0,
  };
}

describe('playlistBuilder — secuenciación desde semillas', () => {
  it('rechaza cero o más de dos semillas', () => {
    assert.equal(buildPlaylistFromSeeds({ seedTracks: [], candidates: [] }).error, 'no_seeds');
    const many = [track('a', 120, 'Am'), track('b', 120, 'Am'), track('c', 120, 'Am')];
    assert.equal(buildPlaylistFromSeeds({ seedTracks: many, candidates: [] }).error, 'too_many_seeds');
  });

  it('con una semilla arranca en ella, encadena transiciones compatibles y omite pistas sin análisis', () => {
    const seed = track('seed', 124, 'Am');
    const good = track('good', 125, 'Em');           // 8A → 9A, tempo en rango
    const next = track('next', 126, 'Bm');           // 9A → 10A
    const clash = track('clash', 170, 'F#');         // fuera de tempo y armonía
    const raw = track('raw');
    const result = buildPlaylistFromSeeds({ seedTracks: [seed], candidates: [raw, clash, next, good, seed] });

    assert.equal(result.trackIds[0], 'seed');
    assert.deepEqual(result.trackIds, ['seed', 'good', 'next']);
    assert.equal(result.skippedWithoutAnalysis, 1);
    assert.equal(scoreTransition(seed, clash), 0);
  });

  it('con dos semillas termina en la segunda y respeta la longitud máxima', () => {
    const start = track('start', 124, 'Am');
    const end = track('end', 126, 'Bm');
    const candidates = ['m1', 'm2', 'm3', 'm4'].map((id) => track(id, 125, 'Em'));
    const result = buildPlaylistFromSeeds({ seedTracks: [start, end], candidates, maxLength: 4 });

    assert.equal(result.trackIds.length, 4);
    assert.equal(result.trackIds[0], 'start');
    assert.equal(result.trackIds[3], 'end');
    assert.equal(new Set(result.trackIds).size, 4);
  });
});

describe('SeedStore — selección de pistas de referencia', () => {
  it('alterna, limita a dos reemplazando la más antigua e intercambia el orden', () => {
    const store = new SeedStore();
    let changes = 0;
    store.subscribe(() => changes++);

    assert.deepEqual(store.toggleSeed('a'), { action: 'added' });
    store.toggleSeed('b');
    assert.equal(store.getSnapshot().length, MAX_SEED_TRACKS);
    assert.deepEqual(store.toggleSeed('c'), { action: 'replaced', replacedId: 'a' });
    assert.deepEqual(store.getSnapshot(), ['b', 'c']);

    store.swapSeeds();
    assert.deepEqual(store.getSnapshot(), ['c', 'b']);
    assert.deepEqual(store.toggleSeed('c'), { action: 'removed' });
    store.removeSeed('missing');
    store.clearSeeds();
    assert.deepEqual(store.getSnapshot(), []);
    assert.equal(changes, 6);
  });
});
