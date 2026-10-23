/**
 * SYSTEM DJ — YouTube Audio Service Unit Tests
 * Adaptador del microservicio de extracción: Blob, nombre de archivo y errores HTTP.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAudioFromYouTube,
  parseContentDispositionFilename,
  YouTubeImportError,
  FALLBACK_FILENAME,
} from '../src/services/youtubeService.ts';

const VIDEO_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

const fakeFetch = (response: Response, calls: Request[] = []): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(input, init));
    return response;
  }) as typeof fetch;

describe('parseContentDispositionFilename', () => {
  test('prioriza filename* UTF-8 sobre filename', () => {
    const header = 'attachment; filename="Cancion.mp3"; filename*=UTF-8\'\'Canci%C3%B3n%20%C3%B1.mp3';
    assert.equal(parseContentDispositionFilename(header), 'Canción ñ.mp3');
  });

  test('usa filename simple y devuelve null sin cabecera', () => {
    assert.equal(parseContentDispositionFilename('attachment; filename="Me at the zoo.mp3"'), 'Me at the zoo.mp3');
    assert.equal(parseContentDispositionFilename(null), null);
  });
});

describe('extractAudioFromYouTube', () => {
  test('envía la URL por POST y devuelve el Blob con su nombre', async () => {
    const calls: Request[] = [];
    const response = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'attachment; filename="Me at the zoo.mp3"',
        'X-Audio-Duration': '19',
      },
    });

    const result = await extractAudioFromYouTube(VIDEO_URL, { serviceUrl: 'http://svc', fetchImpl: fakeFetch(response, calls) });

    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'http://svc/api/extract-audio');
    assert.deepEqual(await calls[0].json(), { url: VIDEO_URL });
    assert.equal(result.blob.size, 3);
    assert.equal(result.blob.type, 'audio/mpeg');
    assert.equal(result.filename, 'Me at the zoo.mp3');
    assert.equal(result.durationSeconds, 19);
  });

  test('asigna un nombre genérico sin Content-Disposition', async () => {
    const response = new Response(new Uint8Array([1]), { status: 200 });
    const result = await extractAudioFromYouTube(VIDEO_URL, { fetchImpl: fakeFetch(response) });
    assert.equal(result.filename, FALLBACK_FILENAME);
  });

  test('400 se traduce a "rejected" con el motivo del backend', async () => {
    const response = Response.json({ detail: 'El video dura 904 s y supera el límite de 600 s (10 minutos).' }, { status: 400 });
    await assert.rejects(
      extractAudioFromYouTube(VIDEO_URL, { fetchImpl: fakeFetch(response) }),
      (err: unknown) => err instanceof YouTubeImportError && err.code === 'rejected' && err.status === 400 && /600 s/.test(err.detail ?? ''),
    );
  });

  test('422 se traduce a "invalid_url"', async () => {
    const response = Response.json({ detail: [{ msg: 'Value error, La URL debe ser un enlace válido de YouTube.' }] }, { status: 422 });
    await assert.rejects(
      extractAudioFromYouTube(VIDEO_URL, { fetchImpl: fakeFetch(response) }),
      (err: unknown) => err instanceof YouTubeImportError && err.code === 'invalid_url' && err.detail === 'La URL debe ser un enlace válido de YouTube.',
    );
  });

  test('rechaza URLs mal formadas sin llamar al servicio', async () => {
    const calls: Request[] = [];
    await assert.rejects(
      extractAudioFromYouTube('no es una url', { fetchImpl: fakeFetch(new Response(), calls) }),
      (err: unknown) => err instanceof YouTubeImportError && err.code === 'invalid_url',
    );
    assert.equal(calls.length, 0);
  });

  test('un fallo de red se traduce a "service_unreachable"', async () => {
    const failingFetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    await assert.rejects(
      extractAudioFromYouTube(VIDEO_URL, { fetchImpl: failingFetch }),
      (err: unknown) => err instanceof YouTubeImportError && err.code === 'service_unreachable',
    );
  });
});
