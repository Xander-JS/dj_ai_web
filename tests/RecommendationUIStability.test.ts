import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LatestRequest } from '../src/services/ai/LatestRequest.ts';

function flattenKeys(value: unknown, prefix = ''): string[] {
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    child && typeof child === 'object'
      ? flattenKeys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('Recommendation UI stability and localization', () => {
  it('keeps English and Spanish translation keys in parity and localizes the active UI copy', () => {
    const es = JSON.parse(fs.readFileSync('src/i18n/locales/es/translation.json', 'utf8'));
    const en = JSON.parse(fs.readFileSync('src/i18n/locales/en/translation.json', 'utf8'));
    assert.deepEqual(flattenKeys(es).sort(), flattenKeys(en).sort());

    for (const locale of [es, en]) {
      assert.match(locale.dashboard.current_track_info, /{{title}}.*{{bpm}}.*{{key}}.*{{action}}/);
      for (const key of ['error_auth', 'error_network', 'error_timeout', 'error_quota_exceeded']) {
        assert.equal(typeof locale.dashboard[key], 'string');
      }
      assert.doesNotMatch(locale.dashboard.error_auth, /\.env|GEMINI_API_KEY/);
    }

    const card = fs.readFileSync('src/components/dashboard/SmartRecommendationCard.tsx', 'utf8');
    const deck = fs.readFileSync('src/services/console/deckPanelModel.ts', 'utf8');
    assert.match(card, /t\('dashboard\.current_track_info'/);
    assert.match(deck, /msg\('dj\.master'\)/);
    assert.match(deck, /msg\(d\.barSyncReasonKey\)/);
    // Keys used by the active UI must resolve in both locales.
    assert.equal(en.dj.master, 'MASTER');
    assert.equal(es.dj.master, 'MASTER');
    assert.equal(typeof en.dashboard.error_server, 'string');
    assert.equal(typeof es.dashboard.error_server, 'string');
  });

  it('does not expose provider diagnostics through recommendation types, responses, or logs', () => {
    const types = fs.readFileSync('src/services/ai/types.ts', 'utf8');
    const service = fs.readFileSync('src/services/ai/geminiRecommendationService.ts', 'utf8');
    const vite = fs.readFileSync('vite.config.ts', 'utf8');
    assert.doesNotMatch(types, /details\??:\s*string/);
    assert.doesNotMatch(service, /details:\s*(?:data\??\.details|error\?\.message)/);
    assert.doesNotMatch(vite, /details:\s*(?:sanitizedDetails|error\?\.message|errText|rawContent)/);
    assert.doesNotMatch(vite, /console\.(?:error|warn)\([^\n]*(?:apiKey|rawContent|errText|error\.message)/);
  });

  it('aborts and invalidates the older request when a newer one starts', () => {
    const requests = new LatestRequest();
    const old = requests.begin();
    const current = requests.begin();
    assert.equal(old.signal.aborted, true);
    assert.equal(requests.isCurrent(old.id), false);
    assert.equal(requests.isCurrent(current.id), true);
  });

  it('ignores an older request that resolves after the newer request', async () => {
    const gate = new LatestRequest();
    const old = deferred<string>();
    const latest = deferred<string>();
    let result = '';
    const oldRequest = gate.begin();
    const oldApply = old.promise.then((value) => { if (gate.isCurrent(oldRequest.id)) result = value; });
    const newRequest = gate.begin();
    const newApply = latest.promise.then((value) => { if (gate.isCurrent(newRequest.id)) result = value; });
    latest.resolve('new result'); await newApply;
    old.resolve('old result'); await oldApply;
    assert.equal(result, 'new result');
  });

  for (const invalidation of ['reference track', 'candidate catalog'] as const) {
    it(`invalidates a pending request when the ${invalidation} changes`, async () => {
      const gate = new LatestRequest();
      const pending = deferred<string>();
      const request = gate.begin();
      let result = '';
      const apply = pending.promise.then((value) => { if (gate.isCurrent(request.id)) result = value; });
      gate.invalidate();
      pending.resolve('stale'); await apply;
      assert.equal(result, '');
      assert.equal(request.signal.aborted, true);
    });
  }

  it('does not let a stale request clear the current loading state', async () => {
    const gate = new LatestRequest();
    const old = deferred<void>();
    const current = deferred<void>();
    const state = { loading: false };
    const setLoading = (value: boolean) => { state.loading = value; };
    const oldRequest = gate.begin(); setLoading(true);
    const oldDone = old.promise.then(() => { if (gate.isCurrent(oldRequest.id)) setLoading(false); });
    const currentRequest = gate.begin(); setLoading(true);
    const currentDone = current.promise.then(() => { if (gate.isCurrent(currentRequest.id)) setLoading(false); });
    old.resolve(); await oldDone;
    assert.equal(state.loading, true);
    current.resolve(); await currentDone;
    assert.equal(state.loading, false);
  });

  it('does not apply a response after unmount', async () => {
    const gate = new LatestRequest();
    const pending = deferred<string>();
    const request = gate.begin();
    let result = '';
    const apply = pending.promise.then((value) => { if (gate.isCurrent(request.id)) result = value; });
    gate.invalidate(); // component cleanup on unmount
    pending.resolve('late'); await apply;
    assert.equal(result, '');
  });

  it('ignores stale request errors and preserves the newer error state', async () => {
    const gate = new LatestRequest();
    const old = deferred<never>();
    const latest = deferred<never>();
    let error = '';
    const oldRequest = gate.begin();
    const oldDone = old.promise.catch((reason: Error) => { if (gate.isCurrent(oldRequest.id)) error = reason.message; });
    const newRequest = gate.begin();
    const newDone = latest.promise.catch((reason: Error) => { if (gate.isCurrent(newRequest.id)) error = reason.message; });
    latest.reject(new Error('current')); await newDone;
    old.reject(new Error('obsolete')); await oldDone;
    assert.equal(error, 'current');
  });
});
