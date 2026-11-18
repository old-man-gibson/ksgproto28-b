/**
 * The stat pipeline. Port of `computeDerivedStats`, `baseStats` and the
 * damping pass of `collectModifiers` in the old `systems/derived.ts`, and of
 * the effective-attribute layer in the old `systems/attributes.ts`.
 *
 * Input: every modifier collected for one entity. Output: the stat block.
 * The order of the layers is the old order:
 *   1. gates, scaling, damping;
 *   2. effective attributes (base, adds, mults, endowment, floor of 1);
 *   3. base stats from the attributes;
 *   4. stat adds, then stat mults;
 *   5. attack speed, converging;
 *   6. clamps and rounding;
 *   7. resistance overrides, cap and floor;
 *   8. modifiers scaled by another stat (`fromStat`).
 */
import type { Modifier } from '../../kernel';
import {
  ATTRIBUTE_IDS,
  DAMAGE_TYPES,
  RES_KEYS,
  RES_STAT_BY_TYPE,
  STAT_KEYS,
  isAttrTarget,
  isScopedTarget,
  isStatKey,
  type AttributeId,
  type DamageType,
  type DerivedStats,
  type StatKey,
} from './keys';
import { STATS_PREFIX, type DampSpec, type ModOrigin, type StatMod } from './mods';
import { computeMonsterBlock, type MonsterFact } from './monster';

// ---- constants ----

/** Resistances never block more than this fraction of incoming damage. */
export const RESIST_CAP = 0.75;
/** No amount of gear turns every blow aside. */
export const PARRY_CAP = 0.5;
/** The most the cook's skill multiplies food by, duration and potency alike. */
export const FOOD_MULT_CAP = 1.5;
/** A parry answers with this share of the damage. The base of the `riposte` stat. */
export const PARRY_RIPOSTE = 0.3;
/** Baseline action-bar size in units. */
export const BASE_ACTION_BAR = 1000;
/** Baseline action-bar fill per tick at DEX 0. */
export const BASE_SPEED = 50;
/** The action bar never shrinks below this. */
export const MIN_ACTION_BAR = 100;
/** The attack interval never drops below this (0.5 s at 10 ticks per second). */
export const MIN_ATTACK_TICKS = 5;
/** One attack-speed source never erases more than this share of attack time. */
export const ATTACK_SPEED_MOD_CAP = 0.5;
/** Share of the health pool recovered per second. */
export const HP_REGEN_SHARE = 0.01;
/** Flat part of unarmed damage. */
export const BARE_DAMAGE_FLAT = 2;
/** Unarmed damage per point of STR. */
export const BARE_DAMAGE_PER_STR = 1.2;
/** Share of the stamina pool recovered per second. */
export const STAMINA_REGEN_SHARE = 0.02;
/** Share of the focus pool recovered per second. */
export const FOCUS_REGEN_SHARE = 0.02;
/** Exertion never costs less than this share of its listed price. */
export const STAMINA_EFF_FLOOR = 0.5;
/** Innate dodge chance at DEX 0. */
export const DODGE_BASE = 0.02;
/** Each DEX multiplies the remaining chance to be hit by (1 - this). */
export const DODGE_PER_DEX = 0.004;

/** Round to 4 decimals. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

// ---- reading the modifier list ----

/** A modifier after gates, scaling and damping, with the `stats/` prefix removed. */
export interface ActiveMod {
  target: string;
  op: 'add' | 'mult';
  value: number;
  source?: string;
  origin?: ModOrigin;
  undampened?: boolean;
  fromStat?: StatKey;
}

interface Facts {
  base: Record<AttributeId, number>;
  tags: Set<string>;
  style: string | undefined;
  named: Map<string, number>;
  attrCeiling: number | null;
  fused: [AttributeId, AttributeId][];
  endowment: Record<AttributeId, number>;
  scales: Map<string, number>;
  damps: { share: number; spec: DampSpec }[];
  resOverrides: { type: DamageType; to: number; bonusIfMet?: number }[];
  resFloor: number | undefined;
  resFloorTaken: Partial<Record<string, number>>;
  /** Stated for a monster entity: the block is computed by the monster formulas. */
  monster: MonsterFact | undefined;
}

const zeroAttrs = (): Record<AttributeId, number> => ({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });

function bad(mod: Modifier, why: string): never {
  throw new Error(`modifier target "${mod.stat}" ${why}`);
}

