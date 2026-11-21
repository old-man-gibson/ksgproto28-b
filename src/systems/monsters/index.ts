/**
 * The monster registry and what a species is before a fight: tiers,
 * modifiers, rarities, tags, innate armour and resistance, book attributes.
 * Port of the old `data/monsters.data.ts`, the tag half of
 * `data/bestiary.data.ts` and `systems/bestiary.ts`, and the species half of
 * `systems/monsterStats.ts`. The formulas that turn attributes into a stat
 * block are the monster case of `src/systems/stats`. See README.md in this
 * folder.
 *
 * This system holds no state. A live monster is owned by `combat`.
 */
import { defineSystem, registry, s, type Rng } from '../../kernel';
import { conditionSchema, type Condition } from '../counters';
import { sizeRank, type SizeTag } from '../items';
import { dropTableSchema, type DropTable } from '../loot';
import {
  ATTRIBUTE_IDS,
  DAMAGE_TYPES,
  monsterFact,
  monsterStatsFromAttrs,
  type AttributeId,
  type DamageType,
  type DerivedStats,
  type MonsterFact,
} from '../stats';
import { applicationSchema, type ContentApplication } from '../statuses';
import { migrations } from './migrations';
import monstersData from './content/monsters.json';
import tiersData from './content/monster_tiers.json';
import modifierTiersData from './content/modifier_tiers.json';
import raritiesData from './content/rarities.json';
import tagsData from './content/monster_tags.json';

// ---- ids ----

export const TIER_IDS = ['basic', 'veteran', 'elite', 'ancient', 'legendary', 'mythic', 'divine'] as const;
export type TierId = (typeof TIER_IDS)[number];

export const MODIFIER_TIER_IDS = ['normal', 'demiboss', 'boss', 'aberrant'] as const;
export type ModifierTierId = (typeof MODIFIER_TIER_IDS)[number];

export const MONSTER_RARITY_IDS = ['common', 'uncommon', 'rare', 'epic'] as const;
export type MonsterRarityId = (typeof MONSTER_RARITY_IDS)[number];

export const MONSTER_RANGES = ['melee', 'ranged'] as const;
export type MonsterRange = (typeof MONSTER_RANGES)[number];

export const TAG_CATEGORIES = ['material', 'taxon', 'element', 'tier', 'trait', 'size'] as const;
export type MonsterTagCategory = (typeof TAG_CATEGORIES)[number];

/** How many enemies one fight holds. */
export const ENCOUNTER_SLOTS = 5;

/** How far an individual's attributes stray from the book value, either way. */
export const MONSTER_ATTR_VARIANCE = 0.1;

// ---- schemas ----

const perAttr = s.object(
  Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, s.optional(s.number())])) as Record<
    AttributeId,
    ReturnType<typeof s.optional>
  >,
);

const perType = s.object(
  Object.fromEntries(DAMAGE_TYPES.map((type) => [type, s.optional(s.number())])) as Record<
    DamageType,
    ReturnType<typeof s.optional>
  >,
);

const range2 = (help: string) => s.array(s.number(), { help });

/**
 * One rotation entry. The kernel schema has no union: an entry carries
 * `technique` or `cast`. The technique id, the words, the miracle id and the
 * shape axes point at registries of later ports and are plain strings.
 */
const rotationEntrySchema = s.object({
  technique: s.optional(s.string({ help: 'Technique id (martial).' })),
  cast: s.optional(
    s.object({
      school: s.enum(['arcane', 'divine', 'psionic']),
      words: s.optional(s.array(s.string(), { help: 'Arcane words.' })),
      litany: s.optional(s.string({ help: 'Miracle id.' })),
      shape: s.optional(s.array(s.object({ axis: s.string(), value: s.number() }), { help: 'Psionic shape.' })),
    }),
  ),
  uses: s.optional(s.number({ min: 1, help: 'Times the entry may fire in one fight.' })),
});

