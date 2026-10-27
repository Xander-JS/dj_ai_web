/**
 * SYSTEM DJ — Modelo del módulo DOWNBEAT & COMPÁS (secciones 5 y 6)
 *
 * Reglas puras del módulo de cada deck: qué LEDs de estado se encienden, la posición del knob de
 * fuente (CAB · OFF · SUG) y su posición candidata, las cuatro posiciones del fader de métrica,
 * el LED de cambio pendiente de CONFIRMAR y cuándo CONFIRMAR / LIMPIAR están disponibles.
 * Devuelve claves i18n (no texto), así que se prueba en Node sin React.
 */

import type { ConfirmDownbeatParams } from '../../store/useDJStore';
import type { BeatUnit, DownbeatOrigin, Track } from '../../types/track';
import { getDeckMeter } from '../../utils/barSyncReadiness.ts';
import type { PanelMessage } from './deckPanelModel';

/** Posición del knob de fuente. `playhead` = CAB, `suggested` = SUG. */
export type DownbeatSource = 'playhead' | 'off' | 'suggested';

/** Orden físico de las posiciones, de izquierda a derecha (CAB a la izquierda, OFF arriba, SUG a la derecha). */
export const SOURCE_POSITIONS: readonly DownbeatSource[] = ['playhead', 'off', 'suggested'];

/** Orden de giro al pulsar el knob: CAB → OFF → SUG → CAB. */
const CLICK_ORDER: readonly DownbeatSource[] = ['playhead', 'off', 'suggested'];

/** Las cuatro posiciones fijas del fader de métrica: pulsos por compás / unidad de nota. */
export const METER_DETENTS: ReadonlyArray<{ readonly beatsPerBar: number; readonly beatUnit: BeatUnit }> = [
  { beatsPerBar: 4, beatUnit: 4 },
  { beatsPerBar: 3, beatUnit: 4 },
  { beatsPerBar: 2, beatUnit: 4 },
  { beatsPerBar: 6, beatUnit: 8 },
];

export const formatDetent = (index: number): string => {
  const detent = METER_DETENTS[index] ?? METER_DETENTS[0];
  return `${detent.beatsPerBar}/${detent.beatUnit}`;
};

/** Tolerancia para comparar posiciones redondeadas a milisegundos. */
const POSITION_EPSILON = 0.0005;

const roundToMs = (seconds: number): number => Number(seconds.toFixed(3));

const isValidPosition = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const isValidContentHash = (hash: unknown): hash is string =>
  typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash);

/** Confirmación manual válida para el audio cargado (huella SHA-256 coincidente). */
export interface ConfirmedDownbeat {
  position: number;
  beatsPerBar: number;
  /** `null` en confirmaciones antiguas sin unidad de nota. */
  beatUnit: BeatUnit | null;
  origin: DownbeatOrigin;
}

/** Lo que el módulo necesita saber de la pista cargada. */
export interface DownbeatTrackFacts {
  hasTrack: boolean;
  /** `downbeat.suggestedPosition`, o `firstBeatTime` del análisis si no existe. */
  suggestedPosition: number | null;
  confirmed: ConfirmedDownbeat | null;
  hasValidHash: boolean;
  /** Downbeat confirmado sin unidad de nota: BAR SYNC lo rechaza hasta confirmar de nuevo. */
  noteValueMissing: boolean;
  duration: number;
}

export function getDownbeatTrackFacts(track: Track | null | undefined, duration = 0): DownbeatTrackFacts {
  if (!track) {
    return { hasTrack: false, suggestedPosition: null, confirmed: null, hasValidHash: false, noteValueMissing: false, duration: 0 };
  }
  const rawSuggested = track.downbeat?.suggestedPosition ?? track.analysis?.firstBeatTime;
  const suggestedPosition = isValidPosition(rawSuggested) ? rawSuggested : null;
  const meter = getDeckMeter(track);
  const confirmation = meter.downbeatConfirmed ? track.downbeat?.confirmation ?? null : null;
  const confirmed: ConfirmedDownbeat | null = confirmation
    ? {
        position: confirmation.position,
        beatsPerBar: confirmation.beatsPerBar,
        beatUnit: meter.beatUnit,
        origin: confirmation.origin ?? inferOrigin(confirmation.position, suggestedPosition),
      }
    : null;
  return {
    hasTrack: true,
    suggestedPosition,
    confirmed,
    hasValidHash: isValidContentHash(track.fileMeta?.contentHash),
    noteValueMissing: confirmed !== null && confirmed.beatUnit === null,
    duration,
  };
}

