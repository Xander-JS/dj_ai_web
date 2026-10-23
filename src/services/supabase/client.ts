import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente Supabase del frontend. Solo gestiona identidad (auth) y perfiles;
 * el audio nunca se sube ni se procesa en Supabase.
 * Si faltan las variables VITE_, la app sigue funcionando en modo local sin cuenta.
 * El SDK se carga bajo demanda para no inflar el bundle inicial.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const AVATARS_BUCKET = 'avatars';

export type RecoveryLinkState = 'active' | 'expired' | null;

/**
 * Lee el enlace de recuperación antes de que el SDK limpie la URL. Respaldo del evento
 * PASSWORD_RECOVERY (flujo implícito) y única vía para detectar un enlace caducado.
 */
function readRecoveryLink(): RecoveryLinkState {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  if (params.get('error_code') === 'otp_expired') return 'expired';
  return params.get('type') === 'recovery' ? 'active' : null;
}

export const recoveryLinkFromUrl = readRecoveryLink();

let clientPromise: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> {
  if (!url || !anonKey) return Promise.reject(new Error('Supabase is not configured'));
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(url, anonKey));
  return clientPromise;
}
