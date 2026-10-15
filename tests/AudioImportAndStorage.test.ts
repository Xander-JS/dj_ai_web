/**
 * SYSTEM DJ — Audio Import & Storage Tests
 * Pruebas unitarias para validación de formatos de audio y persistencia en IndexedDB.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateAudioFile, createTrackFromFile } from '../src/utils/audioValidation.ts';
import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
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

describe('IndexedDBStorage — Persistencia Local y Respaldo', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.clearAll();
  });

  test('Guarda y lista pistas en el almacén de respaldo', async () => {
    const file = createMockFile('session1.mp3', 3000000, 'audio/mpeg');
    const track = createTrackFromFile(file, 120);

    await storage.saveTrack(track, file);
    const all = await storage.getAllTracks();

    assert.equal(all.length, 1);
    assert.equal(all[0].title, 'session1');
    assert.equal(all[0].fileMeta?.fileSize, 3000000);
  });

  test('hasDuplicate detecta duplicados por nombre de archivo y tamaño', async () => {
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

  test('getTrackBlob recupera el Blob original', async () => {
    const file = createMockFile('song.mp3', 2048, 'audio/mpeg');
    const track = createTrackFromFile(file, 180);

    await storage.saveTrack(track, file);
    const retrievedBlob = await storage.getTrackBlob(track.id);

    assert.ok(retrievedBlob);
    assert.equal(retrievedBlob.size, 2048);
  });

  test('deleteTrack elimina la pista correctamente', async () => {
    const file = createMockFile('temp.mp3', 500, 'audio/mpeg');
    const track = createTrackFromFile(file, 30);

    await storage.saveTrack(track, file);
    let all = await storage.getAllTracks();
    assert.equal(all.length, 1);

    await storage.deleteTrack(track.id);
    all = await storage.getAllTracks();
    assert.equal(all.length, 0);
  });
});
