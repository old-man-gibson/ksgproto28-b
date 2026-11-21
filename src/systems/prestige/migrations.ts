// Slice migrations for the prestige system. Pure JSON to JSON. This file may
// hold `import type` statements only; a test enforces it. Ids and numbers a
// step needs are written here as literals.
import type { Json } from '../../kernel/json';

type Obj = { [key: string]: Json };

/** Step N takes slice data at version N to version N + 1. */
export const migrations: Record<number, (data: Json) => Json> = {
  /** Step 4 port C2: the stronghold of floor 11 in the legacy. No run before it held the wall. */
  1: (data) => ({ ...(data as Obj), stronghold: false }),
};