/** Split the collected list into facts and ordinary modifiers. */
function readFacts(mods: readonly Modifier[]): { facts: Facts; plain: StatMod[] } {
  const facts: Facts = {
    base: zeroAttrs(),
    tags: new Set(),
    style: undefined,
    named: new Map(),
    attrCeiling: null,
    fused: [],
    endowment: zeroAttrs(),
    scales: new Map(),
    damps: [],
    resOverrides: [],
    resFloor: undefined,
    resFloorTaken: {},
    monster: undefined,
  };
  const plain: StatMod[] = [];
  let armed = false;
  for (const raw of mods) {
    if (!raw.stat.startsWith(STATS_PREFIX)) continue;
    const mod = raw as StatMod;
    const target = mod.stat.slice(STATS_PREFIX.length);
    if (!target.startsWith('@')) {
      plain.push(mod);
      continue;
    }
    const at = target.indexOf(':');
    const name = at < 0 ? target.slice(1) : target.slice(1, at);
    const arg = at < 0 ? '' : target.slice(at + 1);
    switch (name) {
      case 'base':
        if (!isAttrTarget(arg)) bad(mod, 'names no attribute');
        facts.base[arg as AttributeId] += mod.value;
        break;
      case 'tag':
        facts.tags.add(arg);
        break;
      case 'armed':
        armed = true;
        break;
      case 'style':
        facts.style = arg;
        break;
      case 'fact':
        facts.named.set(arg, (facts.named.get(arg) ?? 0) + mod.value);
        break;
      case 'attrCeiling':
        facts.attrCeiling = facts.attrCeiling === null ? mod.value : Math.min(facts.attrCeiling, mod.value);
        break;
      case 'fuse': {
        const { a, b } = (mod.data ?? {}) as { a?: string; b?: string };
        if (!a || !b || !isAttrTarget(a) || !isAttrTarget(b)) bad(mod, 'needs two attribute ids in data');
        facts.fused.push([a as AttributeId, b as AttributeId]);
        break;
      }
      case 'endowment':
        if (!isAttrTarget(arg)) bad(mod, 'names no attribute');
        facts.endowment[arg as AttributeId] += mod.value;
        break;
      case 'scale':
        facts.scales.set(arg, (facts.scales.get(arg) ?? 0) + mod.value);
        break;
      case 'damp':
        facts.damps.push({ share: mod.value, spec: (mod.data ?? {}) as DampSpec });
        break;
      case 'resOverride': {
        if (!(DAMAGE_TYPES as readonly string[]).includes(arg)) bad(mod, 'names no damage type');
        const bonusIfMet = (mod.data as { bonusIfMet?: number } | undefined)?.bonusIfMet;
        facts.resOverrides.push({ type: arg as DamageType, to: mod.value, bonusIfMet });
        break;
      }
      case 'resFloor':
        facts.resFloor = facts.resFloor === undefined ? mod.value : Math.min(facts.resFloor, mod.value);
        break;
      case 'resFloorTaken':
        if (!isStatKey(arg)) bad(mod, 'names no stat key');
        facts.resFloorTaken[arg] = (facts.resFloorTaken[arg] ?? 0) + mod.value;
        break;
      case 'monster': {
        const data = mod.data as MonsterFact | undefined;
        if (!data || typeof data.level !== 'number') bad(mod, 'needs the monster fact in data');
        facts.monster = data;
        break;
      }
      default:
        bad(mod, 'is not a fact the stat pipeline knows');
    }
  }
  // Pseudo-tag: bare-handed counts as wielding 'unarmed'.
  if (!armed) facts.tags.add('unarmed');
  return { facts, plain };
}

function vsTagsOf(variant: string): ReadonlySet<string> | undefined {
  if (variant === '') return undefined;
  if (!variant.startsWith('vs:')) throw new Error(`stat variant "${variant}" is not "" or "vs:<tags>"`);
  return new Set(variant.slice(3).split(','));
}

/** How much the damping facts dull a modifier from `origin`. Returns the share to keep. */
function dampingFor(facts: Facts, origin: ModOrigin | undefined, target: string): number {
  if (!origin) return 1;
  let keep = 1;
  for (const { share, spec } of facts.damps) {
    if (spec.kinds && !spec.kinds.includes(origin.kind)) continue;
    if (spec.stats && !spec.stats.includes(target)) continue;
    if (spec.slot && spec.slot !== origin.slot) continue;
    keep *= 1 - share;
  }
  return Math.max(0, keep);
}

