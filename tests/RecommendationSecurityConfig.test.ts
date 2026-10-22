import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { buildGeminiPrompt, geminiDevApiPlugin } from '../vite.config.ts';

test('Gemini middleware is registered only on the Vite development server without loading environment files', () => {
  const source = fs.readFileSync('vite.config.ts', 'utf8');
  assert.match(source, /plugins:\s*\[react\(\),\s*geminiDevApiPlugin\(apiKey\)\]/);
  assert.match(source, /configureServer\(server:\s*ViteDevServer\)/);
  assert.doesNotMatch(source, /configurePreviewServer/);
});

test('Browser-targeted recommendation modules contain no Gemini credential or direct provider URL', () => {
  const browserFiles = [
    'src/services/ai/geminiRecommendationService.ts',
    'src/components/dashboard/SmartRecommendationCard.tsx',
  ];
  for (const file of browserFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /GEMINI_API_KEY|VITE_[A-Z0-9_]*GEMINI/i);
    assert.doesNotMatch(source, /generativelanguage\.googleapis\.com/);
  }
});

test('Development middleware rejects invalid methods, oversized bodies, and missing server keys safely', async () => {
  let middleware: ((req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void) | undefined;
  const plugin = geminiDevApiPlugin();
  plugin.configureServer?.({
    middlewares: { use: (handler: typeof middleware) => { middleware = handler; } },
  } as never);
  assert.ok(middleware);

  const server = http.createServer((req, res) => middleware!(req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const endpoint = `http://127.0.0.1:${address.port}/api/ai/explanations`;
  try {
    const wrongMethod = await fetch(endpoint, { method: 'GET' });
    assert.equal(wrongMethod.status, 405);

    const invalidJson = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(invalidJson.status, 400);

    const oversized = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(17 * 1024),
    });
    assert.equal(oversized.status, 413);

    const missingKey = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceTrack: { id: 'ref', title: 'Reference', artist: 'Artist', bpm: 120, camelot: '8A' },
        recommendations: [{ id: 'candidate', title: 'Candidate', artist: 'Artist', bpm: 120, camelot: '8A' }],
      }),
    });
    assert.equal(missingKey.status, 503);
    assert.deepEqual(await missingKey.json(), { success: false, errorCode: 'missing_api_key' });

    const extraFields = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceTrack: { id: 'ref', title: 'Reference', artist: 'Artist', playbackState: 'playing' },
        recommendations: [{ id: 'candidate', title: 'Candidate', artist: 'Artist' }],
      }),
    });
    assert.equal(extraFields.status, 400);

    const localEvidenceField = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceTrack: { id: 'ref', title: 'Reference', artist: 'Artist' },
        recommendations: [{ id: 'candidate', title: 'Candidate', artist: 'Artist', localEvidence: 'Internal evaluation.' }],
      }),
    });
    assert.equal(localEvidenceField.status, 400);

    const duplicateIds = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceTrack: { id: 'ref', title: 'Reference', artist: 'Artist' },
        recommendations: [
          { id: 'duplicate', title: 'One', artist: 'Artist' },
          { id: 'duplicate', title: 'Two', artist: 'Artist' },
        ],
      }),
    });
    assert.equal(duplicateIds.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('Provider errors and diagnostics do not expose the server key', async () => {
  const testOnlyKey = 'test-only-secret-marker';
  let middleware: ((req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void) | undefined;
  const plugin = geminiDevApiPlugin(testOnlyKey);
  plugin.configureServer?.({
    middlewares: { use: (handler: typeof middleware) => { middleware = handler; } },
  } as never);
  assert.ok(middleware);

  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs: string[] = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith('https://generativelanguage.googleapis.com/')) {
      return new Response(testOnlyKey, { status: 401 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  console.warn = ((...args: unknown[]) => logs.push(args.map(String).join(' '))) as typeof console.warn;
  const server = http.createServer((req, res) => middleware!(req, res, () => res.end()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/explanations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceTrack: { id: 'ref', title: 'Reference', artist: 'Artist' },
        recommendations: [{ id: 'candidate', title: 'Candidate', artist: 'Artist' }],
      }),
    });
    const responseBody = await response.text();
    assert.equal(response.status, 502);
    assert.doesNotMatch(responseBody, new RegExp(testOnlyKey));
    assert.doesNotMatch(logs.join('\n'), new RegExp(testOnlyKey));
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('Gemini prompt serializes only approved track metadata and correlation IDs', () => {
  const reference = {
    id: 'reference-id', title: 'Reference', artist: 'Artist', bpm: 124, key: 'Am', camelot: '8A', energy: 7,
    playbackState: 'playing', beatgrid: [0, 0.5], localEvidence: 'private local evaluation',
  };
  const recommendation = {
    id: 'candidate-id', title: 'Candidate', artist: 'Artist', bpm: 126, key: 'Bm', camelot: '10A', energy: 8,
    compatibilityScore: 99, harmonicEvaluation: { relation: 'same_key' }, tempoEvaluation: { relation: 'exact' },
  };

  const prompt = buildGeminiPrompt(reference, [recommendation]);
  const serializedData = prompt.slice(prompt.lastIndexOf('\n\n') + 2);
  const parsed = JSON.parse(serializedData) as {
    referenceTrack: Record<string, unknown>;
    recommendations: Array<Record<string, unknown>>;
  };
  const allowed = ['id', 'title', 'artist', 'bpm', 'key', 'camelot', 'energy'];
  const assertAllowedFields = (track: Record<string, unknown>) => {
    assert.ok(Object.keys(track).every((field) => allowed.includes(field)));
    assert.ok(['id', 'title', 'artist'].every((field) => field in track));
  };

  assertAllowedFields(parsed.referenceTrack);
  assertAllowedFields(parsed.recommendations[0]);
  assert.equal(parsed.referenceTrack.id, 'reference-id');
  assert.equal(parsed.recommendations[0].id, 'candidate-id');
  assert.doesNotMatch(serializedData, /localEvidence|playbackState|beatgrid|compatibilityScore|harmonicEvaluation|tempoEvaluation/);
});
