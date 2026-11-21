/**
 * The content half of the bestiary: tags, search, shelves, the averaged
 * profile and drop chances. Pure functions of the registries; no slice. Port
 * of the matching parts of old `systems/bestiary.ts`.
 */
import { MONSTER_LIST, MONSTER_TAGS, MONSTERS, monsterTagsOf, scaledMonsterAttrs, speciesStats, tagCategory, TIER_ORDER, TIERS, type MonsterDef, type MonsterTagCategory, type MonsterTagDef } from '../monsters';
import { attackIntervalOf } from '../stats';

// ---- tags ----

/** Tag ids in use across all monsters, grouped by category (for filter rows). */
export function tagsInUse(): Partial<Record<MonsterTagCategory, string[]>> {
  const groups: Partial<Record<MonsterTagCategory, string[]>> = {};
  for (const def of MONSTER_LIST) {
    for (const tag of monsterTagsOf(def)) {
      const cat = tagCategory(tag);
      if (!cat) continue;
      (groups[cat] ??= []).push(tag);
    }
  }
  for (const cat of Object.keys(groups) as MonsterTagCategory[]) {
    groups[cat] = [...new Set(groups[cat])].sort(
      (a, b) => tagOrder(a, cat) - tagOrder(b, cat) || MONSTER_TAGS[a].name.localeCompare(MONSTER_TAGS[b].name),
    );
  }
  return groups;
}

/** Tiers sort by strength, not by name. */
function tagOrder(tagId: string, cat: MonsterTagCategory): number {
  return cat === 'tier' ? TIER_ORDER.indexOf(tagId) : 0;
}

// ---- search ----

export interface BestiaryQuery {
  /** Free text over names and tag names. */
  search?: string;
  /** Selected tag ids: OR within a category, AND across categories. */
  tags?: string[];
}

export function matchesQuery(def: MonsterDef, query: BestiaryQuery): boolean {
  const tags = monsterTagsOf(def);
  if (query.tags?.length) {
    const byCategory = new Map<MonsterTagCategory, string[]>();
    for (const id of query.tags) {
      const cat = tagCategory(id);
      if (!cat) continue;
      byCategory.set(cat, [...(byCategory.get(cat) ?? []), id]);
    }
    for (const wanted of byCategory.values()) {
      if (!wanted.some((t) => tags.includes(t))) return false;
    }
  }
  const search = query.search?.trim().toLowerCase();
  if (search) {
    const haystack = [def.name, ...tags.map((t) => MONSTER_TAGS[t]?.name ?? t)].join(' ').toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

/** Monsters matching a query, in tier order then by name. */
export function queryMonsters(query: BestiaryQuery): MonsterDef[] {
  return MONSTER_LIST.filter((def) => matchesQuery(def, query)).sort(
    (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.name.localeCompare(b.name),
  );
}

// ---- shelves ----

/** The shelf a monster files under: its first taxon tag. */
export function primaryTaxon(def: MonsterDef): string {
  return def.tags.find((t) => MONSTER_TAGS[t]?.category === 'taxon') ?? 'unclassified';
}

/** Heading of a taxon shelf ("Slimes", "Vermin"). */
export function taxonPlural(tagId: string): string {
  const tag: MonsterTagDef | undefined = MONSTER_TAGS[tagId];
  if (!tag) return 'Unclassified';
  return tag.plural ?? `${tag.name}s`;
}

export interface TaxonGroup {
  tag: string;
  name: string;
  icon: string;
  defs: MonsterDef[];
}

/** Shelve monsters by first taxon, in tag registry order. */
export function groupByTaxon(defs: readonly MonsterDef[]): TaxonGroup[] {
  const order = Object.keys(MONSTER_TAGS);
  const byTag = new Map<string, MonsterDef[]>();
  for (const def of defs) {
    const tag = primaryTaxon(def);
    byTag.set(tag, [...(byTag.get(tag) ?? []), def]);
  }
  return [...byTag.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([tag, group]) => ({ tag, name: taxonPlural(tag), icon: MONSTER_TAGS[tag]?.icon ?? '❔', defs: group }));
}

// ---- the averaged profile ----

export interface MonsterProfile {
  /** Levels the monster is found at. */
  levels: [number, number];
  hp: [number, number];
  damage: [number, number];
  /** Seconds between attacks at the top of the level range. */
  attackInterval: number;
  dodge: number;
  xp: [number, number];
  gold: [number, number];
}

/**
 * Averaged stats at each end of a level range: the mid-point of the tier's
 * roll range, a plain specimen (no modifier tier, no rarity), the same stat
 * formulas a spawn uses. The old `monsterProfile`; the level range is the
 * caller's (`spawnLevels` of the slice reads, or the authored range).
 */
export function monsterProfile(monsterId: string, levels: readonly [number, number]): MonsterProfile {
  const def = MONSTERS[monsterId];
  const tier = TIERS[def.tier];
  const mult = (tier.multiplierRange[0] + tier.multiplierRange[1]) / 2;
  const statsAt = (level: number) => speciesStats(monsterId, scaledMonsterAttrs(def, level, mult), level);
  const lo = statsAt(levels[0]);
  const hi = statsAt(levels[1]);
  const xpAt = (level: number) => def.xp * (1 + 0.35 * (level - 1)) * tier.rewardMult;
  const goldAt = (level: number) => (def.gold ? ((def.gold[0] + def.gold[1]) / 2) * level * tier.rewardMult : 0);
  return {
    levels: [levels[0], levels[1]],
    hp: [lo.maxHp, hi.maxHp],
    damage: [lo.damage, hi.damage],
    // Speed grows with Dexterity: the top of the range is the fastest.
    attackInterval: attackIntervalOf(hi.speed),
    dodge: hi.dodge,
    xp: [xpAt(levels[0]), xpAt(levels[1])],
    gold: [goldAt(levels[0]), goldAt(levels[1])],
  };
}

// ---- drops ----

/** Drop entries at or above this weight are the `loot_common` fact's; the rest are `loot_rare`'s. */
export const COMMON_DROP_WEIGHT = 10;

/** Chance of at least one of entry `index` across the table's independent rolls. */
export function dropChance(def: Pick<MonsterDef, 'loot'>, index: number): number {
  const total = def.loot.entries.reduce((sum, e) => sum + e.weight, 0);
  const per = def.loot.entries[index].weight / total;
  return 1 - Math.pow(1 - per, def.loot.rolls);
}
