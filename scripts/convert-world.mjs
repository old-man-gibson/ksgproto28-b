/**
 * One-off content conversion for the world port (spine port 6): reads the
 * location, tower and climate registries of the old repository (read-only)
 * and writes them as JSON under src/systems/<system>/content/.
 *
 * Usage: node scripts/convert-world.mjs [--dump <file>]
 * `--dump` writes everything read from the old repository to one JSON file
 * and no content file.
 *
 * Scope: floor 0, Threshold and floors 1 to 6. The hold, the castle and
 * floors 7 to 20 are step 4 content and are left out, with every band above
 * the second.
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = (process.env.OLD_REPO ?? 'D:/ksgproto28').split(String.fromCharCode(92)).join('/');

const entry = path.join(os.tmpdir(), `ksgb-world-entry-${process.pid}.ts`);
fs.writeFileSync(
  entry,
  [
    `export { SPOTS, AREAS, REGIONS, FLOORS, BANDS, TOWERS, STARTING_SPOT } from '${OLD}/src/core/registry';`,
    `export * as climate from '${OLD}/src/core/data/climate.data';`,
    `export { KEY_ITEMS } from '${OLD}/src/core/data/keyitems.data';`,
    `export { LOG_TEXT } from '${OLD}/src/core/text/log.text';`,
  ].join('\n'),
);
const outfile = path.join(os.tmpdir(), `ksgb-world-${process.pid}.mjs`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
const m = await import(pathToFileURL(outfile).href);
fs.rmSync(outfile, { force: true });
fs.rmSync(entry, { force: true });

const clean = (value) => JSON.parse(JSON.stringify(value));

const dumpAt = process.argv.indexOf('--dump');
if (dumpAt >= 0) {
  fs.writeFileSync(process.argv[dumpAt + 1], JSON.stringify(clean(m), null, 1));
  console.log(`dumped to ${process.argv[dumpAt + 1]}`);
  process.exit(0);
}

// ---- scope ----

const REGION_IDS = ['holding_level', 'threshold', 'the_ascent'];
const FLOOR_IDS = ['ascent_f0', 'ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6'];
const BAND_IDS = ['ascent_lower', 'ascent_middle'];
const floorAreas = new Set(FLOOR_IDS.map((id) => m.FLOORS[id].areaId));
const areas = Object.values(m.AREAS).filter((a) => a.regionId === 'threshold' || floorAreas.has(a.id));
const areaIds = new Set(areas.map((a) => a.id));
const spots = Object.values(m.SPOTS).filter((s) => areaIds.has(s.areaId));
const spotIds = new Set(spots.map((s) => s.id));

/** Fields of a spot that belong to a system not ported yet. Listed in the world README. */
const LEFT_SPOT_FIELDS = ['recipes', 'benches', 'caged', 'healBetweenBouts', 'dare'];
const left = { edges: [], fields: {}, activities: [] };

function spotRecord(s) {
  const out = { ...s };
  for (const f of LEFT_SPOT_FIELDS) {
    if (out[f] !== undefined) {
      (left.fields[f] ??= []).push(s.id);
      delete out[f];
    }
  }
  out.connections = (s.connections ?? []).filter((c) => {
    if (spotIds.has(c.to)) return true;
    left.edges.push(`${s.id} -> ${c.to}`);
    return false;
  });
  if (out.groupWeights)
    out.groupWeights = Object.entries(out.groupWeights).map(([size, weight]) => ({ size: Number(size), weight }));
  out.activities = (s.activities ?? []).map((a) => {
    const act = { ...a };
    if (act.attrXp) act.attrXp = Object.entries(act.attrXp).map(([attr, weight]) => ({ attr, weight }));
    return act;
  });
  if (out.finds) out.finds = out.finds.map((f) => ({ ...f, ...(f.gold ? { gold: { min: f.gold[0], max: f.gold[1] } } : {}) }));
  for (const act of out.activities) {
    if (act.rewards) act.rewards = act.rewards.map((r) => ({ ...r, ...(r.gold ? { gold: { min: r.gold[0], max: r.gold[1] } } : {}) }));
  }
  if (out.encounters) out.encounters = out.encounters.map((e) => ({ ...e }));
  return out;
}

const write = (rel, records) => {
  const file = path.join(ROOT, 'src/systems', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(clean(records), null, 2) + '\n');
  console.log(`${rel}: ${records.length}`);
};

write('world/content/regions.json', REGION_IDS.map((id) => m.REGIONS[id]));
write('world/content/areas.json', areas);
write('world/content/spots.json', spots.map(spotRecord));
write('world/content/key_items.json', Object.values(m.KEY_ITEMS));
write('ladder/content/towers.json', Object.values(m.TOWERS));
write('ladder/content/bands.json', BAND_IDS.map((id) => m.BANDS[id]));
write('ladder/content/floors.json', FLOOR_IDS.map((id) => m.FLOORS[id]));

const c = m.climate;
write('weather/content/terrains.json', Object.entries(c.TERRAIN_PROFILES).map(([id, p]) => ({ id, ...p })));
write(
  'weather/content/sky_tables.json',
  Object.entries(c.SKY_TABLES).map(([id, t]) => ({
    id,
    fronts: t.fronts,
    calm: t.calm,
    excluded: Object.entries(t.excluded).map(([season, kind]) => ({ season, kind })),
  })),
);
write(
  'weather/content/sky_rules.json',
  Object.entries(c.SKY_RULES).map(([id, r]) => ({ id, ...r })),
);

console.log('left out:', JSON.stringify(left, null, 1));
