/**
 * Status conditions of every entity: the player and the monsters of a fight
 * hold them in one slice and go through one engine. Port of the old
 * `systems/statuses.ts`, `systems/conditionHarm.ts` and
 * `data/statuses.data.ts`. See README.md in this folder.
 *
 * - `engine.ts` holds the rules, as functions on the list one entity holds.
 * - This file owns the slice. A change to a list happens in a request, an
 *   event handler or the tick of this system, and nowhere else.
 * - Another system reads with the read functions on `heldOf(ctx.read(statuses), entity)`,
 *   and changes with `ctx.request(applyStatus, ...)` and the other requests.
 */
import {
  answer,
  cloneJson,
  defineEvent,
  defineRequest,
  defineSystem,
  on,
  PLAYER,
  registry,
  TPS,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type Json,
} from '../../kernel';
import { feedFloatingRun, feedSettle, fillText, floatingRun, logLine, textSchema, type TextRecord } from '../log';
import log from '../log';
import resources, {
  availableMax,
  drainPool,
  healPlayer,
  hookStat,
  hurtPlayer,
  playerDamaged,
  playerHealed,
  poolHooks,
  poolSnapshots,
  poolSpent,
  RESOURCE_IDS,
  RESOURCES,
  resourceValue,
  restorePool,
  type ResourceId,
} from '../resources';
import {
  attrValue,
  ELEMENTAL_TYPES,
  factValue,
  RES_STAT_BY_TYPE,
  statBlockOf,
  statOf,
  uncappedResistance,
  type AttributeId,
  type DamageType,
} from '../stats';
import {
  statusRegistry,
  STATUSES,
  type StatusApplication,
  type StatusDef,
  type StatusEvent,
  type StatusInstance,
} from './defs';
import * as engine from './engine';
import {
  effectiveIntensity,
  escalationChance,
  heldModifiers,
  resistBlock,
  sourceSignature,
  visibleStatuses,
  type BarDamage,
  type BearerEnv,
  type ConditionResistance,
  type HeldList,
  type PoolHookIds,
  type StatusEventDetail,
  type StatusHit,
  type StatusTickInput,
  type StatusTickResult,
} from './engine';
import { migrations } from './migrations';
import statusesTextData from './content/statuses_text.json';

export * from './defs';
export * from './harm';
// The read half of the engine. The functions that change a list are reached
// through the requests below.
export {
  APPLICATION_FLOOR,
  IMMUNITY_RESISTANCE,
  SURPLUS_FLOOR,
  attrCeiling,
  consumeSkippedAction,
  effectiveIntensity,
  escalationChance,
  escalationPrimed,
  fieldHunger,
  fieldHungerBucket,
  findStatus,
  graftHarvest,
  graftLedger,
  hasDamping,
  hasStatus,
  healAllowance,
  heldWith,
  magnetBypassesDodge,
  magnetCritChance,
  resistBlock,
  statueOf,
  statusBlocks,
  statusBlocksRangedType,
  statusBlocksRegen,
  statusCeiling,
  statusCostMult,
  statusDampingFor,
  statusDisadvantage,
  statusDisplacedExit,
  statusForcedStyle,
  statusForcingStyle,
  statusIncomingDamageMult,
  statusIncomingMissChance,
  statusIntensity,
  statusMissChance,
  statusMods,
  statusNegativeHeadroom,
  statusPacifiesFlankers,
  statusResFloor,
  statusResOverrides,
  statusRetaliation,
  statusReversesBar,
  visibleStatuses,
} from './engine';
export type {
  BarDamage,
  BearerEnv,
  ConditionResistance,
  GraftHarvest,
  HeldField,
  HeldList,
  PoolSnapshot,
  Retaliation,
  StatusEventDetail,
  StatusHit,
  StatusTickInput,
  StatusTickResult,
} from './engine';

// ---- slice ----

export interface StatusesState {
  /** Held conditions per entity id. An entity that holds none has no key. */
  held: Record<string, StatusInstance[]>;
  /** The player is in a fight. The old `state.combat !== null`. */
  inCombat: boolean;
  /** The player is knocked out and recovering. The old `state.recovering`. */
  down: boolean;
}

