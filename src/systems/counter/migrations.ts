// Slice migrations for the counter system. Pure JSON to JSON. This file may
// hold `import type` statements only; a test enforces it. Ids and numbers a
// step needs are written here as literals, so a later content edit cannot
// change what an old step does.
import type { Json } from '../../kernel/json';

type Obj = { [key: string]: Json };

export const migrations: Record<number, (data: Json) => Json> = {
  // Version 1: { value, level }. Version 2: { count, owned, milestones, lucky }.
  // `level` was the number of small steps owned, the only step at the time.
  1: (data) => {
    const old = data as Obj;
    const level = typeof old.level === 'number' ? old.level : 0;
    const owned: Obj = {};
    if (level > 0) owned['small_step'] = level;
    return {
      count: typeof old.value === 'number' ? old.value : 0,
      owned,
      milestones: 0,
      lucky: 0,
    };
  },
};
