/**
 * Minimal declarations for the untyped CommonJS `lamejs@1.2.1` package.
 * The npm release has no TypeScript definitions and its internal modules use
 * CommonJS. Only the surface actually consumed by this project is declared.
 */

declare module 'lamejs' {
  export interface LameMp3Encoder {
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
    flush(): Int8Array;
  }

  export interface LameWavHeader {
    dataOffset: number;
    dataLen: number;
    channels: number;
    sampleRate: number;
  }

  const lamejs: {
    Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => LameMp3Encoder;
    WavHeader: {
      readHeader(dataView: DataView): LameWavHeader | undefined;
    };
  };

  export default lamejs;
}

declare module 'lamejs/src/js/MPEGMode.js' {
  const MPEGMode: unknown;
  export default MPEGMode;
}

declare module 'lamejs/src/js/Lame.js' {
  const Lame: unknown;
  export default Lame;
}

declare module 'lamejs/src/js/BitStream.js' {
  const BitStream: unknown;
  export default BitStream;
}
