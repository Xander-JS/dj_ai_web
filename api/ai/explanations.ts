// Función serverless de Vercel: POST /api/ai/explanations
// Adaptador HTTP sobre la lógica pura de ../_lib/explanations.ts (idéntica al
// middleware de desarrollo de vite.config.ts). La API key vive solo en el
// servidor (variables de entorno de Vercel), nunca en el cliente.
import { generateExplanations, MAX_REQUEST_BYTES, type AIProvider } from '../_lib/explanations.ts';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json(405, { success: false, errorCode: 'invalid_response' });
  }

  // DeepSeek tiene prioridad cuando su clave está definida; si no, Gemini.
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const provider: AIProvider = deepseekKey ? 'deepseek' : 'gemini';
  const apiKey = deepseekKey || process.env.GEMINI_API_KEY;

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json(413, { success: false, errorCode: 'invalid_response' });
  }

  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_REQUEST_BYTES) {
    return json(413, { success: false, errorCode: 'invalid_response' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return json(400, { success: false, errorCode: 'invalid_response' });
  }

  const result = await generateExplanations(payload, apiKey, provider);
  return json(result.status, result.body);
}
