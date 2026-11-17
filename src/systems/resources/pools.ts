/**
 * Resource pools. Port of the old `systems/resources.ts` and
 * `data/resources.data.ts`.
 *
 * Every pool has two capacities:
 * - its true max, the derived stat (`maxHp`, `maxStamina`, ...). The reserve
 *   floor is measured against it;
 * - its available max, the true max after whatever is clamping the pool (a
 *   wound sealing off part of it).
 *
 * The functions here work on a `Pools` object: the slice, the stat block read
 * at the start of the handler, the hook values, and a callback for what
 * happened. `index.ts` builds one per handler.
 */
import { registry, s, type DeepReadonly, type RecordOf } from '../../kernel';
import { contentMod, modifierSchema, STAT_KEYS, type DerivedStats, type StatMod } from '../stats';
import resourcesData from './content/resources.json';

export const RESOURCE_IDS = ['hp', 'stamina', 'mana', 'spirit', 'focus'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export type ResourceLock = 'none' | 'low' | 'empty';

// ---- content ----

export const resources = registry(
  s.object({
    id: s.enum(RESOURCE_IDS),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Art key.' })),
    cssVar: s.string({ help: 'Colour token of the old interface. Not read here.' }),
    maxStat: s.enum(STAT_KEYS, { help: 'The stat that is the true max.' }),
    regenStat: s.optional(s.enum(STAT_KEYS, { help: 'Per-second regeneration.' })),
    viaHeal: s.optional(s.boolean({ help: 'Recovers through heal, not through the pool tick.' })),
    restRegenMult: s.optional(s.number({ min: 0, help: 'Regeneration multiplier while resting.' })),
    effStat: s.optional(s.enum(STAT_KEYS)),
    static: s.optional(s.boolean({ help: 'Always full: set to its available max every tick.' })),
    reserve: s.optional(
      s.object({
        share: s.number({ min: 0, max: 1, help: 'Ordinary spending stops at this share of true max.' }),
        lowName: s.string(),
        emptyName: s.string(),
        lowIcon: s.string(),
        emptyIcon: s.string(),
        lowCssVar: s.optional(s.string()),
        emptyCssVar: s.optional(s.string()),
        lowMsg: s.string(),
        emptyMsg: s.string(),
        clearedMsg: s.string(),
        emptyRegenMult: s.number({ min: 0, help: 'Regeneration multiplier while empty-locked and below slowUntil.' }),
        slowUntil: s.number({ min: 0, max: 1, help: 'Share of true max the slowed regeneration lasts to.' }),
        emptyPenalty: s.optional(s.array(modifierSchema, { help: 'Modifiers while empty-locked.' })),
      }),
    ),
  }),
  resourcesData,
  'Resource pools',
);

export type ResourceDef = RecordOf<typeof resources>;

export const RESOURCE_LIST = resourcesData as ResourceDef[];
export const RESOURCES = Object.fromEntries(RESOURCE_LIST.map((r) => [r.id, r])) as Record<ResourceId, ResourceDef>;

/**
 * How restful each activity is, as a multiplier on the `hpRegen` stat.
 * `none` is nothing selected, the baseline the stat is tuned against.
 */
export const RECOVERY_MULT = {
  rest: 15,
  job: 4,
  train: 2,
  gather: 2,
  craft: 2,
  explore: 1,
  search: 1,
  hunt: 1,
  none: 1,
} as const;

/** What a live fight does to the health trickle while stamina is below its ceiling. */
export const IN_COMBAT_REGEN_MULT = 0.5;

// ---- slice ----

export type HealKind = 'rest' | 'idle' | 'salve' | 'draught' | 'spell' | 'lifesteal' | 'other';

export interface Pace {
  /** Resting: pools with `restRegenMult` refill faster. */
  resting: boolean;
  /** Multiplier on the health trickle. 0 stops it. */
  hpMult: number;
  /** The heal kind the trickle is recorded as. */
  healKind: HealKind;
  /** No regeneration and no trickle at all (the old loop did not tick pools while travelling). */
  halted: boolean;
  /** A fight is open. The health trickle is halved while stamina is below its available max. */
  inCombat: boolean;
}

export interface ResourcesState {
  values: Record<ResourceId, number>;
  /** A pool absent here is not locked. */
  locks: Partial<Record<ResourceId, ResourceLock>>;
  /** The player has opted in to the style's exertion bargain. */
  exerting: boolean;
  /** The lock of each pool as last written to the log. */
  announced: Partial<Record<ResourceId, ResourceLock>>;
  pace: Pace;
}

type ReadState = DeepReadonly<ResourcesState>;

// ---- hooks ----

/**
 * Values another system sets through a modifier source, read here as stats of
 * this system with the kernel's default formula.
 */
export interface PoolHooks {
  /** Share of true max left usable, 0 to 1. Mult modifiers on `resources/ceiling.<id>`. */
  ceiling(id: ResourceId): number;
  /** Multiplier on what spending costs. `resources/costMult.<id>`. */
  costMult(id: ResourceId): number;
  /** Above 0: the pool does not regenerate. `resources/regenBlocked.<id>`. */
  regenBlocked(id: ResourceId): number;
  /** How far below zero the pool may go, as a share of true max. `resources/headroom.<id>`. */
  headroom(id: ResourceId): number;
  /** Multiplier on every pool's regeneration. `resources/regenMult`. */
  regenMult(): number;
  /** The most healing allowed right now. Infinity when nothing caps it. */
  healAllowance(): number;
}

export const hookStat = {
  ceiling: (id: ResourceId) => `resources/ceiling.${id}`,
  costMult: (id: ResourceId) => `resources/costMult.${id}`,
  regenBlocked: (id: ResourceId) => `resources/regenBlocked.${id}`,
  headroom: (id: ResourceId) => `resources/headroom.${id}`,
  regenMult: 'resources/regenMult',
  healCapped: 'resources/healCapped',
  healAllowance: 'resources/healAllowance',
} as const;

export type PoolNote =
  | { type: 'spent'; id: ResourceId; spent: number; max: number }
  | { type: 'lock'; id: ResourceId; lock: ResourceLock };

export interface Pools {
  state: ResourcesState;
  stats: DerivedStats;
  hooks: PoolHooks;
  /** Told what happened, so the system can emit events and touch its source. */
  note(note: PoolNote): void;
}

// ---- reads ----

/** Round to 4 decimals. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export function resourceValue(state: ReadState, id: ResourceId): number {
  return state.values[id] ?? 0;
}

export function resourceLock(state: ReadState, id: ResourceId): ResourceLock {
  return state.locks[id] ?? 'none';
}

/** True while the pool may still be spent (neither low- nor empty-locked). */
export function resourceReady(state: ReadState, id: ResourceId): boolean {
  return resourceLock(state, id) === 'none';
}

/** The pool's full size, before anything clamps it. */
export function trueMax(stats: DerivedStats, id: ResourceId): number {
  return Math.max(0, stats[RESOURCES[id].maxStat]);
}

/** The pool's usable size right now: true max, less anything clamping it. Floored. */
export function availableMax(stats: DerivedStats, hooks: Pick<PoolHooks, 'ceiling'>, id: ResourceId): number {
  return Math.floor(trueMax(stats, id) * Math.max(0, hooks.ceiling(id)));
}

/** The floor ordinary spending stops at, measured against true max. */
export function reserveFloor(stats: DerivedStats, id: ResourceId): number {
  const reserve = RESOURCES[id].reserve;
  return reserve ? trueMax(stats, id) * reserve.share : 0;
}

/** Per-second regeneration of a pool, as one tick's share. */
export function regenPerTick(stats: DerivedStats, id: ResourceId, tps: number, mult = 1): number {
  const stat = RESOURCES[id].regenStat;
  return stat ? (stats[stat] * mult) / tps : 0;
}

/** Current value and true max of every pool. */
export function poolSnapshots(
  state: ReadState,
  stats: DerivedStats,
): Record<ResourceId, { current: number; trueMax: number }> {
  const out = {} as Record<ResourceId, { current: number; trueMax: number }>;
  for (const def of RESOURCE_LIST) out[def.id] = { current: resourceValue(state, def.id), trueMax: trueMax(stats, def.id) };
  return out;
}

/** The penalties every empty-locked pool imposes, as modifiers. */
export function lockMods(state: ReadState): StatMod[] {
  const out: StatMod[] = [];
  for (const def of RESOURCE_LIST) {
    if (!def.reserve?.emptyPenalty) continue;
    if (resourceLock(state, def.id) !== 'empty') continue;
    for (const mod of def.reserve.emptyPenalty) out.push(contentMod(mod, def.reserve.emptyName, undefined));
  }
  return out;
}

// ---- writes ----

export function setResource(pools: Pools, id: ResourceId, value: number, floor = 0): void {
  pools.state.values[id] = round4(Math.max(floor, value));
}

function setLock(pools: Pools, id: ResourceId, lock: ResourceLock): void {
  if (resourceLock(pools.state, id) === lock) return;
  pools.state.locks[id] = lock;
  pools.note({ type: 'lock', id, lock });
}

/**
 * Spend from a pool, ignoring the reserve floor. Reaching zero latches the
 * empty lock. Returns the amount paid. With `max` (the true max), the spend
 * is reported, for a condition that eats a share of what is spent.
 */
export function spendResource(pools: Pools, id: ResourceId, amount: number, max?: number): number {
  const have = resourceValue(pools.state, id);
  const spent = Math.min(have, Math.max(0, amount));
  setResource(pools, id, have - spent);
  if (resourceValue(pools.state, id) <= 0 && RESOURCES[id].reserve) setLock(pools, id, 'empty');
  if (max !== undefined && spent > 0 && max > 0) pools.note({ type: 'spent', id, spent, max });
  return spent;
}

/**
 * Spend from a pool while respecting its reserve floor: pays what it can,
 * latches the low lock on reaching the floor, and pays nothing while locked.
 * Returns the amount spent.
 */
export function drawResource(pools: Pools, id: ResourceId, want: number): number {
  if (want <= 0 || !resourceReady(pools.state, id)) return 0;
  const floor = reserveFloor(pools.stats, id);
  const available = resourceValue(pools.state, id) - floor;
  if (available <= 0) {
    // At or under the floor without a lock, e.g. the max just grew. Latch
    // now, so the pool has to refill before it pays out again.
    if (RESOURCES[id].reserve) setLock(pools, id, 'low');
    return 0;
  }
  const spent = spendResource(pools, id, Math.min(want, available), trueMax(pools.stats, id));
  // spendResource latches the empty lock at zero; the floor is handled here.
  if (resourceReady(pools.state, id) && resourceValue(pools.state, id) <= floor + 1e-6) setLock(pools, id, 'low');
  return spent;
}

/** Draw a pool down, past zero when a condition gives it headroom. Returns the amount drawn. */
export function drainIntoDebt(pools: Pools, id: ResourceId, amount: number): number {
  const before = resourceValue(pools.state, id);
  const floor = -(trueMax(pools.stats, id) * pools.hooks.headroom(id));
  setResource(pools, id, before - amount, floor);
  return before - resourceValue(pools.state, id);
}

/** Put value back into a pool, up to its available max. Returns the amount restored. */
export function restoreResource(pools: Pools, id: ResourceId, amount: number): number {
  if (amount <= 0) return 0;
  const before = resourceValue(pools.state, id);
  const max = availableMax(pools.stats, pools.hooks, id);
  setResource(pools, id, Math.min(max, before + amount));
  return resourceValue(pools.state, id) - before;
}

/**
 * One tick of recovery for one pool. An empty-locked pool regenerates at
 * `emptyRegenMult` until it passes `slowUntil`; any lock clears when the pool
 * reaches its available max.
 */
export function regenResource(pools: Pools, id: ResourceId, perTick: number): void {
  const def = RESOURCES[id];
  const { state, stats, hooks } = pools;
  const max = availableMax(stats, hooks, id);
  if (max <= 0) return; // no pool: nothing to latch
  if (hooks.regenBlocked(id) > 0) return;

  if (def.static) {
    setResource(pools, id, max);
    return;
  }

  // A pool in debt recovers toward zero first.
  if (resourceValue(state, id) < 0) {
    setResource(pools, id, Math.min(0, resourceValue(state, id) + perTick), -Infinity);
    return;
  }

  const lock = resourceLock(state, id);
  const reserve = def.reserve;
  const crawling = !!reserve && lock === 'empty' && resourceValue(state, id) < trueMax(stats, id) * reserve.slowUntil;
  const gain = perTick * (crawling ? reserve!.emptyRegenMult : 1) * hooks.regenMult();
  setResource(pools, id, Math.min(max, resourceValue(state, id) + gain));

  if (!reserve) return;
  if (resourceValue(state, id) <= 0) setLock(pools, id, 'empty');
  else if (lock !== 'none' && resourceValue(state, id) >= max) setLock(pools, id, 'none');
}

/**
 * One tick for every pool: clamp to the available max, then regenerate. A
 * pool with no regen stat is only clamped, and so is one that recovers
 * through heal.
 */
export function tickResources(pools: Pools, tps: number, resting = false): void {
  for (const def of RESOURCE_LIST) {
    const max = availableMax(pools.stats, pools.hooks, def.id);
    if (resourceValue(pools.state, def.id) > max) setResource(pools, def.id, max);
    if (def.viaHeal) continue;
    const mult = resting ? (def.restRegenMult ?? 1) : 1;
    if (def.static || def.regenStat) regenResource(pools, def.id, regenPerTick(pools.stats, def.id, tps, mult));
  }
}
