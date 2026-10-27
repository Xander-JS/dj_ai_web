/**
 * SYSTEM DJ — Domain Model: Track & Library
 * Modelo compartido para canciones, metadatos, análisis musical y orígenes locales.
 */

export type MusicalKeyCamelot =
  | '1A' | '2A' | '3A' | '4A' | '5A' | '6A' | '7A' | '8A' | '9A' | '10A' | '11A' | '12A'
  | '1B' | '2B' | '3B' | '4B' | '5B' | '6B' | '7B' | '8B' | '9B' | '10B' | '11B' | '12B';

export type AnalysisStatus = 'pending' | 'analyzing' | 'analyzed' | 'failed' | 'unsupported';

/** Campos musicales que el usuario puede corregir manualmente desde la Biblioteca. */
export type ManualAnalysisField = 'bpm' | 'camelot' | 'energy';

/** Denominador de nota permitido para la unidad métrica de una signatura. */
export type BeatUnit = 1 | 2 | 4 | 8 | 16 | 32 | 64;

/**
 * Unidad métrica de nota asociada a una pista.
 * `value` es el denominador de la signatura (por ejemplo, 4 = negra); no expresa BPM,
 * agrupación de pulsos ni demuestra que el BPM detectado corresponda a esa figura.
 * El análisis actual no determina este dato, por lo que solo una declaración manual
 * puede constar como confirmada. La ausencia del campo significa dato desconocido.
 */
export type TrackBeatUnit =
  | { readonly value: BeatUnit; readonly status: 'confirmed'; readonly source: 'manual' }
  | { readonly value: BeatUnit; readonly status: 'provisional'; readonly source: 'analysis' };

export interface TrackAnalysis {
  status: AnalysisStatus;
  bpm?: number;
  key?: string;                     // Notación estándar: 'Am', 'F#m', 'C'
  camelot?: MusicalKeyCamelot;       // Notación armónica Camelot: '8A', '11A'
  energy?: number;                   // Escala de intensidad/energía (0 a 10)
  waveformPeaks?: number[];          // Picos reales (máx. absoluto por bloque, todos los canales) normalizados 0.0 a 1.0
  waveformDurationSec?: number;      // Duración exacta (s) del AudioBuffer cubierta por waveformPeaks
  bpmConfidence?: number;            // Nivel de certeza/confianza métrica (0.0 a 1.0)
  isAmbiguous?: boolean;             // El detector no encontró una referencia métrica confiable
  alternateBpm?: number[];           // Hipótesis BPM armónicas alternativas reportadas por el detector
  beatUnit?: TrackBeatUnit;          // Unidad de nota de la métrica; omitida si no hay evidencia explícita
  keyConfidence?: number;            // Nivel de correlación/certeza tonal (0.0 a 1.0)
  firstBeatTime?: number | null;     // Marca temporal en segundos del primer transitorio de beat
  analysisPasses?: 1 | 2;            // 2 si se ejecutó la segunda pasada permisiva del analizador
  manualFields?: ManualAnalysisField[]; // Campos fijados manualmente por el usuario (prevalecen sobre el análisis)
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

/** Mecanismo de importación: archivo del equipo o enlace (YouTube). Ausente = archivo (pistas históricas). */
export type TrackOrigin = 'file' | 'link';

export interface TrackFileMetadata {
  fileName: string;
  fileSize: number;                  // En bytes
  mimeType: string;
  lastModified: number;              // Timestamp
  contentHash?: string;              // Digest hexadecimal SHA-256 opcional del contenido de audio
}

/**
 * Marcador Hot Cue individual asociado a una pista musical.
 */
export interface HotCue {
  id: number;                        // Índice 1 a 8
  position: number;                  // Posición temporal en segundos (>= 0, finita)
  trackId: string;                   // Identificador de la pista propietaria
  label?: string;                    // Etiqueta descriptiva opcional
  color: string;                     // Color distintivo del marcador
  createdAt: number;                 // Timestamp de creación
  updatedAt?: number;                // Timestamp de última actualización
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
  origin?: TrackOrigin;              // 'link' si se importó desde un enlace; ausente = archivo local
  analysis: TrackAnalysis;
  fileMeta?: TrackFileMetadata;
  mainCue?: number | null;           // Posición en segundos del CUE principal
  hotCues?: HotCue[];                // Lista de Hot Cues configurados para la pista
  downbeat?: TrackDownbeat | null;   // Configuración y confirmación de downbeat y métrica de compás
  dateAdded: number;                 // Timestamp de incorporación
}

/**
 * Estado formal de la información de downbeat y métrica de compás.
 * - 'none': No existe sugerencia ni confirmación de compás.
 * - 'suggested': Existe una sugerencia preliminar generada por el analizador (no vinculante).
 * - 'confirmed': El usuario ha confirmado explícitamente la posición del downbeat y su métrica.
 */
export type DownbeatStatus = 'none' | 'suggested' | 'confirmed';

/**
 * Confirmación manual explícita del tiempo 1 de compás fijada por el usuario.
 * Está vinculada de forma inmutable a la identidad del contenido exacto (contentHash).
 */
export interface ManualDownbeatConfirmation {
  /** Posición temporal precisa en segundos del downbeat confirmada por el usuario. */
  readonly position: number;
  /** Cantidad explícita de pulsos por compás elegida por el usuario (ej. 4, 3). */
  readonly beatsPerBar: number;
  /** Huella SHA-256 exacta del contenido binario para el cual es válida esta confirmación. */
  readonly contentHash: string;
  /** Timestamp en milisegundos en que se realizó la confirmación manual. */
  readonly confirmedAt: number;
  /** Procedencia explícita de la confirmación manual. */
  readonly source: 'manual';
  /**
   * Fuente elegida en el módulo DOWNBEAT & COMPÁS al confirmar: el cabezal o la posición sugerida.
   * Ausente en confirmaciones anteriores a ese módulo (se deduce de la posición).
   */
  readonly origin?: DownbeatOrigin;
}

/** Fuente de la posición confirmada: el cabezal en ese instante o la sugerencia del análisis. */
export type DownbeatOrigin = 'playhead' | 'suggested';

/**
 * Representación de downbeat y métrica de compás para una pista.
 * Mantiene separación estricta entre sugerencia preliminar y confirmación humana.
 */
export interface TrackDownbeat {
  /** Estado actual de la información de compás / downbeat. */
  status: DownbeatStatus;
  /**
   * Posición temporal en segundos del downbeat sugerido por el análisis rítmico.
   * AVISO CONTRACTUAL: Es una sugerencia preliminar no vinculante. NUNCA equivale a una confirmación.
   */
  suggestedPosition?: number | null;
  /**
   * Confirmación manual explícita fijada por el usuario.
   * Solo presente y válida cuando status === 'confirmed'.
   */
  confirmation?: ManualDownbeatConfirmation | null;
}
