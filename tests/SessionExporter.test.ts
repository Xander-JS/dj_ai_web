import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  startSessionExport,
  SessionExportCanceledError,
  SessionExportError,
  type SessionExportProgress,
  type SessionExportRequest,
} from '../src/session/SessionExporter.ts';
import {
  renderSessionOffline,
  SessionRenderError,
  type SessionBufferResolver,
} from '../src/session/OfflineSessionRenderer.ts';
import type { RecordedSession } from '../src/session/SessionRecorder.ts';
import { runEncodingJob } from '../src/session/EncodingJobRunner.ts';
import {
  EncodingTransportCanceledError,
  EncodingTransportError,
  type EncodedAudio,
  type EncodingTransport,
} from '../src/session/EncodingWorkerClient.ts';
import { DEFAULT_MAX_WAV_BYTES } from '../src/session/WavPcmEncoder.ts';
import type { EncodingJobRequest } from '../src/session/EncodingProtocol.ts';

const SAMPLE_RATE = 48_000;

function session(durationMs = 1000): RecordedSession {
  return {
    sessionId: 'export-test',
    formatVersion: 2,
    createdAtEpochMs: 0,
    metadata: {},
    events: [],
    durationMs,
  };
}

function audioBuffer(channels: Float32Array[], sampleRate = SAMPLE_RATE): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData(channel: number) {
      if (channel < 0 || channel >= channels.length) throw new RangeError('channel out of range');
      return channels[channel];
    },
  } as AudioBuffer;
}

function stereoBuffer(seconds: number): AudioBuffer {
  const length = Math.round(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    left[index] = Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE) * 0.4;
    right[index] = Math.sin((2 * Math.PI * 330 * index) / SAMPLE_RATE) * 0.4;
  }
  return audioBuffer([left, right]);
}

function rendererReturning(buffer: AudioBuffer): typeof renderSessionOffline {
  return async () => ({ buffer, durationMs: buffer.duration * 1000, sampleRate: buffer.sampleRate });
}

function inlineTransport(): EncodingTransport {
  let canceled = false;
  return {
    async encode(request: EncodingJobRequest, onProgress): Promise<EncodedAudio> {
      const result = await runEncodingJob(request, {
        onProgress,
        isCancelled: () => canceled,
        yieldFn: async () => { await Promise.resolve(); },
      });
      return result;
    },
    cancel() {
      canceled = true;
      return true;
    },
    dispose() {},
  };
}

