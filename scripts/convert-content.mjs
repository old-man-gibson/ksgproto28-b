/**
 * One-off content conversion: reads registries from the old repository
 * (read-only) and writes them as JSON under src/systems/<system>/content/.
 *
 * Usage: node scripts/convert-content.mjs [job ...]
 * With no job name every job runs. The old repository path is OLD_REPO, or
 * D:/ksgproto28.
 *
 * A job names the old module, the export to read, and a function from that
 * export to the list of records. Later ports add jobs here.
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD = (process.env.OLD_REPO ?? 'D:/ksgproto28').replace(/\\/g, '/');
const ID = /^[a-z][a-z0-9_]*$/;

/** Drop undefined fields and keep key order. */
const clean = (value) => JSON.parse(JSON.stringify(value));

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const JOBS = [
  {
    name: 'skills',
    out: 'skills/content/skills.json',
    module: 'src/core/data/skills.data.ts',
    pick: (m) => Object.values(m.SKILLS),
  },
  {
    name: 'skill_categories',
    out: 'skills/content/skill_categories.json',
    module: 'src/core/types.ts',
    pick: (m) => m.SKILL_CATEGORIES,
  },
  {
    name: 'attributes',
    out: 'attributes/content/attributes.json',
    module: 'src/core/data/attributes.data.ts',
    pick: (m) => m.ATTRIBUTE_LIST,
  },
  {
    name: 'attribute_training',
    out: 'attributes/content/attribute_training.json',
    module: 'src/core/data/attributes.data.ts',
    pick: (m) => Object.entries(m.ATTRIBUTE_TRAINING).map(([id, def]) => ({ id, ...def })),
  },
  {
    name: 'progressions',
    out: 'progression/content/progressions.json',
    module: 'src/core/data/progression.data.ts',
    pick: (m) => [
      ...Object.entries(m.PROGRESSIONS).map(([id, bands]) => ({ id, bands })),
      { id: 'attribute', bands: m.ATTRIBUTE_PROGRESSION },
    ],
  },
  {
    name: 'xp_bases',
    out: 'progression/content/xp_bases.json',
    module: 'src/core/data/progression.data.ts',
    pick: (m) => Object.entries(m.XP_BASE).map(([id, cost]) => ({ id, cost })),
  },
  {
    name: 'xp_rates',
    out: 'progression/content/xp_rates.json',
    module: 'src/core/data/progression.data.ts',
    pick: (m) => Object.entries(m.XP_RATE).map(([id, rate]) => ({ id, rate })),
  },
  {
    name: 'resources',
    out: 'resources/content/resources.json',
    module: 'src/core/data/resources.data.ts',
    pick: (m) => m.RESOURCE_LIST,
  },
  {
    name: 'months',
    out: 'clock/content/months.json',
    module: 'src/core/data/climate.data.ts',
    pick: (m) => m.MONTHS,
  },
  {
    name: 'weekdays',
    out: 'clock/content/weekdays.json',
    module: 'src/core/data/climate.data.ts',
    pick: (m) => m.WEEKDAYS.map((name) => ({ id: slug(name), name })),
  },
  {
    name: 'holy_days',
    out: 'clock/content/holy_days.json',
    module: 'src/core/data/climate.data.ts',
    pick: (m) => m.HOLY_DAYS,
  },
  {
    name: 'moons',
    out: 'clock/content/moons.json',
    module: 'src/core/data/climate.data.ts',
    pick: (m) => m.MOONS,
  },
  {
    name: 'moon_phases',
    out: 'clock/content/moon_phases.json',
    module: 'src/core/data/climate.data.ts',
    pick: (m) => m.MOON_PHASES,
  },
  {
    name: 'statuses',
    out: 'statuses/content/statuses.json',
    module: 'src/core/data/statuses.data.ts',
    pick: (m) => Object.values(m.STATUSES).map(statusRecord),
  },
  {
    name: 'items',
    out: 'items/content/items.json',
    module: 'src/core/data/items.data.ts',
    // The `forged:<class>` stubs are generated from the item classes of
    // modular smithing. They arrive with that system.
    pick: (m) => Object.values(m.ITEMS).filter((def) => !def.id.startsWith('forged:')),
  },
  {
    name: 'affixes',
    out: 'items/content/affixes.json',
    module: 'src/core/data/items.data.ts',
    // The old list has no ids. The id is the name in lower case; the order of
    // the list is the order the drop code indexes.
    pick: (m) => m.AFFIXES.map((affix) => ({ id: slug(affix.name), ...affix })),
  },
  {
    name: 'runes',
    out: 'items/content/runes.json',
    module: 'src/core/data/runes.data.ts',
    // The catalogue only. Patterns, adornments and named runes are parts of
    // runecarving and arrive with it.
    pick: (m) => Object.values(m.RUNES).map(runeRecord),
  },
  {
    name: 'materials',
    out: 'materials/content/materials.json',
    module: 'src/core/data/materials.data.ts',
    pick: (m) => Object.values(m.MATERIALS),
  },
  {
    name: 'quality_tiers',
    out: 'materials/content/quality_tiers.json',
    module: 'src/core/data/quality.data.ts',
    // Worst to best: the order of the list is the order of the scale.
    pick: (m) => m.QUALITY_ORDER.map((id) => m.QUALITY_TIERS[id]),
  },
  {
    name: 'monsters',
    out: 'monsters/content/monsters.json',
    module: 'src/core/data/monsters.data.ts',
    pick: (m) => Object.values(m.MONSTERS).map(monsterRecord),
  },
  {
    name: 'monster_tiers',
    out: 'monsters/content/monster_tiers.json',
    module: 'src/core/data/monsters.data.ts',
    // Lowest to highest: the order of the list is the tier step of `TAG_RESISTANCES`.
    pick: (m) => Object.values(m.TIERS),
  },
  {
    name: 'modifier_tiers',
    out: 'monsters/content/modifier_tiers.json',
    module: 'src/core/data/monsters.data.ts',
    // `weight` is the old MODIFIER_WEIGHTS entry of the tier.
    pick: (m) =>
      Object.values(m.MODIFIER_TIERS).map((tier) => ({
        ...tier,
        weight: m.MODIFIER_WEIGHTS.find((w) => w.id === tier.id)?.weight ?? 0,
      })),
  },
  {
    name: 'rarities',
    out: 'monsters/content/rarities.json',
    module: 'src/core/data/monsters.data.ts',
    // `weight` is the old RARITY_WEIGHTS entry of the rarity.
    pick: (m) =>
      Object.values(m.RARITIES).map((rarity) => ({
        ...rarity,
        weight: m.RARITY_WEIGHTS.find((w) => w.id === rarity.id)?.weight ?? 0,
      })),
  },
  {
    name: 'monster_tags',
    out: 'monsters/content/monster_tags.json',
    module: 'src/core/data/bestiary.data.ts',
    pick: (m) => Object.values(m.MONSTER_TAGS),
  },
  {
    name: 'positions',
    out: 'martial/content/positions.json',
    module: 'src/core/data/martial.data.ts',
    pick: (m) => Object.values(m.POSITIONS),
  },
  {
    name: 'fork_archetypes',
    out: 'martial/content/fork_archetypes.json',
    module: 'src/core/data/martial.data.ts',
    pick: (m) => m.FORK_ARCHETYPE_LIST,
  },
  {
    name: 'techniques',
    out: 'martial/content/techniques.json',
    module: 'src/core/data/martial.data.ts',
    pick: (m) => m.TECHNIQUE_LIST.map(techniqueRecord),
  },
  {
    name: 'styles',
    out: 'styles/content/styles.json',
    module: 'src/core/data/styles.data.ts',
    pick: (m) => Object.values(m.STYLES),
  },
  {
    name: 'arcane_words',
    out: 'arcane/content/arcane_words.json',
    module: 'src/core/data/spellcraft.data.ts',
    pick: (m) => m.ARCANE_WORD_LIST.map(wordRecord),
  },
  {
    name: 'miracles',
    out: 'divine/content/miracles.json',
    module: 'src/core/data/spellcraft.data.ts',
    pick: (m) => m.MIRACLE_LIST.map((def) => ({ ...def, spec: specRecord(def.spec) })),
  },
  {
    name: 'deities',
    out: 'divine/content/deities.json',
    module: 'src/core/data/deities.data.ts',
    pick: (m) => m.DEITY_LIST,
  },
  {
    name: 'deity_tags',
    out: 'divine/content/deity_tags.json',
    module: 'src/core/data/deities.data.ts',
    // Three old tag ids hold a space ("goblin pantheon"). The record id is the
    // slug; `tag` is the old id, which deities and relation rules name.
    pick: (m) => Object.values(m.DEITY_TAGS).map(({ id, ...rest }) => ({ id: slug(id), tag: id, ...rest })),
  },
  {
    name: 'titles',
    out: 'titles/content/titles.json',
    module: 'src/core/data/titles.data.ts',
    // `desc` is merged in from the old text table by `prose`.
    pick: (m) => Object.values(m.TITLES),
  },
  {
    name: 'superattrs',
    out: 'superattrs/content/superattrs.json',
    module: 'src/core/data/superattrs.data.ts',
    // `desc` is merged in from the old text table by `prose`.
    pick: (m) => Object.values(m.SUPERATTRS),
  },
];

