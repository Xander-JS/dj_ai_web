/** Maximum complete WAV size. At stereo S16LE/48 kHz this matches the renderer's
 * 256 MiB Float32 limit for the same duration, while leaving room for the RIFF header. */
export const DEFAULT_MAX_WAV_BYTES = 128 * 1024 * 1024;

export const WAV_RIFF_HEADER_BYTES = 44;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_FORMAT_CODE = 1;
const BITS_PER_SAMPLE = 16;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffff_ffff;

export type WavPcmEncodingErrorCode =
  | 'INVALID_AUDIO_BUFFER'
  | 'NON_FINITE_SAMPLE'
  | 'RIFF_SIZE_LIMIT'
  | 'MEMORY_LIMIT'
  | 'BLOB_UNAVAILABLE'
  | 'CANCELLED';

export class WavPcmEncodingError extends Error {
  public readonly code: WavPcmEncodingErrorCode;

  public constructor(code: WavPcmEncodingErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'WavPcmEncodingError';
  }
}

export interface WavPcmEncodingOptions {
  /** Maximum complete RIFF/WAVE file size, including its 44-byte header. */
  maxFileBytes?: number;
}

/** Raw interleaved-by-channel PCM input. Channel arrays are read, never modified or detached. */
export interface WavPcmChannels {
  sampleRate: number;
  length: number;
  channels: Float32Array[];
}

export interface WavPcmAsyncEncodingOptions extends WavPcmEncodingOptions {
  /** Reports measured progress as a fraction in [0, 1]. */
  onProgress?: (fraction: number) => void;
  /** Checked between blocks; the caller must discard the partial result. */
  shouldCancel?: () => boolean;
  /** Yields between blocks so a Worker can process cancellation messages. */
  yieldFn?: () => Promise<void>;
  /** Frames written between yields. Defaults to 16384 (about 341 ms at 48 kHz). */
  blockFrames?: number;
}

interface ValidatedPcmDimensions {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  dataBytes: number;
  fileBytes: number;
  byteRate: number;
  blockAlign: number;
}

interface ValidatedPcm extends ValidatedPcmDimensions {
  channels: Float32Array[];
}

function invalid(message: string): never {
  throw new WavPcmEncodingError('INVALID_AUDIO_BUFFER', message);
}

function validatePcmDimensions(
  sampleRate: number,
  length: number,
  numberOfChannels: number,
  maxFileBytes: number,
): ValidatedPcmDimensions {
  if (!Number.isInteger(numberOfChannels) || numberOfChannels <= 0 || numberOfChannels > UINT16_MAX) {
    invalid('AudioBuffer channel count must be a positive 16-bit integer.');
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > UINT32_MAX) {
    invalid('AudioBuffer sample rate must be a positive 32-bit integer.');
  }
  if (!Number.isSafeInteger(length) || length <= 0) {
    invalid('AudioBuffer frame count must be a positive safe integer.');
  }

  const blockAlign = numberOfChannels * PCM_BYTES_PER_SAMPLE;
  if (blockAlign > UINT16_MAX) invalid('PCM block alignment exceeds the WAV format limit.');
  const byteRateBig = BigInt(sampleRate) * BigInt(blockAlign);
  if (byteRateBig > BigInt(UINT32_MAX)) invalid('PCM byte rate exceeds the WAV format limit.');

  const dataBytesBig = BigInt(length) * BigInt(blockAlign);
  const fileBytesBig = BigInt(WAV_RIFF_HEADER_BYTES) + dataBytesBig;
  const riffSizeBig = fileBytesBig - 8n;
  if (dataBytesBig > BigInt(UINT32_MAX) || riffSizeBig > BigInt(UINT32_MAX)
    || fileBytesBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new WavPcmEncodingError('RIFF_SIZE_LIMIT', 'AudioBuffer is too large for a classic RIFF/WAVE file.');
  }
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < WAV_RIFF_HEADER_BYTES) {
    invalid('WAV maximum file size must be a safe integer of at least 44 bytes.');
  }
  if (maxFileBytes > DEFAULT_MAX_WAV_BYTES) {
    invalid(`WAV maximum file size cannot exceed the supported ${DEFAULT_MAX_WAV_BYTES}-byte limit.`);
  }
  if (fileBytesBig > BigInt(maxFileBytes)) {
    throw new WavPcmEncodingError('MEMORY_LIMIT', `WAV output exceeds the configured ${maxFileBytes}-byte limit.`);
  }

  return {
    numberOfChannels,
    sampleRate,
    length,
    dataBytes: Number(dataBytesBig),
    fileBytes: Number(fileBytesBig),
    byteRate: Number(byteRateBig),
    blockAlign,
  };
}

