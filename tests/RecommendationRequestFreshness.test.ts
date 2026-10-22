import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LatestRequest } from '../src/services/ai/LatestRequest.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Recommendation request freshness', () => {
  it('does not apply an older response after a newer request starts', async () => {
    const requests = new LatestRequest();
    const oldResult = deferred<string>();
    const newResult = deferred<string>();
    let visible = '';
    const oldRequest = requests.begin();
    const applyOld = oldResult.promise.then((value) => {
      if (requests.isCurrent(oldRequest.id)) visible = value;
    });
    const newRequest = requests.begin();
    const applyNew = newResult.promise.then((value) => {
      if (requests.isCurrent(newRequest.id)) visible = value;
    });

    newResult.resolve('Deck B');
    await applyNew;
    oldResult.resolve('Deck A');
    await applyOld;

    assert.equal(visible, 'Deck B');
    assert.equal(oldRequest.signal.aborted, true);
  });

  it('invalidates pending work when the reference changes or the component unmounts', () => {
    const requests = new LatestRequest();
    const request = requests.begin();
    requests.invalidate();
    assert.equal(requests.isCurrent(request.id), false);
    assert.equal(request.signal.aborted, true);
  });
});
