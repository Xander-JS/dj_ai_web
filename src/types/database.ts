/**
 * SYSTEM DJ — Domain Model: Supabase Database & Auth Schema
 * Contratos de entidades persistentes en PostgreSQL bajo políticas Row Level Security (RLS).
 * Los archivos binarios de audio NO se almacenan en la base de datos.
 */

export interface ProfileRow {
  id: string;                // UUID referencias auth.users(id)
  username: string | null;
  full_name: string | null;   // Nombre real
  dj_alias?: string | null;   // Alias artístico visible en el Perfil
  avatar_url?: string | null;
  bio?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaylistRow {
  id: string;                // UUID
  user_id: string;           // UUID referencias auth.users(id)
  name: string;
  description?: string | null;
  cover_color: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlaylistTrackRow {
  id: string;                // UUID
  playlist_id: string;       // UUID referencias playlists(id)
  track_id: string;          // Identificador estable de metadatos
  title: string;
  artist: string;
  album?: string | null;
  bpm?: number | null;
  key?: string | null;
  duration: number;          // Segundos numéricos
  position: number;          // Orden en la lista
  created_at: string;
}

export interface UserPreferencesRow {
  user_id: string;           // UUID referencias auth.users(id)
  theme: 'dark' | 'light';
  language: 'es' | 'en';
  mixer_defaults?: Record<string, unknown>;
  updated_at: string;
}

export type AuthStateStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthUserState {
  id: string;
  email?: string;
  profile?: ProfileRow | null;
}
