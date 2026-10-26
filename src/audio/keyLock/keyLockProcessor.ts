/**
 * SYSTEM DJ — KEY LOCK: AudioWorkletProcessor
 * Corre en el hilo de audio. Recibe en `rate` la misma velocidad que el `playbackRate` de la
 * fuente del deck (el motor programa ambos parámetros a la vez) y desplaza el tono por 1 / rate.
 * Vite lo empaqueta como script independiente (`?worker&url`, ver keyLockModule.ts).
 */

import { GranularPitchShifter, KEY_LOCK_PROCESSOR_NAME } from './granularPitchShifter.ts';

// Ámbito global de AudioWorklet: no forma parte de la librería DOM de TypeScript
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class KeyLockProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'rate', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }

  private shifter: GranularPitchShifter | null = null;

  public constructor() {
    super();
    // El motor pide vaciar la línea de retardo al reconectar la fuente (seek, cambio de pista)
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === 'reset') this.shifter?.reset();
    };
  }

  public process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const input = inputs[0] ?? [];
    if (!this.shifter) this.shifter = new GranularPitchShifter(sampleRate, output.length);
    const rate = parameters.rate?.[0] ?? 1;
    this.shifter.process(input, output, output[0].length, 1 / rate);
    return true;
  }
}

registerProcessor(KEY_LOCK_PROCESSOR_NAME, KeyLockProcessor);
