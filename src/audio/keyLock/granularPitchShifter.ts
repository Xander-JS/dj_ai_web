/**
 * SYSTEM DJ — KEY LOCK: desplazador de tono granular
 *
 * El deck sigue variando la velocidad con `AudioBufferSourceNode.playbackRate`, que también sube o
 * baja el tono. Con KEY LOCK la señal pasa por este desplazador, que aplica el factor inverso
 * (1 / velocidad) y devuelve las notas a su tonalidad original sin tocar la duración.
 *
 * Técnica: línea de retardo con dos cabezales de lectura desfasados medio ciclo. El retardo de cada
 * cabezal varía a ritmo constante (eso cambia el tono, como el efecto Doppler) y, al llegar al
 * final de la ventana, salta al principio mientras su ganancia es cero. Las ganancias son sin² y
 * cos² de la fase, así que suman siempre 1 y el nivel no oscila.
 *
 * Con factor 1 (fader en el centro) la fase se desliza despacio hasta que solo suena un cabezal:
 * así no queda el filtro peine de dos copias con distinto retardo sumadas. Latencia típica: media
 * ventana.
 *
 * Es código puro (sin Web Audio) para poder probarlo en Node; el AudioWorklet solo lo envuelve.
 */

/** Nombre con el que se registra el AudioWorkletProcessor de KEY LOCK. */
export const KEY_LOCK_PROCESSOR_NAME = 'system-dj-key-lock';

/** Ventana de grano por defecto: compromiso entre graves limpios y latencia (≈ 20 ms). */
export const KEY_LOCK_WINDOW_SECONDS = 0.04;

/** Por debajo de esta desviación del factor 1 se considera que no hay desplazamiento. */
const UNITY_EPSILON = 1e-4;

/** Desafinación máxima al recolocar la fase con factor 1 (0,3 % ≈ 5 cents, inaudible en mezcla). */
const UNITY_SETTLE_DETUNE = 0.003;

function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) size <<= 1;
  return size;
}

export class GranularPitchShifter {
  private readonly windowSamples: number;
  private readonly mask: number;
  private readonly buffers: Float32Array[];
  private writeIndex = 0;
  /** Fase del cabezal 1 en [0, 1); el cabezal 2 va medio ciclo por delante. */
  private phase = 0.5;

  public constructor(sampleRate: number, channelCount: number, windowSeconds = KEY_LOCK_WINDOW_SECONDS) {
    this.windowSamples = Math.max(16, Math.round(sampleRate * windowSeconds));
    const size = nextPowerOfTwo(this.windowSamples + 4);
    this.mask = size - 1;
    this.buffers = Array.from({ length: Math.max(1, channelCount) }, () => new Float32Array(size));
  }

  /** Latencia con factor 1, en muestras (un cabezal a media ventana). */
  public get latencySamples(): number {
    return 1 + this.windowSamples / 2;
  }

  /** Vacía la línea de retardo (al cambiar de pista o reconectar la fuente). */
  public reset(): void {
    for (const buffer of this.buffers) buffer.fill(0);
    this.writeIndex = 0;
    this.phase = 0.5;
  }

  /**
   * Procesa `frames` muestras. `pitch` es el factor de tono que se quiere aplicar (1 / velocidad del
   * deck). Los canales que falten en la entrada se tratan como silencio.
   */
  public process(inputs: ReadonlyArray<Float32Array | undefined>, outputs: Float32Array[], frames: number, pitch: number): void {
    const safePitch = Number.isFinite(pitch) && pitch > 0 ? pitch : 1;
    const window = this.windowSamples;
    const atUnity = Math.abs(safePitch - 1) < UNITY_EPSILON;
    const phaseStep = (1 - safePitch) / window;
    const settleStep = UNITY_SETTLE_DETUNE / window;
    const channels = Math.min(this.buffers.length, outputs.length);

    for (let i = 0; i < frames; i++) {
      for (let ch = 0; ch < this.buffers.length; ch++) {
        const input = inputs[ch] ?? inputs[0];
        this.buffers[ch][this.writeIndex] = input ? input[i] ?? 0 : 0;
      }

      const phase1 = this.phase;
      const phase2 = phase1 + 0.5 >= 1 ? phase1 - 0.5 : phase1 + 0.5;
      const s = Math.sin(Math.PI * phase1);
      const gain1 = s * s;
      const gain2 = 1 - gain1;
      const delay1 = 1 + phase1 * window;
      const delay2 = 1 + phase2 * window;

      for (let ch = 0; ch < channels; ch++) {
        const buffer = this.buffers[ch];
        outputs[ch][i] = gain1 * this.read(buffer, delay1) + gain2 * this.read(buffer, delay2);
      }

      if (atUnity) {
        // Llevar la fase al punto más cercano en el que un solo cabezal suena a ganancia plena
        const target = phase1 < 0.25 ? 0 : phase1 < 0.75 ? 0.5 : 1;
        const distance = target - phase1;
        this.phase = Math.abs(distance) <= settleStep ? target : phase1 + Math.sign(distance) * settleStep;
      } else {
        this.phase = phase1 + phaseStep;
      }
      if (this.phase >= 1) this.phase -= 1;
      else if (this.phase < 0) this.phase += 1;

      this.writeIndex = (this.writeIndex + 1) & this.mask;
    }

    // Canales de salida sin entrada propia: copia del primero
    for (let ch = channels; ch < outputs.length; ch++) outputs[ch].set(outputs[0].subarray(0, frames));
  }

  /** Lectura con interpolación lineal `delay` muestras por detrás de la última escrita. */
  private read(buffer: Float32Array, delay: number): number {
    const position = this.writeIndex - delay;
    const base = Math.floor(position);
    const frac = position - base;
    const a = buffer[base & this.mask];
    const b = buffer[(base + 1) & this.mask];
    return a + (b - a) * frac;
  }
}
