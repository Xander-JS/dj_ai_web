/**
 * SYSTEM DJ — Test Suite: Validaciones de duplicados
 * Canciones ya cargadas (mismo archivo o mismo contenido renombrado, también dentro de un lote)
 * y mezclas del Modo referencia ya generadas para las mismas semillas.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { importAudioFiles, type AudioImportDependencies } from '../src/services/audioImportService.ts';
import { PlaylistService, renamePlaylist } from '../src/services/playlists/playlistService.ts';
import { computeFileHash } from '../src/utils/cryptoHash.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Contenido determinista por semilla: misma semilla = mismos bytes
function audioFile(name: string, seed: number, size = 256, type = 'audio/mpeg'): File {
  const bytes = new Uint8Array(size).map((_, i) => (i * 31 + seed * 7) % 251);
  return new File([bytes], name, { type, lastModified: Date.now() });
}

describe('Importación — rechazo de canciones ya cargadas', () => {
  let storage: IndexedDBStorage;
  let deps: AudioImportDependencies;
  let saveCalls: number;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.clearAll();
    saveCalls = 0;
    deps = {
      hasDuplicate: (name, size) => storage.hasDuplicate(name, size),
      hasContentDuplicate: (hash) => storage.hasContentHash(hash),
      decodeAudioData: async () => ({ duration: 180 }) as AudioBuffer,
      computeFileHash,
      saveTrack: (track, file) => { saveCalls++; return storage.saveTrack(track, file); },
      duplicateWarning: (name) => `duplicate: ${name}`,
    };
  });

  it('rechaza el mismo archivo cargado dos veces sin tocar la pista existente', async () => {
    const first = await importAudioFiles([audioFile('tema.mp3', 1)], deps);
    const [original] = await storage.getAllTracks();
    const second = await importAudioFiles([audioFile('tema.mp3', 1)], deps);

    assert.equal(first.successCount, 1);
    assert.equal(second.successCount, 0);
    assert.deepEqual(second.duplicates, ['duplicate: tema.mp3']);
    assert.deepEqual(second.errors, []);
    const tracks = await storage.getAllTracks();
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].id, original.id);
    assert.equal(saveCalls, 1);
  });

  it('rechaza el mismo contenido con otro nombre (hash SHA-256)', async () => {
    await importAudioFiles([audioFile('tema.mp3', 1)], deps);
    const result = await importAudioFiles([audioFile('tema (copia).mp3', 1)], deps);
    assert.equal(result.successCount, 0);
    assert.deepEqual(result.duplicates, ['duplicate: tema (copia).mp3']);
    assert.equal((await storage.getAllTracks()).length, 1);
  });

  it('rechaza el duplicado aunque llegue por otro mecanismo (enlace tras archivo)', async () => {
    await importAudioFiles([audioFile('tema.mp3', 1)], deps);
    const result = await importAudioFiles([audioFile('youtube-audio.mp3', 1)], deps, { origin: 'link', requireDecodable: true });
    assert.equal(result.successCount, 0);
    assert.equal(result.duplicates.length, 1);
  });

  it('rechaza duplicados dentro del mismo lote y acepta el resto', async () => {
    const result = await importAudioFiles([
      audioFile('a.mp3', 1),
      audioFile('b.mp3', 2),
      audioFile('a-renombrado.mp3', 1),
      audioFile('a.mp3', 1),
    ], deps);
    assert.equal(result.successCount, 2);
    assert.deepEqual(result.duplicates, ['duplicate: a-renombrado.mp3', 'duplicate: a.mp3']);
    assert.equal((await storage.getAllTracks()).length, 2);
  });

  it('no bloquea canciones distintas con el mismo título', async () => {
    await importAudioFiles([audioFile('Intro.mp3', 1, 256)], deps);
    const result = await importAudioFiles([audioFile('Intro.wav', 2, 256, 'audio/wav'), audioFile('Intro.mp3', 3, 300)], deps);
    assert.equal(result.successCount, 2);
    assert.deepEqual(result.duplicates, []);
  });

  it('limitación: la misma grabación en MP3 y WAV tiene bytes distintos y no se detecta', async () => {
    // Sin huella acústica en el proyecto, solo se reconocen copias exactas del archivo
    await importAudioFiles([audioFile('tema.mp3', 1)], deps);
    const result = await importAudioFiles([audioFile('tema.wav', 9, 512, 'audio/wav')], deps);
    assert.equal(result.successCount, 1);
    assert.deepEqual(result.duplicates, []);
  });

  it('sin hash disponible conserva la comprobación por nombre y tamaño', async () => {
    const noHash = { ...deps, computeFileHash: async () => undefined };
    await importAudioFiles([audioFile('tema.mp3', 1)], noHash);
    const renamed = await importAudioFiles([audioFile('otro.mp3', 1)], noHash);
    const same = await importAudioFiles([audioFile('tema.mp3', 1)], noHash);
    assert.equal(renamed.successCount, 1);
    assert.equal(same.duplicates.length, 1);
  });
});

describe('Modo referencia — mezclas ya generadas', () => {
  let storage: IndexedDBStorage;
  let service: PlaylistService;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.clearAll();
    service = new PlaylistService(storage);
  });

  it('crea la mezcla si no existe y rechaza repetir la misma referencia', async () => {
    const created = await service.createSeedMix('Mix from A', ['a'], ['a', 'x', 'y']);
    assert.ok(created);
    assert.deepEqual(created.seedTrackIds, ['a']);
    assert.deepEqual(created.trackIds, ['a', 'x', 'y']);
    assert.equal((await service.findBySeeds(['a']))?.id, created.id);

    assert.equal(await service.createSeedMix('Mix from A', ['a'], ['a', 'x']), null);
    const all = await service.getAll();
    assert.equal(all.length, 1);
    assert.deepEqual(all[0].trackIds, ['a', 'x', 'y']);
  });

  it('el orden de dos semillas define otra referencia (inicio → cierre)', async () => {
    assert.ok(await service.createSeedMix('Mix A → B', ['a', 'b'], ['a', 'x', 'b']));
    assert.equal(await service.createSeedMix('Mix A → B', ['a', 'b'], ['a', 'b']), null);
    assert.ok(await service.createSeedMix('Mix B → A', ['b', 'a'], ['b', 'x', 'a']));
    assert.equal(await service.findBySeeds(['a']), null);
    assert.ok(await service.createSeedMix('Mix from A', ['a'], ['a', 'x']));
    assert.equal((await service.getAll()).length, 3);
  });

  it('dos peticiones simultáneas solo crean una mezcla', async () => {
    const results = await Promise.all([
      service.createSeedMix('Mix from A', ['a'], ['a', 'x']),
      service.createSeedMix('Mix from A', ['a'], ['a', 'x']),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await service.getAll()).length, 1);
  });

  it('la referencia sigue reconocida tras editar la playlist y deja de existir al eliminarla', async () => {
    const created = await service.createSeedMix('Mix from A', ['a'], ['a', 'x']);
    assert.ok(created);
    await service.update(created.id, (p) => renamePlaylist(p, 'Mi sesión'));
    assert.ok(await service.findBySeeds(['a']));
    await service.remove(created.id);
    assert.ok(await service.createSeedMix('Mix from A', ['a'], ['a', 'x']));
  });

  it('las playlists manuales no cuentan como referencia', async () => {
    const manual = await service.create('Mix from A');
    await service.update(manual.id, (p) => ({ ...p, trackIds: ['a', 'x'] }));
    assert.equal(await service.findBySeeds(['a']), null);
  });
});

describe('Avisos instantáneos de duplicados', () => {
  it('existen en español e inglés', () => {
    for (const lang of ['es', 'en']) {
      const locale = JSON.parse(read(`src/i18n/locales/${lang}/translation.json`));
      assert.ok(locale.seed.already_generated);
      assert.match(locale.library.toast.duplicates, /\{\{count\}\}/);
      assert.match(locale.library.duplicate_warning, /\{\{name\}\}/);
    }
  });

  it('se muestran como toast de advertencia y no en el historial', () => {
    const library = read('src/pages/Library.tsx');
    assert.match(library, /toastStore\.show\('warning', t\('seed\.already_generated'\)\)/);
    assert.doesNotMatch(library, /messageKey: 'seed\.already_generated'/);
    assert.match(read('src/services/localLibraryImport.ts'), /toastStore\.show\('warning'/);
    assert.match(read('src/pages/Dashboard.tsx'), /notifyDuplicateImports\(duplicates/);
  });

  it('la pila de toasts anima la entrada y la salida respetando la preferencia de animaciones', () => {
    const viewport = read('src/components/molecules/ToastViewport.tsx');
    assert.match(viewport, /<AnimatePresence/);
    assert.match(viewport, /exit=\{/);
    assert.match(viewport, /useAnimationsEnabled\(\)/);
  });
});
