/**
 * SYSTEM DJ — Avatar File Utility
 * Validación y nombre seguro para las fotos de perfil del bucket `avatars`.
 * Supabase Storage rechaza claves con espacios, acentos y otros caracteres especiales.
 */

export const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function isValidAvatarFile(file: Pick<File, 'type' | 'size'>): boolean {
  return (ALLOWED_AVATAR_TYPES as readonly string[]).includes(file.type) && file.size > 0 && file.size <= MAX_AVATAR_BYTES;
}

export function sanitizeFileName(name: string): string {
  const sanitized = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+/, '');
  return sanitized || 'avatar';
}

export function buildAvatarPath(userId: string, fileName: string, timestamp = Date.now()): string {
  return `${userId}/${timestamp}_${sanitizeFileName(fileName)}`;
}