/** Apply gates, scaling and damping. The collected modifiers are not changed. */
function activate(facts: Facts, plain: readonly StatMod[], vsTags: ReadonlySet<string> | undefined): ActiveMod[] {
  const out: ActiveMod[] = [];
  for (const mod of plain) {
    if (mod.requiresTag && !facts.tags.has(mod.requiresTag)) continue;
    if (mod.requiresStyle && mod.requiresStyle !== facts.style) continue;
    // Target-gated bonuses are absent from the plain block and present only
    // against a target carrying the tag.
    if (mod.requiresMonsterTag && !vsTags?.has(mod.requiresMonsterTag)) continue;
    const target = mod.stat.slice(STATS_PREFIX.length);
    if (!isScopedTarget(target) && !isAttrTarget(target) && !isStatKey(target))
      bad(mod, 'is not a stat key, an attribute id or a scoped target');
    if (isScopedTarget(target) && !isStatKey(target.slice(0, target.indexOf(':'))))
      bad(mod, 'is scoped on something that is not a stat key');
    let value = mod.value;
    if (mod.scaleBy) value *= 1 + (facts.scales.get(mod.scaleBy) ?? 0);
    let source = mod.source;
    if (facts.damps.length > 0 && !mod.undampened) {
      const keep = dampingFor(facts, mod.origin, target);
      if (keep < 1) {
        value *= keep;
        source = `${source ?? 'Other'} (dulled)`;
      }
    }
    out.push({
      target,
      op: mod.kind,
      value,
      ...(source !== undefined ? { source } : {}),
      ...(mod.origin ? { origin: mod.origin } : {}),
      ...(mod.undampened ? { undampened: true } : {}),
      ...(mod.fromStat ? { fromStat: mod.fromStat } : {}),
    });
  }
  return out;
}

// ---- attributes ----

/**
 * Effective attribute values: trained base + attribute-targeted modifiers
 * (adds, then mults), then endowment, floored at 1. Fractional.
 */
function effectiveAttrs(facts: Facts, mods: readonly ActiveMod[]): Record<AttributeId, number> {
  const eff = { ...facts.base };
  for (const m of mods) {
    if (m.op === 'add' && isAttrTarget(m.target)) eff[m.target] += m.value;
  }
  for (const m of mods) {
    if (m.op === 'mult' && isAttrTarget(m.target)) eff[m.target] *= 1 + m.value;
  }
  for (const a of ATTRIBUTE_IDS) eff[a] *= 1 + facts.endowment[a];
  for (const a of ATTRIBUTE_IDS) eff[a] = Math.max(1, eff[a]);
  return eff;
}

/** Fusion-aware read: a fused component reads as the sum of both components. */
function attrValueFrom(facts: Facts, eff: Record<AttributeId, number>, attr: AttributeId): number {
  const pair = facts.fused.find(([a, b]) => a === attr || b === attr);
  return pair ? eff[pair[0]] + eff[pair[1]] : eff[attr];
}

/** An attribute as a formula reads it: held to the attribute ceiling when one is set. */
function formulaAttrFrom(facts: Facts, eff: Record<AttributeId, number>, attr: AttributeId): number {
  const value = attrValueFrom(facts, eff, attr);
  return facts.attrCeiling === null ? value : Math.min(value, facts.attrCeiling);
}

// ---- base formulas ----

