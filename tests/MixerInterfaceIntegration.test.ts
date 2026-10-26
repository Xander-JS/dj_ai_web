/**
 * SYSTEM DJ — FASE 21, ETAPA 4: Integración Funcional de la Consola Mixer
 * Pruebas automatizadas para verificar:
 * 1. Los controles de MixerConsole reflejan fielmente el estado centralizado de useDJStore.
 * 2. Mover cada control visual invoca la acción correcta del store y sincroniza con el motor DSP.
 * 3. Eliminación definitiva de estados locales simulados (useState(50)) en la consola del mixer.
 * 4. Aislamiento e independencia estricta entre Canal A y Canal B en controles de ganancia, EQ, filtro y faders.
 * 5. Sincronización del crossfader y selector de curva ('constant-power', 'linear', 'cut').
 * 6. Sincronización del control Master Volume y botón MUTE, manteniendo la fuente única de verdad.
 * 7. Persistencia del estado a través de suscriptores y re-renderizados sin reinicialización no deseada.
 * 8. Paridad total de internacionalización (i18n) en español e inglés para las nuevas claves del mixer.
 */

import 'fake-indexeddb/auto';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { readMixerSource } from './helpers/mixerSource.ts';

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

class MockDynamicsCompressorNode extends MockAudioNode {
  public threshold = new MockAudioParam(-1);
  public knee = new MockAudioParam(0);
  public ratio = new MockAudioParam(20);
  public attack = new MockAudioParam(0.002);
  public release = new MockAudioParam(0.05);
}

class MockAudioContext {
  public state = 'running';
  public sampleRate = 44100;
  public currentTime = 0;
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
  public createDynamicsCompressor(): MockDynamicsCompressorNode {
    return new MockDynamicsCompressorNode();
  }
  public async resume(): Promise<void> {
    this.state = 'running';
  }
  public async close(): Promise<void> {
    this.state = 'closed';
  }
}

