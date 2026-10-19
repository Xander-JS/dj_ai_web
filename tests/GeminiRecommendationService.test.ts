/**
 * SYSTEM DJ — Gemini AI Recommendation Service Unit Tests
 * Pruebas unitarias para extracción de metadatos, validación de esquemas,
 * prevención de alucinaciones, respuestas simuladas y tolerancia a errores HTTP y de red.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  extractCandidateMetadata,
  generateMockRecommendations,
  validateRecommendations,
  getTrackRecommendations,
} from '../src/services/ai/geminiRecommendationService.ts';
import type { Track } from '../src/types/track.ts';

function createStubTrack(
  id: string,
  title: string,
  artist: string,
  bpm?: number,
  camelot?: Track['analysis']['camelot'],
  energy?: number
): Track {
  return {
    id,
    title,
    artist,
    duration: 180,
    durationFormatted: '3:00',
    type: 'audio',
    source: { type: 'indexeddb', indexedDbKey: id },
    analysis: {
      status: bpm ? 'analyzed' : 'pending',
      bpm,
      key: camelot ? 'Am' : undefined,
      camelot,
      energy,
    },
    dateAdded: 1600000000000,
  };
}

function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}/api/ai/recommendations`;
      resolve({
        url,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

describe('Gemini Recommendation Service — Extracción, Validación y Mock', () => {
  describe('1. extractCandidateMetadata (Seguridad de Metadatos y Tolerancia)', () => {
    test('Extrae únicamente metadatos esenciales y omite blobs, buffers y CUEs', () => {
      const fullTrack: Track = {
        ...createStubTrack('t1', 'Track One', 'Artist A', 124, '8A', 7),
        source: {
          type: 'blob',
          blob: new Blob(['audio-binary-data'], { type: 'audio/wav' }),
        },
        mainCue: 12.5,
        hotCues: [{ id: 1, position: 2.0, trackId: 't1', color: '#ff0000', createdAt: 12345 }],
      };

      const meta = extractCandidateMetadata(fullTrack);

      assert.deepEqual(meta, {
        id: 't1',
        title: 'Track One',
        artist: 'Artist A',
        bpm: 124,
        key: 'Am',
        camelot: '8A',
        energy: 7,
      });

      const rawMeta = meta as Record<string, unknown>;
      assert.equal(rawMeta.source, undefined);
      assert.equal(rawMeta.blob, undefined);
      assert.equal(rawMeta.mainCue, undefined);
      assert.equal(rawMeta.hotCues, undefined);
    });

    test('Proporciona fallbacks para pistas con metadatos faltantes o incompletos', () => {
      const emptyTrack: Track = {
        id: 't-empty',
        title: '',
        artist: '',
        duration: 0,
        durationFormatted: '0:00',
        type: 'audio',
        source: { type: 'indexeddb' },
        analysis: { status: 'pending' },
        dateAdded: Date.now(),
      };

      const meta = extractCandidateMetadata(emptyTrack);
      assert.equal(meta.id, 't-empty');
      assert.equal(meta.title, 'Untitled Track');
      assert.equal(meta.artist, 'Unknown Artist');
      assert.equal(meta.bpm, undefined);
      assert.equal(meta.camelot, undefined);
    });
  });

  describe('2. generateMockRecommendations (Simulación Heurística Local)', () => {
    test('Genera hasta 3 recomendaciones ordenadas con isMock = true', () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'Ref Track', 'DJ A', 124, '8A', 8));
      const candidates = [
        extractCandidateMetadata(createStubTrack('ref', 'Ref Track', 'DJ A', 124, '8A', 8)),
        extractCandidateMetadata(createStubTrack('c1', 'Close Harmonic', 'DJ B', 125, '8A', 7)),
        extractCandidateMetadata(createStubTrack('c2', 'Far Key', 'DJ C', 130, '2B', 5)),
        extractCandidateMetadata(createStubTrack('c3', 'Adjacent Key', 'DJ D', 123, '9A', 8)),
        extractCandidateMetadata(createStubTrack('c4', 'Far BPM', 'DJ E', 160, '8A', 9)),
      ];

      const recs = generateMockRecommendations(ref, candidates);

      assert.ok(recs.length <= 3);
      assert.ok(recs.length >= 1);
      assert.ok(recs.every((r) => r.isMock === true));
      assert.ok(recs.every((r) => r.compatibilityScore >= 1 && r.compatibilityScore <= 100));
      assert.ok(recs.every((r) => r.trackId !== 'ref'));
      assert.equal(recs[0].trackId, 'c1');
    });

    test('Maneja pistas sin BPM ni clave armónica sin arrojar excepciones', () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'No Meta Ref', ''));
      const c1 = extractCandidateMetadata(createStubTrack('c1', 'No Meta Cand 1', ''));
      const c2 = extractCandidateMetadata(createStubTrack('c2', 'No Meta Cand 2', ''));

      const recs = generateMockRecommendations(ref, [ref, c1, c2]);
      assert.equal(recs.length, 2);
      assert.ok(recs.every((r) => r.isMock === true));
      assert.ok(recs.every((r) => typeof r.justification === 'string' && r.justification.length > 0));
    });

    test('Devuelve array vacío si la lista de candidatos solo contiene la referencia', () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'Ref Track', 'DJ A', 124, '8A', 8));
      const recs = generateMockRecommendations(ref, [ref]);
      assert.deepEqual(recs, []);
    });
  });

  describe('3. validateRecommendations (Defensa contra Alucinaciones de IA)', () => {
    test('Descarta IDs alucinados por el modelo que no existen en candidateTracks', () => {
      const candidates = [
        extractCandidateMetadata(createStubTrack('real-1', 'Real Track 1', 'Artist', 124, '8A', 7)),
        extractCandidateMetadata(createStubTrack('real-2', 'Real Track 2', 'Artist', 126, '8B', 8)),
      ];

      const rawAiResponse = [
        {
          trackId: 'hallucinated-id-999',
          compatibilityScore: 99,
          justification: 'Invented track',
          transitionSuggestion: 'Do not play',
        },
        {
          trackId: 'real-1',
          compatibilityScore: 94,
          justification: 'Great harmonic fit in 8A',
          transitionSuggestion: 'Blend EQ low',
        },
      ];

      const validated = validateRecommendations(rawAiResponse, candidates, false);

      assert.equal(validated.length, 1);
      assert.equal(validated[0].trackId, 'real-1');
      assert.equal(validated[0].title, 'Real Track 1');
      assert.equal(validated[0].compatibilityScore, 94);
      assert.equal(validated[0].isMock, false);
    });

    test('Limita estrictamente a 3 recomendaciones y clipea puntuaciones inválidas', () => {
      const candidates = [
        extractCandidateMetadata(createStubTrack('t1', 'Track 1', 'A', 120)),
        extractCandidateMetadata(createStubTrack('t2', 'Track 2', 'A', 120)),
        extractCandidateMetadata(createStubTrack('t3', 'Track 3', 'A', 120)),
        extractCandidateMetadata(createStubTrack('t4', 'Track 4', 'A', 120)),
      ];

      const rawAiResponse = [
        { trackId: 't1', compatibilityScore: 150 }, // Debe clipearse a 100
        { trackId: 't2', compatibilityScore: -20 }, // Debe clipearse a 1
        { trackId: 't3', compatibilityScore: 85 },
        { trackId: 't4', compatibilityScore: 80 },  // Debe truncarse por límite de 3
      ];

      const validated = validateRecommendations(rawAiResponse, candidates, false);
      assert.equal(validated.length, 3);
      assert.equal(validated[0].compatibilityScore, 100);
      assert.equal(validated[1].compatibilityScore, 1);
      assert.equal(validated[2].compatibilityScore, 85);
    });

    test('Maneja entradas no válidas (null, undefined, strings) de forma segura', () => {
      const candidates = [extractCandidateMetadata(createStubTrack('t1', 'T1', 'A'))];
      assert.deepEqual(validateRecommendations(null, candidates, false), []);
      assert.deepEqual(validateRecommendations('invalid-string', candidates, false), []);
      assert.deepEqual(validateRecommendations([null, undefined, 42], candidates, false), []);
    });
  });

  describe('4. getTrackRecommendations (Protocolo HTTP y Tolerancia de Errores)', () => {
    test('1. Biblioteca con una sola canción o vacía devuelve advertencia sin error', async () => {
      const ref = createStubTrack('ref', 'Ref', 'A', 124);
      const result = await getTrackRecommendations(ref, [ref]);

      assert.equal(result.success, true);
      assert.deepEqual(result.recommendations, []);
      assert.ok(result.warning?.includes('No hay suficientes pistas'));
    });

    test('2. Modo simulación (forceMock = true) devuelve recomendaciones simuladas sin llamar a la red', async () => {
      const ref = createStubTrack('ref', 'Ref', 'A', 124, '8A');
      const cand = createStubTrack('cand1', 'Candidate', 'B', 126, '8B');

      const result = await getTrackRecommendations(ref, [ref, cand], { forceMock: true });

      assert.equal(result.success, true);
      assert.equal(result.isMock, true);
      assert.equal(result.model, 'local-heuristic-simulator');
      assert.equal(result.recommendations.length, 1);
      assert.equal(result.recommendations[0].trackId, 'cand1');
      assert.ok(result.recommendations[0].isMock);
    });

    test('3. Respuesta HTTP 200 exitosa de Gemini procesada y validada correctamente', async () => {
      const ref = createStubTrack('ref', 'Ref Track', 'A', 128, '11A');
      const cand = createStubTrack('cand1', 'Cand Track', 'B', 126, '11B');

      const mockServer = await startMockServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            recommendations: [
              {
                trackId: 'cand1',
                compatibilityScore: 92,
                justification: 'Excelente compatibilidad de tempo y clave relativa.',
                transitionSuggestion: 'Realiza EQ swap en el drop.',
              },
            ],
            isMock: false,
            model: 'gemini-2.5-flash',
          })
        );
      });

      try {
        const result = await getTrackRecommendations(ref, [ref, cand], {
          endpointUrl: mockServer.url,
        });

        assert.equal(result.success, true);
        assert.equal(result.isMock, false);
        assert.equal(result.model, 'gemini-2.5-flash');
        assert.equal(result.recommendations.length, 1);
        assert.equal(result.recommendations[0].trackId, 'cand1');
        assert.equal(result.recommendations[0].isMock, false);
      } finally {
        await mockServer.close();
      }
    });

    test('4. Manejo de error HTTP 429 (Cuota o límite excedido)', async () => {
      const ref = createStubTrack('ref', 'Ref', 'A', 124);
      const cand = createStubTrack('cand1', 'Candidate', 'B', 124);

      const mockServer = await startMockServer((_req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            errorCode: 'quota_exceeded',
            error: 'Cuota de Gemini API excedida o límite de velocidad alcanzado (HTTP 429).',
            details: 'RESOURCE_EXHAUSTED',
            isMock: false,
          })
        );
      });

      try {
        const result = await getTrackRecommendations(ref, [ref, cand], {
          endpointUrl: mockServer.url,
        });

        assert.equal(result.success, false);
        assert.equal(result.errorCode, 'quota_exceeded');
        assert.ok(result.error?.includes('429') || result.error?.includes('Cuota'));
        assert.equal(result.details, 'RESOURCE_EXHAUSTED');
      } finally {
        await mockServer.close();
      }
    });

    test('5. Manejo de error HTTP 401/403 (Autenticación / API Key inválida)', async () => {
      const ref = createStubTrack('ref', 'Ref', 'A', 124);
      const cand = createStubTrack('cand1', 'Candidate', 'B', 124);

      const mockServer = await startMockServer((_req, res) => {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            errorCode: 'auth_error',
            error: 'Gemini API: error de autenticación (clave de API inválida).',
            details: 'API_KEY_INVALID',
            isMock: false,
          })
        );
      });

      try {
        const result = await getTrackRecommendations(ref, [ref, cand], {
          endpointUrl: mockServer.url,
        });

        assert.equal(result.success, false);
        assert.equal(result.errorCode, 'auth_error');
        assert.ok(result.error?.includes('autenticación') || result.error?.includes('403'));
      } finally {
        await mockServer.close();
      }
    });

    test('6. Manejo de error HTTP 502 por respuesta vacía o JSON inválido de Gemini', async () => {
      const ref = createStubTrack('ref', 'Ref', 'A', 124);
      const cand = createStubTrack('cand1', 'Candidate', 'B', 124);

      const mockServer = await startMockServer((_req, res) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            errorCode: 'invalid_response',
            error: 'Failed to parse JSON response from Gemini',
            isMock: false,
          })
        );
      });

      try {
        const result = await getTrackRecommendations(ref, [ref, cand], {
          endpointUrl: mockServer.url,
        });

        assert.equal(result.success, false);
        assert.equal(result.errorCode, 'invalid_response');
        assert.ok(result.error?.includes('JSON'));
      } finally {
        await mockServer.close();
      }
    });

    test('7. Manejo de fallo de red (conexión rechazada o caída)', async () => {
      const ref = createStubTrack('ref', 'Ref', 'A', 124);
      const cand = createStubTrack('cand1', 'Candidate', 'B', 124);

      // Endpoint no alcanzable en puerto cerrado
      const result = await getTrackRecommendations(ref, [ref, cand], {
        endpointUrl: 'http://127.0.0.1:59999/unreachable-endpoint',
        timeoutMs: 800,
      });

      assert.equal(result.success, false);
      assert.equal(result.errorCode, 'network_error');
      assert.ok(result.error?.includes('conexión'));
    });

    test('8. Manejo de tiempo de espera agotado (timeout)', async () => {
      const ref = createStubTrack('ref', 'Ref', 'A', 124);
      const cand = createStubTrack('cand1', 'Candidate', 'B', 124);

      // Servidor que nunca responde para forzar timeout en 50ms
      const mockServer = await startMockServer(() => {
        // No responder
      });

      try {
        const result = await getTrackRecommendations(ref, [ref, cand], {
          endpointUrl: mockServer.url,
          timeoutMs: 50,
        });

        assert.equal(result.success, false);
        assert.equal(result.errorCode, 'timeout');
        assert.ok(result.error?.includes('Tiempo de espera agotado'));
      } finally {
        await mockServer.close();
      }
    });

    test('9. Recuperabilidad: tras error 429 (cuota agotada), alternar a forceMock entrega recomendaciones simuladas con IDs reales', async () => {
      const ref = createStubTrack('ref', 'Reference Track', 'Artist Ref', 128, '11A');
      const cand1 = createStubTrack('cand1', 'Candidate 1', 'Artist 1', 126, '11B');
      const cand2 = createStubTrack('cand2', 'Candidate 2', 'Artist 2', 130, '12A');

      // 1. Primera llamada falla por cuota 429
      const mockServer = await startMockServer((_req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            errorCode: 'quota_exceeded',
            error: 'Cuota de Gemini API excedida o límite de velocidad alcanzado (HTTP 429).',
            isMock: false,
          })
        );
      });

      try {
        const failedResult = await getTrackRecommendations(ref, [ref, cand1, cand2], {
          endpointUrl: mockServer.url,
          forceMock: false,
        });
        assert.equal(failedResult.success, false);
        assert.equal(failedResult.errorCode, 'quota_exceeded');

        // 2. Usuario activa modo simulación (fallback recuperable sin recargar)
        const mockResult = await getTrackRecommendations(ref, [ref, cand1, cand2], {
          endpointUrl: mockServer.url,
          forceMock: true,
        });
        assert.equal(mockResult.success, true);
        assert.equal(mockResult.isMock, true);
        assert.equal(mockResult.recommendations.length, 2);
        assert.ok(mockResult.recommendations.every((r) => r.isMock === true));
        assert.ok(mockResult.recommendations.every((r) => r.trackId === 'cand1' || r.trackId === 'cand2'));
      } finally {
        await mockServer.close();
      }
    });

    test('10. Tolerancia: pistas con análisis incompleto o fallido se procesan sin excepciones', async () => {
      const ref: Track = {
        ...createStubTrack('ref', 'Ref Incomplete', 'Unknown'),
        analysis: { status: 'failed', analysisError: 'Corrupted audio header' },
      };
      const candPending: Track = {
        ...createStubTrack('cand-pending', 'Pending Track', 'Artist P'),
        analysis: { status: 'pending' },
      };
      const candNoBpm: Track = {
        ...createStubTrack('cand-nobpm', 'No BPM Track', 'Artist B'),
        analysis: { status: 'analyzed', key: 'C#m' },
      };

      const result = await getTrackRecommendations(ref, [ref, candPending, candNoBpm], {
        forceMock: true,
      });

      assert.equal(result.success, true);
      assert.equal(result.isMock, true);
      assert.equal(result.recommendations.length, 2);
      assert.ok(result.recommendations.some((r) => r.trackId === 'cand-pending'));
      assert.ok(result.recommendations.some((r) => r.trackId === 'cand-nobpm'));
      assert.ok(result.recommendations.every((r) => r.isMock === true));
    });
  });
});
