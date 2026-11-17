/**
 * One-off content conversion for spine port 7: reads the NPC, quest, tutorial
 * and prestige registries of the old repository (read-only) and writes them
 * as JSON under src/systems/<system>/content/.
 *
 * Usage: node scripts/convert-port7.mjs
 *
 * Scope: the NPCs of `docs/SPINE.md` section 8.4, the quest
 * `the_first_ascent`, the nine floor 0 steps, every prestige source and boon,
 * and the log templates the five systems fire.
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = (process.env.OLD_REPO ?? 'D:/ksgproto28').split(String.fromCharCode(92)).join('/');

const entry = path.join(os.tmpdir(), `ksgb-port7-entry-${process.pid}.ts`);
fs.writeFileSync(
  entry,
  [
    `export { NPCS, QUESTS } from '${OLD}/src/core/registry';`,
    `export * as tutorial from '${OLD}/src/core/data/tutorial.data';`,
    `export * as prestige from '${OLD}/src/core/data/prestige.data';`,
    `export { LOG_TEXT } from '${OLD}/src/core/text/log.text';`,
  ].join('\n'),
);
const outfile = path.join(os.tmpdir(), `ksgb-port7-${process.pid}.mjs`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error' });
const m = await import(pathToFileURL(outfile).href);
fs.rmSync(outfile, { force: true });
fs.rmSync(entry, { force: true });

const clean = (value) => JSON.parse(JSON.stringify(value));
const write = (system, registry, records) => {
  const dir = path.join(ROOT, 'src', 'systems', system, 'content');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${registry}.json`), JSON.stringify(clean(records), null, 2) + '\n');
  console.log(`${system}/${registry}: ${records.length}`);
};

// ---- NPCs ----

const NPC_IDS = [
  'warden_of_the_foot',
  'master_smith',
  'head_chef',
  'row_alchemist',
  'ward_outfitter',
  'row_apothecary',
  'granary_provisioner',
  'hall_quartermaster',
];
const QUEST_IDS = ['the_first_ascent'];
write(
  'npcs',
  'npcs',
  NPC_IDS.map((id) => {
    const n = m.NPCS[id];
    if (!n) throw new Error(`no NPC ${id}`);
    const { teaches, lore, ...rest } = n;
    if (teaches || lore) throw new Error(`${id} teaches or has lore; not in scope`);
    return { ...rest, quests: n.quests.filter((q) => QUEST_IDS.includes(q)) };
  }),
);

// ---- quests ----

write(
  'quests',
  'quests',
  QUEST_IDS.map((id) => m.QUESTS[id]),
);

// ---- floor 0 ----

const t = m.tutorial;
write(
  'tutorial',
  'tutorial_steps',
  t.TUTORIAL_STEP_LIST.map(({ done, ...rest }) => rest),
);
write(
  'tutorial',
  'tutorial_rack',
  Object.entries(t.TUTORIAL_RACK).map(([id, pick]) => ({ id, item: pick.item ?? undefined, hands: pick.hands })),
);

// ---- prestige ----

write('prestige', 'prestige_sources', Object.values(m.prestige.PRESTIGE_SOURCES));
write('prestige', 'prestige_boons', Object.values(m.prestige.PRESTIGE_BOONS));

// ---- text ----

const pick = (prefixes) =>
  Object.entries(m.LOG_TEXT)
    .filter(([k]) => prefixes.some((p) => k.startsWith(p)))
    .map(([k, text]) => ({ id: k.replace(/\./g, '_'), text }));
write('npcs', 'npcs_text', pick(['quests.npc_met']));
write('quests', 'quests_text', pick(['quests.completed', 'quests.rewards', 'quests.accepted', 'quests.ready']));
write('shops', 'shops_text', pick(['shops.', 'common.times']));
write('tutorial', 'tutorial_text', pick(['tutorial.']));
write('prestige', 'prestige_text', pick(['prestige.']));
console.log('sale lines:', JSON.stringify(pick(['equipment.sold'])));
