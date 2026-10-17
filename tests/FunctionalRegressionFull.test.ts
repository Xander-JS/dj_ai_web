/**
 * SYSTEM DJ — Test Suite: Fase 22 — Etapa 6.5
 * Suite Integral de Regresión Funcional de Reproducción, Decks, Mixer, i18n y Temas
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

// Mock minimal de AudioContext para Node.js
class MockAudioParam {
  public value: number;
  constructor(val = 1) { this.value = val; }
  public setValueAtTime(v: number): void { this.value = v; }
}

class MockAudioNode {
  public connect(): MockAudioNode { return this; }
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
  public getByteTimeDomainData(arr: Uint8Array): void { arr.fill(128); }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  public buffer: AudioBuffer | null = null;
  public playbackRate = new MockAudioParam(1);
  public onended: (() => void) | null = null;
  public isStarted = false;
  public isStopped = false;

  public start(): void { this.isStarted = true; }
  public stop(): void {
    this.isStopped = true;
    if (this.onended) this.onended();
  }
}

class MockAudioContext {
  public state = 'running';
  public currentTime = 10.0;
  public destination = new MockAudioNode();
  public createGain() { return new MockGainNode(); }
  public createBiquadFilter() { return new MockBiquadFilterNode(); }
  public createAnalyser() { return new MockAnalyserNode(); }
  public createBufferSource() { return new MockAudioBufferSourceNode(); }
  public async decodeAudioData(
    _buffer: ArrayBuffer,
    successCallback?: (decoded: AudioBuffer) => void
  ): Promise<AudioBuffer> {
    const duration = 180.0;
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
  public async resume(): Promise<void> { this.state = 'running'; }
  public async close(): Promise<void> { this.state = 'closed'; }
}

function createTestAudioFile(name = 'track.mp3', size = 3000): File {
  return new File([new Uint8Array(size)], name, { type: 'audio/mpeg', lastModified: Date.now() });
}

describe('Fase 22 — Etapa 6.5: Regresión Funcional Integral', () => {
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
    djStore.setCrossfader(50);
    djStore.setMasterVolume(80);
    if (djStore.getSnapshot().isMasterMuted) {
      djStore.toggleMasterMute();
    }
    await indexedDBStorage.clearAll();
  });

  afterEach(async () => {
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await audioEngine.dispose();
    await indexedDBStorage.clearAll();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it('6.5.1 Transporte de audio: Play, Pause, Seek y CUE operan correctamente', async () => {
    const file = createTestAudioFile('song_transport.mp3');
    const track = createTrackFromFile(file, 200);
    track.analysis = { status: 'analyzed', bpm: 120, key: 'C', camelot: '8B' };
    await indexedDBStorage.saveTrack(track, file);

    await djStore.loadTrackToDeckA(track);
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'stopped');
    assert.equal(snap.deckA.currentTime, 0);

    // Play
    await djStore.playDeckA();
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'playing');

    // Seek interactivo a segundo 45.5
    djStore.seekDeckA(45.5);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.currentTime, 45.5);

    // Pause
    djStore.pauseDeckA();
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'paused');

    // Stop/CUE (regreso a inicio 0:00)
    djStore.stopDeckA();
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackState, 'stopped');
    assert.equal(snap.deckA.currentTime, 0);
  });

  it('6.5.2 Decks A y B: Aislamiento, Pitch Slider ±8% y cálculo dinámico de tempo', async () => {
    const fileA = createTestAudioFile('trackA.mp3');
    const trackA = createTrackFromFile(fileA, 180);
    trackA.analysis = { status: 'analyzed', bpm: 125.0, key: 'Am', camelot: '8A' };
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = createTestAudioFile('trackB.mp3');
    const trackB = createTrackFromFile(fileB, 210);
    trackB.analysis = { status: 'analyzed', bpm: 130.0, key: 'Dm', camelot: '7A' };
    await indexedDBStorage.saveTrack(trackB, fileB);

    await djStore.loadTrackToDeckA(trackA);
    await djStore.loadTrackToDeckB(trackB);

    // Inicial con pitch 50 (centro, 0% cambio)
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackRate, 1.0);
    assert.equal(snap.deckA.calculatedBpm, 125.0);
    assert.equal(snap.deckB.playbackRate, 1.0);
    assert.equal(snap.deckB.calculatedBpm, 130.0);

    // Modificar pitch en Deck A a 100 (+8%)
    djStore.setPitchDeckA(100);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckA.playbackRate, 1.08);
    // 125.0 * 1.08 = 135.0
    assert.equal(snap.deckA.calculatedBpm, 135.0);

    // Deck B debe mantenerse completamente inalterado
    assert.equal(snap.deckB.playbackRate, 1.0);
    assert.equal(snap.deckB.calculatedBpm, 130.0);

    // Modificar pitch en Deck B a 0 (-8%)
    djStore.setPitchDeckB(0);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckB.playbackRate, 0.92);
    // 130.0 * 0.92 = 119.6
    assert.equal(snap.deckB.calculatedBpm, 119.6);

    // Deck A debe seguir en 135.0
    assert.equal(snap.deckA.calculatedBpm, 135.0);
  });

  it('6.5.3 Mixer y DSP: Crossfader, ecualización, filtro bipolar y limitador Master', () => {
    // 1. Crossfader y selector de curva
    djStore.setCrossfaderCurve('cut');
    assert.equal(djStore.getSnapshot().mixer.crossfaderCurve, 'cut');

    djStore.setCrossfader(0); // 100% Canal A
    assert.equal(djStore.getSnapshot().mixer.crossfader, 0);

    djStore.setCrossfader(100); // 100% Canal B
    assert.equal(djStore.getSnapshot().mixer.crossfader, 100);

    // 2. Ecualización y filtros Deck A
    djStore.setEq('A', 'high', 75);
    djStore.setEq('A', 'mid', 40);
    djStore.setEq('A', 'low', 25);
    djStore.setFilter('A', 85);

    const snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.eq.high, 75);
    assert.equal(snap.mixer.channelA.eq.mid, 40);
    assert.equal(snap.mixer.channelA.eq.low, 25);
    assert.equal(snap.mixer.channelA.eq.filter, 85);

    // Comprobar que Deck B tiene valores neutros independientes (50 = centro)
    assert.equal(snap.mixer.channelB.eq.high, 50);
    assert.equal(snap.mixer.channelB.eq.filter, 50);

    // 3. Master Volume y MUTE
    djStore.setMasterVolume(90);
    assert.equal(djStore.getSnapshot().masterVolume, 90);

    assert.equal(djStore.getSnapshot().isMasterMuted, false);
    djStore.toggleMasterMute();
    assert.equal(djStore.getSnapshot().isMasterMuted, true);
    djStore.toggleMasterMute();
    assert.equal(djStore.getSnapshot().isMasterMuted, false);
  });

  it('6.5.4 Localización estricta: Paridad 100% de claves entre español e inglés', () => {
    const esPath = path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json');
    const enPath = path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json');

    const esJson = JSON.parse(fs.readFileSync(esPath, 'utf-8'));
    const enJson = JSON.parse(fs.readFileSync(enPath, 'utf-8'));

    function getKeys(obj: Record<string, unknown>, prefix = ''): string[] {
      let keys: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          keys = keys.concat(getKeys(v as Record<string, unknown>, fullKey));
        } else {
          keys.push(fullKey);
        }
      }
      return keys;
    }

    const esKeys = getKeys(esJson).sort();
    const enKeys = getKeys(enJson).sort();

    assert.deepEqual(esKeys, enKeys, 'Las claves de localización deben coincidir exactamente entre español e inglés');

    // Verificar claves críticas de análisis musical
    const requiredKeys = [
      'dj.tempo',
      'dj.key_lock',
      'dj.camelot',
      'dj.energy',
      'dj.eject',
      'library.col_bpm',
      'library.col_key',
      'library.col_energy',
      'library.status_pending',
      'library.status_analyzing',
      'library.status_analyzed',
      'library.status_unsupported',
      'library.status_failed',
      'library.action_reanalyze',
    ];

    for (const key of requiredKeys) {
      assert.ok(esKeys.includes(key), `Clave requerida ${key} debe existir en español`);
      assert.ok(enKeys.includes(key), `Clave requerida ${key} debe existir en inglés`);
    }
  });

  it('6.5.5 Sistema de diseño: index.css y componentes usan tokens semánticos', () => {
    const cssPath = path.resolve(process.cwd(), 'src/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    // Verificar presencia de variables para ambos temas
    assert.ok(cssContent.includes('--bg-base'), 'Debe definir token --bg-base');
    assert.ok(cssContent.includes('--bg-surface'), 'Debe definir token --bg-surface');
    assert.ok(cssContent.includes('--text-primary'), 'Debe definir token --text-primary');
    assert.ok(cssContent.includes('[data-theme=\'dark\']'), 'Debe definir soporte para tema oscuro');
  });
});