/** The conditions an entity holds. */
export function heldOf(state: DeepReadonly<StatusesState>, entity: string = PLAYER): HeldList {
  return state.held[entity] ?? NONE;
}

const NONE: HeldList = Object.freeze([]);

// ---- text ----

const statusesText = registry(textSchema, statusesTextData, 'Status text');
const TEXT = Object.fromEntries((statusesTextData as TextRecord[]).map((r) => [r.id, r.text]));

// ---- stats and the source ----

/** The one modifier source. Touched per entity when what it reads changes. */
export const HELD_SOURCE = 'statuses/held';

/**
 * Hook stat: the share of condition damage an entity sheds, 0 to 1. The old
 * `fastGuard(...).ward`; the mutagens port moves it from a source of its own.
 */
export const WARD_STAT = 'statuses/ward';

/** Ticks a clock of the player advances per tick while knocked out. */
export const UNCONSCIOUS_CLOCK_RATE = 5;

const HOOK_IDS: PoolHookIds = {
  pools: RESOURCE_IDS,
  ceiling: hookStat.ceiling,
  costMult: hookStat.costMult,
  regenBlocked: hookStat.regenBlocked,
  headroom: hookStat.headroom,
  healCapped: hookStat.healCapped,
  healAllowance: hookStat.healAllowance,
};

// ---- requests: same-handler results ----

export interface ApplyPayload {
  entity: string;
  app: StatusApplication;
  /** What inflicted it, for the readout. */
  source?: string;
  /**
   * The player only: true when the dose is done to the player (a bite, an
   * enemy working, spoiled food), so the player's resistance answers it;
   * absent for what the player grants to themselves. Any other entity always
   * resists.
   */
  resist?: boolean;
  /** The applier's penetration. Enters the immunity test only. */
  penetration?: number;
}

/** Inflict a condition. The instance held afterwards (a copy), or null when nothing landed. */
export const applyStatus = defineRequest<ApplyPayload, StatusInstance | null>('statuses/apply');
/** Inflict a list of conditions. The instances that landed (copies). */
export const applyStatuses = defineRequest<Omit<ApplyPayload, 'app'> & { apps: readonly StatusApplication[] }, StatusInstance[]>(
  'statuses/apply-all',
);
/** A condition becoming another one. Never resisted; immunity and `blockedBy` still refuse it. */
export const reform = defineRequest<{ entity: string; app: StatusApplication; source?: string }, StatusInstance | null>(
  'statuses/reform',
);
/** Remove one condition. No rule fires. */
export const removeStatus = defineRequest<{ entity: string; id: string }, void>('statuses/remove');
/** Remove every condition of an entity that stays in the game. */
export const clearStatuses = defineRequest<{ entity: string }, void>('statuses/clear');
/** Tell an entity's conditions that something happened. The ids that changed. */
export const fireStatusEvent = defineRequest<{ entity: string; on: StatusEvent; detail?: StatusEventDetail }, string[]>(
  'statuses/fire',
);
/**
 * Advance an entity's conditions by one tick and report damage, drains and
 * restores; the caller applies them. The player is ticked by this system and
 * needs no request.
 */
export const tickStatuses = defineRequest<{ entity: string } & StatusTickInput, StatusTickResult>('statuses/tick');
/** Remove matching conditions and return what was taken. */
export const stripStatuses = defineRequest<{ entity: string; ids: readonly string[] }, { id: string; intensity: number }[]>(
  'statuses/strip',
);
/** Multiply matching conditions and wind their clocks back up. How many were touched. */
export const amplifyStatuses = defineRequest<{ entity: string; ids: readonly string[]; mult: number }, number>(
  'statuses/amplify',
);
/** Damage owed when the action bar fills or bottoms out. Records it as dealt. */
export const statusBarDamage = defineRequest<{ entity: string; when: 'onFill' | 'onDeplete' }, BarDamage[]>(
  'statuses/bar-damage',
);
/** Spend a magnet lock on a critical hit. The extra crit damage. */
export const consumeMagnetCharge = defineRequest<{ entity: string }, number>('statuses/consume-magnet');
/** A blow of a type landed on the bearer of a tended condition. */
export const tendOnDamage = defineRequest<{ entity: string; type: DamageType }, void>('statuses/tend');
/** What a matured root network carries to the rest of the fight this tick, or null. */
export const dueGraftSpread = defineRequest<{ entity: string }, { id: string; intensity: number }[] | null>(
  'statuses/graft-spread',
);
/** Record healing against the conditions that ration it. The player's heals arrive as `resources/healed`. */
export const noteHealed = defineRequest<{ entity: string; amount: number }, void>('statuses/note-healed');
/** Write the surplus ledger of a held condition (`engine.writeSurplus`). The ledger afterwards, or null when it is not held. */
export const writeSurplus = defineRequest<
  { entity: string; id: string; add?: number; set?: number; rewind?: boolean },
  number | null
