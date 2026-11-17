/**
 * The stat block: derived stats and effective attributes of an entity. Port
 * of the pipeline in the old `systems/derived.ts` and of the attribute layer
 * in the old `systems/attributes.ts`. See README.md in this folder.
 *
 * This system holds no state and registers no modifier source. It is the
 * resolver of every target under `stats/`: other systems register sources
 * that emit modifiers and facts, and this system turns the collected list
 * into the block.
 */
import { defineSystem, type DerivedReads } from '../../kernel';
import { ATTRIBUTE_IDS, STAT_KEYS, type AttributeId, type DerivedStats, type StatKey } from './keys';
import { STATS_PREFIX } from './mods';
import { computeBlock, tableOf } from './pipeline';
import { migrations } from './migrations';

export * from './breakdown';
export * from './keys';
export * from './mods';
export * from './monster';
export * from './pipeline';

type Reads = Pick<DerivedReads, 'derived' | 'stats'>;

/** The kernel id of a derived stat. */
export function statId(key: StatKey): string {
  return STATS_PREFIX + key;
}

/** One derived stat of an entity. */
export function statOf(ctx: Reads, key: StatKey, entity?: string, variant?: string): number {
  return ctx.derived(STATS_PREFIX + key, entity, variant);
}

const BLOCKS = new WeakMap<ReadonlyMap<string, number>, DerivedStats>();
/** The kernel ids of the stat keys, in key order: built once, not per block. */
const STAT_IDS: readonly string[] = STAT_KEYS.map((key) => STATS_PREFIX + key);

/**
 * The whole stat block of an entity. The object is shared by every caller
 * until a modifier source changes: read it, do not write to it.
 */
export function statBlockOf(ctx: Reads, entity?: string, variant?: string): Readonly<DerivedStats> {
  const table = ctx.stats(entity, variant);
  let block = BLOCKS.get(table);
  if (!block) {
    block = {} as DerivedStats;
    for (let i = 0; i < STAT_KEYS.length; i++) block[STAT_KEYS[i]] = table.get(STAT_IDS[i])!;
    BLOCKS.set(table, block);
  }
  return block;
}

/**
 * An attribute as every check reads it: trained base plus every bonus, with
 * fused components read as their sum. Not held to the attribute ceiling.
 */
export function attrValue(ctx: Reads, attr: AttributeId, entity?: string): number {
  return ctx.derived(`${STATS_PREFIX}attr:${attr}`, entity);
}

/** An attribute's effective value: no fusion, no ceiling. */
export function effectiveAttr(ctx: Reads, attr: AttributeId, entity?: string): number {
  return ctx.derived(`${STATS_PREFIX}eff:${attr}`, entity);
}

/** An attribute as the stat formulas read it: fused, held to the attribute ceiling. */
export function formulaAttr(ctx: Reads, attr: AttributeId, entity?: string): number {
  return ctx.derived(`${STATS_PREFIX}formula:${attr}`, entity);
}

/** The six attributes at their real value (`attrValue`), as a new object. */
export function finalAttributes(ctx: Reads, entity?: string): Record<AttributeId, number> {
  const out = {} as Record<AttributeId, number>;
  for (const a of ATTRIBUTE_IDS) out[a] = attrValue(ctx, a, entity);
  return out;
}

/** What the body hits for with nothing in its hands: attributes alone. */
export function unarmedDamage(ctx: Reads, entity?: string): number {
  return ctx.derived(`${STATS_PREFIX}unarmedDamage`, entity);
}

/** Whether a worn or wielded item carries the tag. Bare hands carry `unarmed`. */
export function hasWieldTag(ctx: Reads, tag: string, entity?: string): boolean {
  return ctx.stats(entity).has(`${STATS_PREFIX}tag:${tag}`);
}

/** A named fact (`namedFact`), 0 when no source states it. */
export function factValue(ctx: Reads, name: string, entity?: string): number {
  return ctx.stats(entity).get(`${STATS_PREFIX}fact:${name}`) ?? 0;
}

/**
 * A resistance before the cap was applied. Equal to the stat when it did not
 * exceed the cap. Condition immunity reads this.
 */
export function uncappedResistance(ctx: Reads, key: StatKey, entity?: string): number {
  const table = ctx.stats(entity);
  return table.get(`${STATS_PREFIX}uncapped:${key}`) ?? table.get(STATS_PREFIX + key)!;
}

/**
 * The multiplier scoped modifiers give `stat` for work carrying `tags`. 1
 * when nothing matches. Every matching add first, then every matching mult.
 */
export function scopedMult(ctx: Reads, stat: StatKey, tags: readonly string[], entity?: string): number {
  if (tags.length === 0) return 1;
  const table = ctx.stats(entity);
  let add = 0;
  let mult = 1;
  let matched = false;
  for (const tag of new Set(tags)) {
    const a = table.get(`${STATS_PREFIX}scopedAdd:${stat}:${tag}`);
    if (a === undefined) continue;
    matched = true;
    add += a;
    mult *= table.get(`${STATS_PREFIX}scopedMult:${stat}:${tag}`)!;
  }
  return matched ? (1 + add) * mult : 1;
}

/** Combat attack fill per tick: speed scaled by the attack-speed multiplier. */
export function attackFillRate(stats: Pick<DerivedStats, 'speed' | 'attackSpeed'>): number {
  return stats.speed * stats.attackSpeed;
}

/** Estimated ticks for an action bar of `size` units to fill at `fillPerTick`. */
export function actionTicks(size: number, fillPerTick: number): number {
  return size / Math.max(0.001, fillPerTick);
}

export interface StatsView {
  stats: DerivedStats;
  /** Attributes as checks read them. */
  attrs: Record<AttributeId, number>;
  effective: Record<AttributeId, number>;
}

export default defineSystem<Record<string, never>, StatsView>({
  id: 'stats',
  version: 1,
  migrations,
  initial: () => ({}),
  resolve: ({ mods, variant }) => tableOf(computeBlock(mods, variant)),
  view: (ctx) => {
    const effective = {} as Record<AttributeId, number>;
    for (const a of ATTRIBUTE_IDS) effective[a] = effectiveAttr(ctx, a);
    return { stats: { ...statBlockOf(ctx) }, attrs: finalAttributes(ctx), effective };
  },
});