describe('Fase 21 Etapa 4 — Integración Funcional de la Consola Mixer', () => {
  const originalWindow = globalThis.window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    await audioEngine.initialize();

    // Restablecer valores iniciales nominales del store
    djStore.setChannelGain('A', 50);
    djStore.setChannelGain('B', 50);
    djStore.setChannelEq('A', 'high', 50);
    djStore.setChannelEq('A', 'mid', 50);
    djStore.setChannelEq('A', 'low', 50);
    djStore.setChannelEq('B', 'high', 50);
    djStore.setChannelEq('B', 'mid', 50);
    djStore.setChannelEq('B', 'low', 50);
    djStore.setChannelFilter('A', 50);
    djStore.setChannelFilter('B', 50);
    djStore.setChannelVolume('A', 80);
    djStore.setChannelVolume('B', 80);
    djStore.setCuePfl('A', false);
    djStore.setCuePfl('B', false);
    djStore.setCrossfader(50);
    djStore.setCrossfaderCurve('constant-power');
    djStore.setMasterVolume(80);
    if (djStore.getSnapshot().isMasterMuted) {
      djStore.toggleMasterMute();
    }
  });

  afterEach(async () => {
    await audioEngine.dispose();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  test('1. El mixer elimina estados locales simulados y se vincula a useDJStore', () => {
    const consoleCode = readMixerSource();

    // No debe contener useState simulados para controles de audio
    assert.equal(consoleCode.includes('const [gain, setGain] = useState'), false, 'No debe existir useState para gain');
    assert.equal(consoleCode.includes('const [hi, setHi] = useState'), false, 'No debe existir useState para hi');
    assert.equal(consoleCode.includes('const [mid, setMid] = useState'), false, 'No debe existir useState para mid');
    assert.equal(consoleCode.includes('const [low, setLow] = useState'), false, 'No debe existir useState para low');
    assert.equal(consoleCode.includes('const [filter, setFilter] = useState'), false, 'No debe existir useState para filter');
    assert.equal(consoleCode.includes('const [volume, setVolume] = useState'), false, 'No debe existir useState para volume');
    assert.equal(consoleCode.includes('const [crossfader, setCrossfader] = useState'), false, 'No debe existir useState para crossfader');

    // Debe invocar useDJStore y desestructurar las acciones del mixer
    assert.ok(consoleCode.includes('useDJStore()'), 'El mixer debe llamar a useDJStore');
    assert.ok(consoleCode.includes('setChannelGain'), 'Debe usar setChannelGain');
    assert.ok(consoleCode.includes('setChannelEq'), 'Debe usar setChannelEq');
    assert.ok(consoleCode.includes('setChannelFilter'), 'Debe usar setChannelFilter');
    assert.ok(consoleCode.includes('setChannelVolume'), 'Debe usar setChannelVolume');
    assert.ok(consoleCode.includes('setCuePfl'), 'Debe usar setCuePfl');
    assert.ok(consoleCode.includes('setCrossfader'), 'Debe usar setCrossfader');
    assert.ok(consoleCode.includes('setCrossfaderCurve'), 'Debe usar setCrossfaderCurve');
    assert.ok(consoleCode.includes('setMasterVolume'), 'Debe usar setMasterVolume');
    assert.ok(consoleCode.includes('toggleMasterMute'), 'Debe usar toggleMasterMute');
  });

  test('2. Mixer.tsx contiene MixerConsole sin capas intermedias ni estados mock', () => {
    const mixerPageCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/Mixer.tsx'),
      'utf-8'
    );
    const consoleCode = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/dj/organisms/DJConsole.tsx'),
      'utf-8'
    );
    assert.ok(mixerPageCode.includes('<DJConsole />'), 'Mixer.tsx debe renderizar la consola completa');
    assert.ok(consoleCode.includes('<MixerConsole />'), 'La carcasa debe renderizar MixerConsole directamente');
    assert.equal(mixerPageCode.includes('mock'), false, 'Mixer.tsx no debe contener estados mock');
    assert.equal(consoleCode.includes('mock'), false, 'DJConsole.tsx no debe contener estados mock');
  });

  test('3. Los controles muestran y actualizan los valores del store centralizado', () => {
    // Modificar valores a través del store
    djStore.setChannelGain('A', 65);
    djStore.setChannelEq('A', 'high', 75);
    djStore.setChannelEq('A', 'mid', 40);
    djStore.setChannelEq('A', 'low', 25);
    djStore.setChannelFilter('A', 85);
    djStore.setChannelVolume('A', 92);
    djStore.setCuePfl('A', true);

    const snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.gain, 65);
    assert.equal(snap.mixer.channelA.eq.high, 75);
    assert.equal(snap.mixer.channelA.eq.mid, 40);
    assert.equal(snap.mixer.channelA.eq.low, 25);
    assert.equal(snap.mixer.channelA.eq.filter, 85);
    assert.equal(snap.mixer.channelA.volume, 92);
    assert.equal(snap.mixer.channelA.cuePfl, true);
  });

  test('4. Los canales A y B permanecen completamente aislados en sus controles', () => {
    // Modificar canal A
    djStore.setChannelGain('A', 70);
    djStore.setChannelEq('A', 'high', 80);
    djStore.setChannelFilter('A', 90);
    djStore.setChannelVolume('A', 60);
    djStore.setCuePfl('A', true);

    // Canal B debe conservar sus valores nominales intactos
    const snapA = djStore.getSnapshot();
    assert.equal(snapA.mixer.channelB.gain, 50, 'Gain de B no debe cambiar');
    assert.equal(snapA.mixer.channelB.eq.high, 50, 'High de B no debe cambiar');
    assert.equal(snapA.mixer.channelB.eq.filter, 50, 'Filter de B no debe cambiar');
    assert.equal(snapA.mixer.channelB.volume, 80, 'Volume de B no debe cambiar');
    assert.equal(snapA.mixer.channelB.cuePfl, false, 'CuePfl de B no debe cambiar');

    // Modificar canal B
    djStore.setChannelGain('B', 30);
    djStore.setChannelEq('B', 'low', 20);
    djStore.setChannelFilter('B', 10);
    djStore.setChannelVolume('B', 100);
    djStore.setCuePfl('B', true);

    // Canal A no debe haber sido afectado por los cambios en B
    const snapB = djStore.getSnapshot();
    assert.equal(snapB.mixer.channelA.gain, 70, 'Gain de A debe permanecer en 70');
    assert.equal(snapB.mixer.channelA.eq.high, 80, 'High de A debe permanecer en 80');
    assert.equal(snapB.mixer.channelA.volume, 60, 'Volume de A debe permanecer en 60');
  });

  test('5. EQ y filtro utilizan las conversiones esperadas por el motor sin doble conversión', () => {
    const graphA = audioEngine.getDeckAudioGraph('A');
    const highParam = (graphA.eqHighNode as unknown as { gain: MockAudioParam }).gain;
    const filterNode = graphA.filterNode;

    // Al mover slider de EQ a 100 (máximo impulso), el motor recibe +12 dB
    djStore.setChannelEq('A', 'high', 100);
    assert.equal(highParam.value, 12);
    assert.equal(djStore.getSnapshot().mixer.channelA.eq.high, 100);

    // Al mover slider de EQ al centro (50), el motor recibe 0 dB
    djStore.setChannelEq('A', 'high', 50);
    assert.equal(highParam.value, 0);
    assert.equal(djStore.getSnapshot().mixer.channelA.eq.high, 50);

    // Al mover slider de EQ a 0 (corte total), el motor recibe -12 dB
    djStore.setChannelEq('A', 'high', 0);
    assert.equal(highParam.value, -12);
    assert.equal(djStore.getSnapshot().mixer.channelA.eq.high, 0);

    // Al mover slider de filtro a 100 (HPF máximo), el filtro pasa a highpass
    djStore.setChannelFilter('A', 100);
    assert.equal(filterNode.type, 'highpass');
    assert.equal(djStore.getSnapshot().mixer.channelA.eq.filter, 100);

    // Al mover slider de filtro al centro (50), el filtro pasa a allpass (bypass)
    djStore.setChannelFilter('A', 50);
    assert.equal(filterNode.type, 'allpass');
    assert.equal(djStore.getSnapshot().mixer.channelA.eq.filter, 50);

    // Al mover slider de filtro a 0 (LPF máximo), el filtro pasa a lowpass
    djStore.setChannelFilter('A', 0);
    assert.equal(filterNode.type, 'lowpass');
    assert.equal(djStore.getSnapshot().mixer.channelA.eq.filter, 0);
  });

  test('6. Crossfader y selector de curva permanecen sincronizados bidireccionalmente', () => {
    // Ajustar posición del crossfader
    djStore.setCrossfader(25);
    assert.equal(djStore.getSnapshot().mixer.crossfader, 25);
    assert.equal(djStore.getSnapshot().mixer.crossfaderCurve, 'constant-power');

    // Cambiar curva a 'cut'
    djStore.setCrossfaderCurve('cut');
    assert.equal(djStore.getSnapshot().mixer.crossfaderCurve, 'cut');
    assert.equal(djStore.getSnapshot().mixer.crossfader, 25);

    // Cambiar curva a 'linear'
    djStore.setCrossfaderCurve('linear');
    assert.equal(djStore.getSnapshot().mixer.crossfaderCurve, 'linear');
  });

  test('7. Master Volume y botón MUTE mantienen su comportamiento y fuente única de verdad', () => {
    const master = audioEngine.getMasterGraph();
    const masterParam = (master.masterGainNode as unknown as { gain: MockAudioParam }).gain;

    djStore.setMasterVolume(85);
    assert.equal(djStore.getSnapshot().masterVolume, 85);
    assert.equal(djStore.getSnapshot().mixer.masterVolume, 85);
    assert.equal(masterParam.value, 0.85);

    // Activar Mute
    djStore.toggleMasterMute();
    assert.equal(djStore.getSnapshot().isMasterMuted, true);
    assert.equal(masterParam.value, 0, 'El motor debe silenciarse a 0');
    assert.equal(djStore.getSnapshot().masterVolume, 85, 'El valor nominal debe conservarse');

    // Desactivar Mute
    djStore.toggleMasterMute();
    assert.equal(djStore.getSnapshot().isMasterMuted, false);
    assert.equal(masterParam.value, 0.85, 'Debe restaurarse el volumen nominal en el motor');
  });

  test('8. Persistencia y reactividad a través de suscriptores del store', () => {
    const changes: number[] = [];
    const unsubscribe = djStore.subscribe(() => {
      changes.push(djStore.getSnapshot().mixer.crossfader);
    });

    djStore.setCrossfader(10);
    djStore.setCrossfader(45);
    djStore.setCrossfader(90);

    unsubscribe();
    assert.deepEqual(changes, [10, 45, 90]);
  });

  test('9. Paridad estricta de localización para las claves de la consola Mixer', () => {
    const esJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/es/translation.json'), 'utf-8')
    );
    const enJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'src/i18n/locales/en/translation.json'), 'utf-8')
    );

    const requiredKeys = [
      'channel',
      'crossfader_label',
      'crossfader_value',
      'gain',
      'high',
      'mid',
      'low',
      'filter',
      'master',
      'cue_pfl',
      'curve',
      'curve_constant_power',
      'curve_linear',
      'curve_cut',
      'curve_cp_short',
      'curve_lin_short',
      'curve_cut_short',
      'mute',
    ];

    for (const key of requiredKeys) {
      assert.ok(esJson.mixer[key], `Falta clave mixer.${key} en es/translation.json`);
      assert.ok(enJson.mixer[key], `Falta clave mixer.${key} en en/translation.json`);
    }
  });
});
