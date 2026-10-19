/**
 * SYSTEM DJ — Crypto Hash Utility
 * Cálculo de huella criptográfica SHA-256 para archivos de audio.
 *
 * Limitación técnica de la plataforma:
 * La especificación estándar de la Web Cryptography API (`crypto.subtle.digest`)
 * no proporciona soporte para hashing incremental (streaming por chunks) en navegadores.
 * Por consiguiente, todo el contenido del archivo debe residir en memoria como un `ArrayBuffer`
 * antes de procesar el resumen digest (`file.arrayBuffer()`). En archivos de audio extensos,
 * esto genera una asignación temporal de memoria proporcional al tamaño del archivo.
 * Al no existir en el proyecto una estrategia o biblioteca externa de hashing en streaming,
 * se implementa esta función de paso único de buffer completo documentando explícitamente dicha restricción.
 */

const verifiedBlobRegistry = new WeakMap<Blob, string>();

/**
 * Obtiene el hash SHA-256 verificado previamente para esta instancia exacta de Blob.
 */
export function getVerifiedBlobHash(blob: Blob): string | undefined {
  return verifiedBlobRegistry.get(blob);
}

/**
 * Registra una instancia de Blob como criptográficamente verificada con su hash SHA-256.
 */
export function registerVerifiedBlobHash(blob: Blob, hash: string): void {
  verifiedBlobRegistry.set(blob, hash);
}

/**
 * Calcula el digest SHA-256 en formato hexadecimal en minúsculas del contenido exacto de un archivo.
 *
 * @param file Objeto File o Blob a procesar.
 * @returns Promesa que resuelve a una cadena de 64 caracteres hexadecimales correspondiente al SHA-256.
 * @throws {TypeError} Si el parámetro proporcionado no es un File o Blob válido.
 * @throws {Error} Si la Web Cryptography API (`crypto.subtle`) no está disponible en el entorno de ejecución actual.
 */
export async function computeFileHash(file: File): Promise<string> {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new TypeError('El parámetro proporcionado no es un archivo o Blob válido.');
  }

  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (!cryptoObj?.subtle || typeof cryptoObj.subtle.digest !== 'function') {
    throw new Error('Web Cryptography API (crypto.subtle) no está disponible en este entorno.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await cryptoObj.subtle.digest('SHA-256', arrayBuffer);
  const hashBytes = new Uint8Array(hashBuffer);

  let hex = '';
  for (let i = 0; i < hashBytes.length; i++) {
    hex += hashBytes[i].toString(16).padStart(2, '0');
  }

  registerVerifiedBlobHash(file, hex);
  return hex;
}
