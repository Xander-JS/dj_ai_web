/**
 * SYSTEM DJ — FASE 21, ETAPA 5: Vúmetros RMS Reales en Tiempo Real
 * Pruebas automatizadas para verificar:
 * 1. El nivel del canal A procede del método real del motor (audioEngine.getDeckVUMeter('A')).
 * 2. El nivel del canal B procede del método real del motor (audioEngine.getDeckVUMeter('B')).
 * 3. El nivel Master procede de la medición Master del motor (audioEngine.getMasterVUMeter()).
 * 4. La posición del crossfader no anula artificialmente el vúmetro pre-crossfader.
 * 5. La visualización muestra correctamente un nivel cero en reposo.
 * 6. Los valores visuales fuera de rango se normalizan y clipean de forma segura [0, 100].
 * 7. La actualización reactiva se activa y detiene según el estado de reproducción activa.
 * 8. El temporizador o animación se limpia al desmontar o detener.
 * 9. Ausencia total de Math.random() y ausencia de publicaciones a 30 Hz en el store global.
 * 10. La consola conserva intacta toda la funcionalidad de controles de la Etapa 4.
 */

import 'fake-indexeddb/auto';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { djStore } from '../src/store/useDJStore.ts';
import { audioEngine } from '../src/audio/index.ts';
import { getEffectiveLevels } from '../src/services/console/mixerPanelModel.ts';
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
  public connectedTo: MockAudioNode[] = [];
  public connect(target: MockAudioNode): MockAudioNode {
    this.connectedTo.push(target);
    return target;
  }
  public disconnect(): void {
    this.connectedTo = [];
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
  public fftSize = 256;
  public frequencyBinCount = 128;
  public smoothingTimeConstant = 0.8;
  public testData: number[] | null = null;

  public getByteTimeDomainData(arr: Uint8Array): void {
    if (this.testData) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = this.testData[i % this.testData.length];
      }
    } else {
      arr.fill(128); // 128 = silencio centrado en 8 bits (0 V)
    }
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