function request(overrides: Partial<SessionExportRequest> = {}): SessionExportRequest {
  return {
    session: session(),
    resolveBuffer: (() => null) as SessionBufferResolver,
    format: 'wav',
    ...overrides,
  };
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for export stage.');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('SessionExporter — orchestration, progress and limits', () => {
  test('completes a WAV export with measured monotonic progress and phase transitions', async () => {
    const progress: SessionExportProgress[] = [];
    const buffer = stereoBuffer(0.25);
    const handle = startSessionExport(request({ resolveBuffer: () => null }), {
      renderSession: rendererReturning(buffer),
      createEncodingTransport: inlineTransport,
      onProgress: (value) => progress.push({ ...value }),
      createJobId: () => 'job-progress',
    });

    const result = await handle.result;
    assert.equal(result.status, 'completed');
    assert.equal(result.format, 'wav');
    assert.equal(result.mimeType, 'audio/wav');
    assert.equal(result.blob.type, 'audio/wav');
    assert.equal(result.byteLength, result.blob.size);
    assert.ok(result.byteLength > 44);
    assert.equal(result.sampleRate, SAMPLE_RATE);
    assert.equal(result.channels, 2);
    assert.equal(handle.cancel(), false);

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
    assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'WAVE');

    assert.equal(progress[0].phase, 'preparing');
    assert.equal(progress[0].percent, 0);
    assert.ok(progress.some((value) => value.phase === 'rendering' && value.indeterminate && value.percent === null));
    assert.ok(progress.some((value) => value.phase === 'encoding' && value.indeterminate === false));
    assert.equal(progress.at(-1)?.phase, 'finalizing');
    assert.equal(progress.at(-1)?.percent, 100);
    for (let index = 0; index < progress.length; index += 1) {
      if (progress[index].percent !== null) {
        assert.ok(progress[index].percent >= 0 && progress[index].percent <= 100);
      }
      if (index > 0 && progress[index].percent !== null && progress[index - 1].percent !== null) {
        assert.ok(progress[index].percent >= progress[index - 1].percent, 'measured progress must not regress');
      }
    }
  });

  test('completes a real MP3 export through the shared encoder runner', async () => {
    const buffer = stereoBuffer(0.25);
    const handle = startSessionExport(request({
      format: 'mp3',
      mp3: { bitrateKbps: 128 },
    }), {
      renderSession: rendererReturning(buffer),
      createEncodingTransport: inlineTransport,
    });

    const result = await handle.result;
    assert.equal(result.status, 'completed');
    assert.equal(result.format, 'mp3');
    assert.equal(result.mimeType, 'audio/mpeg');
    assert.equal(result.blob.type, 'audio/mpeg');
    assert.equal(result.bitrateKbps, 128);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    assert.ok(bytes.length > 0);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1] & 0xe0, 0xe0);
    assert.notEqual(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
  });

  test('clamps regressive or out-of-range transport progress without lowering the reported percentage', async () => {
    const progress: SessionExportProgress[] = [];
    const renderer: typeof renderSessionOffline = async () => {
      const buffer = audioBuffer([new Float32Array(10), new Float32Array(10)]);
      return { buffer, durationMs: buffer.duration * 1000, sampleRate: buffer.sampleRate };
    };

    const driven: EncodingTransport = {
      async encode(_request, onProgress): Promise<EncodedAudio> {
        onProgress?.(0.5);
        onProgress?.(0.2);
        onProgress?.(2);
        onProgress?.(Number.NaN);
        const data = new ArrayBuffer(4);
        return { format: 'wav', mimeType: 'audio/wav', data, byteLength: 4 };
      },
      cancel() { return true; },
      dispose() {},
    };

    const handle = startSessionExport(request({ session: session(10) }), {
      renderSession: renderer,
      createEncodingTransport: () => driven,
      onProgress: (value) => progress.push({ ...value }),
    });
    await handle.result;
    const encodingValues = progress
      .filter((value) => value.phase === 'encoding' && value.percent !== null)
      .map((value) => value.percent as number);
    assert.ok(encodingValues.length >= 2);
    for (let index = 1; index < encodingValues.length; index += 1) {
      assert.ok(encodingValues[index] >= encodingValues[index - 1]);
    }
    assert.equal(encodingValues.at(-1), 100);
  });

  test('rejects WAV limits, invalid options and unsupported MP3 parameters before rendering', async () => {
    let renderCalls = 0;
    const renderer: typeof renderSessionOffline = async () => {
      renderCalls += 1;
      return { buffer: stereoBuffer(0.01), durationMs: 10, sampleRate: SAMPLE_RATE };
    };

    const tooLong = startSessionExport(request({ session: session(20 * 60 * 1000) }), {
      renderSession: renderer,
      createEncodingTransport: inlineTransport,
    });
    await assert.rejects(tooLong.result, (error: unknown) => {
      assert.ok(error instanceof SessionExportError);
      assert.equal(error.code, 'RESOURCE_LIMIT');
      assert.equal(error.phase, 'preparing');
      return true;
    });

    const oversizedOption = startSessionExport(request({ wav: { maxFileBytes: DEFAULT_MAX_WAV_BYTES + 1 } }), {
      renderSession: renderer,
      createEncodingTransport: inlineTransport,
    });
    await assert.rejects(oversizedOption.result, { code: 'INVALID_REQUEST' });

    const invalidBitrate = startSessionExport(request({ format: 'mp3', mp3: { bitrateKbps: 100 } }), {
      renderSession: renderer,
      createEncodingTransport: inlineTransport,
    });
    await assert.rejects(invalidBitrate.result, { code: 'INVALID_REQUEST' });

    const unsupportedRate = startSessionExport(request({ format: 'mp3', render: { sampleRate: 96_000 } }), {
      renderSession: renderer,
      createEncodingTransport: inlineTransport,
    });
    await assert.rejects(unsupportedRate.result, { code: 'INVALID_REQUEST' });
    assert.equal(renderCalls, 0);
  });

  test('rejects invalid rendered buffers and mismatched sample rates', async () => {
    const threeChannels = startSessionExport(request(), {
      renderSession: rendererReturning(audioBuffer([
        new Float32Array(10), new Float32Array(10), new Float32Array(10),
      ])),
      createEncodingTransport: inlineTransport,
    });
    await assert.rejects(threeChannels.result, { code: 'RENDER_FAILED' });

    const wrongRate = startSessionExport(request(), {
      renderSession: rendererReturning(audioBuffer([new Float32Array(10), new Float32Array(10)], 44_100)),
      createEncodingTransport: inlineTransport,
    });
    await assert.rejects(wrongRate.result, (error: unknown) => {
      assert.ok(error instanceof SessionExportError);
      assert.equal(error.code, 'RENDER_FAILED');
      assert.match(error.message, /44100/);
      return true;
    });

    const invalidDuration = startSessionExport(request({ session: { ...session(), durationMs: 0 } }), {
      renderSession: rendererReturning(stereoBuffer(0.01)),
      createEncodingTransport: inlineTransport,
    });
    await assert.rejects(invalidDuration.result, { code: 'INVALID_REQUEST' });
  });
});

