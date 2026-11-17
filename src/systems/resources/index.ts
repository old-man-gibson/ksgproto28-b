/**
 * Resource pools (HP, stamina, mana, spirit, focus), stamina's fighting
 * rules, and health. Port of the old `systems/resources.ts`,
 * `systems/stamina.ts`, `systems/health.ts` and `data/resources.data.ts`.
 * See README.md in this folder.
 */
import {
  answer,
  defineCommand,
  defineEvent,
  defineRequest,
  defineSystem,
  handle,
  OK,
  on,
  PLAYER,
  skipped,
  TPS,
  type Ctx,
  type DerivedReads,
  type StatDef,
} from '../../kernel';
import { logLine } from '../log';
import { statBlockOf, type DamageType } from '../stats';
import { damagePlayer, heal, setHpAfterDefeat, type DamageSource, type HealResult } from './health';
import {
  availableMax,
  drainIntoDebt,
  drawResource,
  hookStat,
  IN_COMBAT_REGEN_MULT,
  lockMods,
  resourceLock,
  resources,
  RESOURCE_IDS,
  RESOURCE_LIST,
  restoreResource,
  spendResource,
  tickResources,
  trueMax,
  type HealKind,
  type Pace,
  type PoolHooks,
  type Pools,
  type ResourceId,
  type ResourceLock,
  type ResourcesState,
} from './pools';
import { exert, type Exertion, type ExertionSpec } from './stamina';
import { resourceValue } from './pools';
import { migrations } from './migrations';

export * from './health';
export * from './pools';
export * from './stamina';

// ---- events and commands ----

/** Command: opt in to, or out of, the style's exertion bargain. */
export const setExerting = defineCommand<{ on: boolean }>('resources/set-exerting');

/** Request: spend from a pool, ignoring the reserve floor. */
export const spendPool = defineEvent<{ id: ResourceId; amount: number }>('resources/spend');
/** Request: spend from a pool, respecting the reserve floor. */
export const drawPool = defineEvent<{ id: ResourceId; amount: number }>('resources/draw');
/** Request: put value back into a pool, up to its available max. */
export const restorePool = defineEvent<{ id: ResourceId; amount: number }>('resources/restore');
/** Request: draw a pool down, past zero when a condition gives it headroom. */
export const drainPool = defineEvent<{ id: ResourceId; amount: number }>('resources/drain');
/** Request: restore health. */
export const healPlayer = defineEvent<{ amount: number; kind?: HealKind }>('resources/heal');
/**
 * Request: take damage, already reduced by every defence. `source: null`
 * means the damage is already attributed (a tick of conditions with its own
 * breakdown); an absent source is recorded as unknown.
 */
export const hurtPlayer = defineEvent<{ amount: number; type?: DamageType; source?: DamageSource | null }>(
  'resources/damage',
);
/** Request: drop to the 1 HP a knockout leaves. */
export const defeatPlayer = defineEvent<void>('resources/defeat');
/** Request: burn a pool for a style's per-event payoff. The result is `exerted`. */
export const exertPool = defineEvent<{ spec: ExertionSpec }>('resources/exert');
/** Request: set what the current activity does to regeneration. Absent fields keep their value. */
export const setPace = defineEvent<Partial<Pace>>('resources/set-pace');

/** A pool was spent through `draw` (or `spend` by this system with the true max known). */
export const poolSpent = defineEvent<{ id: ResourceId; spent: number; max: number }>('resources/spent');
/** A pool's lock changed. */
export const lockChanged = defineEvent<{ id: ResourceId; lock: ResourceLock }>('resources/lock-changed');
/** A heal was applied, including one the heal cap reduced to nothing. */
export const playerHealed = defineEvent<HealResult>('resources/healed');
/** The player lost health. */
export const playerDamaged = defineEvent<{ lost: number; type?: DamageType; source?: DamageSource | null }>(
  'resources/damaged',
);
/** What an exertion bought. */
export const exerted = defineEvent<Exertion>('resources/exerted');

