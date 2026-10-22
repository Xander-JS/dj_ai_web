/**
 * SYSTEM DJ — FASE 20, ETAPA 4: Integración Real de la Interfaz de Deck B
 * Pruebas automatizadas para verificar:
 * 1. Independencia total de estado y acciones entre Deck A y Deck B.
 * 2. Carga desde biblioteca hacia Deck A o Deck B sin interferencias cruzadas.
 * 3. Controles de transporte (Play/Pause, Stop/Cue, Seek, Pitch) para Deck B.
 * 4. Suscripciones y reactividad de estado para ambos decks.
 * 5. Estados de carga y error en Deck B sin afectar a Deck A.
 * 6. Ausencia de mocks en los componentes de transporte.
 * 7. Paridad de localización es / en para las nuevas claves.
 */

import 'fake-indexeddb/auto';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { indexedDBStorage } from '../src/services/storage/IndexedDBStorage.ts';
import { createTrackFromFile } from '../src/utils/audioValidation.ts';

// Web Audio API mock para Node.js
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
    const duration = buffer.byteLength;
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

describe('Fase 20 Etapa 4 — Integración Real de la Interfaz de Deck B', () => {
  const originalWindow = globalThis.window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    await audioEngine.initialize();
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await indexedDBStorage.clearAll();
  });

  afterEach(async () => {
    djStore.unloadDeckA();
    djStore.unloadDeckB();
    await audioEngine.dispose();
    await indexedDBStorage.clearAll();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  test('Deck A y Deck B cargan pistas locales distintas de forma independiente', async () => {
    const fileA = new File([new Uint8Array(180)], 'banger_deck_a.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 180.0);
    await indexedDBStorage.saveTrack(trackA, fileA);

    const fileB = new File([new Uint8Array(210)], 'techno_deck_b.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 210.0);
    await indexedDBStorage.saveTrack(trackB, fileB);

    // Cargar en Deck A
    const loadedA = await djStore.loadTrackToDeck('A', trackA);
    assert.equal(loadedA, true);

    // Cargar en Deck B
    const loadedB = await djStore.loadTrackToDeck('B', trackB);
    assert.equal(loadedB, true);

    const snapshot = djStore.getSnapshot();
    assert.equal(snapshot.deckA.track?.title, 'banger_deck_a');
    assert.equal(snapshot.deckA.duration, 180.0);
    assert.equal(snapshot.deckB.track?.title, 'techno_deck_b');
    assert.equal(snapshot.deckB.duration, 210.0);
  });

  test('Cargar en Deck B no altera ni descarga la pista de Deck A', async () => {
    const fileA = new File([new Uint8Array(120)], 'keep_in_a.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 120.0);
    await indexedDBStorage.saveTrack(trackA, fileA);
    await djStore.loadTrackToDeckA(trackA);

    // Deck A está listo
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckA.track?.title, 'keep_in_a');

    // Cargar nueva pista en Deck B
    const fileB = new File([new Uint8Array(240)], 'new_in_b.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 240.0);
    await indexedDBStorage.saveTrack(trackB, fileB);
    await djStore.loadTrackToDeckB(trackB);

    snap = djStore.getSnapshot();
    // Deck A permanece idéntico
    assert.equal(snap.deckA.track?.title, 'keep_in_a');
    assert.equal(snap.deckA.duration, 120.0);
    // Deck B tiene su propia pista
    assert.equal(snap.deckB.track?.title, 'new_in_b');
    assert.equal(snap.deckB.duration, 240.0);
  });

  test('Cargas recomendadas exitosas o fallidas en Deck B preservan pista, transporte y pitch de Deck A', async () => {
    const fileA = new File([new Uint8Array(120)], 'playing_in_a.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 120.0);
    await indexedDBStorage.saveTrack(trackA, fileA);
    await djStore.loadTrackToDeckA(trackA);
    djStore.setPitchDeckA(75);
    djStore.seekDeckA(24.0);
    await djStore.playDeckA();

    const stateBeforeRecommendationLoad = djStore.getSnapshot().deckA;
    assert.equal(stateBeforeRecommendationLoad.playbackState, 'playing');
    assert.equal(stateBeforeRecommendationLoad.playbackRate, 1.04);
    assert.equal(stateBeforeRecommendationLoad.currentTime, 24.0);

    const priorFileB = new File([new Uint8Array(180)], 'prior_track_b.wav', { type: 'audio/wav' });
    const priorTrackB = createTrackFromFile(priorFileB, 180.0);
    await indexedDBStorage.saveTrack(priorTrackB, priorFileB);
    await djStore.loadTrackToDeckB(priorTrackB);
    await djStore.playDeckB();
    djStore.setDeck('B', { phaseAlignment: { status: 'active', progressPercent: 35 } });

    const recommendedFile = new File([new Uint8Array(240)], 'recommended_in_b.wav', { type: 'audio/wav' });
    const recommendedTrack = createTrackFromFile(recommendedFile, 240.0);
    await indexedDBStorage.saveTrack(recommendedTrack, recommendedFile);
    assert.equal(await djStore.loadTrackToDeckB(recommendedTrack), true);

    let stateAfterLoad = djStore.getSnapshot();
    assert.equal(stateAfterLoad.deckB.track?.id, recommendedTrack.id);
    assert.equal(stateAfterLoad.deckB.phaseAlignment.status, 'idle');
    assert.equal(stateAfterLoad.deckA.track?.id, trackA.id);
    assert.equal(stateAfterLoad.deckA.playbackState, 'playing');
    assert.equal(stateAfterLoad.deckA.playbackRate, 1.04);
    assert.equal(stateAfterLoad.deckA.currentTime, 24.0);

    djStore.setPitchDeckB(65);
    djStore.seekDeckB(31.0);
    await djStore.playDeckB();
    djStore.setDeck('B', { phaseAlignment: { status: 'active', progressPercent: 42 } });
    const deckBBeforeFailedLoad = djStore.getSnapshot().deckB;

    const missingTrackB = {
      ...recommendedTrack,
      id: 'missing_recommendation_blob',
      source: { type: 'indexeddb' as const, indexedDbKey: 'missing_recommendation_blob' },
    };
    assert.equal(await djStore.loadTrackToDeckB(missingTrackB), false);

    stateAfterLoad = djStore.getSnapshot();
    assert.deepEqual(stateAfterLoad.deckB, deckBBeforeFailedLoad);
    assert.equal(stateAfterLoad.deckA.track?.id, trackA.id);
    assert.equal(stateAfterLoad.deckA.playbackState, 'playing');
    assert.equal(stateAfterLoad.deckA.playbackRate, 1.04);
    assert.equal(stateAfterLoad.deckA.currentTime, 24.0);

    // Restore the test fixture's neutral pitch value.
    djStore.setPitchDeckA(50);
    djStore.setPitchDeckB(50);
  });

  test('Una carga explícita en Deck A reemplaza A aunque reproduzca y conserva Deck B', async () => {
    const fileB = new File([new Uint8Array(300)], 'keep_in_b.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 300.0);
    await indexedDBStorage.saveTrack(trackB, fileB);
    await djStore.loadTrackToDeckB(trackB);
    djStore.setPitchDeckB(65);
    djStore.seekDeckB(35.0);
    await djStore.playDeckB();
    const deckBBefore = djStore.getSnapshot().deckB;

    const oldFileA = new File([new Uint8Array(150)], 'old_a.mp3', { type: 'audio/mpeg' });
    const oldTrackA = createTrackFromFile(oldFileA, 150.0);
    await indexedDBStorage.saveTrack(oldTrackA, oldFileA);
    await djStore.loadTrackToDeckA(oldTrackA);
    await djStore.playDeckA();
    djStore.setPitchDeckA(75);
    djStore.pitchBendDeckA('up');
    djStore.seekDeckA(23.0);

    const fileA = new File([new Uint8Array(150)], 'brand_new_a.mp3', { type: 'audio/mpeg' });
    const trackA = createTrackFromFile(fileA, 150.0);
    await indexedDBStorage.saveTrack(trackA, fileA);
    assert.equal(await djStore.loadTrackToDeckA(trackA), true);

    const snap = djStore.getSnapshot();
    assert.equal(snap.deckB.track?.id, deckBBefore.track?.id);
    assert.equal(snap.deckB.duration, deckBBefore.duration);
    assert.equal(snap.deckB.playbackState, 'playing');
    assert.equal(snap.deckB.currentTime, 35.0);
    assert.equal(snap.deckB.playbackRate, 1.024);
    assert.equal(snap.deckA.track?.title, 'brand_new_a');
    assert.equal(snap.deckA.duration, 150.0);
    assert.equal(snap.deckA.playbackState, 'stopped');
    assert.equal(snap.deckA.currentTime, 0);
    assert.equal(snap.deckA.playbackRate, 1.04);
    assert.equal(snap.deckA.pitchBend, 0);
    djStore.setPitchDeckA(50);
    djStore.setPitchDeckB(50);
  });

  test('Una respuesta de decodificación antigua no reemplaza la carga más reciente en el mismo deck', async () => {
    const olderFile = new File([new Uint8Array([1, 1, 1])], 'older.mp3', { type: 'audio/mpeg' });
    const olderTrack = createTrackFromFile(olderFile, 120.0);
    await indexedDBStorage.saveTrack(olderTrack, olderFile);
    const newerFile = new File([new Uint8Array([2, 2, 2, 2, 2])], 'newer.mp3', { type: 'audio/mpeg' });
    const newerTrack = createTrackFromFile(newerFile, 130.0);
    await indexedDBStorage.saveTrack(newerTrack, newerFile);

    const originalDecode = audioEngine.decodeAudioData.bind(audioEngine);
    let markOlderDecodeStarted: () => void = () => {};
    let releaseOlderDecode: () => void = () => {};
    const olderDecodeStarted = new Promise<void>((resolve) => { markOlderDecodeStarted = resolve; });
    const olderDecodeGate = new Promise<void>((resolve) => { releaseOlderDecode = resolve; });
    audioEngine.decodeAudioData = async (buffer: ArrayBuffer) => {
      if (new Uint8Array(buffer)[0] === 1) {
        markOlderDecodeStarted();
        await olderDecodeGate;
      }
      return originalDecode(buffer);
    };

    try {
      const olderLoad = djStore.loadTrackToDeckA(olderTrack);
      await olderDecodeStarted;
      assert.equal(await djStore.loadTrackToDeckA(newerTrack), true);
      releaseOlderDecode();
      assert.equal(await olderLoad, false);

      const state = djStore.getSnapshot().deckA;
      assert.equal(state.track?.id, newerTrack.id);
      assert.equal(state.duration, 5);
      assert.equal(audioEngine.getDeckDuration('A'), 5);
    } finally {
      releaseOlderDecode();
      audioEngine.decodeAudioData = originalDecode;
    }
  });

  test('Acciones de transporte en Deck B (Play, Pause, Stop, Seek, Pitch) funcionan con aislamiento', async () => {
    const fileB = new File([new Uint8Array(200)], 'transport_test.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 200.0);
    await indexedDBStorage.saveTrack(trackB, fileB);
    await djStore.loadTrackToDeckB(trackB);

    // Play Deck B
    await djStore.togglePlayDeck('B');
    let snap = djStore.getSnapshot();
    assert.equal(snap.deckB.playbackState, 'playing');
    assert.equal(snap.deckA.playbackState, 'stopped');

    // Seek Deck B
    djStore.seekDeck('B', 45.0);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckB.currentTime, 45.0);
    assert.equal(snap.deckA.currentTime, 0);

    // Pitch Deck B (slider value 75 corresponds to +4%, i.e. rate 1.04)
    djStore.setPitchDeck('B', 75.0);
    snap = djStore.getSnapshot();
    assert.equal(snap.deckB.pitch, 75.0);
    assert.equal(snap.deckB.playbackRate, 1.04);
    assert.equal(snap.deckA.pitch, 50.0);
    assert.equal(snap.deckA.playbackRate, 1.0);

    // Pause Deck B
    await djStore.togglePlayDeck('B');
    snap = djStore.getSnapshot();
    assert.equal(snap.deckB.playbackState, 'paused');
    assert.equal(snap.deckB.currentTime, 45.0);

    // Stop / Cue Deck B (reinicia a 0)
    djStore.stopDeck('B');
    snap = djStore.getSnapshot();
    assert.equal(snap.deckB.playbackState, 'stopped');
    assert.equal(snap.deckB.currentTime, 0);
  });

  test('Pitch de Deck B limitado dentro de [0, 100] (rango de rate [0.92, 1.08])', () => {
    djStore.setPitchDeck('B', 150.0);
    assert.equal(djStore.getSnapshot().deckB.pitch, 100.0);
    assert.equal(djStore.getSnapshot().deckB.playbackRate, 1.08);

    djStore.setPitchDeck('B', -25.0);
    assert.equal(djStore.getSnapshot().deckB.pitch, 0.0);
    assert.equal(djStore.getSnapshot().deckB.playbackRate, 0.92);
  });

  test('Reactividad de suscriptores al cambiar el estado de Deck B', async () => {
    const notifications: string[] = [];
    const unsubscribe = djStore.subscribe(() => {
      notifications.push(djStore.getSnapshot().deckB.playbackState);
    });

    const fileB = new File([new Uint8Array(200)], 'notify.wav', { type: 'audio/wav' });
    const trackB = createTrackFromFile(fileB, 100.0);
    await indexedDBStorage.saveTrack(trackB, fileB);
    await djStore.loadTrackToDeckB(trackB);

    await djStore.playDeckB();
    await djStore.pauseDeckB();

    unsubscribe();
    assert.ok(notifications.includes('playing'));
    assert.ok(notifications.includes('paused'));
  });

  test('Verificar que Deck.tsx y Mixer.tsx no contienen variables mock de transporte', () => {
    const deckCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/Deck.tsx'),
      'utf-8'
    );
    assert.equal(deckCode.includes('mockPlayingB'), false, 'No debe existir mockPlayingB en Deck.tsx');
    assert.equal(deckCode.includes('mockPitchB'), false, 'No debe existir mockPitchB en Deck.tsx');

    const mixerCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/Mixer.tsx'),
      'utf-8'
    );
    assert.equal(mixerCode.includes('mockPlayingB'), false, 'No debe existir mockPlayingB en Mixer.tsx');
    assert.equal(mixerCode.includes('MOCK_LIBRARY'), false, 'No debe importarse MOCK_LIBRARY en Mixer.tsx');
  });

  test('Paridad de claves de localización para Deck B e integración de biblioteca', () => {
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );
    const enJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
    );

    // Claves en dj
    const djKeys = ['deck_a', 'deck_b', 'play', 'pause', 'cue_stop', 'seek_title'];
    for (const k of djKeys) {
      assert.ok(esJson.dj[k], `Falta clave dj.${k} en es/translation.json`);
      assert.ok(enJson.dj[k], `Falta clave dj.${k} en en/translation.json`);
    }

    // Claves en library
    const libKeys = ['load_deck_a', 'load_deck_b', 'load_success', 'load_error'];
    for (const k of libKeys) {
      assert.ok(esJson.library[k], `Falta clave library.${k} en es/translation.json`);
      assert.ok(enJson.library[k], `Falta clave library.${k} en en/translation.json`);
    }
  });
});
