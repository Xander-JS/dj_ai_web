import { createTrackFromFile, validateAudioFile } from '../utils/audioValidation.ts';
import type { Track } from '../types/track.ts';

export interface AudioImportDependencies {
  hasDuplicate: (fileName: string, fileSize: number) => Promise<boolean>;
  decodeAudioData: (data: ArrayBuffer) => Promise<AudioBuffer>;
  computeFileHash: (file: File) => Promise<string | undefined>;
  saveTrack: (track: Track, file: File) => Promise<{ persisted: boolean; reason?: string }>;
  duplicateWarning: (fileName: string) => string;
}

export interface AudioImportResult {
  successCount: number;
  errors: string[];
}

/** Implements the Library's existing import policy: keep a valid-looking file if
 * duration decoding fails, with duration 0, while returning the current warnings. */
export async function importAudioFiles(
  files: File[],
  dependencies: AudioImportDependencies,
): Promise<AudioImportResult> {
  let successCount = 0;
  const errors: string[] = [];

  for (const file of files) {
    const validation = validateAudioFile(file);
    if (!validation.valid) {
      errors.push(validation.error || file.name);
      continue;
    }

    if (await dependencies.hasDuplicate(file.name, file.size)) {
      errors.push(dependencies.duplicateWarning(file.name));
      continue;
    }

    let durationSeconds = 0;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await dependencies.decodeAudioData(arrayBuffer);
      durationSeconds = audioBuffer.duration;
    } catch (error) {
      console.warn(`[Library] No se pudo decodificar la duración previa de ${file.name}:`, error);
    }

    let contentHash: string | undefined;
    try {
      contentHash = await dependencies.computeFileHash(file);
    } catch (error) {
      console.warn(`[Library] No se pudo calcular el hash de ${file.name}:`, error);
    }

    const track = createTrackFromFile(file, durationSeconds, contentHash);
    try {
      const result = await dependencies.saveTrack(track, file);
      if (!result.persisted) {
        errors.push(`"${file.name}" se cargó en memoria temporal pero no se pudo persistir en IndexedDB (${result.reason || 'sin persistencia'}). Se perderá al recargar.`);
      } else {
        successCount += 1;
      }
    } catch (error) {
      errors.push(`Error al guardar ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { successCount, errors };
}
