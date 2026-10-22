/** Maximum complete WAV size. At stereo S16LE/48 kHz this matches the renderer's
 * 256 MiB Float32 limit for the same duration, while leaving room for the RIFF header. */
export const DEFAULT_MAX_WAV_BYTES = 128 * 1024 * 1024;

const RIFF_HEADER_BYTES = 44;
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
  | 'BLOB_UNAVAILABLE';

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

interface ValidatedAudioBuffer {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  channels: Float32Array[];
  dataBytes: number;
  fileBytes: number;
  byteRate: number;
  blockAlign: number;
}

function invalid(message: string): never {
  throw new WavPcmEncodingError('INVALID_AUDIO_BUFFER', message);
}

function validateAndReadAudioBuffer(audioBuffer: AudioBuffer, maxFileBytes: number): ValidatedAudioBuffer {
  if (!audioBuffer || typeof audioBuffer !== 'object') invalid('A valid AudioBuffer is required.');
  const { numberOfChannels, sampleRate, length, duration } = audioBuffer;
  if (!Number.isInteger(numberOfChannels) || numberOfChannels <= 0 || numberOfChannels > UINT16_MAX) {
    invalid('AudioBuffer channel count must be a positive 16-bit integer.');
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > UINT32_MAX) {
    invalid('AudioBuffer sample rate must be a positive 32-bit integer.');
  }
  if (!Number.isSafeInteger(length) || length <= 0) {
    invalid('AudioBuffer frame count must be a positive safe integer.');
  }
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

  const blockAlign = numberOfChannels * PCM_BYTES_PER_SAMPLE;
  if (blockAlign > UINT16_MAX) invalid('PCM block alignment exceeds the WAV format limit.');
  const byteRateBig = BigInt(sampleRate) * BigInt(blockAlign);
  if (byteRateBig > BigInt(UINT32_MAX)) invalid('PCM byte rate exceeds the WAV format limit.');

  const dataBytesBig = BigInt(length) * BigInt(blockAlign);
  const fileBytesBig = BigInt(RIFF_HEADER_BYTES) + dataBytesBig;
  const riffSizeBig = fileBytesBig - 8n;
  if (dataBytesBig > BigInt(UINT32_MAX) || riffSizeBig > BigInt(UINT32_MAX)
    || fileBytesBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new WavPcmEncodingError('RIFF_SIZE_LIMIT', 'AudioBuffer is too large for a classic RIFF/WAVE file.');
  }
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < RIFF_HEADER_BYTES) {
    invalid('WAV maximum file size must be a safe integer of at least 44 bytes.');
  }
  if (fileBytesBig > BigInt(maxFileBytes)) {
    throw new WavPcmEncodingError('MEMORY_LIMIT', `WAV output exceeds the configured ${maxFileBytes}-byte limit.`);
  }

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < numberOfChannels; channel += 1) {
    let samples: Float32Array;
    try {
      samples = audioBuffer.getChannelData(channel);
    } catch (error) {
      throw new WavPcmEncodingError('INVALID_AUDIO_BUFFER', `Could not read AudioBuffer channel ${channel}: ${String(error)}.`);
    }
    if (!(samples instanceof Float32Array) || samples.length !== length) {
      invalid(`AudioBuffer channel ${channel} does not contain exactly ${length} Float32 samples.`);
    }
    for (let frame = 0; frame < samples.length; frame += 1) {
      if (!Number.isFinite(samples[frame])) {
        throw new WavPcmEncodingError(
          'NON_FINITE_SAMPLE',
          `AudioBuffer contains a non-finite sample at channel ${channel}, frame ${frame}.`,
        );
      }
    }
    channels.push(samples);
  }

  return {
    numberOfChannels,
    sampleRate,
    length,
    channels,
    dataBytes: Number(dataBytesBig),
    fileBytes: Number(fileBytesBig),
    byteRate: Number(byteRateBig),
    blockAlign,
  };
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

  const bytes = new ArrayBuffer(validated.fileBytes);
  const view = new DataView(bytes);
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

  let offset = RIFF_HEADER_BYTES;
  for (let frame = 0; frame < validated.length; frame += 1) {
    for (let channel = 0; channel < validated.numberOfChannels; channel += 1) {
      const clamped = Math.max(-1, Math.min(1, validated.channels[channel][frame]));
      const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, Math.round(scaled), true);
      offset += PCM_BYTES_PER_SAMPLE;
    }
  }

  return new Blob([bytes], { type: 'audio/wav' });
}
