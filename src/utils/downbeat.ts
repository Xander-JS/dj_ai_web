/**
 * SYSTEM DJ — Downbeat & Bar Metric Domain Utilities
 * Fase 23.4 — Etapa C.2: Contratos de Datos e Invariantes de Compás
 *
 * PRINCIPIOS CONTRACTUALES OBLIGATORIOS:
 * 1. Una sugerencia algorítmica ('suggested') NUNCA equivale a una confirmación musical.
 * 2. Toda confirmación ('confirmed') procede de una acción humana explícita ('manual').
 * 3. La métrica (beatsPerBar) no se presume como verdad acústica universal; solo existe
 *    si el usuario la ha seleccionado o confirmado explícitamente.
 * 4. Toda confirmación está vinculada estrictamente al contentHash de la pista. Si el contenido
 *    cambia o no se dispone de contentHash verificable, la confirmación queda invalidada.
 */

import type {
  TrackDownbeat,
  ManualDownbeatConfirmation,
} from '../types/track.ts';

/**
 * Crea una estructura de downbeat en estado 'suggested' a partir de una posición calculada.
 * AVISO: Esta estructura es puramente tentativa; nunca habilita operaciones que exijan confirmación.
 */
export function createSuggestedDownbeat(
  suggestedPosition: number | null | undefined
): TrackDownbeat {
  if (
    typeof suggestedPosition !== 'number' ||
    !Number.isFinite(suggestedPosition) ||
    suggestedPosition < 0
  ) {
    return {
      status: 'none',
      suggestedPosition: null,
      confirmation: null,
    };
  }

  return {
    status: 'suggested',
    suggestedPosition: Number(suggestedPosition.toFixed(3)),
    confirmation: null,
  };
}

/**
 * Crea una confirmación manual explícita de downbeat y métrica de compás.
 * Exige posición finita >= 0, métrica entera >= 1 y un contentHash válido de 64 caracteres hex.
 *
 * @throws {TypeError} Si los parámetros no cumplen los invariantes del contrato.
 */
export function createManualDownbeatConfirmation(params: {
  position: number;
  beatsPerBar: number;
  contentHash: string;
  confirmedAt?: number;
  suggestedPosition?: number | null;
}): TrackDownbeat {
  const { position, beatsPerBar, contentHash, confirmedAt, suggestedPosition } = params;

  if (typeof position !== 'number' || !Number.isFinite(position) || position < 0) {
    throw new TypeError(`Posición de downbeat inválida: ${position}. Debe ser un número finito >= 0.`);
  }

  if (
    typeof beatsPerBar !== 'number' ||
    !Number.isFinite(beatsPerBar) ||
    !Number.isInteger(beatsPerBar) ||
    beatsPerBar < 1
  ) {
    throw new TypeError(`Métrica beatsPerBar inválida: ${beatsPerBar}. Debe ser un entero >= 1.`);
  }

  if (
    typeof contentHash !== 'string' ||
    contentHash.length !== 64 ||
    !/^[0-9a-f]{64}$/i.test(contentHash)
  ) {
    throw new TypeError(
      `contentHash inválido para confirmación de downbeat: "${contentHash}". Debe ser una cadena SHA-256 de 64 caracteres hexadecimales.`
    );
  }

  const confirmation: ManualDownbeatConfirmation = {
    position: Number(position.toFixed(3)),
    beatsPerBar,
    contentHash: contentHash.toLowerCase(),
    confirmedAt: confirmedAt ?? Date.now(),
    source: 'manual',
  };

  return {
    status: 'confirmed',
    suggestedPosition: suggestedPosition != null && Number.isFinite(suggestedPosition)
      ? Number(suggestedPosition.toFixed(3))
      : null,
    confirmation,
  };
}

/**
 * Evalúa si una información de downbeat cuenta con una confirmación manual válida.
 * Valida posición finita no negativa, métrica entera positiva, procedencia manual,
 * timestamp válido y huella SHA-256 hexadecimal de 64 caracteres.
 * Si se especifica currentContentHash, exige además concordancia criptográfica exacta con el contenido.
 */
export function isDownbeatConfirmed(
  downbeat?: TrackDownbeat | null,
  currentContentHash?: string
): boolean {
  if (!downbeat || downbeat.status !== 'confirmed' || !downbeat.confirmation) {
    return false;
  }

  const conf = downbeat.confirmation;

  const hasValidPosition =
    typeof conf.position === 'number' && Number.isFinite(conf.position) && conf.position >= 0;
  const hasValidMetric =
    typeof conf.beatsPerBar === 'number' && Number.isInteger(conf.beatsPerBar) && conf.beatsPerBar >= 1;
  const hasValidHash =
    typeof conf.contentHash === 'string' &&
    conf.contentHash.length === 64 &&
    /^[0-9a-f]{64}$/i.test(conf.contentHash);
  const hasValidSource = conf.source === 'manual';
  const hasValidTimestamp =
    typeof conf.confirmedAt === 'number' && Number.isFinite(conf.confirmedAt) && conf.confirmedAt > 0;

  if (!hasValidPosition || !hasValidMetric || !hasValidHash || !hasValidSource || !hasValidTimestamp) {
    return false;
  }

  if (currentContentHash !== undefined) {
    if (
      typeof currentContentHash !== 'string' ||
      currentContentHash.length !== 64 ||
      !/^[0-9a-f]{64}$/i.test(currentContentHash)
    ) {
      return false;
    }
    return conf.contentHash.toLowerCase() === currentContentHash.toLowerCase();
  }

  return true;
}

/**
 * Obtiene la confirmación manual efectiva si y solo si es válida y coincide con el contentHash proporcionado.
 */
export function getEffectiveConfirmedDownbeat(
  downbeat?: TrackDownbeat | null,
  currentContentHash?: string
): ManualDownbeatConfirmation | null {
  if (isDownbeatConfirmed(downbeat, currentContentHash)) {
    return downbeat!.confirmation!;
  }
  return null;
}

/**
 * Valida la estructura de downbeat frente a una identidad de contenido concreta.
 * Si el contenido no tiene hash o la confirmación es inválida o pertenece a otro hash,
 * degrada la confirmación evitando retornar estados contradictorios (p. ej. status 'confirmed' sin confirmación).
 */
export function validateDownbeatForContent(
  downbeat: TrackDownbeat | null | undefined,
  contentHash?: string
): TrackDownbeat | null {
  if (!downbeat) return null;

  if (downbeat.status === 'confirmed') {
    if (!contentHash || !isDownbeatConfirmed(downbeat, contentHash)) {
      // Huella ausente, confirmación no válida o no coincidente: invalidar confirmación
      const validSuggested =
        downbeat.suggestedPosition != null &&
        typeof downbeat.suggestedPosition === 'number' &&
        Number.isFinite(downbeat.suggestedPosition) &&
        downbeat.suggestedPosition >= 0
          ? Number(downbeat.suggestedPosition.toFixed(3))
          : null;

      return validSuggested !== null
        ? { status: 'suggested', suggestedPosition: validSuggested, confirmation: null }
        : { status: 'none', suggestedPosition: null, confirmation: null };
    }
    return downbeat;
  }

  if (downbeat.status === 'suggested') {
    return createSuggestedDownbeat(downbeat.suggestedPosition);
  }

  return { status: 'none', suggestedPosition: null, confirmation: null };
}