describe('Fase 21 Etapa 5 — Vúmetros RMS Reales en Tiempo Real', () => {
  const originalWindow = globalThis.window;

  beforeEach(async () => {
    (globalThis as unknown as { window: unknown }).window = {
      AudioContext: MockAudioContext,
    };
    await audioEngine.initialize();

    // Restablecer valores iniciales nominales
    djStore.setChannelGain('A', 50);
    djStore.setChannelGain('B', 50);
    djStore.setChannelVolume('A', 80);
    djStore.setChannelVolume('B', 80);
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

  test('1. El nivel del canal A procede del método real del motor (audioEngine.getDeckVUMeter("A"))', () => {
    const graphA = audioEngine.getDeckAudioGraph('A');
    const analyserA = graphA.analyserNode as unknown as MockAnalyserNode;

    // Simular que Deck A está reproduciendo con una señal senoidal a 0 dBFS (picos ±127 -> [1, 255])
    // RMS puro de seno = 1 / sqrt(2) ≈ 0.7071
    const sineWaveData = new Array(128).fill(0).map((_, i) => {
      const angle = (i / 128) * 2 * Math.PI;
      return Math.round(128 + 127 * Math.sin(angle));
    });
    analyserA.testData = sineWaveData;

    // Con el transporte detenido, getDeckRMS retorna 0
    assert.equal(audioEngine.getDeckRMS('A'), 0);
    assert.equal(audioEngine.getDeckVUMeter('A'), 0);

    // Con transporte activo en Deck A
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (audioEngine as any).deckTransports.get('A').isPlaying = true;

    const rmsA = audioEngine.getDeckRMS('A');
    assert.ok(rmsA > 0.69 && rmsA < 0.72, `RMS debe ser ~0.7071, obtenido: ${rmsA}`);

    const vuA = audioEngine.getDeckVUMeter('A');
    assert.ok(vuA >= 95 && vuA <= 100, `Nivel visual de canal A debe alcanzar ~99%, obtenido: ${vuA}`);
  });

  test('2. El nivel del canal B procede del método real del motor (audioEngine.getDeckVUMeter("B"))', () => {
    const graphB = audioEngine.getDeckAudioGraph('B');
    const analyserB = graphB.analyserNode as unknown as MockAnalyserNode;

    // Señal a media amplitud (picos ±64 -> RMS ≈ 0.3535)
    analyserB.testData = new Array(128).fill(0).map((_, i) => {
      const angle = (i / 128) * 2 * Math.PI;
      return Math.round(128 + 64 * Math.sin(angle));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (audioEngine as any).deckTransports.get('B').isPlaying = true;

    const rmsB = audioEngine.getDeckRMS('B');
    assert.ok(rmsB > 0.34 && rmsB < 0.37, `RMS debe ser ~0.3535, obtenido: ${rmsB}`);

    const vuB = audioEngine.getDeckVUMeter('B');
    assert.ok(vuB >= 45 && vuB <= 55, `Nivel visual de canal B debe ser ~50%, obtenido: ${vuB}`);
  });

  test('3. El nivel Master procede de la medición Master del motor (audioEngine.getMasterVUMeter())', () => {
    const master = audioEngine.getMasterGraph();
    const masterAnalyser = master.masterAnalyserNode as unknown as MockAnalyserNode;

    masterAnalyser.testData = new Array(128).fill(0).map((_, i) => {
      const angle = (i / 128) * 2 * Math.PI;
      return Math.round(128 + 100 * Math.sin(angle));
    });

    // Si ningún deck reproduce, getMasterVUMeter es 0
    assert.equal(audioEngine.getMasterRMS(), 0);
    assert.equal(audioEngine.getMasterVUMeter(), 0);

    // Al reproducir al menos un deck
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (audioEngine as any).deckTransports.get('A').isPlaying = true;

    const masterRms = audioEngine.getMasterRMS();
    assert.ok(masterRms > 0.5, `RMS Master debe ser positivo, obtenido: ${masterRms}`);

    const masterVu = audioEngine.getMasterVUMeter();
    assert.ok(masterVu >= 70 && masterVu <= 85, `Master VU debe calcularse proporcionalmente, obtenido: ${masterVu}`);
  });

  test('4. La posición del crossfader no anula artificialmente el vúmetro pre-crossfader de canal', () => {
    const graphA = audioEngine.getDeckAudioGraph('A');
    const analyserA = graphA.analyserNode as unknown as MockAnalyserNode;

    analyserA.testData = new Array(128).fill(0).map((_, i) => {
      const angle = (i / 128) * 2 * Math.PI;
      return Math.round(128 + 127 * Math.sin(angle));
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (audioEngine as any).deckTransports.get('A').isPlaying = true;

    // Crossfader al 100% en B (A atenuado al 100% en la mezcla de salida)
    audioEngine.setCrossfader(100, 'constant-power');

    // El vúmetro de A sigue midiendo la señal antes del crossfader
    const vuA = audioEngine.getDeckVUMeter('A');
    assert.ok(vuA > 90, `El vúmetro de canal A no debe anularse con el crossfader en B, obtenido: ${vuA}`);
  });

  test('5. La visualización muestra correctamente un nivel cero en estado detenido o sin señal', () => {
    // Señal plana de silencio (128)
    const graphA = audioEngine.getDeckAudioGraph('A');
    const analyserA = graphA.analyserNode as unknown as MockAnalyserNode;
    analyserA.testData = null; // silencio

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (audioEngine as any).deckTransports.get('A').isPlaying = true;

    assert.equal(audioEngine.getDeckRMS('A'), 0);
    assert.equal(audioEngine.getDeckVUMeter('A'), 0);
    assert.equal(audioEngine.getMasterRMS(), 0);
    assert.equal(audioEngine.getMasterVUMeter(), 0);
  });

  test('6. Los valores visuales fuera de rango se normalizan y clipean de forma segura [0, 100]', () => {
    // Cero o casi silencio
    assert.equal(audioEngine.rmsToVUMeterLevel(0), 0);
    assert.equal(audioEngine.rmsToVUMeterLevel(-0.5), 0);
    assert.equal(audioEngine.rmsToVUMeterLevel(0.00001), 0);

    // Señal extremadamente alta (distorsión masiva > +12 dBFS)
    assert.equal(audioEngine.rmsToVUMeterLevel(1.5), 100);
    assert.equal(audioEngine.rmsToVUMeterLevel(10.0), 100);

    // Señal nominal 0 dBFS (0.7071)
    const nominal = audioEngine.rmsToVUMeterLevel(0.7071);
    assert.equal(nominal, 99);
  });

  test('7. Eliminación definitiva de Math.random() en el mixer', () => {
    const consoleCode = readMixerSource();

    // No debe existir Math.random en el archivo
    assert.equal(consoleCode.includes('Math.random()'), false, 'MixerConsole.tsx no debe contener Math.random()');
    assert.equal(consoleCode.includes('VU_MIN_LEVEL'), false, 'MixerConsole.tsx no debe contener constantes simuladas VU_MIN_LEVEL');
    assert.equal(consoleCode.includes('VU_LEVEL_RANGE'), false, 'MixerConsole.tsx no debe contener constantes simuladas VU_LEVEL_RANGE');

    // Debe contener las llamadas directas al motor de audio
    assert.ok(consoleCode.includes('audioEngine.getDeckVUMeter'), 'Debe consultar getDeckVUMeter del motor');
    assert.ok(consoleCode.includes('audioEngine.getMasterStereoVUMeter'), 'Debe consultar el nivel Master L / R del motor');
  });

  test('8. Rendimiento: No se publican los niveles de 30 Hz en el store global', () => {
    const consoleCode = readMixerSource();

    // El store global no contiene propiedades de vúmetro de alta frecuencia
    assert.equal(consoleCode.includes('djStore.setVuLevel'), false, 'No debe publicar vúmetros en useDJStore');
    assert.equal(consoleCode.includes('setDeckVUMeter'), false, 'No debe llamar acciones globales de vúmetro');

    // Se usan estados locales useState(0) para las lecturas
    assert.ok(consoleCode.includes('const [vuA, setVuA] = useState(0)'), 'vuA debe ser estado local');
    assert.ok(consoleCode.includes('const [vuB, setVuB] = useState(0)'), 'vuB debe ser estado local');
    assert.ok(consoleCode.includes('const [vuMaster, setVuMaster] = useState<StereoLevel>(SILENT_STEREO)'), 'vuMaster (L / R) debe ser estado local');
  });

  test('9. Control de ciclo de vida: Animación y temporizadores se limpian y respetan el estado playing', () => {
    const consoleCode = readMixerSource();

    // Verifica que existe condición de salida si no hay reproducción activa
    assert.ok(consoleCode.includes('if (!isAnyPlaying)'), 'Debe detenerse si no hay reproducción activa');

    // Verifica la función de limpieza que cancela la animación
    assert.ok(consoleCode.includes('safeCancelAnimationFrame'), 'Debe cancelar la animación al desmontar o detener');

    // Los niveles efectivos se derivan del modelo puro: 0 en reposo y Master a 0 con MUTE
    assert.ok(consoleCode.includes('getEffectiveLevels({ isPlayingA, isPlayingB, isMasterMuted'), 'El mixer debe derivar los niveles efectivos');
    const loud = { levelA: 70, levelB: 60, master: { left: 80, right: 75 } };
    assert.deepEqual(
      getEffectiveLevels({ ...loud, isPlayingA: false, isPlayingB: false, isMasterMuted: false }),
      { a: 0, b: 0, master: { left: 0, right: 0 } },
      'Sin reproducción todos los niveles son 0'
    );
    assert.deepEqual(
      getEffectiveLevels({ ...loud, isPlayingA: true, isPlayingB: false, isMasterMuted: false }),
      { a: 70, b: 0, master: { left: 80, right: 75 } },
      'Canal B debe reportar 0 si no reproduce'
    );
    assert.deepEqual(
      getEffectiveLevels({ ...loud, isPlayingA: true, isPlayingB: true, isMasterMuted: true }).master,
      { left: 0, right: 0 },
      'Master debe reportar 0 con MUTE'
    );
  });

  test('10. La consola conserva intacta toda la funcionalidad de controles de la Etapa 4', () => {
    // Controles de canal y mixer siguen funcionando de manera reactiva y aislada
    djStore.setChannelGain('A', 75);
    djStore.setChannelEq('A', 'high', 60);
    djStore.setChannelFilter('A', 80);
    djStore.setChannelVolume('A', 90);
    djStore.setCuePfl('A', true);
    djStore.setCrossfader(35);
    djStore.setCrossfaderCurve('cut');
    djStore.setMasterVolume(95);

    const snap = djStore.getSnapshot();
    assert.equal(snap.mixer.channelA.gain, 75);
    assert.equal(snap.mixer.channelA.eq.high, 60);
    assert.equal(snap.mixer.channelA.eq.filter, 80);
    assert.equal(snap.mixer.channelA.volume, 90);
    assert.equal(snap.mixer.channelA.cuePfl, true);
    assert.equal(snap.mixer.crossfader, 35);
    assert.equal(snap.mixer.crossfaderCurve, 'cut');
    assert.equal(snap.mixer.masterVolume, 95);
    assert.equal(snap.masterVolume, 95);

    // Canal B intacto
    assert.equal(snap.mixer.channelB.gain, 50);
    assert.equal(snap.mixer.channelB.volume, 80);
  });
});
