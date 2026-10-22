/**
 * SYSTEM DJ — Fase 23.4: Etapa C.2
 * Suite de Pruebas: Modelo de Datos, Invariantes y Persistencia de BAR SYNC V1
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { computeFileHash } from '../src/utils/cryptoHash.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import {
  createSuggestedDownbeat,
  createManualDownbeatConfirmation,
  isDownbeatConfirmed,
  getEffectiveConfirmedDownbeat,
  validateDownbeatForContent,
} from '../src/utils/downbeat.ts';
import type { Track, TrackDownbeat } from '../src/types/track.ts';

describe('Fase 23.4: Etapa C.2 — Modelo de Datos y Persistencia de Downbeat (BAR SYNC V1)', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.init();
  });

  // 1. Una sugerencia no cuenta como confirmación.
  it('1. Una sugerencia preliminar no cuenta como confirmación de compás ni downbeat', () => {
    const suggested = createSuggestedDownbeat(0.450);
    assert.equal(suggested.status, 'suggested');
    assert.equal(suggested.suggestedPosition, 0.450);
    assert.equal(suggested.confirmation, null);

    // isDownbeatConfirmed debe ser falso
    assert.equal(isDownbeatConfirmed(suggested), false);
    assert.equal(isDownbeatConfirmed(suggested, 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'), false);
    assert.equal(getEffectiveConfirmedDownbeat(suggested), null);

    // Una pista con solo firstBeatTime en el análisis no tiene confirmación
    const file = new File([new TextEncoder().encode('audio_content_1')], 'test1.mp3');
    const track = createTrackFromFile(file, 120);
    track.analysis = {
      status: 'analyzed',
      bpm: 120,
      firstBeatTime: 0.450,
    };
    track.downbeat = suggested;

    assert.equal(isDownbeatConfirmed(track.downbeat), false);
    assert.equal(track.downbeat?.confirmation, null);
  });

  // 2. Una confirmación válida queda asociada a su contenido.
  it('2. Una confirmación válida queda asociada de forma inmutable a su contentHash y persiste', async () => {
    const file = new File([new TextEncoder().encode('audio_content_for_test_2')], 'test2.mp3');
    const hash = await computeFileHash(file);
    const track = createTrackFromFile(file, 120, hash);
    track.id = 'track_c2_valid';

    const confirmedDownbeat = createManualDownbeatConfirmation({
      position: 1.250,
      beatsPerBar: 4,
      contentHash: hash,
      suggestedPosition: 0.450,
    });

    track.downbeat = confirmedDownbeat;
    const saveRes = await storage.saveTrack(track, file);
    assert.equal(saveRes.persisted, true);

    // Lectura completa
    const stored = await storage.getTrack('track_c2_valid');
    assert.ok(stored);
    assert.equal(stored?.downbeat?.status, 'confirmed');
    assert.equal(stored?.downbeat?.suggestedPosition, 0.450);
    assert.ok(stored?.downbeat?.confirmation);
    assert.equal(stored?.downbeat?.confirmation?.position, 1.250);
    assert.equal(stored?.downbeat?.confirmation?.beatsPerBar, 4);
    assert.equal(stored?.downbeat?.confirmation?.contentHash, hash);
    assert.equal(stored?.downbeat?.confirmation?.source, 'manual');

    // Comprobación de invariante con el método específico getTrackDownbeat
    const downbeatOnly = await storage.getTrackDownbeat('track_c2_valid');
    assert.ok(downbeatOnly);
    assert.equal(isDownbeatConfirmed(downbeatOnly, hash), true);
    assert.equal(isDownbeatConfirmed(downbeatOnly, 'different_hash_000000000000000000000000000000000000000000000000000000000000'), false);
  });

  // 3. Un cambio de contentHash invalida la confirmación.
  it('3. Un cambio de contentHash en el archivo invalida forzosamente la confirmación previa', async () => {
    const fileA = new File([new TextEncoder().encode('original_audio_content_3A')], 'song3.mp3');
    const hashA = await computeFileHash(fileA);
    const track = createTrackFromFile(fileA, 120, hashA);
    track.id = 'track_c3_hash_change';

    track.downbeat = createManualDownbeatConfirmation({
      position: 2.100,
      beatsPerBar: 4,
      contentHash: hashA,
    });

    await storage.saveTrack(track, fileA);
    const storedA = await storage.getTrack('track_c3_hash_change');
    assert.equal(storedA?.downbeat?.status, 'confirmed');

    // Se sustituye el archivo físico bajo el mismo trackId con un contenido distinto (hashB)
    const fileB = new File([new TextEncoder().encode('modified_audio_content_3B_different')], 'song3.mp3');
    const hashB = await computeFileHash(fileB);
    assert.notEqual(hashA, hashB);

    const trackNewContent: Track = {
      ...storedA!,
      source: { type: 'indexeddb', blob: fileB, indexedDbKey: 'track_c3_hash_change' },
      fileMeta: {
        fileName: 'song3.mp3',
        fileSize: fileB.size,
        mimeType: 'audio/mpeg',
        lastModified: Date.now(),
        contentHash: hashB,
      },
      downbeat: undefined, // Simula guardado sin especificar nuevo downbeat
    };

    await storage.saveTrack(trackNewContent, fileB);

    const storedB = await storage.getTrack('track_c3_hash_change');
    assert.ok(storedB);
    // La confirmación previa de hashA debe haber sido invalidada (null)
    assert.equal(storedB?.downbeat, null);
    assert.equal(isDownbeatConfirmed(storedB?.downbeat), false);
  });

  // 4. La ausencia de contentHash no permite reutilizar una confirmación antigua.
  it('4. La ausencia de contentHash demostrable impide reutilizar o persistir una confirmación', async () => {
    const rawFile = new File([new TextEncoder().encode('unhashed_file_4')], 'unhashed.mp3');

    // Insertar un registro real sin contentHash en IndexedDB
    const db = await storage.init();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      store.put({
        id: 'track_c4_unhashed',
        title: 'Unhashed Song',
        artist: 'Artist',
        duration: 120,
        durationFormatted: '2:00',
        type: 'audio',
        audioBlob: rawFile,
        fileMeta: {
          fileName: 'unhashed.mp3',
          fileSize: rawFile.size,
          mimeType: 'audio/mpeg',
          lastModified: 1000,
        },
        analysis: { status: 'pending' },
        dateAdded: 1000,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const fakeHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const attemptedConfirmation = createManualDownbeatConfirmation({
      position: 1.5,
      beatsPerBar: 4,
      contentHash: fakeHash,
    });

    // Validar con la utilidad pura de dominio: sin hash del contenido, se invalida
    const validated = validateDownbeatForContent(attemptedConfirmation, undefined);
    assert.equal(isDownbeatConfirmed(validated), false);
    assert.equal(validated?.confirmation, null);

    // Intentar actualizar vía updateTrackDownbeat en registro que carece de contentHash
    const updateSuccess = await storage.updateTrackDownbeat('track_c4_unhashed', attemptedConfirmation, fakeHash);
    assert.equal(updateSuccess, false);

    // El registro persistido debe permanecer sin confirmación
    const stored = await storage.getTrack('track_c4_unhashed');
    assert.equal(stored?.downbeat, null);
    assert.equal(isDownbeatConfirmed(stored?.downbeat), false);
  });

  // 5. Una métrica elegida explícitamente se conserva correctamente.
  it('5. Una métrica explícita (ej. compás ternario 3/4) se conserva exactamente como la eligió el usuario', async () => {
    const file = new File([new TextEncoder().encode('waltz_track_5_ternary')], 'waltz.mp3');
    const hash = await computeFileHash(file);
    const track = createTrackFromFile(file, 180, hash);
    track.id = 'track_c5_ternary';

    // El usuario define compás ternario explícito (beatsPerBar = 3)
    track.downbeat = createManualDownbeatConfirmation({
      position: 0.850,
      beatsPerBar: 3,
      contentHash: hash,
      suggestedPosition: 0.280,
    });

    await storage.saveTrack(track, file);

    const stored = await storage.getTrack('track_c5_ternary');
    assert.ok(stored);
    assert.equal(stored?.downbeat?.confirmation?.beatsPerBar, 3);
    assert.equal(stored?.downbeat?.confirmation?.position, 0.850);
    assert.equal(stored?.downbeat?.confirmation?.source, 'manual');
  });

  // 6. Una métrica ausente no se interpreta como una métrica musical confirmada.
  it('6. Una métrica ausente no se asume como 4/4 ni como verdad musical confirmada', () => {
    // Pista sin confirmación manual
    const downbeatOnlySuggested = createSuggestedDownbeat(0.500);
    assert.equal(downbeatOnlySuggested.confirmation, null);
    assert.equal(downbeatOnlySuggested.confirmation?.beatsPerBar, undefined);
    assert.equal(isDownbeatConfirmed(downbeatOnlySuggested), false);

    // Pista con status: 'none'
    const noneDownbeat: TrackDownbeat = { status: 'none', suggestedPosition: null, confirmation: null };
    assert.equal(noneDownbeat.confirmation?.beatsPerBar, undefined);
    assert.equal(isDownbeatConfirmed(noneDownbeat), false);
  });

  // 7. Los registros antiguos siguen leyéndose correctamente (compatibilidad hacia atrás).
  it('7. Registros heredados de IndexedDB sin campo downbeat se leen correctamente sin errores', async () => {
    const rawContent = new TextEncoder().encode('antique_song_c7');
    const legacyFile = new File([rawContent], 'antique.mp3');

    // Insertar directamente en IndexedDB simulando una base de datos creada en una versión anterior
    const db = await storage.init();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction('tracks', 'readwrite');
      const store = tx.objectStore('tracks');
      store.put({
        id: 'legacy_track_c7',
        title: 'Legacy Song',
        artist: 'Old Artist',
        duration: 150,
        durationFormatted: '2:30',
        type: 'audio',
        audioBlob: legacyFile,
        fileMeta: {
          fileName: 'antique.mp3',
          fileSize: legacyFile.size,
          mimeType: 'audio/mpeg',
          lastModified: 1000,
        },
        analysis: { status: 'analyzed', bpm: 120.0 },
        mainCue: 10.0,
        hotCues: [],
        dateAdded: 1000,
        // Sin campo downbeat
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const track = await storage.getTrack('legacy_track_c7');
    assert.ok(track);
    assert.equal(track?.id, 'legacy_track_c7');
    assert.equal(track?.downbeat, null);

    const downbeat = await storage.getTrackDownbeat('legacy_track_c7');
    assert.equal(downbeat, null);
    assert.equal(isDownbeatConfirmed(downbeat), false);
  });

  // 8. Dos pistas diferentes no comparten confirmaciones aunque sus identificadores se reutilicen.
  it('8. Dos pistas diferentes con contenidos distintos no comparten confirmaciones aunque coincida el ID', async () => {
    const file1 = new File([new TextEncoder().encode('track_one_bytes_8')], 'song1.mp3');
    const hash1 = await computeFileHash(file1);

    const file2 = new File([new TextEncoder().encode('track_two_bytes_8_different')], 'song2.mp3');
    const hash2 = await computeFileHash(file2);
    assert.notEqual(hash1, hash2);

    // Confirmación creada para la pista 1 con hash1
    const confirmationForTrack1 = createManualDownbeatConfirmation({
      position: 1.0,
      beatsPerBar: 4,
      contentHash: hash1,
    });

    // Se intenta asociar confirmationForTrack1 a una pista con file2 (hash2)
    const track2 = createTrackFromFile(file2, 120, hash2);
    track2.id = 'reused_id_8';
    track2.downbeat = confirmationForTrack1; // Trae hash1 erróneamente

    await storage.saveTrack(track2, file2);

    const stored2 = await storage.getTrack('reused_id_8');
    assert.ok(stored2);
    // saveTrack debe haber invalidado la confirmación ajena
    assert.equal(isDownbeatConfirmed(stored2?.downbeat, hash2), false);
    assert.equal(stored2?.downbeat, null);
  });

  // 9. Las operaciones de persistencia obsoletas no sobrescriben confirmaciones correspondientes a otro contenido.
  it('9. Operación obsoleta con expectedContentHash no sobrescribe confirmaciones de un contenido posterior', async () => {
    const fileA = new File([new TextEncoder().encode('audio_A_race_9')], 'audioA.mp3');
    const hashA = await computeFileHash(fileA);
    const trackA = createTrackFromFile(fileA, 120, hashA);
    trackA.id = 'track_c9_race';
    await storage.saveTrack(trackA, fileA);

    // Mientras tanto, la pista se actualiza en el almacenamiento con contenido B
    const fileB = new File([new TextEncoder().encode('audio_B_race_9_newer')], 'audioB.mp3');
    const hashB = await computeFileHash(fileB);
    const trackB = createTrackFromFile(fileB, 130, hashB);
    trackB.id = 'track_c9_race';
    trackB.downbeat = createManualDownbeatConfirmation({
      position: 2.500,
      beatsPerBar: 4,
      contentHash: hashB,
    });
    await storage.saveTrack(trackB, fileB);

    // Llega una confirmación rezagada que pretendía actualizar la versión A (con hashA)
    const staleDownbeatA = createManualDownbeatConfirmation({
      position: 0.500,
      beatsPerBar: 4,
      contentHash: hashA,
    });

    const success = await storage.updateTrackDownbeat('track_c9_race', staleDownbeatA, hashA);
    // La operación obsoleta debe ser rechazada porque el contenido en DB ya es hashB
    assert.equal(success, false);

    // El registro en la base de datos debe permanecer con la confirmación de hashB
    const current = await storage.getTrack('track_c9_race');
    assert.equal(current?.downbeat?.confirmation?.contentHash, hashB);
    assert.equal(current?.downbeat?.confirmation?.position, 2.500);
  });

  // 10. Reimportación idéntica mediante createTrackFromFile y saveTrack no borra la confirmación previa.
  it('10. Reimportar un archivo idéntico (mismo hash) preserva la confirmación previa sin borrarla', async () => {
    const file = new File([new TextEncoder().encode('reimport_audio_c10')], 'song10.mp3');
    const hash = await computeFileHash(file);

    // 1. Guardar pista inicial
    const track1 = createTrackFromFile(file, 120, hash);
    track1.id = 'track_c10_reimport';
    track1.downbeat = createManualDownbeatConfirmation({
      position: 1.750,
      beatsPerBar: 4,
      contentHash: hash,
    });
    await storage.saveTrack(track1, file);

    const stored1 = await storage.getTrack('track_c10_reimport');
    assert.ok(stored1?.downbeat?.confirmation);
    assert.equal(stored1?.downbeat?.confirmation?.position, 1.750);

    // 2. Simular reimportación del mismo archivo (genera nueva entidad Track con createTrackFromFile)
    const reimportedTrack = createTrackFromFile(file, 120, hash);
    reimportedTrack.id = 'track_c10_reimport'; // Mismo ID asignado en la biblioteca

    // Al guardar la reimportación, evaluateIdentityAndMerge debe preservar la confirmación
    await storage.saveTrack(reimportedTrack, file);

    const stored2 = await storage.getTrack('track_c10_reimport');
    assert.ok(stored2);
    assert.equal(isDownbeatConfirmed(stored2?.downbeat, hash), true);
    assert.equal(stored2?.downbeat?.confirmation?.position, 1.750);
    assert.equal(stored2?.downbeat?.confirmation?.beatsPerBar, 4);
    assert.equal(stored2?.downbeat?.confirmation?.contentHash, hash);
  });

  // 11. Fallo de escritura en IndexedDB no contamina memoryStore.
  it('11. Fallo o rechazo en la transacción de IndexedDB no contamina el almacén en memoria', async () => {
    const file = new File([new TextEncoder().encode('audio_c11_memory_safety')], 'song11.mp3');
    const hashA = await computeFileHash(file);
    const track = createTrackFromFile(file, 120, hashA);
    track.id = 'track_c11_safety';
    track.downbeat = createManualDownbeatConfirmation({
      position: 1.000,
      beatsPerBar: 4,
      contentHash: hashA,
    });
    await storage.saveTrack(track, file);

    // Intentar actualizar con una confirmación que tiene hash diferente al de la pista persistida
    const fakeOtherHash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const invalidDownbeat = createManualDownbeatConfirmation({
      position: 3.000,
      beatsPerBar: 4,
      contentHash: fakeOtherHash,
    });

    const success = await storage.updateTrackDownbeat('track_c11_safety', invalidDownbeat, fakeOtherHash);
    assert.equal(success, false);

    // Verificar que getTrackDownbeat (que consulta memoryStore primero) NO devuelva el downbeat rechazado
    const downbeatAfter = await storage.getTrackDownbeat('track_c11_safety');
    assert.ok(downbeatAfter);
    assert.equal(downbeatAfter?.confirmation?.contentHash, hashA);
    assert.equal(downbeatAfter?.confirmation?.position, 1.000);
  });

  // 12. Estado confirmed contradictorio o con valores inválidos.
  it('12. Estados confirmed contradictorios o con métricas/posiciones inválidas son rechazados', async () => {
    const file = new File([new TextEncoder().encode('audio_c12_invalid_vals')], 'song12.mp3');
    const hash = await computeFileHash(file);
    const track = createTrackFromFile(file, 120, hash);
    track.id = 'track_c12_invalid';
    await storage.saveTrack(track, file);

    // A. status: 'confirmed' con confirmation: null
    const contradictoryDownbeat: TrackDownbeat = {
      status: 'confirmed',
      suggestedPosition: 0.5,
      confirmation: null,
    };
    assert.equal(isDownbeatConfirmed(contradictoryDownbeat, hash), false);
    const saneA = validateDownbeatForContent(contradictoryDownbeat, hash);
    assert.equal(saneA?.status, 'suggested');
    assert.equal(saneA?.confirmation, null);

    const updateResA = await storage.updateTrackDownbeat('track_c12_invalid', contradictoryDownbeat as TrackDownbeat, hash);
    assert.equal(updateResA, false);

    // B. Posición negativa en confirmación
    const negativePosDownbeat: TrackDownbeat = {
      status: 'confirmed',
      confirmation: {
        position: -1.25,
        beatsPerBar: 4,
        contentHash: hash,
        confirmedAt: Date.now(),
        source: 'manual',
      },
    };
    assert.equal(isDownbeatConfirmed(negativePosDownbeat, hash), false);
    const saneB = validateDownbeatForContent(negativePosDownbeat, hash);
    assert.equal(saneB?.status, 'none');

    const updateResB = await storage.updateTrackDownbeat('track_c12_invalid', negativePosDownbeat, hash);
    assert.equal(updateResB, false);

    // C. Métrica no entera o < 1
    const nonIntegerMetricDownbeat: TrackDownbeat = {
      status: 'confirmed',
      confirmation: {
        position: 1.0,
        beatsPerBar: 3.5,
        contentHash: hash,
        confirmedAt: Date.now(),
        source: 'manual',
      },
    };
    assert.equal(isDownbeatConfirmed(nonIntegerMetricDownbeat, hash), false);
    const updateResC = await storage.updateTrackDownbeat('track_c12_invalid', nonIntegerMetricDownbeat, hash);
    assert.equal(updateResC, false);
  });

  // 13. Hash de 64 caracteres no hexadecimal.
  it('13. Un hash de 64 caracteres con caracteres no hexadecimales es rechazado por completo', async () => {
    const nonHexHash = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    assert.equal(nonHexHash.length, 64);

    const malformedDownbeat: TrackDownbeat = {
      status: 'confirmed',
      confirmation: {
        position: 1.0,
        beatsPerBar: 4,
        contentHash: nonHexHash,
        confirmedAt: Date.now(),
        source: 'manual',
      },
    };

    // isDownbeatConfirmed debe rechazarlo incluso sin currentContentHash
    assert.equal(isDownbeatConfirmed(malformedDownbeat), false);
    assert.equal(isDownbeatConfirmed(malformedDownbeat, nonHexHash), false);

    // validateDownbeatForContent debe degradarlo
    const cleaned = validateDownbeatForContent(malformedDownbeat, nonHexHash);
    assert.equal(cleaned?.status, 'none');
    assert.equal(cleaned?.confirmation, null);

    // updateTrackDownbeat debe rechazarlo
    const updateRes = await storage.updateTrackDownbeat('any_track', malformedDownbeat, nonHexHash);
    assert.equal(updateRes, false);
  });

  // 14. Confirmación con hash declarado que no coincide con el Blob binario real.
  it('14. Confirmación cuyo hash declarado no coincide con el Blob binario real es invalidada en saveTrack', async () => {
    const realBlob = new File([new TextEncoder().encode('real_binary_payload_c14')], 'real.mp3');
    const realHash = await computeFileHash(realBlob);
    const fakeDeclaredHash = '1111111111111111111111111111111111111111111111111111111111111111';

    const track = createTrackFromFile(realBlob, 100);
    track.id = 'track_c14_mismatch';
    // Se fuerza un hash declarado engañoso en los metadatos
    track.fileMeta = {
      ...track.fileMeta!,
      contentHash: fakeDeclaredHash,
    };
    // Se adjunta una confirmación generada para el hash engañoso
    track.downbeat = createManualDownbeatConfirmation({
      position: 1.5,
      beatsPerBar: 4,
      contentHash: fakeDeclaredHash,
      suggestedPosition: 0.5,
    });

    await storage.saveTrack(track, realBlob);

    const stored = await storage.getTrack('track_c14_mismatch');
    assert.ok(stored);
    // El hash real persistido debe ser el del blob físico
    assert.equal(stored?.fileMeta.contentHash, realHash);
    // La confirmación asociada a fakeDeclaredHash debe haber sido invalidada
    assert.equal(isDownbeatConfirmed(stored?.downbeat, realHash), false);
    assert.equal(stored?.downbeat?.confirmation, null);
    // La sugerencia preliminar se preserva de forma segura
    assert.equal(stored?.downbeat?.status, 'suggested');
    assert.equal(stored?.downbeat?.suggestedPosition, 0.5);
  });

  // 15. Pista en memoria sin contentHash rechaza confirmaciones.
  it('15. Pistas en memoria sin contentHash verificable rechazan confirmaciones manuales', async () => {
    // Simular almacenamiento en memoria no persistente
    const memTrack = createTrackFromFile(new File([new TextEncoder().encode('mem')], 'mem.mp3'), 60);
    memTrack.id = 'track_c15_mem_unhashed';
    delete memTrack.fileMeta?.contentHash;

    const fakeHash = '9999999999999999999999999999999999999999999999999999999999999999';
    const conf = createManualDownbeatConfirmation({
      position: 2.0,
      beatsPerBar: 4,
      contentHash: fakeHash,
    });

    // Como no existe en memoria ni en IndexedDB, debe ser rechazado
    const updateRes = await storage.updateTrackDownbeat('track_c15_mem_unhashed', conf, fakeHash);
    assert.equal(updateRes, false);
  });

  // 16. Guardar pista con sugerencia preliminar persiste como suggested y nunca como confirmada.
  it('16. Guardar una pista con sugerencia preliminar persiste status suggested y getTrackDownbeat no la considera confirmada', async () => {
    const file = new File([new TextEncoder().encode('audio_c16_suggested')], 'suggested.mp3');
    const hash = await computeFileHash(file);
    const track = createTrackFromFile(file, 120, hash);
    track.id = 'track_c16_suggested';
    track.downbeat = createSuggestedDownbeat(0.850);

    await storage.saveTrack(track, file);

    const stored = await storage.getTrack('track_c16_suggested');
    assert.ok(stored);
    assert.equal(stored?.downbeat?.status, 'suggested');
    assert.equal(stored?.downbeat?.suggestedPosition, 0.850);
    assert.equal(stored?.downbeat?.confirmation, null);

    const downbeatOnly = await storage.getTrackDownbeat('track_c16_suggested');
    assert.ok(downbeatOnly);
    assert.equal(isDownbeatConfirmed(downbeatOnly, hash), false);
    assert.equal(isDownbeatConfirmed(downbeatOnly), false);
  });
});