const applications = (apps) => (apps ? apps.map(statusApplication) : undefined);

/** A trigger in the JSON form: a condition's value, a number or a string, is written as a string. */
function triggerRecord(trigger) {
  if (!trigger) return undefined;
  return {
    ...trigger,
    ...(trigger.conditions ? { conditions: trigger.conditions.map((c) => ({ ...c, value: String(c.value) })) } : {}),
  };
}

/**
 * One technique record in the JSON form:
 * - `from` (`'any'`, a list of positions, or a list of ways) becomes a list
 *   of ways, each `{ any: true }` or `{ at: [...] }`, with its trigger;
 * - `mastery`, a map keyed by tier, becomes a list in key order;
 * - applications in `move.inflicts` go through `statusApplication`.
 */
function techniqueRecord(def) {
  const { from, mastery, trigger, move, ...rest } = def;
  const ways =
    from === 'any'
      ? [{ any: true }]
      : from.length === 0
        ? []
        : typeof from[0] === 'string'
          ? [{ at: from }]
          : from.map((way) => ({
              ...(way.at === 'any' ? { any: true } : { at: way.at }),
              ...(way.trigger ? { trigger: triggerRecord(way.trigger) } : {}),
            }));
  return {
    ...rest,
    ...(trigger ? { trigger: triggerRecord(trigger) } : {}),
    from: ways,
    move: { ...move, ...(move.inflicts ? { inflicts: applications(move.inflicts) } : {}) },
    ...(mastery ? { mastery: Object.entries(mastery).map(([tier, note]) => ({ tier: Number(tier), ...note })) } : {}),
  };
}

