/**
 * SYSTEM DJ — Test Suite: pulso del altavoz 3D de Login y Registro
 * El ciclo debe enlazar sin salto y el cono no debe dar saltos entre tiempos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LOOP_SECONDS,
  SPEAKER_BPM,
  kickEnvelope,
  speakerPulse,
  speakerSway,
} from '../src/components/atoms/speakerPulse.ts';

const BEAT_SECONDS = 60 / SPEAKER_BPM;

describe('speakerPulse', () => {
  it('la envolvente vale cero al principio y al final de cada tiempo', () => {
    assert.ok(Math.abs(kickEnvelope(0)) < 1e-9);
    assert.ok(Math.abs(kickEnvelope(1)) < 1e-9);
  });

  it('es periódico: el final del ciclo coincide con el principio', () => {
    for (const t of [0, 0.13, 1.7, 3.21, LOOP_SECONDS * 0.77]) {
      assert.ok(Math.abs(speakerPulse(t) - speakerPulse(t + LOOP_SECONDS)) < 1e-9, `t=${t}`);
      assert.ok(Math.abs(speakerPulse(t, 0.5) - speakerPulse(t + LOOP_SECONDS, 0.5)) < 1e-9, `t=${t} contratiempo`);
      assert.ok(Math.abs(speakerSway(t) - speakerSway(t + LOOP_SECONDS)) < 1e-9, `t=${t} balanceo`);
    }
  });

  it('es continuo en el cambio de tiempo y en el cierre del ciclo', () => {
    const epsilon = 1e-6;
    for (const boundary of [BEAT_SECONDS, BEAT_SECONDS * 5, LOOP_SECONDS]) {
      const jump = Math.abs(speakerPulse(boundary - epsilon) - speakerPulse(boundary + epsilon));
      assert.ok(jump < 1e-3, `salto de ${jump} en ${boundary}s`);
    }
  });

  it('se mantiene acotado y golpea en cada tiempo', () => {
    let max = -Infinity;
    let min = Infinity;
    for (let t = 0; t < LOOP_SECONDS; t += 0.002) {
      const value = speakerPulse(t);
      max = Math.max(max, value);
      min = Math.min(min, value);
    }
    assert.ok(max > 0.5 && max <= 1.05, `máximo ${max}`);
    assert.ok(min > -0.2, `mínimo ${min}`);
  });
});
