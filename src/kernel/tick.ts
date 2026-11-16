/** Logic ticks per second. One tick is 100 ms of game time. */
export const TPS = 10;
export const MS_PER_TICK = 1000 / TPS;

/** The most ticks one frame may run. A longer gap goes to catch-up instead. */
export const MAX_TICKS_PER_FRAME = 30;

/** The longest gap that offline catch-up simulates. */
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;

/**
 * Fixed-timestep accumulator. The frame driver feeds it elapsed wall-clock
 * time; it answers how many ticks to run. When a frame owes more than the cap,
 * it returns the cap and drops the remainder, so a stalled tab cannot queue an
 * unbounded burst.
 */
export class TickAccumulator {
  private acc = 0;

  constructor(private readonly maxTicksPerFrame = MAX_TICKS_PER_FRAME) {}

  advance(elapsedMs: number): number {
    if (!(elapsedMs > 0)) return 0;
    this.acc += elapsedMs;
    let ticks = Math.floor(this.acc / MS_PER_TICK);
    this.acc -= ticks * MS_PER_TICK;
    if (ticks > this.maxTicksPerFrame) {
      ticks = this.maxTicksPerFrame;
      this.acc = 0;
    }
    return ticks;
  }

  reset(): void {
    this.acc = 0;
  }
}

/** Ticks owed for a gap of wall-clock time, capped. */
export function offlineTicks(elapsedMs: number, capMs = OFFLINE_CAP_MS): number {
  if (!(elapsedMs > 0)) return 0;
  return Math.floor(Math.min(elapsedMs, capMs) / MS_PER_TICK);
}
