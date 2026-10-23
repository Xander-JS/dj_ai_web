/**
 * SYSTEM DJ — Test Suite: Gestión Local de Playlists
 * Operaciones puras de edición, persistencia en IndexedDB y coherencia al eliminar pistas.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import {
  PlaylistService,
  buildPlaylist,
  renamePlaylist,
  addTracksToPlaylist,
  removeTrackFromPlaylist,
  moveTrackInPlaylist,
  normalizePlaylistName,
} from '../src/services/playlists/playlistService.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';

function createTestAudioFile(name = 'track.mp3', size = 5120): File {
  return new File([new Uint8Array(size)], name, { type: 'audio/mpeg', lastModified: Date.now() });
}

describe('Playlists — operaciones puras', () => {
  it('normaliza nombres y rechaza nombres vacíos', () => {
    assert.equal(normalizePlaylistName('  Deep   House  '), 'Deep House');
    assert.equal(normalizePlaylistName('   '), null);
    assert.throws(() => buildPlaylist('  ', 0));
  });

  it('añade sin duplicar, quita, reordena y renombra de forma inmutable', () => {
    const base = buildPlaylist('Set', 0, 1);
    const added = addTracksToPlaylist(base, ['a', 'b', 'a', 'c'], 2);
    assert.deepEqual(added.trackIds, ['a', 'b', 'c']);
    assert.deepEqual(base.trackIds, []);
    assert.equal(addTracksToPlaylist(added, ['a'], 3), added);

    const moved = moveTrackInPlaylist(added, 2, 0, 4);
    assert.deepEqual(moved.trackIds, ['c', 'a', 'b']);
    assert.equal(moveTrackInPlaylist(added, 0, 5, 4), added);

    const removed = removeTrackFromPlaylist(moved, 'a', 5);
    assert.deepEqual(removed.trackIds, ['c', 'b']);
    assert.equal(removed.updatedAt, 5);

    assert.equal(renamePlaylist(removed, ' Peak Time ', 6).name, 'Peak Time');
  });
});

describe('Playlists — persistencia en IndexedDB', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.clearAll();
  });

  afterEach(async () => {
    await storage.clearAll();
  });

  it('las playlists y su orden sobreviven a un arranque en frío', async () => {
    const service = new PlaylistService(storage);
    const created = await service.create('Warm Up');
    await service.update(created.id, (p) => addTracksToPlaylist(p, ['t1', 't2', 't3']));
    await service.update(created.id, (p) => moveTrackInPlaylist(p, 2, 0));

    const coldStorage = new IndexedDBStorage();
    const restored = await coldStorage.getAllPlaylists();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].name, 'Warm Up');
    assert.deepEqual(restored[0].trackIds, ['t3', 't1', 't2']);
  });

  it('eliminar una playlist no borra pistas y notifica a los suscriptores', async () => {
    const service = new PlaylistService(storage);
    let changes = 0;
    service.subscribe(() => changes++);

    const track = createTrackFromFile(createTestAudioFile('keep.mp3'), 120);
    await storage.saveTrack(track, createTestAudioFile('keep.mp3'));
    const created = await service.create('Temp');
    await service.update(created.id, (p) => addTracksToPlaylist(p, [track.id]));
    await service.remove(created.id);

    assert.equal((await new IndexedDBStorage().getAllPlaylists()).length, 0);
    assert.ok(await storage.hasTrack(track.id));
    assert.equal(changes, 3);
  });

  it('eliminar una pista de la biblioteca la retira de todas las playlists', async () => {
    const service = new PlaylistService(storage);
    const keep = createTrackFromFile(createTestAudioFile('keep.mp3'), 120);
    const drop = createTrackFromFile(createTestAudioFile('drop.mp3', 6000), 90);
    await storage.saveTrack(keep, createTestAudioFile('keep.mp3'));
    await storage.saveTrack(drop, createTestAudioFile('drop.mp3', 6000));

    const a = await service.create('A');
    const b = await service.create('B');
    await service.update(a.id, (p) => addTracksToPlaylist(p, [drop.id, keep.id]));
    await service.update(b.id, (p) => addTracksToPlaylist(p, [drop.id]));

    await storage.deleteTrack(drop.id);

    const restored = await new IndexedDBStorage().getAllPlaylists();
    const byName = new Map(restored.map((p) => [p.name, p.trackIds]));
    assert.deepEqual(byName.get('A'), [keep.id]);
    assert.deepEqual(byName.get('B'), []);
  });
});
