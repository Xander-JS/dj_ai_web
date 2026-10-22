import type { WavPcmEncodingOptions } from './WavPcmEncoder.ts';
import type { Mp3EncodingOptions } from './Mp3Encoder.ts';

export type SessionEncodingFormat = 'wav' | 'mp3';

export interface WavEncodingJobOptions extends WavPcmEncodingOptions {
  maxFileBytes?: number;
}

export interface Mp3EncodingJobOptions extends Pick<Mp3EncodingOptions, 'maxFileBytes' | 'bitrateKbps'> {
  maxFileBytes?: number;
  bitrateKbps?: number;
}

export interface EncodingJobRequest {
  type: 'ENCODE';
  jobId: string;
  format: SessionEncodingFormat;
  sampleRate: number;
  length: number;
  /** On successful Worker postMessage, each backing ArrayBuffer transfers to the Worker and detaches here. */
  channels: Float32Array[];
  options: WavEncodingJobOptions | Mp3EncodingJobOptions;
}

export interface CancelEncodingRequest {
  type: 'CANCEL';
  jobId: string;
}

export type EncodingWorkerRequest = EncodingJobRequest | CancelEncodingRequest;

export type EncodingWorkerErrorCode =
  | 'INVALID_MESSAGE'
  | 'INVALID_AUDIO_DATA'
  | 'NON_FINITE_SAMPLE'
  | 'UNSUPPORTED_CHANNELS'
  | 'UNSUPPORTED_SAMPLE_RATE'
  | 'UNSUPPORTED_BITRATE'
  | 'MEMORY_LIMIT'
  | 'ENCODER_UNAVAILABLE'
  | 'ENCODE_FAILED'
  | 'CANCELED'
  | 'BUSY';

export interface EncodingProgressMessage {
  type: 'PROGRESS';
  jobId: string;
  /** Encoded fraction in [0, 1]. */
  progress: number;
}

export interface EncodingCompleteMessage {
  type: 'ENCODED';
  jobId: string;
  format: SessionEncodingFormat;
  mimeType: 'audio/wav' | 'audio/mpeg';
  /** Transferable backing buffer; only the first `byteLength` bytes are payload. */
  data: ArrayBuffer;
  byteLength: number;
}

export interface EncodingErrorMessage {
  type: 'ERROR';
  jobId: string | null;
  code: EncodingWorkerErrorCode;
  message: string;
}

export interface EncodingCanceledMessage {
  type: 'CANCELED';
  jobId: string;
}

export type EncodingWorkerResponse =
  | EncodingProgressMessage
  | EncodingCompleteMessage
  | EncodingErrorMessage
  | EncodingCanceledMessage;

export interface ParseRequestSuccess {
  ok: true;
  request: EncodingWorkerRequest;
}

export interface ParseRequestFailure {
  ok: false;
  jobId: string | null;
  message: string;
}

export type ParseRequestResult = ParseRequestSuccess | ParseRequestFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isOptionalSafeSize(value: unknown, minimum: number): boolean {
  return value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum);
}

function isOptionalBitrate(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

/**
 * Validates the Worker boundary. Messages from another version, a stale operation
 * or a malformed caller must never reach an encoder or crash the Worker.
 */
export function parseEncodingWorkerRequest(value: unknown): ParseRequestResult {
  if (!isRecord(value)) {
    return { ok: false, jobId: null, message: 'Worker message must be an object.' };
  }
  if (typeof value.jobId !== 'string' || value.jobId.length === 0 || value.jobId.length > 200) {
    return { ok: false, jobId: null, message: 'Worker message requires a non-empty jobId of at most 200 characters.' };
  }
  const jobId = value.jobId;

  if (value.type === 'CANCEL') {
    return { ok: true, request: { type: 'CANCEL', jobId } };
  }
  if (value.type !== 'ENCODE') {
    return { ok: false, jobId, message: `Unknown Worker message type: ${String(value.type)}.` };
  }
  if (value.format !== 'wav' && value.format !== 'mp3') {
    return { ok: false, jobId, message: 'Encoding format must be "wav" or "mp3".' };
  }
  if (typeof value.sampleRate !== 'number' || !Number.isInteger(value.sampleRate) || value.sampleRate <= 0) {
    return { ok: false, jobId, message: 'Encoding sample rate must be a positive integer.' };
  }
  if (typeof value.length !== 'number' || !Number.isSafeInteger(value.length) || value.length <= 0) {
    return { ok: false, jobId, message: 'Encoding frame count must be a positive safe integer.' };
  }
  if (!Array.isArray(value.channels) || value.channels.length < 1 || value.channels.length > 2) {
    return { ok: false, jobId, message: 'Encoding requires one or two channel arrays.' };
  }
  for (let channel = 0; channel < value.channels.length; channel += 1) {
    const samples = value.channels[channel];
    if (!(samples instanceof Float32Array) || samples.length !== value.length) {
      return { ok: false, jobId, message: `Encoding channel ${channel} must be a Float32Array of exactly ${value.length} samples.` };
    }
  }
  if (!isRecord(value.options)) {
    return { ok: false, jobId, message: 'Encoding options must be an object.' };
  }
  if (!isOptionalSafeSize(value.options.maxFileBytes, 1)) {
    return { ok: false, jobId, message: 'maxFileBytes must be a positive safe integer when provided.' };
  }
  if (value.format === 'mp3' && !isOptionalBitrate(value.options.bitrateKbps)) {
    return { ok: false, jobId, message: 'bitrateKbps must be a positive integer when provided.' };
  }

  return {
    ok: true,
    request: {
      type: 'ENCODE',
      jobId,
      format: value.format,
      sampleRate: value.sampleRate,
      length: value.length,
      channels: value.channels as Float32Array[],
      options: value.format === 'wav'
        ? { maxFileBytes: value.options.maxFileBytes as number | undefined }
        : {
            maxFileBytes: value.options.maxFileBytes as number | undefined,
            bitrateKbps: value.options.bitrateKbps as number | undefined,
          },
    },
  };
}
