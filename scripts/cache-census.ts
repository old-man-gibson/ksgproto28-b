// Counts, for one budget run, the touches per modifier source and the
// resolver runs per entity kind and variant. Diagnostics for the catch-up
// work (docs/KERNEL.md decision 32); it patches the Derived class in this
// process only. This only prints.
//
//   npx vite-node scripts/cache-census.ts -- world6

import { Derived } from '../src/kernel/derived';
import { RUNS, type RunName } from '../tests/budgetRuns';

const name = (process.argv.slice(2).filter((a) => a !== '--')[0] ?? 'world6') as RunName;
const touches = new Map<string, number>();
const runs = new Map<string, number>();
const kind = (entity?: string) => (entity === undefined ? '*' : entity === 'player' ? 'player' : 'other');
const proto = Derived.prototype as any;
const touch = proto.touch;
proto.touch = function (id: string, entity?: string) {
  const key = `${id} ${kind(entity)}`;
  touches.set(key, (touches.get(key) ?? 0) + 1);
  return touch.call(this, id, entity);
};
const compute = proto.compute;
proto.compute = function (r: number, entity: string, variant: string, mods: unknown) {
  const key = `${kind(entity)} ${variant === '' ? 'plain' : 'variant'}`;
  runs.set(key, (runs.get(key) ?? 0) + 1);
  return compute.call(this, r, entity, variant, mods);
};
const result = RUNS[name]();
console.log(`${name}: ${Math.round(result.ms)} ms`);
const show = (m: Map<string, number>) =>
  [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(String(v).padStart(9), k));
console.log('--- touches');
show(touches);
console.log('--- resolver runs (findStale included)');
show(runs);
