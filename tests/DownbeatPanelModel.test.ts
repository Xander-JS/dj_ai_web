/**
 * SYSTEM DJ — Test Suite: reglas puras del módulo DOWNBEAT & COMPÁS (secciones 5 / 6)
 *
 * Cubre lo que el módulo decide sin store ni React: el orden de giro del knob de fuente, las flechas
 * sin dar la vuelta, los LEDs de estado (fijos tras confirmar), el LED de cambio pendiente de
 * CONFIRMAR, la fuente deducida en confirmaciones anteriores al módulo y el reloj del display.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import { createManualDownbeatConfirmation, createSuggestedDownbeat } from '../src/utils/downbeat.ts';
import type { DownbeatOrigin, Track } from '../src/types/track.ts';
import {
  formatDownbeatClock,
  getDownbeatTrackFacts,
  getInitialSelection,
  getPositionTooltip,
  getStatusLeds,
  hasPendingChange,
  nextSourceOnClick,
  selectSource,
  stepSource,
} from '../src/services/console/downbeatPanelModel.ts';

const HASH = 'a'.repeat(64);

function makeTrack(opts: { suggested?: number; confirmed?: { position: number; beatsPerBar?: number; origin?: DownbeatOrigin }; unit?: boolean } = {}): Track {
  const track = createTrackFromFile(new File([new Uint8Array([1])], 'track.mp3', { type: 'audio/mpeg' }), 300, HASH);
  track.fileMeta = { ...track.fileMeta, contentHash: HASH };
  if (opts.suggested !== undefined) {
    track.downbeat = createSuggestedDownbeat(opts.suggested);
  }
  if (opts.confirmed) {
    track.downbeat = createManualDownbeatConfirmation({
      position: opts.confirmed.position,
      beatsPerBar: opts.confirmed.beatsPerBar ?? 4,
      contentHash: HASH,
      suggestedPosition: opts.suggested ?? null,
      origin: opts.confirmed.origin,
    });
    if (opts.unit !== false) {
      track.analysis = { ...(track.analysis ?? { status: 'analyzed' }), beatUnit: { value: 4, status: 'confirmed', source: 'manual' } } as Track['analysis'];
    }
  }
  return track;
}

describe('Módulo DOWNBEAT & COMPÁS — reglas puras', () => {
  it('sin pista: todos los LEDs apagados y el display en 00:00.000', () => {
    const facts = getDownbeatTrackFacts(null);
    assert.deepEqual(getStatusLeds(facts, getInitialSelection(facts)), {
      unconfirmed: false, playhead: false, suggested: false, confirmed: false,
    });
    assert.equal(formatDownbeatClock(0), '00:00.000');
    assert.equal(formatDownbeatClock(Number.NaN), '00:00.000');
    assert.equal(formatDownbeatClock(62.3185), '01:02.319');
  });

  it('pulsar el knob gira CAB → OFF → SUG → CAB, y salta SUG si no hay sugerencia', () => {
    const withSug = getDownbeatTrackFacts(makeTrack({ suggested: 1.5 }));
    assert.equal(nextSourceOnClick(withSug, 'playhead'), 'off');
    assert.equal(nextSourceOnClick(withSug, 'off'), 'suggested');
    assert.equal(nextSourceOnClick(withSug, 'suggested'), 'playhead');

    const noSug = getDownbeatTrackFacts(makeTrack());
    assert.equal(nextSourceOnClick(noSug, 'off'), 'playhead');
    assert.equal(selectSource(noSug, getInitialSelection(noSug), 'suggested', 0), null, 'SUG deshabilitado');
  });

  it('las flechas mueven una posición sin dar la vuelta', () => {
    const facts = getDownbeatTrackFacts(makeTrack({ suggested: 1.5 }));
    assert.equal(stepSource(facts, 'playhead', -1), 'playhead');
    assert.equal(stepSource(facts, 'playhead', 1), 'off');
    assert.equal(stepSource(facts, 'suggested', 1), 'suggested');
    assert.equal(stepSource(getDownbeatTrackFacts(makeTrack()), 'off', 1), 'off', 'SUG no disponible');
  });

  it('antes de confirmar se enciende solo el LED del knob y el LED de CONFIRMAR parpadea fuera de OFF', () => {
    const facts = getDownbeatTrackFacts(makeTrack({ suggested: 1.5 }));
    assert.equal(getInitialSelection(facts).source, 'off', 'el knob arranca en OFF');
    const sug = selectSource(facts, getInitialSelection(facts), 'suggested', 0)!;
    assert.deepEqual(getStatusLeds(facts, sug), { unconfirmed: false, playhead: false, suggested: true, confirmed: false });
    assert.equal(hasPendingChange(facts, sug), true);

    const off = selectSource(facts, sug, 'off', 0)!;
    assert.deepEqual(getStatusLeds(facts, off), { unconfirmed: true, playhead: false, suggested: false, confirmed: false });
    assert.equal(hasPendingChange(facts, off), false);

    const cab = selectSource(facts, off, 'playhead', 42.31849)!;
    assert.equal(cab.candidate, 42.318, 'CAB captura el cabezal redondeado a ms');
    assert.equal(getPositionTooltip(facts, cab).values?.position, '42.318');
  });

  it('tras confirmar, CONFIRMADO + la fuente quedan fijos aunque se gire el knob o se mueva el fader', () => {
    const facts = getDownbeatTrackFacts(makeTrack({ suggested: 1.5, confirmed: { position: 12.48, origin: 'playhead' } }));
    assert.equal(getInitialSelection(facts).source, 'off', 'el knob arranca en OFF también con confirmación');
    const initial = selectSource(facts, getInitialSelection(facts), 'playhead', 12.48)!;
    assert.equal(hasPendingChange(facts, initial), false, 'lo elegido coincide con lo confirmado');

    const fixed = { unconfirmed: false, playhead: true, suggested: false, confirmed: true };
    const turned = selectSource(facts, initial, 'suggested', 0)!;
    assert.deepEqual(getStatusLeds(facts, turned), fixed);
    assert.equal(hasPendingChange(facts, turned), true);

    const moved = { ...initial, meterIndex: 1 };
    assert.deepEqual(getStatusLeds(facts, moved), fixed);
    assert.equal(hasPendingChange(facts, moved), true);

    assert.equal(hasPendingChange(facts, selectSource(facts, initial, 'off', 0)!), false, 'OFF apaga el LED');
    assert.equal(getPositionTooltip(facts, turned).key, 'dj.downbeat_position_confirmed');
  });

  it('confirmaciones anteriores al módulo deducen su fuente de la posición', () => {
    const fromSug = getDownbeatTrackFacts(makeTrack({ suggested: 1.5, confirmed: { position: 1.5 } }));
    assert.equal(fromSug.confirmed?.origin, 'suggested');
    const fromCab = getDownbeatTrackFacts(makeTrack({ suggested: 1.5, confirmed: { position: 30 } }));
    assert.equal(fromCab.confirmed?.origin, 'playhead');
  });

  it('downbeat confirmado sin unidad de nota activa el aviso ámbar', () => {
    assert.equal(getDownbeatTrackFacts(makeTrack({ confirmed: { position: 2 }, unit: false })).noteValueMissing, true);
    assert.equal(getDownbeatTrackFacts(makeTrack({ confirmed: { position: 2 } })).noteValueMissing, false);
  });
});
