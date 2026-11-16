// Migrations of the kernel's own slice ({ tick, rng }). Same rule as a
// system's migrations.ts: pure JSON to JSON, and no imports other than
// `import type`. A test enforces the rule. Step N takes version N to N + 1.
import type { Json } from './json';

export const KERNEL_SLICE_VERSION = 1;

export const kernelMigrations: Record<number, (data: Json) => Json> = {};
