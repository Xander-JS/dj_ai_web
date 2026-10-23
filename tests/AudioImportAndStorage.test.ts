/**
 * SYSTEM DJ — Audio Import & Storage Tests
 * Pruebas unitarias para validación de formatos de audio y persistencia en IndexedDB.
 */

import 'fake-indexeddb/auto';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateAudioFile, createTrackFromFile } from '../src/utils/audioValidation.ts';
import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { importAudioFiles } from '../src/services/audioImportService.ts';
import { formatDuration, formatBytes } from '../src/utils/formatters.ts';

// Helper para crear objetos File simulados
function createMockFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type, lastModified: Date.now() });
}

describe('audioValidation — Validación de Archivos de Audio', () => {
  test('Acepta archivo MP3 con tipo MIME estándar', () => {
    const file = createMockFile('cancion.mp3', 5000000, 'audio/mpeg');
    const result = validateAudioFile(file);
    assert.equal(result.valid, true);
    assert.equal(result.format, 'mp3');
  });

  test('Acepta archivo WAV con tipo MIME estándar', () => {
    const file = createMockFile('grabacion.wav', 12000000, 'audio/wav');
    const result = validateAudioFile(file);
    assert.equal(result.valid, true);
    assert.equal(result.format, 'wav');
  });

  test('Acepta archivo MP3 con tipo MIME vacío si la extensión es válida', () => {
    const file = createMockFile('track.mp3', 3000000, '');
    const result = validateAudioFile(file);
    assert.equal(result.valid, true);
    assert.equal(result.format, 'mp3');
  });

  test('Acepta archivo WAV con MIME genérico application/octet-stream', () => {
    const file = createMockFile('track.wav', 4000000, 'application/octet-stream');
    const result = validateAudioFile(file);
    assert.equal(result.valid, true);
    assert.equal(result.format, 'wav');
  });

  test('Rechaza archivo vacío (0 bytes)', () => {
    const file = createMockFile('vacio.mp3', 0, 'audio/mpeg');
    const result = validateAudioFile(file);
    assert.equal(result.valid, false);
    assert.match(result.error || '', /vacío/i);
  });

  test('Rechaza extensiones no admitidas (.flac, .ogg, .txt)', () => {
    const fileFlac = createMockFile('pista.flac', 100000, 'audio/flac');
    const resultFlac = validateAudioFile(fileFlac);
    assert.equal(resultFlac.valid, false);

    const fileTxt = createMockFile('notas.txt', 1000, 'text/plain');
    const resultTxt = validateAudioFile(fileTxt);
    assert.equal(resultTxt.valid, false);
  });

  test('createTrackFromFile genera metadatos limpios con análisis en "pending"', () => {
    const file = createMockFile('Mi_Tema_Favorito.mp3', 4500000, 'audio/mpeg');
    const track = createTrackFromFile(file, 215.4);

    assert.equal(track.title, 'Mi_Tema_Favorito');
    assert.equal(track.duration, 215.4);
    assert.equal(track.durationFormatted, '3:35');
    assert.equal(track.analysis.status, 'pending');
    assert.equal(track.analysis.bpm, undefined);
    assert.equal(track.analysis.key, undefined);
    assert.equal(track.fileMeta?.fileName, 'Mi_Tema_Favorito.mp3');
    assert.equal(track.fileMeta?.fileSize, 4500000);
  });
});

describe('audioImportService — política actual de importación', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.clearAll();
  });

  test('persists an accepted file with duration 0 when duration decoding rejects, and reports it as imported', async () => {
    const file = createMockFile('undecodable.mp3', 32, 'audio/mpeg');
    const result = await importAudioFiles([file], {
      hasDuplicate: (name, size) => storage.hasDuplicate(name, size),
      decodeAudioData: async () => { throw new Error('decode rejected'); },
      computeFileHash: async () => 'test-hash',
      saveTrack: (track, source) => storage.saveTrack(track, source),
      duplicateWarning: (name) => `duplicate: ${name}`,
    });

    const tracks = await storage.getAllTracks();
    assert.equal(result.successCount, 1);
    assert.deepEqual(result.errors, []);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].duration, 0);
    assert.equal(tracks[0].durationFormatted, '0:00');
    assert.equal(tracks[0].analysis.status, 'pending');
  });

  test('rejects empty and unsupported files before attempting decode or persistence', async () => {
    const files = [
      createMockFile('empty.wav', 0, 'audio/wav'),
      createMockFile('document.txt', 4, 'text/plain'),
    ];
    let decodeCalls = 0;
    let saveCalls = 0;
    const result = await importAudioFiles(files, {
      hasDuplicate: async () => false,
      decodeAudioData: async () => { decodeCalls += 1; throw new Error('unexpected'); },
      computeFileHash: async () => 'unused',
      saveTrack: async () => { saveCalls += 1; return { persisted: true }; },
      duplicateWarning: (name) => `duplicate: ${name}`,
    });

    assert.equal(result.successCount, 0);
    assert.equal(result.errors.length, 2);
    assert.equal(decodeCalls, 0);
    assert.equal(saveCalls, 0);
  });
});

