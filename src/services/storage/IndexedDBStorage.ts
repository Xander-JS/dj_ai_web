/**
 * SYSTEM DJ — Local IndexedDB Storage Service
 * Persistencia local en cliente para pistas de audio y metadatos sin subir archivos a servidores.
 * Base de datos: SystemDJ_Storage | Almacén: tracks
 */

import type { Track } from '../../types/track';

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
  };
  analysis: Track['analysis'];
  dateAdded: number;
}

const DB_NAME = 'SystemDJ_Storage';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';

export class IndexedDBStorage {
  private static instance: IndexedDBStorage | null = null;
  private db: IDBDatabase | null = null;
  private isSupported = typeof indexedDB !== 'undefined';

  // Almacén en memoria como respaldo ante entornos sin IndexedDB o fallo de cuota
  private memoryStore: Map<string, StoredTrackRecord> = new Map();

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
   * Guarda una pista y su blob binario en almacenamiento local persistente.
   */
  public async saveTrack(track: Track, audioBlob: Blob): Promise<void> {
    const record: StoredTrackRecord = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      durationFormatted: track.durationFormatted,
      type: track.type,
      audioBlob,
      fileMeta: track.fileMeta || {
        fileName: track.title,
        fileSize: audioBlob.size,
        mimeType: audioBlob.type || 'audio/mpeg',
        lastModified: Date.now(),
      },
      analysis: track.analysis,
      dateAdded: track.dateAdded || Date.now(),
    };

    const db = await this.init();

    if (!db) {
      // Guardar en memoria si IndexedDB no está disponible
      this.memoryStore.set(record.id, record);
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(record);

        request.onsuccess = () => {
          // Mantener sincronizado también en memoria
          this.memoryStore.set(record.id, record);
          resolve();
        };

        request.onerror = (event) => {
          const error = (event.target as IDBRequest).error;
          console.warn('[IndexedDBStorage] Error al persistir pista en IndexedDB:', error);

          // Si se excede la cuota de almacenamiento, conservar en memoria como respaldo
          if (error && error.name === 'QuotaExceededError') {
            this.memoryStore.set(record.id, record);
            resolve();
            return;
          }

          reject(new Error(`Error guardando pista: ${error ? error.message : 'desconocido'}`));
        };
      } catch {
        this.memoryStore.set(record.id, record);
        resolve();
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
   */
  public async deleteTrack(id: string): Promise<void> {
    this.memoryStore.delete(id);

    const db = await this.init();
    if (!db) return;

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          reject(new Error(`No se pudo eliminar la pista con id ${id}`));
        };
      } catch (err) {
        reject(new Error(`Error en transacción de eliminación: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  }

  /**
   * Elimina todos los registros de la biblioteca local.
   */
  public async clearAll(): Promise<void> {
    this.memoryStore.clear();

    const db = await this.init();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
      } catch {
        resolve();
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
      analysis: record.analysis,
      dateAdded: record.dateAdded,
    };
  }
}

export const indexedDBStorage = IndexedDBStorage.getInstance();
