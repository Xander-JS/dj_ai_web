import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured, recoveryLinkFromUrl, AVATARS_BUCKET } from '../services/supabase/client';
import type { ProfileRow } from '../types/database';
import { buildAvatarPath } from '../utils/avatarFile';

export type PasswordRecoveryState = 'idle' | 'active' | 'expired';

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: ProfileRow | null;
  loading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  refreshProfile: () => Promise<void>;
  passwordRecovery: PasswordRecoveryState;
  updatePassword: (password: string) => Promise<void>;
  endPasswordRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const client = await getSupabase();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as ProfileRow | null;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [passwordRecovery, setPasswordRecovery] = useState<PasswordRecoveryState>(
    isSupabaseConfigured && recoveryLinkFromUrl ? recoveryLinkFromUrl : 'idle',
  );
  const user = session?.user ?? null;
  const userId = user?.id ?? null;

  // Sesión inicial + suscripción a cambios (login, logout, refresh de token)
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    getSupabase()
      .then(async (client) => {
        if (!active) return;
        const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => {
          setSession(nextSession);
          // El enlace del correo de recuperación abre una sesión temporal para cambiar la contraseña
          if (event === 'PASSWORD_RECOVERY') setPasswordRecovery('active');
        });
        unsubscribe = () => subscription.unsubscribe();
        const { data } = await client.auth.getSession();
        if (active) setSession(data.session);
      })
      .catch(() => { /* sin sesión: la app sigue en modo local */ })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  // El perfil lo crea el trigger de Supabase al registrarse; aquí solo se lee
  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchProfile(userId)
      .then((row) => { if (active) setProfile(row); })
      .catch(() => { if (active) setProfile(null); });
    return () => { active = false; };
  }, [userId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await (await getSupabase()).auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await (await getSupabase()).auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    // Sin sesión inmediata significa que el proyecto exige confirmar el email
    return { needsConfirmation: !data.session };
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await (await getSupabase()).auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await (await getSupabase()).auth.signOut();
    if (error) throw error;
    // Limpia ya el estado local para que la redirección a "/" no vea una sesión residual
    setSession(null);
    setProfile(null);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await (await getSupabase()).auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const endPasswordRecovery = useCallback(() => {
    setPasswordRecovery('idle');
    // Quita los restos del enlace (p. ej. #error_code=otp_expired) para no reabrir el flujo
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    setProfile(await fetchProfile(userId));
  }, [userId]);

  const uploadAvatar = useCallback(async (file: File) => {
    if (!userId) throw new Error('Not authenticated');
    const client = await getSupabase();
    const path = buildAvatarPath(userId, file.name);
    const bucket = client.storage.from(AVATARS_BUCKET);
    const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type });
    if (uploadError) {
      // Estado HTTP y mensaje del bucket/RLS para depurar (p. ej. 400 clave inválida, 403 política)
      console.error('[avatar] Storage upload failed', uploadError);
      throw uploadError;
    }
    const { data: { publicUrl } } = bucket.getPublicUrl(path);
    const { data, error } = await client
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId)
      .select()
      .single();
    if (error) {
      // Sin política UPDATE en profiles la actualización afecta 0 filas y .single() falla
      console.error('[avatar] profiles.avatar_url update failed', error);
      throw error;
    }
    setProfile(data as ProfileRow);
  }, [userId]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    session,
    profile: userId ? profile : null,
    loading,
    isConfigured: isSupabaseConfigured,
    signIn,
    signUp,
    resetPassword,
    signOut,
    uploadAvatar,
    refreshProfile,
    passwordRecovery,
    updatePassword,
    endPasswordRecovery,
  }), [user, session, userId, profile, loading, signIn, signUp, resetPassword, signOut, uploadAvatar, refreshProfile, passwordRecovery, updatePassword, endPasswordRecovery]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
