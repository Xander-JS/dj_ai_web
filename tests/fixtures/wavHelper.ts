/**
 * SYSTEM DJ — Test Fixture Helper: Lector y Generador de Archivos WAV RIFF locales
 * Permite pruebas reales con archivos binarios de audio en el sistema de archivos local
 * sin dependencias externas ni conexión de red.
 */

import fs from 'node:fs';

/**
 * Escribe un archivo RIFF WAV PCM estándar de 16-bit mono.
 */
export function writeWavFileSync(
  filePath: string,
  pcm: Float32Array,
  sampleRate: number
): void {
  const numSamples = pcm.length;
  const bytesPerSample = 2; // 16 bits
  const dataSize = numSamples * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  // Cabecera RIFF
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4); // Tamaño del archivo menos 8 bytes
  buffer.write('WAVE', 8);

  // Sub-chunk fmt
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);            // Tamaño del sub-chunk fmt (16 para PCM)
  buffer.writeUInt16LE(1, 20);             // Formato de audio (1 = PCM)
  buffer.writeUInt16LE(1, 22);             // Canales (1 = Mono)
  buffer.writeUInt32LE(sampleRate, 24);    // Frecuencia de muestreo
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // Byte rate
  buffer.writeUInt16LE(bytesPerSample, 32);// Block align
  buffer.writeUInt16LE(16, 34);            // Bits por muestra

  // Sub-chunk data
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Convertir Float32 [-1.0, 1.0] a Int16 [-32768, 32767]
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    const intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
    buffer.writeInt16LE(Math.round(intSample), offset);
    offset += 2;
  }

  fs.writeFileSync(filePath, buffer);
}

/**
 * Lee y decodifica un archivo WAV RIFF PCM de 16-bit mono o estéreo desde el disco local.
 */
export function readWavFileSync(filePath: string): { pcm: Float32Array; sampleRate: number } {
  const buffer = fs.readFileSync(filePath);

  const riff = buffer.toString('ascii', 0, 4);
  if (riff !== 'RIFF') {
    throw new Error(`Encabezado RIFF inválido en ${filePath}`);
  }

  const wave = buffer.toString('ascii', 8, 12);
  if (wave !== 'WAVE') {
    throw new Error(`Formato WAVE inválido en ${filePath}`);
  }

  // Buscar chunks 'fmt ' y 'data'
  let offset = 12;
  let sampleRate = 44100;
  let numChannels = 1;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      numChannels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (dataOffset === 0) {
    throw new Error(`Chunk de datos PCM no encontrado en ${filePath}`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / (bytesPerSample * numChannels));
  const pcm = new Float32Array(totalSamples);

  let readPtr = dataOffset;
  for (let i = 0; i < totalSamples; i++) {
    let sampleSum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      if (bitsPerSample === 16) {
        sampleSum += buffer.readInt16LE(readPtr) / 32768.0;
        readPtr += 2;
      } else {
        // Fallback simple para 8 bits u otros formatos
        sampleSum += (buffer.readUInt8(readPtr) - 128) / 128.0;
        readPtr += 1;
      }
    }
    pcm[i] = sampleSum / numChannels;
  }

  return { pcm, sampleRate };
}