export const monsters = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Portrait file name. The file is not in this repository.' })),
    desc: s.optional(s.string()),
    tags: s.array(s.ref('monster_tags')),
    tier: s.ref('monster_tiers'),
    keepsWounds: s.optional(
      s.object({
        key: s.string({ help: 'Counter that holds the share of max HP it is missing between fights.' }),
        share: s.number({ min: 0, max: 1 }),
      }),
    ),
    penetration: s.optional(s.number({ min: 0, max: 1, help: 'Overrides the tier value.' })),
    fixedDamage: s.optional(s.number({ help: 'Training equipment: every hit deals this.' })),
    damageType: s.enum(DAMAGE_TYPES),
    inflicts: s.optional(s.array(applicationSchema, { help: 'Rolled once per landed exchange.' })),
    wears: s.optional(s.array(applicationSchema, { help: 'Held from the moment it spawns.' })),
    rotation: s.optional(s.array(rotationEntrySchema)),
    range: s.optional(s.enum(MONSTER_RANGES, { help: 'Default melee.' })),
    passive: s.optional(s.boolean({ help: 'Its blows do no harm.' })),
    group: s.optional(
      s.object({
        min: s.optional(s.number({ min: 1 })),
        max: s.optional(s.number({ min: 1 })),
        weights: s.optional(s.array(s.object({ size: s.number({ min: 1 }), weight: s.number({ min: 0 }) }))),
      }),
    ),
    escorts: s.optional(s.array(s.ref('monsters'))),
    veil: s.optional(s.array(conditionSchema, { help: 'Bestiary gate: the book hides the species until every condition holds. Not read by combat.' })),
    resistances: s.optional(perType),
    armor: s.optional(s.number({ min: 0 })),
    regen: s.optional(s.number({ min: 0, help: 'Share of max health per tick.' })),
    attrs: perAttr,
    growth: perAttr,
    xp: s.number({ min: 0 }),
    gold: s.optional(range2('Lowest and highest gold before level and tier.')),
    loot: dropTableSchema,
  }),
  monstersData,
  'Monsters',
);

export const monsterTiers = registry(
  s.object({
    id: s.enum(TIER_IDS),
    name: s.string(),
    multiplierRange: range2('Lowest and highest stat multiplier, rolled at spawn.'),
    rewardMult: s.number({ min: 0 }),
    penetration: s.number({ min: 0, max: 1, help: 'What a monster of the tier applies conditions with.' }),
  }),
  tiersData,
  'Monster tiers',
);

export const modifierTiers = registry(
  s.object({
    id: s.enum(MODIFIER_TIER_IDS),
    name: s.string(),
    multiplierRange: range2('Lowest and highest stat multiplier, rolled at spawn.'),
    rewardMult: s.number({ min: 0 }),
    weight: s.number({ min: 0, help: 'Default spawn weight. A site may override the weights.' }),
  }),
  modifierTiersData,
  'Monster modifiers',
);

export const rarities = registry(
  s.object({
    id: s.enum(MONSTER_RARITY_IDS),
    name: s.string(),
    statMult: s.number({ min: 0 }),
    lootMult: s.number({ min: 0 }),
    color: s.string({ help: 'Colour of the old interface. Not read here.' }),
    weight: s.number({ min: 0, help: 'Spawn weight.' }),
  }),
  raritiesData,
  'Monster rarities',
);

export const monsterTags = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    category: s.enum(TAG_CATEGORIES),
    icon: s.string(),
    desc: s.optional(s.string()),
    plural: s.optional(s.string()),
  }),
  tagsData,
  'Monster tags',
);

// ---- record types ----

export type MonsterCast =
  | { school: 'arcane'; words: string[] }
  | { school: 'divine'; litany: string }
  | { school: 'psionic'; shape: { axis: string; value: number }[] };

/** One entry of a monster's rotation: a working it composes, or a technique it fights with. */
export type MonsterAction = ({ cast: MonsterCast } | { technique: string }) & { uses?: number };

export interface GroupSpec {
  min?: number;
  max?: number;
  weights?: { size: number; weight: number }[];
}

export interface MonsterDef {
  id: string;
  name: string;
  icon: string;
  art?: string;
  desc?: string;
  tags: string[];
  tier: TierId;
  keepsWounds?: { key: string; share: number };
  penetration?: number;
  fixedDamage?: number;
  damageType: DamageType;
  inflicts?: ContentApplication[];
  wears?: ContentApplication[];
  rotation?: MonsterAction[];
  range?: MonsterRange;
  passive?: boolean;
  group?: GroupSpec;
  escorts?: string[];
  /** Read by the bestiary only. */
  veil?: Condition[];
  resistances?: Partial<Record<DamageType, number>>;
  armor?: number;
  regen?: number;
  attrs: Partial<Record<AttributeId, number>>;
  growth: Partial<Record<AttributeId, number>>;
  xp: number;
  gold?: [number, number];
  loot: DropTable;
}

/** A specimen's own fighting fields over its species' (the old `MonsterKit`). */
export interface MonsterKit {
  rotation?: MonsterAction[];
  damageType?: DamageType;
  range?: MonsterRange;
  resistances?: Partial<Record<DamageType, number>>;
  armor?: number;
  inflicts?: ContentApplication[];
}

