/**
 * SYSTEM DJ — Avatar File Tests
 * Validación de formato/tamaño y saneado de la ruta de subida al bucket `avatars`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAvatarPath, isValidAvatarFile, sanitizeFileName, MAX_AVATAR_BYTES } from '../src/utils/avatarFile.ts';

describe('avatarFile — Fotos de perfil', () => {
  test('Acepta JPEG, PNG y WebP hasta 2 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      assert.equal(isValidAvatarFile({ type, size: MAX_AVATAR_BYTES }), true);
    }
  });

  test('Rechaza otros formatos, archivos vacíos y mayores de 2 MB', () => {
    assert.equal(isValidAvatarFile({ type: 'image/gif', size: 1000 }), false);
    assert.equal(isValidAvatarFile({ type: 'image/svg+xml', size: 1000 }), false);
    assert.equal(isValidAvatarFile({ type: 'image/png', size: 0 }), false);
    assert.equal(isValidAvatarFile({ type: 'image/png', size: MAX_AVATAR_BYTES + 1 }), false);
  });

  test('Sanea espacios, acentos y caracteres especiales', () => {
    assert.equal(sanitizeFileName('Foto de Perfil (1).jpg'), 'Foto_de_Perfil_1_.jpg');
    assert.equal(sanitizeFileName('canción ñandú.png'), 'cancion_nandu.png');
    assert.equal(sanitizeFileName('???'), 'avatar');
  });

  test('Construye la ruta con el prefijo del usuario', () => {
    assert.equal(buildAvatarPath('user-1', 'mi foto.webp', 123), 'user-1/123_mi_foto.webp');
  });
});
