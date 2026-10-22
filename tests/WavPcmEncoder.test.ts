import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_MAX_WAV_BYTES,
  encodeAudioBufferToWavPcm16,
  encodePcmChannelsToWavPcm16,
  encodePcmChannelsToWavPcm16Async,
  getWavPcm16FileBytes,
  WavPcmEncodingError,
} from '../src/session/WavPcmEncoder.ts';

function audioBuffer(channels: Float32Array[], sampleRate = 48_000): AudioBuffer {
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

async function readBlob(blob: Blob): Promise<{ bytes: Uint8Array; view: DataView }> {
  const data = await blob.arrayBuffer();
  return { bytes: new Uint8Array(data), view: new DataView(data) };
}

function readInt16(view: DataView, offset: number): number {
  return view.getInt16(offset, true);
}

describe('WavPcmEncoder — PCM S16LE RIFF/WAVE', () => {
  test('encodes mono samples and emits the complete PCM header', async () => {
    const blob = encodeAudioBufferToWavPcm16(audioBuffer([new Float32Array([0.5])]));
    const { bytes, view } = await readBlob(blob);

    assert.equal(blob.type, 'audio/wav');
    assert.equal(blob.size, 46);
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
    assert.equal(view.getUint32(4, true), blob.size - 8);
    assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'WAVE');
    assert.equal(new TextDecoder().decode(bytes.subarray(12, 16)), 'fmt ');
    assert.equal(view.getUint32(16, true), 16);
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), 48_000);
    assert.equal(view.getUint32(28, true), 96_000);
    assert.equal(view.getUint16(32, true), 2);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(new TextDecoder().decode(bytes.subarray(36, 40)), 'data');
    assert.equal(view.getUint32(40, true), 2);
    assert.equal(readInt16(view, 44), 16_384);
  });

  test('interleaves stereo samples in frame order and preserves channel distinctions', async () => {
    const left = new Float32Array([1, 0.25]);
    const right = new Float32Array([-1, -0.25]);
    const blob = encodeAudioBufferToWavPcm16(audioBuffer([left, right], 44_100));
    const { bytes, view } = await readBlob(blob);

    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
    assert.equal(view.getUint32(4, true), 44);
    assert.equal(new TextDecoder().decode(bytes.subarray(8, 12)), 'WAVE');
    assert.equal(new TextDecoder().decode(bytes.subarray(12, 16)), 'fmt ');
    assert.equal(view.getUint16(20, true), 1);
    assert.equal(view.getUint16(22, true), 2);
    assert.equal(view.getUint32(24, true), 44_100);
    assert.equal(view.getUint32(28, true), 176_400);
    assert.equal(view.getUint16(32, true), 4);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(new TextDecoder().decode(bytes.subarray(36, 40)), 'data');
    assert.equal(view.getUint32(40, true), 8);
    assert.deepEqual([44, 46, 48, 50].map((offset) => readInt16(view, offset)), [32_767, -32_768, 8_192, -8_192]);
  });

  test('maps -1, zero and +1 to the signed PCM endpoints and silence', async () => {
    const blob = encodeAudioBufferToWavPcm16(audioBuffer([new Float32Array([-1, 0, 1])]));
    const { view } = await readBlob(blob);
    assert.deepEqual([44, 46, 48].map((offset) => readInt16(view, offset)), [-32_768, 0, 32_767]);
  });

  test('clamps out-of-range values and uses the documented asymmetric quantization rule', async () => {
    const blob = encodeAudioBufferToWavPcm16(audioBuffer([new Float32Array([-2, -0.5, -0.25, 0.25, 0.5, 2])]));
    const { view } = await readBlob(blob);
    assert.deepEqual([44, 46, 48, 50, 52, 54].map((offset) => readInt16(view, offset)), [
      -32_768, -16_384, -8_192, 8_192, 16_384, 32_767,
    ]);
  });

  test('rejects non-finite samples with channel and frame details', () => {
    for (const sample of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(
        () => encodeAudioBufferToWavPcm16(audioBuffer([new Float32Array([sample])])),
        (error: unknown) => {
          assert.ok(error instanceof WavPcmEncodingError);
          assert.equal(error.code, 'NON_FINITE_SAMPLE');
          assert.match(error.message, /channel 0, frame 0/);
          return true;
        },
      );
    }
  });

  test('rejects malformed buffers and inconsistent dimensions', () => {
    assert.throws(() => encodeAudioBufferToWavPcm16(null as unknown as AudioBuffer), { code: 'INVALID_AUDIO_BUFFER' });
    assert.throws(() => encodeAudioBufferToWavPcm16(audioBuffer([], 48_000)), { code: 'INVALID_AUDIO_BUFFER' });
    assert.throws(() => encodeAudioBufferToWavPcm16(audioBuffer([new Float32Array([1])], 0)), { code: 'INVALID_AUDIO_BUFFER' });
    const shortChannel = { ...audioBuffer([new Float32Array([0, 1])]), length: 1, duration: 1 / 48_000 } as AudioBuffer;
    assert.throws(() => encodeAudioBufferToWavPcm16(shortChannel), { code: 'INVALID_AUDIO_BUFFER' });
    const wrongDuration = { ...audioBuffer([new Float32Array([1])]), duration: 2 } as AudioBuffer;
    assert.throws(() => encodeAudioBufferToWavPcm16(wrongDuration), { code: 'INVALID_AUDIO_BUFFER' });
  });

  test('rejects configured limits and classic RIFF overflow before allocating output', () => {
    const ordinary = audioBuffer([new Float32Array([0, 1])]);
    assert.throws(
      () => encodeAudioBufferToWavPcm16(ordinary, { maxFileBytes: 47 }),
      { code: 'MEMORY_LIMIT' },
    );
    assert.throws(
      () => encodeAudioBufferToWavPcm16(ordinary, { maxFileBytes: 43 }),
      { code: 'INVALID_AUDIO_BUFFER' },
    );

    let channelRead = false;
    const oversized = {
      numberOfChannels: 2,
      sampleRate: 48_000,
      length: 2 ** 31,
      duration: (2 ** 31) / 48_000,
      getChannelData() { channelRead = true; return new Float32Array(0); },
    } as unknown as AudioBuffer;
    assert.throws(() => encodeAudioBufferToWavPcm16(oversized), { code: 'RIFF_SIZE_LIMIT' });
    assert.equal(channelRead, false);
    assert.equal(DEFAULT_MAX_WAV_BYTES, 128 * 1024 * 1024);
  });

  test('does not modify input channel data and accepts an OfflineSessionRenderer-shaped buffer', async () => {
    const left = new Float32Array([0.125, -0.125]);
    const right = new Float32Array([0.75, -0.75]);
    const renderedBuffer = audioBuffer([left, right], 48_000);
    const beforeLeft = left.slice();
    const beforeRight = right.slice();
    const blob = encodeAudioBufferToWavPcm16(renderedBuffer);
    const { view } = await readBlob(blob);

    assert.deepEqual(left, beforeLeft);
    assert.deepEqual(right, beforeRight);
    assert.equal(view.getUint16(22, true), renderedBuffer.numberOfChannels);
    assert.equal(view.getUint32(24, true), renderedBuffer.sampleRate);
    assert.equal(view.getUint32(40, true), renderedBuffer.length * renderedBuffer.numberOfChannels * 2);
    assert.deepEqual([44, 46, 48, 50].map((offset) => readInt16(view, offset)), [4_096, 24_575, -4_096, -24_576]);
  });
});

