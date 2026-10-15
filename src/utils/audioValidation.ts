/**
 * SYSTEM DJ — Audio File Validation & Metadata Extractor
 * Valida formatos compatibles (MP3, WAV) con tolerancia a MIME types genéricos o vacíos.
 */

import type { Track } from '../types/track';
import { formatDuration } from './formatters.ts';

export type SupportedAudioFormat = 'mp3' | 'wav';

export interface AudioValidationResult {
  valid: boolean;
  format?: SupportedAudioFormat;
  error?: string;
}

const SUPPORTED_EXTENSIONS: Record<string, SupportedAudioFormat> = {
  mp3: 'mp3',
  wav: 'wav',
};

const SUPPORTED_MIME_TYPES: Record<string, SupportedAudioFormat> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/vnd.wave': 'wav',
};

/**
 * Valida si un archivo es un archivo de audio MP3 o WAV compatible.
 * Comprueba tamaño, extensión y tipo MIME.
 */
export function validateAudioFile(file: File): AudioValidationResult {
  if (!file) {
    return { valid: false, error: 'No se proporcionó ningún archivo.' };
  }

  // Comprobar archivo vacío
  if (file.size <= 0) {
    return { valid: false, error: 'El archivo está vacío (0 bytes).' };
  }

  // 1. Detección por extensión
  const nameParts = file.name.split('.');
  const ext = nameParts.length > 1 ? nameParts.pop()?.toLowerCase() || '' : '';
  const formatByExt = SUPPORTED_EXTENSIONS[ext];

  // 2. Detección por tipo MIME
  const cleanMime = file.type ? file.type.toLowerCase().trim() : '';
  const formatByMime = SUPPORTED_MIME_TYPES[cleanMime];

  // Resolución combinada: si la extensión o el MIME coincide con un formato soportado
  const resolvedFormat = formatByExt || formatByMime;

  if (!resolvedFormat) {
    return {
      valid: false,
      error: `Formato no compatible (.${ext || 'desconocido'}). Solo se admiten archivos MP3 y WAV.`,
    };
  }

  return {
    valid: true,
    format: resolvedFormat,
  };
}

/**
 * Genera la entidad Track a partir del archivo local importado.
 * No simula BPM ni Key; establece el análisis en 'pending'.
 */
export function createTrackFromFile(file: File, durationSeconds = 0): Track {
  const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '').trim();
  const id = `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  return {
    id,
    title: nameWithoutExt || file.name,
    artist: '',
    duration: durationSeconds,
    durationFormatted: formatDuration(durationSeconds),
    type: 'audio',
    source: {
      type: 'indexeddb',
      file,
      blob: file,
      indexedDbKey: id,
    },
    analysis: {
      status: 'pending',
    },
    fileMeta: {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || `audio/${file.name.endsWith('.wav') ? 'wav' : 'mpeg'}`,
      lastModified: file.lastModified || Date.now(),
    },
    dateAdded: Date.now(),
  };
}
