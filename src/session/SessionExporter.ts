import {
  renderSessionOffline,
  SessionRenderError,
  type OfflineSessionRenderOptions,
  type SessionBufferResolver,
} from './OfflineSessionRenderer.ts';
import type { RecordedSession } from './SessionRecorder.ts';
import {
  DEFAULT_MAX_WAV_BYTES,
  getWavPcm16FileBytes,
  WavPcmEncodingError,
  type WavPcmEncodingOptions,
} from './WavPcmEncoder.ts';
import {
  DEFAULT_MAX_MP3_BYTES,
  Mp3EncodingError,
  prepareMp3Encoding,
  resolveMp3BitrateKbps,
} from './Mp3Encoder.ts';
import {
  EncodingTransportCanceledError,
  EncodingTransportError,
  EncodingWorkerClient,
  type EncodingTransport,
} from './EncodingWorkerClient.ts';
import type { EncodingJobRequest, SessionEncodingFormat } from './EncodingProtocol.ts';

export type SessionExportPhase = 'preparing' | 'rendering' | 'encoding' | 'finalizing';

export interface SessionExportProgress {
  phase: SessionExportPhase;
  /** Measured progress in [0, 100], or null when the current work cannot be measured. */
  percent: number | null;
  /** True when the phase cannot report measured sub-progress. */
  indeterminate: boolean;
}

export type SessionExportErrorCode =
  | 'INVALID_REQUEST'
  | 'RENDER_FAILED'
  | 'ENCODE_FAILED'
  | 'RESOURCE_LIMIT'
  | 'WORKER_UNAVAILABLE'
  | 'BLOB_UNAVAILABLE'
  | 'CANCELED';

export class SessionExportError extends Error {
  public readonly code: SessionExportErrorCode;
  public readonly phase: SessionExportPhase;

  public constructor(
    code: SessionExportErrorCode,
    message: string,
    phase: SessionExportPhase,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.phase = phase;
    this.name = 'SessionExportError';
  }
}

export class SessionExportCanceledError extends SessionExportError {
  public constructor(phase: SessionExportPhase, message = 'Session export was cancelled.') {
    super('CANCELED', message, phase);
    this.name = 'SessionExportCanceledError';
  }
}

export interface SessionExportRequest {
  session: RecordedSession;
  resolveBuffer: SessionBufferResolver;
  format: SessionEncodingFormat;
  /** Crop/end override and render sample rate. Memory limits are not overridable. */
  render?: Pick<OfflineSessionRenderOptions, 'durationMs' | 'sampleRate'>;
  wav?: WavPcmEncodingOptions;
  mp3?: {
    bitrateKbps?: number;
    maxFileBytes?: number;
  };
}

export interface SessionExportOptions {
  onProgress?: (progress: SessionExportProgress) => void;
  /** Deterministic injection for tests and non-browser hosts. */
  renderSession?: typeof renderSessionOffline;
  /** One transport per export. The default is a fresh ESM Worker. */
  createEncodingTransport?: () => EncodingTransport;
  createJobId?: () => string;
}

export interface SessionExportResult {
  status: 'completed';
  format: SessionEncodingFormat;
  blob: Blob;
  mimeType: 'audio/wav' | 'audio/mpeg';
  byteLength: number;
  durationMs: number;
  sampleRate: number;
  channels: number;
  bitrateKbps?: number;
}

export interface SessionExportHandle {
  /** Resolves only for a completed export. Rejects with a typed error otherwise. */
  result: Promise<SessionExportResult>;
  /** Resolves when rendering/encoding has actually stopped and temporary resources are released. */
  finished: Promise<void>;
  /** Returns true when the request was accepted while the job was still running. */
  cancel(): boolean;
  readonly progress: SessionExportProgress;
}

let fallbackJobId = 0;

