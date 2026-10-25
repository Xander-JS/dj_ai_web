import { createTrackFromFile, validateAudioFile } from '../utils/audioValidation.ts';
import type { Track, TrackOrigin } from '../types/track.ts';

export interface AudioImportDependencies {
  hasDuplicate: (fileName: string, fileSize: number) => Promise<boolean>;
  // Contenido idéntico (SHA-256) ya guardado, aunque el archivo se haya renombrado
  hasContentDuplicate?: (contentHash: string) => Promise<boolean>;
  decodeAudioData: (data: ArrayBuffer) => Promise<AudioBuffer>;
  computeFileHash: (file: File) => Promise<string | undefined>;
  saveTrack: (track: Track, file: File) => Promise<{ persisted: boolean; reason?: string }>;
  duplicateWarning: (fileName: string) => string;
}

export interface AudioImportResult {
  successCount: number;
  errors: string[];
  // Avisos de archivos rechazados por estar ya en la biblioteca (o repetidos en el lote)
  duplicates: string[];
  // Pistas persistidas en esta importación, en el orden de entrada
  importedTracks: Track[];
}

export interface AudioImportOptions {
  // Rechaza el archivo si el navegador no puede decodificarlo (p. ej. audio remoto)
  requireDecodable?: boolean;
  // Mecanismo de importación que se registra en la pista; por defecto, archivo local
  origin?: TrackOrigin;
}

/** Implements the Library's existing import policy: keep a valid-looking file if
 * duration decoding fails, with duration 0, while returning the current warnings. */
export async function importAudioFiles(
  files: File[],
  dependencies: AudioImportDependencies,
  options: AudioImportOptions = {},
): Promise<AudioImportResult> {
  let successCount = 0;
  const errors: string[] = [];
  const duplicates: string[] = [];
  const importedTracks: Track[] = [];
  // Huellas ya aceptadas en este lote: un mismo contenido no entra dos veces
  const batchHashes = new Set<string>();

  for (const file of files) {
    const validation = validateAudioFile(file);
    if (!validation.valid) {
      errors.push(validation.error || file.name);
      continue;
    }

    if (await dependencies.hasDuplicate(file.name, file.size)) {
      duplicates.push(dependencies.duplicateWarning(file.name));
      continue;
    }

    // La huella se calcula antes de decodificar para descartar el duplicado sin más trabajo
    let contentHash: string | undefined;
    try {
      contentHash = await dependencies.computeFileHash(file);
    } catch (error) {
      console.warn(`[Library] No se pudo calcular el hash de ${file.name}:`, error);
    }

    if (contentHash && (batchHashes.has(contentHash) || await dependencies.hasContentDuplicate?.(contentHash))) {
      duplicates.push(dependencies.duplicateWarning(file.name));
      continue;
    }

    let durationSeconds = 0;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await dependencies.decodeAudioData(arrayBuffer);
      durationSeconds = audioBuffer.duration;
    } catch (error) {
      if (options.requireDecodable) {
        errors.push(`"${file.name}" no se pudo decodificar en el navegador: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      console.warn(`[Library] No se pudo decodificar la duración previa de ${file.name}:`, error);
    }

    const track = createTrackFromFile(file, durationSeconds, contentHash);
    if (options.origin === 'link') track.origin = 'link';
    try {
      const result = await dependencies.saveTrack(track, file);
      if (contentHash) batchHashes.add(contentHash);
      if (!result.persisted) {
        errors.push(`"${file.name}" se cargó en memoria temporal pero no se pudo persistir en IndexedDB (${result.reason || 'sin persistencia'}). Se perderá al recargar.`);
      } else {
        successCount += 1;
        importedTracks.push(track);
      }
    } catch (error) {
      errors.push(`Error al guardar ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { successCount, errors, duplicates, importedTracks };
}
