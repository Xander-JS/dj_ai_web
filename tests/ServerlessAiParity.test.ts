import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiPrompt as devBuildPrompt } from '../vite.config.ts';
import { buildGeminiPrompt as apiBuildPrompt, generateExplanations } from '../api/_lib/explanations.ts';

// Garantiza que la función serverless (api/_lib/explanations.ts) y el middleware de
// desarrollo (vite.config.ts) producen EXACTAMENTE el mismo prompt y validan igual,
// para que la IA se comporte idéntica en dev, web y el ejecutable.

const reference = { id: 'ref', title: 'Reference', artist: 'Artist', bpm: 124, key: 'Am', camelot: '8A', energy: 7 };
const recommendations = [
  { id: 'a', title: 'One', artist: 'Artist A', bpm: 126, camelot: '9A' },
  { id: 'b', title: 'Two', artist: 'Artist B', energy: 6 },
];

test('el prompt del serverless coincide byte a byte con el del middleware de dev', () => {
  assert.equal(apiBuildPrompt(reference, recommendations), devBuildPrompt(reference, recommendations));
});

test('generateExplanations rechaza payloads inválidos sin llamar al proveedor', async () => {
  assert.equal((await generateExplanations(null, 'key', 'deepseek')).status, 400);
  assert.equal((await generateExplanations('nope', 'key', 'deepseek')).status, 400);

  // Campo extra no permitido en una pista.
  const extraField = await generateExplanations(
    { referenceTrack: { id: 'ref', title: 'R', artist: 'A', playbackState: 'playing' }, recommendations: [{ id: 'a', title: 'One', artist: 'A' }] },
    'key', 'deepseek',
  );
  assert.equal(extraField.status, 400);

  // IDs duplicados.
  const duplicate = await generateExplanations(
    { referenceTrack: { id: 'ref', title: 'R', artist: 'A' }, recommendations: [{ id: 'x', title: 'One', artist: 'A' }, { id: 'x', title: 'Two', artist: 'A' }] },
    'key', 'deepseek',
  );
  assert.equal(duplicate.status, 400);
});

test('generateExplanations responde 503 cuando falta la clave del servidor', async () => {
  const result = await generateExplanations(
    { referenceTrack: { id: 'ref', title: 'R', artist: 'A' }, recommendations: [{ id: 'a', title: 'One', artist: 'A' }] },
    undefined, 'deepseek',
  );
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { success: false, errorCode: 'missing_api_key' });
});
