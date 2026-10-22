import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEFAULT_MAX_MP3_BYTES,
  encodePcmToMp3,
  getMp3MpegVersion,
  getSupportedMp3Bitrates,
  Mp3EncodingError,
  prepareMp3Encoding,
  resolveMp3BitrateKbps,
  type Mp3EncoderInstance,
} from '../src/session/Mp3Encoder.ts';

const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MPEG1_RATES = [44_100, 48_000, 32_000];
const MPEG2_RATES = [22_050, 24_000, 16_000];
const MPEG25_RATES = [11_025, 12_000, 8_000];

function pcm(seconds: number, sampleRate: number, channels: number): Float32Array[] {
  const length = Math.max(1, Math.round(seconds * sampleRate));
  return Array.from({ length: channels }, (_, channel) => {
    const data = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      data[index] = Math.sin((2 * Math.PI * (220 + channel * 110) * index) / sampleRate) * 0.4;
    }
    return data;
  });
}

interface ParsedHeader {
  version: 1 | 2 | 2.5;
  layer: number;
  bitrateKbps: number;
  sampleRate: number;
  channelMode: number;
}

function parseFirstFrame(data: Uint8Array): ParsedHeader {
  assert.ok(data.length >= 4, 'MP3 output must contain at least one frame header');
  assert.equal(data[0], 0xff, 'MP3 frame sync first byte');
  assert.equal(data[1] & 0xe0, 0xe0, 'MP3 frame sync second byte');

  const versionBits = (data[1] >> 3) & 0x03;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : versionBits === 0 ? 2.5 : null;
  assert.ok(version !== null, 'MP3 version bits must not be reserved');
  const layerBits = (data[1] >> 1) & 0x03;
  assert.equal(layerBits, 1, 'Layer III expected');

  const bitrateIndex = data[2] >> 4;
  const sampleRateIndex = (data[2] >> 2) & 0x03;
  assert.ok(bitrateIndex > 0 && bitrateIndex < 15, 'free/bad bitrate index not expected');
  assert.ok(sampleRateIndex < 3, 'reserved sample rate index not expected');

  const bitrates = version === 1 ? MPEG1_BITRATES : MPEG2_BITRATES;
  const rates = version === 1 ? MPEG1_RATES : version === 2 ? MPEG2_RATES : MPEG25_RATES;
  return {
    version,
    layer: 3,
    bitrateKbps: bitrates[bitrateIndex],
    sampleRate: rates[sampleRateIndex],
    channelMode: data[3] >> 6,
  };
}

