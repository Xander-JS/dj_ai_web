/**
 * SYSTEM DJ — Test Suite: Fase 22 — Etapa 5
 * Integración del Análisis Musical en los Decks y Sincronización Visual
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';
import type { Track, TrackAnalysis } from '../src/types/track.ts';

// Mock minimal de AudioContext para Node.js
class MockAudioParam {
  public value: number;
  constructor(val = 1) {
    this.value = val;
  }
  public setValueAtTime(v: number): void {
    this.value = v;
  }
}

class MockAudioNode {
  public connect(): MockAudioNode {
    return this;
  }
  public disconnect(): void {}
}

class MockGainNode extends MockAudioNode {
  public gain = new MockAudioParam(1);
}

class MockBiquadFilterNode extends MockAudioNode {
  public type = 'allpass';
  public frequency = new MockAudioParam(1000);
  public gain = new MockAudioParam(0);
  public Q = new MockAudioParam(1);
}

class MockAnalyserNode extends MockAudioNode {
  public fftSize = 256;
  public frequencyBinCount = 128;
  public smoothingTimeConstant = 0.8;
  public getByteTimeDomainData(arr: Uint8Array): void {
    arr.fill(128);
  }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  public buffer: AudioBuffer | null = null;
  public playbackRate = new MockAudioParam(1);
  public onended: (() => void) | null = null;
  public isStarted = false;
  public isStopped = false;

  public start(): void {
    this.isStarted = true;
  }
  public stop(): void {
    this.isStopped = true;
    if (this.onended) {
      this.onended();
    }
  }
}

class MockAudioContext {
  public state = 'running';
  public currentTime = 10.0;
  public destination = new MockAudioNode();

  public createGain(): MockGainNode {
    return new MockGainNode();
  }
  public createBiquadFilter(): MockBiquadFilterNode {
    return new MockBiquadFilterNode();
  }
  public createAnalyser(): MockAnalyserNode {
    return new MockAnalyserNode();
  }
  public createBufferSource(): MockAudioBufferSourceNode {
    return new MockAudioBufferSourceNode();
  }
  public async decodeAudioData(
    buffer: ArrayBuffer,
    successCallback?: (decoded: AudioBuffer) => void
  ): Promise<AudioBuffer> {
    const duration = 200.0;
    const mockBuffer = {
      duration,
      numberOfChannels: 2,
      sampleRate: 44100,
      length: duration * 44100,
      getChannelData: () => new Float32Array(100),
      copyFromChannel: () => {},
      copyToChannel: () => {},
    } as unknown as AudioBuffer;
    if (successCallback) successCallback(mockBuffer);
    return Promise.resolve(mockBuffer);
  }
  public async resume(): Promise<void> {
    this.state = 'running';
  }
  public async close(): Promise<void> {
    this.state = 'closed';
  }
}

function createTestAudioFile(name = 'deck_track.mp3', size = 2048): File {
  const data = new Uint8Array(size);
  return new File([data], name, { type: 'audio/mpeg', lastModified: Date.now() });
}

describe('Fase 22 — Etapa 5: Integración del Análisis Musical en los Decks y Sincronización Visual', () => {
  const originalWindow = globalThis.window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    await audioEngine.initialize();
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    djStore.setPitchDeckA(50);
    djStore.setPitchDeckB(50);
    await indexedDBStorage.clearAll();
  });

  afterEach(async () => {
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await audioEngine.dispose();
    await indexedDBStorage.clearAll();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('5.1 Información musical correcta al cargar una pista analizada en Deck A', async () => {
    const file = createTestAudioFile('house_track.mp3');
    const track = createTrackFromFile(file, 240.0);
    track.analysis = {
      status: 'analyzed',
      bpm: 124.0,
      bpmConfidence: 0.98,
      key: 'C',
      camelot: '8B',
      energy: 7.5,
      waveformPeaks: [0.2, 0.5, 0.9, 0.4],
    };
    await indexedDBStorage.saveTrack(track, file);

    const loaded = await djStore.loadTrackToDeckA(track);
    assert.equal(loaded, true);

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.title, 'house_track');
    assert.equal(snap.deckA.calculatedBpm, 124.0, 'BPM efectivo debe ser 124.0 con pitch al centro');
    assert.equal(snap.deckA.keyStr, 'C (8B)', 'Tonalidad formateada debe ser C (8B)');
    assert.equal(snap.deckA.track?.analysis.energy, 7.5);
    assert.deepEqual(snap.deckA.track?.analysis.waveformPeaks, [0.2, 0.5, 0.9, 0.4]);
  });

  it('5.2 Independencia total entre Deck A y Deck B con pistas y métricas distintas', async () => {
    const fileA = createTestAudioFile('track_a.mp3');
    const trackA = createTrackFromFile(fileA, 180.0);
    trackA.analysis = {
      status: 'analyzed',
      bpm: 128.0,
      key: 'Am',
      camelot: '8A',
      energy: 6.2,
      waveformPeaks: [0.1, 0.3, 0.6],
    };
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = createTestAudioFile('track_b.wav');
    const trackB = createTrackFromFile(fileB, 210.0);
    trackB.analysis = {
      status: 'analyzed',
      bpm: 174.0,
      key: 'F#m',
      camelot: '11A',
      energy: 9.1,
      waveformPeaks: [0.5, 0.9, 0.8],
    };
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.calculatedBpm, 128.0);
    assert.equal(snap.deckA.keyStr, 'Am (8A)');
    assert.equal(snap.deckA.track?.analysis.energy, 6.2);

    assert.equal(snap.deckB.calculatedBpm, 174.0);
    assert.equal(snap.deckB.keyStr, 'F#m (11A)');
    assert.equal(snap.deckB.track?.analysis.energy, 9.1);

    // Variar pitch en Deck A a +4% (pitch slider 75)
    djStore.setPitchDeckA(75);
    snap = djStore.getSnapshot();

    // Deck A se actualiza proporcionalmente: 128 * (1 + 0.04) = 133.1 BPM
    assert.equal(snap.deckA.calculatedBpm, 133.1);
    // Deck B permanece completamente inalterado en 174.0 BPM
    assert.equal(snap.deckB.calculatedBpm, 174.0);
  });

  it('5.3 Representación neutral con "—" y sin datos inventados cuando la pista no está analizada', async () => {
    const file = createTestAudioFile('unprocessed.mp3');
    const track = createTrackFromFile(file, 200.0);
    // Pista sin análisis previo
    track.analysis = { status: 'pending' };
    await indexedDBStorage.saveTrack(track, file);

    await djStore.loadTrackToDeckA(track);
    const snap = djStore.getSnapshot();

    assert.equal(snap.deckA.track?.analysis.status, 'pending');
    assert.equal(snap.deckA.calculatedBpm, null, 'calculatedBpm debe ser estrictamente null');
    assert.equal(snap.deckA.keyStr, null, 'keyStr debe ser estrictamente null');
  });

  it('5.4 Actualización limpia al cambiar de pista en el mismo deck', async () => {
    const file1 = createTestAudioFile('first.mp3');
    const track1 = createTrackFromFile(file1, 150.0);
    track1.analysis = { status: 'analyzed', bpm: 120.0, key: 'Dm', camelot: '7A', energy: 5.0 };
    await indexedDBStorage.saveTrack(track1, file1);

    const file2 = createTestAudioFile('second.mp3');
    const track2 = createTrackFromFile(file2, 180.0);
    track2.analysis = { status: 'analyzed', bpm: 130.0, key: 'G', camelot: '9B', energy: 8.0 };
    await indexedDBStorage.saveTrack(track2, file2);

    // Cargar primera pista
    await djStore.loadTrackToDeckA(track1);
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.title, 'first');
    assert.equal(snap.deckA.calculatedBpm, 120.0);
    assert.equal(snap.deckA.keyStr, 'Dm (7A)');

    // Reemplazar por segunda pista
    await djStore.loadTrackToDeckA(track2);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.title, 'second');
    assert.equal(snap.deckA.calculatedBpm, 130.0);
    assert.equal(snap.deckA.keyStr, 'G (9B)');
    assert.equal(snap.deckA.track?.analysis.energy, 8.0);
  });

  it('5.5 Descarga de pista (unloadDeck) limpia todos los datos musicales y devuelve el deck a neutral', async () => {
    const file = createTestAudioFile('to_eject.mp3');
    const track = createTrackFromFile(file, 200.0);
    track.analysis = { status: 'analyzed', bpm: 125.0, key: 'Em', camelot: '9A', energy: 7.0 };
    await indexedDBStorage.saveTrack(track, file);

    await djStore.loadTrackToDeckA(track);
    let snap = djStore.getSnapshot();
    assert.ok(snap.deckA.track !== null);
    assert.equal(snap.deckA.calculatedBpm, 125.0);

    // Expulsar / descargar pista
    djStore.unloadDeckA();
    snap = djStore.getSnapshot();

    assert.equal(snap.deckA.track, null, 'track debe ser null');
    assert.equal(snap.deckA.calculatedBpm, null, 'calculatedBpm debe ser null tras descargar');
    assert.equal(snap.deckA.keyStr, null, 'keyStr debe ser null tras descargar');
    assert.equal(snap.deckA.duration, 0);
    assert.equal(snap.deckA.currentTime, 0);
    assert.equal(snap.deckA.playbackState, 'stopped');
  });

  it('5.6 Actualización en tiempo real al finalizar un análisis mientras la pista está cargada en un deck', async () => {
    const file = createTestAudioFile('async_track.mp3');
    const track = createTrackFromFile(file, 220.0);
    track.analysis = { status: 'pending' };
    await indexedDBStorage.saveTrack(track, file);

    // Cargar en Deck B con análisis pendiente
    await djStore.loadTrackToDeckB(track);
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckB.calculatedBpm, null);
    assert.equal(snap.deckB.keyStr, null);

    // Simular que el orquestador de sincronización emite el resultado completado
    const finishedAnalysis: TrackAnalysis = {
      status: 'analyzed',
      bpm: 127.5,
      bpmConfidence: 0.95,
      key: 'Bb',
      camelot: '6B',
      energy: 8.2,
      waveformPeaks: [0.1, 0.4, 0.7, 0.9],
    };
    await djStore.updateTrackAnalysis(track.id, finishedAnalysis);

    snap = djStore.getSnapshot();
    assert.equal(snap.deckB.calculatedBpm, 127.5, 'Deck B debe recibir el BPM analizado reactivamente');
    assert.equal(snap.deckB.keyStr, 'Bb (6B)', 'Deck B debe recibir la clave y Camelot reactivamente');
    assert.equal(snap.deckB.track?.analysis.energy, 8.2);
    assert.deepEqual(snap.deckB.track?.analysis.waveformPeaks, [0.1, 0.4, 0.7, 0.9]);
  });

  it('5.7 Protección estricta contra resultados tardíos de pistas reemplazadas o descargadas', async () => {
    const file1 = createTestAudioFile('track_early.mp3');
    const track1 = createTrackFromFile(file1, 100.0);
    track1.analysis = { status: 'pending' };
    await indexedDBStorage.saveTrack(track1, file1);

    const file2 = createTestAudioFile('track_active.mp3');
    const track2 = createTrackFromFile(file2, 100.0);
    track2.analysis = { status: 'analyzed', bpm: 140.0, key: 'D', camelot: '10B', energy: 9.0 };
    await indexedDBStorage.saveTrack(track2, file2);

    // 1. Cargar Track 1 en Deck A
    await djStore.loadTrackToDeckA(track1);

    // 2. El usuario cambia a Track 2 ANTES de que Track 1 termine de analizarse
    await djStore.loadTrackToDeckA(track2);
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.title, 'track_active');
    assert.equal(snap.deckA.calculatedBpm, 140.0);

    // 3. Llega tardíamente el resultado de Track 1
    const lateAnalysisTrack1: TrackAnalysis = {
      status: 'analyzed',
      bpm: 110.0,
      key: 'E',
      camelot: '12B',
      energy: 3.0,
    };
    djStore.handleAnalysisUpdated(track1.id, lateAnalysisTrack1);

    // 4. Deck A no debe contaminarse con Track 1
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.title, 'track_active');
    assert.equal(snap.deckA.calculatedBpm, 140.0, 'El BPM debe mantenerse en 140.0 de track_active');
    assert.equal(snap.deckA.keyStr, 'D (10B)', 'La tonalidad debe mantenerse en D (10B)');
  });

  it('5.8 Manejo consistente de estados failed y unsupported sin generar datos ficticios', async () => {
    const fileFailed = createTestAudioFile('corrupt.mp3');
    const trackFailed = createTrackFromFile(fileFailed, 100.0);
    trackFailed.analysis = { status: 'failed', analysisError: 'No se pudo decodificar el archivo' };
    await indexedDBStorage.saveTrack(trackFailed, fileFailed);

    const fileUnsupported = createTestAudioFile('whitenoise.wav');
    const trackUnsupported = createTrackFromFile(fileUnsupported, 100.0);
    trackUnsupported.analysis = { status: 'unsupported', analysisError: 'Ruido blanco sin ritmo armónico' };
    await indexedDBStorage.saveTrack(trackUnsupported, fileUnsupported);

    // Cargar fallida en Deck A
    await djStore.loadTrackToDeckA(trackFailed);
    const snapA = djStore.getSnapshot().deckA;
    assert.equal(snapA.track?.analysis.status, 'failed');
    assert.equal(snapA.calculatedBpm, null);
    assert.equal(snapA.keyStr, null);

    // Cargar unsupported en Deck B
    await djStore.loadTrackToDeckB(trackUnsupported);
    const snapB = djStore.getSnapshot().deckB;
    assert.equal(snapB.track?.analysis.status, 'unsupported');
    assert.equal(snapB.calculatedBpm, null);
    assert.equal(snapB.keyStr, null);
  });

  it('5.9 Recupera análisis de IndexedDB si la pista recibida en memoria aún tenía estado pending', async () => {
    const file = createTestAudioFile('db_cached.mp3');
    const trackInDb = createTrackFromFile(file, 200.0);
    trackInDb.analysis = { status: 'analyzed', bpm: 122.0, key: 'Fm', camelot: '4A', energy: 6.8 };
    await indexedDBStorage.saveTrack(trackInDb, file);

    // Simular que desde otra parte de la UI se envía un objeto track antiguo con status: pending
    const outdatedTrackInMemory: Track = {
      ...trackInDb,
      analysis: { status: 'pending' },
    };

    // Al cargarse, loadTrackToDeck consulta IndexedDB y recupera el análisis existente
    await djStore.loadTrackToDeckA(outdatedTrackInMemory);
    const snap = djStore.getSnapshot().deckA;

    assert.equal(snap.track?.analysis.status, 'analyzed');
    assert.equal(snap.calculatedBpm, 122.0);
    assert.equal(snap.keyStr, 'Fm (4A)');
  });

  it('5.10 Conservación del funcionamiento del motor de audio y del Mixer', async () => {
    const file = createTestAudioFile('mix_check.mp3');
    const track = createTrackFromFile(file, 200.0);
    track.analysis = { status: 'analyzed', bpm: 128.0, key: 'Am', camelot: '8A' };
    await indexedDBStorage.saveTrack(track, file);

    await djStore.loadTrackToDeckA(track);

    // Reproducción
    await djStore.playDeckA();
    assert.equal(djStore.getSnapshot().deckA.playbackState, 'playing');

    // Pausa
    djStore.pauseDeckA();
    assert.equal(djStore.getSnapshot().deckA.playbackState, 'paused');

    // Seek
    djStore.seekDeckA(30.0);
    assert.equal(djStore.getSnapshot().deckA.currentTime, 30.0);

    // Mixer EQ y Gain
    djStore.setChannelGain('A', 60);
    djStore.setChannelEq('A', 'high', 70);
    assert.equal(djStore.getSnapshot().mixer.channelA.gain, 60);
    assert.equal(djStore.getSnapshot().mixer.channelA.eq.high, 70);
  });

  it('5.11 Paridad estricta de localización para las nuevas claves de los Decks', () => {
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );
    const enJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
    );

    const requiredDeckKeys = [
      'deck_a',
      'deck_b',
      'tempo',
      'key_lock',
      'camelot',
      'energy',
      'time',
      'eject',
      'eject_title',
      'status',
      'analyze_deck',
      'reanalyze_deck',
      'no_track',
      'unknown_artist',
      'seek_title',
    ];

    for (const key of requiredDeckKeys) {
      assert.ok(esJson.dj[key], `Falta la clave dj.${key} en es/translation.json`);
      assert.ok(enJson.dj[key], `Falta la clave dj.${key} en en/translation.json`);
      assert.notEqual(esJson.dj[key].trim(), '', `La clave dj.${key} en es está vacía`);
      assert.notEqual(enJson.dj[key].trim(), '', `La clave dj.${key} en en está vacía`);
    }
  });

  it('5.12 Inspección de renderizado: Deck.tsx y Deck.css implementan SVG y diseño sin mocks', () => {
    const deckCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'),
      'utf-8'
    );
    const cssCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.css'),
      'utf-8'
    );

    // No debe contener variables simuladas de transporte
    assert.equal(deckCode.includes('mockPlayingB'), false);
    assert.equal(deckCode.includes('mockPitchB'), false);
    assert.equal(deckCode.includes('deck-waveform-mock'), false, 'El mock de waveform debe haberse reemplazado');

    // Debe contener renderizado SVG real y botón de expulsión
    assert.ok(deckCode.includes('deck-waveform-svg'), 'Deck.tsx debe renderizar SVG de forma de onda');
    assert.ok(deckCode.includes('deck-waveform-bar'), 'Deck.tsx debe renderizar rects de forma de onda');
    assert.ok(deckCode.includes('deck-eject-btn'), 'Deck.tsx debe incluir botón de expulsión');

    // Deck.css debe definir los tokens y estilos correspondientes
    assert.ok(cssCode.includes('.deck-waveform-svg'));
    assert.ok(cssCode.includes('.deck-waveform-bar'));
    assert.ok(cssCode.includes('.track-camelot-badge'));
    assert.ok(cssCode.includes('.deck-eject-btn'));
  });
});
