/**
 * SYSTEM DJ — Camelot Notation & Musical Key Mapper
 * Mapeo determinista bidireccional entre tonalidades estándar y la rueda Camelot.
 */

import type { MusicalKeyCamelot } from '../../types/track.ts';

// Diccionario de normalización cromática (12 clases de altura: 0 = C, 1 = C#/Db, ...)
export const PITCH_CLASS_NAMES: string[] = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
];

// Mapeo canónico a Camelot: [pitchClass, mode] -> Camelot
// Modo: 'major' | 'minor'
const PITCH_CLASS_TO_CAMELOT_MAJOR: Record<number, MusicalKeyCamelot> = {
  0: '8B',  // C
  1: '3B',  // C# / Db
  2: '10B', // D
  3: '5B',  // D# / Eb
  4: '12B', // E
  5: '7B',  // F
  6: '2B',  // F# / Gb
  7: '9B',  // G
  8: '4B',  // G# / Ab
  9: '11B', // A
  10: '6B', // A# / Bb
  11: '1B', // B
};

const PITCH_CLASS_TO_CAMELOT_MINOR: Record<number, MusicalKeyCamelot> = {
  0: '5A',  // Cm
  1: '12A', // C#m / Dbm
  2: '7A',  // Dm
  3: '2A',  // D#m / Ebm
  4: '9A',  // Em
  5: '4A',  // Fm
  6: '11A', // F#m / Gbm
  7: '6A',  // Gm
  8: '1A',  // G#m / Abm
  9: '8A',  // Am
  10: '3A', // A#m / Bbm
  11: '10A',// Bm
};

// Diccionario inverso: Camelot -> Nombre canónico de clave (convención estándar en software DJ)
const CAMELOT_TO_CANONICAL_KEY: Record<MusicalKeyCamelot, string> = {
  '1A': 'G#m',
  '1B': 'B',
  '2A': 'Ebm',
  '2B': 'F#',
  '3A': 'Bbm',
  '3B': 'Db',
  '4A': 'Fm',
  '4B': 'Ab',
  '5A': 'Cm',
  '5B': 'Eb',
  '6A': 'Gm',
  '6B': 'Bb',
  '7A': 'Dm',
  '7B': 'F',
  '8A': 'Am',
  '8B': 'C',
  '9A': 'Em',
  '9B': 'G',
  '10A': 'Bm',
  '10B': 'D',
  '11A': 'F#m',
  '11B': 'A',
  '12A': 'C#m',
  '12B': 'E',
};

// Nombres canónicos convencionales (evitando enarmonías teóricas no estándar como D# mayor o A# mayor)
const CANONICAL_PITCH_NAMES_MAJOR: string[] = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'
];

const CANONICAL_PITCH_NAMES_MINOR: string[] = [
  'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'
];

// Mapeo exhaustivo de claves textuales comunes (incluyendo bemoles y sostenidos)
const TEXT_KEY_TO_CAMELOT: Record<string, MusicalKeyCamelot> = {
  // Claves Mayores
  'C': '8B', 'CMAJ': '8B', 'CMAJOR': '8B',
  'C#': '3B', 'C#MAJ': '3B', 'C#MAJOR': '3B',
  'DB': '3B', 'DBMAJ': '3B', 'DBMAJOR': '3B',
  'D': '10B', 'DMAJ': '10B', 'DMAJOR': '10B',
  'D#': '5B', 'D#MAJ': '5B', 'D#MAJOR': '5B',
  'EB': '5B', 'EBMAJ': '5B', 'EBMAJOR': '5B',
  'E': '12B', 'EMAJ': '12B', 'EMAJOR': '12B',
  'F': '7B', 'FMAJ': '7B', 'FMAJOR': '7B',
  'F#': '2B', 'F#MAJ': '2B', 'F#MAJOR': '2B',
  'GB': '2B', 'GBMAJ': '2B', 'GBMAJOR': '2B',
  'G': '9B', 'GMAJ': '9B', 'GMAJOR': '9B',
  'G#': '4B', 'G#MAJ': '4B', 'G#MAJOR': '4B',
  'AB': '4B', 'ABMAJ': '4B', 'ABMAJOR': '4B',
  'A': '11B', 'AMAJ': '11B', 'AMAJOR': '11B',
  'A#': '6B', 'A#MAJ': '6B', 'A#MAJOR': '6B',
  'BB': '6B', 'BBMAJ': '6B', 'BBMAJOR': '6B',
  'B': '1B', 'BMAJ': '1B', 'BMAJOR': '1B',

  // Claves Menores
  'CM': '5A', 'CMIN': '5A', 'CMINOR': '5A',
  'C#M': '12A', 'C#MIN': '12A', 'C#MINOR': '12A',
  'DBM': '12A', 'DBMIN': '12A', 'DBMINOR': '12A',
  'DM': '7A', 'DMIN': '7A', 'DMINOR': '7A',
  'D#M': '2A', 'D#MIN': '2A', 'D#MINOR': '2A',
  'EBM': '2A', 'EBMIN': '2A', 'EBMINOR': '2A',
  'EM': '9A', 'EMIN': '9A', 'EMINOR': '9A',
  'FM': '4A', 'FMIN': '4A', 'FMINOR': '4A',
  'F#M': '11A', 'F#MIN': '11A', 'F#MINOR': '11A',
  'GBM': '11A', 'GBMIN': '11A', 'GBMINOR': '11A',
  'GM': '6A', 'GMIN': '6A', 'GMINOR': '6A',
  'G#M': '1A', 'G#MIN': '1A', 'G#MINOR': '1A',
  'ABM': '1A', 'ABMIN': '1A', 'ABMINOR': '1A',
  'AM': '8A', 'AMIN': '8A', 'AMINOR': '8A',
  'A#M': '3A', 'A#MIN': '3A', 'A#MINOR': '3A',
  'BBM': '3A', 'BBMIN': '3A', 'BBMINOR': '3A',
  'BM': '10A', 'BMIN': '10A', 'BMINOR': '10A',
};

