/**
 * SYSTEM DJ — Pulso del altavoz 3D
 * Envolvente de bombo autocontenida que mueve el cono del altavoz de Login y Registro.
 * No hay audio detrás: es un ciclo ambiental. Todo es periódico en LOOP_SECONDS,
 * así que el final del ciclo enlaza con el principio sin salto.
 */

export const SPEAKER_BPM = 124;
export const SPEAKER_LOOP_BEATS = 16;
export const LOOP_SECONDS = (SPEAKER_LOOP_BEATS * 60) / SPEAKER_BPM;

// Acentos por tiempo: el primero de cada compás manda y el resto varía para que no suene a metrónomo
const ACCENTS = [1, 0.62, 0.8, 0.58, 0.94, 0.6, 0.84, 0.66, 1, 0.64, 0.78, 0.56, 0.9, 0.58, 0.86, 0.72];

const DECAY = 7;
const DECAY_FLOOR = Math.exp(-DECAY);
const TAU = Math.PI * 2;

/** Golpe dentro de un tiempo (fase 0..1): ataque rápido, caída exponencial y un rebote amortiguado. Vale 0 en ambos extremos. */
export function kickEnvelope(phase: number): number {
  const attack = 1 - Math.exp(-phase * 45);
  const decay = (Math.exp(-phase * DECAY) - DECAY_FLOOR) / (1 - DECAY_FLOOR);
  const ring = 0.16 * Math.sin(TAU * 3 * phase) * Math.exp(-phase * 9);
  return attack * decay + ring;
}

/**
 * Excursión normalizada del cono en el instante `seconds` (aprox. -0.1..1).
 * `offsetBeats` desplaza el patrón: 0.5 coloca el golpe a contratiempo.
 */
export function speakerPulse(seconds: number, offsetBeats = 0): number {
  const beat = (seconds * SPEAKER_BPM) / 60 + offsetBeats;
  const index = Math.floor(beat);
  const accent = ACCENTS[((index % SPEAKER_LOOP_BEATS) + SPEAKER_LOOP_BEATS) % SPEAKER_LOOP_BEATS];
  // Respiración lenta de la intensidad, con el mismo periodo que el ciclo
  const breath = 0.86 + 0.14 * Math.sin((TAU * seconds) / LOOP_SECONDS);
  return accent * breath * kickEnvelope(beat - index);
}

/** Balanceo secundario del conjunto (-1..1), un vaivén por ciclo. */
export function speakerSway(seconds: number): number {
  return Math.sin((TAU * seconds) / LOOP_SECONDS);
}
