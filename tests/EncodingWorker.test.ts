import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  parseEncodingWorkerRequest,
  type EncodingJobRequest,
  type EncodingWorkerResponse,
} from '../src/session/EncodingProtocol.ts';
import {
  createEncodingWorkerHandler,
} from '../src/session/EncodingWorkerHandler.ts';
import {
  EncodingTransportCanceledError,
  EncodingTransportError,
  EncodingWorkerClient,
  type EncodingWorkerLike,
} from '../src/session/EncodingWorkerClient.ts';

class FakeWorker implements EncodingWorkerLike {
  public onmessage: ((event: MessageEvent<EncodingWorkerResponse>) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public readonly messages: unknown[] = [];
  public readonly transfers: Transferable[][] = [];
  public terminated = false;

  public postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messages.push(message);
    this.transfers.push(transfer ?? []);
  }

  public terminate(): void {
    this.terminated = true;
  }

  public emit(message: EncodingWorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<EncodingWorkerResponse>);
  }

  public emitError(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function pcmRequest(overrides: Partial<EncodingJobRequest> = {}): EncodingJobRequest {
  const length = overrides.length ?? 4800;
  if (!overrides.channels) {
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      left[index] = Math.sin(index / 9) * 0.3;
      right[index] = Math.sin(index / 13) * 0.2;
    }
    overrides.channels = [left, right];
  }
  return {
    type: 'ENCODE',
    jobId: 'job-1',
    format: 'wav',
    sampleRate: 48_000,
    length,
    channels: overrides.channels,
    options: {},
    ...overrides,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for asynchronous Worker activity.');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function isEncoded(message: unknown): message is Extract<EncodingWorkerResponse, { type: 'ENCODED' }> {
  return Boolean(message) && (message as { type?: string }).type === 'ENCODED';
}

function isError(message: unknown): message is Extract<EncodingWorkerResponse, { type: 'ERROR' }> {
  return Boolean(message) && (message as { type?: string }).type === 'ERROR';
}

function isCanceled(message: unknown): message is Extract<EncodingWorkerResponse, { type: 'CANCELED' }> {
  return Boolean(message) && (message as { type?: string }).type === 'CANCELED';
}

describe('EncodingProtocol — Worker message validation', () => {
  test('accepts valid WAV, MP3 and CANCEL messages', () => {
    const wav = parseEncodingWorkerRequest(pcmRequest());
    assert.equal(wav.ok, true);
    if (!wav.ok) return;
    assert.equal(wav.request.type, 'ENCODE');

    const mp3 = parseEncodingWorkerRequest(pcmRequest({ format: 'mp3', options: { bitrateKbps: 192, maxFileBytes: 1_000_000 } }));
    assert.equal(mp3.ok, true);

    const cancel = parseEncodingWorkerRequest({ type: 'CANCEL', jobId: 'job-1' });
    assert.equal(cancel.ok, true);
  });

  test('rejects malformed messages without throwing', () => {
    const cases: Array<unknown> = [
      null,
      [],
      {},
      { type: 'ENCODE' },
      { type: 'UNKNOWN', jobId: 'job-1' },
      { type: 'ENCODE', jobId: '' },
      { type: 'ENCODE', jobId: 'job-1', format: 'ogg' },
      { type: 'ENCODE', jobId: 'job-1', format: 'wav', sampleRate: 0, length: 1, channels: [new Float32Array(1)], options: {} },
      { type: 'ENCODE', jobId: 'job-1', format: 'wav', sampleRate: 48_000, length: 2, channels: [new Float32Array(1)], options: {} },
      { type: 'ENCODE', jobId: 'job-1', format: 'wav', sampleRate: 48_000, length: 1, channels: [], options: {} },
      { type: 'ENCODE', jobId: 'job-1', format: 'wav', sampleRate: 48_000, length: 1, channels: [new Float32Array(1), new Float32Array(1), new Float32Array(1)], options: {} },
      { type: 'ENCODE', jobId: 'job-1', format: 'wav', sampleRate: 48_000, length: 1, channels: [new Float32Array(1)], options: null },
      { type: 'ENCODE', jobId: 'job-1', format: 'wav', sampleRate: 48_000, length: 1, channels: [new Float32Array(1)], options: { maxFileBytes: -1 } },
      { type: 'ENCODE', jobId: 'job-1', format: 'mp3', sampleRate: 48_000, length: 1, channels: [new Float32Array(1)], options: { bitrateKbps: 1.5 } },
    ];
    for (const value of cases) {
      const parsed = parseEncodingWorkerRequest(value);
      assert.equal(parsed.ok, false);
      if (parsed.ok) continue;
      assert.equal(typeof parsed.message, 'string');
      assert.notEqual(parsed.message.length, 0);
    }
  });
});

describe('EncodingWorkerHandler — execution, errors, cancellation and ownership', () => {
  test('encodes WAV in the Worker handler and transfers the exact RIFF buffer', async () => {
    const messages: EncodingWorkerResponse[] = [];
    const transfers: Transferable[][] = [];
    const handler = createEncodingWorkerHandler((message, transfer) => {
      messages.push(message);
      transfers.push(transfer ?? []);
    });

    handler({ data: pcmRequest({ length: 100, channels: [new Float32Array(100).fill(0.5)] }) });
    await waitFor(() => messages.some(isEncoded));

    const encoded = messages.find(isEncoded)!;
    assert.equal(encoded.mimeType, 'audio/wav');
    assert.equal(encoded.format, 'wav');
    assert.ok(encoded.byteLength > 44);
    const bytes = new Uint8Array(encoded.data);
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
    assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'WAVE');
    assert.equal(new DataView(encoded.data).getUint16(22, true), 1);
    assert.equal(transfers.at(-1)?.length, 1);
    assert.equal(transfers.at(-1)?.[0], encoded.data);
  });

  test('encodes MP3 in the Worker handler and emits real frame data', async () => {
    const messages: EncodingWorkerResponse[] = [];
    const handler = createEncodingWorkerHandler((message) => messages.push(message));
    handler({
      data: pcmRequest({
        format: 'mp3',
        length: 4800,
        options: { bitrateKbps: 128 },
        channels: [new Float32Array(4800).fill(0.1), new Float32Array(4800).fill(-0.1)],
      }),
    });
    await waitFor(() => messages.some(isEncoded));

    const encoded = messages.find(isEncoded)!;
    assert.equal(encoded.mimeType, 'audio/mpeg');
    const bytes = new Uint8Array(encoded.data);
    assert.ok(bytes.length > 0);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1] & 0xe0, 0xe0);
    assert.notEqual(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
  });

  test('reports malformed messages, busy jobs and invalid audio as typed errors', async () => {
    const messages: EncodingWorkerResponse[] = [];
    const handler = createEncodingWorkerHandler((message) => messages.push(message));

    handler({ data: { type: 'NOPE', jobId: 'bad' } });
    assert.equal(messages.at(-1)?.type, 'ERROR');
    assert.equal((messages.at(-1) as Extract<EncodingWorkerResponse, { type: 'ERROR' }>).code, 'INVALID_MESSAGE');

    handler({ data: pcmRequest({ jobId: 'busy-1', length: 200_000, channels: [new Float32Array(200_000)] }) });
    handler({ data: pcmRequest({ jobId: 'busy-2' }) });
    const busy = messages.find((message): message is Extract<EncodingWorkerResponse, { type: 'ERROR' }> => isError(message) && message.code === 'BUSY');
    assert.ok(busy);
    assert.equal(busy.code, 'BUSY');
    await waitFor(() => messages.some((message) => isEncoded(message) || isError(message)) && messages.some(isEncoded));

    const nanHandlerMessages: EncodingWorkerResponse[] = [];
    const nanHandler = createEncodingWorkerHandler((message) => nanHandlerMessages.push(message));
    const bad = new Float32Array(10);
    bad[3] = Number.POSITIVE_INFINITY;
    nanHandler({ data: pcmRequest({ jobId: 'nan', length: 10, channels: [bad] }) });
    await waitFor(() => nanHandlerMessages.some(isError));
    assert.equal((nanHandlerMessages.find(isError)!).code, 'NON_FINITE_SAMPLE');
  });

  test('cancels during encoding and never publishes a late result', async () => {
    const messages: EncodingWorkerResponse[] = [];
    let handler: ((event: { data: unknown }) => void) | null = null;
    let cancelSent = false;
    handler = createEncodingWorkerHandler(
      (message) => messages.push(message),
      {
        yieldFn: async () => {
          if (!cancelSent) {
            cancelSent = true;
            handler?.({ data: { type: 'CANCEL', jobId: 'cancel-1' } });
          }
          await Promise.resolve();
        },
      },
    );

    const length = 48_000 * 2;
    const channels = [new Float32Array(length).fill(0.2), new Float32Array(length).fill(-0.2)];
    handler({
      data: pcmRequest({ jobId: 'cancel-1', format: 'mp3', length, channels, options: { bitrateKbps: 128 } }),
    });

    await waitFor(() => messages.some((message) => isCanceled(message) || isEncoded(message)));
    assert.ok(messages.some(isCanceled), 'handler must report cancellation');
    assert.equal(messages.some(isEncoded), false, 'no encoded buffer may be published after cancellation');
  });
});

