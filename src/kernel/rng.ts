/**
 * Seeded random generator (mulberry32). The generator holds no state of its
 * own: it reads and writes one unsigned 32-bit number through the cell it is
 * given, and the kernel points that cell at game state. Saving the state
 * therefore saves the generator.
 */
export interface RngCell {
  get(): number;
  set(value: number): void;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
}

export function createRng(cell: RngCell): Rng {
  const next = (): number => {
    const s = (cell.get() + 0x6d2b79f5) >>> 0;
    cell.set(s);
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
  };
}

/** Any number to a valid generator state. */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.floor(seed) >>> 0 : 0;
}
