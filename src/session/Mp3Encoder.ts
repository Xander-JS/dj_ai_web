/** Complete MP3 output ceiling. It matches the WAV ceiling; at 320 kbps a
 * 30-minute file is about 72 MB, so duration remains the tighter limit. */
export const DEFAULT_MAX_MP3_BYTES = 128 * 1024 * 1024;
export const MP3_FRAME_SAMPLES = 1152;
export const DEFAULT_MP3_BITRATE_KBPS = 192;

const MPEG1_BITRATES = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;
const MPEG2_BITRATES = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] as const;

export type Mp3MpegVersion = 1 | 2 | 2.5;

export type Mp3EncodingErrorCode =
  | 'INVALID_AUDIO_DATA'
  | 'NON_FINITE_SAMPLE'
  | 'UNSUPPORTED_CHANNELS'
  | 'UNSUPPORTED_SAMPLE_RATE'
  | 'UNSUPPORTED_BITRATE'
  | 'MEMORY_LIMIT'
  | 'ENCODER_UNAVAILABLE'
  | 'ENCODE_FAILED'
  | 'CANCELLED';

export class Mp3EncodingError extends Error {
  public readonly code: Mp3EncodingErrorCode;

  public constructor(code: Mp3EncodingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.name = 'Mp3EncodingError';
  }
}

export interface Mp3PcmInput {
  sampleRate: number;
  length: number;
  channels: Float32Array[];
}

/** Minimal lamejs encoder surface. Injectable for deterministic failure tests. */
export interface Mp3EncoderInstance {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
}

export interface Mp3EncodingOptions {
  /** Must be one of the bitrates supported for the input sample rate. */
  bitrateKbps?: number;
  /** Maximum complete MP3 byte length. */
  maxFileBytes?: number;
  /** Reports measured block progress as a fraction in [0, 1]. */
  onProgress?: (fraction: number) => void;
  /** Checked between blocks and before flush. */
  shouldCancel?: () => boolean;
  /** Yields between blocks so a Worker can process cancellation messages. */
  yieldFn?: () => Promise<void>;
  /** Yield cadence. Defaults to every 32 blocks (about 0.77 s at 48 kHz). */
  yieldEveryBlocks?: number;
  /** Test seam. Production uses the local lamejs runtime. */
  createEncoder?: (channels: number, sampleRate: number, bitrateKbps: number) => Mp3EncoderInstance;
}

export interface Mp3EncodingResult {
  data: Uint8Array;
  mimeType: 'audio/mpeg';
  sampleRate: number;
  channels: number;
  bitrateKbps: number;
  frames: number;
  durationMs: number;
}

export interface Mp3Preflight {
  bitrateKbps: number;
  maxFileBytes: number;
  upperBoundBytes: number;
  totalBlocks: number;
}

/** Standard MP3 sample rates only; no hidden resampling is performed. */
export function getMp3MpegVersion(sampleRate: number): Mp3MpegVersion | null {
  switch (sampleRate) {
    case 32_000:
    case 44_100:
    case 48_000:
      return 1;
    case 16_000:
    case 22_050:
    case 24_000:
      return 2;
    case 8_000:
    case 11_025:
    case 12_000:
      return 2.5;
    default:
      return null;
  }
}

export function getSupportedMp3Bitrates(sampleRate: number): readonly number[] {
  const version = getMp3MpegVersion(sampleRate);
  if (version === null) return [];
  return version === 1 ? MPEG1_BITRATES : MPEG2_BITRATES;
}

/**
 * Resolves and validates the bitrate before allocating or rendering. lamejs silently
 * clamps unsupported bitrates to the format maximum, so the Worker must reject them.
 */
export function resolveMp3BitrateKbps(sampleRate: number, requested?: number): number {
  const version = getMp3MpegVersion(sampleRate);
  if (version === null) {
    throw new Mp3EncodingError(
      'UNSUPPORTED_SAMPLE_RATE',
      `MP3 export supports 8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100 and 48000 Hz; received ${sampleRate}.`,
    );
  }
  const supported = getSupportedMp3Bitrates(sampleRate);
  const value = requested ?? (version === 1 ? DEFAULT_MP3_BITRATE_KBPS : 128);
  if (!Number.isInteger(value) || !supported.includes(value)) {
    throw new Mp3EncodingError(
      'UNSUPPORTED_BITRATE',
      `Bitrate ${String(requested)} kbps is not supported at ${sampleRate} Hz. Supported values: ${supported.join(', ')}.`,
    );
  }
  return value;
}