/** One arcane word in the JSON form: its applications go through `statusApplication`. */
function wordRecord(def) {
  const { inflicts, verb, ...rest } = def;
  return {
    ...rest,
    ...(inflicts ? { inflicts: applications(inflicts) } : {}),
    ...(verb ? { verb: { ...verb, ...(verb.bareInflicts ? { bareInflicts: applications(verb.bareInflicts) } : {}) } } : {}),
  };
}

/** A stated spell in the JSON form: every application goes through `statusApplication`. */
function specRecord(spec) {
  const { strikes, grants, afflicts, ...rest } = spec;
  return {
    ...rest,
    strikes: strikes.map((strike) => ({ ...strike, ...(strike.inflicts ? { inflicts: applications(strike.inflicts) } : {}) })),
    ...(grants ? { grants: applications(grants) } : {}),
    ...(afflicts ? { afflicts: applications(afflicts) } : {}),
  };
}

/**
 * One monster record in the JSON form:
 * - `group.weights`, a map keyed by size, becomes a list in key order;
 * - a psionic `cast.shape`, a map keyed by axis, becomes a list in key order;
 * - applications in `inflicts` and `wears` go through `statusApplication`.
 */
function monsterRecord(def) {
  const { group, rotation, inflicts, wears, ...rest } = def;
  return {
    ...rest,
    ...(group
      ? {
          group: {
            ...group,
            ...(group.weights
              ? { weights: Object.entries(group.weights).map(([size, weight]) => ({ size: Number(size), weight })) }
              : {}),
          },
        }
      : {}),
    ...(rotation
      ? {
          rotation: rotation.map((entry) =>
            entry.cast?.shape
              ? {
                  ...entry,
                  cast: {
                    ...entry.cast,
                    shape: Object.entries(entry.cast.shape).map(([axis, value]) => ({ axis, value })),
                  },
                }
              : entry,
          ),
        }
      : {}),
    ...(inflicts ? { inflicts: inflicts.map(statusApplication) } : {}),
    ...(wears ? { wears: wears.map(statusApplication) } : {}),
  };
}

