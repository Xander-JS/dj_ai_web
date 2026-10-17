/**
 * SYSTEM DJ — Test Suite: Fase 23.4 — Etapa 4
 * Pruebas Matemáticas Deterministas de Micro-Slew y Alineación de Fase
 * 
 * Cobertura de cálculos analíticos puros sin dependencias de hardware:
 * 1. Signo de la corrección (esclavo retrasado vs adelantado).
 * 2. Margen de planificación mínimo (>= 50 ms) y selección de pulsos.
 * 3. Asimetría de BPMs entre Maestro y Esclavo.
 * 4. Respeto estricto de cotas [0.92, 1.08] y rechazo de límites.
 * 5. Ausencia de recorte silencioso o inversión artificial de signo.
 * 6. Integral analítica exacta de la trayectoria (conservación de desplazamiento).
 * 7. Evaluación continua de velocidad R(t) e integrales parciales de corte.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculatePhaseAlignmentPlan,
  evaluateSlewRateAt,
  integrateSlewTrajectory,
} from '../src/audio/analysis/phaseAlignment.ts';

describe('Fase 23.4: Etapa 4 — Matemáticas Deterministas de Micro-Slew', () => {

  describe('1. Signo de la corrección y convención temporal', () => {
    it('1.1 Esclavo retrasado (llega más tarde que el maestro): deltaR > 0 (aceleración)', () => {
      // Maestro en 120 BPM, x=10.0, rate=1.0 -> Próximo pulso en 10.5
      // Esclavo en 120 BPM, x=9.92, rate=1.0 -> Próximo pulso en 10.0 (80 ms retrasado)
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.92,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.success, 'Debe planificarse con éxito');
      assert.ok(result.plan !== null);
      const plan = result.plan;

      assert.ok(plan.arrivalErrorSec > 0, `arrivalErrorSec (${plan.arrivalErrorSec}) debe ser positivo`);
      assert.ok(plan.targetDisplacement > 0, `targetDisplacement (${plan.targetDisplacement}) debe ser positivo`);
      assert.ok(plan.deltaRPeak > 0, `deltaRPeak (${plan.deltaRPeak}) debe ser positivo`);
      assert.ok(plan.peakRate > plan.baseRate, `peakRate (${plan.peakRate}) debe acelerar respecto a baseRate (${plan.baseRate})`);
    });

    it('1.2 Esclavo adelantado (llega antes que el maestro): deltaR < 0 (desaceleración)', () => {
      // Maestro en 120 BPM, x=10.0, rate=1.0
      // Esclavo en 120 BPM, x=10.08, rate=1.0 (80 ms adelantado)
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 10.08,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.success, 'Debe planificarse con éxito');
      assert.ok(result.plan !== null);
      const plan = result.plan;

      assert.ok(plan.arrivalErrorSec < 0, `arrivalErrorSec (${plan.arrivalErrorSec}) debe ser negativo`);
      assert.ok(plan.targetDisplacement < 0, `targetDisplacement (${plan.targetDisplacement}) debe ser negativo`);
      assert.ok(plan.deltaRPeak < 0, `deltaRPeak (${plan.deltaRPeak}) debe ser negativo`);
      assert.ok(plan.peakRate < plan.baseRate, `peakRate (${plan.peakRate}) debe desacelerar respecto a baseRate (${plan.baseRate})`);
    });
  });

  describe('2. Margen de planificación mínimo (>= 50 ms) y selección de pulsos', () => {
    it('2.1 Descarta pulsos maestros que ocurran a menos de 50 ms del instante actual', () => {
      // Beatgrid con pulsos cada 0.5s: 10.0, 10.5, 11.0
      // Posición actual del maestro a 10.48s (a solo 20ms de 10.5s)
      // Con margen de 50ms, 10.5s es inalcanzable de forma segura; debe planificar hacia 11.0s
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.48,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 10.40,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
        planningMarginSec: 0.05,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.plan !== null);
      const plan = result.plan;

      assert.equal(plan.plannedMasterBeatTime, 11.0, 'Debe seleccionar 11.0s como pulso maestro, descartando 10.5s');
      const timeToMasterBeat = (plan.plannedMasterBeatTime - 10.48) / 1.0;
      assert.ok(timeToMasterBeat >= 0.05, 'El tiempo disponible al pulso maestro debe ser >= 50ms');
    });

    it('2.2 Selecciona el pulso del esclavo con llegada más próxima a la llegada del maestro', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 10.05,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.plan !== null);
      assert.equal(result.plan.plannedMasterBeatTime, 10.5);
      assert.equal(result.plan.plannedSlaveBeatTime, 10.5);
    });
  });

  describe('3. Asimetría de BPMs entre Maestro y Esclavo', () => {
    it('3.1 Planifica correctamente con tempos distintos (Maestro 124 BPM, Esclavo 120 BPM)', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 20.0,
        masterBpm: 124, // intervalo = 0.48387s
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 20.02,
        slaveBpm: 120,  // intervalo = 0.50000s
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.plan !== null);
      assert.ok(result.plan.tSlew > 0);
      assert.ok(Number.isFinite(result.plan.targetDisplacement));
    });
  });

  describe('4. Respeto estricto de cotas [0.92, 1.08] y rechazo de límites', () => {
    it('4.1 Rechaza si la corrección positiva requerida supera la cota superior 1.08', () => {
      // Esclavo operando ya a 1.079. Un retraso requiere aceleración pero el margen es solo 0.001
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.75, // Retraso significativo (250 ms)
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.079,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'rejected_limits');
      assert.equal(result.success, false);
      assert.equal(result.plan, null);
      assert.ok(result.reason?.includes('Margen') || result.reason?.includes('límite'));
    });

    it('4.2 Rechaza si la corrección negativa requerida viola la cota inferior 0.92', () => {
      // Esclavo operando ya a 0.921. Un adelanto requiere desaceleración pero el margen hacia abajo es 0.001
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 10.25, // Adelanto significativo (250 ms)
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 0.921,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'rejected_limits');
      assert.equal(result.success, false);
      assert.equal(result.plan, null);
      assert.ok(result.reason?.includes('Margen') || result.reason?.includes('límite'));
    });

    it('4.3 Rechaza sin invertir artificialmente el signo de la corrección', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.8,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0795,
        slaveBpmConfidence: 0.9,
      });

      // Debe rechazar por límites, jamás invertir el signo para desacelerar
      assert.equal(result.status, 'rejected_limits');
      assert.equal(result.plan, null);
    });

    it('4.4 Rechaza si la confianza del beatgrid es insuficiente (< 0.3 o ambiguo)', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.92,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.2, // Confianza baja (< 0.3)
      });

      assert.equal(result.status, 'rejected_confidence');
      assert.equal(result.success, false);
      assert.ok(result.reason?.includes('fiable') || result.reason?.includes('confianza'));
    });

    it('4.5 Reporta already_aligned cuando el error temporal es inferior a la tolerancia (1 ms)', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 10.0005, // Solo 0.5 ms de desfase
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'already_aligned');
      assert.equal(result.success, true);
      assert.equal(result.plan, null);
    });
  });

  describe('5. Conservación matemática y exactitud analítica de la integral', () => {
    it('5.1 Perfil trapezoidal con meseta: la integral analítica cerrada coincide exactamente con targetDisplacement', () => {
      // Desfase de 70 ms con límite de desviación de 2% para inducir meseta
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.93,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
        maxSlewDeviation: 0.02, // 2% máximo
      });

      assert.equal(result.status, 'active');
      assert.ok(result.plan !== null);
      const plan = result.plan;
      assert.ok(plan.tPlateau > 0, 'Debe tener meseta (perfil trapezoidal)');

      // ∫[0, tSlew] R(u) du - baseRate * tSlew = desplazamiento acumulado
      const totalIntegratedArea = integrateSlewTrajectory(plan, 0, plan.tSlew);
      const baselineArea = plan.baseRate * plan.tSlew;
      const accumulatedDisplacement = totalIntegratedArea - baselineArea;

      const error = Math.abs(accumulatedDisplacement - plan.targetDisplacement);
      assert.ok(error < 1e-5, `Error trapezoidal ${error} debe ser < 1e-5`);
    });

    it('5.2 Perfil triangular sin meseta: la integral coincide exactamente con targetDisplacement', () => {
      // Desfase pequeño (15 ms) con desviación permitida amplia (4%)
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.985,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
        maxSlewDeviation: 0.04,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.plan !== null);
      const plan = result.plan;
      assert.equal(plan.tPlateau, 0, 'Debe ser triangular sin meseta (tPlateau = 0)');

      const totalIntegratedArea = integrateSlewTrajectory(plan, 0, plan.tSlew);
      const baselineArea = plan.baseRate * plan.tSlew;
      const accumulatedDisplacement = totalIntegratedArea - baselineArea;

      const error = Math.abs(accumulatedDisplacement - plan.targetDisplacement);
      assert.ok(error < 1e-5, `Error triangular ${error} debe ser < 1e-5`);
    });

    it('5.3 Desplazamiento negativo (desaceleración): la integral conserva magnitud y signo negativo', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 10.06, // Adelantado 60 ms
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.plan !== null);
      const plan = result.plan;
      assert.ok(plan.targetDisplacement < 0, 'El desplazamiento objetivo debe ser negativo');

      const totalIntegratedArea = integrateSlewTrajectory(plan, 0, plan.tSlew);
      const baselineArea = plan.baseRate * plan.tSlew;
      const accumulatedDisplacement = totalIntegratedArea - baselineArea;

      assert.ok(accumulatedDisplacement < 0, 'El desplazamiento integrado debe ser negativo');
      const error = Math.abs(accumulatedDisplacement - plan.targetDisplacement);
      assert.ok(error < 1e-5, `Error en integral negativa ${error} debe ser < 1e-5`);
    });
  });

  describe('6. Continuidad y evaluación de la función de velocidad R(t)', () => {
    it('6.1 La velocidad efectiva evoluciona de forma continua C0 en los 3 tramos', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.93,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
        maxSlewDeviation: 0.02,
      });

      assert.equal(result.status, 'active');
      const plan = result.plan!;
      const { baseRate, peakRate, tRamp, tPlateau, tSlew } = plan;

      // t = 0: velocidad base
      assert.equal(evaluateSlewRateAt(plan, 0), baseRate);

      // t = tRamp: alcanza peakRate exactamente
      const atRampEnd = evaluateSlewRateAt(plan, tRamp);
      assert.ok(Math.abs(atRampEnd - peakRate) < 1e-5);

      // t = tRamp + tPlateau: aún en peakRate
      const atPlateauEnd = evaluateSlewRateAt(plan, tRamp + tPlateau);
      assert.ok(Math.abs(atPlateauEnd - peakRate) < 1e-5);

      // t = tSlew: regresa a baseRate
      const atEnd = evaluateSlewRateAt(plan, tSlew);
      assert.ok(Math.abs(atEnd - baseRate) < 1e-5);

      // t > tSlew: permanece en baseRate
      assert.equal(evaluateSlewRateAt(plan, tSlew + 1.0), baseRate);
    });

    it('6.2 La integral parcial para cualquier instante de corte es monótona y acotada', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.94,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'active');
      const plan = result.plan!;
      const totalDur = plan.tSlew;

      let prevDisp = 0;
      for (let t = 0.1; t <= totalDur; t += 0.2) {
        const areaT = integrateSlewTrajectory(plan, 0, t);
        const baselineT = plan.baseRate * t;
        const partialDisp = areaT - baselineT;

        assert.ok(partialDisp >= prevDisp - 1e-6, `partialDisp (${partialDisp}) >= prevDisp (${prevDisp}) en t=${t}`);
        assert.ok(partialDisp <= plan.targetDisplacement + 1e-5, `partialDisp no puede rebasar el objetivo`);
        prevDisp = partialDisp;
      }
    });
  });

  describe('7. Elegibilidad causal y validación de compatibilidad de tempo', () => {
    it('7.1 Rechaza pulsos pasados del esclavo (no selecciona eventos con deltaArrival < 0)', () => {
      // Maestro en 10.0s, beats en 10.0, 10.5. Próximo viable >= 50ms: 10.5s.
      // Esclavo en 10.01s (acaba de pasar el pulso de 10.0s hace 10ms).
      // El pulso en 10.0s tiene deltaArrival = -0.010s < 0.
      // Debe seleccionar el pulso en 10.5s, NUNCA el pulso pasado en 10.0s.
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 120,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 10.01,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.plan !== null);
      assert.equal(result.plan.plannedSlaveBeatTime, 10.5, 'Debe seleccionar 10.5s y nunca el pulso pasado de 10.0s');
      assert.ok(result.plan.plannedSlaveBeatTime >= 10.01, 'El pulso seleccionado debe ser futuro respecto a slaveCurrentTime');
    });

    it('7.2 Rechaza explícitamente cuando las velocidades efectivas son incompatibles (validateTempoCompatibility = true)', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 124, // 124 BPM efectivo
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.94,
        slaveBpm: 120, // 120 BPM efectivo (diferencia 4.0 BPM > 0.20 BPM)
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
        validateTempoCompatibility: true,
      });

      assert.equal(result.status, 'rejected_state');
      assert.equal(result.success, false);
      assert.equal(result.plan, null);
      assert.ok(result.reason?.includes('incompatibles'));
      assert.equal(result.isTempoSynchronized, false);
    });

    it('7.3 Acepta BPM nominales asimétricos si la velocidad efectiva está equiparada mediante pitch', () => {
      // Maestro 124 BPM @ rate 1.0 = 124.0 BPM efectivo
      // Esclavo 120 BPM @ rate 1.0333 = 123.996 BPM efectivo (diferencia < 0.2 BPM)
      const slaveRate = Number((124 / 120).toFixed(4)); // 1.0333
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 124,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.94,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: slaveRate,
        slaveBpmConfidence: 0.9,
        validateTempoCompatibility: true,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.plan !== null);
      assert.equal(result.isTempoSynchronized, true);
    });

    it('7.4 Reporta analíticamente la deriva de tempo effectiveTempoDriftBpm cuando no se exige rechazo', () => {
      const result = calculatePhaseAlignmentPlan({
        masterCurrentTime: 10.0,
        masterBpm: 124,
        masterFirstBeatTime: 0.0,
        masterDuration: 180.0,
        masterPlaybackRate: 1.0,
        masterBpmConfidence: 0.9,

        slaveCurrentTime: 9.94,
        slaveBpm: 120,
        slaveFirstBeatTime: 0.0,
        slaveDuration: 180.0,
        slavePlaybackRate: 1.0,
        slaveBpmConfidence: 0.9,
        validateTempoCompatibility: false,
      });

      assert.equal(result.status, 'active');
      assert.ok(result.plan !== null);
      assert.equal(result.plan.isTempoSynchronized, false);
      assert.equal(result.plan.effectiveTempoDriftBpm, 4.0);
    });
  });
});