describe('SessionExporter — cancellation', () => {
  test('accepts cancellation before rendering starts and never invokes the renderer', async () => {
    let renderCalls = 0;
    let transportCalls = 0;
    const handle = startSessionExport(request(), {
      renderSession: (async () => {
        renderCalls += 1;
        return rendererReturning(stereoBuffer(0.1))();
      }) as typeof renderSessionOffline,
      createEncodingTransport: () => {
        transportCalls += 1;
        return inlineTransport();
      },
    });

    assert.equal(handle.cancel(), true);
    await assert.rejects(handle.result, (error: unknown) => {
      assert.ok(error instanceof SessionExportCanceledError);
      assert.equal(error.code, 'CANCELED');
      return true;
    });
    assert.equal(handle.cancel(), false);
    assert.equal(renderCalls, 0);
    assert.equal(transportCalls, 0);
  });

  test('settles as cancelled while an unabortable render is still pending and never encodes it', async () => {
    let resolveRender!: (value: { buffer: AudioBuffer; durationMs: number; sampleRate: number }) => void;
    let renderStarted = false;
    let transportCalls = 0;
    const renderer: typeof renderSessionOffline = async () => {
      renderStarted = true;
      return new Promise((resolve) => { resolveRender = resolve; });
    };

    const handle = startSessionExport(request(), {
      renderSession: renderer,
      createEncodingTransport: () => {
        transportCalls += 1;
        return inlineTransport();
      },
    });
    await waitFor(() => renderStarted);
    assert.equal(handle.cancel(), true);
    await assert.rejects(handle.result, SessionExportCanceledError);

    const buffer = stereoBuffer(0.1);
    resolveRender({ buffer, durationMs: buffer.duration * 1000, sampleRate: buffer.sampleRate });
    await tick();
    await tick();
    assert.equal(transportCalls, 0, 'late render results must not reach the encoder');
  });

  test('cancels during encoding, terminates the transport and ignores a late success', async () => {
    const buffer = stereoBuffer(0.1);
    let encodeStarted = false;
    let cancelCalls = 0;
    let resolveEncode!: (value: EncodedAudio) => void;
    const transport: EncodingTransport = {
      encode(): Promise<EncodedAudio> {
        encodeStarted = true;
        return new Promise((resolve) => { resolveEncode = resolve; });
      },
      cancel() {
        cancelCalls += 1;
        return true;
      },
      dispose() {},
    };

    const handle = startSessionExport(request(), {
      renderSession: rendererReturning(buffer),
      createEncodingTransport: () => transport,
    });
    await waitFor(() => encodeStarted);
    assert.equal(handle.cancel(), true);
    await assert.rejects(handle.result, SessionExportCanceledError);
    assert.equal(cancelCalls, 1);

    resolveEncode({
      format: 'wav',
      mimeType: 'audio/wav',
      data: new ArrayBuffer(4),
      byteLength: 4,
    });
    await tick();
    assert.equal(handle.cancel(), false);
  });

  test('cancels between rendering and encoding through the progress observer', async () => {
    let transportCalls = 0;
    let handle: ReturnType<typeof startSessionExport> | null = null;
    handle = startSessionExport(request(), {
      renderSession: rendererReturning(stereoBuffer(0.05)),
      createEncodingTransport: () => {
        transportCalls += 1;
        return inlineTransport();
      },
      onProgress: (value) => {
        if (value.phase === 'encoding' && value.percent === 0) {
          assert.equal(handle?.cancel(), true);
        }
      },
    });

    await assert.rejects(handle.result, SessionExportCanceledError);
    assert.equal(transportCalls, 0);
  });

  test('propagates transport cancellation even when the encoding promise only rejects later', async () => {
    let rejectEncode!: (reason: unknown) => void;
    const transport: EncodingTransport = {
      encode(): Promise<EncodedAudio> {
        return new Promise((_resolve, reject) => { rejectEncode = reject; });
      },
      cancel() {
        rejectEncode?.(new EncodingTransportCanceledError('cancelled by test'));
        return true;
      },
      dispose() {},
    };
    const handle = startSessionExport(request(), {
      renderSession: rendererReturning(stereoBuffer(0.05)),
      createEncodingTransport: () => transport,
    });
    handle.cancel();
    await assert.rejects(handle.result, SessionExportCanceledError);
  });
});

