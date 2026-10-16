/**
 * SYSTEM DJ — Test Suite: Algoritmos Matemáticos Puros de Análisis Musical (Fase 22 - Etapa 1)
 * Pruebas unitarias rigurosas para Camelot, Detección de Clave, Detección de BPM,
 * Cálculo de Energía, Orquestador y Fixtures de Archivos WAV Locales de Referencia.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  keyToCamelot,
  camelotToKey,
  pitchClassToKey,
  areKeysHarmonicallyCompatible,
  detectKey,
  detectBpm,
  calculateEnergy,
  analyzeAudioPcm,
  extractWaveformPeaks,
} from '../src/audio/analysis/index.ts';

import { writeWavFileSync, readWavFileSync } from './fixtures/wavHelper.ts';

const FIXTURES_DIR = path.resolve('tests/fixtures/audio');

// Funciones auxiliares de síntesis para pruebas unitarias
function synthesizeSineWave(freq: number, durationSec: number, sampleRate = 44100, amp = 0.3): Float32Array {
  const n = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pcm[i] = amp * Math.sin(2 * Math.PI * freq * (i / sampleRate));
  }
  return pcm;
}

function synthesizeChord(frequencies: number[], durationSec: number, sampleRate = 44100): Float32Array {
  const n = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(n);
  const amp = 0.8 / frequencies.length;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let s = 0;
    for (const f of frequencies) {
      s += amp * Math.sin(2 * Math.PI * f * t);
    }
    pcm[i] = s;
  }
  return pcm;
}

function synthesizeRhythmicPulse(bpmTarget: number, durationSec: number, sampleRate = 44100): Float32Array {
  const totalSamples = Math.floor(durationSec * sampleRate);
  const pcm = new Float32Array(totalSamples);
  const interval = 60 / bpmTarget;
  const numBeats = Math.floor(durationSec / interval);

  for (let b = 0; b < numBeats; b++) {
    const start = Math.floor(b * interval * sampleRate);
    const hitSamples = Math.min(totalSamples - start, 4410);
    for (let i = 0; i < hitSamples; i++) {
      const t = i / sampleRate;
      // Kick drum físico (barrido exponencial de frecuencia y decaimiento rápido)
      pcm[start + i] += Math.exp(-32 * t) * Math.sin(2 * Math.PI * (160 * Math.exp(-25 * t) + 55) * t);
    }
  }
  return pcm;
}

// ============================================================================
// SUITE 1: MAPEO Y RUEDA CAMELOT
// ============================================================================
describe('Fase 22 — Suite 1: Mapeo y Rueda Camelot (camelotMapper.ts)', () => {
  it('1.1 Convierte claves canónicas mayores a Camelot con sufijo B', () => {
    assert.equal(keyToCamelot('C'), '8B');
    assert.equal(keyToCamelot('G'), '9B');
    assert.equal(keyToCamelot('D'), '10B');
    assert.equal(keyToCamelot('A'), '11B');
    assert.equal(keyToCamelot('E'), '12B');
    assert.equal(keyToCamelot('B'), '1B');
    assert.equal(keyToCamelot('F#'), '2B');
    assert.equal(keyToCamelot('Db'), '3B');
    assert.equal(keyToCamelot('Ab'), '4B');
    assert.equal(keyToCamelot('Eb'), '5B');
    assert.equal(keyToCamelot('Bb'), '6B');
    assert.equal(keyToCamelot('F'), '7B');
  });

  it('1.2 Convierte claves canónicas menores a Camelot con sufijo A', () => {
    assert.equal(keyToCamelot('Am'), '8A');
    assert.equal(keyToCamelot('Em'), '9A');
    assert.equal(keyToCamelot('Bm'), '10A');
    assert.equal(keyToCamelot('F#m'), '11A');
    assert.equal(keyToCamelot('C#m'), '12A');
    assert.equal(keyToCamelot('G#m'), '1A');
    assert.equal(keyToCamelot('D#m'), '2A');
    assert.equal(keyToCamelot('A#m'), '3A');
    assert.equal(keyToCamelot('Fm'), '4A');
    assert.equal(keyToCamelot('Cm'), '5A');
    assert.equal(keyToCamelot('Gm'), '6A');
    assert.equal(keyToCamelot('Dm'), '7A');
  });

  it('1.3 Gestiona enarmonías idénticas (sostenidos y bemoles)', () => {
    assert.equal(keyToCamelot('C#'), keyToCamelot('Db'));
    assert.equal(keyToCamelot('D#'), keyToCamelot('Eb'));
    assert.equal(keyToCamelot('F#'), keyToCamelot('Gb'));
    assert.equal(keyToCamelot('G#'), keyToCamelot('Ab'));
    assert.equal(keyToCamelot('A#'), keyToCamelot('Bb'));
    assert.equal(keyToCamelot('C#m'), keyToCamelot('Dbm'));
    assert.equal(keyToCamelot('D#m'), keyToCamelot('Ebm'));
  });

  it('1.4 Normaliza cadenas con espacios y variaciones de texto (maj/min/major)', () => {
    assert.equal(keyToCamelot('  Cmaj  '), '8B');
    assert.equal(keyToCamelot('a minor'), '8A');
    assert.equal(keyToCamelot('F# min'), '11A');
    assert.equal(keyToCamelot('8B'), '8B');
    assert.equal(keyToCamelot('11A'), '11A');
  });

  it('1.5 Convierte códigos Camelot inversamente a la clave estándar canónica', () => {
    assert.equal(camelotToKey('8B'), 'C');
    assert.equal(camelotToKey('8A'), 'Am');
    assert.equal(camelotToKey('11A'), 'F#m');
    assert.equal(camelotToKey('1B'), 'B');
  });

  it('1.6 Evalúa compatibilidad armónica según las reglas de mezcla DJ', () => {
    // Misma clave
    assert.equal(areKeysHarmonicallyCompatible('8A', '8A'), true);
    // Relativo mayor / menor (mismo número, diferente letra)
    assert.equal(areKeysHarmonicallyCompatible('8A', '8B'), true);
    assert.equal(areKeysHarmonicallyCompatible('Am', 'C'), true);
    // Números adyacentes (+1 / -1)
    assert.equal(areKeysHarmonicallyCompatible('8A', '9A'), true);
    assert.equal(areKeysHarmonicallyCompatible('8A', '7A'), true);
    // Envoltura circular en la rueda (12A <-> 1A, 12B <-> 1B)
    assert.equal(areKeysHarmonicallyCompatible('12A', '1A'), true);
    assert.equal(areKeysHarmonicallyCompatible('1B', '12B'), true);
    // Claves incompatibles
    assert.equal(areKeysHarmonicallyCompatible('8A', '3A'), false);
    assert.equal(areKeysHarmonicallyCompatible('8A', '2B'), false);
    assert.equal(areKeysHarmonicallyCompatible('invalid', '8A'), false);
  });

  it('1.7 Convierte clases de tono numéricas a clave y notación Camelot con pitchClassToKey', () => {
    assert.deepEqual(pitchClassToKey(0, 'major'), { key: 'C', camelot: '8B' });
    assert.deepEqual(pitchClassToKey(9, 'minor'), { key: 'Am', camelot: '8A' });
    assert.deepEqual(pitchClassToKey(6, 'minor'), { key: 'F#m', camelot: '11A' });
    assert.deepEqual(pitchClassToKey(12, 'major'), { key: 'C', camelot: '8B' }); // Wraparound mod 12
  });
});

// ============================================================================
// SUITE 2: DETECCIÓN DE CLAVE TONAL (K-S & CROMA)
// ============================================================================
describe('Fase 22 — Suite 2: Detección Tonal y Cromagrama (keyDetector.ts)', () => {
  const sampleRate = 44100;

  it('2.1 Identifica acordes tríada mayores fundamentales (C Mayor, D Mayor, Eb Mayor)', () => {
    // C Mayor: C4 (261.63 Hz), E4 (329.63 Hz), G4 (392.00 Hz)
    const cMajPcm = synthesizeChord([261.63, 329.63, 392.00], 2.5, sampleRate);
    const cRes = detectKey(cMajPcm, sampleRate);
    assert.equal(cRes.key, 'C');
    assert.equal(cRes.camelot, '8B');
    assert.ok(cRes.correlation > 0.75, `Correlación esperada > 0.75, obtenida: ${cRes.correlation}`);
    assert.equal(cRes.isAmbiguous, false);

    // D Mayor: D4 (293.66 Hz), F#4 (369.99 Hz), A4 (440.00 Hz)
    const dMajPcm = synthesizeChord([293.66, 369.99, 440.00], 2.5, sampleRate);
    const dRes = detectKey(dMajPcm, sampleRate);
    assert.equal(dRes.key, 'D');
    assert.equal(dRes.camelot, '10B');

    // Eb Mayor: Eb4 (311.13 Hz), G4 (392.00 Hz), Bb4 (466.16 Hz)
    const ebMajPcm = synthesizeChord([311.13, 392.00, 466.16], 2.5, sampleRate);
    const ebRes = detectKey(ebMajPcm, sampleRate);
    assert.ok(ebRes.key === 'D#' || ebRes.key === 'Eb');
    assert.equal(ebRes.camelot, '5B');
  });

  it('2.2 Identifica acordes tríada menores (A Menor, F# Menor, C Menor)', () => {
    // A Menor: A3 (220.00 Hz), C4 (261.63 Hz), E4 (329.63 Hz)
    const aMinPcm = synthesizeChord([220.00, 261.63, 329.63], 2.5, sampleRate);
    const aRes = detectKey(aMinPcm, sampleRate);
    assert.equal(aRes.key, 'Am');
    assert.equal(aRes.camelot, '8A');
    assert.ok(aRes.correlation > 0.75);

    // F# Menor: F#3 (185.00 Hz), A3 (220.00 Hz), C#4 (277.18 Hz)
    const fSharpMinPcm = synthesizeChord([185.00, 220.00, 277.18], 2.5, sampleRate);
    const fRes = detectKey(fSharpMinPcm, sampleRate);
    assert.equal(fRes.key, 'F#m');
    assert.equal(fRes.camelot, '11A');
  });

  it('2.3 Identifica correctamente inversiones de acordes (1ª y 2ª inversión)', () => {
    // C Mayor 1ª inversión: E4 (329.63 Hz), G4 (392.00 Hz), C5 (523.25 Hz)
    const c1stInv = synthesizeChord([329.63, 392.00, 523.25], 2.5, sampleRate);
    const res1 = detectKey(c1stInv, sampleRate);
    assert.equal(res1.key, 'C');
    assert.equal(res1.camelot, '8B');

    // C Mayor 2ª inversión: G3 (196.00 Hz), C4 (261.63 Hz), E4 (329.63 Hz)
    const c2ndInv = synthesizeChord([196.00, 261.63, 329.63], 2.5, sampleRate);
    const res2 = detectKey(c2ndInv, sampleRate);
    assert.equal(res2.key, 'C');
    assert.equal(res2.camelot, '8B');

    // A Menor 1ª inversión: C4 (261.63 Hz), E4 (329.63 Hz), A4 (440.00 Hz)
    const a1stInv = synthesizeChord([261.63, 329.63, 440.00], 2.5, sampleRate);
    const res3 = detectKey(a1stInv, sampleRate);
    assert.equal(res3.key, 'Am');
    assert.equal(res3.camelot, '8A');
  });

  it('2.4 Identifica la tonalidad global de una progresión armónica (I-IV-V-I)', () => {
    // Progresión en Do Mayor: C (1s) -> F (1s) -> G (1s) -> C (1s)
    const totalSamples = sampleRate * 4;
    const progressionPcm = new Float32Array(totalSamples);

    const cChord = [261.63, 329.63, 392.00];
    const fChord = [174.61, 220.00, 261.63];
    const gChord = [196.00, 246.94, 293.66];

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let freqs = cChord;
      if (t >= 1.0 && t < 2.0) freqs = fChord;
      else if (t >= 2.0 && t < 3.0) freqs = gChord;

      let s = 0;
      for (const f of freqs) s += 0.25 * Math.sin(2 * Math.PI * f * t);
      progressionPcm[i] = s;
    }

    const res = detectKey(progressionPcm, sampleRate);
    assert.equal(res.key, 'C');
    assert.equal(res.camelot, '8B');
    assert.equal(res.isAmbiguous, false);
  });

  it('2.5 Casos ambiguos o sin contenido tonal no se presentan como certeza', () => {
    // Tritono disonante simétrico (C4 + F#4): no define tonalidad única
    const tritonePcm = synthesizeChord([261.63, 369.99], 2.0, sampleRate);
    const tritoneRes = detectKey(tritonePcm, sampleRate);
    assert.equal(tritoneRes.isAmbiguous, true);
    assert.equal(tritoneRes.key, undefined);
    assert.equal(tritoneRes.camelot, undefined);

    // Ruido blanco plano (distribución cromática uniforme sin afinación)
    const noisePcm = new Float32Array(sampleRate * 2);
    for (let i = 0; i < noisePcm.length; i++) {
      noisePcm[i] = (Math.random() * 2 - 1) * 0.3;
    }
    const noiseRes = detectKey(noisePcm, sampleRate);
    assert.equal(noiseRes.isAmbiguous, true);
    assert.equal(noiseRes.key, undefined);
    assert.equal(noiseRes.confidence, 0);

    // Silencio absoluto
    const silentPcm = new Float32Array(sampleRate * 2);
    const silentRes = detectKey(silentPcm, sampleRate);
    assert.equal(silentRes.isAmbiguous, true);
    assert.equal(silentRes.confidence, 0);
  });
});

// ============================================================================
// SUITE 3: DETECCIÓN DE BPM (AUTOCORRELACIÓN Y ARMÓNICOS)
// ============================================================================
describe('Fase 22 — Suite 3: Detección de BPM (bpmDetector.ts)', () => {
  const sampleRate = 44100;

  it('3.1 Detecta con precisión tempos diversos sin sesgo arbitrario a un valor fijo', () => {
    const testTempos = [70.0, 85.0, 120.0, 128.0, 140.0, 175.0];

    for (const targetBpm of testTempos) {
      const pcm = synthesizeRhythmicPulse(targetBpm, 10, sampleRate);
      const res = detectBpm(pcm, sampleRate);

      assert.equal(res.isAmbiguous, false, `Tempo ${targetBpm} no debería ser ambiguo`);
      assert.ok(typeof res.bpm === 'number', `Debería retornar un número para ${targetBpm}`);
      const error = Math.abs(res.bpm - targetBpm);
      assert.ok(
        error <= 0.8,
        `Tempo detectado ${res.bpm} difiere de ${targetBpm} por más de 0.8 BPM (error: ${error.toFixed(2)})`
      );
      assert.ok(res.confidence >= 0.7, `Confianza para ${targetBpm} debería ser >= 0.7 (actual: ${res.confidence})`);
    }
  });

  it('3.2 Evalúa armónicos de medio tiempo y doble tiempo en alternateBpm', () => {
    // Pulso a 128 BPM
    const pcm = synthesizeRhythmicPulse(128.0, 8, sampleRate);
    const res = detectBpm(pcm, sampleRate);

    assert.equal(res.bpm, 128);
    assert.ok(Array.isArray(res.alternateBpm));
    // Debe incluir medio tiempo (64 BPM) o doble tiempo (256 BPM) en candidatos armónicos
    assert.ok(
      res.alternateBpm.includes(64) || res.alternateBpm.some(b => Math.abs(b - 64) <= 1.0),
      `Se esperaba medio tiempo ~64 en alternateBpm, obtenido: ${JSON.stringify(res.alternateBpm)}`
    );
  });

  it('3.3 Identifica ritmos sin base percusiva clara (drones, ambient) como ambiguos', () => {
    // Tono continuo sin transitorios rítmicos
    const dronePcm = synthesizeSineWave(110.0, 6, sampleRate, 0.4);
    const res = detectBpm(dronePcm, sampleRate);

    assert.equal(res.isAmbiguous, true);
    assert.equal(res.bpm, undefined);
    assert.ok(res.confidence < 0.25);
  });

  it('3.4 Silencio y buffers breves se reportan como ambiguos con confianza cero', () => {
    const silent = new Float32Array(sampleRate * 2);
    const res = detectBpm(silent, sampleRate);
    assert.equal(res.isAmbiguous, true);
    assert.equal(res.confidence, 0);

    const empty = new Float32Array(0);
    const resEmpty = detectBpm(empty, sampleRate);
    assert.equal(resEmpty.isAmbiguous, true);
  });

  it('3.5 Evalúa correctamente ritmos en medio tiempo (half-time) vinculando su doble tempo armónico', () => {
    // Pulso con sensación de medio tiempo (golpes espaciados a 70 BPM)
    const pcm = synthesizeRhythmicPulse(70.0, 10, sampleRate);
    const res = detectBpm(pcm, sampleRate);
    assert.ok(Math.abs((res.bpm ?? 0) - 70.0) <= 0.8);
    // alternateBpm debe contener el doble tempo (140 BPM)
    assert.ok(
      res.alternateBpm?.some(b => Math.abs(b - 140.0) <= 1.5),
      `Se esperaba doble tempo ~140 en alternateBpm, obtenido: ${JSON.stringify(res.alternateBpm)}`
    );
  });
});

// ============================================================================
// SUITE 4: CÁLCULO DE ENERGÍA ACÚSTICA (ÍNDICE HEURÍSTICO 0..10)
// ============================================================================
describe('Fase 22 — Suite 4: Cálculo de Energía Acústica (energyCalculator.ts)', () => {
  const sampleRate = 44100;

  it('4.1 Silencio absoluto produce índice de energía 0', () => {
    const silent = new Float32Array(sampleRate * 2);
    const res = calculateEnergy(silent, sampleRate);

    assert.equal(res.energy, 0);
    assert.equal(res.rawScore, 0);
    assert.equal(res.breakdown.rmsComponent, 0);
    assert.equal(res.breakdown.hfcComponent, 0);
  });

  it('4.2 Señal extremadamente suave e inaudible (-43 dBFS) produce energía baja (0 a 2)', () => {
    const quiet = synthesizeSineWave(200.0, 2, sampleRate, 0.007);
    const res = calculateEnergy(quiet, sampleRate);

    assert.ok(res.energy >= 0 && res.energy <= 2, `Energía esperada 0..2, obtenida: ${res.energy}`);
    assert.ok(res.rmsDbfs < -38);
  });

  it('4.3 Señal de mezcla media equilibrada (-16 dBFS) produce energía intermedia (5 a 7)', () => {
    const medPcm = new Float32Array(sampleRate * 2);
    for (let i = 0; i < medPcm.length; i++) {
      const t = i / sampleRate;
      medPcm[i] = 0.20 * Math.sin(2 * Math.PI * 120 * t) +
                 0.10 * Math.sin(2 * Math.PI * 800 * t) +
                 0.05 * Math.sin(2 * Math.PI * 3500 * t);
    }
    const res = calculateEnergy(medPcm, sampleRate);
    assert.ok(res.energy >= 5 && res.energy <= 7, `Energía esperada 5..7, obtenida: ${res.energy}`);
  });

  it('4.4 Pista de club densa, saturada y con agudos marcados produce energía alta (8 a 10)', () => {
    const loudPcm = new Float32Array(sampleRate * 2);
    for (let i = 0; i < loudPcm.length; i++) {
      const t = i / sampleRate;
      const raw = 0.6 * Math.sin(2 * Math.PI * 60 * t) +
                  0.4 * Math.sin(2 * Math.PI * 500 * t) +
                  0.35 * Math.sin(2 * Math.PI * 4500 * t);
      loudPcm[i] = Math.tanh(raw * 1.6); // Compresión de pico / saturación densa
    }
    const res = calculateEnergy(loudPcm, sampleRate);
    assert.ok(res.energy >= 8 && res.energy <= 10, `Energía esperada 8..10, obtenida: ${res.energy}`);
  });

  it('4.5 Respeta la suma de ponderaciones explícitas y los límites estrictos [0, 10]', () => {
    const randomPcm = new Float32Array(sampleRate * 2);
    for (let i = 0; i < randomPcm.length; i++) {
      randomPcm[i] = (Math.random() * 2 - 1) * 1.5; // Sobre-amplitud para probar clamping
    }
    const res = calculateEnergy(randomPcm, sampleRate);

    assert.ok(Number.isInteger(res.energy), 'La energía debe ser un entero');
    assert.ok(res.energy >= 0 && res.energy <= 10, 'La energía debe estar acotada entre 0 y 10');
    // Verificar que los componentes breakdown están entre 0.0 y 1.0
    assert.ok(res.breakdown.rmsComponent >= 0 && res.breakdown.rmsComponent <= 1);
    assert.ok(res.breakdown.hfcComponent >= 0 && res.breakdown.hfcComponent <= 1);
    assert.ok(res.breakdown.dynamicComponent >= 0 && res.breakdown.dynamicComponent <= 1);
  });

  it('4.6 Manejo seguro e inmune ante valores no finitos (NaN, Infinity, -Infinity)', () => {
    // Buffer con muestras no finitas mezcladas con valores normales
    const dirtyPcm = new Float32Array([0.5, NaN, Infinity, -Infinity, -0.5, NaN]);
    const resDirty = calculateEnergy(dirtyPcm, sampleRate);
    assert.ok(Number.isFinite(resDirty.energy));
    assert.ok(resDirty.energy >= 0 && resDirty.energy <= 10);
    assert.ok(!Number.isNaN(resDirty.rawScore));

    // Buffer compuesto exclusivamente por NaN o Infinity
    const allNanPcm = new Float32Array([NaN, Infinity, -Infinity]);
    const resNan = calculateEnergy(allNanPcm, sampleRate);
    assert.equal(resNan.energy, 0);
    assert.equal(resNan.rawScore, 0);
  });
});

// ============================================================================
// SUITE 5: ORQUESTADOR PURO DE ANÁLISIS (audioAnalyzer.ts)
// ============================================================================
describe('Fase 22 — Suite 5: Orquestador Completo (audioAnalyzer.ts)', () => {
  const sampleRate = 44100;

  it('5.1 Analiza integralmente una pista musical completa (BPM + Key + Energy + Peaks)', () => {
    // Generar pista sintética de 6 segundos: 124 BPM, Do Mayor, energía ~6-7
    const durationSec = 6;
    const totalSamples = sampleRate * durationSec;
    const pcm = new Float32Array(totalSamples);

    // Ritmo 124 BPM
    const interval = 60 / 124;
    const numBeats = Math.floor(durationSec / interval);
    for (let b = 0; b < numBeats; b++) {
      const start = Math.floor(b * interval * sampleRate);
      for (let i = 0; i < 4410; i++) {
        if (start + i >= totalSamples) break;
        const t = i / sampleRate;
        pcm[start + i] += 0.5 * Math.exp(-30 * t) * Math.sin(2 * Math.PI * 70 * t);
      }
    }
    // Armonía en Do Mayor
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      pcm[i] += 0.15 * Math.sin(2 * Math.PI * 261.63 * t) +
                0.15 * Math.sin(2 * Math.PI * 329.63 * t) +
                0.15 * Math.sin(2 * Math.PI * 392.00 * t);
    }

    const analysis = analyzeAudioPcm(pcm, sampleRate);

    assert.equal(analysis.status, 'analyzed');
    assert.equal(analysis.bpm, 124);
    assert.equal(analysis.key, 'C');
    assert.equal(analysis.camelot, '8B');
    assert.ok(typeof analysis.energy === 'number' && analysis.energy >= 5 && analysis.energy <= 8);
    assert.ok(Array.isArray(analysis.waveformPeaks));
    assert.equal(analysis.waveformPeaks.length, 100);
    // Verificar que los picos están normalizados en [0.0, 1.0]
    for (const p of analysis.waveformPeaks) {
      assert.ok(p >= 0 && p <= 1.0);
    }
  });

  it('5.2 Distingue el estado unsupported para audio sin estructura o en silencio', () => {
    const silent = new Float32Array(sampleRate * 2);
    const silentRes = analyzeAudioPcm(silent, sampleRate);
    assert.equal(silentRes.status, 'unsupported');
    assert.ok(silentRes.analysisError?.includes('silencio'));

    const empty = new Float32Array(0);
    const emptyRes = analyzeAudioPcm(empty, sampleRate);
    assert.equal(emptyRes.status, 'unsupported');
    assert.ok(emptyRes.analysisError?.includes('vacío'));
  });

  it('5.3 Medición de rendimiento en el equipo disponible (< 2.0s para 5 minutos de audio)', () => {
    const durationSec = 300; // 5 minutos de audio
    const totalSamples = sampleRate * durationSec;
    const pcm = new Float32Array(totalSamples);

    // Señal rítmica a 124 BPM
    const interval = 60 / 124;
    const numBeats = Math.floor(durationSec / interval);
    for (let b = 0; b < numBeats; b++) {
      const start = Math.floor(b * interval * sampleRate);
      for (let i = 0; i < 4410; i++) {
        if (start + i >= totalSamples) break;
        const t = i / sampleRate;
        pcm[start + i] += 0.4 * Math.exp(-30 * t) * Math.sin(2 * Math.PI * 75 * t);
      }
    }
    // Armonía en La Menor de fondo (A3, C4, E4)
    for (let i = 0; i < totalSamples; i += 3) {
      const t = i / sampleRate;
      pcm[i] += 0.1 * Math.sin(2 * Math.PI * 220 * t) +
                0.1 * Math.sin(2 * Math.PI * 261.63 * t) +
                0.1 * Math.sin(2 * Math.PI * 329.63 * t);
    }

    const t0 = performance.now();
    const result = analyzeAudioPcm(pcm, sampleRate);
    const elapsedMs = performance.now() - t0;

    assert.equal(result.status, 'analyzed');
    assert.equal(result.bpm, 124);
    assert.equal(result.key, 'Am');
    assert.equal(result.camelot, '8A');

    // La meta es menor a 2000 ms en el hardware local
    assert.ok(
      elapsedMs < 2000,
      `Tiempo de análisis excesivo: ${elapsedMs.toFixed(1)} ms (meta: < 2000 ms)`
    );
  });

  it('5.4 extractWaveformPeaks extrae el número exacto de picos normalizados [0.0, 1.0]', () => {
    const pcm = new Float32Array([0.1, -0.5, 0.8, -0.2, 0.4, 0.9, -1.0, 0.2]);
    const peaks = extractWaveformPeaks(pcm, 4);
    assert.equal(peaks.length, 4);
    assert.equal(peaks[3], 1.0); // -1.0 normalizado a 1.0
    assert.deepEqual(extractWaveformPeaks(new Float32Array(0)), []);
  });
});

// ============================================================================
// SUITE 6: ARCHIVOS DE AUDIO LOCALES DE REFERENCIA (WAV REALES EN DISCO)
// ============================================================================
describe('Fase 22 — Suite 6: Archivos de Audio Locales de Referencia (.wav reales)', () => {
  const sampleRate = 44100;

  before(() => {
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    // 1. Archivo de referencia House: 124.0 BPM, C Mayor (8B)
    const housePath = path.join(FIXTURES_DIR, 'reference_house_124bpm_cmaj.wav');
    const housePcm = new Float32Array(sampleRate * 6);
    const houseInterval = 60 / 124;
    for (let b = 0; b < Math.floor(6 / houseInterval); b++) {
      const start = Math.floor(b * houseInterval * sampleRate);
      for (let i = 0; i < 4410; i++) {
        const t = i / sampleRate;
        housePcm[start + i] += 0.6 * Math.exp(-30 * t) * Math.sin(2 * Math.PI * 65 * t);
      }
    }
    for (let i = 0; i < housePcm.length; i++) {
      const t = i / sampleRate;
      housePcm[i] += 0.15 * Math.sin(2 * Math.PI * 261.63 * t) +
                     0.15 * Math.sin(2 * Math.PI * 329.63 * t) +
                     0.15 * Math.sin(2 * Math.PI * 392.00 * t);
    }
    writeWavFileSync(housePath, housePcm, sampleRate);

    // 2. Archivo de referencia Drum & Bass: 174.0 BPM, F# Menor (11A)
    const dnbPath = path.join(FIXTURES_DIR, 'reference_dnb_174bpm_fsharpmin.wav');
    const dnbPcm = new Float32Array(sampleRate * 6);
    const dnbInterval = 60 / 174;
    for (let b = 0; b < Math.floor(6 / dnbInterval); b++) {
      const start = Math.floor(b * dnbInterval * sampleRate);
      for (let i = 0; i < 4410; i++) {
        const t = i / sampleRate;
        dnbPcm[start + i] += 0.7 * Math.exp(-35 * t) * Math.sin(2 * Math.PI * 75 * t);
      }
    }
    for (let i = 0; i < dnbPcm.length; i++) {
      const t = i / sampleRate;
      dnbPcm[i] += 0.15 * Math.sin(2 * Math.PI * 185.00 * t) +
                   0.15 * Math.sin(2 * Math.PI * 220.00 * t) +
                   0.15 * Math.sin(2 * Math.PI * 277.18 * t);
    }
    writeWavFileSync(dnbPath, dnbPcm, sampleRate);

    // 3. Archivo de referencia Hip Hop / Downtempo: 90.0 BPM, A Menor (8A)
    const hiphopPath = path.join(FIXTURES_DIR, 'reference_hiphop_90bpm_amin.wav');
    const hiphopPcm = new Float32Array(sampleRate * 6);
    const hiphopInterval = 60 / 90;
    for (let b = 0; b < Math.floor(6 / hiphopInterval); b++) {
      const start = Math.floor(b * hiphopInterval * sampleRate);
      for (let i = 0; i < 4410; i++) {
        const t = i / sampleRate;
        hiphopPcm[start + i] += 0.5 * Math.exp(-25 * t) * Math.sin(2 * Math.PI * 60 * t);
      }
    }
    for (let i = 0; i < hiphopPcm.length; i++) {
      const t = i / sampleRate;
      hiphopPcm[i] += 0.15 * Math.sin(2 * Math.PI * 220.00 * t) +
                      0.15 * Math.sin(2 * Math.PI * 261.63 * t) +
                      0.15 * Math.sin(2 * Math.PI * 329.63 * t);
    }
    writeWavFileSync(hiphopPath, hiphopPcm, sampleRate);

    // 4. Archivo de referencia Ambient: Tono continuo sin percusión
    const ambientPath = path.join(FIXTURES_DIR, 'reference_ambient_drone.wav');
    const ambientPcm = synthesizeSineWave(110.0, 5, sampleRate, 0.3);
    writeWavFileSync(ambientPath, ambientPcm, sampleRate);
  });

  after(() => {
    // Limpieza de archivos generados para mantener el repositorio limpio
    if (fs.existsSync(FIXTURES_DIR)) {
      const files = fs.readdirSync(FIXTURES_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(FIXTURES_DIR, file));
      }
      fs.rmdirSync(FIXTURES_DIR);
    }
  });

  it('6.1 Lee y analiza pista local real de House (124 BPM, Do Mayor / 8B)', () => {
    const filePath = path.join(FIXTURES_DIR, 'reference_house_124bpm_cmaj.wav');
    assert.ok(fs.existsSync(filePath), 'El archivo físico debe existir en el disco');

    const { pcm, sampleRate: sr } = readWavFileSync(filePath);
    assert.equal(sr, 44100);
    assert.ok(pcm.length > 0);

    const result = analyzeAudioPcm(pcm, sr);
    assert.equal(result.status, 'analyzed');
    assert.ok(Math.abs((result.bpm ?? 0) - 124) <= 1.0);
    assert.equal(result.key, 'C');
    assert.equal(result.camelot, '8B');
    assert.ok(typeof result.energy === 'number' && result.energy >= 5);
  });

  it('6.2 Lee y analiza pista local real de Drum & Bass (174 BPM, Fa# Menor / 11A)', () => {
    const filePath = path.join(FIXTURES_DIR, 'reference_dnb_174bpm_fsharpmin.wav');
    const { pcm, sampleRate: sr } = readWavFileSync(filePath);

    const result = analyzeAudioPcm(pcm, sr);
    assert.equal(result.status, 'analyzed');
    assert.ok(Math.abs((result.bpm ?? 0) - 174) <= 1.0);
    assert.equal(result.key, 'F#m');
    assert.equal(result.camelot, '11A');
  });

  it('6.3 Lee y analiza pista local real de Hip Hop (90 BPM, La Menor / 8A)', () => {
    const filePath = path.join(FIXTURES_DIR, 'reference_hiphop_90bpm_amin.wav');
    const { pcm, sampleRate: sr } = readWavFileSync(filePath);

    const result = analyzeAudioPcm(pcm, sr);
    assert.equal(result.status, 'analyzed');
    assert.ok(Math.abs((result.bpm ?? 0) - 90) <= 1.0);
    assert.equal(result.key, 'Am');
    assert.equal(result.camelot, '8A');
  });

  it('6.4 Lee pista local real de Ambient y determina estado sin tempo (unsupported / indefinido)', () => {
    const filePath = path.join(FIXTURES_DIR, 'reference_ambient_drone.wav');
    const { pcm, sampleRate: sr } = readWavFileSync(filePath);

    const result = analyzeAudioPcm(pcm, sr);
    // Dado que no tiene ritmo percusivo, BPM debe ser indefinido
    assert.equal(result.bpm, undefined);
  });
});
