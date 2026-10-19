/**
 * SYSTEM DJ — Crypto Hash Tests
 * Pruebas unitarias para cálculo de hash SHA-256 de archivos (computeFileHash).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFileHash } from '../src/utils/cryptoHash.ts';

describe('computeFileHash — Identidad Criptográfica SHA-256 de Archivos', () => {
  describe('1. Vectores SHA-256 Estándar', () => {
    test('Calcula correctamente el hash del vector estándar "abc"', async () => {
      const file = new File(['abc'], 'test_abc.txt', { type: 'text/plain' });
      const hash = await computeFileHash(file);
      assert.equal(hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    test('Calcula correctamente el hash del vector estándar RFC 6234 / NIST de 56 bytes', async () => {
      const vector = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
      const file = new File([vector], 'test_vector.txt', { type: 'text/plain' });
      const hash = await computeFileHash(file);
      assert.equal(hash, '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    });
  });

  describe('2. Archivos Idénticos e Invarianza de Metadatos', () => {
    test('Archivos con exactamente el mismo contenido generan el mismo hash SHA-256', async () => {
      const buffer = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
      const fileA = new File([buffer], 'audio_track_a.wav', { type: 'audio/wav', lastModified: 10000 });
      const fileB = new File([buffer], 'audio_track_a.wav', { type: 'audio/wav', lastModified: 10000 });

      const hashA = await computeFileHash(fileA);
      const hashB = await computeFileHash(fileB);

      assert.equal(hashA, hashB);
      assert.match(hashA, /^[0-9a-f]{64}$/);
    });

    test('El hash evalúa exclusivamente el contenido binario, no el nombre ni la fecha de modificación', async () => {
      const content = new TextEncoder().encode('RIFF....WAVEfmt ....data....');
      const file1 = new File([content], 'original.wav', { type: 'audio/wav', lastModified: 100000 });
      const file2 = new File([content], 'renamed_copy.mp3', { type: 'audio/mpeg', lastModified: 999999 });

      const hash1 = await computeFileHash(file1);
      const hash2 = await computeFileHash(file2);

      assert.equal(hash1, hash2);
    });
  });

  describe('3. Sensibilidad al Contenido: Diferencia de un Solo Byte', () => {
    test('Una diferencia de un solo byte en 1 KB produce hashes completamente dispares (efecto avalancha)', async () => {
      const size = 1024;
      const bytes1 = new Uint8Array(size);
      const bytes2 = new Uint8Array(size);

      for (let i = 0; i < size; i++) {
        const val = (i * 31 + 7) & 0xff;
        bytes1[i] = val;
        bytes2[i] = val;
      }

      // Modificar exactamente 1 bit en el byte central (índice 512)
      bytes2[512] ^= 0x01;

      const file1 = new File([bytes1], 'signal1.raw');
      const file2 = new File([bytes2], 'signal2.raw');

      const hash1 = await computeFileHash(file1);
      const hash2 = await computeFileHash(file2);

      assert.notEqual(hash1, hash2);
      assert.equal(hash1.length, 64);
      assert.equal(hash2.length, 64);

      // Comprobar divergencia sustancial (efecto avalancha)
      let identicalHexPositions = 0;
      for (let i = 0; i < 64; i++) {
        if (hash1[i] === hash2[i]) {
          identicalHexPositions++;
        }
      }
      // En un hash criptográfico de 64 caracteres hex, las posiciones coincidentes al azar son ~4 (64/16)
      assert.ok(identicalHexPositions < 20, 'Efecto avalancha insuficiente tras alterar 1 bit');
    });
  });

  describe('4. Archivo Vacío', () => {
    test('Un archivo de 0 bytes produce el hash SHA-256 estándar de entrada vacía', async () => {
      const emptyFile = new File([], 'empty.raw');
      const hash = await computeFileHash(emptyFile);

      // SHA-256 de buffer de longitud 0
      assert.equal(hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
  });

  describe('5. Manejo Explícito de Errores', () => {
    test('Lanza TypeError si el parámetro es null, undefined o no dispone de arrayBuffer', async () => {
      await assert.rejects(
        // @ts-expect-error probando entrada inválida en tiempo de ejecución
        async () => computeFileHash(null),
        { name: 'TypeError', message: 'El parámetro proporcionado no es un archivo o Blob válido.' }
      );

      await assert.rejects(
        // @ts-expect-error probando entrada inválida en tiempo de ejecución
        async () => computeFileHash(undefined),
        { name: 'TypeError', message: 'El parámetro proporcionado no es un archivo o Blob válido.' }
      );

      await assert.rejects(
        // @ts-expect-error probando entrada inválida en tiempo de ejecución
        async () => computeFileHash({ notAFile: true }),
        { name: 'TypeError', message: 'El parámetro proporcionado no es un archivo o Blob válido.' }
      );
    });

    test('Lanza Error explícito si crypto.subtle no está disponible en el entorno', async () => {
      const file = new File(['test'], 'test.txt');
      const originalSubtle = globalThis.crypto?.subtle;

      try {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: undefined,
          configurable: true,
          writable: true,
        });

        await assert.rejects(
          async () => computeFileHash(file),
          {
            name: 'Error',
            message: 'Web Cryptography API (crypto.subtle) no está disponible en este entorno.',
          }
        );
      } finally {
        Object.defineProperty(globalThis.crypto, 'subtle', {
          value: originalSubtle,
          configurable: true,
          writable: true,
        });
      }
    });

    test('Lanza Error explícito si globalThis.crypto es indefinido', async () => {
      const file = new File(['test'], 'test.txt');
      const originalCrypto = globalThis.crypto;

      try {
        Object.defineProperty(globalThis, 'crypto', {
          value: undefined,
          configurable: true,
          writable: true,
        });

        await assert.rejects(
          async () => computeFileHash(file),
          {
            name: 'Error',
            message: 'Web Cryptography API (crypto.subtle) no está disponible en este entorno.',
          }
        );
      } finally {
        Object.defineProperty(globalThis, 'crypto', {
          value: originalCrypto,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});
