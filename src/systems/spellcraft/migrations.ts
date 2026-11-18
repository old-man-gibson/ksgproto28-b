// Slice migrations for the spellcraft system. Pure JSON to JSON. This file may
// hold `import type` statements only; a test enforces it. Ids and numbers a
// step needs are written here as literals.
import type { Json } from '../../kernel/json';

type Obj = { [key: string]: Json };

/** Step N takes slice data at version N to version N + 1. */
export const migrations: Record<number, (data: Json) => Json> = {
  /** Step 3 of the rebuild (arcane): the clock of casting outside a fight. */
  1: (data) => ({ ...(data as Obj), utilityReady: {} }),
};
