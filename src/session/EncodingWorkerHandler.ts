import {
  parseEncodingWorkerRequest,
  type EncodingWorkerResponse,
} from './EncodingProtocol.ts';
import {
  EncodingJobCanceledError,
  EncodingJobError,
  runEncodingJob,
} from './EncodingJobRunner.ts';

export interface WorkerMessageEventLike {
  data: unknown;
}

export interface EncodingWorkerHandlerOptions {
  /** Injected by tests to make yields deterministic. */
  yieldFn?: () => Promise<void>;
}

export interface EncodingWorkerPost {
  (message: EncodingWorkerResponse, transfer?: Transferable[]): void;
}

/**
 * Message dispatcher used by the real Worker and by deterministic tests.
 *
 * Only one encoding job runs per Worker instance. A cancel request marks the active
 * job; the runner checks it between blocks, so no late result is posted. The main
 * thread additionally terminates the Worker on cancellation as a hard guarantee.
 */
export function createEncodingWorkerHandler(
  post: EncodingWorkerPost,
  options: EncodingWorkerHandlerOptions = {},
): (event: WorkerMessageEventLike) => void {
  let activeJobId: string | null = null;
  const canceledJobs = new Set<string>();

  const safePost = (message: EncodingWorkerResponse, transfer?: Transferable[]): void => {
    try {
      if (transfer) post(message, transfer);
      else post(message);
    } catch {
      // The main thread may already have terminated the Worker. There is no
      // remaining channel to report this failure and no result must be emitted.
    }
  };

  return (event: WorkerMessageEventLike): void => {
    const parsed = parseEncodingWorkerRequest(event.data);
    if (!parsed.ok) {
      safePost({
        type: 'ERROR',
        jobId: parsed.jobId,
        code: 'INVALID_MESSAGE',
        message: parsed.message,
      });
      return;
    }

    if (parsed.request.type === 'CANCEL') {
      if (activeJobId === parsed.request.jobId) {
        canceledJobs.add(parsed.request.jobId);
      }
      return;
    }

    if (activeJobId !== null) {
      safePost({
        type: 'ERROR',
        jobId: parsed.request.jobId,
        code: 'BUSY',
        message: `Worker is already encoding job ${activeJobId}.`,
      });
      return;
    }

    const job = parsed.request;
    activeJobId = job.jobId;
    const isCancelled = () => canceledJobs.has(job.jobId);

    void (async () => {
      try {
        const result = await runEncodingJob(job, {
          isCancelled,
          yieldFn: options.yieldFn,
          onProgress: (progress) => {
            if (isCancelled()) return;
            safePost({ type: 'PROGRESS', jobId: job.jobId, progress });
          },
        });

        if (isCancelled()) {
          safePost({ type: 'CANCELED', jobId: job.jobId });
          return;
        }

        safePost({
          type: 'ENCODED',
          jobId: job.jobId,
          format: result.format,
          mimeType: result.mimeType,
          data: result.data,
          byteLength: result.byteLength,
        }, [result.data]);
      } catch (error) {
        if (isCancelled() || error instanceof EncodingJobCanceledError) {
          safePost({ type: 'CANCELED', jobId: job.jobId });
          return;
        }
        const code = error instanceof EncodingJobError ? error.code : 'ENCODE_FAILED';
        safePost({
          type: 'ERROR',
          jobId: job.jobId,
          code,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        canceledJobs.delete(job.jobId);
        if (activeJobId === job.jobId) activeJobId = null;
      }
    })();
  };
}
