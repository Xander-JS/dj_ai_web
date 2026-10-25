/**
 * SYSTEM DJ — Uso de almacenamiento local
 * Pistas guardadas en IndexedDB y estimación de cuota del navegador para Ajustes → Biblioteca.
 */

import { indexedDBStorage } from '../../services/storage/IndexedDBStorage';

export interface StorageUsage {
  trackCount: number;
  trackBytes: number;
  usage: number | null;
  quota: number | null;
}

const BYTES_PER_MB = 1024 * 1024;
export const toMb = (bytes: number): string => (bytes / BYTES_PER_MB).toFixed(1);

/** Pistas guardadas en IndexedDB y estimación de cuota del navegador (si la expone). */
export async function readStorageUsage(): Promise<StorageUsage> {
  const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate
    ? navigator.storage.estimate().catch(() => null)
    : Promise.resolve(null);
  const [tracks, est] = await Promise.all([indexedDBStorage.getAllTracks().catch(() => []), estimate]);
  return {
    trackCount: tracks.length,
    trackBytes: tracks.reduce((sum, track) => sum + (track.fileMeta?.fileSize ?? 0), 0),
    usage: est?.usage ?? null,
    quota: est?.quota ?? null,
  };
}
