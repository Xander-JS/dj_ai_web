import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { useDJStore } from '../../../store/useDJStore';
import { audioEngine } from '../../../audio';
import { toastStore } from '../../../services/notifications/toastService';
import type { DeckId } from '../../../types/deck';
import {
  buildConfirmParams,
  formatDownbeatClock,
  getClearButton,
  getConfirmButton,
  getDownbeatTrackFacts,
  getInitialSelection,
  getPositionTooltip,
  getStatusLeds,
  hasPendingChange,
  isSourceAvailable,
  nextSourceOnClick,
  selectSource,
  stepSource,
  type DownbeatSource,
} from '../../../services/console/downbeatPanelModel';
import { translatePanelMessage } from '../../../services/console/deckPanelModel';
import { ConsoleLed } from '../atoms/ConsoleLed';
import { ConsoleSelectorKnob, type SelectorKnobPosition } from '../atoms/ConsoleSelectorKnob';
import { DownbeatStatusLeds } from '../molecules/DownbeatStatusLeds';
import { DownbeatMeterZone } from '../molecules/DownbeatMeterZone';
import { DownbeatActions } from '../molecules/DownbeatActions';
import './DownbeatPanel.css';

export interface DownbeatPanelProps {
  deckName: DeckId;
}

const SOURCE_ANGLES: Record<DownbeatSource, number> = { playhead: -55, off: 0, suggested: 55 };

/**
 * DOWNBEAT & COMPÁS (secciones 5 y 6): prepara la pista para BAR SYNC. De izquierda a derecha,
 * los LEDs de estado, la posición y la métrica, el knob de fuente y las acciones. Lo elegido aquí
 * no se guarda hasta pulsar CONFIRMAR; la confirmación vive en la pista (ambos decks la ven).
 */
