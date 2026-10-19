import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer, type PreviewServer } from 'vite';

interface DevApiCandidateTrack {
  id: string;
  title: string;
  artist: string;
  bpm?: number;
  key?: string;
  camelot?: string;
  energy?: number;
}

interface DevApiReferenceTrack {
  id?: string;
  title: string;
  artist: string;
  bpm?: number;
  key?: string;
  camelot?: string;
  energy?: number;
}

interface DevApiRequestBody {
  referenceTrack?: DevApiReferenceTrack;
  candidateTracks?: DevApiCandidateTrack[];
  forceMock?: boolean;
}

interface GeminiRecommendationItem {
  trackId: string;
  compatibilityScore: number;
  justification: string;
  transitionSuggestion: string;
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

/**
 * SYSTEM DJ — Gemini AI Local Development Endpoint Plugin
 *
 * NOTA DE ARQUITECTURA:
 * Este endpoint local en el servidor de desarrollo de Vite es exclusivo para desarrollo
 * local seguro. Lee GEMINI_API_KEY del entorno del servidor y nunca expone la clave al
 * cliente web ni a los bundles de producción. No constituye una solución de backend
 * de producción (en producción se debe emplear un API Gateway, Cloudflare Worker o Edge Function).
 */
function geminiDevApiPlugin(apiKey?: string): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ? req.url.split('?')[0] : '';
    if (url !== '/api/ai/recommendations') {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: 'Method not allowed. Use POST.' }));
      return;
    }

    let bodyStr = '';
    req.on('data', (chunk: Buffer | string) => {
      bodyStr += chunk.toString();
    });

    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json');
      let payload: DevApiRequestBody;
      try {
        payload = JSON.parse(bodyStr || '{}') as DevApiRequestBody;
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
        return;
      }

      const { referenceTrack, candidateTracks, forceMock } = payload;

      if (!referenceTrack || !Array.isArray(candidateTracks)) {
        res.statusCode = 400;
        res.end(JSON.stringify({
          success: false,
          error: 'Missing required parameters: referenceTrack and candidateTracks must be provided.'
        }));
        return;
      }

      if (candidateTracks.length === 0) {
        res.statusCode = 200;
        res.end(JSON.stringify({
          success: true,
          recommendations: [],
          isMock: false,
          message: 'No candidate tracks provided.'
        }));
        return;
      }

      // Generador de respuestas simuladas (Mock) identificadas explícitamente
      const generateMockRecs = () => {
        const sorted = [...candidateTracks].slice(0, 3).map((candidate, idx) => {
          const bpmDiff = Math.abs((candidate.bpm || 120) - (referenceTrack.bpm || 120));
          const score = Math.max(70, Math.min(98, 95 - bpmDiff * 2 - idx * 5));
          return {
            trackId: candidate.id,
            title: candidate.title,
            artist: candidate.artist,
            bpm: candidate.bpm,
            key: candidate.key,
            camelot: candidate.camelot,
            energy: candidate.energy,
            compatibilityScore: score,
            justification: `[SIMULACIÓN] Armonía compatible (${candidate.camelot || candidate.key || 'N/A'}) y tempo cercano a ${referenceTrack.bpm || 120} BPM.`,
            transitionSuggestion: '[SIMULACIÓN] Realiza una mezcla gradual de graves durante el drop y alinea compases en el compás 16.',
            isMock: true,
          };
        });
        return sorted;
      };

      // Si se solicita mock forzado o no hay clave disponible
      if (forceMock || !apiKey) {
        if (!apiKey && !forceMock) {
          res.statusCode = 200;
          res.end(JSON.stringify({
            success: true,
            recommendations: generateMockRecs(),
            isMock: true,
            warning: 'GEMINI_API_KEY no está configurada en .env. Se devuelven recomendaciones simuladas (Mock).'
          }));
          return;
        }

        res.statusCode = 200;
        res.end(JSON.stringify({
          success: true,
          recommendations: generateMockRecs(),
          isMock: true
        }));
        return;
      }

      // Llamada real a Google Gemini API
      try {
        const candidateMap = new Map<string, DevApiCandidateTrack>(
          candidateTracks.map((t) => [t.id, t])
        );

        const systemPrompt = `You are an expert DJ harmonic mixing and track transition AI assistant for SYSTEM DJ.
Your task is to analyze a reference track currently loaded/playing on a DJ deck, and recommend up to 3 candidate tracks from the user's library for the best musical transition.

Consider:
1. Tempo / BPM: Ideal tempo matching or small pitch adjustment (±4-8%), or half-time/double-time transitions.
2. Harmonic Compatibility: Using the Camelot Wheel (exact match e.g. 8A -> 8A; adjacent hours e.g. 8A -> 7A or 9A; relative major/minor e.g. 8A -> 8B; energy boost +1/2 semitones or mood shift).
3. Energy Flow: Maintaining energy, smooth build up, or controlled cooldown.

Reference Track:
${JSON.stringify({
  id: referenceTrack.id,
  title: referenceTrack.title || 'Untitled Track',
  artist: referenceTrack.artist || 'Unknown Artist',
  bpm: referenceTrack.bpm ?? 'Unknown',
  key: referenceTrack.key ?? 'Unknown',
  camelot: referenceTrack.camelot ?? 'Unknown',
  energy: referenceTrack.energy ?? 'Unknown',
})}

Candidate Tracks (Library):
${JSON.stringify(
  candidateTracks.map((c) => ({
    id: c.id,
    title: c.title || 'Untitled Track',
    artist: c.artist || 'Unknown Artist',
    bpm: c.bpm ?? 'Unknown',
    key: c.key ?? 'Unknown',
    camelot: c.camelot ?? 'Unknown',
    energy: c.energy ?? 'Unknown',
  }))
)}

Return valid JSON with exactly this structure:
{
  "recommendations": [
    {
      "trackId": "<exact id from candidate tracks>",
      "compatibilityScore": <integer between 1 and 100>,
      "justification": "<concise musical explanation in Spanish or English based on harmonic/tempo relationship, 1-2 sentences>",
      "transitionSuggestion": "<actionable DJ transition technique e.g. beatmatch, EQ swap, loop transition, or filter fade, 1-2 sentences>"
    }
  ]
}

Only return candidates from the provided list. Do not invent tracks or track IDs. If some tracks lack BPM or harmonic key, evaluate compatibility using available metadata (title, artist, energy, genre knowledge) or advise on best-effort transition. If fewer than 3 candidates are suitable, return only the suitable ones.`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const apiResponse = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.3,
              thinkingConfig: {
                thinkingBudget: 0,
              },
            },
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!apiResponse.ok) {
          const errText = await apiResponse.text().catch(() => '');
          const sanitizedDetails = apiKey
            ? errText.replaceAll(apiKey, '[REDACTED_API_KEY]').slice(0, 300)
            : errText.slice(0, 300);

          const status = apiResponse.status;
          let errorCode = 'server_error';
          let userMsg = `Gemini API responded with status ${status}`;

          if (status === 429) {
            errorCode = 'quota_exceeded';
            userMsg = 'Gemini API: cuota excedida o límite de velocidad alcanzado (HTTP 429).';
          } else if (status === 401 || status === 403) {
            errorCode = 'auth_error';
            userMsg = 'Gemini API: error de autenticación (clave de API inválida o permisos denegados).';
          } else if (status >= 500) {
            errorCode = 'server_error';
            userMsg = `Servicio de Google Gemini temporalmente no disponible (HTTP ${status}).`;
          }

          console.error(`[GeminiDevAPI] HTTP ${status} Error:`, sanitizedDetails);

          res.statusCode = status >= 500 ? 502 : status;
          res.end(JSON.stringify({
            success: false,
            errorCode,
            error: userMsg,
            details: sanitizedDetails,
            isMock: false
          }));
          return;
        }

        const data = (await apiResponse.json()) as GeminiApiResponse;
        const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!rawContent) {
          console.error('[GeminiDevAPI Error]: Empty content received from Gemini API');
          res.statusCode = 502;
          res.end(JSON.stringify({
            success: false,
            errorCode: 'empty_response',
            error: 'Empty response received from Gemini API',
            isMock: false
          }));
          return;
        }

        let parsed: { recommendations?: GeminiRecommendationItem[] } | GeminiRecommendationItem[] | null = null;
        try {
          parsed = JSON.parse(rawContent);
        } catch {
          console.error('[GeminiDevAPI Error]: Failed to parse JSON response from Gemini:', rawContent.slice(0, 200));
          res.statusCode = 502;
          res.end(JSON.stringify({
            success: false,
            errorCode: 'invalid_response',
            error: 'Failed to parse JSON response from Gemini',
            isMock: false
          }));
          return;
        }

        // Manejo defensivo: soporta { recommendations: [...] }, array directo [...] o null/inválido
        let rawList: unknown[] = [];
        if (Array.isArray(parsed)) {
          rawList = parsed;
        } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { recommendations?: unknown[] }).recommendations)) {
          rawList = (parsed as { recommendations: unknown[] }).recommendations;
        }

        const validatedRecs = rawList
          .filter((item): item is GeminiRecommendationItem => Boolean(
            item &&
            typeof item === 'object' &&
            typeof (item as GeminiRecommendationItem).trackId === 'string' &&
            candidateMap.has((item as GeminiRecommendationItem).trackId)
          ))
          .slice(0, 3)
          .map((item) => {
            const original = candidateMap.get(item.trackId)!;
            return {
              trackId: item.trackId,
              title: original.title,
              artist: original.artist,
              bpm: original.bpm,
              key: original.key,
              camelot: original.camelot,
              energy: original.energy,
              compatibilityScore: typeof item.compatibilityScore === 'number'
                ? Math.max(1, Math.min(100, Math.round(item.compatibilityScore)))
                : 85,
              justification: item.justification || 'Compatibilidad musical evaluada por Gemini.',
              transitionSuggestion: item.transitionSuggestion || 'Alinea el tempo y realiza transición con EQ de 3 bandas.',
              isMock: false,
            };
          });

        res.statusCode = 200;
        res.end(JSON.stringify({
          success: true,
          recommendations: validatedRecs,
          isMock: false,
          model: 'gemini-2.5-flash',
        }));
      } catch (err: unknown) {
        const error = err as { name?: string; message?: string };
        const isAbort = error?.name === 'AbortError';
        const isNetwork = error?.name === 'TypeError' || error?.message?.includes('fetch failed');
        const errorCode = isAbort ? 'timeout' : isNetwork ? 'network_error' : 'server_error';
        const errorMsg = isAbort
          ? 'Gemini API request timed out (20s)'
          : isNetwork
          ? 'Network connection error while contacting Gemini API'
          : 'Internal server error while processing AI recommendation';

        console.error('[GeminiDevAPI Error]:', error?.message || String(err));

        res.statusCode = isAbort ? 504 : isNetwork ? 503 : 500;
        res.end(JSON.stringify({
          success: false,
          errorCode,
          error: errorMsg,
          details: error?.message || String(err),
          isMock: false
        }));
      }
    });
  };

  return {
    name: 'system-dj-gemini-dev-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(handler);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;

  return {
    plugins: [
      react(),
      geminiDevApiPlugin(apiKey),
    ],
  };
});