/**
 * Convierte un índice cromático (0..11) y modo a clave canónica y notación Camelot.
 */
export function pitchClassToKey(
  pitchClass: number,
  mode: 'major' | 'minor'
): { key: string; camelot: MusicalKeyCamelot } {
  const normalizedPc = ((Math.round(pitchClass) % 12) + 12) % 12;
  const isMajor = mode === 'major';
  const camelot = isMajor
    ? PITCH_CLASS_TO_CAMELOT_MAJOR[normalizedPc]
    : PITCH_CLASS_TO_CAMELOT_MINOR[normalizedPc];
  const key = isMajor
    ? CANONICAL_PITCH_NAMES_MAJOR[normalizedPc]
    : CANONICAL_PITCH_NAMES_MINOR[normalizedPc];

  return { key, camelot };
}

/**
 * Normaliza y traduce una cadena de clave musical al código Camelot correspondiente.
 */
export function keyToCamelot(rawKey: string): MusicalKeyCamelot | undefined {
  if (!rawKey || typeof rawKey !== 'string') return undefined;

  const cleaned = rawKey.trim().toUpperCase().replace(/\s+/g, '');

  // Si ya es un código Camelot válido directo (ej. '8A', '11B')
  if (/^(1[0-2]|[1-9])[AB]$/.test(cleaned)) {
    return cleaned as MusicalKeyCamelot;
  }

  return TEXT_KEY_TO_CAMELOT[cleaned];
}

/**
 * Convierte un código Camelot a la clave musical canónica.
 */
export function camelotToKey(camelot: MusicalKeyCamelot): string {
  return CAMELOT_TO_CANONICAL_KEY[camelot] || camelot;
}

/**
 * Evalúa compatibilidad armónica entre dos tonalidades (Camelot o nombres textuales).
 * Reglas de mezcla armónica DJ:
 * 1. Mismo código (misma clave).
 * 2. Mismo número, diferente letra (cambio a relativo mayor/menor).
 * 3. Misma letra, número adyacente (+1 o -1 en la rueda cíclica 1..12).
 */
export function areKeysHarmonicallyCompatible(
  keyOrCamelotA: string,
  keyOrCamelotB: string
): boolean {
  const codeA = keyToCamelot(keyOrCamelotA);
  const codeB = keyToCamelot(keyOrCamelotB);

  if (!codeA || !codeB) return false;
  if (codeA === codeB) return true;

  const numA = parseInt(codeA.slice(0, -1), 10);
  const letterA = codeA.slice(-1);

  const numB = parseInt(codeB.slice(0, -1), 10);
  const letterB = codeB.slice(-1);

  // Mismo número, diferente letra (relativo)
  if (numA === numB && letterA !== letterB) return true;

  // Misma letra, número adyacente (+1 / -1 circular)
  if (letterA === letterB) {
    const diff = Math.abs(numA - numB);
    if (diff === 1 || diff === 11) return true;
  }

  return false;
}