// ---- requests: same-handler results (docs/KERNEL.md section 7a) ----
//
// The fight resolves a blow, checks whether the player still stands, and
// spends stamina before it reads what an exertion can still buy, all inside
// one handler. Each request below does what the event of the same meaning
// does, emits the same result event, and also answers the result.

/** Take damage, already reduced by every defence. Answers the health lost. Emits `resources/damaged`. */
export const hitPlayer = defineRequest<{ amount: number; type?: DamageType; source?: DamageSource | null }, number>(
  'resources/hit',
);
/** Restore health. Answers what the heal did, or null for an amount of 0 or less. Emits `resources/healed`. */
export const healNow = defineRequest<{ amount: number; kind?: HealKind }, HealResult | null>('resources/heal-now');
/** Burn a pool for a style's per-event payoff. Answers what it bought. Emits `resources/exerted`. */
export const exertNow = defineRequest<{ spec: ExertionSpec | undefined }, Exertion>('resources/exert-now');
/** Spend from a pool, respecting the reserve floor. Answers the amount spent. */
export const drawNow = defineRequest<{ id: ResourceId; amount: number }, number>('resources/draw-now');
/** Spend from a pool, ignoring the reserve floor. Answers the amount spent. */
export const spendNow = defineRequest<{ id: ResourceId; amount: number }, number>('resources/spend-now');

// ---- stats: hooks for other systems ----

const stats: Record<string, StatDef> = { [hookStat.regenMult]: { base: 1 }, [hookStat.healCapped]: { base: 0 }, [hookStat.healAllowance]: { base: 0 } };
for (const id of RESOURCE_IDS) {
  stats[hookStat.ceiling(id)] = { base: 1 };
  stats[hookStat.costMult(id)] = { base: 1 };
  stats[hookStat.regenBlocked(id)] = { base: 0 };
  stats[hookStat.headroom(id)] = { base: 0 };
}

const HOOKS = new WeakMap<ReadonlyMap<string, number>, PoolHooks>();

/**
 * The hook values of an entity, read from the stat table. The object is
 * shared by every caller until a modifier source changes.
 */
export function poolHooks(ctx: Pick<DerivedReads, 'stats'>, entity: string = PLAYER): PoolHooks {
  const table = ctx.stats(entity);
  let hooks = HOOKS.get(table);
  if (!hooks) {
    const per = (name: (id: ResourceId) => string) =>
      Object.fromEntries(RESOURCE_IDS.map((id) => [id, table.get(name(id))!])) as Record<ResourceId, number>;
    const ceiling = per(hookStat.ceiling);
    const costMult = per(hookStat.costMult);
    const regenBlocked = per(hookStat.regenBlocked);
    const headroom = per(hookStat.headroom);
    const regenMult = table.get(hookStat.regenMult)!;
    const healAllowance =
      table.get(hookStat.healCapped)! > 0 ? Math.max(0, table.get(hookStat.healAllowance)!) : Infinity;
    hooks = {
      ceiling: (id) => ceiling[id],
      costMult: (id) => costMult[id],
      regenBlocked: (id) => regenBlocked[id],
      headroom: (id) => headroom[id],
      regenMult: () => regenMult,
      healAllowance: () => healAllowance,
    };
    HOOKS.set(table, hooks);
  }
  return hooks;
}

// ---- source ----

/** Touched when a lock or the exerting flag changes. A source that reads either depends on it. */
export const LOCKS_SOURCE = 'resources/locks';

function poolsOf(ctx: Ctx<ResourcesState>): Pools {
  return {
    state: ctx.state,
    stats: statBlockOf(ctx),
    hooks: poolHooks(ctx),
    note: (note) => {
      if (note.type === 'spent') ctx.emit(poolSpent, { id: note.id, spent: note.spent, max: note.max });
      else {
        ctx.touch(LOCKS_SOURCE);
        ctx.emit(lockChanged, { id: note.id, lock: note.lock });
      }
    },
  };
}

