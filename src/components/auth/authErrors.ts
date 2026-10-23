import type { TFunction } from 'i18next';

const KNOWN_CODES = ['invalid_credentials', 'email_not_confirmed', 'user_already_exists', 'weak_password', 'over_email_send_rate_limit', 'same_password'];
// Sesión de recuperación ausente o caducada: el enlace del correo ya no sirve
const EXPIRED_LINK_CODES = ['otp_expired', 'session_not_found', 'session_expired', 'refresh_token_not_found'];

// Traduce los códigos conocidos de Supabase Auth; el resto cae a un mensaje genérico
export function getAuthErrorMessage(error: unknown, t: TFunction): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (EXPIRED_LINK_CODES.includes(code) || (error instanceof Error && error.name === 'AuthSessionMissingError')) {
    return t('auth.errors.link_expired');
  }
  return KNOWN_CODES.includes(code) ? t(`auth.errors.${code}`) : t('auth.errors.generic');
}

export const MIN_PASSWORD_LENGTH = 6;