/** Confirmaciones guardadas antes del módulo: si coinciden con la sugerencia vienen de SUG, si no del cabezal. */
function inferOrigin(position: number, suggestedPosition: number | null): DownbeatOrigin {
  return suggestedPosition !== null && Math.abs(position - roundToMs(suggestedPosition)) < POSITION_EPSILON
    ? 'suggested'
    : 'playhead';
}

/** Lo elegido ahora en el módulo (aún sin confirmar). */
export interface DownbeatSelection {
  source: DownbeatSource;
  /** Posición candidata del downbeat; `null` con el knob en OFF. */
  candidate: number | null;
  meterIndex: number;
}

export function detentIndexFor(beatsPerBar: number, beatUnit: BeatUnit | null): number {
  const exact = METER_DETENTS.findIndex((d) => d.beatsPerBar === beatsPerBar && d.beatUnit === beatUnit);
  if (exact !== -1) return exact;
  const sameBeats = METER_DETENTS.findIndex((d) => d.beatsPerBar === beatsPerBar);
  return sameBeats === -1 ? 0 : sameBeats;
}

/**
 * Estado del módulo al cargar la pista: la fuente con la que se confirmó; si no hay confirmación,
 * SUG cuando existe una posición sugerida, y si no OFF. La métrica confirmada, o 4/4.
 */
export function getInitialSelection(facts: DownbeatTrackFacts): DownbeatSelection {
  if (facts.confirmed) {
    return {
      source: facts.confirmed.origin,
      candidate: facts.confirmed.position,
      meterIndex: detentIndexFor(facts.confirmed.beatsPerBar, facts.confirmed.beatUnit),
    };
  }
  if (facts.suggestedPosition !== null) {
    return { source: 'suggested', candidate: facts.suggestedPosition, meterIndex: 0 };
  }
  return { source: 'off', candidate: null, meterIndex: 0 };
}

export const isSourceAvailable = (facts: DownbeatTrackFacts, source: DownbeatSource): boolean =>
  source !== 'suggested' || facts.suggestedPosition !== null;

/**
 * Girar el knob a `source`. CAB captura el cabezal en ese instante (volver a elegir CAB captura de
 * nuevo); SUG toma la posición sugerida. Devuelve `null` si la posición no está disponible.
 */
export function selectSource(
  facts: DownbeatTrackFacts,
  selection: DownbeatSelection,
  source: DownbeatSource,
  playheadTime: number,
): DownbeatSelection | null {
  if (!facts.hasTrack || !isSourceAvailable(facts, source)) return null;
  if (source === 'playhead') return { ...selection, source, candidate: roundToMs(Math.max(0, playheadTime)) };
  if (source === 'suggested') return { ...selection, source, candidate: facts.suggestedPosition };
  return { ...selection, source, candidate: null };
}

/** Siguiente posición al pulsar el knob (CAB → OFF → SUG → CAB), saltando SUG si no está disponible. */
export function nextSourceOnClick(facts: DownbeatTrackFacts, current: DownbeatSource): DownbeatSource {
  let index = CLICK_ORDER.indexOf(current);
  for (let step = 0; step < CLICK_ORDER.length; step++) {
    index = (index + 1) % CLICK_ORDER.length;
    if (isSourceAvailable(facts, CLICK_ORDER[index])) return CLICK_ORDER[index];
  }
  return current;
}

/** Flechas con el foco en el knob: un paso a la izquierda (hacia CAB) o a la derecha (hacia SUG), sin dar la vuelta. */
export function stepSource(facts: DownbeatTrackFacts, current: DownbeatSource, direction: -1 | 1): DownbeatSource {
  const next = SOURCE_POSITIONS[SOURCE_POSITIONS.indexOf(current) + direction];
  return next && isSourceAvailable(facts, next) ? next : current;
}

export interface DownbeatStatusLeds {
  unconfirmed: boolean;
  playhead: boolean;
  suggested: boolean;
  confirmed: boolean;
}

/**
 * Sin confirmación: un solo LED, el de la posición actual del knob. Con confirmación: CONFIRMADO y
 * el LED de la fuente con la que se confirmó, fijos aunque luego se gire el knob o se mueva el fader.
 * Sin pista, todo apagado.
 */
export function getStatusLeds(facts: DownbeatTrackFacts, selection: DownbeatSelection): DownbeatStatusLeds {
  if (!facts.hasTrack) return { unconfirmed: false, playhead: false, suggested: false, confirmed: false };
  if (facts.confirmed) {
    return {
      unconfirmed: false,
      playhead: facts.confirmed.origin === 'playhead',
      suggested: facts.confirmed.origin === 'suggested',
      confirmed: true,
    };
  }
  return {
    unconfirmed: selection.source === 'off',
    playhead: selection.source === 'playhead',
    suggested: selection.source === 'suggested',
    confirmed: false,
  };
}

