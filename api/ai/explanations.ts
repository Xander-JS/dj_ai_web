// Función serverless de Vercel: POST /api/ai/explanations
// Adaptador HTTP sobre la lógica pura de ../_lib/explanations (idéntica al
// middleware de desarrollo de vite.config.ts). La API key vive solo en el
// servidor (variables de entorno de Vercel), nunca en el cliente.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { IncomingMessage } from 'node:http';
import { generateExplanations, MAX_REQUEST_BYTES, type AIProvider } from '../_lib/explanations';

// Leemos el cuerpo manualmente para poder acotar el tamaño exactamente a 16 KB.
export const config = { api: { bodyParser: false } };

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > limit) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, errorCode: 'invalid_response' });
    return;
  }

  // DeepSeek tiene prioridad cuando su clave está definida; si no, Gemini.
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const provider: AIProvider = deepseekKey ? 'deepseek' : 'gemini';
  const apiKey = deepseekKey || process.env.GEMINI_API_KEY;

  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    res.status(413).json({ success: false, errorCode: 'invalid_response' });
    return;
  }

  const raw = await readBody(req, MAX_REQUEST_BYTES);
  if (raw === null) {
    res.status(413).json({ success: false, errorCode: 'invalid_response' });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).json({ success: false, errorCode: 'invalid_response' });
    return;
  }

  const result = await generateExplanations(payload, apiKey, provider);
  res.status(result.status).json(result.body);
}
