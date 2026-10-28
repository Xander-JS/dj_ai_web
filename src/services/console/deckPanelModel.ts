/**
 * SYSTEM DJ — Modelo del panel de deck (secciones 2 y 3)
 *
 * Reglas puras de lo que muestra cada deck: la franja de avisos sobre el disco, las cuatro teclas
 * de la fila de sincronización (BAR SYNC, ALIGN, SYNC, KEY LOCK) y el mensaje de su display LED.
 * Devuelve claves i18n con sus valores (no texto), así que se prueba en Node sin React.
 */

import type { DeckId } from '../../types/deck';
import type { DeckStoreState } from '../../store/useDJStore';
import type { AnalysisStatus } from '../../types/track';
import { getBarSyncReadiness } from '../../utils/barSyncReadiness.ts';

/** Texto de la interfaz: una clave i18n (sus valores pueden ser otros mensajes) o un texto literal. */
export type PanelMessage =
  | { key: string; values?: Record<string, string | number | PanelMessage> }
  | { text: string };

/** Color de la luz de una tecla o del borde de un aviso. `tone` es el color del deck. */
export type PanelLight = 'tone' | 'amber' | 'green' | 'red' | 'neutral';

export type DeckNoticeId = 'analysis' | 'provisional' | 'role' | 'align' | 'barsync' | 'reference';

export interface DeckNotice {
  id: DeckNoticeId;
  label: PanelMessage;
  tooltip: PanelMessage;
  light: PanelLight;
  /** Solo el aviso de análisis en PENDIENTE o ERROR: lanza el análisis musical. */
  interactive?: boolean;
  /** El estado avanza solo (análisis en curso). */
  busy?: boolean;
}

export interface DeckKey {
  label: PanelMessage;
  tooltip: PanelMessage;
  /** Luz encendida (borde y texto); `null` = tecla apagada. */
  light: PanelLight | null;
  /** SYNC ✓: la tecla se rellena con el color del deck en lugar de iluminar solo el borde. */
  filled?: boolean;
  /** ALIGN en curso: la luz late. */
  pulse?: boolean;
  disabled: boolean;
  /** Estado de interruptor para `aria-pressed` (SYNC y KEY LOCK). */
  pressed?: boolean;
}

export interface DeckSyncKeys {
  barSync: DeckKey;
  align: DeckKey;
  sync: DeckKey;
  keyLock: DeckKey;
}

/** Por qué BAR SYNC no puede prepararse o por qué se rechazó. */
export interface DeckBarSyncHint {
  message: PanelMessage;
  rejected: boolean;
}

export interface DeckPanelInput {
  deckName: DeckId;
  deck: DeckStoreState;
  otherDeck: DeckStoreState;
  syncMasterDeck: DeckId | null;
  /** Posición de la pista en la lista de referencias (semillas), o -1. */
  seedIndex: number;
  /** El usuario acaba de pedir el análisis y la promesa sigue pendiente. */
  isTriggeringAnalysis: boolean;
  /** BAR SYNC se está preparando en este momento (clic en curso). */
  isPreparingBarSync: boolean;
  /** Tolerancia de SYNC en Ajustes, en %. */
  syncLimitPercent: number;
}

/** Lo que necesitan la guía de BAR SYNC y el mensaje del display: los dos decks y el Master. */
export type DeckMessageInput = Pick<DeckPanelInput, 'deckName' | 'deck' | 'otherDeck' | 'syncMasterDeck'>;

const msg = (key: string, values?: Record<string, string | number | PanelMessage>): PanelMessage =>
  values ? { key, values } : { key };

/** Resuelve un mensaje con la función `t` de i18next (los valores anidados se traducen antes). */
export function translatePanelMessage(
  t: (key: string, values?: Record<string, string | number>) => string,
  message: PanelMessage,
): string {
  if ('text' in message) return message.text;
  if (!message.values) return t(message.key);
  const values: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(message.values)) {
    values[name] = typeof value === 'object' ? translatePanelMessage(t, value) : value;
  }
  return t(message.key, values);
}

