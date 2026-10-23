/**
 * SYSTEM DJ — Local Library Import
 * Flujo de importación compartido por Biblioteca y Dashboard: conecta el servicio de
 * importación con IndexedDB y el motor de audio, y registra el resultado como notificación.
 */

import { importAudioFiles, type AudioImportResult } from './audioImportService';
import { indexedDBStorage } from './storage/IndexedDBStorage';
import { notificationCenter } from './notifications/notificationCenter';
import { audioEngine } from '../audio';
import { computeFileHash } from '../utils/cryptoHash';

export async function importFilesToLocalLibrary(
  files: File[],
  duplicateWarning: (fileName: string) => string,
): Promise<AudioImportResult> {
  const result = await importAudioFiles(files, {
    hasDuplicate: (name, size) => indexedDBStorage.hasDuplicate(name, size),
    decodeAudioData: (data) => audioEngine.decodeAudioData(data),
    computeFileHash,
    saveTrack: (track, file) => indexedDBStorage.saveTrack(track, file),
    duplicateWarning,
  });

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
