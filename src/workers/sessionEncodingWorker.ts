/**
 * SYSTEM DJ — Session export encoding Worker (ESM).
 *
 * Rendering stays on the main thread because dedicated Workers do not expose a
 * reliable OfflineAudioContext. WAV/MP3 encoding is CPU-heavy and runs here.
 */

import { createEncodingWorkerHandler } from '../session/EncodingWorkerHandler.ts';
import type { EncodingWorkerResponse } from '../session/EncodingProtocol.ts';

interface DedicatedWorkerContext {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: EncodingWorkerResponse, transfer?: Transferable[]) => void;
}

const workerCtx = (typeof self !== 'undefined' ? self : globalThis) as unknown as DedicatedWorkerContext;

workerCtx.onmessage = createEncodingWorkerHandler((message, transfer) => {
  if (transfer) workerCtx.postMessage(message, transfer);
  else workerCtx.postMessage(message);
});
