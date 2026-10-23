/**
 * SYSTEM DJ — YouTube Audio Service
 * Adaptador del microservicio local de extracción (server/, FastAPI + yt-dlp).
 * Recibe el audio como Blob en memoria; no persiste nada.
 */

const DEFAULT_SERVICE_URL = 'http://localhost:8000';
export const FALLBACK_FILENAME = 'youtube-audio.mp3';

export type YouTubeImportErrorCode =
  | 'invalid_url'        // 422 o URL mal formada antes de enviar
  | 'rejected'           // 400: duración > 10 min, directo, video no disponible...
  | 'service_unreachable'
  | 'aborted'
  | 'server';

export class YouTubeImportError extends Error {
  readonly code: YouTubeImportErrorCode;
  readonly status?: number;
  // Mensaje legible devuelto por el backend (campo `detail`), si existe
  readonly detail?: string;

  constructor(code: YouTubeImportErrorCode, options: { status?: number; detail?: string } = {}) {
    super(options.detail ?? code);
    this.name = 'YouTubeImportError';
    this.code = code;
    this.status = options.status;
    this.detail = options.detail;
  }
}

export interface ExtractedAudio {
  blob: Blob;
  filename: string;
  durationSeconds?: number;
}

export interface ExtractAudioOptions {
  signal?: AbortSignal;
  serviceUrl?: string;
  fetchImpl?: typeof fetch;
}

const getServiceUrl = (): string =>
  (import.meta.env?.VITE_AUDIO_SERVICE_URL as string | undefined) || DEFAULT_SERVICE_URL;

export const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

// Prioriza filename* (RFC 5987, UTF-8) sobre filename="..."
export const parseContentDispositionFilename = (header: string | null): string | null => {
  if (!header) return null;

  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (extended) {
    try {
      const decoded = decodeURIComponent(extended[1].trim());
      if (decoded) return decoded;
    } catch {
      // Codificación inválida: probar con filename simple
    }
  }

  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(header);
  const name = (plain?.[1] ?? plain?.[2])?.trim();
  return name || null;
};

// FastAPI devuelve `detail` como string (HTTPException) o como lista (errores de validación 422)
const readErrorDetail = async (response: Response): Promise<string | undefined> => {
  try {
    const body = await response.json() as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) {
      const first = body.detail[0] as { msg?: unknown } | undefined;
      if (typeof first?.msg === 'string') return first.msg.replace(/^Value error,\s*/, '');
    }
  } catch {
    // Respuesta sin JSON
  }
  return undefined;
};

const codeForStatus = (status: number): YouTubeImportErrorCode => {
  if (status === 400) return 'rejected';
  if (status === 422) return 'invalid_url';
  return 'server';
};

export const extractAudioFromYouTube = async (
  url: string,
  { signal, serviceUrl = getServiceUrl(), fetchImpl = fetch }: ExtractAudioOptions = {},
): Promise<ExtractedAudio> => {
  const trimmed = url.trim();
  if (!isValidHttpUrl(trimmed)) throw new YouTubeImportError('invalid_url');

  let response: Response;
  try {
    response = await fetchImpl(`${serviceUrl}/api/extract-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmed }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new YouTubeImportError('aborted');
    throw new YouTubeImportError('service_unreachable', { detail: (error as Error)?.message });
  }

  if (!response.ok) {
    throw new YouTubeImportError(codeForStatus(response.status), {
      status: response.status,
      detail: await readErrorDetail(response),
    });
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error) {
    if (signal?.aborted) throw new YouTubeImportError('aborted');
    throw new YouTubeImportError('server', { detail: (error as Error)?.message });
  }
  if (blob.size === 0) throw new YouTubeImportError('server', { status: response.status });

  const duration = Number(response.headers.get('X-Audio-Duration'));
  return {
    blob,
    filename: parseContentDispositionFilename(response.headers.get('Content-Disposition')) ?? FALLBACK_FILENAME,
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
  };
};