function createJobId(): string {
  fallbackJobId += 1;
  return `session-export-${Date.now().toString(36)}-${fallbackJobId}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveConfiguredMax(value: number | undefined, fallback: number, label: string): number {
  const max = value ?? fallback;
  if (!Number.isSafeInteger(max) || max <= 0) {
    throw new SessionExportError('INVALID_REQUEST', `${label} must be a positive safe integer.`, 'preparing');
  }
  if (max > fallback) {
    throw new SessionExportError(
      'INVALID_REQUEST',
      `${label} cannot exceed the supported ${fallback}-byte limit.`,
      'preparing',
    );
  }
  return max;
}

function resolveRenderSampleRate(request: SessionExportRequest): number {
  const sampleRate = request.render?.sampleRate ?? 48_000;
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new SessionExportError(
      'INVALID_REQUEST',
      'Render sample rate must be an integer between 8000 and 192000 Hz.',
      'preparing',
    );
  }
  return sampleRate;
}

function checkEstimatedLimits(
  request: SessionExportRequest,
  sampleRate: number,
  frames: number,
): { wavMaxBytes: number; mp3MaxBytes: number; mp3BitrateKbps?: number } {
  const wavMaxBytes = resolveConfiguredMax(request.wav?.maxFileBytes, DEFAULT_MAX_WAV_BYTES, 'WAV maximum file size');
  const mp3MaxBytes = resolveConfiguredMax(request.mp3?.maxFileBytes, DEFAULT_MAX_MP3_BYTES, 'MP3 maximum file size');

  if (request.format === 'wav') {
    getWavPcm16FileBytes(sampleRate, frames, 2, wavMaxBytes);
  } else {
    prepareMp3Encoding(sampleRate, frames, 2, request.mp3?.bitrateKbps, mp3MaxBytes);
  }
  return {
    wavMaxBytes,
    mp3MaxBytes,
    mp3BitrateKbps: request.format === 'mp3'
      ? resolveMp3BitrateKbps(sampleRate, request.mp3?.bitrateKbps)
      : undefined,
  };
}

function readRenderedChannels(buffer: AudioBuffer): Float32Array[] {
  if (!buffer || typeof buffer !== 'object' || typeof buffer.getChannelData !== 'function') {
    throw new SessionExportError('RENDER_FAILED', 'The renderer did not return an AudioBuffer.', 'rendering');
  }
  if (buffer.numberOfChannels !== 1 && buffer.numberOfChannels !== 2) {
    throw new SessionExportError('RENDER_FAILED', 'Export supports mono or stereo render results only.', 'rendering');
  }
  if (!Number.isSafeInteger(buffer.length) || buffer.length <= 0) {
    throw new SessionExportError('RENDER_FAILED', 'The rendered buffer has an invalid frame count.', 'rendering');
  }
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    let data: Float32Array;
    try {
      data = buffer.getChannelData(channel);
    } catch (error) {
      throw new SessionExportError('RENDER_FAILED', `Could not read rendered channel ${channel}.`, 'rendering', { cause: error });
    }
    if (!(data instanceof Float32Array) || data.length !== buffer.length) {
      throw new SessionExportError(
        'RENDER_FAILED',
        `Rendered channel ${channel} does not contain exactly ${buffer.length} samples.`,
        'rendering',
      );
    }
    channels.push(data);
  }

  // Transferring the same ArrayBuffer twice throws. In that unusual case, copy each
  // channel so the Worker still receives independent, transferable buffers.
  const buffers = new Set(channels.map((channel) => channel.buffer));
  if (buffers.size !== channels.length) return channels.map((channel) => channel.slice());
  return channels;
}

function mapError(error: unknown, phase: SessionExportPhase): SessionExportError {
  if (error instanceof SessionExportError) return error;
  if (error instanceof EncodingTransportCanceledError) return new SessionExportCanceledError(phase);
  if (error instanceof SessionRenderError) {
    const code = error.code === 'RESOURCE_LIMIT' ? 'RESOURCE_LIMIT' : 'RENDER_FAILED';
    return new SessionExportError(code, error.message, phase, { cause: error });
  }
  if (error instanceof WavPcmEncodingError) {
    const code = error.code === 'MEMORY_LIMIT' || error.code === 'RIFF_SIZE_LIMIT'
      ? 'RESOURCE_LIMIT'
      : error.code === 'CANCELLED'
        ? 'CANCELED'
        : 'INVALID_REQUEST';
    return code === 'CANCELED'
      ? new SessionExportCanceledError(phase)
      : new SessionExportError(code, error.message, phase, { cause: error });
  }
  if (error instanceof Mp3EncodingError) {
    const code = error.code === 'MEMORY_LIMIT' ? 'RESOURCE_LIMIT' : 'INVALID_REQUEST';
    return error.code === 'CANCELLED'
      ? new SessionExportCanceledError(phase)
      : new SessionExportError(code, error.message, phase, { cause: error });
  }
  if (error instanceof EncodingTransportError) {
    const code = error.code === 'WORKER_UNAVAILABLE'
      ? 'WORKER_UNAVAILABLE'
      : error.code === 'INVALID_REQUEST'
        ? 'INVALID_REQUEST'
        : 'ENCODE_FAILED';
    return new SessionExportError(code, error.message, phase, { cause: error });
  }
  if (error instanceof Error && error.name === 'EncodingTransportCanceledError') {
    return new SessionExportCanceledError(phase);
  }
  return new SessionExportError(
    phase === 'rendering' ? 'RENDER_FAILED' : 'ENCODE_FAILED',
    `Session export failed: ${error instanceof Error ? error.message : String(error)}`,
    phase,
    { cause: error },
  );
}

/**
 * Orchestrates an already-recorded session through the existing renderer and an
 * off-main-thread encoder. Only `renderSessionOffline` renders; the Worker encodes.
 */
export function startSessionExport(
  request: SessionExportRequest,
  options: SessionExportOptions = {},
): SessionExportHandle {
  let canceled = false;
  let settled = false;
  let phase: SessionExportPhase = 'preparing';
  let progress: SessionExportProgress = { phase, percent: 0, indeterminate: true };
  let lastMeasuredPercent = 0;
  let transport: EncodingTransport | null = null;
  let rejectCancellation: ((reason: SessionExportCanceledError) => void) | null = null;

  const cancellation = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });

  const emit = (nextPhase: SessionExportPhase, percent: number | null, indeterminate: boolean): void => {
    if (canceled || settled) return;
    let bounded: number | null = null;
    if (percent !== null) {
      bounded = Math.max(lastMeasuredPercent, Math.min(100, Math.max(0, percent)));
      lastMeasuredPercent = bounded;
    }
    phase = nextPhase;
    progress = { phase, percent: bounded, indeterminate };
    options.onProgress?.(progress);
  };

  const run = async (): Promise<SessionExportResult> => {
    const render = options.renderSession ?? renderSessionOffline;
    const jobIdFactory = options.createJobId ?? createJobId;

    emit('preparing', 0, true);
    if (canceled) throw new SessionExportCanceledError('preparing');
    if (!request || typeof request !== 'object' || !request.session || typeof request.resolveBuffer !== 'function') {
      throw new SessionExportError('INVALID_REQUEST', 'A finalized session and a buffer resolver are required.', 'preparing');
    }
    if (request.format !== 'wav' && request.format !== 'mp3') {
      throw new SessionExportError('INVALID_REQUEST', 'Export format must be "wav" or "mp3".', 'preparing');
    }
    if (typeof request.session.durationMs !== 'number' || !Number.isFinite(request.session.durationMs) || request.session.durationMs <= 0) {
      throw new SessionExportError('INVALID_REQUEST', 'A finalized session duration greater than zero is required.', 'preparing');
    }

    const sampleRate = resolveRenderSampleRate(request);
    const requestedDurationMs = request.render?.durationMs ?? request.session.durationMs;
    if (!Number.isFinite(requestedDurationMs) || requestedDurationMs <= 0) {
      throw new SessionExportError('INVALID_REQUEST', 'Render duration must be finite and greater than zero.', 'preparing');
    }
    if (requestedDurationMs > request.session.durationMs) {
      throw new SessionExportError('INVALID_REQUEST', 'Render duration cannot exceed the finalized session duration.', 'preparing');
    }
    const estimatedFrames = Math.ceil((requestedDurationMs / 1000) * sampleRate);
    const limits = checkEstimatedLimits(request, sampleRate, estimatedFrames);
    if (canceled) throw new SessionExportCanceledError('preparing');

    // Give the caller a chance to cancel after startSessionExport() returns but
    // before any OfflineAudioContext work begins.
    await Promise.resolve();
    if (canceled) throw new SessionExportCanceledError('preparing');

    emit('rendering', null, true);
    const renderResult = await render(request.session, request.resolveBuffer, {
      durationMs: request.render?.durationMs,
      sampleRate: request.render?.sampleRate,
    });
    if (canceled) throw new SessionExportCanceledError('rendering');

    const buffer = renderResult.buffer;
    const channels = readRenderedChannels(buffer);
    const renderedSampleRate = renderResult.sampleRate ?? buffer.sampleRate;
    const renderedFrames = buffer.length;
    if (renderedSampleRate !== sampleRate) {
      throw new SessionExportError(
        'RENDER_FAILED',
        `Renderer returned ${renderedSampleRate} Hz instead of the requested ${sampleRate} Hz.`,
        'rendering',
      );
    }

    // Re-check with real dimensions: a renderer must not be trusted to respect limits.
    if (request.format === 'wav') {
      getWavPcm16FileBytes(renderedSampleRate, renderedFrames, channels.length, limits.wavMaxBytes);
    } else {
      prepareMp3Encoding(
        renderedSampleRate,
        renderedFrames,
        channels.length,
        request.mp3?.bitrateKbps,
        limits.mp3MaxBytes,
      );
    }
    if (canceled) throw new SessionExportCanceledError('rendering');
    if (typeof Blob === 'undefined') {
      throw new SessionExportError('BLOB_UNAVAILABLE', 'Blob is not available in this environment.', 'encoding');
    }

    const encodingRequest: EncodingJobRequest = {
      type: 'ENCODE',
      jobId: jobIdFactory(),
      format: request.format,
      sampleRate: renderedSampleRate,
      length: renderedFrames,
      channels,
      options: request.format === 'wav'
        ? { maxFileBytes: limits.wavMaxBytes }
        : { maxFileBytes: limits.mp3MaxBytes, bitrateKbps: request.mp3?.bitrateKbps },
    };

    emit('encoding', 0, false);
    if (canceled) throw new SessionExportCanceledError('encoding');
    transport = (options.createEncodingTransport ?? (() => new EncodingWorkerClient()))();
    const encoded = await transport.encode(encodingRequest, (fraction) => {
      if (!Number.isFinite(fraction)) return;
      emit('encoding', Math.max(0, Math.min(1, fraction)) * 100, false);
    });
    if (canceled) throw new SessionExportCanceledError('encoding');
    if (!(encoded.data instanceof ArrayBuffer) || encoded.byteLength <= 0 || encoded.byteLength > encoded.data.byteLength) {
      throw new SessionExportError('ENCODE_FAILED', 'Encoder returned an invalid or empty result.', 'encoding');
    }

    emit('finalizing', null, true);
    const blob = new Blob([new Uint8Array(encoded.data, 0, encoded.byteLength)], { type: encoded.mimeType });
    if (blob.size !== encoded.byteLength) {
      throw new SessionExportError('ENCODE_FAILED', 'The final Blob size does not match the encoded byte length.', 'finalizing');
    }
    if (canceled) throw new SessionExportCanceledError('finalizing');

    emit('finalizing', 100, false);
    if (canceled) throw new SessionExportCanceledError('finalizing');

    // The operation is committed: later cancel() calls must report false.
    settled = true;
    return {
      status: 'completed',
      format: encoded.format,
      blob,
      mimeType: encoded.mimeType,
      byteLength: encoded.byteLength,
      durationMs: buffer.duration * 1000,
      sampleRate: renderedSampleRate,
      channels: channels.length,
      bitrateKbps: request.format === 'mp3' ? limits.mp3BitrateKbps : undefined,
    };
  };

  const operation = run().finally(() => {
    settled = true;
    rejectCancellation = null;
    if (transport) {
      transport.dispose();
      transport = null;
    }
  });
  const finished = operation.then(() => undefined, () => undefined);
  const result = Promise.race([operation, cancellation]).catch((error: unknown) => {
    throw mapError(error, phase);
  });

  return {
    result,
    finished,
    cancel(): boolean {
      if (settled || canceled) return false;
      canceled = true;
      transport?.cancel();
      rejectCancellation?.(new SessionExportCanceledError(phase));
      return true;
    },
    get progress(): SessionExportProgress {
      return progress;
    },
  };
}