describe('formatters — Utilidades de Formato', () => {
  test('formatDuration formatea segundos a mm:ss y hh:mm:ss', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(65), '1:05');
    assert.equal(formatDuration(3665), '1:01:05');
    assert.equal(formatDuration(-5), '0:00');
  });

  test('formatBytes formatea bytes a KB y MB', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(5242880), '5 MB');
  });
});

describe('IndexedDBStorage — Persistencia Local Real y Respaldo', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.clearAll();
  });

  test('Guarda y lista pistas en el almacén de IndexedDB real confirmando persisted: true', async () => {
    const file = createMockFile('session1.mp3', 3000000, 'audio/mpeg');
    const track = createTrackFromFile(file, 120);

    const result = await storage.saveTrack(track, file);
    assert.equal(result.persisted, true);
    assert.equal(storage.isMemoryOnly(track.id), false);

    const all = await storage.getAllTracks();
    assert.equal(all.length, 1);
    assert.equal(all[0].title, 'session1');
    assert.equal(all[0].fileMeta?.fileSize, 3000000);
  });

  test('hasDuplicate detecta duplicados por nombre de archivo y tamaño en IndexedDB', async () => {
    const file = createMockFile('loop.wav', 1000000, 'audio/wav');
    const track = createTrackFromFile(file, 45);

    await storage.saveTrack(track, file);

    const isDuplicate = await storage.hasDuplicate('loop.wav', 1000000);
    assert.equal(isDuplicate, true);

    const differentSize = await storage.hasDuplicate('loop.wav', 2000000);
    assert.equal(differentSize, false);

    const differentName = await storage.hasDuplicate('other.wav', 1000000);
    assert.equal(differentName, false);
  });

  test('getTrackBlob recupera el Blob original desde IndexedDB', async () => {
    const file = createMockFile('song.mp3', 2048, 'audio/mpeg');
    const track = createTrackFromFile(file, 180);

    await storage.saveTrack(track, file);
    const retrievedBlob = await storage.getTrackBlob(track.id);

    assert.ok(retrievedBlob);
    assert.equal(retrievedBlob.size, 2048);
  });

  test('deleteTrack elimina la pista correctamente de IndexedDB', async () => {
    const file = createMockFile('temp.mp3', 500, 'audio/mpeg');
    const track = createTrackFromFile(file, 30);

    await storage.saveTrack(track, file);
    let all = await storage.getAllTracks();
    assert.equal(all.length, 1);

    await storage.deleteTrack(track.id);
    all = await storage.getAllTracks();
    assert.equal(all.length, 0);
  });

  test('Persiste datos en IndexedDB entre instancias independientes (sin memoria compartida)', async () => {
    const file = createMockFile('persistent_beat.mp3', 4096, 'audio/mpeg');
    const track = createTrackFromFile(file, 180.0);

    // Guardar con la instancia 1
    const saveResult = await storage.saveTrack(track, file);
    assert.equal(saveResult.persisted, true);

    // Crear una nueva instancia independiente que nace con su memoryStore completamente vacío
    const freshInstance = new IndexedDBStorage();
    const tracksFromDb = await freshInstance.getAllTracks();

    assert.equal(tracksFromDb.length, 1);
    assert.equal(tracksFromDb[0].id, track.id);
    assert.equal(tracksFromDb[0].title, 'persistent_beat');

    // Recuperar el Blob binario real desde la nueva instancia
    const blobFromDb = await freshInstance.getTrackBlob(track.id);
    assert.ok(blobFromDb);
    assert.equal(blobFromDb.size, 4096);
  });

  test('Fallback en memoria cuando IndexedDB no está disponible o falla (isMemoryOnly)', async () => {
    // Instancia simulada que no cuenta con soporte IndexedDB
    const fallbackStorage = new IndexedDBStorage();
    // Forzar isSupported a false para ejercitar la rama de fallback
    (fallbackStorage as unknown as { isSupported: boolean }).isSupported = false;

    const file = createMockFile('fallback_track.wav', 1024, 'audio/wav');
    const track = createTrackFromFile(file, 60.0);

    const saveResult = await fallbackStorage.saveTrack(track, file);
    assert.equal(saveResult.persisted, false);
    assert.equal(saveResult.reason, 'unsupported');
    assert.equal(fallbackStorage.isMemoryOnly(track.id), true);

    // La pista debe estar disponible en memoria para la sesión
    const tracks = await fallbackStorage.getAllTracks();
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].title, 'fallback_track');

    const blob = await fallbackStorage.getTrackBlob(track.id);
    assert.ok(blob);
    assert.equal(blob.size, 1024);

    // Eliminación limpia de la memoria
    await fallbackStorage.deleteTrack(track.id);
    const afterDelete = await fallbackStorage.getAllTracks();
    assert.equal(afterDelete.length, 0);
    assert.equal(fallbackStorage.isMemoryOnly(track.id), false);
  });
});
