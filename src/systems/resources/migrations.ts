// Slice migrations for the resources system. Pure JSON to JSON. This file may
// hold `import type` statements only; a test enforces it. Ids and numbers a
// step needs are written here as literals.
import type { Json } from '../../kernel/json';

/** Step N takes slice data at version N to version N + 1. */
export const migrations: Record<number, (data: Json) => Json> = {
  // Version 2 (spine port 4): `pace.inCombat`. A fight is not carried over
  // from a version 1 save, because no version 1 build had one.
  1: (data) => {
    const slice = data as { pace: Record<string, Json> };
    return { ...slice, pace: { ...slice.pace, inCombat: false } } as Json;
  },
};