/**
 * Computes the complete RIFF/WAVE size without allocating it. Useful to reject an
 * export before rendering when the configured limit cannot be met.
 */
export function getWavPcm16FileBytes(
  sampleRate: number,
  length: number,
  numberOfChannels: number,
  maxFileBytes: number = DEFAULT_MAX_WAV_BYTES,
): number {
  return validatePcmDimensions(sampleRate, length, numberOfChannels, maxFileBytes).fileBytes;
}

function validatePcmChannels(
  input: WavPcmChannels,
  maxFileBytes: number,
  checkFinite: boolean,
): ValidatedPcm {
  if (!input || typeof input !== 'object' || !Array.isArray(input.channels)) {
    invalid('PCM input must provide a channel array.');
  }
  const { sampleRate, length, channels } = input;
  const dimensions = validatePcmDimensions(sampleRate, length, channels.length, maxFileBytes);
  if (!Number.isSafeInteger(length) || length <= 0) invalid('PCM frame count must be a positive safe integer.');

  for (let channel = 0; channel < channels.length; channel += 1) {
    const samples = channels[channel];
    if (!(samples instanceof Float32Array) || samples.length !== length) {
      invalid(`PCM channel ${channel} does not contain exactly ${length} Float32 samples.`);
    }
    if (checkFinite) {
      for (let frame = 0; frame < samples.length; frame += 1) {
        if (!Number.isFinite(samples[frame])) {
          throw new WavPcmEncodingError(
            'NON_FINITE_SAMPLE',
            `AudioBuffer contains a non-finite sample at channel ${channel}, frame ${frame}.`,
          );
        }
      }
    }
  }

  return { ...dimensions, channels };
}

function validateAndReadAudioBuffer(audioBuffer: AudioBuffer, maxFileBytes: number): ValidatedPcm {
  if (!audioBuffer || typeof audioBuffer !== 'object') invalid('A valid AudioBuffer is required.');
  const { numberOfChannels, sampleRate, length, duration } = audioBuffer;
  validatePcmDimensions(sampleRate, length, numberOfChannels, maxFileBytes);
  if (!Number.isFinite(duration) || duration <= 0) {
    invalid('AudioBuffer duration must be finite and greater than zero.');
  }
  const expectedDuration = length / sampleRate;
  if (Math.abs(duration - expectedDuration) > Math.max(Number.EPSILON * expectedDuration * 4, 1e-12)) {
    invalid('AudioBuffer duration is inconsistent with its frame count and sample rate.');
  }
  if (typeof audioBuffer.getChannelData !== 'function') {
    invalid('AudioBuffer does not provide channel sample data.');
  }

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    let samples: Float32Array;
    try {
      samples = audioBuffer.getChannelData(channel);
    } catch (error) {
      throw new WavPcmEncodingError('INVALID_AUDIO_BUFFER', `Could not read AudioBuffer channel ${channel}: ${String(error)}.`);
    }
    channels.push(samples);
  }

  return validatePcmChannels({ sampleRate, length, channels }, maxFileBytes, true);
}

function writeHeader(view: DataView, validated: ValidatedPcmDimensions): void {
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, validated.fileBytes - 8, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, PCM_FORMAT_CODE, true);
  view.setUint16(22, validated.numberOfChannels, true);
  view.setUint32(24, validated.sampleRate, true);
  view.setUint32(28, validated.byteRate, true);
  view.setUint16(32, validated.blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeText(36, 'data');
  view.setUint32(40, validated.dataBytes, true);
}