const formatDeltaSigned = (val: number | null | undefined): string => {
  if (val === null || val === undefined || Math.abs(val) < 0.0005) return '0.000';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(3)}`;
};

const REJECTION_REASONS = new Set([
  'rejected_state',
  'rejected_unconfirmed',
  'rejected_no_downbeat',
  'rejected_metric_mismatch',
  'rejected_limits',
  'rejected_confidence',
  'rejected_tempo_mismatch',
]);

/** Valores derivados que comparten avisos, teclas y guía. */
function derive(input: DeckMessageInput) {
  const { deck, otherDeck, deckName, syncMasterDeck } = input;
  const otherDeckName: DeckId = deckName === 'A' ? 'B' : 'A';
  const track = deck.track;
  const hasTrack = Boolean(track);
  const isLoading = deck.playbackState === 'loading';
  const isPlaying = deck.playbackState === 'playing';
  const isMaster = deck.isMaster || syncMasterDeck === deckName;
  const isOtherMaster = otherDeck.isMaster || syncMasterDeck === otherDeckName;
  const pitchLabel = `${deck.playbackRate >= 1 ? '+' : ''}${((deck.playbackRate - 1) * 100).toFixed(2)}%`;
  const masterBpmLabel = otherDeck.calculatedBpm !== null ? otherDeck.calculatedBpm.toFixed(1) : '—';
  const barSync = deck.barSync;
  const barSyncStatus = barSync?.status || 'idle';
  const isBarSyncRejected = barSyncStatus.startsWith('rejected_');
  const barSyncReasonKey = REJECTION_REASONS.has(barSyncStatus) ? `dj.bar_sync_reason_${barSyncStatus}` : 'dj.bar_sync_reason_generic';
  const readiness = getBarSyncReadiness(
    { track: track ?? null, playbackState: deck.playbackState, isMaster, effectiveBpm: deck.calculatedBpm },
    { track: otherDeck.track ?? null, playbackState: otherDeck.playbackState, isMaster: isOtherMaster, effectiveBpm: otherDeck.calculatedBpm },
  );
  const barSyncBlockMessage = readiness.ready
    ? null
    : msg(`dj.bar_sync_block_${readiness.reason}`, { master: otherDeckName, ...readiness.values });
  return {
    otherDeckName,
    track,
    hasTrack,
    isLoading,
    isPlaying,
    isMaster,
    pitchLabel,
    masterBpmLabel,
    barSync,
    barSyncStatus,
    isBarSyncRejected,
    barSyncReasonKey,
    barSyncBlockMessage,
  };
}

/** Explicación de ALIGN según su último resultado (tooltip de la tecla y del aviso). */
function alignTooltip(deck: DeckStoreState): PanelMessage {
  switch (deck.phaseAlignment?.status) {
    case 'rejected_limits':
      return msg('dj.phase_align_rejected_limits');
    case 'rejected_confidence':
      return msg('dj.phase_align_rejected_confidence');
    case 'rejected_state':
      return msg('dj.phase_align_rejected_state');
    case 'already_aligned':
      return msg('dj.phase_align_already_aligned');
    case 'cancelled':
      return msg('dj.phase_align_cancelled');
    case 'completed':
      return msg('dj.phase_align_completed_tooltip');
    default:
      return msg('dj.phase_align_tooltip');
  }
}

/** Estado de ALIGN tal como se lee en el aviso (`ALIGN · …`). */
function alignStateLabel(deck: DeckStoreState): PanelMessage {
  const alignment = deck.phaseAlignment;
  switch (alignment?.status) {
    case 'active':
      return msg('dj.phase_align_active', { percent: Math.round(alignment.progressPercent) });
    case 'completed':
      return msg('dj.phase_align_completed');
    case 'cancelled':
      return msg('dj.phase_align_cancelled');
    case 'rejected_limits':
      return msg('dj.phase_align_rejected_limits');
    case 'rejected_confidence':
      return msg('dj.phase_align_rejected_confidence');
    case 'already_aligned':
      return msg('dj.phase_align_already_aligned');
    case 'rejected_state':
      return msg('dj.phase_align_rejected_state');
    default:
      return { text: alignment?.status ?? '' };
  }
}

function alignLight(deck: DeckStoreState): PanelLight {
  const status = deck.phaseAlignment?.status;
  if (status === 'active') return 'tone';
  if (status === 'completed' || status === 'already_aligned') return 'green';
  if (status?.startsWith('rejected_')) return 'red';
  return 'neutral';
}

/** Detalle de BAR SYNC en el tooltip del aviso: posiciones y desplazamiento de la preparación. */
function barSyncNoticeTooltip(d: ReturnType<typeof derive>): PanelMessage {
  const barSync = d.barSync;
  if ((barSync.status as string) === 'preparing') return msg('dj.bar_sync_preparing');
  if (barSync.status === 'armed') {
    return msg('dj.bar_sync_armed_badge_tooltip', {
      prepared: barSync.preparedPosition?.toFixed(3) ?? '0.000',
      prev: barSync.previousPosition?.toFixed(3) ?? '0.000',
      disp: formatDeltaSigned(barSync.displacementSec),
      target: barSync.targetDownbeatSec?.toFixed(3) ?? '0.000',
      beats: barSync.beatsPerBar ?? 4,
    });
  }
  if (barSync.status === 'already_aligned') {
    return msg('dj.bar_sync_already_aligned_badge_tooltip', {
      prepared: barSync.preparedPosition?.toFixed(3) ?? '0.000',
      prev: barSync.previousPosition?.toFixed(3) ?? '0.000',
      disp: formatDeltaSigned(barSync.displacementSec),
      beats: barSync.beatsPerBar ?? 4,
    });
  }
  if (barSync.status === 'completed') return msg('dj.bar_sync_completed_tooltip');
  if (barSync.status === 'cancelled') return msg('dj.bar_sync_cancelled_tooltip');
  return msg(d.barSyncReasonKey);
}

/** Palabra de estado de BAR SYNC: la misma en la tecla y en el aviso. */
function barSyncStateLabel(status: string, isPreparing: boolean): PanelMessage {
  if (isPreparing || status === 'preparing') return msg('dj.bar_sync_preparing');
  if (status === 'armed') return msg('dj.bar_sync_armed');
  if (status === 'already_aligned') return msg('dj.bar_sync_already_aligned');
  if (status === 'completed') return msg('dj.bar_sync_completed');
  if (status === 'cancelled') return msg('dj.bar_sync_cancelled');
  if (status.startsWith('rejected_')) return msg('dj.bar_sync_rejected');
  return msg('dj.bar_sync');
}

function barSyncLight(status: string): PanelLight | null {
  if (status === 'armed') return 'amber';
  if (status === 'already_aligned') return 'tone';
  if (status === 'completed') return 'green';
  if (status.startsWith('rejected_')) return 'red';
  return null;
}

const ANALYSIS_TOOLTIP_KEYS: Record<AnalysisStatus, string> = {
  pending: 'library.status_pending_title',
  analyzing: 'library.status_analyzing_title',
  analyzed: 'library.status_analyzed_title',
  failed: 'library.status_failed_title',
  unsupported: 'library.status_unsupported_title',
};

const ANALYSIS_LIGHTS: Record<AnalysisStatus, PanelLight> = {
  pending: 'neutral',
  analyzing: 'neutral',
  analyzed: 'green',
  failed: 'red',
  unsupported: 'amber',
};

/** Estado del análisis musical de la pista cargada (`null` sin pista). */
export function getDeckAnalysisStatus(deck: DeckStoreState): AnalysisStatus | null {
  return deck.track?.analysis?.status || (deck.track ? 'pending' : null);
}

/**
 * Avisos de la franja sobre el disco, en orden de lectura. Cada uno aparece solo cuando su estado
 * aplica. Los de downbeat y compás no están aquí: los muestra la sección 5 / 6.
 */
export function getDeckNotices(input: DeckPanelInput): DeckNotice[] {
  const d = derive(input);
  const { deck } = input;
  const notices: DeckNotice[] = [];
  const analysis = d.track?.analysis;

  const analysisStatus = getDeckAnalysisStatus(deck);
  if (analysisStatus) {
    const busy = analysisStatus === 'analyzing' || input.isTriggeringAnalysis;
    const shown: AnalysisStatus = busy ? 'analyzing' : analysisStatus;
    const errorText = (shown === 'failed' || shown === 'unsupported') && analysis?.analysisError ? analysis.analysisError : null;
    notices.push({
      id: 'analysis',
      label: msg(`library.status_${shown}`),
      tooltip: errorText ? { text: errorText } : msg(ANALYSIS_TOOLTIP_KEYS[shown]),
      light: ANALYSIS_LIGHTS[shown],
      interactive: !busy && (analysisStatus === 'pending' || analysisStatus === 'failed'),
      busy,
    });
  }

  const hasProvisionalGrid = analysis?.status === 'analyzed' && typeof analysis.firstBeatTime === 'number' && typeof analysis.bpm === 'number';
  if (hasProvisionalGrid) {
    notices.push({ id: 'provisional', label: msg('dj.phase_align_badge_prov'), tooltip: msg('dj.phase_align_grid_tooltip'), light: 'amber' });
  }

  if (d.isMaster) {
    notices.push({ id: 'role', label: msg('dj.role_master'), tooltip: msg('dj.role_master_tooltip'), light: 'tone' });
  } else if (deck.isSyncActive) {
    notices.push({
      id: 'role',
      label: msg('dj.role_slave', { master: d.otherDeckName }),
      tooltip: msg('dj.role_slave_tooltip', { master: d.otherDeckName, bpm: d.masterBpmLabel, pitch: d.pitchLabel, limit: input.syncLimitPercent }),
      light: 'tone',
    });
  }

  if (deck.phaseAlignment && deck.phaseAlignment.status !== 'idle') {
    notices.push({
      id: 'align',
      label: msg('dj.align_notice', { state: alignStateLabel(deck) }),
      tooltip: alignTooltip(deck),
      light: alignLight(deck),
    });
  }

  if (d.barSync && d.barSync.status !== 'idle') {
    notices.push({
      id: 'barsync',
      label: msg('dj.bar_sync_notice', { state: barSyncStateLabel(d.barSyncStatus, false) }),
      tooltip: barSyncNoticeTooltip(d),
      light: barSyncLight(d.barSyncStatus) ?? 'neutral',
    });
  }

  if (input.seedIndex >= 0) {
    notices.push({ id: 'reference', label: msg('seed.badge', { index: input.seedIndex + 1 }), tooltip: msg('seed.badge_title'), light: 'neutral' });
  }

  return notices;
}

/** Las cuatro teclas de la fila de sincronización, de izquierda a derecha en ambos decks. */
export function getDeckSyncKeys(input: DeckPanelInput): DeckSyncKeys {
  const d = derive(input);
  const { deck } = input;
  const noTrack = !d.hasTrack || d.isLoading;

  // BAR SYNC
  const barSync = d.barSync;
  const isPreparing = input.isPreparingBarSync || (d.barSyncStatus as string) === 'preparing';
  let barSyncTooltip: PanelMessage;
  if (isPreparing) {
    barSyncTooltip = msg('dj.bar_sync_preparing');
  } else if (d.barSyncStatus === 'armed' || d.barSyncStatus === 'already_aligned') {
    barSyncTooltip = msg(d.barSyncStatus === 'armed' ? 'dj.bar_sync_armed_btn_tooltip' : 'dj.bar_sync_aligned_btn_tooltip', {
      prepared: barSync?.preparedPosition?.toFixed(3) ?? '0.000',
      prev: barSync?.previousPosition?.toFixed(3) ?? '0.000',
      disp: formatDeltaSigned(barSync?.displacementSec),
      beats: barSync?.beatsPerBar ?? 4,
    });
  } else if (d.barSyncStatus === 'completed') {
    barSyncTooltip = msg('dj.bar_sync_completed_tooltip');
  } else if (d.barSyncStatus === 'cancelled') {
    barSyncTooltip = msg('dj.bar_sync_cancelled_tooltip');
  } else if (d.isBarSyncRejected) {
    barSyncTooltip = msg(d.barSyncReasonKey);
  } else if (d.barSyncBlockMessage) {
    barSyncTooltip = msg('dj.bar_sync_tooltip_blocked', { base: msg('dj.bar_sync_tooltip'), reason: d.barSyncBlockMessage });
  } else {
    barSyncTooltip = msg('dj.bar_sync_tooltip');
  }

  // ALIGN
  const alignment = deck.phaseAlignment;
  const isAligning = alignment?.status === 'active';
  const alignStatus = alignment?.status;

  // SYNC
  const syncTooltip = d.isMaster
    ? msg('dj.sync_master_tooltip')
    : deck.isSyncActive
      ? msg('dj.sync_active_tooltip_detail', { master: d.otherDeckName, bpm: d.masterBpmLabel, pitch: d.pitchLabel, limit: input.syncLimitPercent })
      : msg('dj.sync_tooltip', { limit: input.syncLimitPercent });

  return {
    barSync: {
      label: barSyncStateLabel(d.barSyncStatus, isPreparing),
      tooltip: barSyncTooltip,
      light: isPreparing ? null : barSyncLight(d.barSyncStatus),
      disabled: noTrack || input.isPreparingBarSync,
    },
    align: {
      label: isAligning ? { text: `${Math.round(alignment?.progressPercent || 0)}%` } : msg('dj.phase_align'),
      tooltip: alignTooltip(deck),
      light: isAligning ? 'tone' : alignStatus === 'completed' ? 'green' : alignStatus?.startsWith('rejected_') ? 'red' : null,
      pulse: isAligning,
      disabled: noTrack || !d.isPlaying,
    },
    sync: {
      label: d.isMaster ? msg('dj.master') : deck.isSyncActive ? msg('dj.sync_on') : msg('dj.sync'),
      tooltip: syncTooltip,
      light: d.isMaster ? 'amber' : deck.isSyncActive ? 'tone' : null,
      filled: !d.isMaster && deck.isSyncActive,
      disabled: noTrack,
      pressed: deck.isSyncActive,
    },
    keyLock: {
      label: msg('dj.key_lock'),
      tooltip: msg(deck.isKeyLocked ? 'dj.key_lock_on_tooltip' : 'dj.key_lock_off_tooltip'),
      light: deck.isKeyLocked ? 'tone' : null,
      disabled: false,
      pressed: deck.isKeyLocked,
    },
  };
}

/** Guía de BAR SYNC, o `null` si BAR SYNC puede usarse y no hay rechazo. */
export function getDeckBarSyncHint(input: DeckMessageInput): DeckBarSyncHint | null {
  const d = derive(input);
  if (!d.hasTrack) return null;
  if (d.isBarSyncRejected) return { message: msg(d.barSyncReasonKey), rejected: true };
  if (d.barSyncBlockMessage) return { message: d.barSyncBlockMessage, rejected: false };
  return null;
}

/** Prioridad del mensaje del display LED: error (rojo) > warning (ámbar) > guide (blanco suave). */
export type DeckMessageLevel = 'error' | 'warning' | 'guide';

export interface DeckMessage {
  level: DeckMessageLevel;
  message: PanelMessage;
}

const LEVEL_RANK: Record<DeckMessageLevel, number> = { error: 0, warning: 1, guide: 2 };

/**
 * Mensaje del display LED del deck: el de mayor prioridad entre el rechazo de SYNC, el error de
 * reproducción, el rechazo o bloqueo de BAR SYNC, el loop sin BPM y «Carga una pista» con el deck vacío.
 */
export function getDeckMessage(input: DeckMessageInput): DeckMessage | null {
  const { deck } = input;
  const candidates: DeckMessage[] = [];
  if (deck.errorCode === 'sync_failed' && deck.syncFeedback) {
    candidates.push({ level: 'error', message: msg(deck.syncFeedback.key, deck.syncFeedback.values) });
  }
  if (deck.playbackState === 'error' && deck.errorMessage) {
    candidates.push({ level: 'error', message: { text: deck.errorMessage } });
  }
  // Respuesta a una pulsación: antes que el bloqueo de BAR SYNC del mismo nivel. Desaparece al llegar el BPM
  if (deck.loop.warning && deck.calculatedBpm === null) candidates.push({ level: 'warning', message: msg('dj.loop_requires_bpm') });
  const hint = getDeckBarSyncHint(input);
  if (hint) {
    // Ser el Master no se corrige: es una indicación, no un bloqueo
    const isInfo = 'key' in hint.message && hint.message.key === 'dj.bar_sync_block_is_master';
    candidates.push({
      level: hint.rejected ? 'error' : isInfo ? 'guide' : 'warning',
      message: msg('dj.display_bar_sync', { message: hint.message }),
    });
  }
  if (!deck.track) candidates.push({ level: 'guide', message: msg('dj.display_load_track') });
  return candidates.reduce<DeckMessage | null>((best, c) => (!best || LEVEL_RANK[c.level] < LEVEL_RANK[best.level] ? c : best), null);
}