describe('EncodingWorkerClient — lifecycle, out-of-order messages and ownership', () => {
  test('transfers channel buffers, reports progress and settles once', async () => {
    const worker = new FakeWorker();
    const client = new EncodingWorkerClient(() => worker);
    const progress: number[] = [];
    const request = pcmRequest();

    const promise = client.encode(request, (value) => progress.push(value));
    assert.equal(worker.messages.length, 1);
    assert.deepEqual(worker.transfers[0], request.channels.map((channel) => channel.buffer));

    worker.emit({ type: 'PROGRESS', jobId: 'other-job', progress: 0.9 });
    worker.emit({ type: 'PROGRESS', jobId: 'job-1', progress: 0.4 });
    worker.emit({ type: 'PROGRESS', jobId: 'job-1', progress: 2 });
    const data = new ArrayBuffer(4);
    worker.emit({
      type: 'ENCODED',
      jobId: 'job-1',
      format: 'wav',
      mimeType: 'audio/wav',
      data,
      byteLength: data.byteLength,
    });
    worker.emit({
      type: 'ENCODED',
      jobId: 'job-1',
      format: 'wav',
      mimeType: 'audio/wav',
      data,
      byteLength: data.byteLength,
    });

    const result = await promise;
    assert.equal(result.data, data);
    assert.deepEqual(progress, [0.4, 1]);
    assert.equal(worker.terminated, true);
    assert.equal(client.cancel(), false);
  });

  test('ignores stale out-of-order results and only accepts the active job', async () => {
    const worker = new FakeWorker();
    const client = new EncodingWorkerClient(() => worker);
    const promise = client.encode(pcmRequest());

    worker.emit({
      type: 'ENCODED',
      jobId: 'stale-job',
      format: 'wav',
      mimeType: 'audio/wav',
      data: new ArrayBuffer(8),
      byteLength: 8,
    });
    assert.equal(worker.terminated, false);
    const data = new ArrayBuffer(2);
    worker.emit({
      type: 'ENCODED',
      jobId: 'job-1',
      format: 'wav',
      mimeType: 'audio/wav',
      data,
      byteLength: 2,
    });
    assert.equal((await promise).data, data);
  });

  test('rejects malformed results and Worker failures', async () => {
    const malformedWorker = new FakeWorker();
    const malformedClient = new EncodingWorkerClient(() => malformedWorker);
    const malformed = malformedClient.encode(pcmRequest());
    malformedWorker.emit({
      type: 'ENCODED',
      jobId: 'job-1',
      format: 'wav',
      mimeType: 'audio/wav',
      data: new ArrayBuffer(4),
      byteLength: 99,
    });
    await assert.rejects(malformed, { code: 'INVALID_RESPONSE' });

    const mimeWorker = new FakeWorker();
    const mimeClient = new EncodingWorkerClient(() => mimeWorker);
    const wrongMime = mimeClient.encode(pcmRequest());
    mimeWorker.emit({
      type: 'ENCODED',
      jobId: 'job-1',
      format: 'wav',
      mimeType: 'audio/mpeg',
      data: new ArrayBuffer(4),
      byteLength: 4,
    });
    await assert.rejects(wrongMime, { code: 'INVALID_RESPONSE' });

    const failingWorker = new FakeWorker();
    const failingClient = new EncodingWorkerClient(() => failingWorker);
    const failing = failingClient.encode(pcmRequest());
    failingWorker.emitError('boom');
    await assert.rejects(failing, { code: 'WORKER_ERROR' });

    const workerError = new FakeWorker();
    const errorClient = new EncodingWorkerClient(() => workerError);
    const errored = errorClient.encode(pcmRequest());
    workerError.emit({ type: 'ERROR', jobId: 'job-1', code: 'MEMORY_LIMIT', message: 'too big' });
    await assert.rejects(errored, (error: unknown) => {
      assert.ok(error instanceof EncodingTransportError);
      assert.equal(error.code, 'MEMORY_LIMIT');
      return true;
    });
  });

  test('cancels, terminates the Worker and rejects late results', async () => {
    const worker = new FakeWorker();
    const client = new EncodingWorkerClient(() => worker);
    const promise = client.encode(pcmRequest());
    assert.equal(client.cancel(), true);
    await assert.rejects(promise, EncodingTransportCanceledError);
    assert.equal(worker.terminated, true);

    worker.emit({
      type: 'ENCODED',
      jobId: 'job-1',
      format: 'wav',
      mimeType: 'audio/wav',
      data: new ArrayBuffer(4),
      byteLength: 4,
    });
    assert.equal(client.cancel(), false);
  });

  test('rejects invalid requests and unavailable Workers before allocating a job', async () => {
    const worker = new FakeWorker();
    const client = new EncodingWorkerClient(() => worker);
    const shared = new Float32Array(2);
    await assert.rejects(
      client.encode(pcmRequest({ channels: [shared, shared] })),
      { code: 'INVALID_REQUEST' },
    );
    assert.equal(worker.messages.length, 0);

    const unavailable = new EncodingWorkerClient(() => { throw new Error('no worker'); });
    await assert.rejects(unavailable.encode(pcmRequest()), { code: 'WORKER_UNAVAILABLE' });
  });

  test('rejects concurrent jobs and reports cancellation before encoding', async () => {
    const worker = new FakeWorker();
    const client = new EncodingWorkerClient(() => worker);
    const first = client.encode(pcmRequest({ jobId: 'first' }));
    await assert.rejects(client.encode(pcmRequest({ jobId: 'second' })), { code: 'BUSY' });
    client.cancel();
    await assert.rejects(first, EncodingTransportCanceledError);
  });
});
