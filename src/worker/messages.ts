import type { SaveEnvelope, ScheduledCommand } from '../kernel';

/** Main thread to catch-up worker. Plain JSON. */
export interface CatchUpRequest {
  envelope: SaveEnvelope;
  ticks: number;
  commands?: ScheduledCommand[];
  /** Wall-clock time to stamp on the returned envelope. */
  now: number;
}

/** Catch-up worker to main thread. */
export type CatchUpReply =
  | { kind: 'progress'; done: number }
  | { kind: 'done'; envelope: SaveEnvelope }
  | { kind: 'error'; error: string };
