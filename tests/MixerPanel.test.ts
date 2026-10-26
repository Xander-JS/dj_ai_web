/**
 * SYSTEM DJ — Mixer central (sección 4, carpeta 04)
 * 1. Motor: derivación estéreo L / R del Master para el vúmetro de dos barras (cambio funcional),
 *    con respaldo mono cuando el contexto no ofrece ChannelSplitter.
 * 2. Modelo puro: LED de señal de cada canal, texto del FILTER, niveles efectivos, brillo de
 *    `← A` / `B →` y teclas de curva.
 * 3. Disposición: CH 1 | MASTER | CH 2, orden de los controles, sin espectro ni título, y textos
 *    en español e inglés.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { audioEngine } from '../src/audio/index.ts';
import { calculateCrossfaderGains } from '../src/audio/djAudioMath.ts';
import {
  CLIP_LEVEL,
  CURVE_BUTTONS,
  SIGNAL_THRESHOLD,
  getChannelSignal,
  getCrossfaderSideLights,
  getEffectiveLevels,
  getFilterValueText,
} from '../src/services/console/mixerPanelModel.ts';
import { readMixerSource } from './helpers/mixerSource.ts';

// --------------------------------------------------------------------------
// Web Audio mock con ChannelSplitter (las conexiones guardan la salida usada)
// --------------------------------------------------------------------------
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
  public connectedTo: MockAudioNode[] = [];
  public outputs: number[] = [];
  public channelCount = 2;
  public channelCountMode = 'max';
  public channelInterpretation = 'speakers';
  public disconnected = false;
  public connect(target: MockAudioNode, output = 0): MockAudioNode {
    this.connectedTo.push(target);
    this.outputs.push(output);
    return target;
  }
  public disconnect(): void {
    this.connectedTo = [];
    this.outputs = [];
    this.disconnected = true;
  }
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
  public fftSize = 2048;
  public frequencyBinCount = 128;
  public smoothingTimeConstant = 0.8;
  public testData: number[] | null = null;
  public getByteTimeDomainData(arr: Uint8Array): void {
    if (this.testData) {
      for (let i = 0; i < arr.length; i++) arr[i] = this.testData[i % this.testData.length];
    } else {
      arr.fill(128);
    }
  }
}

class MockChannelSplitterNode extends MockAudioNode {
  public numberOfOutputs: number;
  constructor(numberOfOutputs: number) {
    super();
    this.numberOfOutputs = numberOfOutputs;
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

class MockStereoAudioContext extends MockAudioContext {
  public createChannelSplitter(outputs: number): MockChannelSplitterNode {
    return new MockChannelSplitterNode(outputs);
  }
}

/** Seno de 8 bits con la amplitud indicada (127 ≈ 0 dBFS). */
const sine = (amplitude: number) =>
  new Array(128).fill(0).map((_, i) => Math.round(128 + amplitude * Math.sin((i / 128) * 2 * Math.PI)));

type EngineInternals = {
  masterStereoTap: { upmix: MockGainNode; splitter: MockChannelSplitterNode; left: MockAnalyserNode; right: MockAnalyserNode } | null;
  deckTransports: Map<string, { isPlaying: boolean }>;
};
const internals = () => audioEngine as unknown as EngineInternals;