/** `duration: 'permanent'` of an application becomes `permanent: true`: the schema has no union. */
function statusApplication(app) {
  const { duration, ...rest } = app;
  return duration === 'permanent' ? { ...rest, permanent: true } : { ...rest, duration };
}

/**
 * One status record in the JSON form:
 * - `duration: null` (no timer) is written as an absent `duration`;
 * - `overrideRes`, a map keyed by damage type, becomes a list in key order;
 * - an application inside `retaliate.inflicts` goes through `statusApplication`.
 */
function statusRecord(def) {
  const { duration, overrideRes, retaliate, ...rest } = def;
  return {
    ...rest,
    ...(duration === null ? {} : { duration }),
    ...(overrideRes
      ? { overrideRes: Object.entries(overrideRes).map(([type, spec]) => ({ type, ...spec })) }
      : {}),
    ...(retaliate
      ? { retaliate: { ...retaliate, ...(retaliate.inflicts ? { inflicts: retaliate.inflicts.map(statusApplication) } : {}) } }
      : {}),
  };
}

/** `effects`, a map keyed by rune context, becomes a list in key order: the schema has no map. */
function runeRecord(def) {
  const { effects, ...rest } = def;
  return { ...rest, effects: Object.entries(effects).map(([context, effect]) => ({ context, ...effect })) };
}

async function load(module) {
  const outfile = path.join(os.tmpdir(), `ksgb-convert-${process.pid}-${slug(module)}.mjs`);
  await build({
    entryPoints: [`${OLD}/${module}`],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'error',
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}

const wanted = process.argv.slice(2);
const jobs = wanted.length ? JOBS.filter((job) => wanted.includes(job.name)) : JOBS;
const unknown = wanted.filter((name) => !JOBS.some((job) => job.name === name));
if (unknown.length) {
  console.error(`unknown job: ${unknown.join(', ')}`);
  process.exit(1);
}

const modules = new Map();
let failed = false;
for (const job of jobs) {
  if (!modules.has(job.module)) modules.set(job.module, await load(job.module));
  const records = clean(job.pick(modules.get(job.module)));
  const bad = records.filter((record) => typeof record.id !== 'string' || !ID.test(record.id));
  if (bad.length) {
    console.error(`${job.name}: ${bad.length} record id(s) do not match ${ID.source}: ${bad.map((r) => r.id).join(', ')}`);
    failed = true;
    continue;
  }
  const file = path.join(ROOT, 'src/systems', job.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n');
  const fields = [...new Set(records.flatMap((record) => Object.keys(record)))];
  console.log(`${job.name}: ${records.length} records -> src/systems/${job.out} [${fields.join(', ')}]`);
}
process.exit(failed ? 1 : 0);