>('statuses/surplus');
/** Record a pool spend against the conditions that eat effort. The player's arrive as `resources/spent`. */
export const noteResourceSpent = defineRequest<
  { entity: string; resource: ResourceId; spent: number; trueMax: number },
  void
>('statuses/note-spent');

// ---- events ----

/** Request: tell an entity's conditions that something happened. For a caller that needs no answer. */
export const statusHook = defineEvent<{ entity: string; on: StatusEvent; detail?: StatusEventDetail }>('statuses/hook');
/** Request: inflict conditions. For a caller that needs no answer. */
export const inflictStatuses = defineEvent<Omit<ApplyPayload, 'app'> & { apps: readonly StatusApplication[] }>(
  'statuses/inflict',
);
/** Request: state what the player is in. Absent fields keep their value. */
export const setSituation = defineEvent<{ inCombat?: boolean; down?: boolean }>('statuses/situation');
/** Request: drop the conditions of an entity that is gone. The owner of the entity also calls `ctx.dropEntity`. */
export const forgetEntity = defineEvent<{ entity: string }>('statuses/forget');

/** The player's conditions dealt damage this tick. The damage went out as `resources/damage`. */
export const conditionDamage = defineEvent<{ entity: string; damage: number; hits: StatusHit[] }>('statuses/damage');
/** A debt bottomed out on the player. The damage went out as `resources/damage`. */
export const conditionDetonated = defineEvent<{
  entity: string;
  id: string;
  name: string;
  icon: string;
  dealt: number;
  type: DamageType;
}>('statuses/detonated');
/** A condition emptied a pool and brings the player down. It stays at reduced intensity with no timer. */
export const conditionFatal = defineEvent<{ entity: string; id: string; name: string; icon: string }>('statuses/fatal');
/** Conditions of the player ran out this tick. */
export const conditionsExpired = defineEvent<{ entity: string; ids: string[] }>('statuses/expired');

// ---- the entity an operation works on ----

type Reads = Pick<DerivedReads, 'derived' | 'stats'>;

/** Immunity a system other than this one states for an entity, as named facts of the stat pipeline. */
function outsideImmunity(reads: Reads, entity: string, def: StatusDef): boolean {
  if (factValue(reads, `statusImmune:${def.id}`, entity) > 0) return true;
  return !!def.element && factValue(reads, `statusImmuneElement:${def.element}`, entity) > 0;
}

function conditionResistanceOf(reads: Reads, entity: string, element: DamageType): number {
  return (
    uncappedResistance(reads, RES_STAT_BY_TYPE[element], entity) +
    (ELEMENTAL_TYPES.has(element) ? statOf(reads, 'resElemental', entity) : 0)
  );
}

/**
 * How an entity stands against a condition, for a readout: the figures an
 * application reads. The old `conditionResistance`. The applier's
 * penetration is not counted.
 */
export function conditionReadout(
  reads: Reads,
  state: DeepReadonly<StatusesState>,
  def: StatusDef,
  entity: string = PLAYER,
): ConditionResistance {
  return engine.conditionResistance(
    {
      chance: () => false,
      conditionResistance: (element) => conditionResistanceOf(reads, entity, element),
      damageResistance: (type) => resistBlock(statBlockOf(reads, entity))[type],
      contest: () => null,
      outsideImmunity: (d) => outsideImmunity(reads, entity, d),
    },
    heldOf(state, entity),
    def,
  );
}