/**
 * LED de CONFIRMAR: parpadea si hay algo sin confirmar (fuente elegida sin confirmación, o fuente,
 * posición o métrica distintas de lo confirmado). Apagado en OFF o cuando todo coincide.
 */
export function hasPendingChange(facts: DownbeatTrackFacts, selection: DownbeatSelection): boolean {
  if (!facts.hasTrack || selection.source === 'off' || selection.candidate === null) return false;
  const { confirmed } = facts;
  if (!confirmed) return true;
  const detent = METER_DETENTS[selection.meterIndex];
  return (
    selection.source !== confirmed.origin ||
    Math.abs(roundToMs(selection.candidate) - confirmed.position) >= POSITION_EPSILON ||
    detent.beatsPerBar !== confirmed.beatsPerBar ||
    detent.beatUnit !== confirmed.beatUnit
  );
}

/** Estado de un botón: atenuado o no, y su tooltip (la causa si está atenuado). */
export interface DownbeatButtonState {
  disabled: boolean;
  tooltip: PanelMessage;
}

export interface DownbeatBusyState {
  /** Guardado o borrado en curso: todo el módulo queda bloqueado. */
  saving: boolean;
  /** Pista cargándose o en error: el store rechazaría la confirmación. */
  unavailable: boolean;
}

export function getConfirmButton(
  facts: DownbeatTrackFacts,
  selection: DownbeatSelection,
  busy: DownbeatBusyState,
): DownbeatButtonState {
  if (facts.hasTrack && !facts.hasValidHash) {
    return { disabled: true, tooltip: { key: 'dj.downbeat_btn_confirm_disabled_hash' } };
  }
  if (facts.hasTrack && selection.source === 'off') {
    return { disabled: true, tooltip: { key: 'dj.downbeat_btn_confirm_disabled_off' } };
  }
  const disabled = !facts.hasTrack || busy.saving || busy.unavailable || selection.candidate === null;
  return { disabled, tooltip: { key: 'dj.downbeat_btn_confirm_tooltip' } };
}

export function getClearButton(facts: DownbeatTrackFacts, busy: DownbeatBusyState): DownbeatButtonState {
  if (facts.hasTrack && !facts.confirmed) {
    return { disabled: true, tooltip: { key: 'dj.downbeat_btn_clear_disabled' } };
  }
  return {
    disabled: !facts.hasTrack || busy.saving || busy.unavailable,
    tooltip: { key: 'dj.downbeat_btn_clear_tooltip' },
  };
}

/** `mm:ss.mmm` del cabezal para el mini display de posición (`00:00.000` sin pista). */
export function formatDownbeatClock(seconds: number): string {
  const totalMs = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000));
  const minutes = Math.floor(totalMs / 60000);
  const secondsPart = (totalMs % 60000) / 1000;
  return `${String(minutes).padStart(2, '0')}:${secondsPart.toFixed(3).padStart(6, '0')}`;
}

/** Tooltip del display de posición: el downbeat confirmado o, si no hay, la posición candidata. */
export function getPositionTooltip(facts: DownbeatTrackFacts, selection: DownbeatSelection): PanelMessage {
  if (facts.confirmed) {
    return { key: 'dj.downbeat_position_confirmed', values: { position: facts.confirmed.position.toFixed(3) } };
  }
  if (facts.hasTrack && selection.candidate !== null) {
    return { key: 'dj.downbeat_position_candidate', values: { position: selection.candidate.toFixed(3) } };
  }
  return { key: 'dj.downbeat_position_none' };
}

/**
 * Parámetros de `confirmDownbeat` para lo elegido, o `null` si la posición no es válida para la
 * pista (fuera de 0…duración): el módulo lo avisa con un toast.
 */
export function buildConfirmParams(facts: DownbeatTrackFacts, selection: DownbeatSelection): ConfirmDownbeatParams | null {
  const { candidate, source } = selection;
  if (source === 'off' || !isValidPosition(candidate)) return null;
  const position = roundToMs(candidate);
  if (facts.duration > 0 && position > facts.duration) return null;
  const detent = METER_DETENTS[selection.meterIndex] ?? METER_DETENTS[0];
  return {
    position,
    beatsPerBar: detent.beatsPerBar,
    beatUnit: detent.beatUnit,
    suggestedPosition: facts.suggestedPosition,
    origin: source,
  };
}