/** Write each reserve pool's lock change to the log, once per change. */
function announceLocks(ctx: Ctx<ResourcesState>): void {
  for (const def of RESOURCE_LIST) {
    const reserve = def.reserve;
    if (!reserve) continue;
    const lock = resourceLock(ctx.state, def.id);
    if (lock === (ctx.state.announced[def.id] ?? 'none')) continue;
    ctx.state.announced[def.id] = lock;
    const msg = lock === 'empty' ? reserve.emptyMsg : lock === 'low' ? reserve.lowMsg : reserve.clearedMsg;
    ctx.emit(logLine, { msg, kind: 'combat' });
  }
}

function applyHeal(ctx: Ctx<ResourcesState>, pools: Pools, amount: number, kind: HealKind): HealResult | null {
  const result = heal(pools, amount, kind);
  if (result) ctx.emit(playerHealed, result);
  return result;
}

function applyDamage(
  ctx: Ctx<ResourcesState>,
  payload: { amount: number; type?: DamageType; source?: DamageSource | null },
): number {
  const lost = damagePlayer(poolsOf(ctx), payload.amount);
  ctx.emit(playerDamaged, {
    lost,
    ...(payload.type ? { type: payload.type } : {}),
    ...(payload.source !== undefined ? { source: payload.source } : {}),
  });
  return lost;
}

/**
 * What a live fight does to the health trickle: half while stamina is below
 * its available max, the whole otherwise. The old `combatRegenMult`.
 */
export function combatRegenMult(pools: Pools): number {
  if (!pools.state.pace.inCombat) return 1;
  const full = availableMax(pools.stats, pools.hooks, 'stamina');
  return resourceValue(pools.state, 'stamina') < full - 1e-6 ? IN_COMBAT_REGEN_MULT : 1;
}

// ---- view ----

export interface PoolView {
  id: ResourceId;
  name: string;
  icon: string;
  value: number;
  /** Available max. */
  max: number;
  trueMax: number;
  lock: ResourceLock;
  /** Name of the lock state, or null when not locked. */
  lockName: string | null;
  /** Share of true max ordinary spending stops at, or 0. */
  reserve: number;
}

export interface ResourcesView {
  pools: PoolView[];
  exerting: boolean;
}

const pool = (id: ResourceId): boolean => (RESOURCE_IDS as readonly string[]).includes(id);

// ---- the declaration ----

