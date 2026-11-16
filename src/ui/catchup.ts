import { catchUp, type SaveEnvelope } from '../kernel';
import { systems } from '../systems';
import type { CatchUpReply, CatchUpRequest } from '../worker/messages';

/**
 * Run offline catch-up in the worker and resolve with the new envelope. When
 * a worker cannot be created the same function runs on the main thread.
 */
export function runCatchUp(request: CatchUpRequest, onProgress: (done: number) => void): Promise<SaveEnvelope> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../worker/catchup.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      try {
        resolve(catchUp({ systems, ...request, onProgress }));
      } catch (err) {
        reject(err);
      }
      return;
    }
    worker.onmessage = (event: MessageEvent<CatchUpReply>) => {
      const message = event.data;
      if (message.kind === 'progress') return onProgress(message.done);
      worker.terminate();
      if (message.kind === 'done') resolve(message.envelope);
      else reject(new Error(message.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'the catch-up worker failed to start'));
    };
    worker.postMessage(request);
  });
}
