/**
 * One-off: writes tests/sitesOutside.json, the encounter tables of the old
 * spots that ported combat tests stand on and that are not in this
 * repository's content yet: the shelved countryside, the hold and floor 17.
 * The spots that are here are read from the world registry by
 * `tests/combatHelpers.ts`. Reads the old repository, writes nothing there.
 *
 * Usage: node scripts/dump-outside-sites.mjs
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = (process.env.OLD_REPO ?? 'D:/ksgproto28').split(String.fromCharCode(92)).join('/');

const SPOTS = [
  // The shelved countryside.
  'woods_edge',
  'ravine_floor',
  // The hold.
  'benchmark_post',
  'training_grounds',
  'base_training_area',
  // Floor 17.
  'malgeri_base',
];

const entry = path.join(os.tmpdir(), `ksgb-sites-entry-${process.pid}.ts`);
fs.writeFileSync(
  entry,
  `export { SPOTS, FLOORS, BANDS } from '${OLD}/src/core/registry';\nexport { SHELVED_WORLD } from '${OLD}/src/core/data/shelved';\n`,
);
const outfile = path.join(os.tmpdir(), `ksgb-sites-${process.pid}.mjs`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
const m = await import(pathToFileURL(outfile).href);
fs.rmSync(outfile, { force: true });
fs.rmSync(entry, { force: true });

const spots = { ...m.SHELVED_WORLD.spots, ...m.SPOTS };
const floorByArea = new Map(Object.values(m.FLOORS ?? {}).map((f) => [f.areaId, f]));
const out = {};
for (const id of SPOTS) {
  const spot = spots[id];
  if (!spot) {
    console.error(`no spot "${id}"`);
    process.exitCode = 1;
    continue;
  }
  const floor = floorByArea.get(spot.areaId);
  const band = floor?.bandId === undefined ? undefined : m.BANDS?.[floor.bandId];
  out[id] = JSON.parse(
    JSON.stringify({
      id: spot.id,
      name: spot.name,
      encounters: spot.encounters ?? [],
      groupWeights: spot.groupWeights
        ? Object.entries(spot.groupWeights).map(([size, weight]) => ({ size: Number(size), weight }))
        : undefined,
      modifierWeights: spot.modifierWeights,
      fightLimit: spot.fightLimit,
      stampOnClear: spot.stampOnClear,
      dynamicLevel: band?.dynamicLevel,
      forced: spot.forced,
    }),
  );
}
fs.writeFileSync(path.join(ROOT, 'tests/sitesOutside.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${Object.keys(out).length} sites to tests/sitesOutside.json`);