export const DownbeatPanel: React.FC<DownbeatPanelProps> = ({ deckName }) => {
  const { t } = useTranslation();
  const { deckA, deckB, confirmDownbeat, clearDownbeat } = useDJStore();
  const deck = deckName === 'A' ? deckA : deckB;
  const id = deckName.toLowerCase();
  const testIdPrefix = `deck-${id}-downbeat`;
  const titleId = `downbeat-panel-${id}-title`;

  const facts = getDownbeatTrackFacts(deck.track, deck.duration);
  const trackId = deck.track?.id ?? null;
  const confirmedAt = facts.confirmed ? deck.track?.downbeat?.confirmation?.confirmedAt ?? null : null;

  const [selection, setSelection] = useState(() => getInitialSelection(facts));
  const [isSaving, setIsSaving] = useState(false);
  // CAB tras CONFIRMAR: el display se congela en lo confirmado hasta sacar el knob de CAB
  const [frozen, setFrozen] = useState(false);
  const [synced, setSynced] = useState({ trackId, confirmedAt });

  // Otra pista: el knob vuelve a OFF. Confirmación nueva (también desde el otro deck con la misma
  // pista): el fader sigue a la métrica confirmada. Al limpiar, el display vuelve a seguir al knob.
  if (synced.trackId !== trackId || synced.confirmedAt !== confirmedAt) {
    setSynced({ trackId, confirmedAt });
    if (synced.trackId !== trackId) {
      setSelection(getInitialSelection(facts));
      setFrozen(false);
      setIsSaving(false);
    } else if (confirmedAt === null) {
      setFrozen(false);
    } else {
      setSelection((current) => ({ ...current, meterIndex: getInitialSelection(facts).meterIndex }));
    }
  }

  // En CAB la posición candidata es el cabezal en vivo, o la confirmada si está congelado
  const current = selection.source !== 'playhead'
    ? selection
    : { ...selection, candidate: frozen && facts.confirmed ? facts.confirmed.position : Math.max(0, deck.currentTime) };

  const busy = {
    saving: isSaving,
    unavailable: deck.playbackState === 'loading' || deck.playbackState === 'error',
  };
  const locked = !facts.hasTrack || busy.saving || busy.unavailable;
  const leds = getStatusLeds(facts, current);
  const pending = hasPendingChange(facts, current);
  const confirm = getConfirmButton(facts, current, busy);
  const clear = getClearButton(facts, busy);
  const positionTooltip = translatePanelMessage(t, getPositionTooltip(facts, current));

  const turnTo = (source: DownbeatSource) => {
    if (locked || source === selection.source) return;
    const next = selectSource(facts, selection, source, deck.currentTime);
    if (!next) return;
    setSelection(next);
    setFrozen(false);
  };

  const handleConfirm = async () => {
    if (confirm.disabled || locked) return;
    // CAB: la posición exacta del motor ahora, no la del refresco del store (~100 ms)
    const candidate = current.source === 'playhead' ? audioEngine.getDeckCurrentTime(deckName) : current.candidate;
    const params = buildConfirmParams(facts, { ...current, candidate });
    if (!params) {
      toastStore.show('error', t('dj.downbeat_error_invalid_pos'));
      return;
    }
    setIsSaving(true);
    try {
      if (await confirmDownbeat(deckName, params)) setFrozen(true);
      else toastStore.show('error', t('dj.downbeat_error_persist'));
    } catch {
      toastStore.show('error', t('dj.downbeat_error_persist'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (clear.disabled || locked) return;
    setIsSaving(true);
    try {
      if (!(await clearDownbeat(deckName))) toastStore.show('error', t('dj.downbeat_error_persist'));
    } catch {
      toastStore.show('error', t('dj.downbeat_error_persist'));
    } finally {
      setIsSaving(false);
    }
  };

  const suggestedAvailable = isSourceAvailable(facts, 'suggested');
  const positions: ReadonlyArray<SelectorKnobPosition<DownbeatSource>> = [
    { id: 'playhead', label: t('dj.downbeat_source_playhead_short'), angle: SOURCE_ANGLES.playhead, placement: 'start', title: t('dj.downbeat_source_playhead_tooltip') },
    { id: 'off', label: t('dj.downbeat_source_off_short'), angle: SOURCE_ANGLES.off, placement: 'top', title: t('dj.downbeat_source_off_tooltip') },
    {
      id: 'suggested',
      label: t('dj.downbeat_source_suggested_short'),
      angle: SOURCE_ANGLES.suggested,
      placement: 'end',
      disabled: !suggestedAvailable,
      title: t(suggestedAvailable ? 'dj.downbeat_source_suggested_tooltip' : 'dj.downbeat_source_suggested_unavailable'),
    },
  ];
  const sourceNames: Record<DownbeatSource, string> = {
    playhead: t('dj.downbeat_source_playhead'),
    off: t('dj.downbeat_source_off'),
    suggested: t('dj.downbeat_source_suggested'),
  };

  const confirmedTooltip = facts.hasTrack && !facts.hasValidHash
    ? t('dj.downbeat_missing_hash_explanation')
    : facts.confirmed ? positionTooltip : undefined;

  return (
    <section
      className={clsx('downbeat-panel', `console-tone-${id}`, locked && 'is-locked')}
      aria-labelledby={titleId}
      aria-busy={isSaving || undefined}
      data-testid={`${testIdPrefix}-panel`}
    >
      <header className="downbeat-panel__header">
        <h2 id={titleId} className="downbeat-panel__title">
          {t('dj.downbeat_editor_title')} · <span className="downbeat-panel__deck">{deckName}</span>
        </h2>
        {facts.noteValueMissing && (
          <span
            className="downbeat-panel__warning"
            role="note"
            aria-label={t('dj.meter_unit_pending_tooltip')}
            title={t('dj.meter_unit_pending_tooltip')}
            data-testid={`${testIdPrefix}-unit-warning`}
          >
            <ConsoleLed on color="amber" />
            <span aria-hidden="true">{t('dj.downbeat_unit_warning_label')}</span>
          </span>
        )}
      </header>

      <div className="downbeat-panel__zones">
        <div className="downbeat-panel__zone downbeat-panel__zone--leds">
          <DownbeatStatusLeds
            leds={leds}
            tooltips={{ unconfirmed: t('dj.meter_pending_tooltip'), confirmed: confirmedTooltip }}
            testIdPrefix={testIdPrefix}
          />
        </div>

        <div className="downbeat-panel__zone downbeat-panel__zone--meter">
          <DownbeatMeterZone
            clock={current.candidate === null ? '--:--.---' : formatDownbeatClock(current.candidate)}
            positionTooltip={positionTooltip}
            meterIndex={selection.meterIndex}
            disabled={locked}
            testIdPrefix={testIdPrefix}
            onMeterChange={(meterIndex) => setSelection((current) => ({ ...current, meterIndex }))}
          />
        </div>

        <div className="downbeat-panel__zone downbeat-panel__zone--source">
          <ConsoleSelectorKnob
            positions={positions}
            value={selection.source}
            disabled={locked}
            aria-label={t('dj.downbeat_source_label')}
            title={t('dj.downbeat_source_label')}
            aria-valuetext={sourceNames[selection.source]}
            data-testid={`${testIdPrefix}-source`}
            onPress={() => turnTo(nextSourceOnClick(facts, selection.source))}
            onSelect={turnTo}
            onStep={(direction) => turnTo(stepSource(facts, selection.source, direction))}
          />
        </div>

        <div className="downbeat-panel__zone downbeat-panel__zone--actions">
          <DownbeatActions
            confirm={{ disabled: confirm.disabled || locked, tooltip: translatePanelMessage(t, confirm.tooltip) }}
            clear={{ disabled: clear.disabled || locked, tooltip: translatePanelMessage(t, clear.tooltip) }}
            pending={pending && !locked}
            testIdPrefix={testIdPrefix}
            onConfirm={handleConfirm}
            onClear={handleClear}
          />
        </div>
      </div>
    </section>
  );
};