/**
 * One operation on the list an entity holds: what the engine asks about the
 * bearer, and the check that touches the source when what it reads changed.
 * A class, so an operation allocates one object and no closures: the
 * player's conditions run two operations on every tick.
 *
 * Resistances: the player's are read from the stat table as it stood when
 * the operation began, as the old callers passed one stat block per call. Any
 * other entity is read live, as the old monster readers were: a condition
 * landed earlier in the same operation already counts.
 */
class Operation implements BearerEnv {
  private signature: string;
  private readonly frozen: ReadonlyMap<string, number> | undefined;

  constructor(
    private readonly ctx: Ctx<StatusesState>,
    private readonly entity: string,
    private readonly resist: boolean,
    private readonly list: StatusInstance[],
  ) {
    this.signature = sourceSignature(list);
    this.frozen = entity === PLAYER ? ctx.stats(PLAYER) : undefined;
  }

  /** Touch the source when what it reads of the list changed since the last check. */
  sync(): void {
    const now = sourceSignature(this.list);
    if (now === this.signature) return;
    this.signature = now;
    this.ctx.touch(HELD_SOURCE, this.entity);
  }

  // The reads of the bearer, in the shape the stat helpers take.
  stats(entity?: string, variant?: string): ReadonlyMap<string, number> {
    if (this.frozen) return this.frozen;
    this.sync();
    return this.ctx.stats(entity, variant);
  }

  derived(stat: string, entity?: string, variant?: string): number {
    if (this.frozen) return this.frozen.get(stat)!;
    this.sync();
    return this.ctx.derived(stat, entity, variant);
  }

  chance(p: number): boolean {
    return this.ctx.rng.chance(p);
  }

  conditionResistance(element: DamageType): number | undefined {
    return this.frozen && !this.resist ? undefined : conditionResistanceOf(this, this.entity, element);
  }

  damageResistance(type: DamageType): number {
    return resistBlock(statBlockOf(this, this.entity))[type];
  }

  contest(attr: AttributeId): { player: number; bearer: number } | null {
    return this.frozen ? null : { player: attrValue(this.ctx, attr, PLAYER), bearer: attrValue(this, attr, this.entity) };
  }

  outsideImmunity(def: StatusDef): boolean {
    return outsideImmunity(this, this.entity, def);
  }
}

/** Run `fn` on the list an entity holds, then touch the source when what it reads changed. */
function mutate<T>(
  ctx: Ctx<StatusesState>,
  entity: string,
  resist: boolean,
  fn: (list: StatusInstance[], env: BearerEnv) => T,
): T {
  const list = (ctx.state.held[entity] ??= []);
  const op = new Operation(ctx, entity, resist, list);
  try {
    return fn(list, op);
  } finally {
    if (list.length === 0) delete ctx.state.held[entity];
    op.sync();
  }
}

/** Whether a heal of this kind changes anything about a held condition. */
function hearsHeal(held: StatusInstance, kind: string): boolean {
  const def = STATUSES[held.id];
  if (def?.healCap !== undefined) return true;
  const rules = held.removal ?? def?.removal;
  if (!rules) return false;
  for (const rule of rules) {
    if (rule.on === 'heal' && (!rule.healKinds || rule.healKinds.includes(kind))) return true;
  }
  return false;
}

const copy = <T>(value: T): T => cloneJson(value as Json) as T;

function unknownIds(ctx: Ctx<StatusesState>, action: string, apps: readonly StatusApplication[]): void {
  for (const app of apps) if (!STATUSES[app.id]) ctx.skip(action, `unknown status "${app.id}"`);
}

// ---- the player's tick ----

/**
 * One tick of the player's conditions. Port of the old `tickPlayerStatuses`
 * (`systems/actions.ts`). What the old function did to the fight and to the
 * knockout is left to the systems that own them; they hear the events.
 */
