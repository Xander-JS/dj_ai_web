/**
 * Base de las APIs de IA.
 * - Web (Vercel) y `npm run dev`: vacío → se usan rutas relativas (mismo origen
 *   en Vercel; middleware/proxy de Vite en desarrollo). No cambia nada de lo actual.
 * - Build de escritorio (Electron): se define VITE_API_BASE_URL para apuntar al
 *   despliegue de Vercel, ya que la app se sirve desde app:// y no tiene backend propio.
 */
const API_BASE = ((import.meta.env?.VITE_API_BASE_URL as string | undefined) || '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return API_BASE ? API_BASE + path : path;
}