describe('Mp3Encoder — validated lamejs integration', () => {
  test('produces a real MPEG-1 Layer III stereo stream with the requested metadata', async () => {
    const channels = pcm(1, 48_000, 2);
    const result = await encodePcmToMp3(
      { sampleRate: 48_000, length: channels[0].length, channels },
      { bitrateKbps: 192 },
    );

    assert.equal(result.mimeType, 'audio/mpeg');
    assert.equal(result.bitrateKbps, 192);
    assert.ok(result.data.length > 0);
    assert.notEqual(new TextDecoder().decode(result.data.subarray(0, 4)), 'RIFF');
    const header = parseFirstFrame(result.data);
    assert.equal(header.version, 1);
    assert.equal(header.bitrateKbps, 192);
    assert.equal(header.sampleRate, 48_000);
    assert.notEqual(header.channelMode, 3, 'stereo output expected');
  });

  test('encodes mono explicitly and reports the mono channel mode', async () => {
    const channels = pcm(1, 44_100, 1);
    const result = await encodePcmToMp3(
      { sampleRate: 44_100, length: channels[0].length, channels },
      { bitrateKbps: 128 },
    );
    const header = parseFirstFrame(result.data);
    assert.equal(header.version, 1);
    assert.equal(header.channelMode, 3, 'single-channel mode expected');
    assert.equal(header.bitrateKbps, 128);
    assert.ok(result.data.length > 0);
  });

  test('supports the MPEG-2 and MPEG-2.5 sample-rate families', async () => {
    for (const [sampleRate, bitrateKbps, expectedVersion] of [
      [16_000, 64, 2],
      [8_000, 32, 2.5],
    ] as const) {
      const channels = pcm(0.25, sampleRate, 2);
      const result = await encodePcmToMp3(
        { sampleRate, length: channels[0].length, channels },
        { bitrateKbps },
      );
      const header = parseFirstFrame(result.data);
      assert.equal(header.version, expectedVersion);
      assert.equal(header.sampleRate, sampleRate);
      assert.equal(header.bitrateKbps, bitrateKbps);
    }
  });

  test('finalizes a non-multiple block with flush bytes and reports monotonic progress', async () => {
    const sampleRate = 48_000;
    const length = 5000;
    const channels = pcm(length / sampleRate, sampleRate, 2);
    const progress: number[] = [];
    const result = await encodePcmToMp3(
      { sampleRate, length, channels },
      { bitrateKbps: 128, onProgress: (value) => progress.push(value) },
    );

    assert.ok(result.data.length > 0);
    assert.ok(progress.length >= 2);
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value) => value >= 0 && value <= 1));
    for (let index = 1; index < progress.length; index += 1) {
      assert.ok(progress[index] >= progress[index - 1], 'progress must not regress');
    }
    assert.equal(parseFirstFrame(result.data).bitrateKbps, 128);
  });

  test('validates sample rates, bitrates, channels, dimensions and memory before encoding', async () => {
    assert.throws(() => resolveMp3BitrateKbps(96_000, 192), { code: 'UNSUPPORTED_SAMPLE_RATE' });
    assert.throws(() => resolveMp3BitrateKbps(48_000, 100), { code: 'UNSUPPORTED_BITRATE' });
    assert.throws(() => resolveMp3BitrateKbps(8_000, 320), { code: 'UNSUPPORTED_BITRATE' });
    assert.throws(
      () => prepareMp3Encoding(48_000, 100, 2, 128, DEFAULT_MAX_MP3_BYTES + 1),
      { code: 'INVALID_AUDIO_DATA' },
    );
    assert.deepEqual(getSupportedMp3Bitrates(48_000), [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]);
    assert.deepEqual(getSupportedMp3Bitrates(8_000), [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]);
    assert.equal(getMp3MpegVersion(44_100), 1);
    assert.equal(getMp3MpegVersion(22_050), 2);
    assert.equal(getMp3MpegVersion(11_025), 2.5);
    assert.equal(getMp3MpegVersion(44_100.5), null);

    await assert.rejects(
      encodePcmToMp3({ sampleRate: 96_000, length: 4800, channels: [new Float32Array(4800)] }),
      { code: 'UNSUPPORTED_SAMPLE_RATE' },
    );
    await assert.rejects(
      encodePcmToMp3({ sampleRate: 48_000, length: 4800, channels: [new Float32Array(4800), new Float32Array(4800), new Float32Array(4800)] }),
      { code: 'UNSUPPORTED_CHANNELS' },
    );
    await assert.rejects(
      encodePcmToMp3({ sampleRate: 48_000, length: 4800, channels: [new Float32Array(10)] }),
      { code: 'INVALID_AUDIO_DATA' },
    );
    await assert.rejects(
      encodePcmToMp3(
        { sampleRate: 48_000, length: 48_000, channels: pcm(1, 48_000, 2) },
        { maxFileBytes: 1024 },
      ),
      { code: 'MEMORY_LIMIT' },
    );
  });

  test('rejects non-finite samples and never mutates the source PCM', async () => {
    const channels = pcm(0.1, 48_000, 2);
    const before = channels.map((channel) => channel.slice());
    channels[1][100] = Number.NaN;
    await assert.rejects(
      encodePcmToMp3({ sampleRate: 48_000, length: channels[0].length, channels }),
      { code: 'NON_FINITE_SAMPLE' },
    );
    assert.equal(channels[0][100], before[0][100]);
    assert.ok(Number.isNaN(channels[1][100]));
    for (let channel = 0; channel < channels.length; channel += 1) {
      for (let index = 0; index < channels[channel].length; index += 1) {
        if (index === 100 && channel === 1) continue;
        assert.equal(channels[channel][index], before[channel][index]);
      }
    }
  });

  test('supports cancellation between blocks without emitting a result', async () => {
    let blocks = 0;
    await assert.rejects(
      encodePcmToMp3(
        { sampleRate: 48_000, length: 48_000 * 10, channels: pcm(10, 48_000, 2) },
        {
          shouldCancel: () => blocks > 2,
          yieldFn: async () => { blocks += 1; },
          yieldEveryBlocks: 1,
        },
      ),
      { code: 'CANCELLED' },
    );
  });

  test('propagates encoder initialization and block failures with causes', async () => {
    const channels = pcm(0.1, 48_000, 2);
    const initError = new Error('init failure');
    await assert.rejects(
      encodePcmToMp3(
        { sampleRate: 48_000, length: channels[0].length, channels },
        { createEncoder: () => { throw initError; } },
      ),
      (error: unknown) => {
        assert.ok(error instanceof Mp3EncodingError);
        assert.equal(error.code, 'ENCODER_UNAVAILABLE');
        assert.equal(error.cause, initError);
        return true;
      },
    );

    const encodeError = new Error('block failure');
    const broken: Mp3EncoderInstance = {
      encodeBuffer() { throw encodeError; },
      flush() { return new Int8Array(0); },
    };
    await assert.rejects(
      encodePcmToMp3(
        { sampleRate: 48_000, length: channels[0].length, channels },
        { createEncoder: () => broken },
      ),
      (error: unknown) => {
        assert.ok(error instanceof Mp3EncodingError);
        assert.equal(error.code, 'ENCODE_FAILED');
        assert.equal(error.cause, encodeError);
        return true;
      },
    );
  });

  test('rejects an encoder that produces no MP3 frame', async () => {
    const channels = pcm(0.05, 48_000, 1);
    const empty: Mp3EncoderInstance = {
      encodeBuffer() { return new Int8Array(0); },
      flush() { return new Int8Array(0); },
    };
    await assert.rejects(
      encodePcmToMp3(
        { sampleRate: 48_000, length: channels[0].length, channels },
        { createEncoder: () => empty },
      ),
      { code: 'ENCODE_FAILED' },
    );
  });

  test('keeps the default MP3 byte ceiling explicit', () => {
    assert.equal(DEFAULT_MAX_MP3_BYTES, 128 * 1024 * 1024);
    const preflight = prepareMp3Encoding(48_000, 48_000, 2, 192, DEFAULT_MAX_MP3_BYTES);
    assert.equal(preflight.bitrateKbps, 192);
    assert.ok(preflight.upperBoundBytes > 0);
    assert.ok(preflight.upperBoundBytes < DEFAULT_MAX_MP3_BYTES);
  });
});