function tickPlayer(ctx: Ctx<StatusesState>): void {
  const held = ctx.state.held[PLAYER];
  if (!held || held.length === 0) return;
  const pools = ctx.read(resources);
  // The old loop ticked neither pools nor conditions while travelling.
  if (pools.pace.halted) return;

  const block = statBlockOf(ctx);
  const resists = resistBlock(block);
  const result = mutate(ctx, PLAYER, false, (list, env) =>
    engine.tickStatuses(env, list, {
      hp: resourceValue(pools, 'hp'),
      maxHp: availableMax(block, poolHooks(ctx), 'hp'),
      inCombat: ctx.state.inCombat,
      resists,
      pools: poolSnapshots(pools, block),
      clockRate: ctx.state.down ? UNCONSCIOUS_CLOCK_RATE : 1,
      ward: ctx.derived(WARD_STAT),
    }),
  );

  for (const drain of result.drains) ctx.emit(drainPool, { id: drain.resource, amount: drain.amount });

  // Health goes through heal, so the heal cap and the heal rules apply.
  for (const give of result.restores) {
    if (give.resource === 'hp') ctx.emit(healPlayer, { amount: give.amount, kind: 'other' });
    else ctx.emit(restorePool, { id: give.resource, amount: give.amount });
  }

  for (const boom of result.detonations) {
    const res = resists[boom.type] * (1 - boom.bypassRes);
    const dealt = Math.max(1, Math.round(boom.amount * (1 - res)));
    ctx.emit(hurtPlayer, {
      amount: dealt,
      type: boom.type,
      source: { key: `cond:${boom.id}`, label: boom.name, icon: boom.icon },
    });
    ctx.emit(logLine, {
      msg: fillText(TEXT.condition_detonates, { icon: boom.icon, name: boom.name, dealt, type: boom.type }),
      kind: 'danger',
    });
    ctx.emit(conditionDetonated, { entity: PLAYER, id: boom.id, name: boom.name, icon: boom.icon, dealt, type: boom.type });
  }

  if (result.expired.length > 0) {
    for (const id of result.expired) {
      const def = STATUSES[id];
      if (def && !def.hidden)
        ctx.emit(logLine, { msg: fillText(TEXT.condition_passed, { icon: def.icon, name: def.name }), kind: 'combat' });
    }
    ctx.emit(conditionsExpired, { entity: PLAYER, ids: [...result.expired] });
  }

  // A condition that emptied a pool keeps part of its hold and loses its
  // clock. Not while already down: that would wipe the clock every tick.
  const fatal = result.fatal;
  if (fatal && !ctx.state.down) {
    ctx.emit(logLine, { msg: fillText(TEXT.condition_fatal, { icon: fatal.icon, name: fatal.name }), kind: 'danger' });
    mutate(ctx, PLAYER, false, (list) => {
      const still = list.find((h) => h.id === fatal.id);
      if (!still) return;
      still.intensity = Math.ceil(still.intensity * fatal.retains);
      still.peak = still.intensity;
      still.ticksLeft = null;
    });
    ctx.emit(conditionFatal, { entity: PLAYER, id: fatal.id, name: fatal.name, icon: fatal.icon });
    return;
  }

  if (result.damage > 0) {
    // One sum for the tick, already attributed: `source: null`.
    ctx.emit(hurtPlayer, { amount: result.damage, source: null });
    ctx.emit(feedFloatingRun, {
      group: SELF_RUN,
      prefix: TEXT.suffer_prefix,
      tally: result.hits.map((h) => ({ label: `${h.icon} ${h.name.toLowerCase()}`, qty: h.amount, style: 'amount' as const })),
      ids: result.hits.map((h) => h.id),
    });
    ctx.emit(conditionDamage, { entity: PLAYER, damage: result.damage, hits: result.hits });
  }

  // The run ends when nothing that fed it is still held.
  const run = floatingRun(ctx.read(log), SELF_RUN);
  const ids = [...(run?.ids ?? []), ...(result.damage > 0 ? result.hits.map((h) => h.id) : [])];
  const now = ctx.state.held[PLAYER] ?? [];
  if (ids.length > 0 && !ids.some((id) => now.some((h) => h.id === id))) ctx.emit(feedSettle, { group: SELF_RUN });
}

/** The floating run of the fight feed the player's condition damage adds to. */
export const SELF_RUN = 'cond:self';

// ---- view ----

