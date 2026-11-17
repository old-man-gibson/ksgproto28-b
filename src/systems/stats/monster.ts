/**
 * The monster case of the stat pipeline. Port of `statsFromAttrs`,
 * `monsterStatsUnclamped`, `applyDerivedMods`, `applyResOverrides` and
 * `clampMonsterStats` of the old `systems/monsterStats.ts`.
 *
 * An entity is a monster when a source states `monsterFact` for it. Its
 * modifiers are collected by the same sources as the player's, cached by the
 * same kernel record, and resolved by `computeBlock`, which hands the list
 * here. The formulas differ from the player's and are the old ones:
 * - attributes are the stated base, not floored at 1;
 * - HP is `12 + 7 x CON`, damage `1.5 + 1.1 x STR`;
 * - armour comes from the body's material and its level, not from CON;
 * - a modifier on a stat a monster does not have is ignored;
 * - attack speed is a plain multiplier, not the converging one;
 * - a resistance is held to [-1, the body's own cap].
 */
import {
  ATTRIBUTE_IDS,
  DAMAGE_TYPES,
  RES_KEYS,
  RES_STAT_BY_TYPE,
  STAT_KEYS,
  isAttrTarget,
  type AttributeId,
  type DamageType,
  type DerivedStats,
  type StatKey,
} from './keys';
import { STATS_PREFIX, type StatMod } from './mods';

/** Monsters act on a fixed 1000-unit bar; their speed sets how fast it fills. */
export const MONSTER_ACTION_BAR = 1000;

/** A monster's resistances never block more than this, unless its own cap is moved. */
export const MONSTER_RESIST_CAP = 0.9;

/** What a source states about a monster entity. The data of `monsterFact`. */
export interface MonsterFact {
  /** The specimen's level. Armour grows with it. */
  level: number;
  /** Innate armour of a level 1 specimen: declared, or from its tags. */
  armor: number;
  /** Innate regeneration, as a share of max health per tick. */
  regen: number;
  /** Innate resistances: declared per type, or from its tags. Absent reads 0. */
  resistances: Partial<Record<DamageType, number>>;
}

/** The stats a monster has. A modifier on any other stat key is ignored. */
export const MONSTER_STAT_KEYS = [
  'maxHp',
  'hpRegen',
  'damage',
  'spellPower',
  'speed',
  'dodge',
  'crit',
  'critDamage',
  'armor',
  'attackSpeed',
  'critTaken',
  'damageTaken',
  'ward',
  'resistCap',
  'resElemental',
  'resRanged',
  'vsSmaller',
  'fromSmaller',
  'vsLarger',
  'extraSwings',
  'missRefund',
  'graze',
] as const satisfies readonly StatKey[];
export type MonsterStatKey = (typeof MONSTER_STAT_KEYS)[number];

/**
 * Stats that exist on the player and do not apply to a monster. A monster
 * pays nothing for a working, so it has no mana pool.
 */
export const MONSTER_EXEMPT_STATS: ReadonlySet<string> = new Set(['maxMana']);

const MONSTER_KEY_SET: ReadonlySet<string> = new Set(MONSTER_STAT_KEYS);
const RES_KEY_SET: ReadonlySet<string> = new Set(RES_KEYS);

/** Every stat key at 0. A monster block starts here; the keys it has are then written. */
function zeroStats(): DerivedStats {
  const out = {} as DerivedStats;
  for (const key of STAT_KEYS) out[key] = 0;
  return out;
}

const NO_RESISTANCES: Partial<Record<DamageType, number>> = {};

/**
 * The monster formulas. The old `statsFromAttrs`: everything that wants a
 * monster's numbers from its attributes comes through here.
 */
export function monsterStatsFromAttrs(
  attrs: Partial<Record<AttributeId, number>>,
  resistances: Partial<Record<DamageType, number>> = NO_RESISTANCES,
  innate = 0,
  regen = 0,
  level = 1,
): DerivedStats {
  const attr = (id: AttributeId) => attrs[id] ?? 0;
  const stats = zeroStats();
  for (const type of DAMAGE_TYPES) stats[RES_STAT_BY_TYPE[type]] = resistances[type] ?? 0;
  // Declared only. No attribute grants it.
  stats.hpRegen = Math.max(0, regen);
  // The material decides whether a body is armoured; the level decides how
  // much. Growth is per level above 1, so a declared armour is what a level 1
  // specimen has.
  stats.armor = innate > 0 ? innate * (1 + Math.max(0, level - 1) * 0.05) : 0;
  stats.maxHp = Math.max(1, Math.round(12 + attr('con') * 7));
  stats.damage = Math.max(0.5, 1.5 + attr('str') * 1.1);
  stats.spellPower = Math.max(0.5, 1.5 + attr('int') * 1.1);
  // Capped at one attack per 6 ticks; the baseline is a 24-tick interval.
  stats.speed = Math.min(MONSTER_ACTION_BAR / 6, (MONSTER_ACTION_BAR / 24) * (1 + attr('dex') * 0.012));
  stats.dodge = Math.min(0.35, attr('dex') * 0.003);
  stats.crit = 0.05 + attr('dex') * 0.0015;
  stats.critDamage = 2;
  stats.attackSpeed = 1;
  stats.critTaken = 1;
  stats.damageTaken = 1;
  stats.ward = 0;
  stats.resistCap = MONSTER_RESIST_CAP;
  return stats;
}

