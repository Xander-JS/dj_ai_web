import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudioPcm } from '../src/audio/analysis/audioAnalyzer.ts';
import {
  AnalysisService,
  type IAnalysisWorker,
  type WorkerFactory,
} from '../src/services/analysis/AnalysisService.ts';
import type { AnalysisWorkerInboundMessage, AnalysisWorkerOutboundMessage } from '../src/types/analysis.ts';
import type { TrackAnalysis, TrackBeatUnit } from '../src/types/track.ts';
import { isTrackBeatUnit, normalizeTrackAnalysis } from '../src/utils/trackAnalysis.ts';

const confirmedQuarterNote: TrackBeatUnit = {
  value: 4,
  status: 'confirmed',
  source: 'manual',
};

describe('TrackAnalysis beatUnit contract', () => {
  it('accepts explicit supported note denominators with their matching evidence state', () => {
    assert.equal(isTrackBeatUnit(confirmedQuarterNote), true);
    assert.equal(isTrackBeatUnit({ value: 8, status: 'provisional', source: 'analysis' }), true);
    assert.equal(isTrackBeatUnit({ value: 4, status: 'confirmed', source: 'analysis' }), false);
    assert.equal(isTrackBeatUnit({ value: 8, status: 'provisional', source: 'manual' }), false);
  });

  it('preserves a justified explicit unit without changing the detector BPM', () => {
    const normalized = normalizeTrackAnalysis({
      status: 'analyzed',
      bpm: 124,
      bpmConfidence: 0.92,
      isAmbiguous: false,
      beatUnit: confirmedQuarterNote,
    });

    assert.deepEqual(normalized.beatUnit, confirmedQuarterNote);
    assert.equal(normalized.bpm, 124);
    assert.equal(normalized.bpmConfidence, 0.92);
  });

  it('drops invalid values and malformed evidence instead of coercing them', () => {
    const invalidValues: unknown[] = [
      { value: 3, status: 'confirmed', source: 'manual' },
      { value: 4.5, status: 'confirmed', source: 'manual' },
      { value: Number.NaN, status: 'confirmed', source: 'manual' },
      { value: 4, status: 'unknown', source: 'manual' },
      4,
      null,
    ];

    for (const beatUnit of invalidValues) {
      const analysis = normalizeTrackAnalysis({
        status: 'analyzed',
        bpm: 120,
        beatUnit,
      } as unknown as TrackAnalysis);
      assert.equal('beatUnit' in analysis, false, `Debe eliminar el dato inválido: ${String(beatUnit)}`);
      assert.equal(analysis.bpm, 120);
    }
  });

  it('keeps legacy/incomplete analyses without a unit as unknown and does not infer it from BPM', () => {
    const legacy = normalizeTrackAnalysis({ status: 'analyzed', bpm: 120 });
    assert.equal(legacy.beatUnit, undefined);

    const analysis = analyzeAudioPcm(new Float32Array(0), 44_100);
    assert.equal(analysis.status, 'unsupported');
    assert.equal(analysis.beatUnit, undefined);
  });

  it('carries valid explicit metadata through the worker analysis service', async () => {
    class ResultWorker implements IAnalysisWorker {
      public onmessage: ((event: MessageEvent<AnalysisWorkerOutboundMessage>) => void) | null = null;
      public onerror: ((event: ErrorEvent | Error) => void) | null = null;

      public postMessage(message: AnalysisWorkerInboundMessage): void {
        if (message.type !== 'START_ANALYSIS') return;
        const result = {
          status: 'analyzed',
          bpm: 126,
          beatUnit: confirmedQuarterNote,
        } as TrackAnalysis;
        queueMicrotask(() => this.onmessage?.({
          data: {
            type: 'ANALYSIS_COMPLETE',
            requestId: message.requestId,
            trackId: message.trackId,
            result,
            durationMs: 1,
          },
        } as MessageEvent<AnalysisWorkerOutboundMessage>));
      }

      public terminate(): void {}
    }

    const workerFactory: WorkerFactory = () => new ResultWorker();
    const service = new AnalysisService({ workerTimeoutMs: 1_000 }, workerFactory);
    try {
      const result = await service.queueAnalysis('beat-unit-track', new Float32Array(16), 44_100);
      assert.deepEqual(result.beatUnit, confirmedQuarterNote);
      assert.equal(result.bpm, 126);
    } finally {
      service.destroy();
    }
  });
});
