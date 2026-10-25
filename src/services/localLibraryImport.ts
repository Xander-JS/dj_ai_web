/**
 * SYSTEM DJ — Local Library Import
 * Flujo de importación compartido por Biblioteca y Dashboard: conecta el servicio de
 * importación con IndexedDB y el motor de audio, y registra el resultado como notificación.
 */

import { importAudioFiles, type AudioImportOptions, type AudioImportResult } from './audioImportService';
import { indexedDBStorage } from './storage/IndexedDBStorage';
import { notificationCenter } from './notifications/notificationCenter';
import { audioEngine } from '../audio';
import { computeFileHash } from '../utils/cryptoHash';

export async function importFilesToLocalLibrary(
  files: File[],
  duplicateWarning: (fileName: string) => string,
  options: AudioImportOptions = {},
): Promise<AudioImportResult> {
  const result = await importAudioFiles(files, {
    hasDuplicate: (name, size) => indexedDBStorage.hasDuplicate(name, size),
    decodeAudioData: (data) => audioEngine.decodeAudioData(data),
    computeFileHash,
    saveTrack: (track, file) => indexedDBStorage.saveTrack(track, file),
    duplicateWarning,
  }, options);

  const { successCount, errors } = result;
  if (successCount > 0) {
    notificationCenter.push({
      type: errors.length > 0 ? 'warning' : 'success',
      messageKey: 'notifications.import_success',
      params: { count: successCount },
    });
  }
  if (errors.length > 0) {
    notificationCenter.push({
      type: successCount > 0 ? 'warning' : 'error',
      messageKey: 'notifications.import_errors',
      params: { count: errors.length, details: errors.join(' | ') },
    });
  }

  return result;
}

// El microservicio entrega MP3; se garantiza la extensión para que la validación lo reconozca
export function createFileFromRemoteAudio(blob: Blob, filename: string): File {
  const name = /\.(mp3|wav)$/i.test(filename) ? filename : `${filename.replace(/\.[^/.]+$/, '') || 'audio'}.mp3`;
  return new File([blob], name, { type: blob.type || 'audio/mpeg', lastModified: Date.now() });
}

/** Ingresa el audio extraído de YouTube por el mismo flujo que un archivo local,
 * exigiendo que el navegador pueda decodificarlo antes de persistirlo. */
export function importRemoteAudioToLocalLibrary(
  blob: Blob,
  filename: string,
  duplicateWarning: (fileName: string) => string,
): Promise<AudioImportResult> {
  return importFilesToLocalLibrary(
    [createFileFromRemoteAudio(blob, filename)],
    duplicateWarning,
    { requireDecodable: true, origin: 'link' },
  );
}