/**
 * Writes interleaved frame order. Negative samples scale by 32768 and nonnegative
 * samples by 32767, then Math.round is applied. This maps -1 to -32768 and +1 to
 * +32767 without overflow.
 */
function writeSamples(
  view: DataView,
  validated: ValidatedPcm,
  fromFrame: number,
  toFrame: number,
): void {
  let offset = WAV_RIFF_HEADER_BYTES + fromFrame * validated.blockAlign;
  for (let frame = fromFrame; frame < toFrame; frame += 1) {
    for (let channel = 0; channel < validated.numberOfChannels; channel += 1) {
      const sample = validated.channels[channel][frame];
      if (!Number.isFinite(sample)) {
        throw new WavPcmEncodingError(
          'NON_FINITE_SAMPLE',
          `AudioBuffer contains a non-finite sample at channel ${channel}, frame ${frame}.`,
        );
      }
      const clamped = Math.max(-1, Math.min(1, sample));
      const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, Math.round(scaled), true);
      offset += PCM_BYTES_PER_SAMPLE;
    }
  }
}

function allocateAndWrite(validated: ValidatedPcm): Uint8Array {
  const bytes = new ArrayBuffer(validated.fileBytes);
  const view = new DataView(bytes);
  writeHeader(view, validated);
  writeSamples(view, validated, 0, validated.length);
  return new Uint8Array(bytes);
}

/**
 * Encodes raw channel data as classic RIFF/WAVE, 16-bit signed little-endian PCM.
 * This is the shared implementation used by AudioBuffer callers, the Worker runner
 * and its tests. It never modifies or transfers the source channel arrays.
 */
export function encodePcmChannelsToWavPcm16(
  input: WavPcmChannels,
  options: WavPcmEncodingOptions = {},
): Uint8Array {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_WAV_BYTES;
  const validated = validatePcmChannels(input, maxFileBytes, true);
  return allocateAndWrite(validated);
}

/**
 * Async variant used inside the encoding Worker. It writes measured blocks, reports
 * real progress, yields to the event loop between blocks and checks cancellation.
 * A partial result must be discarded when this function rejects.
 */
export async function encodePcmChannelsToWavPcm16Async(
  input: WavPcmChannels,
  options: WavPcmAsyncEncodingOptions = {},
): Promise<Uint8Array> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_WAV_BYTES;
  const validated = validatePcmChannels(input, maxFileBytes, false);
  const blockFrames = options.blockFrames ?? 16_384;
  if (!Number.isSafeInteger(blockFrames) || blockFrames <= 0) {
    invalid('WAV block size must be a positive safe integer.');
  }
  const yieldFn = options.yieldFn ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

  const bytes = new ArrayBuffer(validated.fileBytes);
  const view = new DataView(bytes);
  writeHeader(view, validated);

  for (let start = 0; start < validated.length; start += blockFrames) {
    if (options.shouldCancel?.()) {
      throw new WavPcmEncodingError('CANCELLED', 'WAV encoding was cancelled.');
    }
    const end = Math.min(validated.length, start + blockFrames);
    writeSamples(view, validated, start, end);
    options.onProgress?.(end / validated.length);
    if (end < validated.length) await yieldFn();
  }

  return new Uint8Array(bytes);
}

/**
 * Encodes an AudioBuffer as classic RIFF/WAVE, 16-bit signed little-endian PCM.
 * Samples are clamped to [-1, 1]; negative values scale by 32768 and nonnegative
 * values by 32767, then Math.round is applied. This maps -1 to -32768 and +1 to
 * +32767 without overflow and matches the existing WAV fixture convention.
 */
export function encodeAudioBufferToWavPcm16(
  audioBuffer: AudioBuffer,
  options: WavPcmEncodingOptions = {},
): Blob {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_WAV_BYTES;
  const validated = validateAndReadAudioBuffer(audioBuffer, maxFileBytes);
  if (typeof Blob === 'undefined') {
    throw new WavPcmEncodingError('BLOB_UNAVAILABLE', 'Blob is not available in this environment.');
  }
  const bytes = allocateAndWrite(validated);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
}