describe('Mixer — vúmetro Master estéreo (motor)', () => {
  const originalWindow = globalThis.window;

  afterEach(async () => {
    await audioEngine.dispose();
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  describe('con ChannelSplitter', () => {
    beforeEach(async () => {
      (globalThis as unknown as { window: unknown }).window = { AudioContext: MockStereoAudioContext };
      await audioEngine.initialize();
    });

    it('deriva el Master tras el volumen a dos analizadores L / R sin tocar la salida', () => {
      const tap = internals().masterStereoTap;
      assert.ok(tap, 'Debe existir la derivación estéreo');
      const masterGain = audioEngine.getMasterGraph().masterGainNode as unknown as MockGainNode;
      assert.ok(masterGain.connectedTo.includes(tap.upmix), 'El Master alimenta la derivación');
      // Una pista mono llega igual a ambos lados: mezcla "speakers" fijada a dos canales
      assert.equal(tap.upmix.channelCount, 2);
      assert.equal(tap.upmix.channelCountMode, 'explicit');
      assert.equal(tap.upmix.channelInterpretation, 'speakers');
      assert.deepEqual(tap.upmix.connectedTo, [tap.splitter]);
      assert.equal(tap.splitter.numberOfOutputs, 2);
      assert.deepEqual(tap.splitter.connectedTo, [tap.left, tap.right]);
      assert.deepEqual(tap.splitter.outputs, [0, 1]);
      assert.deepEqual(tap.left.connectedTo, [], 'El analizador L no alimenta la salida');
      assert.deepEqual(tap.right.connectedTo, [], 'El analizador R no alimenta la salida');
    });

    it('mide cada canal por separado y cae a 0 cuando nada suena', () => {
      const tap = internals().masterStereoTap!;
      tap.left.testData = sine(100);
      tap.right.testData = sine(50);
      assert.deepEqual(audioEngine.getMasterStereoVUMeter(), { left: 0, right: 0 });

      internals().deckTransports.get('A')!.isPlaying = true;
      const level = audioEngine.getMasterStereoVUMeter();
      assert.ok(level.left >= 70 && level.left <= 85, `L ≈ 78, obtenido ${level.left}`);
      assert.ok(level.right >= 30 && level.right <= 45, `R ≈ 39, obtenido ${level.right}`);
      assert.ok(level.left > level.right);
    });

    it('al liberar el motor desconecta la derivación', async () => {
      const tap = internals().masterStereoTap!;
      await audioEngine.dispose();
      assert.equal(internals().masterStereoTap, null);
      for (const node of [tap.upmix, tap.splitter, tap.left, tap.right]) assert.equal(node.disconnected, true);
    });
  });

  describe('sin ChannelSplitter', () => {
    beforeEach(async () => {
      (globalThis as unknown as { window: unknown }).window = { AudioContext: MockAudioContext };
      await audioEngine.initialize();
    });

    it('ambas barras repiten el nivel mono del Master', () => {
      assert.equal(internals().masterStereoTap, null);
      const analyser = audioEngine.getMasterGraph().masterAnalyserNode as unknown as MockAnalyserNode;
      analyser.testData = sine(100);
      internals().deckTransports.get('B')!.isPlaying = true;
      const mono = audioEngine.getMasterVUMeter();
      assert.ok(mono > 0);
      assert.deepEqual(audioEngine.getMasterStereoVUMeter(), { left: mono, right: mono });
    });
  });
});

describe('Mixer — modelo del panel', () => {
  it('LED de señal: verde con nivel, ámbar tenue en pausa, tono tenue cargando, apagado sin pista', () => {
    const base = { hasTrack: true, playbackState: 'playing' as const, isPlaying: true };
    const live = getChannelSignal({ ...base, level: SIGNAL_THRESHOLD });
    assert.equal(live.stateKey, 'playing');
    assert.equal(live.hasSignal, true);
    assert.deepEqual(live.led, { on: true, color: 'green', dim: false });
    assert.equal(live.signalMessage.key, 'mixer.signal_present');

    const quiet = getChannelSignal({ ...base, level: SIGNAL_THRESHOLD - 0.5 });
    assert.equal(quiet.hasSignal, false);
    assert.equal(quiet.led.on, false);

    const paused = getChannelSignal({ hasTrack: true, playbackState: 'paused', isPlaying: false, level: 0 });
    assert.equal(paused.stateKey, 'paused');
    assert.deepEqual(paused.led, { on: true, color: 'amber', dim: true });
    assert.equal(paused.stateMessage.key, 'mixer.state_paused');

    const loading = getChannelSignal({ hasTrack: true, playbackState: 'loading', isPlaying: false, level: 0 });
    assert.deepEqual(loading.led, { on: true, color: 'tone', dim: true });

    const empty = getChannelSignal({ hasTrack: false, playbackState: 'stopped', isPlaying: false, level: 0 });
    assert.equal(empty.stateKey, 'empty');
    assert.equal(empty.led.on, false);
    assert.equal(empty.signalMessage.key, 'mixer.signal_absent');
  });

  it('FILTER: paso bajo a la izquierda, neutro al centro, paso alto a la derecha', () => {
    assert.deepEqual(getFilterValueText(0), { key: 'mixer.filter_lpf_value', values: { value: 100 } });
    assert.deepEqual(getFilterValueText(25), { key: 'mixer.filter_lpf_value', values: { value: 50 } });
    assert.deepEqual(getFilterValueText(50), { key: 'mixer.filter_off' });
    assert.deepEqual(getFilterValueText(100), { key: 'mixer.filter_hpf_value', values: { value: 100 } });
  });

  it('niveles efectivos: recortados a 0–100 y a 0 sin reproducción o con MUTE', () => {
    const levels = getEffectiveLevels({
      isPlayingA: true,
      isPlayingB: true,
      isMasterMuted: false,
      levelA: 140,
      levelB: -3,
      master: { left: Number.NaN, right: 55 },
    });
    assert.deepEqual(levels, { a: 100, b: 0, master: { left: 0, right: 55 } });
    assert.equal(CLIP_LEVEL, 95, 'El segmento rojo superior se enciende desde 95');
  });

  it('`← A` / `B →` siguen la ganancia real de la curva activa', () => {
    for (const curve of ['constant-power', 'linear', 'cut'] as const) {
      for (const position of [0, 25, 50, 75, 100]) {
        const gains = calculateCrossfaderGains(position / 100, curve);
        assert.deepEqual(getCrossfaderSideLights(position, curve), { a: gains.gainA, b: gains.gainB });
      }
    }
    assert.deepEqual(getCrossfaderSideLights(0, 'linear'), { a: 1, b: 0 });
    assert.deepEqual(getCrossfaderSideLights(100, 'linear'), { a: 0, b: 1 });
  });

  it('las teclas de curva son CP · LIN · CUT, en ese orden', () => {
    assert.deepEqual(CURVE_BUTTONS.map((c) => c.id), ['constant-power', 'linear', 'cut']);
  });
});

describe('Mixer — disposición e i18n', () => {
  const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');
  const organism = read('src/components/dj/organisms/MixerConsole.tsx');
  const channel = read('src/components/dj/molecules/MixerChannelStrip.tsx');
  const master = read('src/components/dj/molecules/MixerMasterStrip.tsx');
  const xfader = read('src/components/dj/molecules/MixerCrossfader.tsx');

  const inOrder = (code: string, needles: string[], what: string) => {
    let from = 0;
    for (const needle of needles) {
      const at = code.indexOf(needle, from);
      assert.ok(at >= 0, `${what}: falta o está fuera de orden ${needle}`);
      from = at + needle.length;
    }
  };

  it('tres columnas CH 1 | MASTER | CH 2 y el crossfader debajo', () => {
    inOrder(organism, ['<MixerChannelStrip\n          deckId="A"', '<MixerMasterStrip', '<MixerChannelStrip\n          deckId="B"', '<MixerCrossfader'], 'Mixer');
  });

  it('canal: cabecera con LED, GAIN · HI · MID · LOW · FILTER, CUE y fader con vúmetro', () => {
    inOrder(channel, [
      "t('mixer.channel', { num })",
      'mixer-channel__name',
      '<ConsoleLed on={signal.led.on}',
      "knob('gain'",
      "knob('hi'",
      "knob('mid'",
      "knob('low'",
      "label={t('mixer.filter')}",
      'mixer-channel__cue',
      '<ConsoleFader',
      '<LevelMeter',
    ], 'Canal');
    assert.match(channel, /startLabel=\{t\('mixer\.filter_lpf'\)\}/);
    assert.match(channel, /endLabel=\{t\('mixer\.filter_hpf'\)\}/);
    // Sin la letra del deck en la cabecera ni etiqueta VOL en el fader
    assert.doesNotMatch(channel, /channel-deck-badge|\{deckId\}<\/span>|mixer\.vol\b/);
    // Cabecera: el LED conserva su tooltip y el texto para lectores de pantalla
    assert.match(channel, /title=\{stateText\}/);
    assert.match(channel, /sd-visually-hidden">\{stateText\}/);
  });

  it('MASTER: pomo sin serigrafía ni reset, vúmetro estéreo y MUTE; sin espectro', () => {
    inOrder(master, ['mixer-master__name', '<ConsoleKnob', 'mixer-master__meter', 'level.left', 'level.right', '<ConsoleKey'], 'Master');
    const knob = master.slice(master.indexOf('<ConsoleKnob'), master.indexOf('/>', master.indexOf('<ConsoleKnob')));
    assert.doesNotMatch(knob, /\slabel=|defaultValue|bipolar/);
    assert.match(knob, /size="master"/);
    assert.doesNotMatch(readMixerSource(), /spectrum|readMasterSpectrum|console_title|status_live|status_standby/);
  });

  it('crossfader: `← A` y `B →` en texto, sin etiqueta, y las curvas debajo', () => {
    inOrder(xfader, ['← A', '<ConsoleFader', 'B →', 'CURVE_BUTTONS.map'], 'Crossfader');
    assert.doesNotMatch(xfader, /crossfader_title|mixer-control-label-curve/);
    assert.match(xfader, /ticks=\{CROSSFADER_TICKS\}/);
    assert.match(xfader, /const CROSSFADER_TICKS = \[0, 0\.25, 0\.5, 0\.75, 1\]/);
  });

  it('EN VIVO / LIVE sale del mixer y queda junto a la pantalla, con texto fijo', () => {
    const consoleCode = read('src/components/dj/organisms/DJConsole.tsx');
    const live = read('src/components/dj/molecules/ConsoleLiveIndicator.tsx');
    assert.match(consoleCode, /<ConsoleLiveIndicator/);
    assert.doesNotMatch(organism, /ConsoleLiveIndicator|isLive/);
    assert.match(live, /\{t\('mixer\.live'\)\}/);
    assert.match(live, /<ConsoleLed on=\{isLive\} color="red" \/>/);
  });

  it('el mixer usa la placa de plástico de los decks, no el panel de aluminio', () => {
    const css = read('src/components/dj/organisms/MixerConsole.css');
    assert.match(css, /background: var\(--console-plate\)/);
    assert.doesNotMatch(css, /--console-panel|--console-texture|brushed/);
    const theme = read('src/components/dj/consoleTheme.css');
    assert.doesNotMatch(theme, /--console-panel|--console-recess|--console-ink/);
  });

  it('los textos del mixer existen en español e inglés y los retirados ya no están', () => {
    const es = JSON.parse(read('src/i18n/locales/es/translation.json')).mixer;
    const en = JSON.parse(read('src/i18n/locales/en/translation.json')).mixer;
    for (const key of ['channel', 'master', 'gain', 'high', 'mid', 'low', 'filter', 'filter_lpf', 'filter_hpf', 'cue_pfl', 'mute', 'curve', 'curve_cp_short', 'curve_lin_short', 'curve_cut_short', 'live', 'live_on', 'live_off', 'meter_master', 'meter_master_left', 'meter_master_right', 'crossfader_label', 'crossfader_value']) {
      assert.equal(typeof es[key], 'string', `es mixer.${key}`);
      assert.equal(typeof en[key], 'string', `en mixer.${key}`);
    }
    assert.equal(es.live, 'EN VIVO');
    assert.equal(en.live, 'LIVE');
    for (const removed of ['console_title', 'status_live', 'status_standby', 'spectrum_label', 'no_signal', 'crossfader_title', 'crossfader']) {
      assert.equal(es[removed], undefined, `es mixer.${removed}`);
      assert.equal(en[removed], undefined, `en mixer.${removed}`);
    }
  });
});
