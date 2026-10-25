/**
 * SYSTEM DJ — Test Suite: Cola de reanálisis masivo
 * Ejecución secuencial, resultados reales por pista, errores, pistas eliminadas, duplicados,
 * detención y resumen único al final.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AnalysisQueue, summarizeQueue, type AnalysisQueueDeps, type AnalysisQueueSnapshot } from '../src/services/analysis/AnalysisQueue.ts';
import type { Track, TrackAnalysis } from '../src/types/track.ts';

function makeTrack(id: string): Track {
  return { id, title: `Pista ${id}`, analysis: { status: 'analyzed', bpm: 120 } } as unknown as Track;
}

interface Harness {
  queue: AnalysisQueue;
  log: string[];
  finished: AnalysisQueueSnapshot[];
  resolveNext: (analysis: TrackAnalysis | Error) => Promise<void>;
  library: Map<string, Track>;
  busy: Set<string>;
}

/** Cola con un analizador controlado a mano: cada análisis espera a que el test lo resuelva. */
function harness(ids: string[], overrides: Partial<AnalysisQueueDeps> = {}): Harness {
  const library = new Map(ids.map((id) => [id, makeTrack(id)]));
  const busy = new Set<string>();
  const log: string[] = [];
  const finished: AnalysisQueueSnapshot[] = [];
  const waiting: { id: string; resolve: (a: TrackAnalysis) => void; reject: (e: Error) => void }[] = [];
  let active = 0;

  const queue = new AnalysisQueue({
    getTrack: async (id) => library.get(id) ?? null,
    analyze: (track) => {
      active += 1;
      log.push(`start:${track.id}:active=${active}`);
      return new Promise<TrackAnalysis>((resolve, reject) => {
        waiting.push({
          id: track.id,
          resolve: (a) => { active -= 1; log.push(`end:${track.id}`); resolve(a); },
          reject: (e) => { active -= 1; log.push(`end:${track.id}`); reject(e); },
        });
      });
    },
    isAnalyzing: (id) => busy.has(id),
    waitUntilIdle: async () => {},
    onFinished: (snapshot) => finished.push(snapshot),
    ...overrides,
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const resolveNext = async (analysis: TrackAnalysis | Error) => {
    for (let i = 0; i < 20 && waiting.length === 0; i++) await flush();
    const next = waiting.shift();
    assert.ok(next, 'no hay análisis en curso');
    if (analysis instanceof Error) next.reject(analysis);
    else next.resolve(analysis);
    await flush();
    await flush();
  };

  return { queue, log, finished, resolveNext, library, busy };
}

describe('AnalysisQueue — reanálisis en segundo plano', () => {
  it('procesa las pistas de una en una y registra el resultado real de cada una', async () => {
    const h = harness(['a', 'b', 'c']);
    const { added } = h.queue.enqueue(['a', 'b', 'c'].map((id) => ({ trackId: id, title: `Pista ${id}` })));
    assert.equal(added, 3);
    assert.equal(h.queue.getSnapshot().status, 'running');
    assert.equal(h.queue.getSnapshot().total, 3);

    await h.resolveNext({ status: 'analyzed', bpm: 124 });
    // Sin resumen mientras queden pistas
    assert.equal(h.finished.length, 0);
    assert.equal(h.queue.getSnapshot().results.length, 1);
    await h.resolveNext({ status: 'failed', analysisError: 'decodificación' });
    await h.resolveNext({ status: 'unsupported', analysisError: 'formato' });

    assert.ok(h.log.every((line) => !line.startsWith('start') || line.endsWith('active=1')), 'nunca hay dos análisis a la vez');
    assert.deepEqual(h.log, ['start:a:active=1', 'end:a', 'start:b:active=1', 'end:b', 'start:c:active=1', 'end:c']);

    const snapshot = h.queue.getSnapshot();
    assert.equal(snapshot.status, 'finished');
    assert.deepEqual(snapshot.results.map((r) => [r.trackId, r.outcome, r.error]), [
      ['a', 'analyzed', undefined],
      ['b', 'failed', 'decodificación'],
      ['c', 'unsupported', 'formato'],
    ]);
    assert.deepEqual(summarizeQueue(snapshot.results), { analyzed: 1, failed: 2, skipped: 0, processed: 3 });
    assert.equal(h.finished.length, 1, 'un único resumen al terminar');
  });

  it('una excepción del analizador se registra como fallo con su mensaje, no como éxito', async () => {
    const h = harness(['a']);
    h.queue.enqueue([{ trackId: 'a', title: 'Pista a' }]);
    await h.resolveNext(new Error('worker caído'));
    const [result] = h.queue.getSnapshot().results;
    assert.equal(result.outcome, 'failed');
    assert.equal(result.error, 'worker caído');
  });

  it('no duplica pistas ya en cola y suma las nuevas a la tanda en marcha', async () => {
    const h = harness(['a', 'b', 'c']);
    h.queue.enqueue([{ trackId: 'a', title: 'a' }, { trackId: 'b', title: 'b' }, { trackId: 'a', title: 'a' }]);
    assert.equal(h.queue.getSnapshot().total, 2);
    const second = h.queue.enqueue([{ trackId: 'b', title: 'b' }, { trackId: 'c', title: 'c' }]);
    assert.deepEqual(second, { added: 1, duplicates: 1 });
    assert.equal(h.queue.getSnapshot().total, 3);
    assert.ok(h.queue.isQueued('c'));

    await h.resolveNext({ status: 'analyzed' });
    await h.resolveNext({ status: 'analyzed' });
    await h.resolveNext({ status: 'analyzed' });
    assert.deepEqual(h.queue.getSnapshot().results.map((r) => r.trackId), ['a', 'b', 'c']);
    assert.equal(h.finished.length, 1);
  });

  it('omite las pistas eliminadas antes o durante su turno', async () => {
    const h = harness(['a', 'b', 'c']);
    h.queue.enqueue(['a', 'b', 'c'].map((id) => ({ trackId: id, title: id })));
    h.library.delete('b');
    // 'a' se elimina mientras se analiza: el resultado devuelto no cuenta como analizada
    h.library.delete('a');
    await h.resolveNext({ status: 'analyzed' });
    await h.resolveNext({ status: 'analyzed' });
    const results = h.queue.getSnapshot().results;
    assert.deepEqual(results.map((r) => [r.trackId, r.outcome, r.reason]), [
      ['a', 'skipped', 'deleted'],
      ['b', 'skipped', 'deleted'],
      ['c', 'analyzed', undefined],
    ]);
  });

  it('detener deja terminar la pista actual y marca el resto como omitidas', async () => {
    const h = harness(['a', 'b', 'c']);
    h.queue.enqueue(['a', 'b', 'c'].map((id) => ({ trackId: id, title: id })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.queue.stop();
    assert.equal(h.queue.getSnapshot().stopRequested, true);
    await h.resolveNext({ status: 'analyzed' });
    const snapshot = h.queue.getSnapshot();
    assert.equal(snapshot.status, 'finished');
    assert.deepEqual(snapshot.results.map((r) => [r.trackId, r.outcome, r.reason]), [
      ['b', 'skipped', 'stopped'],
      ['c', 'skipped', 'stopped'],
      ['a', 'analyzed', undefined],
    ]);
    assert.equal(h.log.filter((line) => line.startsWith('start')).length, 1);
  });

  it('espera a un análisis ajeno en curso antes de reanalizar', async () => {
    const order: string[] = [];
    const h = harness(['a'], {
      waitUntilIdle: async (id) => { order.push(`wait:${id}`); },
    });
    h.busy.add('a');
    h.queue.enqueue([{ trackId: 'a', title: 'a' }]);
    await h.resolveNext({ status: 'analyzed' });
    assert.deepEqual(order, ['wait:a']);
    assert.equal(h.queue.getSnapshot().results[0].outcome, 'analyzed');
  });

  it('una solicitud cancelada no se presenta como analizada', async () => {
    const h = harness(['a']);
    h.queue.enqueue([{ trackId: 'a', title: 'a' }]);
    await h.resolveNext({ status: 'pending' });
    assert.deepEqual(h.queue.getSnapshot().results.map((r) => [r.outcome, r.reason]), [['skipped', 'cancelled']]);
  });

  it('cerrar el resumen vuelve a reposo y una tanda nueva empieza desde cero', async () => {
    const h = harness(['a', 'b']);
    h.queue.enqueue([{ trackId: 'a', title: 'a' }]);
    await h.resolveNext({ status: 'analyzed' });
    h.queue.dismiss();
    assert.equal(h.queue.getSnapshot().status, 'idle');
    h.queue.enqueue([{ trackId: 'b', title: 'b' }]);
    assert.equal(h.queue.getSnapshot().total, 1);
    await h.resolveNext({ status: 'analyzed' });
    assert.deepEqual(h.queue.getSnapshot().results.map((r) => r.trackId), ['b']);
  });
});