/** What the monster case needs from the facts `computeBlock` already read. */
export interface MonsterInput {
  fact: MonsterFact;
  base: Record<AttributeId, number>;
  resOverrides: readonly { type: DamageType; to: number; bonusIfMet?: number }[];
  resFloor: number | undefined;
  resFloorTaken: Partial<Record<string, number>>;
}

export interface MonsterBlock {
  stats: DerivedStats;
  /** Attributes after the attribute-targeted modifiers. Not floored. */
  attrs: Record<AttributeId, number>;
  /** Resistances before the clamp, where the clamp changed them, by stat key. */
  uncapped: Partial<Record<StatKey, number>>;
}

function clampMonsterStats(stats: DerivedStats, uncapped: Partial<Record<StatKey, number>>): void {
  stats.maxHp = Math.max(1, Math.round(stats.maxHp));
  stats.damage = Math.max(0, stats.damage);
  stats.speed = Math.max(1, stats.speed);
  stats.dodge = Math.min(0.9, Math.max(0, stats.dodge));
  stats.hpRegen = Math.max(0, stats.hpRegen);
  stats.armor = Math.max(0, stats.armor);
  stats.critTaken = Math.max(0, stats.critTaken);
  stats.damageTaken = Math.max(0, stats.damageTaken);
  stats.ward = Math.max(0, stats.ward);
  stats.attackSpeed = Math.max(0.1, stats.attackSpeed);
  stats.extraSwings = Math.max(0, stats.extraSwings);
  stats.missRefund = Math.min(1, Math.max(0, stats.missRefund));
  stats.graze = Math.min(1, Math.max(0, stats.graze));
  stats.resistCap = Math.max(0, stats.resistCap);
  for (const key of RES_KEYS) {
    const held = Math.max(-1, Math.min(stats.resistCap, stats[key]));
    if (held !== stats[key]) uncapped[key] = stats[key];
    stats[key] = held;
  }
}

/**
 * One resistance after the floor. Same rule as the player's `applyResFloor`;
 * written here so this file does not import the pipeline that imports it.
 */
function floored(value: number, floor: number, taken: number): number {
  const before = value - taken;
  return Math.max(value, Math.min(before, floor));
}

/**
 * A monster's block from its facts and its modifiers. The order is the old
 * one: attribute adds, attribute mults, the formulas, stat adds, stat mults,
 * modifiers scaled by another stat, resistance overrides and the floor, the
 * clamp.
 */
export function computeMonsterBlock(input: MonsterInput, mods: readonly StatMod[]): MonsterBlock {
  const { fact } = input;
  const attrs = { ...input.base };
  const targets = mods.map((m) => m.stat.slice(STATS_PREFIX.length));

  for (let i = 0; i < mods.length; i++) {
    if (mods[i].kind === 'add' && isAttrTarget(targets[i])) attrs[targets[i] as AttributeId] += mods[i].value;
  }
  for (let i = 0; i < mods.length; i++) {
    if (mods[i].kind === 'mult' && isAttrTarget(targets[i])) attrs[targets[i] as AttributeId] *= 1 + mods[i].value;
  }

  const stats = monsterStatsFromAttrs(attrs, fact.resistances, fact.armor, fact.regen, fact.level);
  const has = (key: string) => MONSTER_KEY_SET.has(key) || RES_KEY_SET.has(key);

  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    if (m.kind !== 'add' || m.fromStat || !has(targets[i])) continue;
    stats[targets[i] as StatKey] += m.value;
  }
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    if (m.kind !== 'mult' || m.fromStat || !has(targets[i])) continue;
    stats[targets[i] as StatKey] *= 1 + m.value;
  }

  // Modifiers scaled by another stat. Last, and every source is read before
  // anything is written. A source this body has no slot for adds nothing.
  if (mods.some((m) => m.fromStat)) {
    const before = { ...stats };
    for (let i = 0; i < mods.length; i++) {
      const m = mods[i];
      if (!m.fromStat || !has(targets[i]) || !has(m.fromStat)) continue;
      const from = before[m.fromStat];
      if (!Number.isFinite(from)) continue;
      const value = m.value * from;
      const key = targets[i] as StatKey;
      stats[key] = m.kind === 'add' ? stats[key] + value : stats[key] * (1 + value);
    }
  }

  // A condition may dictate a resistance, in modifier order.
  const overrides: Partial<Record<DamageType, number>> = {};
  for (const spec of input.resOverrides) {
    const now = overrides[spec.type] ?? stats[RES_STAT_BY_TYPE[spec.type]];
    overrides[spec.type] = spec.bonusIfMet !== undefined && now >= spec.to ? now + spec.bonusIfMet : spec.to;
  }
  for (const [type, value] of Object.entries(overrides) as [DamageType, number][]) {
    stats[RES_STAT_BY_TYPE[type]] = value;
  }
  if (input.resFloor !== undefined) {
    for (const key of RES_KEYS) stats[key] = floored(stats[key], input.resFloor, input.resFloorTaken[key] ?? 0);
  }

  const uncapped: Partial<Record<StatKey, number>> = {};
  clampMonsterStats(stats, uncapped);
  for (const a of ATTRIBUTE_IDS) attrs[a] = attrs[a] ?? 0;
  return { stats, attrs, uncapped };
}

/** Seconds between attacks at a given fill rate (ticks are 100 ms). */
export function attackIntervalOf(speed: number): number {
  return MONSTER_ACTION_BAR / speed / 10;
}