export default defineSystem<ResourcesState, ResourcesView>({
  id: 'resources',
  version: 2,
  migrations,
  // Every pool starts full at its level-1 capacity.
  initial: () => ({
    values: { hp: 50, stamina: 11, mana: 1, spirit: 5, focus: 6 },
    locks: {},
    exerting: false,
    announced: {},
    pace: { resting: false, hpMult: 1, healKind: 'idle', halted: false, inCombat: false },
  }),
  content: { resources },
  stats,

  modifiers: [
    {
      id: LOCKS_SOURCE,
      collect: ({ state, entity }) => (entity === PLAYER ? lockMods(state) : []),
    },
  ],

  tick: (ctx) => {
    const { pace } = ctx.state;
    if (!pace.halted) {
      const pools = poolsOf(ctx);
      // Every pool is clamped to its available max and topped up in one pass.
      tickResources(pools, TPS, pace.resting);
      // The health trickle: the hpRegen stat times how restful the activity
      // is. Through heal, so the heal cap and the observers still apply.
      if (pace.hpMult > 0)
        applyHeal(ctx, pools, (pools.stats.hpRegen * pace.hpMult * combatRegenMult(pools)) / TPS, pace.healKind);
    }
    announceLocks(ctx);
  },

  commands: [
    handle(setExerting, (ctx, { on: wanted }) => {
      if (ctx.state.exerting === wanted) return skipped(`exertion is already ${wanted ? 'on' : 'off'}`);
      ctx.state.exerting = wanted;
      ctx.touch(LOCKS_SOURCE);
      return OK;
    }),
  ],

  events: [
    on(spendPool, (ctx, { payload }) => {
      if (!pool(payload.id)) return ctx.skip('resources/spend', `unknown pool "${payload.id}"`);
      spendResource(poolsOf(ctx), payload.id, payload.amount);
    }),
    on(drawPool, (ctx, { payload }) => {
      if (!pool(payload.id)) return ctx.skip('resources/draw', `unknown pool "${payload.id}"`);
      drawResource(poolsOf(ctx), payload.id, payload.amount);
    }),
    on(restorePool, (ctx, { payload }) => {
      if (!pool(payload.id)) return ctx.skip('resources/restore', `unknown pool "${payload.id}"`);
      restoreResource(poolsOf(ctx), payload.id, payload.amount);
    }),
    on(drainPool, (ctx, { payload }) => {
      if (!pool(payload.id)) return ctx.skip('resources/drain', `unknown pool "${payload.id}"`);
      drainIntoDebt(poolsOf(ctx), payload.id, payload.amount);
    }),
    on(healPlayer, (ctx, { payload }) => {
      if (payload.amount <= 0) return ctx.skip('resources/heal', `amount ${payload.amount} is not above 0`);
      applyHeal(ctx, poolsOf(ctx), payload.amount, payload.kind ?? 'other');
    }),
    on(hurtPlayer, (ctx, { payload }) => {
      if (payload.amount <= 0) return ctx.skip('resources/damage', `amount ${payload.amount} is not above 0`);
      applyDamage(ctx, payload);
    }),
    on(defeatPlayer, (ctx) => setHpAfterDefeat(poolsOf(ctx))),
    on(exertPool, (ctx, { payload }) => {
      ctx.emit(exerted, exert(poolsOf(ctx), payload.spec));
    }),
    on(setPace, (ctx, { payload }) => {
      Object.assign(ctx.state.pace, payload);
    }),
  ],

  requests: [
    answer(hitPlayer, (ctx, payload) => {
      if (payload.amount <= 0) {
        ctx.skip(hitPlayer.type, `amount ${payload.amount} is not above 0`);
        return 0;
      }
      return applyDamage(ctx, payload);
    }),
    answer(healNow, (ctx, payload) => {
      if (payload.amount <= 0) {
        ctx.skip(healNow.type, `amount ${payload.amount} is not above 0`);
        return null;
      }
      return applyHeal(ctx, poolsOf(ctx), payload.amount, payload.kind ?? 'other');
    }),
    answer(exertNow, (ctx, payload) => {
      const result = exert(poolsOf(ctx), payload.spec);
      // The shared constant is handed out as a copy.
      const bought = { ...result };
      if (bought.spent > 0) ctx.emit(exerted, bought);
      return bought;
    }),
    answer(drawNow, (ctx, payload) => {
      if (!pool(payload.id)) {
        ctx.skip(drawNow.type, `unknown pool "${payload.id}"`);
        return 0;
      }
      return drawResource(poolsOf(ctx), payload.id, payload.amount);
    }),
    answer(spendNow, (ctx, payload) => {
      if (!pool(payload.id)) {
        ctx.skip(spendNow.type, `unknown pool "${payload.id}"`);
        return 0;
      }
      return spendResource(poolsOf(ctx), payload.id, payload.amount);
    }),
  ],

  view: (ctx) => {
    const block = statBlockOf(ctx);
    const hooks = poolHooks(ctx);
    return {
      pools: RESOURCE_LIST.map((def) => {
        const lock = resourceLock(ctx.state, def.id);
        return {
          id: def.id,
          name: def.name,
          icon: def.icon,
          value: ctx.state.values[def.id],
          max: availableMax(block, hooks, def.id),
          trueMax: trueMax(block, def.id),
          lock,
          lockName: lock === 'empty' ? def.reserve!.emptyName : lock === 'low' ? def.reserve!.lowName : null,
          reserve: def.reserve?.share ?? 0,
        };
      }),
      exerting: ctx.state.exerting,
    };
  },
});
