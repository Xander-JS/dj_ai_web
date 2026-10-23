import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { SessionRenderError } from '../src/session/OfflineSessionRenderer.ts';
import { SessionExportBusyError } from '../src/session/SessionExportCoordinator.ts';
import { SessionExportCanceledError, SessionExportError } from '../src/session/SessionExporter.ts';
import { getOverallExportPercent, getSessionExportErrorKey } from '../src/session/SessionExportUiModel.ts';

describe('SessionExportUiModel — overall progress and localized error keys', () => {
  test('maps per-phase progress onto one monotonic 0–100 bar', () => {
    const steps = [
      getOverallExportPercent({ phase: 'preparing', percent: 0, indeterminate: true }),
      getOverallExportPercent({ phase: 'rendering', percent: 40, indeterminate: false }),
      getOverallExportPercent({ phase: 'rendering', percent: 100, indeterminate: false }),
      getOverallExportPercent({ phase: 'encoding', percent: 0, indeterminate: false }),
      getOverallExportPercent({ phase: 'encoding', percent: 100, indeterminate: false }),
      getOverallExportPercent({ phase: 'finalizing', percent: null, indeterminate: true }),
      getOverallExportPercent({ phase: 'finalizing', percent: 100, indeterminate: false }),
    ] as number[];
    assert.deepEqual(steps, [0, 20, 50, 50, 95, 95, 100]);
    assert.equal(getOverallExportPercent({ phase: 'rendering', percent: null, indeterminate: true }), null);
  });

  test('derives translation keys from typed errors instead of raw messages', () => {
    const render = (code: SessionRenderError['code']) => new SessionExportError(
      'RENDER_FAILED', 'raw', 'rendering', { cause: new SessionRenderError(code, 'raw') },
    );
    assert.equal(getSessionExportErrorKey(render('MISSING_BUFFER')), 'missingAudio');
    assert.equal(getSessionExportErrorKey(render('UNSUPPORTED_EVENT')), 'invalidSession');
    assert.equal(getSessionExportErrorKey(render('OFFLINE_AUDIO_UNAVAILABLE')), 'offlineUnavailable');
    assert.equal(getSessionExportErrorKey(new SessionExportError('WORKER_UNAVAILABLE', 'raw', 'encoding')), 'workerUnavailable');
    assert.equal(getSessionExportErrorKey(new SessionExportError('RESOURCE_LIMIT', 'raw', 'preparing')), 'resourceLimit');
    assert.equal(getSessionExportErrorKey(new SessionExportCanceledError('encoding')), 'canceled');
    assert.equal(getSessionExportErrorKey(new SessionExportBusyError()), 'busy');
    assert.equal(getSessionExportErrorKey(new Error('raw')), 'unknown');
  });
});