/** The stat block from attributes alone, before any stat modifier. */
export function baseStats(attr: (id: AttributeId) => number): DerivedStats {
  const maxStamina = 10 + attr('str') * 0.5 + attr('con');
  const maxHp = 40 + attr('con') * 10;
  const maxFocus = 6 + attr('cha') * 0.3 + attr('wis') * 0.1;
  const staminaEff =
    STAMINA_EFF_FLOOR + (1 - STAMINA_EFF_FLOOR) * Math.pow(0.999, attr('str')) * Math.pow(0.9985, attr('dex'));
  return {
    maxHp,
    hpRegen: maxHp * HP_REGEN_SHARE + attr('con') * 0.01,
    damage: BARE_DAMAGE_FLAT + attr('str') * BARE_DAMAGE_PER_STR,
    speed: BASE_SPEED * (1 + attr('dex') * 0.015),
    actionBar: BASE_ACTION_BAR,
    attackSpeed: 1,
    extraSwings: 0,
    dodge: 1 - (1 - DODGE_BASE) * Math.pow(1 - DODGE_PER_DEX, attr('dex')),
    crit: 0.05 + attr('dex') * 0.0015,
    armor: attr('con') * 0.3,
    spellPower: 2 + attr('int') * 1.5,
    skillXp: 1 + attr('int') * 0.01,
    trainXp: 1 + attr('wis') * 0.012,
    loot: 1 + attr('wis') * 0.005,
    goldGain: 1 + attr('cha') * 0.012,
    travelSpeed: 1,
    craftSpeed: 1,
    foodDuration: 1,
    foodPotency: 1,
    critDamage: 2,
    penetration: 0,
    splash: 0,
    parry: 0,
    riposte: PARRY_RIPOSTE,
    maxStamina,
    staminaRegen: maxStamina * STAMINA_REGEN_SHARE + attr('con') * 0.005,
    staminaEff,
    staminaPower: 2 - staminaEff,
    maxMana: attr('int'),
    manaRegen: attr('int') * 0.01 + attr('wis') * 0.05,
    manaEff: Math.pow(0.99967, attr('int')) * Math.pow(0.9999, attr('wis')),
    maxSpirit: 5 + attr('wis') * 0.25 + attr('cha') * 0.1,
    maxFocus,
    focusRegen: maxFocus * FOCUS_REGEN_SHARE + attr('cha') * 0.01,
    psiPressure: 1,
    psiMomentum: 1,
    psiInertia: 1,
    psiAcuity: 1,
    psiAwareness: 1,
    psiCoherence: 1,
    psiPurchase: 1,
    resSlashing: 0,
    resPiercing: 0,
    resBludgeoning: 0,
    resHeat: 0,
    resCold: 0,
    resPoison: 0,
    resAcid: 0,
    resArcane: 0,
    resLightning: 0,
    resEarth: 0,
    resWind: 0,
    resWater: 0,
    resLight: 0,
    resDark: 0,
    damageTaken: 1,
    ward: 0,
    resElemental: 0,
    resRanged: 0,
    critTaken: 1,
    stumbleTaken: 1,
    resistCap: RESIST_CAP,
    vsSmaller: 0,
    fromSmaller: 0,
    vsLarger: 0,
    missRefund: 0,
    graze: 0,
  };
}

/**
 * One resistance after the floor: the floor-carrying conditions may not push
 * it below `floor`, but a value that was already lower before them stays.
 */
export function applyResFloor(value: number, floor: number, taken: number): number {
  const before = value - taken;
  return Math.max(value, Math.min(before, floor));
}

// ---- the block ----

export interface StatBlock {
  stats: DerivedStats;
  /** Effective attributes: no fusion, no ceiling. */
  effective: Record<AttributeId, number>;
  /** Attributes as checks read them: fused components summed, no ceiling. */
  attrs: Record<AttributeId, number>;
  /** Attributes as the stat formulas read them: fused, held to the ceiling. */
  formula: Record<AttributeId, number>;
  /** Resistances that sat above the cap before it was applied, by stat key. */
  uncapped: Partial<Record<StatKey, number>>;
  /** Scoped targets: the summed adds and the product of (1 + mult), by target. */
  scoped: Map<string, { add: number; mult: number }>;
  tags: ReadonlySet<string>;
  named: ReadonlyMap<string, number>;
  /** Fused attribute pairs. */
  fused: readonly (readonly [AttributeId, AttributeId])[];
  /** The modifiers that applied, after gates, scaling and damping. */
  mods: ActiveMod[];
}

