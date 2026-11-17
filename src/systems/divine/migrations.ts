// Slice migrations for the divine system. Pure JSON to JSON. This file may
// hold `import type` statements only; a test enforces it. Ids and numbers a
// step needs are written here as literals.
import type { Json } from '../../kernel/json';

/** Step N takes slice data at version N to version N + 1. */
export const migrations: Record<number, (data: Json) => Json> = {};
