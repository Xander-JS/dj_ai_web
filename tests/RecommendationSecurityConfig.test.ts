import { test } from 'node:test';
import assert from 'node:assert/strict';
import viteConfig from '../vite.config.ts';

test('Gemini middleware is registered only on the Vite development server', async () => {
  const config = typeof viteConfig === 'function'
    ? await viteConfig({
      command: 'serve',
      mode: 'test',
      isSsrBuild: false,
      isPreview: false,
    })
    : viteConfig;
  const plugins = (config.plugins ?? []).flat(Infinity);
  const geminiPlugin = plugins.find((plugin) =>
    plugin && typeof plugin === 'object' && plugin.name === 'system-dj-gemini-dev-api'
  );

  assert.ok(geminiPlugin);
  assert.equal(typeof geminiPlugin.configureServer, 'function');
  assert.equal('configurePreviewServer' in geminiPlugin, false);
});
