import {
  encodePcmChannelsToWavPcm16Async,
  WavPcmEncodingError,
} from './WavPcmEncoder.ts';
import {
  encodePcmToMp3,
  Mp3EncodingError,
} from './Mp3Encoder.ts';
import type {
  EncodingJobRequest,
  EncodingWorkerErrorCode,
  SessionEncodingFormat,
} from './EncodingProtocol.ts';

export interface EncodingJobHooks {
  onProgress?: (fraction: number) => void;
  isCancelled?: () => boolean;
  yieldFn?: () => Promise<void>;
}

export interface EncodingJobSuccess {
  format: SessionEncodingFormat;
  mimeType: 'audio/wav' | 'audio/mpeg';
  data: ArrayBuffer;
  byteLength: number;
}

export class EncodingJobError extends Error {
  public readonly code: EncodingWorkerErrorCode;

  public constructor(code: EncodingWorkerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = 'EncodingJobError';
  }
}

export class EncodingJobCanceledError extends EncodingJobError {
  public constructor(message = 'Encoding job was cancelled.') {
    super('CANCELED', message);
    this.name = 'EncodingJobCanceledError';
  }
}

function cancelIfNeeded(isCancelled?: () => boolean): void {
  if (isCancelled?.()) throw new EncodingJobCanceledError();
}

function toExactArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer) {
    return data.buffer;
  }
  return data.slice().buffer as ArrayBuffer;
}

function toWorkerErrorCode(code: WavPcmEncodingError['code'] | Mp3EncodingError['code']): EncodingWorkerErrorCode {
  switch (code) {
    case 'INVALID_AUDIO_BUFFER':
      return 'INVALID_AUDIO_DATA';
    case 'NON_FINITE_SAMPLE':
      return 'NON_FINITE_SAMPLE';
    case 'RIFF_SIZE_LIMIT':
    case 'MEMORY_LIMIT':
      return 'MEMORY_LIMIT';
    case 'UNSUPPORTED_CHANNELS':
      return 'UNSUPPORTED_CHANNELS';
    case 'UNSUPPORTED_SAMPLE_RATE':
      return 'UNSUPPORTED_SAMPLE_RATE';
    case 'UNSUPPORTED_BITRATE':
      return 'UNSUPPORTED_BITRATE';
    case 'ENCODER_UNAVAILABLE':
      return 'ENCODER_UNAVAILABLE';
    case 'ENCODE_FAILED':
    case 'BLOB_UNAVAILABLE':
      return 'ENCODE_FAILED';
    case 'CANCELLED':
      return 'CANCELED';
    default:
      return 'ENCODE_FAILED';
  }
}

/**
 * Shared Worker body. It contains no Worker globals so it can be executed and
 * tested deterministically in Node while the production Worker only wires messages.
 */
export async function runEncodingJob(
  request: EncodingJobRequest,
  hooks: EncodingJobHooks = {},
): Promise<EncodingJobSuccess> {
  const isCancelled = hooks.isCancelled ?? (() => false);
  let lastProgress = -1;
  const report = (fraction: number): void => {
    if (isCancelled()) return;
    const bounded = Math.max(0, Math.min(1, fraction));
    if (bounded <= lastProgress) return;
    lastProgress = bounded;
    hooks.onProgress?.(bounded);
  };

  try {
    cancelIfNeeded(isCancelled);

    if (request.format === 'wav') {
      const options = request.options as { maxFileBytes?: number };
      const bytes = await encodePcmChannelsToWavPcm16Async(
        {
          sampleRate: request.sampleRate,
          length: request.length,
          channels: request.channels,
        },
        {
          maxFileBytes: options.maxFileBytes,
          onProgress: report,
          shouldCancel: isCancelled,
          yieldFn: hooks.yieldFn,
        },
      );
      cancelIfNeeded(isCancelled);
      const data = toExactArrayBuffer(bytes);
      return { format: 'wav', mimeType: 'audio/wav', data, byteLength: data.byteLength };
    }

    const options = request.options as { maxFileBytes?: number; bitrateKbps?: number };
    const result = await encodePcmToMp3(
      {
        sampleRate: request.sampleRate,
        length: request.length,
        channels: request.channels,
      },
      {
        maxFileBytes: options.maxFileBytes,
        bitrateKbps: options.bitrateKbps,
        onProgress: report,
        shouldCancel: isCancelled,
        yieldFn: hooks.yieldFn,
      },
    );
    cancelIfNeeded(isCancelled);
    // MP3 returns a view into a bounded preallocated buffer. Transfer that buffer
    // directly and keep the actual encoded length separate to avoid a second copy.
    const data = result.data.buffer as ArrayBuffer;
    return { format: 'mp3', mimeType: 'audio/mpeg', data, byteLength: result.data.byteLength };
  } catch (error) {
    if (error instanceof EncodingJobError) throw error;
    if (error instanceof WavPcmEncodingError || error instanceof Mp3EncodingError) {
      if (error.code === 'CANCELLED') throw new EncodingJobCanceledError(error.message);
      const code = toWorkerErrorCode(error.code);
      throw new EncodingJobError(code, error.message, { cause: error });
    }
    throw new EncodingJobError(
      'ENCODE_FAILED',
      `Encoding failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