export function computeBlock(collected: readonly Modifier[], variant = ''): StatBlock {
  const { facts, plain } = readFacts(collected);
  if (facts.monster) return monsterBlock(facts, plain);
  const mods = activate(facts, plain, vsTagsOf(variant));

  // Layer 1: effective attributes feed the base formulas.
  const eff = effectiveAttrs(facts, mods);
  const attrs = zeroAttrs();
  const formula = zeroAttrs();
  for (const a of ATTRIBUTE_IDS) {
    attrs[a] = attrValueFrom(facts, eff, a);
    formula[a] = formulaAttrFrom(facts, eff, a);
  }
  const stats = baseStats((id) => formula[id]);

  // Layer 2: stat-targeted modifiers. Adds first, then mults. Scoped targets
  // apply only to tagged work and are kept apart.
  const scoped = new Map<string, { add: number; mult: number }>();
  for (const m of mods) {
    if (!isScopedTarget(m.target)) continue;
    const entry = scoped.get(m.target) ?? { add: 0, mult: 1 };
    if (m.op === 'add') entry.add += m.value;
    else entry.mult *= 1 + m.value;
    scoped.set(m.target, entry);
  }
  for (const m of mods) {
    if (isScopedTarget(m.target)) continue;
    if (m.fromStat) continue; // layer 3: its source is not final yet
    if (!isAttrTarget(m.target) && m.op === 'add') stats[m.target as StatKey] += m.value;
  }
  for (const m of mods) {
    if (isScopedTarget(m.target)) continue;
    if (m.fromStat) continue;
    if (m.target === 'attackSpeed') continue; // converging: aggregated below
    if (!isAttrTarget(m.target) && m.op === 'mult') stats[m.target as StatKey] *= 1 + m.value;
  }
  // Attack speed converges: each source multiplies the remaining attack time
  // by (1 - v), and no single source erases more than half the time or more
  // than doubles it.
  let timeMult = 1;
  for (const m of mods) {
    if (m.target !== 'attackSpeed' || m.op !== 'mult') continue;
    timeMult *= Math.min(2, Math.max(1 - ATTACK_SPEED_MOD_CAP, 1 - m.value));
  }
  stats.attackSpeed /= timeMult;
  stats.dodge = Math.min(0.75, Math.max(0, stats.dodge));
  stats.crit = Math.min(0.9, Math.max(0, stats.crit));
  stats.damage = Math.max(0.5, stats.damage);
  stats.maxHp = Math.max(1, Math.floor(stats.maxHp));
  stats.hpRegen = round4(Math.max(0, stats.hpRegen));
  stats.critDamage = Math.max(1, stats.critDamage);
  stats.penetration = Math.min(0.6, Math.max(0, stats.penetration));
  stats.splash = Math.min(1, Math.max(0, stats.splash));
  stats.parry = Math.min(PARRY_CAP, Math.max(0, stats.parry));
  stats.riposte = Math.max(0, stats.riposte);
  stats.speed = Math.max(1, stats.speed);
  stats.actionBar = Math.max(MIN_ACTION_BAR, stats.actionBar);
  stats.attackSpeed = Math.max(0.1, stats.attackSpeed);
  stats.craftSpeed = Math.max(0.1, stats.craftSpeed);
  stats.foodDuration = Math.min(FOOD_MULT_CAP, Math.max(0, stats.foodDuration));
  stats.foodPotency = Math.min(FOOD_MULT_CAP, Math.max(0, stats.foodPotency));
  stats.extraSwings = Math.max(0, stats.extraSwings);
  // The attack-time floor: speed past it becomes extra hits per swing.
  {
    const interval = stats.actionBar / (stats.speed * stats.attackSpeed);
    if (interval < MIN_ATTACK_TICKS) {
      stats.extraSwings += MIN_ATTACK_TICKS / interval - 1;
      stats.attackSpeed = stats.actionBar / (MIN_ATTACK_TICKS * stats.speed);
    }
  }
  // Every pool capacity is a whole number.
  stats.maxStamina = Math.floor(Math.max(0, stats.maxStamina));
  stats.staminaRegen = round4(Math.max(0, stats.staminaRegen));
  stats.staminaEff = Math.min(1, Math.max(STAMINA_EFF_FLOOR, stats.staminaEff));
  stats.staminaPower = Math.max(0, stats.staminaPower);
  stats.maxMana = Math.floor(Math.max(0, stats.maxMana));
  stats.manaRegen = round4(Math.max(0, stats.manaRegen));
  stats.manaEff = Math.min(1, Math.max(0, stats.manaEff));
  stats.maxSpirit = Math.floor(Math.max(0, stats.maxSpirit));
  stats.maxFocus = Math.floor(Math.max(0, stats.maxFocus));
  stats.focusRegen = round4(Math.max(0, stats.focusRegen));

  // A condition may dictate a resistance. Resolved after the normal pipeline,
  // before the cap, in modifier order.
  const overrides: Partial<Record<DamageType, number>> = {};
  for (const spec of facts.resOverrides) {
    const now = overrides[spec.type] ?? stats[RES_STAT_BY_TYPE[spec.type]];
    overrides[spec.type] = spec.bonusIfMet !== undefined && now >= spec.to ? now + spec.bonusIfMet : spec.to;
  }
  for (const [type, value] of Object.entries(overrides) as [DamageType, number][]) {
    stats[RES_STAT_BY_TYPE[type]] = value;
  }
  // The ceiling is itself a stat.
  const cap = Math.max(0, stats.resistCap);
  const uncapped: Partial<Record<StatKey, number>> = {};
  for (const key of RES_KEYS) {
    if (stats[key] > cap) uncapped[key] = stats[key];
    stats[key] = Math.min(cap, stats[key]);
    if (facts.resFloor !== undefined)
      stats[key] = applyResFloor(stats[key], facts.resFloor, facts.resFloorTaken[key] ?? 0);
  }

  // Layer 3: modifiers whose value is scaled by another stat. Last, so every
  // source reads its final, clamped value. Sources are read before anything
  // is written, so the pass cannot feed itself.
  const derived = mods.filter((m) => m.fromStat && !isScopedTarget(m.target) && !isAttrTarget(m.target));
  if (derived.length > 0) {
    const before = { ...stats };
    for (const m of derived) {
      const from = before[m.fromStat!];
      if (!Number.isFinite(from)) continue;
      const value = m.value * from;
      if (m.op === 'add') stats[m.target as StatKey] += value;
      else stats[m.target as StatKey] *= 1 + value;
    }
    stats.damage = Math.max(0.5, stats.damage);
    stats.maxHp = Math.max(1, Math.floor(stats.maxHp));
  }

  return { stats, effective: eff, attrs, formula, uncapped, scoped, tags: facts.tags, named: facts.named, fused: facts.fused, mods };
}

