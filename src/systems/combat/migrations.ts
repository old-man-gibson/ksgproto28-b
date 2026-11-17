// Slice migrations for the combat system. Pure JSON to JSON. This file may
// hold `import type` statements only; a test enforces it. Ids and numbers a
// step needs are written here as literals.
import type { Json } from '../../kernel/json';

/** Step N takes slice data at version N to version N + 1. */
export const migrations: Record<number, (data: Json) => Json> = {
  // Version 2 (spine port 5): the player's triggers per rotation id, and the
  // buffs of an open fight.
  1: (data) => {
    const slice = data as { [key: string]: Json };
    const fight = slice.fight as { [key: string]: Json } | null;
    return {
      ...slice,
      fight: fight ? { ...fight, buffs: [] } : null,
      triggers: {},
    };
  },
};
