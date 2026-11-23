// Slice migrations for the festival system. Pure JSON to JSON. This file may
// hold `import type` statements only; a test enforces it. Ids and numbers a
// step needs are written here as literals.
import type { Json } from '../../kernel/json';

/** Step N takes slice data at version N to version N + 1. */
export const migrations: Record<number, (data: Json) => Json> = {
  // Version 2 (step 4 port C5): the player's royale plan, empty (the default
  // plan). A version 1 attempt has no field: the royale opens one on its
  // first tick on the arena.
  1: (data) => ({ ...(data as Record<string, Json>), plan: [] }),
};