/**
 * The block of a monster entity. The monster formulas of `monster.ts` replace
 * layers 1 to 8. Gates, scaling, damping and the attribute ceiling are not
 * applied: the old monster pipeline read the raw modifiers of its conditions.
 * The variant is ignored: a monster has no target-gated bonus.
 */
function monsterBlock(facts: Facts, plain: readonly StatMod[]): StatBlock {
  const block = computeMonsterBlock(
    {
      fact: facts.monster!,
      base: facts.base,
      resOverrides: facts.resOverrides,
      resFloor: facts.resFloor,
      resFloorTaken: facts.resFloorTaken,
    },
    plain,
  );
  const mods: ActiveMod[] = plain.map((mod) => ({
    target: mod.stat.slice(STATS_PREFIX.length),
    op: mod.kind,
    value: mod.value,
    ...(mod.source !== undefined ? { source: mod.source } : {}),
    ...(mod.origin ? { origin: mod.origin } : {}),
    ...(mod.fromStat ? { fromStat: mod.fromStat } : {}),
  }));
  return {
    stats: block.stats,
    effective: block.attrs,
    attrs: block.attrs,
    formula: block.attrs,
    uncapped: block.uncapped,
    scoped: new Map(),
    tags: facts.tags,
    named: facts.named,
    fused: [],
    mods,
  };
}

/** Kernel ids built once, not per table: the same strings in the same order. */
const STAT_TABLE_IDS: readonly string[] = STAT_KEYS.map((key) => STATS_PREFIX + key);
const ATTR_TABLE_IDS: readonly (readonly [AttributeId, string, string, string])[] = ATTRIBUTE_IDS.map((a) => [
  a,
  `${STATS_PREFIX}attr:${a}`,
  `${STATS_PREFIX}eff:${a}`,
  `${STATS_PREFIX}formula:${a}`,
]);
const UNARMED_ID = `${STATS_PREFIX}unarmedDamage`;

/** The stat table of a block, keyed as the kernel serves it. */
export function tableOf(block: StatBlock): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < STAT_KEYS.length; i++) out[STAT_TABLE_IDS[i]] = block.stats[STAT_KEYS[i]];
  for (const [a, attr, eff, formula] of ATTR_TABLE_IDS) {
    out[attr] = block.attrs[a];
    out[eff] = block.effective[a];
    out[formula] = block.formula[a];
  }
  out[UNARMED_ID] = BARE_DAMAGE_FLAT + block.formula.str * BARE_DAMAGE_PER_STR;
  for (const [key, value] of Object.entries(block.uncapped)) out[`${STATS_PREFIX}uncapped:${key}`] = value;
  for (const [target, { add, mult }] of block.scoped) {
    out[`${STATS_PREFIX}scopedAdd:${target}`] = add;
    out[`${STATS_PREFIX}scopedMult:${target}`] = mult;
  }
  for (const tag of block.tags) out[`${STATS_PREFIX}tag:${tag}`] = 1;
  for (const [name, value] of block.named) out[`${STATS_PREFIX}fact:${name}`] = value;
  return out;
}
