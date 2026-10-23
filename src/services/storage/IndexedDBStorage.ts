/**
 * SYSTEM DJ — Local IndexedDB Storage Service
 * Persistencia local en cliente para pistas de audio y metadatos sin subir archivos a servidores.
 * Base de datos: SystemDJ_Storage | Almacenes: tracks, playlists, recorded_sessions
 */

import type { Track, TrackAnalysis, HotCue, TrackDownbeat } from '../../types/track.ts';
import type { Playlist } from '../../types/playlist.ts';
import { computeFileHash, getVerifiedBlobHash } from '../../utils/cryptoHash.ts';
import { isDownbeatConfirmed, createSuggestedDownbeat } from '../../utils/downbeat.ts';
import { normalizeTrackAnalysis } from '../../utils/trackAnalysis.ts';
import {
  MAX_STORED_SESSIONS,
  planSessionHistoryInsert,
  sortSessionsNewestFirst,
  type SaveSessionResult,
  type StoredSessionRecord,
} from '../../session/SessionHistory.ts';

export interface StoredTrackRecord {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  durationFormatted: string;
  type: 'audio' | 'video';
  audioBlob: Blob;
  fileMeta: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    lastModified: number;
    contentHash?: string;
  };
  analysis: Track['analysis'];
  mainCue?: number | null;
  hotCues?: HotCue[];
  downbeat?: TrackDownbeat | null;
  dateAdded: number;
}


const DB_NAME = 'SystemDJ_Storage';
// v1: tracks | v2: playlists | v3: recorded_sessions
// (las migraciones solo crean almacenes ausentes, sin tocar datos)
const DB_VERSION = 3;
const STORE_NAME = 'tracks';
const PLAYLIST_STORE_NAME = 'playlists';
const SESSION_STORE_NAME = 'recorded_sessions';

/**
 * Resultado explícito de un guardado. `persisted: false` significa que la pista
 * solo existe en memoria durante la sesión actual y se perderá al recargar.
 */
export interface SaveTrackResult {
  persisted: boolean;
  reason?: 'unsupported' | 'quota' | 'error';
}

export class IndexedDBStorage {
  private static instance: IndexedDBStorage | null = null;
  private db: IDBDatabase | null = null;
  private isSupported = typeof indexedDB !== 'undefined';

  // Almacén en memoria como respaldo ante entornos sin IndexedDB o fallo de cuota
  private memoryStore: Map<string, StoredTrackRecord> = new Map();
  // Identificadores de pistas que NO se pudieron persistir en IndexedDB
  private memoryOnlyIds: Set<string> = new Set();
  // Respaldo en memoria de playlists cuando IndexedDB no está disponible
  private memoryPlaylists: Map<string, Playlist> = new Map();
  // Respaldo en memoria del historial de sesiones grabadas
  private memorySessions: Map<string, StoredSessionRecord> = new Map();

  /**
   * Indica si una pista existe solo en memoria (no sobrevivirá a una recarga).
   */
  public isMemoryOnly(id: string): boolean {
    return this.memoryOnlyIds.has(id);
  }

  public static getInstance(): IndexedDBStorage {
    if (!IndexedDBStorage.instance) {
      IndexedDBStorage.instance = new IndexedDBStorage();
    }
    return IndexedDBStorage.instance;
  }

