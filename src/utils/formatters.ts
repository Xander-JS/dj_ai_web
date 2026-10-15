/**
 * SYSTEM DJ — Formatters Utility
 * Utilidades centralizadas para formateo de tiempo, tamaño en bytes y fechas.
 */

/**
 * Formatea una duración en segundos a formato "mm:ss" (o "hh:mm:ss" si supera 1 hora).
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const paddedSecs = secs.toString().padStart(2, '0');

  if (hrs > 0) {
    const paddedMins = mins.toString().padStart(2, '0');
    return `${hrs}:${paddedMins}:${paddedSecs}`;
  }

  return `${mins}:${paddedSecs}`;
}

/**
 * Formatea un tamaño en bytes a representación legible (KB, MB, GB).
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  if (isNaN(bytes) || bytes < 0) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const safeIndex = Math.min(i, sizes.length - 1);

  return `${parseFloat((bytes / Math.pow(k, safeIndex)).toFixed(dm))} ${sizes[safeIndex]}`;
}

/**
 * Formatea una marca de tiempo en una fecha corta legible.
 */
export function formatDate(timestamp: number): string {
  if (!timestamp || isNaN(timestamp)) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
