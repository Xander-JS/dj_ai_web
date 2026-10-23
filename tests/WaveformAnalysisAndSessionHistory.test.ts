/**
 * SYSTEM DJ — Test Suite: Fidelidad de forma de onda, doble pasada de análisis,
 * edición manual de metadatos e historial FIFO de sesiones grabadas.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeAudioChannels,
  analyzeAudioPcm,
  extractWaveformPeaks,
  needsSecondAnalysisPass,
  waveformBucketsForDuration,
} from '../src/audio/analysis/audioAnalyzer.ts';
import {
  applyManualAnalysisEdits,
  preserveManualAnalysisFields,
  validateManualAnalysisEdits,
} from '../src/utils/trackAnalysis.ts';
import { IndexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { AnalysisSyncManager } from '../src/services/analysis/AnalysisSyncManager.ts';
import { AnalysisService, type IAnalysisWorker } from '../src/services/analysis/AnalysisService.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import {
  MAX_STORED_SESSIONS,
  createStoredSessionRecord,
  planSessionHistoryInsert,
  type StoredSessionRecord,
} from '../src/session/SessionHistory.ts';
import type { RecordedSession } from '../src/session/SessionRecorder.ts';
import type { SessionExportResult } from '../src/session/SessionExporter.ts';
import type { TrackAnalysis } from '../src/types/track.ts';
import type { AnalysisWorkerInboundMessage, AnalysisWorkerOutboundMessage } from '../src/types/analysis.ts';

const SR = 8000;

function tone(seconds: number, amplitude = 0.4, freq = 220): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < pcm.length; i++) pcm[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / SR);
  return pcm;
}

class CapturingWorker implements IAnalysisWorker {
  public onmessage: ((event: MessageEvent<AnalysisWorkerOutboundMessage>) => void) | null = null;
  public onerror: ((event: ErrorEvent | Error) => void) | null = null;
  public received: AnalysisWorkerInboundMessage[] = [];
  private readonly result: TrackAnalysis;

  constructor(result: TrackAnalysis) {
    this.result = result;
  }

  public postMessage(message: AnalysisWorkerInboundMessage): void {
    this.received.push(message);
    if (message.type !== 'START_ANALYSIS') return;
    setTimeout(() => {
      this.onmessage?.({
        data: {
          type: 'ANALYSIS_COMPLETE',
          requestId: message.requestId,
          trackId: message.trackId,
          result: this.result,
          durationMs: 1,
        },
      } as MessageEvent<AnalysisWorkerOutboundMessage>);
    }, 1);
  }

  public terminate(): void {}
}

function stereoDecoder(seconds: number) {
  return async (): Promise<AudioBuffer> => {
    const left = tone(seconds, 0.1);
    const right = tone(seconds, 0.8);
    return {
      sampleRate: SR,
      length: left.length,
      duration: seconds,
      numberOfChannels: 2,
      getChannelData: (channel: number) => (channel === 0 ? left : right),
    } as unknown as AudioBuffer;
  };
}

describe('Forma de onda: picos reales y escala temporal', () => {
  it('toma el máximo absoluto por bloque considerando todos los canales', () => {
    const left = new Float32Array([0.1, -0.2, 0.1, 0.1]);
    const right = new Float32Array([0.05, 0.05, -0.8, 0.4]);
    assert.deepEqual(extractWaveformPeaks([left, right], 2), [0.25, 1]);
  });

  it('cubre el buffer completo aunque la longitud no sea divisible por el número de bloques', () => {
    const pcm = new Float32Array(1001);
    pcm[1000] = 1; // Última muestra
    const peaks = extractWaveformPeaks(pcm, 7);
    assert.equal(peaks.length, 7);
    assert.equal(peaks[6], 1);
  });

  it('ubica cada transitorio en el bloque que corresponde a su instante real', () => {
    const seconds = 10;
    const pcm = new Float32Array(seconds * SR);
    pcm[Math.round(7.3 * SR)] = 0.9;
    const buckets = 100;
    const peaks = extractWaveformPeaks(pcm, buckets);
    const expectedBucket = Math.floor((7.3 / seconds) * buckets);
    assert.equal(peaks.indexOf(1), expectedBucket);
  });

  it('informa la duración exacta cubierta por los picos', () => {
    const pcm = tone(12.5);
    const result = analyzeAudioPcm(pcm, SR, { waveformBuckets: 50 });
    assert.equal(result.waveformDurationSec, 12.5);
    assert.equal(result.waveformPeaks?.length, 50);
  });

  it('no confunde una intro en silencio con una pista muda', () => {
    const pcm = new Float32Array(6 * SR);
    pcm.set(tone(3), 3 * SR);
    const result = analyzeAudioPcm(pcm, SR);
    assert.notEqual(result.analysisError, 'Señal en silencio o nivel inferior al umbral mínimo audible');
    assert.ok(result.waveformPeaks!.slice(60).some((p) => p > 0.9));
  });

  it('escala la resolución con la duración dentro de límites', () => {
    assert.equal(waveformBucketsForDuration(10), 100);
    assert.equal(waveformBucketsForDuration(240), 480);
    assert.equal(waveformBucketsForDuration(3600), 1200);
    assert.equal(waveformBucketsForDuration(Number.NaN), 100);
  });
});

describe('Análisis en doble pasada', () => {
  const complete: TrackAnalysis = { status: 'analyzed', bpm: 124, camelot: '8A', key: 'Am', energy: 6 };

  it('solo pide segunda pasada si falta un dato o la duración es atípica', () => {
    assert.equal(needsSecondAnalysisPass(complete, 200), false);
    assert.equal(needsSecondAnalysisPass({ ...complete, bpm: undefined }, 200), true);
    assert.equal(needsSecondAnalysisPass({ ...complete, camelot: undefined }, 200), true);
    assert.equal(needsSecondAnalysisPass({ ...complete, energy: undefined }, 200), true);
    assert.equal(needsSecondAnalysisPass({ status: 'unsupported' }, 200), true);
    assert.equal(needsSecondAnalysisPass(complete, 12), true);
    assert.equal(needsSecondAnalysisPass(complete, 20 * 60), true);
  });

  it('ejecuta la segunda pasada en duraciones atípicas y la registra', () => {
    const result = analyzeAudioChannels([tone(8)], SR);
    assert.equal(result.analysisPasses, 2);
  });

  it('no repite el análisis sobre una señal en silencio', () => {
    const result = analyzeAudioChannels([new Float32Array(5 * SR)], SR);
    assert.equal(result.status, 'unsupported');
    assert.equal(result.analysisPasses, 1);
  });

  it('mezcla los canales para analizar y usa todos para los picos', () => {
    const left = tone(4, 0.1);
    const right = tone(4, 0.8);
    const result = analyzeAudioChannels([left, right], SR, { waveformBuckets: 10 });
    assert.ok(result.waveformPeaks!.every((p) => p > 0.9));
  });

  it('AnalysisService envía los canales adicionales al Worker', async () => {
    const worker = new CapturingWorker(complete);
    const service = new AnalysisService({}, () => worker);
    await service.queueAnalysis('t1', tone(1, 0.1), SR, {}, [tone(1, 0.8)]);
    const start = worker.received.find((m) => m.type === 'START_ANALYSIS');
    assert.ok(start && start.type === 'START_ANALYSIS');
    assert.equal(start.extraChannels?.length, 1);
  });
});

describe('Edición manual de BPM, Camelot y energía', () => {
  it('valida rangos', () => {
    assert.equal(validateManualAnalysisEdits({ bpm: 128 }), null);
    assert.equal(validateManualAnalysisEdits({ bpm: 10 }), 'bpm');
    assert.equal(validateManualAnalysisEdits({ energy: 11 }), 'energy');
    assert.equal(validateManualAnalysisEdits({ energy: 4.5 }), 'energy');
    assert.equal(validateManualAnalysisEdits({ camelot: '13A' as never }), 'camelot');
  });

  it('completa un análisis no concluyente y lo marca como manual', () => {
    const next = applyManualAnalysisEdits(
      { status: 'unsupported', energy: 3, analysisError: 'sin ritmo' },
      { bpm: 127.04, camelot: '8A', energy: 7 },
    );
    assert.equal(next.status, 'analyzed');
    assert.equal(next.bpm, 127);
    assert.equal(next.camelot, '8A');
    assert.equal(next.key, 'Am');
    assert.equal(next.energy, 7);
    assert.equal(next.analysisError, undefined);
    assert.deepEqual([...next.manualFields!].sort(), ['bpm', 'camelot', 'energy']);
  });

  it('null borra el valor y retira la marca manual', () => {
    const edited = applyManualAnalysisEdits({ status: 'analyzed', bpm: 120 }, { bpm: 126 });
    const cleared = applyManualAnalysisEdits(edited, { bpm: null });
    assert.equal(cleared.bpm, undefined);
    assert.equal(cleared.manualFields, undefined);
  });

  it('un reanálisis conserva los campos manuales y actualiza el resto', () => {
    const previous = applyManualAnalysisEdits({ status: 'analyzed', bpm: 120, energy: 5 }, { bpm: 90 });
    const fresh: TrackAnalysis = { status: 'analyzed', bpm: 180, energy: 8, camelot: '5A', key: 'Cm' };
    const merged = preserveManualAnalysisFields(fresh, previous);
    assert.equal(merged.bpm, 90);
    assert.equal(merged.energy, 8);
    assert.equal(merged.camelot, '5A');
  });

  it('persiste la edición en IndexedDB y notifica a los suscriptores', async () => {
    const storage = new IndexedDBStorage();
    await storage.clearAll();
    const file = new File([new Uint8Array(2048)], 'manual.mp3', { type: 'audio/mpeg' });
    const track = createTrackFromFile(file, 60);
    await storage.saveTrack(track, file);
    await storage.updateTrackAnalysis(track.id, { status: 'unsupported', energy: 2 });

    const manager = new AnalysisSyncManager(new AnalysisService({}, () => new CapturingWorker({ status: 'failed' })), storage);
    const notified: TrackAnalysis[] = [];
    manager.subscribe((id, analysis) => { if (id === track.id) notified.push(analysis); });

    const result = await manager.updateManualAnalysis(track.id, { bpm: 128, camelot: '11A' });
    assert.equal(result?.status, 'analyzed');
    const stored = await storage.getTrackAnalysis(track.id);
    assert.equal(stored?.bpm, 128);
    assert.equal(stored?.camelot, '11A');
    assert.equal(stored?.energy, 2);
    assert.equal(notified.at(-1)?.bpm, 128);
  });

  it('el reanálisis forzado mantiene el BPM corregido y analiza todos los canales', async () => {
    const storage = new IndexedDBStorage();
    await storage.clearAll();
    const file = new File([new Uint8Array(2048)], 'stereo.mp3', { type: 'audio/mpeg' });
    const track = createTrackFromFile(file, 240);
    await storage.saveTrack(track, file);

    const worker = new CapturingWorker({ status: 'analyzed', bpm: 170, camelot: '2A', key: 'Ebm', energy: 9 });
    const manager = new AnalysisSyncManager(new AnalysisService({}, () => worker), storage, stereoDecoder(240));

    track.analysis = (await manager.updateManualAnalysis(track.id, { bpm: 85 }))!;
    const result = await manager.analyzeTrack(track, { force: true });

    assert.equal(result.bpm, 85);
    assert.equal(result.camelot, '2A');
    const start = worker.received.find((m) => m.type === 'START_ANALYSIS');
    assert.ok(start && start.type === 'START_ANALYSIS');
    assert.equal(start.extraChannels?.length, 1);
    assert.equal(start.options?.waveformBuckets, 480);
  });
});

describe('Historial de sesiones grabadas (FIFO, máximo 5)', () => {
  let storage: IndexedDBStorage;

  beforeEach(async () => {
    storage = new IndexedDBStorage();
    await storage.clearAll();
  });

  function session(id: string, createdAt: number): RecordedSession {
    return {
      sessionId: id,
      formatVersion: 2,
      createdAtEpochMs: createdAt,
      metadata: {},
      events: [],
      durationMs: 90_000,
    };
  }

  function exportResult(format: 'wav' | 'mp3'): SessionExportResult {
    const mimeType = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
    const blob = new Blob([new Uint8Array(16)], { type: mimeType });
    return { status: 'completed', format, blob, mimeType, byteLength: 16, durationMs: 90_000, sampleRate: 48_000, channels: 2 };
  }

  it('planifica el descarte de la sesión más antigua', () => {
    const existing: StoredSessionRecord[] = [3, 1, 5, 2, 4].map((n) =>
      createStoredSessionRecord(session(`s${n}`, n), exportResult('wav'), n));
    const plan = planSessionHistoryInsert(existing, createStoredSessionRecord(session('s6', 6), exportResult('wav'), 6));
    assert.deepEqual(plan.evicted.map((r) => r.id), ['s1']);
  });

  it('guarda metadatos y audio y conserva como máximo 5 sesiones', async () => {
    for (let n = 1; n <= MAX_STORED_SESSIONS; n++) {
      const saved = await storage.saveRecordedSession(createStoredSessionRecord(session(`s${n}`, n), exportResult('wav'), n));
      assert.equal(saved.persisted, true);
      assert.equal(saved.evicted.length, 0);
    }

    const sixth = await storage.saveRecordedSession(createStoredSessionRecord(session('s6', 6), exportResult('mp3'), 6));
    assert.equal(sixth.persisted, true);
    assert.deepEqual(sixth.evicted.map((r) => r.id), ['s1']);

    const stored = await storage.getRecordedSessions();
    assert.equal(stored.length, MAX_STORED_SESSIONS);
    assert.deepEqual(stored.map((r) => r.id), ['s6', 's5', 's4', 's3', 's2']);
    assert.equal(stored[0].durationMs, 90_000);
    assert.equal(stored[0].files.mp3?.mimeType, 'audio/mpeg');
    assert.ok(stored[0].files.mp3?.blob);
  });

  it('reexportar la misma sesión en otro formato no ocupa un nuevo hueco', async () => {
    for (let n = 1; n <= MAX_STORED_SESSIONS; n++) {
      await storage.saveRecordedSession(createStoredSessionRecord(session(`s${n}`, n), exportResult('wav'), n));
    }
    const again = await storage.saveRecordedSession(createStoredSessionRecord(session('s1', 1), exportResult('mp3'), 99));
    assert.equal(again.evicted.length, 0);

    const stored = await storage.getRecordedSessions();
    const first = stored.find((r) => r.id === 's1');
    assert.equal(stored.length, MAX_STORED_SESSIONS);
    assert.equal(first?.savedAt, 1);
    assert.ok(first?.files.wav && first.files.mp3);
  });
});
