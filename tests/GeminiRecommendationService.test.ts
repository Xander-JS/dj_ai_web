/**
 * SYSTEM DJ — Gemini AI Recommendation Service Unit Tests
 * Pruebas unitarias para:
 * 1. Precisión armónica y Camelot (válidas, inválidas, relativas, adyacentes).
 * 2. Tonalidad desconocida y ausencia de invención de puntuación armónica.
 * 3. BPM iguales y ajuste de pitch 0%.
 * 4. Ajuste de pitch dentro del fader de ±8%.
 * 5. Ajuste de pitch fuera de ±8% y penalización de compatibilidad.
 * 6. Detección justificada de medio tiempo y doble tiempo (sin afirmar transición automática).
 * 7. Detección y corrección de explicaciones musicales erróneas o alucinadas por Gemini.
 * 8. Resolución de artista ausente y títulos compuestos ("Artista - Título") sin inventar metadatos.
 * 9. Funcionamiento garantizado de recomendaciones simuladas y reales mediante mock HTTP.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { djStore } from '../src/store/useDJStore.ts';
import {
  resolveTrackArtistAndTitle,
  extractCandidateMetadata,
  evaluateHarmonicCompatibility,
  evaluateTempoCompatibility,
  calculateValidatedScore,
  sanitizeJustification,
  generateMockRecommendations,
  applyRecommendationExplanations,
  getTrackRecommendations,
  getTrackRecommendationExplanations,
  sanitizeRecommendationExplanation,
  PITCH_LIMIT_PERCENT,
} from '../src/services/ai/geminiRecommendationService.ts';
import type { Track } from '../src/types/track.ts';

function createStubTrack(
  id: string,
  title: string,
  artist: string,
  bpm?: number,
  camelot?: Track['analysis']['camelot'],
  energy?: number
): Track {
  return {
    id,
    title,
    artist,
    duration: 180,
    durationFormatted: '3:00',
    type: 'audio',
    source: { type: 'indexeddb', indexedDbKey: id },
    analysis: {
      status: bpm ? 'analyzed' : 'pending',
      bpm,
      key: camelot ? 'Am' : undefined,
      camelot,
      energy,
    },
    dateAdded: 1600000000000,
  };
}

function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}/api/ai/recommendations`;
      resolve({
        url,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

describe('SYSTEM DJ — Auditoría y Validación de Precisión Musical', () => {
  // -------------------------------------------------------------------------
  // 1. Relación Camelot válida e inválida
  // -------------------------------------------------------------------------
  describe('1. Relación Camelot válida e inválida', () => {
    test('Identifica misma tonalidad como válida (12A -> 12A)', () => {
      const result = evaluateHarmonicCompatibility('12A', '12A');
      assert.equal(result.compatible, true);
      assert.equal(result.relation, 'same_key');
      assert.equal(result.harmonicScore, 100);
      assert.ok(result.description.includes('Misma tonalidad'));
    });

    test('Identifica tonalidad relativa legítima con el mismo número y letra opuesta (12A -> 12B y 8B -> 8A)', () => {
      const minorToMajor = evaluateHarmonicCompatibility('12A', '12B');
      assert.equal(minorToMajor.compatible, true);
      assert.equal(minorToMajor.relation, 'relative');
      assert.equal(minorToMajor.harmonicScore, 95);
      assert.ok(minorToMajor.description.includes('relativa mayor'));

      const majorToMinor = evaluateHarmonicCompatibility('8B', '8A');
      assert.equal(majorToMinor.compatible, true);
      assert.equal(majorToMinor.relation, 'relative');
      assert.equal(majorToMinor.harmonicScore, 95);
      assert.ok(majorToMinor.description.includes('relativa menor'));
    });

    test('Identifica tonalidad adyacente cíclica (+1/-1 en la rueda) con la misma letra', () => {
      const adjacentMinus = evaluateHarmonicCompatibility('12A', '11A');
      assert.equal(adjacentMinus.compatible, true);
      assert.equal(adjacentMinus.relation, 'adjacent');
      assert.equal(adjacentMinus.harmonicScore, 88);

      const adjacentPlus = evaluateHarmonicCompatibility('12A', '1A');
      assert.equal(adjacentPlus.compatible, true);
      assert.equal(adjacentPlus.relation, 'adjacent');
      assert.equal(adjacentPlus.harmonicScore, 88);

      const wrapAround = evaluateHarmonicCompatibility('1B', '12B');
      assert.equal(wrapAround.compatible, true);
      assert.equal(wrapAround.relation, 'adjacent');
    });

    test('Identifica tonalidades incompatibles y rechaza 8A como relativa de 12A', () => {
      // Caso auditado: Gemini afirmó que 8A (Am) era la relativa menor de 12A (C#m)
      const result = evaluateHarmonicCompatibility('12A', '8A');
      assert.equal(result.compatible, false);
      assert.equal(result.relation, 'incompatible');
      assert.equal(result.harmonicScore, 30);
      assert.ok(result.description.includes('incompatibles'));
    });

    test('Normaliza nombres textuales de clave a Camelot antes de evaluar', () => {
      const result = evaluateHarmonicCompatibility('C#m', 'E'); // 12A y 12B
      assert.equal(result.compatible, true);
      assert.equal(result.relation, 'relative');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Tonalidad desconocida
  // -------------------------------------------------------------------------
  describe('2. Tonalidad desconocida', () => {
    test('Devuelve relation = "unknown" y harmonicScore = null cuando falta alguna clave', () => {
      const refMissing = evaluateHarmonicCompatibility(undefined, '8A');
      assert.equal(refMissing.compatible, null);
      assert.equal(refMissing.relation, 'unknown');
      assert.equal(refMissing.harmonicScore, null);
      assert.ok(refMissing.description.includes('no disponible'));

      const candMissing = evaluateHarmonicCompatibility('12A', undefined);
      assert.equal(candMissing.compatible, null);
      assert.equal(candMissing.relation, 'unknown');
      assert.equal(candMissing.harmonicScore, null);

      const bothMissing = evaluateHarmonicCompatibility('', '');
      assert.equal(bothMissing.compatible, null);
      assert.equal(bothMissing.relation, 'unknown');
      assert.equal(bothMissing.harmonicScore, null);
    });

    test('No inventa puntuación armónica cuando la tonalidad es desconocida', () => {
      const unknownHarmonic = evaluateHarmonicCompatibility(undefined, undefined);
      const validTempo = evaluateTempoCompatibility(124, 124);

      const score = calculateValidatedScore(unknownHarmonic, validTempo);
      // El puntaje no debe atribuir un 100% como si la armonía hubiera sido validada
      assert.ok(score <= 75);
      assert.equal(unknownHarmonic.harmonicScore, null);
    });
  });

  // -------------------------------------------------------------------------
  // 3. BPM iguales
  // -------------------------------------------------------------------------
  describe('3. BPM iguales', () => {
    test('BPM idénticos resultan en pitchShiftPercent = 0 y score = 100', () => {
      const result = evaluateTempoCompatibility(124.0, 124.0);
      assert.equal(result.compatible, true);
      assert.equal(result.relation, 'exact');
      assert.equal(result.pitchShiftPercent, 0);
      assert.equal(result.tempoScore, 100);
      assert.ok(result.description.includes('No requiere ajuste'));
    });

    test('BPM con diferencia despreciable (< 0.05) se consideran idénticos', () => {
      const result = evaluateTempoCompatibility(128.0, 128.02);
      assert.equal(result.compatible, true);
      assert.equal(result.relation, 'exact');
      assert.equal(result.pitchShiftPercent, 0);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Ajuste de pitch dentro de ±8 %
  // -------------------------------------------------------------------------
  describe('4. Ajuste de pitch dentro de ±8 %', () => {
    test('Calcula correctamente pitch shift dentro del rango permitido (124 vs 128 -> -3.1%)', () => {
      const result = evaluateTempoCompatibility(124, 128);
      assert.equal(result.compatible, true);
      assert.equal(result.relation, 'in_range');
      assert.equal(result.pitchShiftPercent, -3.1);
      assert.ok(result.tempoScore! >= 70 && result.tempoScore! <= 95);
      assert.ok(result.description.includes('±8%'));
    });

    test('Calcula correctamente pitch shift hacia arriba (124 vs 120 -> +3.3%)', () => {
      const result = evaluateTempoCompatibility(124, 120);
      assert.equal(result.compatible, true);
      assert.equal(result.relation, 'in_range');
      assert.equal(result.pitchShiftPercent, 3.3);
      assert.ok(result.description.includes('+3.3%'));
    });

    test('Calcula correctamente pitch shift hacia arriba para Strobe (129.4 vs 128 -> +1.1%, unificando signo positivo)', () => {
      // Caso auditado: Strobe a 128 BPM requiere acelerarse para empatar referencia a 129.4 BPM
      // requiredRate = 129.4 / 128 = 1.0109375 -> +1.09375% -> +1.1%
      const result = evaluateTempoCompatibility(129.4, 128);
      assert.equal(result.compatible, true);
      assert.equal(result.relation, 'in_range');
      assert.equal(result.pitchShiftPercent, 1.1);
      assert.ok(result.pitchShiftPercent > 0, 'El pitch shift para acelerar la pista debe ser positivo');
      assert.ok(result.description.includes('+1.1%'));
    });

    test('Respeta el límite exacto de ±8% (PITCH_LIMIT_PERCENT = 8.0)', () => {
      assert.equal(PITCH_LIMIT_PERCENT, 8.0);
      // 100 vs 108 -> (100 - 108) / 108 = -7.4% (dentro)
      const inside = evaluateTempoCompatibility(100, 108);
      assert.equal(inside.compatible, true);
      assert.equal(inside.relation, 'in_range');

      // 100 vs 109 -> (100 - 109) / 109 = -8.26% (fuera)
      const outside = evaluateTempoCompatibility(100, 109);
      assert.equal(outside.compatible, false);
      assert.equal(outside.relation, 'out_of_range');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Ajuste de pitch fuera de ±8 %
  // -------------------------------------------------------------------------
  describe('5. Ajuste de pitch fuera de ±8 %', () => {
    test('Detecta caso observado en la prueba: 84.8 BPM vs 105 BPM está fuera de rango', () => {
      const result = evaluateTempoCompatibility(84.8, 105);
      assert.equal(result.compatible, false);
      assert.equal(result.relation, 'out_of_range');
      assert.equal(result.pitchShiftPercent, -19.2); // (84.8 - 105) / 105 * 100 = -19.24%
      assert.equal(result.tempoScore, 25);
      assert.ok(result.description.includes('fuera del rango de pitch de ±8%'));
    });

    test('Penaliza severamente la puntuación de compatibilidad cuando el tempo está fuera de rango', () => {
      const harmonic = evaluateHarmonicCompatibility('12A', '12A'); // Misma clave (100)
      const tempoOutOfRange = evaluateTempoCompatibility(84.8, 105); // Fuera de rango

      // Aunque la armonía sea 100% idéntica, no se puede mezclar por pitch fader normal
      const score = calculateValidatedScore(harmonic, tempoOutOfRange);
      assert.ok(score <= 40, `El score debe limitarse a <= 40 pero fue ${score}`);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Casos de medio tiempo y doble tiempo
  // -------------------------------------------------------------------------
  describe('6. Casos de medio tiempo y doble tiempo', () => {
    test('Identifica alternativa de medio tiempo cuando el BPM candidato duplica la referencia (85 vs 170)', () => {
      const result = evaluateTempoCompatibility(85, 170);
      assert.equal(result.compatible, true);
      assert.equal(result.relation, 'half_time');
      assert.equal(result.effectiveBpm, 85);
      assert.equal(result.pitchShiftPercent, 0);
      assert.ok(result.description.includes('medio tiempo'));
      // No debe afirmar que la transición funcionará automáticamente
      assert.ok(result.description.includes('no es automática'));
    });

    test('Identifica alternativa de doble tiempo cuando el BPM candidato es la mitad de la referencia (160 vs 80)', () => {
      const result = evaluateTempoCompatibility(160, 80);
      assert.equal(result.compatible, true);
      assert.equal(result.relation, 'double_time');
      assert.equal(result.effectiveBpm, 160);
      assert.equal(result.pitchShiftPercent, 0);
      assert.ok(result.description.includes('doble tiempo'));
      assert.ok(result.description.includes('no es automática'));
    });

    test('La recomendación describe medio tiempo como opción musical no automática, sin afirmar elegibilidad SYNC', () => {
      const [recommendation] = generateMockRecommendations(
        { id: 'ref', title: 'Reference', artist: 'Artist', bpm: 85, camelot: '8A' },
        [{ id: 'candidate', title: 'Candidate', artist: 'Artist', bpm: 170, camelot: '8A' }]
      );

      assert.equal(recommendation.tempoEvaluation?.relation, 'half_time');
      assert.match(recommendation.justification, /requiere evaluar compás y estilo; no es automática/i);
      assert.doesNotMatch(`${recommendation.justification} ${recommendation.transitionSuggestion}`, /SYNC automático|sincronización automática/i);
    });

    test('Rechaza medio/doble tiempo cuando la relación matemática no cuadra (84.8 vs 105)', () => {
      const result = evaluateTempoCompatibility(84.8, 105);
      assert.notEqual(result.relation, 'half_time');
      assert.notEqual(result.relation, 'double_time');
      assert.equal(result.relation, 'out_of_range');
    });

    test('Rechaza Midnight City como candidato half-time (129.4 vs 105 -> -18.86% de diferencia, fuera de ±8%)', () => {
      // Caso auditado: Midnight City a 105 BPM vs referencia a 129.4 BPM
      // (105 - 129.4) / 129.4 = -18.86% (fuera de ±8%)
      // medio tiempo: 105 / 2 = 52.5 -> (129.4 - 52.5) / 52.5 = 146.5% (fuera de ±8%)
      // doble tiempo: 105 * 2 = 210 -> (129.4 - 210) / 210 = -38.4% (fuera de ±8%)
      const result = evaluateTempoCompatibility(129.4, 105);
      assert.equal(result.compatible, false);
      assert.equal(result.relation, 'out_of_range');
      assert.notEqual(result.relation, 'half_time');
      assert.notEqual(result.relation, 'double_time');
      assert.equal(result.effectiveBpm, undefined);
      assert.ok(result.description.includes('fuera del rango de pitch de ±8%'));
    });
  });

  // -------------------------------------------------------------------------
  // 7. Respuestas de Gemini con explicaciones musicales incorrectas
  // -------------------------------------------------------------------------
  describe('7. Respuestas de Gemini con explicaciones musicales incorrectas', () => {
    test('Unifica el cálculo y la explicación cuando Gemini invierte el signo o expresa pitch erróneo (−1.08% -> +1.1%)', () => {
      // Caso auditado: Strobe muestra Pitch: +1.1%, pero Gemini alucina o invierte el signo a −1.08%
      const harmonic = evaluateHarmonicCompatibility('11A', '11A'); // Misma clave (F#m)
      const tempo = evaluateTempoCompatibility(129.4, 128); // pitchShiftPercent = 1.1 (+1.1%)

      // Gemini usa el signo invertido con menos Unicode (−1.08%) o ASCII (-1.08%)
      const geminiExplanationWithMinus =
        'Strobe tiene un tempo de 128 BPM con un ajuste de pitch de −1.08% para igualar el tempo de la pista de referencia.';

      const sanitized = sanitizeJustification(geminiExplanationWithMinus, harmonic, tempo);
      // La explicación debe unificarse con el cálculo verificado (+1.1%)
      assert.ok(sanitized.includes('+1.1%'), `Debe contener '+1.1%' pero fue: ${sanitized}`);
      assert.ok(!sanitized.includes('−1.08%'), 'No debe contener el valor discordante −1.08%');
      assert.ok(!sanitized.includes('-1.08%'), 'No debe contener el valor discordante -1.08%');
    });

    test('Anula justificación alucinada de Gemini cuando afirma falsamente que Midnight City es un candidato half-time', () => {
      // Caso auditado: Midnight City aparece como candidato half-time pese a requerir −18.86%
      const harmonic = evaluateHarmonicCompatibility('11A', '10A'); // Incompatible
      const tempo = evaluateTempoCompatibility(129.4, 105); // out_of_range

      const geminiHalfTimeHallucination =
        'Midnight City aparece como candidato half-time con un tempo de 105 BPM para una transición experimental.';

      const sanitized = sanitizeJustification(geminiHalfTimeHallucination, harmonic, tempo);
      assert.ok(sanitized.includes('Validación técnica SYSTEM DJ'));
      assert.ok(!sanitized.includes('half-time'));
      assert.ok(!sanitized.includes('candidato half-time'));
      assert.ok(sanitized.includes('fuera del rango de pitch de ±8%'));
    });

    test('Anula justificación alucinada de Gemini y corrige puntuación cuando afirma relación relativa falsa y tempo manejable', () => {
      const harmonic = evaluateHarmonicCompatibility('12A', '8A'); // incompatible
      const tempo = evaluateTempoCompatibility(84.8, 105); // out_of_range

      const geminiHallucination =
        '8A (Am) es la tonalidad relativa menor de 12A (C#m) y el tempo de 105 BPM requiere un ajuste manejable.';

      const sanitized = sanitizeJustification(geminiHallucination, harmonic, tempo);
      // Debe anular la afirmación falsa y reemplazarla con la validación verificada
      assert.ok(sanitized.includes('Validación técnica SYSTEM DJ'));
      assert.ok(sanitized.includes('incompatibles en rueda Camelot'));
      assert.ok(sanitized.includes('fuera del rango de pitch de ±8%'));
      assert.ok(!sanitized.includes('relativa menor'));
      assert.ok(!sanitized.includes('ajuste manejable'));

      // Puntuación penalizada por doble incompatibilidad (tempo out_of_range + armonía incompatible = 0)
      const score = calculateValidatedScore(harmonic, tempo);
      assert.equal(score, 0);
    });

    test('Sustituye texto libre del proveedor por la explicación técnica local aunque parezca compatible', () => {
      const harmonic = evaluateHarmonicCompatibility('12A', '12B'); // relativa mayor legítima
      const tempo = evaluateTempoCompatibility(124, 126); // en rango de pitch

      const validGeminiText =
        'Transición armónica suave modulando hacia la relativa mayor con un intercambio progresivo de bajos.';

      const sanitized = sanitizeJustification(validGeminiText, harmonic, tempo);
      assert.ok(sanitized.includes('Validación técnica SYSTEM DJ'));
      assert.ok(sanitized.includes(harmonic.description));
      assert.ok(sanitized.includes(tempo.description));
      assert.notEqual(sanitized, validGeminiText);
    });

    test('Reemplaza afirmaciones remotas cuando BPM o tonalidad no están disponibles localmente', () => {
      const harmonic = evaluateHarmonicCompatibility(undefined, '8A');
      const tempo = evaluateTempoCompatibility(124, 126);
      const sanitized = sanitizeJustification(
        'La armonía es perfecta y el tempo coincide exactamente.',
        harmonic,
        tempo
      );

      assert.ok(sanitized.includes('Validación técnica SYSTEM DJ'));
      assert.ok(sanitized.includes('Tonalidad no disponible'));
      assert.ok(!sanitized.includes('armonía es perfecta'));
      assert.ok(!sanitized.includes('coincide exactamente'));
    });

    test('El motor local omite candidatos inviables antes de solicitar explicaciones', () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'Mi Bello Angel', 'Natanael Cano', 84.8, '12A'));
      const candidate = extractCandidateMetadata(createStubTrack('c1', 'Otra Rola', 'Artista', 105, '8A'));
      assert.deepEqual(generateMockRecommendations(ref, [candidate]), []);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Metadatos con artista ausente y título compuesto
  // -------------------------------------------------------------------------
  describe('8. Metadatos con artista ausente y título compuesto', () => {
    test('Extrae artista y título de un título compuesto "Artista - Canción" cuando el artista es vacío', () => {
      const resolved = resolveTrackArtistAndTitle('', 'Natanael Cano - Mi Bello Angel');
      assert.equal(resolved.artist, 'Natanael Cano');
      assert.equal(resolved.title, 'Mi Bello Angel');
    });

    test('Evita duplicar el artista en el título cuando ya está definido ("Artista", "Artista - Canción")', () => {
      const resolved = resolveTrackArtistAndTitle('Natanael Cano', 'Natanael Cano - Mi Bello Angel');
      assert.equal(resolved.artist, 'Natanael Cano');
      assert.equal(resolved.title, 'Mi Bello Angel');
    });

    test('No inventa "Unknown Artist" ni "Untitled Track" cuando los metadatos faltan', () => {
      const emptyTrack: Track = {
        id: 'track-no-meta',
        title: '',
        artist: '',
        duration: 0,
        durationFormatted: '0:00',
        type: 'audio',
        source: { type: 'indexeddb' },
        analysis: { status: 'pending' },
        dateAdded: Date.now(),
      };

      const meta = extractCandidateMetadata(emptyTrack);
      assert.equal(meta.id, 'track-no-meta');
      assert.equal(meta.title, '');
      assert.equal(meta.artist, '');
      assert.notEqual(meta.artist, 'Unknown Artist');
      assert.notEqual(meta.title, 'Untitled Track');
    });

    test('Limpia valores residuales de "Unknown Artist" para evitar propagación', () => {
      const resolved = resolveTrackArtistAndTitle('Unknown Artist', 'Natanael Cano - Mi Bello Angel');
      assert.equal(resolved.artist, 'Natanael Cano');
      assert.equal(resolved.title, 'Mi Bello Angel');
    });

    test('Conserva títulos sin separador cuando no hay artista disponible sin inventar nada', () => {
      const resolved = resolveTrackArtistAndTitle('', 'Solo Titulo');
      assert.equal(resolved.artist, '');
      assert.equal(resolved.title, 'Solo Titulo');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Recomendaciones reales y simuladas continúan funcionando
  // -------------------------------------------------------------------------
  describe('9. Recomendaciones reales y simuladas continúan funcionando', () => {
    test('Simulación local (Mock) genera recomendaciones deterministas validadas con isMock = true', () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'Mi Bello Angel', 'Natanael Cano', 84.8, '12A', 7));
      const candidates = [
        ref,
        extractCandidateMetadata(createStubTrack('c1', 'Cancion Compatible', 'Artista B', 86, '12B', 7)), // relativa y en rango
        extractCandidateMetadata(createStubTrack('c2', 'Cancion Rapida', 'Artista C', 105, '8A', 8)),     // fuera de rango e incompatible
      ];

      const recs = generateMockRecommendations(ref, candidates);
      assert.equal(recs.length, 1, 'No se debe presentar una recomendación con viabilidad verificada de 0%');
      assert.ok(recs.every((r) => r.isMock === true));

      // La compatible debe quedar en primer lugar
      assert.equal(recs[0].trackId, 'c1');
      assert.equal(recs[0].harmonicEvaluation?.relation, 'relative');
      assert.equal(recs[0].tempoEvaluation?.relation, 'in_range');
      assert.ok(!recs.some((recommendation) => recommendation.trackId === 'c2'));
    });

    test('Modo simulación forzado (forceMock = true) en getTrackRecommendations opera sin tocar la red', async () => {
      const ref = createStubTrack('ref', 'Ref Track', 'Artist', 124, '8A');
      const cand = createStubTrack('cand1', 'Candidate Track', 'Artist', 126, '8B');

      const result = await getTrackRecommendations(ref, [ref, cand], { forceMock: true });
      assert.equal(result.success, true);
      assert.equal(result.isMock, true);
      assert.equal(result.model, 'local-deterministic-engine');
      assert.equal(result.recommendations.length, 1);
      assert.equal(result.recommendations[0].trackId, 'cand1');
      assert.ok(result.recommendations[0].compatibilityScore >= 70);
    });

    test('El modo local predeterminado es determinista y no intenta acceder a la red', async () => {
      const ref = createStubTrack('ref', 'Ref Track', 'Artist', 124, '8A');
      const cand = createStubTrack('cand1', 'Candidate Track', 'Artist', 126, '8B');
      const originalFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls += 1;
        throw new Error('El modo local no debe llamar fetch');
      }) as typeof fetch;

      try {
        const first = await getTrackRecommendations(ref, [ref, cand]);
        const second = await getTrackRecommendations(ref, [ref, cand]);

        assert.equal(first.success, true);
        assert.equal(first.isMock, true);
        assert.equal(first.model, 'local-deterministic-engine');
        assert.deepEqual(first.recommendations, second.recommendations);
        assert.equal(fetchCalls, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test('La respuesta del proveedor no puede introducir recomendaciones ni modificar el score local', async () => {
      const ref = createStubTrack('ref', 'Ref', 'Artist', 84.8, '12A');
      const cand = createStubTrack('cand-bad', 'Bad Track', 'Unknown Artist', 105, '8A');

      const mockServer = await startMockServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            explanations: [{ trackId: 'cand-bad', text: 'Candidato no autorizado localmente.' }],
            compatibilityScore: 100,
          })
        );
      });

      try {
        const result = await getTrackRecommendations(ref, [ref, cand], {
          endpointUrl: mockServer.url,
          mode: 'remote',
        });

        assert.equal(result.success, true);
        assert.deepEqual(result.recommendations, [], 'Un candidato eliminado por el motor local no puede volver desde Gemini');
      } finally {
        await mockServer.close();
      }
    });

    test('Un error HTTP del proveedor conserva las recomendaciones locales', async () => {
      const ref = createStubTrack('ref', 'Ref', 'Artist', 124, '8A');
      const cand = createStubTrack('cand1', 'Candidate', 'Artist', 124, '8A');

      const mockServer = await startMockServer((_req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            errorCode: 'quota_exceeded',
            error: 'Cuota de Gemini API excedida (HTTP 429).',
            isMock: false,
          })
        );
      });

      try {
        const result = await getTrackRecommendations(ref, [ref, cand], {
          endpointUrl: mockServer.url,
          mode: 'remote',
        });

        assert.equal(result.success, true);
        assert.equal(result.recommendations.length, 1);
        assert.equal(result.recommendations[0].compatibilityScore, 99);
        assert.equal(result.warning, 'quota');
      } finally {
        await mockServer.close();
      }
    });

    test('La falta de clave en el endpoint conserva los resultados locales y devuelve el estado de aviso', async () => {
      const ref = createStubTrack('ref', 'Ref Track', 'Artist', 124, '8A');
      const cand = createStubTrack('candidate', 'Candidate', 'Artist', 124, '8A');
      const mockServer = await startMockServer((_req, res) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, errorCode: 'missing_api_key' }));
      });

      try {
        const result = await getTrackRecommendations(ref, [ref, cand], {
          mode: 'remote',
          endpointUrl: mockServer.url,
        });
        assert.equal(result.success, true);
        assert.equal(result.recommendations.length, 1);
        assert.equal(result.warning, 'not_configured');
      } finally {
        await mockServer.close();
      }
    });

    test('Un timeout antes de recibir headers conserva las recomendaciones locales', async () => {
      const ref = createStubTrack('ref', 'Ref', 'Artist', 124, '8A');
      const cand = createStubTrack('cand1', 'Candidate', 'Artist', 124, '8A');

      const mockServer = await startMockServer(() => {
        // No responder para provocar timeout
      });

      try {
        const result = await getTrackRecommendations(ref, [ref, cand], {
          endpointUrl: mockServer.url,
          timeoutMs: 40,
          mode: 'remote',
        });

        assert.equal(result.success, true);
        assert.equal(result.recommendations.length, 1);
        assert.equal(result.warning, 'timeout');
      } finally {
        await mockServer.close();
      }
    });

    test('La solicitud automática solo adjunta explicaciones y conserva exactamente el score y orden local', async () => {
      const referenceTrack = createStubTrack('ref', 'Reference', 'Artist', 124, '8A');
      const candidates = [
        createStubTrack('lower', 'Lower', 'Artist', 127, '8A'),
        createStubTrack('top', 'Top', 'Artist', 124, '8A'),
        createStubTrack('middle', 'Middle', 'Artist', 126, '8A'),
      ];
      const local = generateMockRecommendations(
        extractCandidateMetadata(referenceTrack),
        candidates.map(extractCandidateMetadata)
      );
      const before = local.map(({ trackId, compatibilityScore }) => ({ trackId, compatibilityScore }));
      const localWithInternalFields = local.map((recommendation) => ({
        ...recommendation,
        localEvidence: 'private local evaluation',
        playbackState: 'playing',
        beatgrid: [0, 0.5],
        analysis: { status: 'analyzed', confidence: 0.99 },
      }));
      let capturedRequest: {
        referenceTrack: Record<string, unknown>;
        recommendations: Array<Record<string, unknown>>;
      } | undefined;
      const referenceMetadata = {
        ...extractCandidateMetadata(referenceTrack),
        playbackState: 'playing',
        accountToken: 'test-only-internal-marker',
      };
      const mockServer = await startMockServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          const request = JSON.parse(body) as {
            referenceTrack: Record<string, unknown>;
            recommendations: Array<Record<string, unknown>>;
          };
          capturedRequest = request;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            explanations: [...local].reverse().map(({ trackId }) => ({ trackId, text: `Explanation for ${trackId}` })),
            compatibilityScore: 0,
          }));
        });
      });

      try {
        const response = await getTrackRecommendationExplanations(
          referenceMetadata, localWithInternalFields,
          { endpointUrl: mockServer.url }
        );
        assert.equal(response.success, true);
        const explanationById = new Map(response.explanations.map(({ trackId, text }) => [trackId, text]));
        const enriched = local.map((recommendation) => ({
          ...recommendation,
          aiExplanation: explanationById.get(recommendation.trackId),
        }));
        assert.deepEqual(enriched.map(({ trackId, compatibilityScore }) => ({ trackId, compatibilityScore })), before);
        assert.deepEqual(enriched.map(({ trackId }) => trackId), local.map(({ trackId }) => trackId));
        assert.ok(capturedRequest);
        const allowedFields = ['id', 'title', 'artist', 'bpm', 'key', 'camelot', 'energy'];
        const assertAllowedTrackFields = (track: Record<string, unknown>) => {
          assert.ok(Object.keys(track).every((field) => allowedFields.includes(field)));
          assert.ok(['id', 'title', 'artist'].every((field) => field in track));
        };
        assert.deepEqual(capturedRequest.recommendations.map((entry) => entry.id), local.map((entry) => entry.trackId));
        assertAllowedTrackFields(capturedRequest.referenceTrack);
        capturedRequest.recommendations.forEach(assertAllowedTrackFields);
        assert.doesNotMatch(JSON.stringify(capturedRequest), /localEvidence|playbackState|beatgrid|analysis|harmonicEvaluation|tempoEvaluation|compatibilityScore|test-only-internal-marker/);
      } finally {
        await mockServer.close();
      }
    });

    test('Ignora IDs no autorizados y repetidos, y rechaza contenido vacío o mal formado', async () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'Reference', 'Artist', 124, '8A'));
      const local = generateMockRecommendations(ref, [extractCandidateMetadata(createStubTrack('allowed', 'Allowed', 'Artist', 124, '8A'))]);
      const fixtures = [
        {
          body: JSON.stringify({ explanations: [
            { trackId: 'outsider', text: 'No.' },
            { trackId: 'allowed', text: 'First explanation.' },
            { trackId: 'allowed', text: 'Duplicate explanation.' },
          ] }),
          expected: 'success',
        },
        { body: JSON.stringify({ explanations: [] }), expected: 'empty_response' },
        { body: '{broken', expected: 'invalid_response' },
        { body: JSON.stringify({ recommendations: [{ trackId: 'allowed', compatibilityScore: 100 }] }), expected: 'invalid_response' },
      ];

      for (const fixture of fixtures) {
        const server = await startMockServer((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(fixture.body);
        });
        try {
          const result = await getTrackRecommendationExplanations(ref, local, { endpointUrl: server.url });
          if (fixture.expected === 'success') {
            assert.equal(result.success, true);
            assert.deepEqual(result.explanations, [{ trackId: 'allowed', text: 'First explanation.' }]);
          } else {
            assert.equal(result.success, false);
            assert.equal(result.errorCode, fixture.expected);
          }
        } finally {
          await server.close();
        }
      }
    });

    test('El timeout sigue activo mientras el body está bloqueado después de headers', async () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'Reference', 'Artist', 124, '8A'));
      const local = generateMockRecommendations(ref, [extractCandidateMetadata(createStubTrack('candidate', 'Candidate', 'Artist', 124, '8A'))]);
      const server = await startMockServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.flushHeaders();
      });
      try {
        const result = await getTrackRecommendationExplanations(ref, local, {
          endpointUrl: server.url,
          timeoutMs: 40,
        });
        assert.equal(result.success, false);
        assert.equal(result.errorCode, 'timeout');
      } finally {
        await server.close();
      }
    });

    test('La cancelación no se convierte en un error visible de proveedor', async () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'Reference', 'Artist', 124, '8A'));
      const local = generateMockRecommendations(ref, [extractCandidateMetadata(createStubTrack('candidate', 'Candidate', 'Artist', 124, '8A'))]);
      const controller = new AbortController();
      controller.abort();
      const result = await getTrackRecommendationExplanations(ref, local, { signal: controller.signal });
      assert.equal(result.success, false);
      assert.equal(result.errorCode, 'cancelled');
      assert.equal(result.warning, undefined);
    });

    test('Sanitiza la explicación como texto acotado y omite marcas HTML', () => {
      assert.equal(sanitizeRecommendationExplanation(' <b>Use verified data</b> '), 'Use verified data');
      assert.equal(sanitizeRecommendationExplanation('  \u0000  '), null);
      assert.equal(sanitizeRecommendationExplanation('x'.repeat(700))?.length, 600);
      assert.equal(sanitizeRecommendationExplanation({ text: 'not a string' }), null);
    });

    test('La tarjeta solicita explicaciones después de publicar recomendaciones locales y conserva la lista ante fallos', () => {
      const cardPath = path.resolve(process.cwd(), 'src/components/dashboard/SmartRecommendationCard.tsx');
      const cardSource = fs.readFileSync(cardPath, 'utf8');
      const localPublish = cardSource.indexOf('recommendationStore.set({\n            referenceTrackId');
      const explanationCall = cardSource.indexOf('await getTrackRecommendationExplanations(');
      assert.ok(localPublish >= 0 && explanationCall > localPublish);
      assert.match(cardSource, /if \(localResultsReady\)\s*\{\s*recommendationStore\.update\(\{ explanationsUnavailable: true \}\)/);
      assert.match(cardSource, /!errorMsg && recommendations\.length > 0/);
      assert.doesNotMatch(cardSource, /handleLoadTrack\(rec,/);
    });

    test('Biblioteca con solo la pista de referencia devuelve advertencia sin fallar', async () => {
      const ref = createStubTrack('ref', 'Only Track', 'Artist', 124, '8A');
      const result = await getTrackRecommendations(ref, [ref]);

      assert.equal(result.success, true);
      assert.deepEqual(result.recommendations, []);
      assert.ok(result.warning?.includes('No hay suficientes pistas'));
    });
  });

  // -------------------------------------------------------------------------
  // 10. Auditoría de Puntuación Validada y Criterios Objetivos (calculateValidatedScore)
  // -------------------------------------------------------------------------
  describe('10. Auditoría de Puntuación Validada y Criterios Objetivos', () => {
    test('Doble incompatibilidad estricta (tempo fuera de rango Y armonía incompatible) resulta en 0% sin números mágicos', () => {
      const harmonic = evaluateHarmonicCompatibility('12A', '8A'); // Incompatible (distancia Camelot = 4)
      const tempo = evaluateTempoCompatibility(84.8, 105); // Fuera de rango (+23.8%, excede ±8%)

      assert.equal(harmonic.relation, 'incompatible');
      assert.equal(tempo.relation, 'out_of_range');

      // Ninguna puntuación de proveedor entra en el cálculo determinista local.
      const score = calculateValidatedScore(harmonic, tempo);
      assert.equal(score, 0, 'La mezcla donde ni el tempo ni la tonalidad coinciden debe recibir 0%');
    });

    test('Tempo fuera de rango pero armonía afín escala estrictamente al 35% del potencial armónico', () => {
      const tempo = evaluateTempoCompatibility(120, 140); // Fuera de rango (pitch fader excedido)
      assert.equal(tempo.relation, 'out_of_range');

      // Misma clave (100) -> 100 * 0.35 = 35
      const sameKey = evaluateHarmonicCompatibility('8A', '8A');
      assert.equal(calculateValidatedScore(sameKey, tempo), 35);

      // Relativa mayor/menor (95) -> 95 * 0.35 = 33
      const relative = evaluateHarmonicCompatibility('8A', '8B');
      assert.equal(calculateValidatedScore(relative, tempo), 33);

      // Clave adyacente (88) -> 88 * 0.35 = 31
      const adjacent = evaluateHarmonicCompatibility('8A', '9A');
      assert.equal(calculateValidatedScore(adjacent, tempo), 31);
    });

    test('Armonía incompatible pero tempo beatmatcheable escala estrictamente al 35% del potencial de tempo', () => {
      const harmonic = evaluateHarmonicCompatibility('1A', '7A'); // Incompatible (tritono Camelot)
      assert.equal(harmonic.relation, 'incompatible');

      // Tempo idéntico (100) -> 100 * 0.35 = 35
      const tempoExact = evaluateTempoCompatibility(124, 124);
      assert.equal(calculateValidatedScore(harmonic, tempoExact), 35);

      // Alternativa half/double time válida (78) -> 78 * 0.35 = 27
      const tempoHalf = evaluateTempoCompatibility(85, 170);
      assert.equal(calculateValidatedScore(harmonic, tempoHalf), 27);

      // Tempo con pitch shift moderado dentro de ±8%
      const tempoPitch = evaluateTempoCompatibility(124, 127);
      assert.ok(calculateValidatedScore(harmonic, tempoPitch) <= 35);
    });

    test('Tonalidad desconocida evalúa únicamente el factor tempo verificado al 50% máx sin inventar puntuación armónica', () => {
      const unknownHarmonic = evaluateHarmonicCompatibility(undefined, undefined);
      const exactTempo = evaluateTempoCompatibility(128, 128); // tempoScore = 100

      const score = calculateValidatedScore(unknownHarmonic, exactTempo);
      assert.equal(score, 50, '100 tempo * 0.5 = 50 sin atribuir afinidad armónica no comprobada');
    });

    test('Tempo desconocido evalúa únicamente el factor armónico verificado al 50% máx sin inventar beatmatching', () => {
      const sameHarmonic = evaluateHarmonicCompatibility('11B', '11B'); // harmonicScore = 100
      const unknownTempo = evaluateTempoCompatibility(undefined, undefined);

      const score = calculateValidatedScore(sameHarmonic, unknownTempo);
      assert.equal(score, 50, '100 armónico * 0.5 = 50 sin atribuir tempo no comprobado');
    });

    test('Ambos factores ausentes devuelven score ausente, no 0%', () => {
      const unknownHarmonic = evaluateHarmonicCompatibility(undefined, undefined);
      const unknownTempo = evaluateTempoCompatibility(undefined, undefined);

      const score = calculateValidatedScore(unknownHarmonic, unknownTempo);
      assert.equal(score, null, 'Sin datos verificables el resultado no debe confundirse con compatibilidad 0%');

      const verifiedReference = extractCandidateMetadata(createStubTrack('ref-score', 'Ref', 'Artist', 124, '8A'));
      const unanalyzedCandidate = extractCandidateMetadata({
        ...createStubTrack('candidate-score', 'Candidate', 'Artist'),
        analysis: { status: 'pending' },
      });
      assert.deepEqual(generateMockRecommendations(verifiedReference, [unanalyzedCandidate]), []);
    });

    test('Tonalidad desconocida y tempo fuera de rango puntúa solo el tempo real, sin el fallback armónico 85', () => {
      const unknownHarmonic = evaluateHarmonicCompatibility(undefined, undefined);
      const outOfRangeTempo = evaluateTempoCompatibility(84.8, 105);
      assert.equal(outOfRangeTempo.relation, 'out_of_range');
      assert.equal(calculateValidatedScore(unknownHarmonic, outOfRangeTempo), 13);
    });

    test('Tonalidad desconocida en rango puntúa solo el tempo verificado', () => {
      const unknownHarmonic = evaluateHarmonicCompatibility(undefined, '8A');
      const tempo = evaluateTempoCompatibility(124, 126);
      assert.equal(calculateValidatedScore(unknownHarmonic, tempo), Math.round((tempo.tempoScore ?? 0) * 0.5));
    });
  });

  // -------------------------------------------------------------------------
  // 11. Trazabilidad y Verificación del Origen de Metadatos
  // -------------------------------------------------------------------------
  describe('11. Trazabilidad y Verificación del Origen de Metadatos', () => {
    test('La referencia pending/failed devuelve estado explicativo sin recomendaciones ni puntuaciones', async () => {
      const pendingReference: Track = {
        ...createStubTrack('pending-ref', 'Reference', 'Artist'),
        analysis: { status: 'pending' },
      };
      const candidate = createStubTrack('candidate', 'Candidate', 'Artist', 124, '8A');

      const pendingResult = await getTrackRecommendations(pendingReference, [pendingReference, candidate], { forceMock: true });
      assert.equal(pendingResult.success, true);
      assert.deepEqual(pendingResult.recommendations, []);
      assert.match(pendingResult.warning ?? '', /análisis verificado de BPM y tonalidad/);

      const failedReference: Track = {
        ...pendingReference,
        analysis: { status: 'failed', analysisError: 'decode failed' },
      };
      const failedResult = await getTrackRecommendations(failedReference, [failedReference, candidate], { forceMock: true });
      assert.deepEqual(failedResult.recommendations, []);
      assert.match(failedResult.warning ?? '', /análisis verificado/);
    });

    test('extractCandidateMetadata marca isAnalysisVerified = true únicamente en pistas analizadas con BPM válido', () => {
      const analyzedTrack = createStubTrack('t1', 'Track Analizada', 'DJ Pro', 126, '9A', 8);
      const meta = extractCandidateMetadata(analyzedTrack);

      assert.equal(meta.isAnalysisVerified, true);
      assert.equal(meta.bpm, 126);
      assert.equal(meta.camelot, '9A');
      assert.equal(meta.energy, 8);
    });

    test('extractCandidateMetadata no inventa BPM ni key cuando la pista no está analizada (pending/failed)', () => {
      const unanalyzedTrack: Track = {
        id: 'raw-1',
        title: 'Raw Audio',
        artist: 'Unknown',
        duration: 200,
        durationFormatted: '3:20',
        type: 'audio',
        source: { type: 'indexeddb', indexedDbKey: 'raw-1' },
        analysis: { status: 'pending' },
        dateAdded: Date.now(),
      };

      const meta = extractCandidateMetadata(unanalyzedTrack);
      assert.equal(meta.isAnalysisVerified, false);
      assert.equal(meta.bpm, undefined);
      assert.equal(meta.key, undefined);
      assert.equal(meta.camelot, undefined);
      assert.equal(meta.energy, undefined);
    });

    test('generateMockRecommendations preserva la trazabilidad local y asigna isAnalysisVerified', () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'Ref Track', 'Artist', 124, '8A', 7));
      const cand = extractCandidateMetadata(createStubTrack('c1', 'Cand Track', 'Artist', 126, '8B', 8));

      const recs = generateMockRecommendations(ref, [cand]);
      assert.equal(recs.length, 1);
      assert.equal(recs[0].isMock, true);
      assert.equal(recs[0].isAnalysisVerified, true);
      assert.equal(recs[0].bpm, 126);
    });

    test('Las explicaciones solo enriquecen recomendaciones seleccionadas y preservan metadatos y decisiones locales', () => {
      const ref = extractCandidateMetadata(createStubTrack('ref', 'Ref Track', 'Artist', 124, '8A', 7));
      const cand = extractCandidateMetadata(createStubTrack('c1', 'Cand Track', 'Artist', 126, '8B', 8));
      const local = generateMockRecommendations(ref, [cand]);
      const originalOrderAndScores = local.map(({ trackId, compatibilityScore }) => ({ trackId, compatibilityScore }));
      const enriched = applyRecommendationExplanations(local, [
        { trackId: 'unknown-id', text: 'Unselected track.' },
        { trackId: 'c1', text: 'Gemini explanation.', compatibilityScore: 100000, bpm: 999, key: '1A' },
      ]);

      assert.deepEqual(enriched.map(({ trackId, compatibilityScore }) => ({ trackId, compatibilityScore })), originalOrderAndScores);
      assert.equal(enriched[0].trackId, 'c1');
      assert.equal(enriched[0].aiExplanation, 'Gemini explanation.');
      assert.equal(enriched[0].bpm, 126);
      assert.equal(enriched[0].key, 'Am');
      assert.equal(enriched[0].camelot, '8B');
      assert.equal(enriched[0].energy, 8);
      assert.equal(enriched[0].isAnalysisVerified, true);
      assert.equal(enriched[0].justification, local[0].justification);
      assert.equal(enriched[0].transitionSuggestion, local[0].transitionSuggestion);
    });

    test('No exporta energía local no finita o fuera de su escala válida 0–10', () => {
      const nonFiniteTrack = createStubTrack('energy-nan', 'Track', 'Artist', 126, '9A', Number.NaN);
      const outOfRangeTrack = createStubTrack('energy-high', 'Track', 'Artist', 126, '9A', 11);

      assert.equal(extractCandidateMetadata(nonFiniteTrack).energy, undefined);
      assert.equal(extractCandidateMetadata(outOfRangeTrack).energy, undefined);
      assert.equal(extractCandidateMetadata(nonFiniteTrack).isAnalysisVerified, true);
    });

    test('Expone evidencia completa, parcial por tempo o armonía, y cuenta candidatos con evidencia insuficiente', async () => {
      const refTrack = createStubTrack('ref', 'Reference', 'Artist', 124, '8A');
      const ref = extractCandidateMetadata(refTrack);
      const complete = extractCandidateMetadata(createStubTrack('complete', 'Complete', 'Artist', 126, '8B'));
      const tempoOnly = extractCandidateMetadata(createStubTrack('tempo-only', 'Tempo only', 'Artist', 126, undefined));
      const harmonyOnly = extractCandidateMetadata({
        ...createStubTrack('harmony-only', 'Harmony only', 'Artist'),
        analysis: { status: 'analyzed', key: 'Am', camelot: '8B' },
      });
      const insufficientTrack: Track = {
        ...createStubTrack('insufficient', 'Insufficient', 'Artist'),
        analysis: { status: 'pending' },
      };
      const insufficient = extractCandidateMetadata(insufficientTrack);

      assert.equal(generateMockRecommendations(ref, [complete])[0].evidenceStatus, 'complete');
      assert.equal(generateMockRecommendations(ref, [tempoOnly])[0].evidenceStatus, 'partial');
      assert.equal(generateMockRecommendations(ref, [tempoOnly])[0].compatibilityScore, 47);
      assert.equal(generateMockRecommendations(ref, [harmonyOnly])[0].evidenceStatus, 'partial');
      assert.equal(generateMockRecommendations(ref, [harmonyOnly])[0].compatibilityScore, 48);
      assert.deepEqual(generateMockRecommendations(ref, [insufficient]), []);

      const result = await getTrackRecommendations(refTrack, [refTrack, insufficientTrack]);
      assert.deepEqual(result.recommendations, []);
      assert.equal(result.insufficientCandidateCount, 1);

      const mockServer = await startMockServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, isMock: false, recommendations: [{ trackId: 'insufficient', compatibilityScore: 99 }] }));
      });
      try {
        const remoteResult = await getTrackRecommendations(refTrack, [refTrack, insufficientTrack], {
          mode: 'remote',
          endpointUrl: mockServer.url,
        });
        assert.deepEqual(remoteResult.recommendations, []);
        assert.equal(remoteResult.insufficientCandidateCount, 1);
      } finally {
        await mockServer.close();
      }
    });

  });

  // -------------------------------------------------------------------------
  // 12. Independencia de Carga de Deck B sin Alterar Deck A
  // -------------------------------------------------------------------------
  describe('12. Independencia de Carga de Deck B sin Alterar Deck A', () => {
    test('Cargar en Deck B no altera la reproducción ni el estado de transporte de Deck A', () => {
      // Simular estado de Deck A reproduciéndose con pista propia
      const trackA = createStubTrack('deck-a-track', 'Deck A Song', 'Artist A', 128, '8A');
      djStore.setDeck('A', {
        track: trackA,
        playbackState: 'playing',
        currentTime: 45.5,
        duration: 180,
        pitch: 50,
        playbackRate: 1.0,
      });

      // Pista candidata recomendada para cargar en Deck B
      const recTrackB = createStubTrack('rec-track-b', 'Recommendation For B', 'Artist B', 128, '8B');
      djStore.setDeck('B', {
        track: recTrackB,
        playbackState: 'stopped',
        currentTime: 0,
        duration: 210,
        pitch: 50,
        playbackRate: 1.0,
      });

      const snapshot = djStore.getSnapshot();

      // Deck A debe permanecer completamente intacto en reproducción y tiempo
      assert.equal(snapshot.deckA.track?.id, 'deck-a-track');
      assert.equal(snapshot.deckA.playbackState, 'playing');
      assert.equal(snapshot.deckA.currentTime, 45.5);

      // Deck B debe haber cargado la pista recomendada sin contaminar Deck A
      assert.equal(snapshot.deckB.track?.id, 'rec-track-b');
      assert.equal(snapshot.deckB.playbackState, 'stopped');
      assert.equal(snapshot.deckB.currentTime, 0);
    });
  });

  // -------------------------------------------------------------------------
  // 13. Localización y Traducciones Completas (ES y EN)
  // -------------------------------------------------------------------------
  describe('13. Localización y Traducciones Completas (ES y EN)', () => {
    test('Todas las claves de traducción de SmartRecommendationCard existen en los diccionarios es y en', () => {
      const esPath = path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json');
      const enPath = path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json');

      const esData = JSON.parse(fs.readFileSync(esPath, 'utf8'));
      const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));

      const requiredKeys = [
        'smart_recommendations_title',
        'smart_recommendations_subtitle',
        'select_deck_a',
        'select_deck_b',
        'get_recommendations',
        'refresh_recommendations',
        'try_mock',
        'badge_gemini',
        'badge_mock',
        'load_deck_a',
        'load_deck_b',
        'loaded_to_deck',
        'bpm_na',
        'key_na',
        'not_analyzed',
        'different_harmony',
        'full_evidence',
        'partial_evidence',
        'insufficient_evidence',
        'ai_explanation_unavailable',
        'ai_explanation_label',
        'loading_recommendations_desc',
        'bpm_label',
        'pitch_out_of_range',
        'local_verified',
        'ai_generated',
        'current_track_info',
        'error_quota_exceeded',
        'error_auth',
        'error_network',
        'error_timeout',
      ];

      for (const key of requiredKeys) {
        assert.ok(
          typeof esData.dashboard?.[key] === 'string' && esData.dashboard[key].length > 0,
          `Falta la clave "${key}" en translation.json (ES)`
        );
        assert.ok(
          typeof enData.dashboard?.[key] === 'string' && enData.dashboard[key].length > 0,
          `Falta la clave "${key}" en translation.json (EN)`
        );
      }

      const cardPath = path.resolve(process.cwd(), 'src/components/dashboard/SmartRecommendationCard.tsx');
      const cardSource = fs.readFileSync(cardPath, 'utf8');
      assert.ok(cardSource.includes("rec.evidenceStatus === 'partial'"));
      assert.ok(cardSource.includes("dashboard.partial_evidence"));
      assert.ok(cardSource.includes('insufficientCandidateCount'));
    });

    test('current_track_info interpola correctamente los parámetros en ES y EN sin etiquetas rotas', () => {
      const esPath = path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json');
      const enPath = path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json');

      const esData = JSON.parse(fs.readFileSync(esPath, 'utf8'));
      const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));

      const esTemplate = esData.dashboard.current_track_info;
      const enTemplate = enData.dashboard.current_track_info;

      assert.ok(esTemplate.includes('{{title}}') && esTemplate.includes('{{bpm}}') && esTemplate.includes('{{key}}'));
      assert.ok(enTemplate.includes('{{title}}') && enTemplate.includes('{{bpm}}') && enTemplate.includes('{{key}}'));
    });

    test('Las etiquetas de evidencia parcial y los avisos de datos insuficientes interpolan correctamente', () => {
      const esPath = path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json');
      const enPath = path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json');
      const esData = JSON.parse(fs.readFileSync(esPath, 'utf8'));
      const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));

      for (const data of [esData, enData]) {
        const partial = data.dashboard.partial_evidence.replace('{{missing}}', 'BPM');
        const insufficient = data.dashboard.insufficient_evidence.replace('{{count}}', '2');
        assert.ok(!partial.includes('{{'));
        assert.ok(!insufficient.includes('{{'));
      }
    });
  });
});
