/**
 * SYSTEM DJ — Test Suite: Fase 23.4 — Etapa 2
 * Módulo de Retícula Provisional (computeProvisionalBeatgrid) y Cálculo de Fase (getBeatPhase)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeProvisionalBeatgrid,
  getBeatPhase,
  DEFAULT_MAX_PROVISIONAL_BEATS,
} from '../src/audio/analysis/beatgrid.ts';

describe('Fase 23.4: Etapa 2 — Retícula Provisional y Cálculo de Fase Rítmica', () => {

  // ========================================================
  // 1. Proyección matemática con BPMs habituales
  // ========================================================
  describe('1. Proyección matemática para BPMs estándar', () => {
    it('1.1 Proyecta correctamente a 60 BPM (intervalo = 1.000s)', () => {
      const grid = computeProvisionalBeatgrid(60, 0, 10);
      assert.ok(grid !== null, 'Debe generar retícula válida');
      assert.equal(grid.bpm, 60);
      assert.equal(grid.beatInterval, 1.0);
      assert.equal(grid.firstBeatTime, 0);
      assert.equal(grid.totalBeats, 11); // t = 0, 1, 2, ..., 10
      assert.equal(grid.beatTimes[0], 0);
      assert.equal(grid.beatTimes[10], 10);
      assert.equal(grid.isProvisional, true);
      assert.equal(grid.isMusicallyVerified, false);
    });

    it('1.2 Proyecta correctamente a 90 BPM (intervalo ≈ 0.666667s)', () => {
      const grid = computeProvisionalBeatgrid(90, 0, 6);
      assert.ok(grid !== null);
      assert.equal(grid.bpm, 90);
      assert.ok(Math.abs(grid.beatInterval - 0.666667) < 0.00001);
      assert.equal(grid.firstBeatTime, 0);
      // En 6 segundos: 6 / (60/90) = 9 intervalos -> 10 pulsos (0 a 9)
      assert.equal(grid.totalBeats, 10);
      assert.equal(grid.beatTimes[0], 0);
      assert.ok(Math.abs(grid.beatTimes[9] - 6.0) < 0.0001);
    });

    it('1.3 Proyecta correctamente a 120 BPM (intervalo = 0.500s)', () => {
      const grid = computeProvisionalBeatgrid(120, 0, 60);
      assert.ok(grid !== null);
      assert.equal(grid.bpm, 120);
      assert.equal(grid.beatInterval, 0.5);
      // 60 / 0.5 + 1 = 121 pulsos
      assert.equal(grid.totalBeats, 121);
      assert.equal(grid.beatTimes[0], 0);
      assert.equal(grid.beatTimes[120], 60);
    });

    it('1.4 Proyecta correctamente a 124 BPM (tempo club habitual, intervalo ≈ 0.483871s)', () => {
      const grid = computeProvisionalBeatgrid(124, 0, 10);
      assert.ok(grid !== null);
      assert.equal(grid.bpm, 124);
      assert.ok(Math.abs(grid.beatInterval - 0.483871) < 0.00001);
      // 10 / (60/124) = 20.666... -> 21 pulsos (k = 0..20)
      assert.equal(grid.totalBeats, 21);
      assert.equal(grid.beatTimes[0], 0);
      assert.ok(grid.beatTimes[20] <= 10);
    });

    it('1.5 Proyecta correctamente a 140 BPM (techno/dubstep, intervalo ≈ 0.428571s)', () => {
      const grid = computeProvisionalBeatgrid(140, 0, 10);
      assert.ok(grid !== null);
      assert.equal(grid.bpm, 140);
      assert.ok(Math.abs(grid.beatInterval - 0.428571) < 0.00001);
      // 10 / (60/140) = 23.333... -> 24 pulsos (k = 0..23)
      assert.equal(grid.totalBeats, 24);
    });
  });

  // ========================================================
  // 2. firstBeatTime y duraciones no múltiplos
  // ========================================================
  describe('2. Offset de firstBeatTime y duraciones asimétricas', () => {
    it('2.1 firstBeatTime no nulo desplaza linealmente la retícula sin generar puntos previos', () => {
      const firstBeat = 0.35;
      const grid = computeProvisionalBeatgrid(120, firstBeat, 5.0);
      assert.ok(grid !== null);
      assert.equal(grid.firstBeatTime, 0.35);
      assert.equal(grid.beatTimes[0], 0.35, 'El primer punto debe ser exactamente firstBeatTime');
      assert.equal(grid.beatTimes[1], 0.85);
      assert.equal(grid.beatTimes[2], 1.35);

      // Ningún punto debe ser menor a firstBeatTime
      for (const t of grid.beatTimes) {
        assert.ok(t >= firstBeat, `El tiempo ${t} no debe ser inferior a firstBeatTime ${firstBeat}`);
        assert.ok(t <= 5.0, `El tiempo ${t} no debe exceder la duración 5.0`);
      }
    });

    it('2.2 Duración que no es múltiplo del intervalo se acota estrictamente', () => {
      // 120 BPM -> intervalo 0.5s. firstBeatTime = 0.2s. Duración = 1.8s.
      // Pulsos posibles: 0.2, 0.7, 1.2, 1.7. El siguiente sería 2.2 (> 1.8).
      const grid = computeProvisionalBeatgrid(120, 0.2, 1.8);
      assert.ok(grid !== null);
      assert.equal(grid.totalBeats, 4);
      assert.deepEqual(Array.from(grid.beatTimes), [0.2, 0.7, 1.2, 1.7]);
    });

    it('2.3 firstBeatTime igual a la duración genera exactamente un pulso', () => {
      const grid = computeProvisionalBeatgrid(120, 10.0, 10.0);
      assert.ok(grid !== null);
      assert.equal(grid.totalBeats, 1);
      assert.equal(grid.beatTimes[0], 10.0);
    });
  });

  // ========================================================
  // 3. Manejo estricto de entradas inválidas o no finitas
  // ========================================================
  describe('3. Validación defensiva de entradas', () => {
    it('3.1 Rechaza BPM no finito, negativo o cero', () => {
      assert.equal(computeProvisionalBeatgrid(0, 0, 100), null);
      assert.equal(computeProvisionalBeatgrid(-120, 0, 100), null);
      assert.equal(computeProvisionalBeatgrid(NaN, 0, 100), null);
      assert.equal(computeProvisionalBeatgrid(Infinity, 0, 100), null);
      assert.equal(computeProvisionalBeatgrid(-Infinity, 0, 100), null);
      assert.equal(computeProvisionalBeatgrid(null as unknown as number, 0, 100), null);
      assert.equal(computeProvisionalBeatgrid(undefined as unknown as number, 0, 100), null);
    });

    it('3.2 Rechaza firstBeatTime negativo, no finito o posterior a la duración', () => {
      assert.equal(computeProvisionalBeatgrid(120, -0.1, 100), null);
      assert.equal(computeProvisionalBeatgrid(120, NaN, 100), null);
      assert.equal(computeProvisionalBeatgrid(120, Infinity, 100), null);
      // firstBeatTime posterior a duración (105s > 100s)
      assert.equal(computeProvisionalBeatgrid(120, 105, 100), null);
      assert.equal(computeProvisionalBeatgrid(120, null as unknown as number, 100), null);
    });

    it('3.3 Rechaza duración nula, negativa o no finita', () => {
      assert.equal(computeProvisionalBeatgrid(120, 0, 0), null);
      assert.equal(computeProvisionalBeatgrid(120, 0, -10), null);
      assert.equal(computeProvisionalBeatgrid(120, 0, NaN), null);
      assert.equal(computeProvisionalBeatgrid(120, 0, Infinity), null);
    });

    it('3.4 Protección contra desbordamiento de memoria en pistas anormalmente extensas', () => {
      // 100,000 segundos (~27 horas) a 140 BPM generaría ~233,000 puntos
      // Debe limitarse limpiamente a maxBeats o DEFAULT_MAX_PROVISIONAL_BEATS sin desbordar memoria
      const grid = computeProvisionalBeatgrid(140, 0, 100000);
      assert.ok(grid !== null);
      assert.equal(grid.totalBeats, DEFAULT_MAX_PROVISIONAL_BEATS);
      assert.equal(grid.beatTimes.length, DEFAULT_MAX_PROVISIONAL_BEATS);

      // Prueba con límite personalizado
      const gridCustom = computeProvisionalBeatgrid(140, 0, 100000, { maxBeats: 500 });
      assert.ok(gridCustom !== null);
      assert.equal(gridCustom.totalBeats, 500);
      assert.equal(gridCustom.beatTimes.length, 500);
    });
  });

  // ========================================================
  // 4. Separación entre Validez Matemática y Fiabilidad Musical
  // ========================================================
  describe('4. Separación entre validez matemática y fiabilidad musical', () => {
    it('4.1 Documenta siempre que la retícula es provisional y no verificada musicalmente', () => {
      const grid = computeProvisionalBeatgrid(120, 0.5, 30);
      assert.ok(grid !== null);
      assert.equal(grid.isProvisional, true, 'isProvisional debe ser true');
      assert.equal(grid.isMusicallyVerified, false, 'isMusicallyVerified debe ser false');
    });

    it('4.2 isSuitableForSync evalúa la fiabilidad musical sin alterar la matemática', () => {
      // Caso A: Análisis con alta certeza rítmica
      const gridConfident = computeProvisionalBeatgrid(124, 0.2, 60, {
        bpmConfidence: 0.85,
        isAmbiguous: false,
      });
      assert.ok(gridConfident !== null);
      assert.equal(gridConfident.isSuitableForSync, true);

      // Caso B: Análisis ambiguo (ej. pista ambient/drone o ritmo difuso)
      const gridAmbiguous = computeProvisionalBeatgrid(124, 0.2, 60, {
        bpmConfidence: 0.35,
        isAmbiguous: true,
      });
      assert.ok(gridAmbiguous !== null, 'Matemáticamente es calculable');
      assert.equal(gridAmbiguous.isSuitableForSync, false, 'Musicalmente no es apta para sincronizar');

      // Caso C: Pista de 1 solo pulso no es suficiente para sincronizar
      const gridSingleBeat = computeProvisionalBeatgrid(120, 0.1, 0.2, { bpmConfidence: 0.9 });
      assert.ok(gridSingleBeat !== null);
      assert.equal(gridSingleBeat.totalBeats, 1);
      assert.equal(gridSingleBeat.isSuitableForSync, false);

      // Caso D: Ausencia de bpmConfidence (undefined u omitido) invalida idoneidad para sincronizar
      const gridNoConfidence = computeProvisionalBeatgrid(120, 0.5, 30);
      assert.ok(gridNoConfidence !== null);
      assert.equal(gridNoConfidence.isSuitableForSync, false, 'Sin bpmConfidence no debe considerarse apta para sync');
    });
  });

  // ========================================================
  // 5. Cálculo de Fase Rítmica (getBeatPhase)
  // ========================================================
  describe('5. Cálculo de fase rítmica (getBeatPhase)', () => {
    const grid = computeProvisionalBeatgrid(120, 0.5, 10.0)!;
    // 120 BPM -> intervalo = 0.5s. Pulsos en: 0.5, 1.0, 1.5, 2.0, 2.5, ..., 10.0

    it('5.1 Posición exactamente sobre un pulso da fase 0.0 y desviación 0.0', () => {
      const resultBeat0 = getBeatPhase(0.5, grid);
      assert.equal(resultBeat0.isValid, true);
      assert.equal(resultBeat0.nearestBeatIndex, 0);
      assert.equal(resultBeat0.nearestBeatTime, 0.5);
      assert.equal(resultBeat0.phase, 0.0);
      assert.equal(resultBeat0.signedDistanceSec, 0.0);
      assert.equal(resultBeat0.distanceSec, 0.0);

      const resultBeat1 = getBeatPhase(1.0, grid);
      assert.equal(resultBeat1.isValid, true);
      assert.equal(resultBeat1.nearestBeatIndex, 1);
      assert.equal(resultBeat1.nearestBeatTime, 1.0);
      assert.equal(resultBeat1.phase, 0.0);
      assert.equal(resultBeat1.signedDistanceSec, 0.0);
    });

    it('5.2 Posición adelantada respecto al pulso da signedDistanceSec > 0', () => {
      // En t = 0.6s: el pulso 0 ocurrió en 0.5s (+0.1s de adelanto)
      // Fase: 0.1 / 0.5 = 0.2 (20% del intervalo)
      const res = getBeatPhase(0.6, grid);
      assert.equal(res.isValid, true);
      assert.equal(res.nearestBeatIndex, 0);
      assert.equal(res.nearestBeatTime, 0.5);
      assert.equal(res.signedDistanceSec, 0.1);
      assert.equal(res.distanceSec, 0.1);
      assert.equal(res.phase, 0.2);
    });

    it('5.3 Posición retrasada respecto al pulso da signedDistanceSec < 0', () => {
      // En t = 0.9s: el pulso 1 ocurrirá en 1.0s (-0.1s de retraso)
      // Fase: (0.9 - 0.5) / 0.5 = 0.4 / 0.5 = 0.8 (80% del intervalo)
      const res = getBeatPhase(0.9, grid);
      assert.equal(res.isValid, true);
      assert.equal(res.nearestBeatIndex, 1);
      assert.equal(res.nearestBeatTime, 1.0);
      assert.equal(res.signedDistanceSec, -0.1);
      assert.equal(res.distanceSec, 0.1);
      assert.equal(res.phase, 0.8);
    });

    it('5.4 Contratiempo exacto (fase 0.5) en la mitad del intervalo', () => {
      // En t = 0.75s: mitad exacta entre 0.5s y 1.0s
      const res = getBeatPhase(0.75, grid);
      assert.equal(res.isValid, true);
      assert.equal(res.phase, 0.5);
      assert.equal(res.distanceSec, 0.25);
      // Equidistante: Math.round redondea al siguiente índice (1)
      assert.equal(res.nearestBeatIndex, 1);
      assert.equal(res.signedDistanceSec, -0.25);
    });

    it('5.5 Posición antes del primer pulso (t < firstBeatTime) calcula fase de aproximación', () => {
      // En t = 0.25s: 0.25s antes de firstBeatTime (0.5s)
      // nearestBeatIndex = 0 (t = 0.5s)
      // signedDistanceSec = 0.25 - 0.5 = -0.25s
      // phase = 0.5 (ciclo rítmico aproximándose a beat 0)
      const res = getBeatPhase(0.25, grid);
      assert.equal(res.isValid, true);
      assert.equal(res.nearestBeatIndex, 0);
      assert.equal(res.nearestBeatTime, 0.5);
      assert.equal(res.signedDistanceSec, -0.25);
      assert.equal(res.distanceSec, 0.25);
      assert.equal(res.phase, 0.5);
    });

    it('5.6 Posición t = 0.0 cuando firstBeatTime > 0', () => {
      // firstBeatTime = 0.5s, intervalo = 0.5s
      // t = 0.0s coincide exactamente con 1 intervalo completo antes de firstBeatTime
      const res = getBeatPhase(0.0, grid);
      assert.equal(res.isValid, true);
      assert.equal(res.nearestBeatIndex, 0);
      assert.equal(res.signedDistanceSec, -0.5);
      assert.equal(res.distanceSec, 0.5);
      assert.equal(res.phase, 0.0);
    });

    it('5.7 Manejo de errores de redondeo de punto flotante en fronteras de fase', () => {
      // Simulamos un currentTime infinitamente cercano al pulso (0.499999999999)
      const resNearZero = getBeatPhase(0.5 - 1e-12, grid);
      assert.equal(resNearZero.isValid, true);
      assert.equal(resNearZero.phase, 0.0, 'Fase infinitesimalmente cercana a 1.0 debe normalizarse a 0.0');
      assert.equal(resNearZero.signedDistanceSec, 0.0);

      // Posición límite en duración exacta (10.0s)
      const resEnd = getBeatPhase(10.0, grid);
      assert.equal(resEnd.isValid, true);
      assert.ok(resEnd.phase >= 0 && resEnd.phase < 1.0);
    });
  });

  // ========================================================
  // 6. Rechazo de entradas inválidas en getBeatPhase
  // ========================================================
  describe('6. Rechazo defensivo en getBeatPhase', () => {
    const grid = computeProvisionalBeatgrid(120, 0.5, 10.0)!;

    it('6.1 Retorna isValid false si currentTime está fuera de los límites de la pista', () => {
      const resNegative = getBeatPhase(-0.01, grid);
      assert.equal(resNegative.isValid, false);
      assert.ok(Number.isNaN(resNegative.phase));
      assert.ok(Number.isNaN(resNegative.signedDistanceSec));
      assert.ok(resNegative.error?.includes('fuera de los límites'));

      const resBeyondDuration = getBeatPhase(10.01, grid);
      assert.equal(resBeyondDuration.isValid, false);
      assert.ok(Number.isNaN(resBeyondDuration.phase));
    });

    it('6.2 Retorna isValid false si currentTime no es finito', () => {
      assert.equal(getBeatPhase(NaN, grid).isValid, false);
      assert.equal(getBeatPhase(Infinity, grid).isValid, false);
      assert.equal(getBeatPhase(-Infinity, grid).isValid, false);
    });

    it('6.3 Retorna isValid false si beatgrid es nulo o indefinido', () => {
      const resNull = getBeatPhase(1.0, null);
      assert.equal(resNull.isValid, false);
      assert.equal(resNull.nearestBeatIndex, -1);
      assert.ok(Number.isNaN(resNull.phase));

      const resUndef = getBeatPhase(1.0, undefined);
      assert.equal(resUndef.isValid, false);
    });
  });
});