export interface TierDef {
  id: TierId;
  name: string;
  multiplierRange: [number, number];
  rewardMult: number;
  penetration: number;
}

export interface ModifierTierDef {
  id: ModifierTierId;
  name: string;
  multiplierRange: [number, number];
  rewardMult: number;
  weight: number;
}

export interface RarityDef {
  id: MonsterRarityId;
  name: string;
  statMult: number;
  lootMult: number;
  color: string;
  weight: number;
}

export interface MonsterTagDef {
  id: string;
  name: string;
  category: MonsterTagCategory;
  icon: string;
  desc?: string;
  plural?: string;
}

const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map((r) => [r.id, r]));

export const MONSTER_LIST = monstersData as unknown as MonsterDef[];
export const MONSTERS: Record<string, MonsterDef> = byId(MONSTER_LIST);
export const TIERS = byId(tiersData as unknown as TierDef[]) as Record<TierId, TierDef>;
/** Tier ids, lowest first. The index is the tier step of `TAG_RESISTANCES`. */
export const TIER_ORDER: string[] = (tiersData as { id: string }[]).map((t) => t.id);
export const MODIFIER_TIERS = byId(modifierTiersData as unknown as ModifierTierDef[]) as Record<ModifierTierId, ModifierTierDef>;
export const RARITIES = byId(raritiesData as unknown as RarityDef[]) as Record<MonsterRarityId, RarityDef>;
export const MONSTER_TAGS: Record<string, MonsterTagDef> = byId(tagsData as MonsterTagDef[]);

/** Default spawn weights of the modifier roll. A site may override them. */
export const MODIFIER_WEIGHTS: { id: ModifierTierId; weight: number }[] = Object.values(MODIFIER_TIERS).map((t) => ({
  id: t.id,
  weight: t.weight,
}));

export const RARITY_WEIGHTS: { id: MonsterRarityId; weight: number }[] = Object.values(RARITIES).map((r) => ({
  id: r.id,
  weight: r.weight,
}));

// ---- tags ----

/**
 * Every tag that applies to a monster: the intrinsic ones from the record,
 * plus the derived ones (tier, reach, group behaviour, and `non_elemental`
 * for a species that claims no element).
 */
export function monsterTagsOf(def: MonsterDef): string[] {
  const tags = [...def.tags];
  const add = (id: string) => {
    if (!tags.includes(id)) tags.push(id);
  };
  add(def.tier);
  if (def.range === 'ranged') add('ranged');
  if (def.escorts?.length) add('leader');
  if (def.group?.max === 1) add('solitary');
  if ((def.group?.min ?? 1) > 1) add('swarm');
  if (!tags.some((t) => MONSTER_TAGS[t]?.category === 'element')) add('non_elemental');
  return tags;
}

const TAG_SETS = new Map<string, ReadonlySet<string>>();

export function monsterTagSet(defId: string): ReadonlySet<string> {
  let set = TAG_SETS.get(defId);
  if (!set) {
    const def = MONSTERS[defId];
    set = new Set(def ? monsterTagsOf(def) : []);
    TAG_SETS.set(defId, set);
  }
  return set;
}

export function tagCategory(tagId: string): MonsterTagCategory | null {
  return MONSTER_TAGS[tagId]?.category ?? null;
}

/** The size tag of a species. Medium when it declares none. */
export function monsterSize(defId: string): SizeTag {
  for (const tag of monsterTagSet(defId)) {
    if (MONSTER_TAGS[tag]?.category === 'size') return tag as SizeTag;
  }
  return 'medium';
}

export function monsterSizeRank(defId: string): number {
  return sizeRank(monsterSize(defId));
}

// ---- the species before a fight ----

/**
 * What a material is worth as armour. Read as a maximum over the tags, not a
 * sum. Every key must be a registered monster tag; a test checks it.
 */
export const TAG_ARMOR: Record<string, number> = {
  inorganic: 3,
  nature: 2,
  ice: 4,
  earth: 5,
  construct: 6,
};

export interface TagResistance {
  /** What it is worth at `basic`. */
  base: number;
  /** Added per tier step above basic. Absent: flat across every tier. */
  perTier?: number;
}

/**
 * What a body's material resists. Physical is flat per taxon; elemental
 * scales with the tier. Every key must be a registered monster tag.
 */
export const TAG_RESISTANCES: Record<string, Partial<Record<DamageType, TagResistance>>> = {
  slime: {
    slashing: { base: 0.5 },
    piercing: { base: 0.5 },
    bludgeoning: { base: -0.25 },
  },
  fire: {
    heat: { base: 0.5, perTier: 0.1 },
    cold: { base: -0.5, perTier: -0.1 },
  },
  ice: {
    cold: { base: 0.5, perTier: 0.1 },
    heat: { base: -0.25, perTier: -0.15 },
  },
  lightning: {
    lightning: { base: 0.7, perTier: 0.1 },
  },
};