export interface StatusView {
  id: string;
  name: string;
  icon: string;
  /** Raw intensity. */
  intensity: number;
  /** Intensity after decay with the clock. */
  effective: number;
  stacks: number;
  /** Seconds left, or null when it has no timer. */
  seconds: number | null;
  source: string | null;
  /** Chance the next dose turns it into `becomes`, 0 to 1. */
  escalation: number;
  /** Name of the condition it escalates to, or null. */
  becomes: string | null;
  /** "Label: fact" lines. The first is the description from the data. */
  facts: string[];
}

export interface StatusesView {
  /** The player's visible conditions, strongest first. */
  player: StatusView[];
  /** Visible conditions of every other entity that holds any. */
  entities: Record<string, StatusView[]>;
}

const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;
const amount = (value: number) => String(Math.round(value * 100) / 100);

function viewOne(list: HeldList, held: DeepReadonly<StatusInstance>): StatusView {
  const def = STATUSES[held.id];
  const chance = escalationChance(list, held);
  const next = def?.escalatesTo ? STATUSES[def.escalatesTo] : undefined;
  const facts: string[] = [];
  if (def) {
    facts.push(def.desc);
    if (def.unresistable) facts.push('Resistance: cannot be resisted');
    if (def.healCap !== undefined) {
      const left = Math.max(0, (held.data?.dealt ?? 0) * def.healCap - (held.data?.healed ?? 0));
      facts.push(`Healing allowed: ${amount(left)}`);
    }
    const debt = held.data?.debt ?? 0;
    const pool = held.debtPool ?? def.ceilingFromSpend?.resource;
    if (debt > 0 && pool) facts.push(`Max ${RESOURCES[pool].name}: -${percent(Math.min(0.95, debt))}`);
    if (chance > 0 && next) facts.push(`Next dose: ${percent(chance)} to become ${next.icon} ${next.name}`);
  }
  if (held.source) facts.push(`Source: ${held.source}`);
  return {
    id: held.id,
    name: def?.name ?? held.id,
    icon: def?.icon ?? '',
    intensity: held.intensity,
    effective: effectiveIntensity(held),
    stacks: held.stacks,
    seconds: held.ticksLeft === null ? null : held.ticksLeft / TPS,
    source: held.source ?? null,
    escalation: chance,
    becomes: next?.name ?? null,
    facts,
  };
}

const viewList = (list: HeldList): StatusView[] => visibleStatuses(list).map((held) => viewOne(list, held));

// ---- the declaration ----