  /**
   * Inicializa y abre la conexión con IndexedDB.
   */
  public async init(): Promise<IDBDatabase | null> {
    if (!this.isSupported) {
      return null;
    }

    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('fileName', 'fileMeta.fileName', { unique: false });
            store.createIndex('dateAdded', 'dateAdded', { unique: false });
          }
          if (!db.objectStoreNames.contains(PLAYLIST_STORE_NAME)) {
            const playlistStore = db.createObjectStore(PLAYLIST_STORE_NAME, { keyPath: 'id' });
            playlistStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
          if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) {
            const sessionStore = db.createObjectStore(SESSION_STORE_NAME, { keyPath: 'id' });
            sessionStore.createIndex('savedAt', 'savedAt', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          resolve(this.db);
        };

        request.onerror = (event) => {
          console.warn('[IndexedDBStorage] Error al abrir IndexedDB, usando respaldo en memoria:', event);
          resolve(null);
        };
      } catch (err) {
        console.warn('[IndexedDBStorage] Excepción al acceder a IndexedDB:', err);
        reject(new Error(`Fallo de acceso a IndexedDB: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  /**
   * Comprueba si un archivo con el mismo nombre y tamaño ya existe para evitar duplicados.
   */
  public async hasDuplicate(fileName: string, fileSize: number): Promise<boolean> {
    // 1. Comprobar en almacén de memoria
    for (const record of this.memoryStore.values()) {
      if (record.fileMeta.fileName === fileName && record.fileMeta.fileSize === fileSize) {
        return true;
      }
    }

    // 2. Comprobar en IndexedDB
    const db = await this.init();
    if (!db) return false;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('fileName');
        const request = index.getAll(fileName);

        request.onsuccess = () => {
          const matches = request.result as StoredTrackRecord[];
          const hasMatch = matches.some((item) => item.fileMeta.fileSize === fileSize);
          resolve(hasMatch);
        };

        request.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Evalúa la identidad del contenido y combina defensivamente las confirmaciones manuales.
   * Si la identidad anterior y la actual no coinciden o no está demostrada, no transfiere confirmaciones manuales.
   */
  private evaluateIdentityAndMerge(
    existing: StoredTrackRecord,
    record: StoredTrackRecord,
    incomingTrack: Track
  ): void {
    const existingHash = existing.fileMeta.contentHash;
    const newHash = record.fileMeta.contentHash;

    const bothHaveHash =
      typeof existingHash === 'string' &&
      existingHash.length === 64 &&
      /^[0-9a-f]{64}$/i.test(existingHash) &&
      typeof newHash === 'string' &&
      newHash.length === 64 &&
      /^[0-9a-f]{64}$/i.test(newHash);

    if (bothHaveHash && existingHash.toLowerCase() === newHash.toLowerCase()) {
      // Identidad verificada coincidente: conservar confirmaciones manuales existentes si no se especifican en el nuevo
      if (
        (!incomingTrack.hotCues || incomingTrack.hotCues.length === 0) &&
        existing.hotCues &&
        existing.hotCues.length > 0
      ) {
        record.hotCues = existing.hotCues;
      }
      if (incomingTrack.mainCue === undefined && existing.mainCue !== undefined) {
        record.mainCue = existing.mainCue;
      }

      // Preservar confirmación válida de downbeat si el entrante no trae una confirmación explícita para este hash
      if (!isDownbeatConfirmed(record.downbeat, newHash)) {
        if (isDownbeatConfirmed(existing.downbeat, newHash)) {
          record.downbeat = existing.downbeat;
          incomingTrack.downbeat = existing.downbeat;
        } else if (record.downbeat == null) {
          if (existing.downbeat?.status === 'suggested') {
            record.downbeat = existing.downbeat;
            incomingTrack.downbeat = existing.downbeat;
          }
        }
      } else {
        incomingTrack.downbeat = record.downbeat;
      }

      if (
        record.analysis.status === 'pending' &&
        existing.analysis &&
        existing.analysis.status === 'analyzed'
      ) {
        record.analysis = normalizeTrackAnalysis(existing.analysis);
        incomingTrack.analysis = record.analysis;
      }
    } else {
      // Huellas distintas o falta de identidad demostrable en uno o ambos registros: invalidar datos dependientes del contenido
      record.analysis = { status: 'pending' };
      incomingTrack.analysis = record.analysis;
      record.mainCue = null;
      record.hotCues = [];

      // No transferir confirmaciones antiguas.
      // Solo conservar record.downbeat si pertenece específicamente al nuevo contenido verificado (newHash)
      if (newHash && isDownbeatConfirmed(record.downbeat, newHash)) {
        incomingTrack.downbeat = record.downbeat;
      } else {
        record.downbeat = null;
        incomingTrack.downbeat = null;
      }
    }
  }

  /**
   * Guarda una pista y su blob binario en almacenamiento local persistente.
   */
  public async saveTrack(track: Track, audioBlob: Blob): Promise<SaveTrackResult> {
    // 0. Comprobar si audioBlob ya cuenta con una huella criptográfica verificada para esta instancia exacta
    const verifiedHash = audioBlob ? getVerifiedBlobHash(audioBlob) : undefined;
    let contentHash: string | undefined;

    if (verifiedHash && track.fileMeta?.contentHash === verifiedHash) {
      // Reutilización segura demostrada: este Blob exacto fue procesado por computeFileHash con este hash exacto
      contentHash = verifiedHash;
    } else {
      // Invalida cualquier hash heredado o no demostrado antes de iniciar el cálculo
      contentHash = undefined;
      if (track.fileMeta?.contentHash) {
        delete track.fileMeta.contentHash;
      }

      if (audioBlob && typeof audioBlob.arrayBuffer === 'function') {
        try {
          contentHash = await computeFileHash(audioBlob as File);
          if (track.fileMeta) {
            track.fileMeta.contentHash = contentHash;
          }
        } catch (err) {
          console.warn('[IndexedDBStorage] No se pudo calcular contentHash antes de guardar:', err);
          contentHash = undefined;
          if (track.fileMeta?.contentHash) {
            delete track.fileMeta.contentHash;
          }
        }
      }
    }

    // Validar la estructura del downbeat inicial frente al hash verificado del Blob
    let initialDownbeat: TrackDownbeat | null = track.downbeat ?? null;
    if (initialDownbeat?.status === 'confirmed') {
      if (!contentHash || !isDownbeatConfirmed(initialDownbeat, contentHash)) {
        // La confirmación no corresponde al contenido exacto que se guarda o es inválida: degradar o anular
        initialDownbeat = initialDownbeat.suggestedPosition != null &&
          typeof initialDownbeat.suggestedPosition === 'number' &&
          Number.isFinite(initialDownbeat.suggestedPosition) &&
          initialDownbeat.suggestedPosition >= 0
            ? { status: 'suggested', suggestedPosition: Number(initialDownbeat.suggestedPosition.toFixed(3)), confirmation: null }
            : null;
      }
    } else if (initialDownbeat?.status === 'suggested') {
      const validSug = createSuggestedDownbeat(initialDownbeat.suggestedPosition);
      initialDownbeat = validSug.status === 'suggested' ? validSug : null;
    } else if (initialDownbeat) {
      initialDownbeat = null;
    }

    const record: StoredTrackRecord = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      durationFormatted: track.durationFormatted,
      type: track.type,
      audioBlob,
      fileMeta: {
        fileName: track.fileMeta?.fileName || track.title,
        fileSize: track.fileMeta?.fileSize ?? audioBlob.size,
        mimeType: track.fileMeta?.mimeType || audioBlob.type || 'audio/mpeg',
        lastModified: track.fileMeta?.lastModified || Date.now(),
        ...(contentHash ? { contentHash } : {}),
      },
      analysis: normalizeTrackAnalysis(track.analysis),
      mainCue: track.mainCue ?? null,
      hotCues: track.hotCues ?? [],
      downbeat: initialDownbeat,
      dateAdded: track.dateAdded || Date.now(),
    };

    // Si ya existía un registro previo con este mismo ID en memoria
    const existingMem = this.memoryStore.get(record.id);
    if (existingMem) {
      this.evaluateIdentityAndMerge(existingMem, record, track);
    }

    const keepInMemoryOnly = (reason: SaveTrackResult['reason']): SaveTrackResult => {
      this.memoryStore.set(record.id, record);
      this.memoryOnlyIds.add(record.id);
      return { persisted: false, reason };
    };

    let db: IDBDatabase | null;
    try {
      db = await this.init();
    } catch {
      return keepInMemoryOnly('error');
    }

    if (!db) {
      // IndexedDB no disponible: la pista solo vive en memoria durante esta sesión
      return keepInMemoryOnly('unsupported');
    }

    return new Promise<SaveTrackResult>((resolve) => {
      let settled = false;
      const settle = (result: SaveTrackResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // Comprobar si ya existe en la base de datos para detectar reemplazo de archivo o fusión defensiva
        const getReq = store.get(record.id);
        getReq.onsuccess = () => {
          const existingDb = getReq.result as StoredTrackRecord | undefined;
          if (existingDb) {
            this.evaluateIdentityAndMerge(existingDb, record, track);
          }
          store.put(record);
        };
        getReq.onerror = () => {
          store.put(record);
        };

        // Solo la finalización de la transacción garantiza que los datos se escribieron
        tx.oncomplete = () => {
          this.memoryStore.set(record.id, record);

          this.memoryOnlyIds.delete(record.id);
          settle({ persisted: true });
        };

        const onFailure = () => {
          const error = tx.error;
          console.warn('[IndexedDBStorage] La transacción de guardado no se completó:', error);
          const isQuota = error?.name === 'QuotaExceededError';
          settle(keepInMemoryOnly(isQuota ? 'quota' : 'error'));
        };
        tx.onabort = onFailure;
        tx.onerror = onFailure;
      } catch (err) {
        console.warn('[IndexedDBStorage] Excepción al iniciar la transacción de guardado:', err);
        const isQuota = err instanceof Error && err.name === 'QuotaExceededError';
        settle(keepInMemoryOnly(isQuota ? 'quota' : 'error'));
      }
    });
  }

  /**
   * Recupera todas las pistas locales almacenadas.
   */
  public async getAllTracks(): Promise<Track[]> {
    const db = await this.init();

    if (!db) {
      return Array.from(this.memoryStore.values()).map(this.mapRecordToTrack);
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const records = request.result as StoredTrackRecord[];
          // Sincronizar memoria interna
          records.forEach((r) => this.memoryStore.set(r.id, r));

          // Unir con posibles pistas retenidas solo en memoria
          const allMap = new Map<string, StoredTrackRecord>();
          records.forEach((r) => allMap.set(r.id, r));
          this.memoryStore.forEach((r, k) => allMap.set(k, r));

          const tracks = Array.from(allMap.values()).map(this.mapRecordToTrack);
          resolve(tracks);
        };

        request.onerror = () => {
          resolve(Array.from(this.memoryStore.values()).map(this.mapRecordToTrack));
        };
      } catch {
        resolve(Array.from(this.memoryStore.values()).map(this.mapRecordToTrack));
      }
    });
  }

  /**
   * Obtiene el Blob de audio de una pista específica para decodificación o reproducción.
   */
  public async getTrackBlob(id: string): Promise<Blob | null> {
    // 1. Revisar memoria
    const memoryRecord = this.memoryStore.get(id);
    if (memoryRecord) {
      return memoryRecord.audioBlob;
    }

    // 2. Revisar IndexedDB
    const db = await this.init();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const record = request.result as StoredTrackRecord | undefined;
          if (record?.audioBlob) {
            this.memoryStore.set(id, record);
            resolve(record.audioBlob);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Elimina una pista y su archivo de audio local.
   * En la misma transacción retira la pista de todas las playlists que la referencian.
   */
  public async deleteTrack(id: string): Promise<void> {
    this.memoryStore.delete(id);
    const wasMemoryOnly = this.memoryOnlyIds.delete(id);
    this.memoryPlaylists.forEach((playlist, key) => {
      if (playlist.trackIds.includes(id)) {
        this.memoryPlaylists.set(key, { ...playlist, trackIds: playlist.trackIds.filter((tid) => tid !== id) });
      }
    });

    const db = await this.init();
    if (!db) return;

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction([STORE_NAME, PLAYLIST_STORE_NAME], 'readwrite');
        if (!wasMemoryOnly) tx.objectStore(STORE_NAME).delete(id);

        const playlistStore = tx.objectStore(PLAYLIST_STORE_NAME);
        const cursorRequest = playlistStore.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const playlist = cursor.value as Playlist;
          if (playlist.trackIds.includes(id)) {
            cursor.update({ ...playlist, trackIds: playlist.trackIds.filter((tid) => tid !== id) });
          }
          cursor.continue();
        };

        tx.oncomplete = () => resolve();
        const onFailure = () => {
          reject(new Error(`No se pudo eliminar la pista con id ${id}`, { cause: tx.error }));
        };
        tx.onabort = onFailure;
        tx.onerror = onFailure;
      } catch (err) {
        reject(new Error(`Error en transacción de eliminación: ${err instanceof Error ? err.message : String(err)}`, { cause: err }));
      }
    });
  }

  /**
   * Elimina solo las pistas; las playlists y las sesiones grabadas se conservan intactas.
   */
  public async clearTracks(): Promise<void> {
    this.memoryStore.clear();
    this.memoryOnlyIds.clear();

    const db = await this.init();
    if (!db) return;

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        const onFailure = () => reject(new Error('No se pudieron eliminar las pistas', { cause: tx.error }));
        tx.onabort = onFailure;
        tx.onerror = onFailure;
      } catch (err) {
        reject(new Error(`Error en transacción de borrado de pistas: ${err instanceof Error ? err.message : String(err)}`, { cause: err }));
      }
    });
  }

  /**
   * Elimina todos los registros de la biblioteca local.
   */
  public async clearAll(): Promise<void> {
    this.memoryStore.clear();
    this.memoryOnlyIds.clear();
    this.memoryPlaylists.clear();
    this.memorySessions.clear();

    const db = await this.init();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction([STORE_NAME, PLAYLIST_STORE_NAME, SESSION_STORE_NAME], 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.objectStore(PLAYLIST_STORE_NAME).clear();
        tx.objectStore(SESSION_STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onabort = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Actualiza atómicamente los resultados del análisis musical de una pista
   * sin reescribir ni clonar el archivo binario de audio (audioBlob).
   * Devuelve false si la pista ya no existe (evita escrituras obsoletas de pistas eliminadas).
   */
  public async updateTrackAnalysis(
    id: string,
    analysis: TrackAnalysis,
    expectedContentHash?: string
  ): Promise<boolean> {
    // 1. Actualizar almacén de memoria si la pista existe allí
    const memRecord = this.memoryStore.get(id);
    if (
      expectedContentHash &&
      memRecord?.fileMeta.contentHash &&
      memRecord.fileMeta.contentHash !== expectedContentHash
    ) {
      // El contenido en memoria cambió durante el análisis: descartar resultado obsoleto
      return false;
    }

    const normalizedAnalysis = normalizeTrackAnalysis(analysis);
    if (memRecord) {
      memRecord.analysis = normalizedAnalysis;
    }

    const wasMemoryOnly = this.memoryOnlyIds.has(id);
    if (wasMemoryOnly) {
      return Boolean(memRecord);
    }

    const db = await this.init();
    if (!db) {
      // Sin IndexedDB disponible, depende exclusivamente del almacén en memoria
      return Boolean(memRecord);
    }

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
          const record = getRequest.result as StoredTrackRecord | undefined;
          if (!record) {
            // La pista fue eliminada durante el análisis: evitar resurrección o escritura obsoleta
            resolve(false);
            return;
          }

          if (
            expectedContentHash &&
            record.fileMeta.contentHash &&
            record.fileMeta.contentHash !== expectedContentHash
          ) {
            // El contenido persistido cambió durante el análisis: descartar resultado obsoleto
            resolve(false);
            return;
          }

          record.analysis = normalizedAnalysis;
          store.put(record);
        };

        getRequest.onerror = () => {
          resolve(false);
        };

        tx.oncomplete = () => {
          resolve(true);
        };

        tx.onerror = (event) => {
          console.warn('[IndexedDBStorage] Error al persistir metadatos de análisis:', event);
          resolve(false);
        };

        tx.onabort = () => {
          resolve(false);
        };
      } catch (err) {
        console.warn('[IndexedDBStorage] Excepción al actualizar metadatos de análisis:', err);
        resolve(false);
      }
    });
  }

  /**
   * Obtiene exclusivamente los metadatos de análisis musical de una pista almacenada.
   */
  public async getTrackAnalysis(id: string): Promise<TrackAnalysis | null> {
    // 1. Revisar memoria
    const memRecord = this.memoryStore.get(id);
    if (memRecord?.analysis) {
      return normalizeTrackAnalysis(memRecord.analysis);
    }

    // 2. Revisar IndexedDB
    const db = await this.init();
    if (!db) return memRecord?.analysis || null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const record = request.result as StoredTrackRecord | undefined;
          if (record?.analysis) {
            resolve(normalizeTrackAnalysis(record.analysis));
          } else if (record) {
            resolve({ status: 'pending' });
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Actualiza atómicamente los puntos CUE (CUE principal y Hot Cues) de una pista
   * sin reescribir ni clonar el archivo binario de audio (audioBlob) ni alterar su análisis musical.
   */
  public async updateTrackCues(
    id: string,
    cues: { mainCue?: number | null; hotCues?: HotCue[] }
  ): Promise<boolean> {
    const memRecord = this.memoryStore.get(id);
    const wasMemoryOnly = this.memoryOnlyIds.has(id);
    if (wasMemoryOnly) {
      if (!memRecord) return false;
      if (cues.mainCue !== undefined) memRecord.mainCue = cues.mainCue;
      if (cues.hotCues !== undefined) memRecord.hotCues = [...cues.hotCues];
      return true;
    }

    const db = await this.init();
    if (!db) {
      if (!memRecord) return false;
      if (cues.mainCue !== undefined) memRecord.mainCue = cues.mainCue;
      if (cues.hotCues !== undefined) memRecord.hotCues = [...cues.hotCues];
      return true;
    }

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
          const record = getRequest.result as StoredTrackRecord | undefined;
          if (!record) {
            resolve(false);
            return;
          }

          if (cues.mainCue !== undefined) record.mainCue = cues.mainCue;
          if (cues.hotCues !== undefined) record.hotCues = [...cues.hotCues];
          store.put(record);
        };

        getRequest.onerror = () => resolve(false);
        tx.oncomplete = () => {
          const cached = this.memoryStore.get(id);
          if (cached) {
            if (cues.mainCue !== undefined) cached.mainCue = cues.mainCue;
            if (cues.hotCues !== undefined) cached.hotCues = [...cues.hotCues];
          }
          resolve(true);
        };
        tx.onerror = (event) => {
          console.warn('[IndexedDBStorage] Error al persistir CUEs de pista:', event);
          resolve(false);
        };
        tx.onabort = () => resolve(false);
      } catch (err) {
        console.warn('[IndexedDBStorage] Excepción al actualizar CUEs de pista:', err);
        resolve(false);
      }
    });
  }

  /**
   * Obtiene exclusivamente los puntos CUE (mainCue y hotCues) de una pista persistida.
   */
  public async getTrackCues(id: string): Promise<{ mainCue: number | null; hotCues: HotCue[] } | null> {
    const memRecord = this.memoryStore.get(id);
    if (memRecord) {
      return {
        mainCue: memRecord.mainCue ?? null,
        hotCues: memRecord.hotCues ? [...memRecord.hotCues] : [],
      };
    }

    const db = await this.init();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const record = request.result as StoredTrackRecord | undefined;
          if (record) {
            this.memoryStore.set(id, record);
            resolve({
              mainCue: record.mainCue ?? null,
              hotCues: record.hotCues ? [...record.hotCues] : [],
            });
          } else {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Actualiza atómicamente la información de downbeat y métrica de compás de una pista.
   * Valida que la confirmación coincida con la identidad del contenido persistido (contentHash).
   * Devuelve false si la pista no existe, si el hash esperado difiere, o si la confirmación no pertenece al contenido.
   */
  public async updateTrackDownbeat(
    id: string,
    downbeat: TrackDownbeat,
    expectedContentHash?: string
  ): Promise<boolean> {
    // 1. Validar la estructura y coherencia del downbeat entrante
    if (downbeat.status === 'confirmed') {
      if (!isDownbeatConfirmed(downbeat, expectedContentHash)) {
        return false;
      }
    } else if (downbeat.status === 'suggested') {
      if (
        downbeat.suggestedPosition == null ||
        typeof downbeat.suggestedPosition !== 'number' ||
        !Number.isFinite(downbeat.suggestedPosition) ||
        downbeat.suggestedPosition < 0
      ) {
        return false;
      }
    } else if (downbeat.status !== 'none') {
      return false;
    }

    const wasMemoryOnly = this.memoryOnlyIds.has(id);
    let db: IDBDatabase | null = null;
    try {
      db = await this.init();
    } catch {
      db = null;
    }

    // Caso: Pista retenida exclusivamente en memoria o IndexedDB no disponible
    if (wasMemoryOnly || !db) {
      const memRecord = this.memoryStore.get(id);
      if (!memRecord) return false;

      // Si se especificó expectedContentHash, verificar coincidencia
      if (
        expectedContentHash &&
        (!memRecord.fileMeta.contentHash || memRecord.fileMeta.contentHash !== expectedContentHash)
      ) {
        return false;
      }

      // Si es confirmación manual, exigir que la pista en memoria tenga un contentHash verificado coincidente
      if (downbeat.status === 'confirmed') {
        if (!memRecord.fileMeta.contentHash || !isDownbeatConfirmed(downbeat, memRecord.fileMeta.contentHash)) {
          return false;
        }
      }

      memRecord.downbeat = downbeat;
      return true;
    }

    // Caso: IndexedDB disponible
    // IMPORTANTE: No modificar this.memoryStore hasta que la transacción en IndexedDB termine exitosamente
    return new Promise<boolean>((resolve) => {
      try {
        const tx = db!.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
          const record = getRequest.result as StoredTrackRecord | undefined;
          if (!record) {
            resolve(false);
            return;
          }

          if (
            expectedContentHash &&
            (!record.fileMeta.contentHash || record.fileMeta.contentHash !== expectedContentHash)
          ) {
            resolve(false);
            return;
          }

          if (downbeat.status === 'confirmed') {
            if (!record.fileMeta.contentHash || !isDownbeatConfirmed(downbeat, record.fileMeta.contentHash)) {
              resolve(false);
              return;
            }
          }

          record.downbeat = downbeat;
          store.put(record);
        };

        getRequest.onerror = () => resolve(false);

        tx.oncomplete = () => {
          // Solo al completarse exitosamente la transacción se sincroniza el almacén en memoria
          const memRecord = this.memoryStore.get(id);
          if (memRecord) {
            memRecord.downbeat = downbeat;
          }
          resolve(true);
        };

        tx.onerror = (event) => {
          console.warn('[IndexedDBStorage] Error al persistir downbeat de pista:', event);
          resolve(false);
        };

        tx.onabort = () => resolve(false);
      } catch (err) {
        console.warn('[IndexedDBStorage] Excepción al actualizar downbeat de pista:', err);
        resolve(false);
      }
    });
  }

  /**
   * Obtiene exclusivamente la información de downbeat de una pista almacenada.
   */
  public async getTrackDownbeat(id: string): Promise<TrackDownbeat | null> {
    const memRecord = this.memoryStore.get(id);
    if (memRecord) {
      return memRecord.downbeat ?? null;
    }

    const db = await this.init();
    if (!db) return null;

    return new Promise<TrackDownbeat | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const record = request.result as StoredTrackRecord | undefined;
          if (record) {
            this.memoryStore.set(id, record);
            resolve(record.downbeat ?? null);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Obtiene una pista completa por su identificador único desde memoria o IndexedDB.
   */
  public async getTrack(id: string): Promise<Track | null> {
    const memRecord = this.memoryStore.get(id);
    if (memRecord) {
      return this.mapRecordToTrack(memRecord);
    }

    const db = await this.init();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
          const record = request.result as StoredTrackRecord | undefined;
          if (record) {
            this.memoryStore.set(id, record);
            resolve(this.mapRecordToTrack(record));
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Comprueba si una pista existe actualmente en el almacenamiento (memoria o IndexedDB).
   */
  public async hasTrack(id: string): Promise<boolean> {
    if (this.memoryStore.has(id)) {
      return true;
    }

    const db = await this.init();
    if (!db) return false;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.count(id);

        request.onsuccess = () => {
          resolve(request.result > 0);
        };
        request.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Devuelve todas las playlists locales, de la más reciente a la más antigua.
   */
  public async getAllPlaylists(): Promise<Playlist[]> {
    const sortByRecent = (list: Playlist[]) => list.sort((a, b) => b.createdAt - a.createdAt);
    const db = await this.init();
    if (!db) return sortByRecent(Array.from(this.memoryPlaylists.values()));

    return new Promise((resolve) => {
      try {
        const request = db.transaction(PLAYLIST_STORE_NAME, 'readonly').objectStore(PLAYLIST_STORE_NAME).getAll();
        request.onsuccess = () => resolve(sortByRecent(request.result as Playlist[]));
        request.onerror = () => resolve(sortByRecent(Array.from(this.memoryPlaylists.values())));
      } catch {
        resolve(sortByRecent(Array.from(this.memoryPlaylists.values())));
      }
    });
  }

  /**
   * Crea o reemplaza una playlist completa (nombre, orden y pistas) de forma atómica.
   */
  public async savePlaylist(playlist: Playlist): Promise<SaveTrackResult> {
    const record: Playlist = { ...playlist, trackIds: [...playlist.trackIds] };
    this.memoryPlaylists.set(record.id, record);

    const db = await this.init();
    if (!db) return { persisted: false, reason: 'unsupported' };

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(PLAYLIST_STORE_NAME, 'readwrite');
        tx.objectStore(PLAYLIST_STORE_NAME).put(record);
        tx.oncomplete = () => resolve({ persisted: true });
        const onFailure = () => {
          const reason = tx.error?.name === 'QuotaExceededError' ? 'quota' : 'error';
          console.warn(`[IndexedDBStorage] No se pudo persistir la playlist ${record.id}:`, tx.error);
          resolve({ persisted: false, reason });
        };
        tx.onabort = onFailure;
        tx.onerror = onFailure;
      } catch (err) {
        console.warn('[IndexedDBStorage] Error en transacción de playlist:', err);
        resolve({ persisted: false, reason: 'error' });
      }
    });
  }

  /**
   * Elimina una playlist. Las pistas referenciadas permanecen en la biblioteca.
   */
  public async deletePlaylist(id: string): Promise<void> {
    this.memoryPlaylists.delete(id);

    const db = await this.init();
    if (!db) return;

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(PLAYLIST_STORE_NAME, 'readwrite');
        tx.objectStore(PLAYLIST_STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        const onFailure = () => {
          reject(new Error(`No se pudo eliminar la playlist con id ${id}`, { cause: tx.error }));
        };
        tx.onabort = onFailure;
        tx.onerror = onFailure;
      } catch (err) {
        reject(new Error(`Error en transacción de eliminación de playlist: ${err instanceof Error ? err.message : String(err)}`, { cause: err }));
      }
    });
  }

  /**
   * Guarda una sesión grabada (metadatos + audio) aplicando la política FIFO:
   * como máximo MAX_STORED_SESSIONS registros; al guardar una nueva con el historial lleno
   * se eliminan las más antiguas en la misma transacción y se devuelven en `evicted`.
   */
  public async saveRecordedSession(
    record: StoredSessionRecord,
    limit: number = MAX_STORED_SESSIONS,
  ): Promise<SaveSessionResult> {
    const saveInMemory = (): StoredSessionRecord[] => {
      const plan = planSessionHistoryInsert(Array.from(this.memorySessions.values()), record, limit);
      for (const evicted of plan.evicted) this.memorySessions.delete(evicted.id);
      this.memorySessions.set(plan.record.id, plan.record);
      return plan.evicted;
    };

    const db = await this.init();
    if (!db) {
      return { persisted: false, evicted: saveInMemory(), reason: 'unsupported' };
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(SESSION_STORE_NAME, 'readwrite');
        const store = tx.objectStore(SESSION_STORE_NAME);
        let evicted: StoredSessionRecord[] = [];
        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => {
          const plan = planSessionHistoryInsert(getAllRequest.result as StoredSessionRecord[], record, limit);
          evicted = plan.evicted;
          for (const old of plan.evicted) store.delete(old.id);
          store.put(plan.record);
        };

        tx.oncomplete = () => {
          for (const old of evicted) this.memorySessions.delete(old.id);
          resolve({ persisted: true, evicted });
        };
        const onFailure = () => {
          const reason = tx.error?.name === 'QuotaExceededError' ? 'quota' : 'error';
          console.warn(`[IndexedDBStorage] No se pudo persistir la sesión ${record.id}:`, tx.error);
          resolve({ persisted: false, evicted: [], reason });
        };
        tx.onabort = onFailure;
        tx.onerror = onFailure;
      } catch (err) {
        console.warn('[IndexedDBStorage] Error en transacción de sesión grabada:', err);
        resolve({ persisted: false, evicted: [], reason: 'error' });
      }
    });
  }

  /**
   * Devuelve las sesiones grabadas almacenadas, de la más reciente a la más antigua.
   */
  public async getRecordedSessions(): Promise<StoredSessionRecord[]> {
    const fromMemory = () => sortSessionsNewestFirst(Array.from(this.memorySessions.values()));
    const db = await this.init();
    if (!db) return fromMemory();

    return new Promise((resolve) => {
      try {
        const request = db.transaction(SESSION_STORE_NAME, 'readonly').objectStore(SESSION_STORE_NAME).getAll();
        request.onsuccess = () => resolve(sortSessionsNewestFirst(request.result as StoredSessionRecord[]));
        request.onerror = () => resolve(fromMemory());
      } catch {
        resolve(fromMemory());
      }
    });
  }

  private mapRecordToTrack(record: StoredTrackRecord): Track {
    return {
      id: record.id,
      title: record.title,
      artist: record.artist,
      album: record.album,
      duration: record.duration,
      durationFormatted: record.durationFormatted,
      type: record.type,
      source: {
        type: 'indexeddb',
        blob: record.audioBlob,
        indexedDbKey: record.id,
      },
      fileMeta: record.fileMeta,
      // Compatibilidad con pistas históricas sin metadatos de análisis
      analysis: normalizeTrackAnalysis(record.analysis || { status: 'pending' }),
      mainCue: record.mainCue ?? null,
      hotCues: record.hotCues ? [...record.hotCues] : [],
      downbeat: record.downbeat ?? null,
      dateAdded: record.dateAdded,
    };
  }
}


export const indexedDBStorage = IndexedDBStorage.getInstance();