/** What the tags imply about one damage type: the opinion furthest from zero, sign kept. */
function taggedResistance(def: MonsterDef, type: DamageType): number | undefined {
  const step = Math.max(0, TIER_ORDER.indexOf(def.tier));
  let out: number | undefined;
  for (const tag of def.tags) {
    const rule = TAG_RESISTANCES[tag]?.[type];
    if (!rule) continue;
    const value = rule.base + (rule.perTier ?? 0) * step;
    if (out === undefined || Math.abs(value) > Math.abs(out)) out = value;
  }
  return out;
}

/** One specimen's fighting fields: its species' record with its own kit laid over it. */
export interface ResolvedKit {
  rotation: MonsterAction[] | undefined;
  damageType: DamageType;
  range: MonsterRange;
  resistances: Partial<Record<DamageType, number>> | undefined;
  armor: number | undefined;
  inflicts: ContentApplication[] | undefined;
}

export function kitOf(e: { defId: string; kit?: MonsterKit }): ResolvedKit {
  const def = MONSTERS[e.defId];
  const kit = e.kit;
  return {
    rotation: kit?.rotation ?? def?.rotation,
    damageType: kit?.damageType ?? def?.damageType ?? 'bludgeoning',
    range: kit?.range ?? def?.range ?? 'melee',
    resistances: kit?.resistances ?? def?.resistances,
    armor: kit?.armor ?? def?.armor,
    inflicts: kit?.inflicts ?? def?.inflicts,
  };
}

/** Innate armour: the kit's, else the declared value, else the toughest material of the tags. */
export function innateArmor(defId: string, kit?: MonsterKit): number {
  if (kit?.armor !== undefined) return kit.armor;
  const def = MONSTERS[defId];
  if (!def) return 0;
  if (def.armor !== undefined) return def.armor;
  let best = 0;
  for (const tag of def.tags) best = Math.max(best, TAG_ARMOR[tag] ?? 0);
  return best;
}

/**
 * Innate resistances. A declared value wins per type; a type the record
 * leaves out reads what the tags imply. A kit replaces the declared block.
 */
export function innateResistances(defId: string, kit?: MonsterKit): Record<DamageType, number> {
  const def = MONSTERS[defId];
  const declared = kit?.resistances ?? def?.resistances;
  const out = {} as Record<DamageType, number>;
  for (const type of DAMAGE_TYPES) {
    out[type] = declared?.[type] ?? (def ? (taggedResistance(def, type) ?? 0) : 0);
  }
  return out;
}

/** A species' declared resistance to a type, clamped. The base layer only. */
export function monsterResistance(defId: string, type: DamageType): number {
  const res = MONSTERS[defId]?.resistances?.[type] ?? 0;
  return Math.max(-1, Math.min(0.9, res));
}

/** Book-value attributes at a level, before variance or scaling. */
export function baseMonsterAttrs(def: MonsterDef, level: number): Record<AttributeId, number> {
  const attrs = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) attrs[id] = (def.attrs[id] ?? 0) + (def.growth[id] ?? 0) * (level - 1);
  return attrs;
}

/** Roll one specimen's attributes: book value, jittered per attribute, then scaled. One draw per attribute. */
export function rollMonsterAttrs(rng: Rng, def: MonsterDef, level: number, statMult: number): Record<AttributeId, number> {
  const attrs = baseMonsterAttrs(def, level);
  for (const id of ATTRIBUTE_IDS) {
    const jitter = 1 + (rng.next() * 2 - 1) * MONSTER_ATTR_VARIANCE;
    attrs[id] = attrs[id] * jitter * statMult;
  }
  return attrs;
}

/**
 * Attributes with an emphasis laid over them: each times its multiplier
 * (missing is 1, negative is 0), then scaled back so the sum is unchanged.
 */
export function biasAttrs(
  attrs: Record<AttributeId, number>,
  bias: Partial<Record<AttributeId, number>>,
): Record<AttributeId, number> {
  const out = {} as Record<AttributeId, number>;
  let before = 0;
  let after = 0;
  for (const id of ATTRIBUTE_IDS) {
    const value = attrs[id] ?? 0;
    before += value;
    out[id] = value * Math.max(0, bias[id] ?? 1);
    after += out[id];
  }
  const scale = after > 0 ? before / after : 1;
  for (const id of ATTRIBUTE_IDS) out[id] *= scale;
  return out;
}

