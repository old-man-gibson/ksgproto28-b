/**
 * Offline catch-up in a Web Worker. It calls `catchUp`, the same function the
 * tests call, over the same system list the page uses. State goes in and
 * comes out as a save envelope; there is no other hand-over step.
 */
import { catchUp } from '../kernel';
import { systems } from '../systems';
import type { CatchUpReply, CatchUpRequest } from './messages';

const reply = (message: CatchUpReply) => self.postMessage(message);

self.onmessage = (event: MessageEvent<CatchUpRequest>) => {
  try {
    const envelope = catchUp({
      systems,
      ...event.data,
      onProgress: (done) => reply({ kind: 'progress', done }),
    });
    reply({ kind: 'done', envelope });
  } catch (err) {
    reply({ kind: 'error', error: (err as Error).message });
  }
};
