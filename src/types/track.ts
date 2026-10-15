/**
 * SYSTEM DJ — Domain Model: Track & Library
 * Modelo compartido para canciones, metadatos, análisis musical y orígenes locales.
 */

export type MusicalKeyCamelot =
  | '1A' | '2A' | '3A' | '4A' | '5A' | '6A' | '7A' | '8A' | '9A' | '10A' | '11A' | '12A'
  | '1B' | '2B' | '3B' | '4B' | '5B' | '6B' | '7B' | '8B' | '9B' | '10B' | '11B' | '12B';

export type AnalysisStatus = 'pending' | 'analyzing' | 'analyzed' | 'failed' | 'unsupported';

export interface TrackAnalysis {
  status: AnalysisStatus;
  bpm?: number;
  key?: string;                     // Notación estándar: 'Am', 'F#m', 'C'
  camelot?: MusicalKeyCamelot;       // Notación armónica Camelot: '8A', '11A'
  energy?: number;                   // Escala de intensidad/energía (0 a 10)
  waveformPeaks?: number[];          // Muestras normalizadas (0.0 a 1.0) para renderizado rápido
  analysisError?: string;
}

export type AudioSourceType = 'file' | 'blob' | 'indexeddb' | 'url';

export interface TrackAudioSource {
  type: AudioSourceType;
  file?: File;                       // Archivo original en memoria volátil de la sesión
  blob?: Blob;                       // Datos binarios cacheados localmente
  indexedDbKey?: string;             // Referencia a registro persistente en IndexedDB
  url?: string;                      // Blob URL temporal o stream URI
}

export interface TrackFileMetadata {
  fileName: string;
  fileSize: number;                  // En bytes
  mimeType: string;
  lastModified: number;              // Timestamp
}

/**
 * Entidad principal de pista musical en la biblioteca.
 * No contiene AudioBuffer decodificado en memoria para evitar saturar el estado de React.
 */
export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;                  // Duración precisa en segundos (ej. 375.4)
  durationFormatted: string;         // Representación amigable (ej. "6:15")
  type: 'audio' | 'video';
  source: TrackAudioSource;
  analysis: TrackAnalysis;
  fileMeta?: TrackFileMetadata;
  dateAdded: number;                 // Timestamp de incorporación
}
