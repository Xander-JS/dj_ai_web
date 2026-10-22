import type {
  EncodingJobRequest,
  EncodingWorkerErrorCode,
  EncodingWorkerResponse,
  SessionEncodingFormat,
} from './EncodingProtocol.ts';

export interface EncodingWorkerLike {
  onmessage: ((event: MessageEvent<EncodingWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export type EncodingWorkerFactory = () => EncodingWorkerLike;

export type EncodingTransportErrorCode =
  | 'WORKER_UNAVAILABLE'
  | 'WORKER_ERROR'
  | 'INVALID_RESPONSE'
  | 'BUSY'
  | 'DISPOSED'
  | 'INVALID_REQUEST'
  | EncodingWorkerErrorCode;

export class EncodingTransportError extends Error {
  public readonly code: EncodingTransportErrorCode;

  public constructor(code: EncodingTransportErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = 'EncodingTransportError';
  }
}

export class EncodingTransportCanceledError extends Error {
  public constructor(message = 'Encoding transport was cancelled.') {
    super(message);
    this.name = 'EncodingTransportCanceledError';
  }
}

export interface EncodedAudio {
  format: SessionEncodingFormat;
  mimeType: 'audio/wav' | 'audio/mpeg';
  data: ArrayBuffer;
  byteLength: number;
}

export interface EncodingTransport {
  /**
   * Transfers channel backing buffers to the Worker. After postMessage succeeds,
   * callers must treat those Float32Array buffers as detached and unavailable.
   */
  encode(
    request: EncodingJobRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<EncodedAudio>;
  cancel(): boolean;
  dispose(): void;
}

export const defaultEncodingWorkerFactory: EncodingWorkerFactory = () => {
  if (typeof Worker === 'undefined') {
    throw new EncodingTransportError(
      'WORKER_UNAVAILABLE',
      'Web Workers are not available in this environment, so encoding cannot run off the main thread.',
    );
  }
  return new Worker(
    new URL('../workers/sessionEncodingWorker.ts', import.meta.url),
    { type: 'module' },
  ) as unknown as EncodingWorkerLike;
};

interface ActiveJob {
  request: EncodingJobRequest;
  worker: EncodingWorkerLike;
  settled: boolean;
  resolve: (value: EncodedAudio) => void;
  reject: (reason: unknown) => void;
  onProgress?: (fraction: number) => void;
}

/**
 * One Worker instance per encoding job. Creating a fresh Worker makes stale
 * messages from previous operations impossible; the jobId check is defense in depth.
 */
export class EncodingWorkerClient implements EncodingTransport {
  private readonly factory: EncodingWorkerFactory;
  private active: ActiveJob | null = null;
  private disposed = false;

  public constructor(factory: EncodingWorkerFactory = defaultEncodingWorkerFactory) {
    this.factory = factory;
  }

  public encode(
    request: EncodingJobRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<EncodedAudio> {
    if (this.disposed) {
      return Promise.reject(new EncodingTransportError('DISPOSED', 'Encoding transport has been disposed.'));
    }
    if (this.active) {
      return Promise.reject(new EncodingTransportError('BUSY', 'An encoding job is already running.'));
    }
    if (request.channels.length < 1 || request.channels.length > 2) {
      return Promise.reject(new EncodingTransportError('INVALID_REQUEST', 'Encoding requires one or two channels.'));
    }
    const buffers = new Set<ArrayBufferLike>();
    for (const channel of request.channels) {
      if (!(channel instanceof Float32Array)) {
        return Promise.reject(new EncodingTransportError('INVALID_REQUEST', 'Encoding channels must be Float32Arrays.'));
      }
      if (buffers.has(channel.buffer)) {
        return Promise.reject(new EncodingTransportError(
          'INVALID_REQUEST',
          'Encoding channels must own distinct ArrayBuffers before ownership is transferred.',
        ));
      }
      buffers.add(channel.buffer);
    }

    let worker: EncodingWorkerLike;
    try {
      worker = this.factory();
    } catch (error) {
      return Promise.reject(error instanceof EncodingTransportError
        ? error
        : new EncodingTransportError('WORKER_UNAVAILABLE', 'Could not create the encoding Worker.', { cause: error }));
    }

    return new Promise<EncodedAudio>((resolve, reject) => {
      const job: ActiveJob = { request, worker, settled: false, resolve, reject, onProgress };
      this.active = job;

      const finish = (): boolean => {
        if (job.settled) return false;
        job.settled = true;
        if (this.active === job) this.active = null;
        worker.onmessage = null;
        worker.onerror = null;
        try {
          worker.terminate();
        } catch {
          // The Worker may already be gone after an error or explicit cancel.
        }
        return true;
      };

      const fail = (error: unknown): void => {
        if (finish()) reject(error);
      };

      worker.onmessage = (event: MessageEvent<EncodingWorkerResponse>) => {
        const message = event.data;
        if (!message || message.jobId !== job.request.jobId || job.settled) return;

        if (message.type === 'PROGRESS') {
          if (typeof message.progress === 'number' && Number.isFinite(message.progress)) {
            job.onProgress?.(Math.max(0, Math.min(1, message.progress)));
          }
          return;
        }

        if (message.type === 'CANCELED') {
          fail(new EncodingTransportCanceledError());
          return;
        }

        if (message.type === 'ERROR') {
          fail(new EncodingTransportError(message.code, message.message));
          return;
        }

        if (message.type === 'ENCODED') {
          const expectedMimeType = job.request.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
          if (message.format !== job.request.format
            || message.mimeType !== expectedMimeType
            || !(message.data instanceof ArrayBuffer)
            || message.data.byteLength === 0
            || !Number.isSafeInteger(message.byteLength)
            || message.byteLength <= 0
            || message.byteLength > message.data.byteLength) {
            fail(new EncodingTransportError('INVALID_RESPONSE', 'Encoding Worker returned an inconsistent result.'));
            return;
          }
          if (finish()) {
            resolve({
              format: message.format,
              mimeType: message.mimeType,
              data: message.data,
              byteLength: message.byteLength,
            });
          }
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        fail(new EncodingTransportError(
          'WORKER_ERROR',
          event?.message ? `Encoding Worker failed: ${event.message}` : 'Encoding Worker failed.',
        ));
      };

      try {
        worker.postMessage(request, request.channels.map((channel) => channel.buffer));
      } catch (error) {
        fail(new EncodingTransportError('WORKER_ERROR', 'Could not send the encoding job to the Worker.', { cause: error }));
      }
    });
  }

  /**
   * Accepted while a job is active. Completion means the Worker has been detached,
   * terminated and the operation promise rejected as cancelled. Returns false if
   * the job already settled or no job is active.
   */
  public cancel(): boolean {
    const job = this.active;
    if (!job || job.settled) return false;
    job.settled = true;
    this.active = null;

    job.worker.onmessage = null;
    job.worker.onerror = null;
    try {
      job.worker.postMessage({ type: 'CANCEL', jobId: job.request.jobId });
    } catch {
      // Termination below is the hard cancellation guarantee.
    }
    try {
      job.worker.terminate();
    } catch {
      // The Worker may already have terminated.
    }
    job.reject(new EncodingTransportCanceledError());
    return true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
  }
}

export type { EncodingWorkerErrorCode };
