import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createManualDownbeatConfirmation } from '../src/utils/downbeat.ts';
import { dragPosition, firstBarAtOrAfter, getBarGrid, sampleAmplitude } from '../src/services/console/zoomedWaveform.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/store/useSettingsStore.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import type { Track } from '../src/types/track.ts';

const HASH = 'c'.repeat(64);

function track(options: { downbeat?: boolean; unit?: boolean }): Track {
  return {
    id: 'zoom-track',
    fileMeta: { contentHash: HASH },
    analysis: {
      status: 'analyzed',
      bpm: 120,
      ...(options.unit ? { beatUnit: { value: 4, status: 'confirmed', source: 'manual' } } : {}),
    },
    downbeat: options.downbeat
      ? createManualDownbeatConfirmation({ position: 0.5, beatsPerBar: 4, contentHash: HASH })
      : { status: 'suggested', suggestedPosition: 0.5 },
  } as unknown as Track;
}

describe('Forma de onda ampliada — cálculos de la ventana', () => {
  it('muestrea el máximo de los picos de cada columna o interpola si la columna es más estrecha', () => {
    const peaks = [0, 0.2, 0.9, 0.4];
    // 1 pico por segundo: la columna [1, 3) cubre los picos 1 y 2
    assert.equal(sampleAmplitude(peaks, 1, 1, 1, 3), 0.9);
    // Columna de 0.1 s: interpolación entre los centros de los picos 1 (1.5 s) y 2 (2.5 s)
    assert.ok(Math.abs(sampleAmplitude(peaks, 1, 1, 2, 2.1) - 0.55) < 1e-9);
    // Escala de 8 bits
    assert.equal(sampleAmplitude(Uint8Array.from([0, 255]), 1 / 255, 1, 0, 2), 1);
    assert.equal(sampleAmplitude([], 1, 1, 0, 1), 0);
  });

  it('dibuja compases solo con downbeat y métrica confirmados y BPM válido', () => {
    assert.equal(getBarGrid(track({ downbeat: false, unit: true }), 120), null, 'la sugerencia provisional no cuenta');
    assert.equal(getBarGrid(track({ downbeat: true, unit: false }), 120), null, 'sin unidad confirmada no hay métrica');
    assert.equal(getBarGrid(track({ downbeat: true, unit: true }), null), null);
    assert.equal(getBarGrid(null, 120), null);
    const grid = getBarGrid(track({ downbeat: true, unit: true }), 120);
    assert.deepEqual(grid, { origin: 0.5, period: 2 });
    assert.equal(firstBarAtOrAfter(grid!, 3), 4.5);
    assert.equal(firstBarAtOrAfter(grid!, 0), 0.5);
  });

  it('arrastrar a la derecha retrocede proporcionalmente a la ventana', () => {
    assert.equal(dragPosition(30, 100, 400, 8), 28);
    assert.equal(dragPosition(30, -200, 400, 8), 34);
    assert.equal(dragPosition(30, 50, 0, 8), 30);
  });

  it('el zoom es 8 s por defecto y solo admite 4 / 8 / 16 s', () => {
    assert.equal(DEFAULT_SETTINGS.waveformZoom, 8);
    assert.equal(sanitizeSettings({ waveformZoom: 16 }).waveformZoom, 16);
    assert.equal(sanitizeSettings({ waveformZoom: 12 }).waveformZoom, 8);
  });

  it('guarda los picos de alta resolución en IndexedDB y los borra con la pista', async () => {
    const record = { trackId: 'peaks-track', contentHash: HASH, formatVersion: 1, durationSec: 2, peaks: Uint8Array.from([1, 2, 3]) };
    assert.equal(await indexedDBStorage.saveWaveformPeaks(record), true);
    const stored = await indexedDBStorage.getWaveformPeaks('peaks-track');
    assert.equal(stored?.contentHash, HASH);
    assert.deepEqual(Array.from(stored!.peaks), [1, 2, 3]);
    await indexedDBStorage.deleteTrack('peaks-track');
    assert.equal(await indexedDBStorage.getWaveformPeaks('peaks-track'), null);
  });
});
