/**
 * SYSTEM DJ — KEY LOCK: carga del módulo AudioWorklet (solo navegador).
 * Se importa de forma dinámica desde el motor para que Node (pruebas) nunca resuelva `?worker&url`.
 */

import processorUrl from './keyLockProcessor.ts?worker&url';

export async function addKeyLockModule(ctx: BaseAudioContext): Promise<void> {
  await ctx.audioWorklet.addModule(processorUrl);
}