describe('WavPcmEncoder — shared PCM path used by the Worker', () => {
  test('produces byte-identical output to the AudioBuffer wrapper', async () => {
    const left = new Float32Array([-1, -0.5, 0, 0.5, 1]);
    const right = new Float32Array([1, 0.5, 0, -0.5, -1]);
    const direct = encodePcmChannelsToWavPcm16({ sampleRate: 44_100, length: 5, channels: [left, right] });
    const viaBuffer = new Uint8Array(await encodeAudioBufferToWavPcm16(audioBuffer([left, right], 44_100)).arrayBuffer());
    assert.deepEqual(direct, viaBuffer);
  });

  test('reports the exact RIFF size before allocating and enforces the limit', () => {
    const fileBytes = getWavPcm16FileBytes(48_000, 100, 2);
    assert.equal(fileBytes, 44 + 100 * 4);
    assert.throws(
      () => getWavPcm16FileBytes(48_000, 100, 2, fileBytes - 1),
      { code: 'MEMORY_LIMIT' },
    );
    assert.throws(
      () => getWavPcm16FileBytes(0, 100, 2),
      { code: 'INVALID_AUDIO_BUFFER' },
    );
    assert.throws(
      () => getWavPcm16FileBytes(48_000, 1, 1, DEFAULT_MAX_WAV_BYTES + 1),
      { code: 'INVALID_AUDIO_BUFFER' },
    );
  });

  test('validates raw channel dimensions and finite samples without mutating the source', async () => {
    const left = new Float32Array([0.25, -0.25]);
    const right = new Float32Array([0.5, -0.5]);
    const before = [left.slice(), right.slice()];
    const bytes = encodePcmChannelsToWavPcm16({ sampleRate: 48_000, length: 2, channels: [left, right] });
    assert.deepEqual(left, before[0]);
    assert.deepEqual(right, before[1]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.deepEqual([44, 46, 48, 50].map((offset) => view.getInt16(offset, true)), [8_192, 16_384, -8_192, -16_384]);

    assert.throws(
      () => encodePcmChannelsToWavPcm16({ sampleRate: 48_000, length: 2, channels: [new Float32Array(1)] }),
      { code: 'INVALID_AUDIO_BUFFER' },
    );
    const invalid = new Float32Array([0, Number.NaN]);
    assert.throws(
      () => encodePcmChannelsToWavPcm16({ sampleRate: 48_000, length: 2, channels: [invalid] }),
      { code: 'NON_FINITE_SAMPLE' },
    );
    assert.ok(Number.isNaN(invalid[1]));
  });

  test('reports measured monotonic progress and cancels between blocks', async () => {
    const length = 100_000;
    const left = new Float32Array(length).fill(0.1);
    const progress: number[] = [];
    const bytes = await encodePcmChannelsToWavPcm16Async(
      { sampleRate: 48_000, length, channels: [left] },
      {
        blockFrames: 10_000,
        onProgress: (value) => progress.push(value),
        yieldFn: async () => { await Promise.resolve(); },
      },
    );
    assert.equal(bytes.length, 44 + length * 2);
    assert.equal(progress.length, 10);
    assert.equal(progress.at(-1), 1);
    for (let index = 1; index < progress.length; index += 1) {
      assert.ok(progress[index] >= progress[index - 1]);
    }

    let blocks = 0;
    await assert.rejects(
      encodePcmChannelsToWavPcm16Async(
        { sampleRate: 48_000, length, channels: [left] },
        {
          blockFrames: 10_000,
          shouldCancel: () => blocks >= 2,
          yieldFn: async () => { blocks += 1; },
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof WavPcmEncodingError);
        assert.equal(error.code, 'CANCELLED');
        return true;
      },
    );
  });
});