describe('SessionExporter — error propagation', () => {
  test('preserves renderer error codes and causes', async () => {
    const cause = new Error('decoded buffer unavailable');
    const renderer: typeof renderSessionOffline = async () => {
      throw new SessionRenderError('MISSING_BUFFER', 'missing buffer', { cause });
    };
    const handle = startSessionExport(request(), {
      renderSession: renderer,
      createEncodingTransport: inlineTransport,
    });
    await assert.rejects(handle.result, (error: unknown) => {
      assert.ok(error instanceof SessionExportError);
      assert.equal(error.code, 'RENDER_FAILED');
      assert.equal(error.phase, 'rendering');
      assert.ok(error.cause instanceof SessionRenderError);
      assert.equal((error.cause as SessionRenderError).cause, cause);
      return true;
    });
  });

  test('reports worker availability and encoding failures without returning a result', async () => {
    const unavailable = startSessionExport(request(), {
      renderSession: rendererReturning(stereoBuffer(0.05)),
      createEncodingTransport: () => { throw new EncodingTransportError('WORKER_UNAVAILABLE', 'no worker'); },
    });
    await assert.rejects(unavailable.result, { code: 'WORKER_UNAVAILABLE' });

    const broken: EncodingTransport = {
      async encode() { throw new EncodingTransportError('WORKER_ERROR', 'worker crashed'); },
      cancel() { return true; },
      dispose() {},
    };
    const failed = startSessionExport(request(), {
      renderSession: rendererReturning(stereoBuffer(0.05)),
      createEncodingTransport: () => broken,
    });
    await assert.rejects(failed.result, (error: unknown) => {
      assert.ok(error instanceof SessionExportError);
      assert.equal(error.code, 'ENCODE_FAILED');
      assert.equal(error.phase, 'encoding');
      return true;
    });
  });

  test('disposes the transport even when encoding throws', async () => {
    let disposed = 0;
    const transport: EncodingTransport = {
      async encode() { throw new Error('boom'); },
      cancel() { return true; },
      dispose() { disposed += 1; },
    };
    const handle = startSessionExport(request(), {
      renderSession: rendererReturning(stereoBuffer(0.05)),
      createEncodingTransport: () => transport,
    });
    await assert.rejects(handle.result, { code: 'ENCODE_FAILED' });
    assert.equal(disposed, 1);
  });
});
