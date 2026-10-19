/**
 * SYSTEM DJ — Fase 23.4: Etapa C.3
 * Suite de Pruebas: Algoritmo Puro de Cálculo de Fase de Compás para BAR SYNC V1
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateBarSyncPlan,
  type BarSyncPlanInput,
  type BarSyncDeckInput,
} from '../src/audio/analysis/barSync.ts';
import { createManualDownbeatConfirmation, createSuggestedDownbeat } from '../src/utils/downbeat.ts';

const HASH_MASTER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_SLAVE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function createValidMasterInput(overrides: Partial<BarSyncDeckInput> = {}): BarSyncDeckInput {
  return {
    playbackState: 'playing',
    currentTime: 10.500,
    duration: 300.0,
    bpm: 120.0,
    playbackRate: 1.0,
    downbeat: createManualDownbeatConfirmation({
      position: 1.000,
      beatsPerBar: 4,
      contentHash: HASH_MASTER,
    }),
    contentHash: HASH_MASTER,
    ...overrides,
  };
}

function createValidSlaveInput(overrides: Partial<BarSyncDeckInput> = {}): BarSyncDeckInput {
  return {
    playbackState: 'stopped',
    currentTime: 8.200,
    duration: 250.0,
    bpm: 120.0,
    playbackRate: 1.0,
    downbeat: createManualDownbeatConfirmation({
      position: 0.500,
      beatsPerBar: 4,
      contentHash: HASH_SLAVE,
    }),
    contentHash: HASH_SLAVE,
    ...overrides,
  };
}

describe('Fase 23.4: Etapa C.3 — Cálculo Puro de Fase de Compás (BAR SYNC V1)', () => {
  // 1. Caso válido con Master reproduciéndose y Slave detenido
  it('1. Caso válido con Master en reproducción y Slave detenido calcula posición objetivo correcta', () => {
    // Master: 120 BPM, 4/4 => T_beat = 0.5s, T_bar = 2.0s
    // Master currentTime = 10.5s, Downbeat = 1.0s => delta = 9.5s.
    // 9.5 % 2.0 = 1.5s (τ_M = 1.5s, fase = 0.75, está en el 4º pulso del compás).
    // Slave: 120 BPM, 4/4 => T_bar = 2.0s, Downbeat = 0.5s.
    // Slave currentTime = 8.2s => (8.2 - 0.5) / 2.0 = 7.7 / 2.0 = 3.85 compases => k_nearest = 4.
    // targetPosition = 0.5 + 4 * 2.0 = 8.5s.
    const input: BarSyncPlanInput = {
      master: createValidMasterInput({ currentTime: 10.500 }),
      slave: createValidSlaveInput({ currentTime: 8.200, playbackState: 'stopped' }),
    };

    const result = calculateBarSyncPlan(input);

    assert.equal(result.status, 'armed');
    assert.equal(result.targetPosition, 8.500);
    assert.equal(result.targetDownbeatSec, 0.500);
    assert.equal(result.beatsPerBar, 4);
    assert.equal(result.masterBarPeriodSec, 2.000);
    assert.equal(result.masterBarPhase, 0.7500);
    assert.equal(result.timeToNextMasterDownbeatSec, 0.500); // 2.0 - 1.5 = 0.5s
    assert.equal(result.slaveBarPeriodSec, 2.000);
    assert.equal(result.targetBarIndex, 4);
    assert.equal(result.reason, null);
  });

  // 2. Caso válido con Slave pausado
  it('2. Caso válido con Slave pausado calcula la posición objetivo y arma el estado', () => {
    const input: BarSyncPlanInput = {
      master: createValidMasterInput(),
      slave: createValidSlaveInput({ playbackState: 'paused', currentTime: 16.400 }),
    };

    const result = calculateBarSyncPlan(input);

    assert.equal(result.status, 'armed');
    assert.ok(result.targetPosition !== null);
    // (16.4 - 0.5) / 2.0 = 15.9 / 2.0 = 7.95 => k = 8 => target = 0.5 + 16.0 = 16.500s
    assert.equal(result.targetPosition, 16.500);
    assert.equal(result.reason, null);
  });

  // 3. Master detenido o pausado
  it('3. Rechaza con rejected_state si el Master está detenido o pausado', () => {
    // A. Master detenido
    const resStopped = calculateBarSyncPlan({
      master: createValidMasterInput({ playbackState: 'stopped' }),
      slave: createValidSlaveInput(),
    });
    assert.equal(resStopped.status, 'rejected_state');
    assert.equal(resStopped.targetPosition, null);
    assert.match(resStopped.reason!, /Master debe estar en reproducción activa/i);

    // B. Master pausado
    const resPaused = calculateBarSyncPlan({
      master: createValidMasterInput({ playbackState: 'paused' }),
      slave: createValidSlaveInput(),
    });
    assert.equal(resPaused.status, 'rejected_state');
    assert.equal(resPaused.targetPosition, null);
  });

  // 4. Slave reproduciéndose
  it('4. Rechaza con rejected_state si el Slave está reproduciéndose (no se admite micro-slew de compás)', () => {
    const resSlavePlaying = calculateBarSyncPlan({
      master: createValidMasterInput(),
      slave: createValidSlaveInput({ playbackState: 'playing' }),
    });

    assert.equal(resSlavePlaying.status, 'rejected_state');
    assert.equal(resSlavePlaying.targetPosition, null);
    assert.match(resSlavePlaying.reason!, /Slave está reproduciéndose/i);
  });

  // 5. Downbeat sugerido, pero no confirmado manualmente
  it('5. Rechaza con rejected_unconfirmed si el downbeat de cualquiera de las pistas es solo una sugerencia', () => {
    // A. Master solo sugerido
    const resMasterSug = calculateBarSyncPlan({
      master: createValidMasterInput({
        downbeat: createSuggestedDownbeat(1.000),
      }),
      slave: createValidSlaveInput(),
    });
    assert.equal(resMasterSug.status, 'rejected_unconfirmed');
    assert.equal(resMasterSug.targetPosition, null);
    assert.match(resMasterSug.reason!, /Master.*no dispone de un downbeat confirmado/i);

    // B. Slave solo sugerido
    const resSlaveSug = calculateBarSyncPlan({
      master: createValidMasterInput(),
      slave: createValidSlaveInput({
        downbeat: createSuggestedDownbeat(0.500),
      }),
    });
    assert.equal(resSlaveSug.status, 'rejected_unconfirmed');
    assert.equal(resSlaveSug.targetPosition, null);
    assert.match(resSlaveSug.reason!, /Slave.*no dispone de un downbeat confirmado/i);
  });

  // 6. Confirmación asociada a un hash diferente
  it('6. Rechaza con rejected_unconfirmed si la confirmación no pertenece al contentHash verificado', () => {
    const differentHash = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

    const resMismatch = calculateBarSyncPlan({
      master: createValidMasterInput(),
      slave: createValidSlaveInput({
        contentHash: HASH_SLAVE,
        downbeat: createManualDownbeatConfirmation({
          position: 0.500,
          beatsPerBar: 4,
          contentHash: differentHash, // Hash ajeno
        }),
      }),
    });

    assert.equal(resMismatch.status, 'rejected_unconfirmed');
    assert.equal(resMismatch.targetPosition, null);
  });

  // 7. Hash ausente o inválido
  it('7. Rechaza con rejected_unconfirmed si el contentHash es ausente, truncado o no hexadecimal', () => {
    // A. Hash ausente en Master
    const resNoHash = calculateBarSyncPlan({
      master: createValidMasterInput({ contentHash: undefined }),
      slave: createValidSlaveInput(),
    });
    assert.equal(resNoHash.status, 'rejected_unconfirmed');

    // B. Hash no hexadecimal en Slave
    const resNonHex = calculateBarSyncPlan({
      master: createValidMasterInput(),
      slave: createValidSlaveInput({ contentHash: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }),
    });
    assert.equal(resNonHex.status, 'rejected_unconfirmed');
  });

  // 8. Métricas incompatibles (ej. 4/4 frente a 3/4)
  it('8. Rechaza con rejected_metric_mismatch si las métricas confirmadas son diferentes', () => {
    const resMetricMismatch = calculateBarSyncPlan({
      master: createValidMasterInput({
        downbeat: createManualDownbeatConfirmation({
          position: 1.000,
          beatsPerBar: 4, // 4/4
          contentHash: HASH_MASTER,
        }),
      }),
      slave: createValidSlaveInput({
        downbeat: createManualDownbeatConfirmation({
          position: 0.800,
          beatsPerBar: 3, // 3/4
          contentHash: HASH_SLAVE,
        }),
      }),
    });

    assert.equal(resMetricMismatch.status, 'rejected_metric_mismatch');
    assert.equal(resMetricMismatch.targetPosition, null);
    assert.match(resMetricMismatch.reason!, /Discrepancia métrica musical: Master es 4\/X pero Slave es 3\/X/i);
  });

  // 9. BPM efectivo inválido, cero, negativo, NaN o infinito
  it('9. Rechaza con rejected_limits si el BPM efectivo es cero, negativo, NaN, infinito o fuera de rango', () => {
    // A. BPM cero
    assert.equal(
      calculateBarSyncPlan({
        master: createValidMasterInput({ bpm: 0 }),
        slave: createValidSlaveInput(),
      }).status,
      'rejected_limits'
    );

    // B. BPM negativo
    assert.equal(
      calculateBarSyncPlan({
        master: createValidMasterInput(),
        slave: createValidSlaveInput({ bpm: -120 }),
      }).status,
      'rejected_limits'
    );

    // C. BPM NaN
    assert.equal(
      calculateBarSyncPlan({
        master: createValidMasterInput({ bpm: NaN }),
        slave: createValidSlaveInput(),
      }).status,
      'rejected_limits'
    );

    // D. BPM Infinity
    assert.equal(
      calculateBarSyncPlan({
        master: createValidMasterInput(),
        slave: createValidSlaveInput({ bpm: Infinity }),
      }).status,
      'rejected_limits'
    );

    // E. BPM fuera de límites admisibles (< 20 o > 300)
    assert.equal(
      calculateBarSyncPlan({
        master: createValidMasterInput({ bpm: 15 }),
        slave: createValidSlaveInput(),
      }).status,
      'rejected_limits'
    );
  });

  // 10. Posiciones y duraciones inválidas
  it('10. Rechaza con rejected_limits si las posiciones o duraciones son no finitas o exceden límites', () => {
    // A. Duración negativa
    assert.equal(
      calculateBarSyncPlan({
        master: createValidMasterInput({ duration: -10 }),
        slave: createValidSlaveInput(),
      }).status,
      'rejected_limits'
    );

    // B. currentTime fuera de duración
    assert.equal(
      calculateBarSyncPlan({
        master: createValidMasterInput({ currentTime: 350.0, duration: 300.0 }),
        slave: createValidSlaveInput(),
      }).status,
      'rejected_limits'
    );

    // C. currentTime negativo
    assert.equal(
      calculateBarSyncPlan({
        master: createValidMasterInput(),
        slave: createValidSlaveInput({ currentTime: -1.0 }),
      }).status,
      'rejected_limits'
    );
  });

  // 11. Objetivo negativo o fuera de la duración del Slave
  it('11. Garantiza que la posición objetivo no sea negativa ni exceda la duración del Slave', () => {
    // Downbeat del Slave en 1.0s, T_bar = 2.0s.
    // Posición actual = 0.1s => k_nearest = round(-0.45) = 0 => targetPosition = 1.000s >= 0.
    const resLow = calculateBarSyncPlan({
      master: createValidMasterInput(),
      slave: createValidSlaveInput({
        currentTime: 0.100,
        downbeat: createManualDownbeatConfirmation({
          position: 1.000,
          beatsPerBar: 4,
          contentHash: HASH_SLAVE,
        }),
      }),
    });

    assert.equal(resLow.status, 'armed');
    assert.ok(resLow.targetPosition! >= 0);
    assert.equal(resLow.targetPosition, 1.000);

    // Posición cerca del final: duración 20s, currentTime 19.8s
    const resHigh = calculateBarSyncPlan({
      master: createValidMasterInput(),
      slave: createValidSlaveInput({
        duration: 20.0,
        currentTime: 19.800,
        downbeat: createManualDownbeatConfirmation({
          position: 1.000,
          beatsPerBar: 4,
          contentHash: HASH_SLAVE,
        }),
      }),
    });

    assert.equal(resHigh.status, 'armed');
    assert.ok(resHigh.targetPosition! <= 20.0);
    // (19.8 - 1.0) / 2.0 = 9.4 => k = 9 => target = 1.0 + 18.0 = 19.000s
    assert.equal(resHigh.targetPosition, 19.000);
  });

  // 12. Fronteras de compás y posiciones cercanas al inicio y final del archivo
  it('12. Proyecta correctamente las fronteras de compás mínimas y máximas sin desbordar el buffer', () => {
    // Si la pista dura solo 5 segundos y el downbeat está en 4.5s con T_bar = 2.0s
    // 4.5 - 2.0 = 2.5, 2.5 - 2.0 = 0.5. Compases válidos: 0.5s, 2.5s, 4.5s
    const input: BarSyncPlanInput = {
      master: createValidMasterInput(),
      slave: createValidSlaveInput({
        duration: 5.0,
        currentTime: 0.0,
        downbeat: createManualDownbeatConfirmation({
          position: 4.500,
          beatsPerBar: 4,
          contentHash: HASH_SLAVE,
        }),
      }),
    };

    const res = calculateBarSyncPlan(input);
    assert.equal(res.status, 'armed');
    assert.ok(res.targetPosition! >= 0);
    assert.ok(res.targetPosition! <= 5.0);
    // (0.0 - 4.5) / 2.0 = -2.25 => round = -2 => target = 4.5 + (-2)*2.0 = 0.500s
    assert.equal(res.targetPosition, 0.500);
  });

  // 13. Repetibilidad del resultado para entradas idénticas
  it('13. Es estrictamente determinista y repetible para entradas idénticas', () => {
    const input: BarSyncPlanInput = {
      master: createValidMasterInput({ currentTime: 14.250 }),
      slave: createValidSlaveInput({ currentTime: 22.100 }),
    };

    const res1 = calculateBarSyncPlan(input);
    const res2 = calculateBarSyncPlan(input);

    assert.deepEqual(res1, res2);
  });

  // 14. Garantía de que el cálculo no modifica los objetos de entrada
  it('14. Garantiza la inmutabilidad de los objetos de entrada sin efectos colaterales', () => {
    const master = Object.freeze(createValidMasterInput());
    const slave = Object.freeze(createValidSlaveInput());
    const input: BarSyncPlanInput = Object.freeze({ master, slave });

    // No debe lanzar excepción por intentar escribir en objetos congelados
    const res = calculateBarSyncPlan(input);
    assert.equal(res.status, 'armed');
  });

  // 15. Comprobación de que la fórmula use BPM efectivo (bpm * playbackRate)
  it('15. Utiliza rigurosamente el BPM efectivo cuando el deck tiene playbackRate distinta de 1.0', () => {
    // Master con playbackRate = 1.05 => effectiveBpm = 120 * 1.05 = 126 BPM
    // T_beat,M = 60 / 126 = 0.47619s => T_bar,M = 4 * 0.47619s = 1.90476s (1.905s)
    const masterWithPitch = createValidMasterInput({
      bpm: 120.0,
      playbackRate: 1.05,
    });

    const res = calculateBarSyncPlan({
      master: masterWithPitch,
      slave: createValidSlaveInput(),
    });

    assert.equal(res.status, 'armed');
    // masterBarPeriodSec debe ser ~1.905s (calculado con 126 BPM, no con 120 BPM que daría 2.000s)
    assert.equal(res.masterBarPeriodSec, 1.905);
    assert.notEqual(res.masterBarPeriodSec, 2.000);
  });

  // 16. Detección de already_aligned
  it('16. Devuelve status already_aligned si el Slave ya se encuentra en la posición objetivo del compás', () => {
    // Slave Downbeat = 0.5s, T_bar = 2.0s => Frontera de compás = 8.5s
    // Si currentTime del Slave es exactamente 8.5s (o dentro de 5ms)
    const input: BarSyncPlanInput = {
      master: createValidMasterInput(),
      slave: createValidSlaveInput({
        currentTime: 8.502, // A solo 2 ms de la frontera 8.500s (tolerancia es 5 ms)
      }),
    };

    const res = calculateBarSyncPlan(input);

    assert.equal(res.status, 'already_aligned');
    assert.equal(res.targetPosition, 8.500);
    assert.equal(res.reason, null);
  });
});