function getFrameUpperBoundBytes(version: Mp3MpegVersion, sampleRate: number, bitrateKbps: number): number {
  const coefficient = version === 1 ? 144_000 : 72_000;
  return Math.floor((coefficient * bitrateKbps) / sampleRate) + 1;
}

/**
 * Validates all MP3 parameters and computes an upper memory bound before encoding.
 * This lets orchestration reject an impossible export before an offline render.
 */
export function prepareMp3Encoding(
  sampleRate: number,
  length: number,
  numberOfChannels: number,
  bitrateKbps?: number,
  maxFileBytes: number = DEFAULT_MAX_MP3_BYTES,
): Mp3Preflight {
  const version = getMp3MpegVersion(sampleRate);
  if (version === null) {
    throw new Mp3EncodingError(
      'UNSUPPORTED_SAMPLE_RATE',
      `MP3 export supports 8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100 and 48000 Hz; received ${sampleRate}.`,
    );
  }
  if (numberOfChannels !== 1 && numberOfChannels !== 2) {
    throw new Mp3EncodingError('UNSUPPORTED_CHANNELS', 'MP3 export supports mono or stereo PCM only.');
  }
  if (!Number.isSafeInteger(length) || length <= 0) {
    throw new Mp3EncodingError('INVALID_AUDIO_DATA', 'MP3 frame count must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new Mp3EncodingError('INVALID_AUDIO_DATA', 'MP3 maximum file size must be a positive safe integer.');
  }
  if (maxFileBytes > DEFAULT_MAX_MP3_BYTES) {
    throw new Mp3EncodingError(
      'INVALID_AUDIO_DATA',
      `MP3 maximum file size cannot exceed the supported ${DEFAULT_MAX_MP3_BYTES}-byte limit.`,
    );
  }

  const resolvedBitrate = resolveMp3BitrateKbps(sampleRate, bitrateKbps);
  const totalBlocks = Math.ceil(length / MP3_FRAME_SAMPLES);
  // MPEG-2/2.5 use 576-sample Layer III frames, so an input block of 1152
  // samples may produce two encoded frames. Include encoder delay/flush frames.
  const frameCount = totalBlocks * (version === 1 ? 1 : 2) + 4;
  const upperBound = BigInt(frameCount) * BigInt(getFrameUpperBoundBytes(version, sampleRate, resolvedBitrate)) + 4n;
  if (upperBound > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Mp3EncodingError('MEMORY_LIMIT', 'MP3 output size exceeds the safe integer range.');
  }
  const upperBoundBytes = Number(upperBound);
  if (upperBoundBytes > maxFileBytes) {
    throw new Mp3EncodingError(
      'MEMORY_LIMIT',
      `MP3 output exceeds the configured ${maxFileBytes}-byte limit (estimated upper bound ${upperBoundBytes} bytes).`,
    );
  }

  return { bitrateKbps: resolvedBitrate, maxFileBytes, upperBoundBytes, totalBlocks };
}

function toInt16Block(
  source: Float32Array,
  from: number,
  to: number,
  channel: number,
): Int16Array {
  const block = new Int16Array(to - from);
  for (let index = from; index < to; index += 1) {
    const sample = source[index];
    if (!Number.isFinite(sample)) {
      throw new Mp3EncodingError(
        'NON_FINITE_SAMPLE',
        `PCM contains a non-finite sample at channel ${channel}, frame ${index}.`,
      );
    }
    const clamped = Math.max(-1, Math.min(1, sample));
    const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    block[index - from] = Math.round(scaled);
  }
  return block;
}

function hasMp3FrameSync(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
}

function cancelled(): never {
  throw new Mp3EncodingError('CANCELLED', 'MP3 encoding was cancelled.');
}

/**
 * Encodes float PCM to MP3 in fixed 1152-sample blocks. The library's internal
 * output buffer is reused, so each returned chunk is copied immediately into one
 * preflight-sized output buffer. The final `flush()` bytes are included as well.
 */
export async function encodePcmToMp3(
  input: Mp3PcmInput,
  options: Mp3EncodingOptions = {},
): Promise<Mp3EncodingResult> {
  if (!input || typeof input !== 'object' || !Array.isArray(input.channels)) {
    throw new Mp3EncodingError('INVALID_AUDIO_DATA', 'MP3 input must provide a channel array.');
  }
  const { sampleRate, length, channels } = input;
  if (channels.length !== 1 && channels.length !== 2) {
    throw new Mp3EncodingError('UNSUPPORTED_CHANNELS', 'MP3 export supports mono or stereo PCM only.');
  }
  for (let channel = 0; channel < channels.length; channel += 1) {
    if (!(channels[channel] instanceof Float32Array) || channels[channel].length !== length) {
      throw new Mp3EncodingError(
        'INVALID_AUDIO_DATA',
        `MP3 channel ${channel} must be a Float32Array of exactly ${length} samples.`,
      );
    }
  }

  const preflight = prepareMp3Encoding(
    sampleRate,
    length,
    channels.length,
    options.bitrateKbps,
    options.maxFileBytes ?? DEFAULT_MAX_MP3_BYTES,
  );
  const yieldFn = options.yieldFn ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const yieldEveryBlocks = options.yieldEveryBlocks ?? 32;
  if (!Number.isSafeInteger(yieldEveryBlocks) || yieldEveryBlocks <= 0) {
    throw new Mp3EncodingError('INVALID_AUDIO_DATA', 'MP3 yield cadence must be a positive safe integer.');
  }

  if (options.shouldCancel?.()) cancelled();

  let encoder: Mp3EncoderInstance;
  if (options.createEncoder) {
    try {
      encoder = options.createEncoder(channels.length, sampleRate, preflight.bitrateKbps);
    } catch (error) {
      throw new Mp3EncodingError('ENCODER_UNAVAILABLE', 'Could not initialize the MP3 encoder.', { cause: error });
    }
  } else {
    let runtime: typeof import('./LamejsRuntime.ts');
    try {
      runtime = await import('./LamejsRuntime.ts');
    } catch (error) {
      throw new Mp3EncodingError('ENCODER_UNAVAILABLE', 'Could not load the lamejs MP3 encoder.', { cause: error });
    }

    try {
      encoder = new runtime.lamejs.Mp3Encoder(channels.length, sampleRate, preflight.bitrateKbps);
    } catch (error) {
      throw new Mp3EncodingError('ENCODER_UNAVAILABLE', 'Could not initialize the lamejs MP3 encoder.', { cause: error });
    }
  }

  const output = new Uint8Array(preflight.upperBoundBytes);
  let totalBytes = 0;
  const append = (encoded: Int8Array): void => {
    // `encodeBuffer`/`flush` return a view over lamejs' reusable internal buffer.
    if (encoded.length === 0) return;
    if (totalBytes + encoded.length > preflight.maxFileBytes || totalBytes + encoded.length > output.length) {
      throw new Mp3EncodingError(
        'MEMORY_LIMIT',
        `MP3 output exceeds the configured ${preflight.maxFileBytes}-byte limit.`,
      );
    }
    output.set(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength), totalBytes);
    totalBytes += encoded.length;
  };

  for (let block = 0; block < preflight.totalBlocks; block += 1) {
    if (options.shouldCancel?.()) cancelled();
    const from = block * MP3_FRAME_SAMPLES;
    const to = Math.min(length, from + MP3_FRAME_SAMPLES);
    const left = toInt16Block(channels[0], from, to, 0);
    const right = channels.length === 2 ? toInt16Block(channels[1], from, to, 1) : undefined;

    let encoded: Int8Array;
    try {
      encoded = right ? encoder.encodeBuffer(left, right) : encoder.encodeBuffer(left);
    } catch (error) {
      throw new Mp3EncodingError('ENCODE_FAILED', 'lamejs failed while encoding PCM blocks.', { cause: error });
    }
    append(encoded);
    options.onProgress?.(((block + 1) / preflight.totalBlocks) * 0.98);

    if ((block + 1) % yieldEveryBlocks === 0 && block + 1 < preflight.totalBlocks) {
      await yieldFn();
    }
  }

  if (options.shouldCancel?.()) cancelled();
  let flushed: Int8Array;
  try {
    flushed = encoder.flush();
  } catch (error) {
    throw new Mp3EncodingError('ENCODE_FAILED', 'lamejs failed while finalizing the MP3 stream.', { cause: error });
  }
  append(flushed);

  if (totalBytes === 0) {
    throw new Mp3EncodingError('ENCODE_FAILED', 'lamejs produced no MP3 data.');
  }

  const data = output.subarray(0, totalBytes);

  if (!hasMp3FrameSync(data)) {
    throw new Mp3EncodingError('ENCODE_FAILED', 'Encoded output does not start with an MP3 frame sync.');
  }

  options.onProgress?.(1);
  return {
    data,
    mimeType: 'audio/mpeg',
    sampleRate,
    channels: channels.length,
    bitrateKbps: preflight.bitrateKbps,
    frames: length,
    durationMs: (length / sampleRate) * 1000,
  };
}