/** Book-value attributes scaled by a multiplier, with no roll. */
export function scaledMonsterAttrs(def: MonsterDef, level: number, statMult: number): Record<AttributeId, number> {
  const attrs = baseMonsterAttrs(def, level);
  for (const id of ATTRIBUTE_IDS) attrs[id] *= statMult;
  return attrs;
}

/** The fact a monster entity's source states, from its species, kit and level. */
export function monsterFactOf(defId: string, level: number, kit?: MonsterKit): MonsterFact {
  return {
    level,
    armor: innateArmor(defId, kit),
    regen: MONSTERS[defId]?.regen ?? 0,
    resistances: innateResistances(defId, kit),
  };
}

/** The modifier form of `monsterFactOf`. */
export const monsterFactMod = (defId: string, level: number, kit?: MonsterKit) =>
  monsterFact(monsterFactOf(defId, level, kit));

/** A species' block from attributes, with its innate armour, regeneration and resistances. */
export function speciesStats(defId: string, attrs: Partial<Record<AttributeId, number>>, level: number, kit?: MonsterKit): DerivedStats {
  const fact = monsterFactOf(defId, level, kit);
  return monsterStatsFromAttrs(attrs, fact.resistances, fact.armor, fact.regen, level);
}

// ---- penetration ----

/** The penetration a species applies conditions with: its own, else its tier's. */
export function penetrationOf(def: Pick<MonsterDef, 'penetration' | 'tier'>, tiers: Record<string, TierDef> = TIERS): number {
  return def.penetration ?? tiers[def.tier]?.penetration ?? 0;
}

/** Floors up to and including this index apply conditions with no penetration. */
export const NO_PENETRATION_THROUGH_FLOOR = 3;

/**
 * Problems with monster penetration, as sentences keyed by monster id.
 * `early` lists the species that can appear on a floor at or below
 * `NO_PENETRATION_THROUGH_FLOOR` with where; the world port builds it from
 * its spots (encounters, escorts, dares). Without it only the range of a
 * species' own penetration is checked.
 */
export function penetrationProblems(
  defs: Record<string, MonsterDef>,
  tiers: Record<string, TierDef>,
  early: readonly { monsterId: string; where: string }[] = [],
): { monster: string; message: string }[] {
  const problems: { monster: string; message: string }[] = [];
  for (const def of Object.values(defs)) {
    const own = def.penetration;
    if (own !== undefined && !(Number.isFinite(own) && own >= 0 && own <= 1)) {
      problems.push({ monster: def.id, message: `'${def.id}' has penetration ${own}: it is a share, 0 to 1` });
    }
  }
  const seen = new Set<string>();
  for (const { monsterId, where } of early) {
    const def = defs[monsterId];
    if (!def || seen.has(`${monsterId}@${where}`)) continue;
    seen.add(`${monsterId}@${where}`);
    const pen = penetrationOf(def, tiers);
    if (pen !== 0) {
      problems.push({
        monster: monsterId,
        message:
          `'${monsterId}' appears on ${where} and applies conditions with penetration ${pen}; ` +
          `floors up to ${NO_PENETRATION_THROUGH_FLOOR} take none (set penetration: 0 on it)`,
      });
    }
  }
  return problems;
}

// ---- lint ----

/** Why a monster record is not a usable `MonsterDef`. Empty when it is. */
export function monsterIssues(def: MonsterDef): string[] {
  const issues: string[] = [];
  if (def.gold && (def.gold.length !== 2 || def.gold[0] > def.gold[1]))
    issues.push(`${def.id}: gold must be a lowest and a highest number`);
  for (const entry of def.rotation ?? []) {
    const kinds = Number('technique' in entry) + Number('cast' in entry);
    if (kinds !== 1) issues.push(`${def.id}: a rotation entry carries exactly one of technique and cast`);
  }
  const min = def.group?.min ?? 1;
  const max = def.group?.max ?? ENCOUNTER_SLOTS;
  if (min > max) issues.push(`${def.id}: group min ${min} is above max ${max}`);
  if (max > ENCOUNTER_SLOTS) issues.push(`${def.id}: group max ${max} is above the ${ENCOUNTER_SLOTS} slots of a fight`);
  return issues;
}

export default defineSystem<Record<string, never>>({
  id: 'monsters',
  version: 1,
  migrations,
  initial: () => ({}),
  content: {
    monsters,
    monster_tiers: monsterTiers,
    modifier_tiers: modifierTiers,
    rarities,
    monster_tags: monsterTags,
  },
});