export default defineSystem<StatusesState, StatusesView>({
  id: 'statuses',
  version: 1,
  migrations,
  initial: () => ({ held: {}, inCombat: false, down: false }),
  content: { statuses: statusRegistry, statuses_text: statusesText },
  stats: { [WARD_STAT]: { base: 0 } },

  modifiers: [
    {
      id: HELD_SOURCE,
      collect: ({ state, entity }) => heldModifiers(heldOf(state, entity), HOOK_IDS),
    },
  ],

  tick: tickPlayer,

  requests: [
    answer(applyStatus, (ctx, p) => {
      unknownIds(ctx, applyStatus.type, [p.app]);
      return copy(mutate(ctx, p.entity, !!p.resist, (list, env) => engine.applyStatus(env, list, p.app, p.source, p.penetration)));
    }),
    answer(applyStatuses, (ctx, p) => {
      unknownIds(ctx, applyStatuses.type, p.apps);
      return copy(mutate(ctx, p.entity, !!p.resist, (list, env) => engine.applyStatuses(env, list, p.apps, p.source, p.penetration)));
    }),
    answer(reform, (ctx, p) => {
      unknownIds(ctx, reform.type, [p.app]);
      return copy(mutate(ctx, p.entity, false, (list, env) => engine.reform(env, list, p.app, p.source)));
    }),
    answer(removeStatus, (ctx, p) => mutate(ctx, p.entity, false, (list) => engine.removeStatus(list, p.id))),
    answer(clearStatuses, (ctx, p) => mutate(ctx, p.entity, false, (list) => engine.clearStatuses(list))),
    answer(fireStatusEvent, (ctx, p) =>
      mutate(ctx, p.entity, false, (list, env) => engine.fireStatusEvent(env, list, p.on, p.detail)),
    ),
    answer(tickStatuses, (ctx, { entity, ...input }) =>
      mutate(ctx, entity, false, (list, env) => engine.tickStatuses(env, list, input)),
    ),
    answer(stripStatuses, (ctx, p) => mutate(ctx, p.entity, false, (list) => engine.stripStatuses(list, p.ids))),
    answer(amplifyStatuses, (ctx, p) => mutate(ctx, p.entity, false, (list) => engine.amplifyStatuses(list, p.ids, p.mult))),
    answer(statusBarDamage, (ctx, p) => mutate(ctx, p.entity, false, (list) => engine.statusBarDamage(list, p.when))),
    answer(consumeMagnetCharge, (ctx, p) => mutate(ctx, p.entity, false, (list) => engine.consumeMagnetCharge(list))),
    answer(tendOnDamage, (ctx, p) => mutate(ctx, p.entity, false, (list) => engine.tendOnDamage(list, p.type))),
    answer(dueGraftSpread, (ctx, p) => mutate(ctx, p.entity, false, (list) => engine.dueGraftSpread(list))),
    answer(noteHealed, (ctx, p) => mutate(ctx, p.entity, false, (list) => engine.noteHealed(list, p.amount))),
    answer(writeSurplus, (ctx, { entity, id, ...change }) => mutate(ctx, entity, false, (list) => engine.writeSurplus(list, id, change))),
    answer(noteResourceSpent, (ctx, p) =>
      mutate(ctx, p.entity, false, (list) => engine.noteResourceSpent(list, p.resource, p.spent, p.trueMax)),
    ),
  ],

  events: [
    // A heal of the player: the rationing conditions record it, then every
    // condition hears the treatment, also when the cap let nothing through.
    on(playerHealed, (ctx, { payload }) => {
      // The health trickle sends this on every tick: nothing is built when
      // no held condition rations healing or has a rule for it.
      const now = ctx.state.held[PLAYER];
      if (!now || !now.some((held) => hearsHeal(held, payload.kind))) return;
      mutate(ctx, PLAYER, false, (list, env) => {
        if (payload.healed > 0) engine.noteHealed(list, payload.healed);
        engine.fireStatusEvent(env, list, 'heal', { healKind: payload.kind });
      });
    }),
    on(playerDamaged, (ctx, { payload }) => {
      if (!ctx.state.held[PLAYER]) return;
      mutate(ctx, PLAYER, false, (list, env) =>
        engine.fireStatusEvent(
          env,
          list,
          'damageTaken',
          payload.type ? { damageType: payload.type, amount: payload.lost } : { amount: payload.lost },
        ),
      );
    }),
    on(poolSpent, (ctx, { payload }) => {
      if (!ctx.state.held[PLAYER]) return;
      mutate(ctx, PLAYER, false, (list) => engine.noteResourceSpent(list, payload.id, payload.spent, payload.max));
    }),
    on(statusHook, (ctx, { payload }) => {
      if (!ctx.state.held[payload.entity]) return;
      mutate(ctx, payload.entity, false, (list, env) => engine.fireStatusEvent(env, list, payload.on, payload.detail));
    }),
    on(inflictStatuses, (ctx, { payload: p }) => {
      unknownIds(ctx, inflictStatuses.type, p.apps);
      mutate(ctx, p.entity, !!p.resist, (list, env) => engine.applyStatuses(env, list, p.apps, p.source, p.penetration));
    }),
    on(setSituation, (ctx, { payload }) => {
      if (payload.inCombat !== undefined) ctx.state.inCombat = payload.inCombat;
      if (payload.down !== undefined) ctx.state.down = payload.down;
    }),
    on(forgetEntity, (ctx, { payload }) => {
      if (payload.entity === PLAYER) return ctx.skip(forgetEntity.type, 'the player cannot be forgotten');
      // No touch: the owner drops the entity, and its values go with it.
      delete ctx.state.held[payload.entity];
    }),
  ],

  view: (ctx) => {
    const entities: Record<string, StatusView[]> = {};
    for (const [entity, list] of Object.entries(ctx.state.held)) {
      if (entity !== PLAYER) entities[entity] = viewList(list);
    }
    return { player: viewList(heldOf(ctx.state)), entities };
  },
});
