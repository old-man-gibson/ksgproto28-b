/**
 * The status engine: what conditions do. Port of the old
 * `systems/statuses.ts`, function for function.
 *
 * Every function here works on the list of conditions one entity holds. The
 * player and a monster go through the same code. A function that changes the
 * list is called by `index.ts` only, inside a request or the tick; a function
 * that reads may be called by any system on `ctx.read(statuses)`.
 *
 * What the old module read from other systems comes in through `BearerEnv`:
 * resistances, the attribute contest, immunity from outside, the random roll.
 *
 * Rules that look odd and are ported as they are:
 * - A first dose creates the instance and returns. The cap is consulted only
 *   from the second dose on, so one enormous dose never escalates.
 * - A weather source is replaced by any other source that doses the same
 *   condition.
 * - `costMult` and the bar damage scale with the raw intensity, not with the
 *   effective one.
 */
import type { DeepReadonly } from '../../kernel';
import type { ResourceId } from '../resources';
import {
  contentMod,
  dampFact,
  attrCeilingFact,
  ELEMENTAL_TYPES,
  RES_STAT_BY_TYPE,
  resFloorFact,
  resFloorTakenFact,
  resOverrideFact,
  type AttributeId,
  type DamageType,
  type DerivedStats,
  type ModOrigin,
  type StatKey,
  type StatMod,
} from '../stats';
import {
  defDuration,
  STATUSES,
  toApplication,
  WEATHER_SOURCE_PREFIX,
  type BlockableAction,
  type StatusApplication,
  type StatusDef,
  type StatusEvent,
  type StatusInstance,
} from './defs';

/** A held list as a reader sees it. */
export type HeldList = readonly DeepReadonly<StatusInstance>[];
type Held = DeepReadonly<StatusInstance>;

/** What the engine asks about the entity that bears the conditions. */
export interface BearerEnv {
  /** True with probability p. */
  chance(p: number): boolean;
  /**
   * Resistance to an element as a dose reads it: before the cap, with
   * `resElemental` for the elemental types. Undefined: the caller gave no
   * block to read, and the dose is not resisted.
   */
  conditionResistance(element: DamageType): number | undefined;
  /** What a blow of the type would shed: after the cap. */
  damageResistance(type: DamageType): number;
  /** For `contest`: the player's attribute and the bearer's. Null when the bearer is the player. */
  contest(attr: AttributeId): { player: number; bearer: number } | null;
  /** Immunity from something other than a held condition (an earned title). */
  outsideImmunity(def: StatusDef): boolean;
}

// ---------- Reading what is held ----------

export function findStatus<T extends Held>(list: readonly T[], id: string): T | undefined {
  return list.find((s) => s.id === id);
}

export function hasStatus(list: HeldList, id: string): boolean {
  return findStatus(list, id) !== undefined;
}

/** The rule of the statue condition held (Basilisk Hide), or null. */
export function statueOf(list: HeldList): NonNullable<StatusDef['statue']> | null {
  for (const s of list) {
    const rule = STATUSES[s.id]?.statue;
    if (rule) return rule;
  }
  return null;
}

/** Status fields a held condition can carry for Weakest Weapon Master. */
export type HeldField = 'attrCeiling' | 'repMult' | 'drillsAll' | 'parryContest' | 'blowCut' | 'pureBlows' | 'unarmedRider';

/**
 * The first held condition whose definition sets `field`, with its effective
 * intensity; null when none does or the intensity is not above 0.
 */
export function heldWith(list: HeldList, field: HeldField): { def: StatusDef; intensity: number } | null {
  for (const s of list) {
    const def = STATUSES[s.id];
    if (!def?.[field]) continue;
    const intensity = effectiveIntensity(s);
    if (intensity > 0) return { def, intensity };
  }
  return null;
}

/** The attribute ceiling held (Weakest Weapon Master), or null. */
export function attrCeiling(list: HeldList): number | null {
  const held = heldWith(list, 'attrCeiling');
  return held ? Math.round(held.intensity) : null;
}

/** Total intensity of a condition, 0 when it is absent. */
export function statusIntensity(list: HeldList, id: string): number {
  return findStatus(list, id)?.intensity ?? 0;
}

/** Everything worth showing in the interface, worst first. */
export function visibleStatuses(list: HeldList): Held[] {
  return list.filter((s) => !STATUSES[s.id]?.hidden).sort((a, b) => b.intensity - a.intensity);
}

// ---------- Applying ----------

function durationOf(def: StatusDef, app: StatusApplication): number | null {
  if (app.duration === 'permanent') return null;
  return app.duration ?? defDuration(def);
}

/** The share of a dose that lands however high the resistance below immunity. */
export const APPLICATION_FLOOR = 0.25;

/** Resistance at or above this, after the applier's penetration, is immunity. */
export const IMMUNITY_RESISTANCE = 1;

/** What a condition's resistance line says, for a readout. */
export type ConditionResistance =
  | { kind: 'none' }
  | { kind: 'unresistable'; reason: string }
  | { kind: 'resisted'; element: DamageType; total: number; immune: boolean };

/**
 * How the bearer stands against a condition, for tooltips: the figures
 * `applyStatus` reads. The applier's penetration is not counted.
 */
export function conditionResistance(env: BearerEnv, list: HeldList, def: StatusDef): ConditionResistance {
  if (def.unresistable) return { kind: 'unresistable', reason: def.unresistable };
  if (!def.element) return { kind: 'none' };
  const total = env.conditionResistance(def.element) ?? 0;
  return {
    kind: 'resisted',
    element: def.element,
    total,
    immune: total >= IMMUNITY_RESISTANCE - 1e-9 || wearsImmunityTo(env, list, def),
  };
}

/**
 * How much of an incoming dose survives the bearer's resistance; 0 when the
 * bearer cannot be affected at all. Penetration enters the immunity test
 * only; the share that lands below it reads the resistance unchanged.
 */
function applicationMult(env: BearerEnv, def: StatusDef, penetration = 0): number {
  if (def.unresistable) return 1;
  const contest = contestMult(env, def);
  if (!def.element) return contest;
  const res = env.conditionResistance(def.element);
  if (res === undefined) return contest;
  // The epsilon is for sums that are 1 on paper: 0.7 + 3 x 0.1 is a hair under.
  if (res - penetration >= IMMUNITY_RESISTANCE - 1e-9) return 0;
  return Math.max(APPLICATION_FLOOR, 1 - Math.max(-1, Math.min(0.9, res))) * contest;
}

/**
 * `contest`: a bearer with more of the named attribute than the player takes
 * the dose cut by the ratio, never below the application floor. Only a
 * bearer that is not the player.
 */
function contestMult(env: BearerEnv, def: StatusDef): number {
  if (!def.contest) return 1;
  const pair = env.contest(def.contest);
  if (!pair) return 1;
  if (pair.bearer <= 0) return 1;
  return Math.max(APPLICATION_FLOOR, Math.min(1, pair.player / pair.bearer));
}

/** Whether something the bearer holds, or an outside rule, refuses this condition. */
function wearsImmunityTo(env: BearerEnv, list: HeldList, def: StatusDef): boolean {
  for (const held of list) {
    if (refuses(STATUSES[held.id]?.immune, def)) return true;
  }
  return env.outsideImmunity(def);
}

/** Whether an `immune` rule names this condition, by id or element. */
export function refuses(immune: StatusDef['immune'], def: StatusDef): boolean {
  if (!immune) return false;
  if (immune.ids?.includes(def.id)) return true;
  return !!def.element && !!immune.elements?.includes(def.element);
}

/**
 * Inflict a condition. Returns the instance held afterwards, or null when
 * nothing landed: the roll failed, the id is unknown, the bearer is immune,
 * or something held blocks it.
 */
export function applyStatus(
  env: BearerEnv,
  list: StatusInstance[],
  app: StatusApplication,
  source?: string,
  penetration = 0,
): StatusInstance | null {
  const def = STATUSES[app.id];
  if (!def) return null;
  const resisted = applicationMult(env, def, penetration);
  if (resisted <= 0) return null;
  return inflict(env, list, app, source, resisted);
}

/**
 * A condition becoming another one: escalating, souring, leaving a successor.
 * Never resisted. Immunity and `blockedBy` still refuse it.
 */
export function reform(
  env: BearerEnv,
  list: StatusInstance[],
  app: StatusApplication,
  source?: string,
): StatusInstance | null {
  if (!STATUSES[app.id]) return null;
  return inflict(env, list, app, source, 1);
}

const isWeatherSource = (source: string | undefined): boolean => !!source && source.startsWith(WEATHER_SOURCE_PREFIX);

/** A held condition the weather put there and nothing else has added to. */
const weatherHeld = (held: Held): boolean => isWeatherSource(held.source);

function inflict(
  env: BearerEnv,
  list: StatusInstance[],
  app: StatusApplication,
  source: string | undefined,
  resisted: number,
): StatusInstance | null {
  const def = STATUSES[app.id];
  if (!def) return null;
  if (app.chance !== undefined && !env.chance(app.chance)) return null;
  for (const blocker of def.blockedBy ?? []) {
    if (hasStatus(list, blocker)) return null;
  }
  if (wearsImmunityTo(env, list, def)) return null;

  const intensity = (app.intensity ?? 1) * amplifierFor(list, app.id) * resisted;
  recordGraft(list, def.id, intensity);
  const held = findStatus(list, app.id);
  const removal = app.removal ?? def.removal;

  if (!held) {
    const fresh: StatusInstance = {
      id: def.id,
      intensity,
      peak: intensity,
      stacks: 1,
      ticksLeft: durationOf(def, app),
      ...(removal ? { removal } : {}),
      ...(source ? { source } : {}),
      data: {},
    };
    list.push(fresh);
    // Landing can turn what was already there (poison into rot, in water).
    convertHeld(env, list, def);
    return fresh;
  }

  // A dose from anywhere but the weather takes over a condition the weather started.
  if (weatherHeld(held) && !isWeatherSource(source)) {
    if (source) held.source = source;
    else delete held.source;
  }
  held.peak = Math.max(held.peak ?? held.intensity, intensity);
  const stacking = def.stacking;
  switch (stacking.mode) {
    case 'highest':
      if (intensity > held.intensity) {
        held.intensity = intensity;
        held.ticksLeft = durationOf(def, app);
      }
      break;
    case 'absorb':
      // The clock is not reset.
      held.intensity += intensity * (stacking.absorb ?? 1);
      held.stacks += 1;
      break;
    case 'sum':
      held.intensity += intensity;
      held.stacks += 1;
      held.ticksLeft = durationOf(def, app);
      break;
    case 'count':
      held.stacks += 1;
      held.intensity += intensity;
      held.ticksLeft = durationOf(def, app);
      break;
    case 'extend': {
      const added = durationOf(def, app);
      if (added !== null) held.ticksLeft = (held.ticksLeft ?? 0) + added;
      held.stacks += 1;
      break;
    }
  }

  if (stacking.refreshDuration) held.ticksLeft = durationOf(def, app);

  const cap = capOverrideFor(list, def.id) ?? stacking.cap;
  if (cap !== undefined) {
    const byStacks = stacking.mode === 'count' || stacking.mode === 'extend';
    const measure = byStacks ? held.stacks : held.intensity;
    const turns = stacking.onCap === 'escalate' && !!def.escalatesTo;
    const clamp = () => {
      if (measure < cap) return;
      if (byStacks) held.stacks = cap;
      else held.intensity = cap;
    };
    // Past `escalateFrom` every dose rolls, with odds that rise to 1 at the cap.
    if (turns && stacking.escalateFrom !== undefined && measure > stacking.escalateFrom) {
      const span = Math.max(cap - stacking.escalateFrom, 1e-9);
      if (env.chance(Math.min(1, (measure - stacking.escalateFrom) / span))) {
        return escalate(env, list, held, source);
      }
      clamp();
      return held;
    }
    if (measure >= cap) {
      if (turns) return escalate(env, list, held, source);
      clamp();
    }
  }
  return held;
}

/** Apply a list of applications. Returns the instances that landed. */
export function applyStatuses(
  env: BearerEnv,
  list: StatusInstance[],
  apps: readonly StatusApplication[] | undefined,
  source?: string,
  penetration = 0,
): StatusInstance[] {
  const landed: StatusInstance[] = [];
  for (const app of apps ?? []) {
    const inst = applyStatus(env, list, app, source, penetration);
    if (inst) landed.push(inst);
  }
  return landed;
}

/** How much harder something else held makes `id` land. */
function amplifierFor(list: HeldList, id: string): number {
  let mult = 1;
  for (const other of list) {
    for (const amp of STATUSES[other.id]?.amplifies ?? []) {
      if (amp.id === id) mult *= amp.mult;
    }
  }
  return mult;
}

/** An escalation threshold something else held has changed. */
function capOverrideFor(list: HeldList, id: string): number | undefined {
  for (const other of list) {
    for (const o of STATUSES[other.id]?.capOverrides ?? []) {
      if (o.id === id) return o.cap;
    }
  }
  return undefined;
}

/** Turn what is already held into something else, at the moment `def` lands. */
function convertHeld(env: BearerEnv, list: StatusInstance[], def: StatusDef): void {
  for (const rule of def.converts ?? []) {
    const from = findStatus(list, rule.from);
    if (!from) continue;
    removeStatus(list, rule.from);
    reform(env, list, { id: rule.to, intensity: from.intensity * rule.ratio }, from.source);
  }
}

/** Whether the next application could turn this condition into its worse form. */
export function escalationPrimed(list: HeldList, held: Held): boolean {
  return escalationChance(list, held) > 0;
}

/** How likely the next application is to turn this condition: 0 to 1. */
export function escalationChance(list: HeldList, held: Held): number {
  const def = STATUSES[held.id];
  if (!def?.escalatesTo || def.stacking.onCap !== 'escalate') return 0;
  const cap = capOverrideFor(list, def.id) ?? def.stacking.cap;
  if (cap === undefined) return 0;
  const byStacks = def.stacking.mode === 'count' || def.stacking.mode === 'extend';
  const measure = byStacks ? held.stacks : held.intensity;
  const from = def.stacking.escalateFrom;
  if (from === undefined) return measure >= cap ? 1 : 0;
  if (measure <= from) return 0;
  return Math.min(1, (measure - from) / Math.max(cap - from, 1e-9));
}

/** Replace a condition with the worse one it escalates into. */
function escalate(
  env: BearerEnv,
  list: StatusInstance[],
  held: StatusInstance,
  source?: string,
): StatusInstance | null {
  const def = STATUSES[held.id];
  if (!def?.escalatesTo) return held;
  removeStatus(list, held.id);
  const next = reform(
    env,
    list,
    { id: def.escalatesTo, intensity: held.intensity * (def.stacking.escalateMult ?? 1) },
    source,
  );
  if (next) {
    next.peak = Math.max(next.peak, held.peak ?? held.intensity);
    // The successor inherits the bookkeeping (a graft ledger, a debt).
    next.data = { ...held.data, ...next.data };
  }
  return next;
}

export function removeStatus(list: StatusInstance[], id: string): void {
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) list.splice(i, 1);
}

export function clearStatuses(list: StatusInstance[]): void {
  list.length = 0;
}

// ---------- Removal events ----------

export interface StatusEventDetail {
  healKind?: string;
  tag?: string;
  damageType?: DamageType;
  amount?: number;
}

/**
 * Tell the conditions that something happened to their bearer. Each one
 * checks the rules it holds (its source's, or its definition's). Returns the
 * ids that changed.
 */
export function fireStatusEvent(
  env: BearerEnv,
  list: StatusInstance[],
  event: StatusEvent,
  detail?: StatusEventDetail,
): string[] {
  const changed: string[] = [];
  for (const held of [...list]) {
    const def = STATUSES[held.id];
    if (!def) continue;
    const rules = held.removal ?? def.removal ?? [];
    for (const rule of rules) {
      if (rule.on !== event) continue;
      if (rule.healKinds && !rule.healKinds.includes(detail?.healKind ?? '')) continue;
      if (rule.tag && rule.tag !== detail?.tag) continue;
      if (rule.damageTypes && !rule.damageTypes.includes(detail?.damageType as never)) continue;
      // Progress toward a count is kept on the instance.
      if (rule.after && rule.after > 1) {
        held.data = held.data ?? {};
        const key = `charge:${rule.on}`;
        const seen = (held.data[key] ?? 0) + 1;
        held.data[key] = seen;
        if (seen < rule.after) break;
        held.data[key] = 0;
      }
      // The same by magnitude. A rule may ask for both.
      if (rule.afterDamage) {
        held.data = held.data ?? {};
        const key = `soak:${rule.on}`;
        const soaked = (held.data[key] ?? 0) + Math.max(0, detail?.amount ?? 0);
        held.data[key] = soaked;
        if (soaked < rule.afterDamage) break;
        held.data[key] = 0;
      }

      switch (rule.effect ?? 'remove') {
        case 'remove':
          removeStatus(list, held.id);
          // After the removal, so a pair that blocks each other resolves.
          if (rule.becomes) {
            reform(env, list, { id: rule.becomes, intensity: held.intensity }, held.source);
          }
          break;
        case 'deescalate': {
          removeStatus(list, held.id);
          if (def.baseForm) {
            reform(env, list, { id: def.baseForm, intensity: held.intensity }, held.source);
          }
          break;
        }
        case 'reduce': {
          held.intensity *= 1 - (rule.amount ?? 0.5);
          if (held.intensity <= 0.01) removeStatus(list, held.id);
          break;
        }
        case 'unstack': {
          const per = held.stacks > 0 ? held.intensity / held.stacks : held.intensity;
          held.stacks -= 1;
          held.intensity = Math.max(0, held.intensity - per);
          if (held.stacks <= 0) removeStatus(list, held.id);
          break;
        }
      }
      changed.push(held.id);
      break; // one rule per condition per event
    }
  }
  return changed;
}

// ---------- Contributions to the rest of the game ----------

const STATUS_ORIGIN: ModOrigin = { kind: 'status' };

/**
 * The intensity a condition bites with now. A condition that fades with its
 * clock is weaker at the end than at the start.
 */
export function effectiveIntensity(held: Held): number {
  const def = STATUSES[held.id];
  if (!def?.decayWithDuration || held.ticksLeft === null) return held.intensity;
  const full = defDuration(def) ?? held.ticksLeft;
  if (!full) return held.intensity;
  return held.intensity * Math.max(0, Math.min(1, held.ticksLeft / full));
}

/** Whether a field the modifier source scales by effective intensity is set. */
function sourceReadsDecay(def: StatusDef): boolean {
  return (
    (def.mods?.length ?? 0) > 0 ||
    !!def.damp ||
    !!def.resFloor ||
    !!def.attrCeiling ||
    (def.ceilings?.length ?? 0) > 0
  );
}

/** Whether the modifier source returns anything for a condition of this definition. */
function sourceReads(def: StatusDef): boolean {
  return (
    sourceReadsDecay(def) ||
    (def.overrideRes?.length ?? 0) > 0 ||
    (def.blocksRegen?.length ?? 0) > 0 ||
    !!def.costMult ||
    !!def.negativeHeadroom ||
    def.healCap !== undefined
  );
}

/**
 * Everything of a held list that the modifier source reads, as one string.
 * `index.ts` touches the source when it changes. A condition the source
 * returns nothing for (eyeless, buffeted) is not part of it, so it rebuilds
 * nothing when it lands, fades or goes. Port of the old
 * `statBlockIntensity`, widened to the pool hooks, which are stats here.
 */
export function sourceSignature(list: HeldList): string {
  let out = '';
  for (const held of list) {
    const def = STATUSES[held.id];
    // A debt is read whatever the definition says: a successor inherits it.
    if (!held.data?.debt && !(def && sourceReads(def))) continue;
    out += `${held.id}:${held.stacks}:${held.intensity}`;
    if (def?.decayWithDuration && sourceReadsDecay(def)) out += `:${effectiveIntensity(held)}`;
    if (held.data?.debt) out += `:d${held.data.debt}${held.debtPool ?? ''}`;
    if (def?.healCap !== undefined) out += `:h${held.data?.dealt ?? 0}/${held.data?.healed ?? 0}`;
    out += '|';
  }
  return out;
}

/** Stat modifiers from every held condition, scaled by effective intensity. */
export function statusMods(list: HeldList): StatMod[] {
  const out: StatMod[] = [];
  for (const held of list) {
    const def = STATUSES[held.id];
    const power = effectiveIntensity(held);
    for (const mod of def?.mods ?? []) out.push(contentMod(mod, def!.name, STATUS_ORIGIN, 0, power));
  }
  return out;
}

/**
 * Resistances a condition dictates, resolved against what the bearer had.
 * The stat pipeline does the same from `resOverrideFact`; this is the old
 * function, kept for a caller that has a resistance reader of its own.
 */
export function statusResOverrides(
  list: HeldList,
  current: (type: DamageType) => number,
): Partial<Record<DamageType, number>> {
  const out: Partial<Record<DamageType, number>> = {};
  for (const held of list) {
    for (const spec of STATUSES[held.id]?.overrideRes ?? []) {
      const now = out[spec.type] ?? current(spec.type);
      out[spec.type] = spec.bonusIfMet !== undefined && now >= spec.to ? now + spec.bonusIfMet : spec.to;
    }
  }
  return out;
}

/**
 * The deepest the floor-carrying conditions may push a resistance, and how
 * much they took off each stat (negative). Stacks deepen the floor.
 */
export function statusResFloor(list: HeldList): { floor: number; taken: Partial<Record<string, number>> } | undefined {
  let floor: number | undefined;
  const taken: Partial<Record<string, number>> = {};
  for (const held of list) {
    const def = STATUSES[held.id];
    const spec = def?.resFloor;
    if (!spec) continue;
    const own = spec.base - spec.perStack * Math.max(0, held.stacks - 1);
    floor = floor === undefined ? own : Math.min(floor, own);
    const power = effectiveIntensity(held);
    for (const mod of def!.mods ?? []) {
      if (mod.op !== 'add' || mod.value >= 0) continue;
      taken[mod.stat] = (taken[mod.stat] ?? 0) + mod.value * power;
    }
  }
  return floor === undefined ? undefined : { floor, taken };
}

/**
 * How much of a pool the conditions have sealed off, as a multiplier on its
 * true maximum. Several wounds compound.
 */
export function statusCeiling(list: HeldList, resource: ResourceId): number {
  let mult = 1;
  for (const held of list) {
    const def = STATUSES[held.id];
    for (const c of def?.ceilings ?? []) {
      if (c.resource !== resource) continue;
      mult *= 1 - Math.min(c.max ?? 1, c.per * effectiveIntensity(held));
    }
    // Debt this condition ate out of the pool, or inherited from the one
    // that did. `debtPool` travels with the debt.
    const debt = held.data?.debt ?? 0;
    if (debt > 0 && (held.debtPool ?? def?.ceilingFromSpend?.resource) === resource) {
      mult *= 1 - Math.min(0.95, debt);
    }
  }
  return Math.max(0, mult);
}

/**
 * Tell any condition that eats what is spent that the pool was spent. The
 * debt is a share of the pool's true max.
 */
export function noteResourceSpent(list: StatusInstance[], resource: ResourceId, spent: number, trueMax: number): void {
  if (spent <= 0 || trueMax <= 0) return;
  for (const held of list) {
    const spec = STATUSES[held.id]?.ceilingFromSpend;
    if (!spec || spec.resource !== resource) continue;
    held.data = held.data ?? {};
    held.data.debt = Math.min(spec.max ?? 1, (held.data.debt ?? 0) + (spent * spec.share) / trueMax);
    held.debtPool = spec.resource;
  }
}

/** How much a condition dulls a modifier from `origin`. Returns the share to keep. */
export function statusDampingFor(list: HeldList, origin?: ModOrigin, stat?: string): number {
  if (!origin) return 1;
  let keep = 1;
  for (const held of list) {
    const damp = STATUSES[held.id]?.damp;
    if (!damp) continue;
    if (damp.kinds && !damp.kinds.includes(origin.kind)) continue;
    if (damp.stats && (stat === undefined || !damp.stats.includes(stat))) continue;
    if (damp.slot && damp.slot !== origin.slot) continue;
    keep *= 1 - Math.min(damp.max ?? 1, damp.per * effectiveIntensity(held));
  }
  return Math.max(0, keep);
}

/** Whether any held condition dulls modifiers at all. */
export function hasDamping(list: HeldList): boolean {
  return list.some((s) => STATUSES[s.id]?.damp);
}

/** The most healing the conditions allow now. Infinity when nothing caps it. */
export function healAllowance(list: HeldList): number {
  let allowance = Infinity;
  for (const held of list) {
    const cap = STATUSES[held.id]?.healCap;
    if (cap === undefined) continue;
    const dealt = held.data?.dealt ?? 0;
    const already = held.data?.healed ?? 0;
    allowance = Math.min(allowance, Math.max(0, dealt * cap - already));
  }
  return allowance;
}

/** Record healing against every condition that rations it. */
export function noteHealed(list: StatusInstance[], amount: number): void {
  for (const held of list) {
    if (STATUSES[held.id]?.healCap === undefined) continue;
    held.data = held.data ?? {};
    held.data.healed = (held.data.healed ?? 0) + amount;
  }
}

/** Every stack of hunger on the given lists: both sides of a fight. */
export function fieldHunger(lists: readonly HeldList[]): number {
  let total = 0;
  for (const list of lists) total += findStatus(list, 'hunger_anupama')?.stacks ?? 0;
  return total;
}

/** The bucket `fieldHunger` is keyed by: the log, quantized. */
export function fieldHungerBucket(lists: readonly HeldList[]): number {
  return Math.round(Math.log(1 + fieldHunger(lists)) * 4);
}

/**
 * The modifiers and facts the held conditions hand to the stat pipeline and
 * to the pool hooks of `resources`. The one modifier source of this system.
 */
export function heldModifiers(list: HeldList, hook: PoolHookIds): StatMod[] {
  if (list.length === 0) return [];
  const out = statusMods(list);

  for (const held of list) {
    const def = STATUSES[held.id];
    if (!def) continue;
    const power = effectiveIntensity(held);
    if (def.damp) {
      const { kinds, stats, slot, per, max } = def.damp;
      out.push(
        dampFact(Math.min(max ?? 1, per * power), {
          ...(kinds ? { kinds: [...kinds] } : {}),
          ...(stats ? { stats: [...stats] } : {}),
          ...(slot ? { slot } : {}),
        }),
      );
    }
    for (const spec of def.overrideRes ?? []) out.push(resOverrideFact(spec.type, spec.to, spec.bonusIfMet));
    for (const id of def.blocksRegen ?? []) out.push({ stat: hook.regenBlocked(id), kind: 'add', value: 1 });
    if (def.costMult) {
      const { resource, per, max } = def.costMult;
      out.push({ stat: hook.costMult(resource), kind: 'mult', value: 1 + Math.min(max ?? Infinity, per * held.intensity) });
    }
  }

  const floor = statusResFloor(list);
  if (floor) {
    out.push(resFloorFact(floor.floor));
    for (const [stat, taken] of Object.entries(floor.taken)) out.push(resFloorTakenFact(stat as StatKey, taken!));
  }

  const ceiling = attrCeiling(list);
  if (ceiling !== null) out.push(attrCeilingFact(ceiling));

  for (const id of hook.pools) {
    const sealed = statusCeiling(list, id);
    if (sealed !== 1) out.push({ stat: hook.ceiling(id), kind: 'mult', value: sealed });
    const room = statusNegativeHeadroom(list, id, 1);
    if (room > 0) out.push({ stat: hook.headroom(id), kind: 'add', value: room });
  }

  const allowance = healAllowance(list);
  if (allowance !== Infinity) {
    out.push({ stat: hook.healCapped, kind: 'add', value: 1 });
    out.push({ stat: hook.healAllowance, kind: 'add', value: allowance });
  }
  return out;
}

/** The stat ids of the pool hooks, handed in so this file does not name them twice. */
export interface PoolHookIds {
  pools: readonly ResourceId[];
  ceiling(id: ResourceId): string;
  costMult(id: ResourceId): string;
  regenBlocked(id: ResourceId): string;
  headroom(id: ResourceId): string;
  healCapped: string;
  healAllowance: string;
}

// ---------- Behavioural gates ----------

/** Whether any held condition forbids an action. */
export function statusBlocks(list: HeldList, action: BlockableAction): boolean {
  return list.some((s) => STATUSES[s.id]?.blocks?.includes(action));
}

/** Multiplier on damage arriving at the bearer, from `incomingBite`. Compounds. */
export function statusIncomingDamageMult(list: HeldList): number {
  let mult = 1;
  for (const held of list) {
    const per = STATUSES[held.id]?.incomingBite;
    if (per) mult *= 1 + per * effectiveIntensity(held);
  }
  return mult;
}

/** Combined chance the bearer's attack misses. Compounds, never certain. */
export function statusMissChance(list: HeldList): number {
  let hit = 1;
  for (const held of list) {
    const per = STATUSES[held.id]?.missChance;
    if (per) hit *= 1 - Math.min(0.95, per * effectiveIntensity(held));
  }
  return 1 - hit;
}

/** Whether a held condition turns this condition's dot into healing. */
function dotInverted(list: HeldList, id: string): boolean {
  return list.some((s) => STATUSES[s.id]?.invertsDots?.includes(id));
}

/** Whether a held wall stops a ranged blow of the given type. */
export function statusBlocksRangedType(list: HeldList, type: DamageType): boolean {
  return list.some((s) => {
    const wall = STATUSES[s.id]?.blocksRanged;
    return !!wall && !(wall.except ?? []).includes(type);
  });
}

// ---------- Magnetism ----------

/** Whether a blow of `type` bypasses the bearer's dodge. Rolls for `dodgeIgnore`. */
export function magnetBypassesDodge(chance: (p: number) => boolean, list: HeldList, type: DamageType): boolean {
  for (const held of list) {
    const m = STATUSES[held.id]?.magnetism;
    if (!m) continue;
    if (m.nullifyDodge) return true;
    if (m.alwaysHit?.includes(type)) return true;
    if (m.dodgeIgnore && chance(Math.min(0.95, m.dodgeIgnore * effectiveIntensity(held)))) {
      return true;
    }
  }
  return false;
}

/** Extra crit chance a blow of `type` gets against this bearer. */
export function magnetCritChance(list: HeldList, type: DamageType): number {
  let bonus = 0;
  for (const held of list) {
    const m = STATUSES[held.id]?.magnetism;
    if (m?.critChancePer && m.critTypes?.includes(type)) {
      bonus += m.critChancePer * effectiveIntensity(held);
    }
  }
  return bonus;
}

/**
 * Spend the charge the bearer's lock holds: returns the extra crit damage and
 * removes the condition that held it. Called when a blow has critted.
 */
export function consumeMagnetCharge(list: StatusInstance[]): number {
  for (const held of [...list]) {
    const per = STATUSES[held.id]?.magnetism?.critDamagePerStack;
    if (!per) continue;
    const bonus = per * Math.max(1, held.stacks);
    removeStatus(list, held.id);
    return bonus;
  }
  return 0;
}

// ---------- Wind: displacement ----------

/**
 * Where the wind leaves the bearer, when it takes this exchange. Undefined
 * when nothing displaces: the technique's own exit stands.
 */
export function statusDisplacedExit(chance: (p: number) => boolean, list: HeldList): string | undefined {
  for (const held of list) {
    const cfg = STATUSES[held.id]?.displaces;
    if (!cfg) continue;
    if (cfg.always) return cfg.to;
    const p = (cfg.chancePer ?? 0) * effectiveIntensity(held);
    if (p > 0 && chance(Math.min(1, p))) return cfg.to;
  }
  return undefined;
}

// ---------- Wood: tending, grafts and the harvest ----------

const GRAFT_PREFIX = 'graft:';

/** Note a condition into every graft ledger the bearer carries. */
function recordGraft(list: StatusInstance[], id: string, intensity: number): void {
  for (const held of list) {
    const cfg = STATUSES[held.id]?.grafts;
    if (!cfg) continue;
    if (held.id === id) continue;
    if (cfg.except?.includes(id)) continue;
    held.data = held.data ?? {};
    const key = `${GRAFT_PREFIX}${id}`;
    const next = (held.data[key] ?? 0) + intensity;
    held.data[key] = cfg.cap !== undefined ? Math.min(cfg.cap, next) : next;
  }
}

/** What one graft-keeping condition has recorded, as applications. */
export function graftLedger(held: Held): { id: string; intensity: number }[] {
  const out: { id: string; intensity: number }[] = [];
  for (const [key, value] of Object.entries(held.data ?? {})) {
    if (!key.startsWith(GRAFT_PREFIX) || value <= 0) continue;
    out.push({ id: key.slice(GRAFT_PREFIX.length), intensity: value });
  }
  return out;
}

/**
 * A blow has landed on a bearer of a tended condition. A feeding type feeds
 * it, a pruning type cuts it double, every other type prunes it.
 */
export function tendOnDamage(list: StatusInstance[], type: DamageType): void {
  for (const held of [...list]) {
    const cfg = STATUSES[held.id]?.tends;
    if (!cfg) continue;
    if (cfg.fedBy?.includes(type)) {
      held.intensity += cfg.feedPerHit ?? 0;
      continue;
    }
    const cut = (cfg.prunePerHit ?? 0) * (cfg.prunedBy?.includes(type) ? 2 : 1);
    if (cut <= 0) continue;
    held.intensity -= cut;
    if (held.intensity <= 0.01) removeStatus(list, held.id);
  }
}

export interface GraftHarvest {
  id: string;
  name: string;
  icon: string;
  type: DamageType;
  amount: number;
}

/**
 * What burning a seeded body off pays: the ledger comes back as damage. Read
 * before the removal event fires.
 */
export function graftHarvest(list: HeldList, type: DamageType): GraftHarvest[] {
  const out: GraftHarvest[] = [];
  for (const held of list) {
    const def = STATUSES[held.id];
    const harvest = def?.grafts?.harvest;
    if (!def || !harvest || !harvest.on.includes(type)) continue;
    const total = graftLedger(held).reduce((sum, g) => sum + g.intensity, 0);
    if (total <= 0) continue;
    out.push({ id: def.id, name: def.name, icon: def.icon, type: harvest.type, amount: total * harvest.perIntensity });
  }
  return out;
}

/**
 * The conditions a matured root network carries to everything else in the
 * fight this tick, or null when it is not due. The caller distributes them.
 */
export function dueGraftSpread(list: StatusInstance[]): { id: string; intensity: number }[] | null {
  for (const held of list) {
    const cfg = STATUSES[held.id]?.grafts;
    if (!cfg?.spreadShare || !cfg.spreadEvery) continue;
    held.data = held.data ?? {};
    const next = (held.data.spreadAt ?? 0) - 1;
    if (next > 0) {
      held.data.spreadAt = next;
      continue;
    }
    held.data.spreadAt = cfg.spreadEvery;
    const carried = graftLedger(held)
      .map((g) => ({ id: g.id, intensity: g.intensity * cfg.spreadShare! }))
      .filter((g) => g.intensity > 0.01);
    if (carried.length) return carried;
  }
  return null;
}

export function statusPacifiesFlankers(list: HeldList): boolean {
  return list.some((s) => STATUSES[s.id]?.pacifiesFlankers);
}

/** Chance an enemy blow on the bearer misses, rolled after dodge. Compounds. */
export function statusIncomingMissChance(list: HeldList): number {
  let hit = 1;
  for (const held of list) {
    const per = STATUSES[held.id]?.incomingMissChance;
    if (per) hit *= 1 - Math.min(0.9, per * effectiveIntensity(held));
  }
  return 1 - hit;
}

/**
 * Multiply matching conditions by `mult` and wind their clocks back up
 * (Redouble Venom). Bypasses stacking caps. Returns how many were touched.
 */
export function amplifyStatuses(list: StatusInstance[], ids: readonly string[], mult: number): number {
  let touched = 0;
  for (const held of list) {
    if (!ids.includes(held.id)) continue;
    held.intensity *= mult;
    held.peak = Math.max(held.peak ?? 0, held.intensity);
    const full = STATUSES[held.id]?.duration;
    if (held.ticksLeft !== null && full) held.ticksLeft = full;
    touched++;
  }
  return touched;
}

/**
 * Remove matching conditions and return what was taken. Not a cure: nothing
 * fires, nothing de-escalates.
 */
export function stripStatuses(list: StatusInstance[], ids: readonly string[]): { id: string; intensity: number }[] {
  const taken: { id: string; intensity: number }[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (!ids.includes(list[i].id)) continue;
    taken.push({ id: list[i].id, intensity: list[i].intensity });
    list.splice(i, 1);
  }
  return taken;
}

/** A pool held conditions have stopped recovering. */
export function statusBlocksRegen(list: HeldList, id: ResourceId): boolean {
  return list.some((s) => STATUSES[s.id]?.blocksRegen?.includes(id));
}

/** The condition dictating the bearer's stance, if any. */
export function statusForcingStyle(list: HeldList): { def: StatusDef; style: string } | undefined {
  for (const held of list) {
    const def = STATUSES[held.id];
    if (def?.forceStyle) return { def, style: def.forceStyle };
  }
  return undefined;
}

/** The style a condition forces on the bearer, if any. */
export function statusForcedStyle(list: HeldList): string | undefined {
  return statusForcingStyle(list)?.style;
}

/** Multiplier on what spending a pool costs. 1 when nothing raises it. */
export function statusCostMult(list: HeldList, id: ResourceId): number {
  let mult = 1;
  for (const held of list) {
    const spec = STATUSES[held.id]?.costMult;
    if (spec?.resource !== id) continue;
    mult *= 1 + Math.min(spec.max ?? Infinity, spec.per * held.intensity);
  }
  return mult;
}

/** True while the bearer rolls attacks twice and takes the worse. */
export function statusDisadvantage(list: HeldList): boolean {
  return list.some((s) => STATUSES[s.id]?.disadvantage);
}

/** How far past zero a pool may be driven, as an absolute amount. 0 when nothing allows a debt. */
export function statusNegativeHeadroom(list: HeldList, id: ResourceId, trueMax: number): number {
  let room = 0;
  for (const held of list) {
    const spec = STATUSES[held.id]?.negativeHeadroom;
    if (spec?.resource !== id) continue;
    room = Math.max(room, trueMax * (spec.base + spec.perStack * Math.max(0, held.stacks - 1)));
  }
  return room;
}

/** True while a condition drags the bearer's action bar backwards. */
export function statusReversesBar(list: HeldList): boolean {
  return list.some((s) => STATUSES[s.id]?.bar?.reverse);
}

/**
 * Whether a held condition costs the bearer the action the bar completed.
 * The `barFill` removal rule of the condition spends the stack.
 */
export function consumeSkippedAction(list: HeldList): boolean {
  for (const held of list) {
    if (!STATUSES[held.id]?.bar?.skip) continue;
    return true;
  }
  return false;
}

export interface BarDamage {
  type: DamageType;
  amount: number;
  id: string;
  name: string;
  icon: string;
  /** The bearer drops what it holds under this share of health. */
  dropWeaponBelow?: number;
}

/** Damage owed by held conditions when the bar fills or bottoms out. Records it as dealt. */
export function statusBarDamage(list: StatusInstance[], when: 'onFill' | 'onDeplete'): BarDamage[] {
  const out: BarDamage[] = [];
  for (const held of list) {
    const def = STATUSES[held.id];
    const spec = def?.bar?.[when];
    if (!spec) continue;
    out.push({
      type: spec.type,
      amount: spec.flat * held.intensity,
      id: def!.id,
      name: def!.name,
      icon: def!.icon,
      // Weather alone never costs the weapon.
      dropWeaponBelow: weatherHeld(held) ? undefined : def!.dropWeaponBelow,
    });
    held.data = held.data ?? {};
    held.data.dealt = (held.data.dealt ?? 0) + spec.flat * held.intensity;
  }
  return out;
}

export interface Retaliation {
  type: DamageType;
  amount: number;
  name: string;
  icon: string;
  hits: 'bearer' | 'attacker';
  inflicts?: StatusApplication[];
}

/** What the bearer's conditions strike back with. */
export function statusRetaliation(list: HeldList, when: 'onAttack' | 'onContact'): Retaliation[] {
  const out: Retaliation[] = [];
  for (const held of list) {
    const def = STATUSES[held.id];
    const spec = def?.retaliate;
    if (!spec || !spec[when]) continue;
    out.push({
      type: spec.type,
      amount: spec.flat * held.intensity,
      name: def!.name,
      icon: def!.icon,
      hits: spec.hits ?? 'bearer',
      ...(spec.inflicts ? { inflicts: spec.inflicts.map(toApplication) } : {}),
    });
  }
  return out;
}

// ---------- Ticking ----------

export interface StatusHit {
  id: string;
  name: string;
  icon: string;
  type: DamageType;
  amount: number;
}

export interface StatusTickResult {
  /** Damage to apply, already reduced by the bearer's resistances. */
  damage: number;
  /** One entry per condition that dealt something. */
  hits: StatusHit[];
  /** Conditions that ran out this tick. */
  expired: string[];
  /** Pools to draw down, into debt when a condition gives headroom. */
  drains: { resource: ResourceId; amount: number; id: string }[];
  /** Pools to give back. */
  restores: { resource: ResourceId; amount: number; id: string; name: string; icon: string }[];
  /** Conditions whose debt bottomed out. The damage is raw; the caller applies `bypassRes`. */
  detonations: { id: string; name: string; icon: string; type: DamageType; amount: number; bypassRes: number }[];
  /** The bearer was brought down by a condition emptying a pool. */
  fatal?: { id: string; name: string; icon: string; retains: number };
}

/** The sliver of a surplus ledger not worth tracking. Absolute. */
export const SURPLUS_FLOOR = 1;

/** Ticks per second, for conditions authored in seconds. */
const TICKS_PER_SECOND = 10;

export interface PoolSnapshot {
  current: number;
  trueMax: number;
}

export interface StatusTickInput {
  hp: number;
  maxHp: number;
  inCombat: boolean;
  /** The bearer's resistance per type. Absent: `env.damageResistance`. */
  resists?: Partial<Record<DamageType, number>>;
  /** Pool readings, for conditions that drain or run a debt. */
  pools?: Partial<Record<ResourceId, PoolSnapshot>>;
  /** Ticks the clocks advance per tick. Above 1 while the bearer is knocked out. Damage is not scaled. */
  clockRate?: number;
  /** Share of condition damage the bearer sheds, 0 to 1. */
  ward?: number;
}

/**
 * Advance every condition of a bearer by one tick: deal its damage, run its
 * clock down, hand what expired to its successor. Reports damage, drains and
 * restores; the caller applies them.
 */
export function tickStatuses(env: BearerEnv, list: StatusInstance[], ctx: StatusTickInput): StatusTickResult {
  const result: StatusTickResult = { damage: 0, hits: [], expired: [], drains: [], restores: [], detonations: [] };
  if (list.length === 0) return result;
  const resistance = (type: DamageType): number => ctx.resists?.[type] ?? env.damageResistance(type);

  for (const held of [...list]) {
    const def = STATUSES[held.id];
    if (!def) continue;

    const dot = def.dot;
    if (dot) {
      // Parts named in `fromPeak` scale with the deepest single dose.
      const peak = held.peak ?? held.intensity;
      const scale = (part: 'flat' | 'currentHp' | 'maxHp') => (dot.fromPeak?.includes(part) ? peak : held.intensity);
      let raw =
        (dot.flat ?? 0) * scale('flat') +
        (dot.currentHp ?? 0) * scale('currentHp') * ctx.hp +
        (dot.maxHp ?? 0) * scale('maxHp') * ctx.maxHp;
      if (!ctx.inCombat && dot.outOfCombat !== undefined) raw *= dot.outOfCombat;
      if (raw > 0) {
        const res = resistance(dot.type);
        // A pierced share skips resistance. The resisted remainder is floored
        // on its own, so a resistance above 1 cannot reduce the pierced share.
        const pierce = Math.min(1, Math.max(0, dot.pierce ?? 0));
        // The ward comes off after the pierce.
        const shed = 1 - Math.min(1, Math.max(0, ctx.ward ?? 0));
        const dealt = raw * (pierce + (1 - pierce) * Math.max(0, 1 - res)) * shed;
        if (dealt > 0) {
          if (dotInverted(list, held.id)) {
            // The damage lands as healing instead. The condition ticks on.
            result.restores.push({ resource: 'hp', amount: dealt, id: def.id, name: def.name, icon: def.icon });
          } else {
            result.damage += dealt;
            result.hits.push({ id: def.id, name: def.name, icon: def.icon, type: dot.type, amount: dealt });
            // Remembered for a heal cap.
            held.data = held.data ?? {};
            held.data.dealt = (held.data.dealt ?? 0) + dealt;
          }
        }
      }
    }

    for (const r of def.restores ?? []) {
      const pool = ctx.pools?.[r.resource];
      const amount =
        (r.flat ?? 0) * effectiveIntensity(held) + (r.ofMax ?? 0) * (pool?.trueMax ?? 0) * effectiveIntensity(held);
      if (amount > 0) {
        result.restores.push({ resource: r.resource, amount, id: def.id, name: def.name, icon: def.icon });
      }
    }

    // A drain is a quantity: every point drained spends a point of intensity.
    const drain = def.drains;
    const pool = drain ? ctx.pools?.[drain.resource] : undefined;
    if (drain && pool) {
      const wanted = (drain.flat ?? 0) * held.intensity + (drain.ofMax ?? 0) * pool.trueMax;
      const amount = Math.min(wanted, held.intensity);
      if (amount > 0) {
        result.drains.push({ resource: drain.resource, amount, id: def.id });
        held.data = held.data ?? {};
        held.data[`lost:${drain.resource}`] = (held.data[`lost:${drain.resource}`] ?? 0) + amount;
        held.intensity -= amount;
      }
      const debtLimit = statusNegativeHeadroom(list, drain.resource, pool.trueMax);
      if (def.detonate && debtLimit > 0 && pool.current - amount <= -debtLimit) {
        const overdraft = Math.abs(Math.min(0, pool.current - amount));
        result.detonations.push({
          id: def.id,
          name: def.name,
          icon: def.icon,
          type: def.detonate.type,
          amount: overdraft * def.detonate.ofDebt,
          bypassRes: def.detonate.bypassRes ?? 0,
        });
        removeStatus(list, held.id);
        result.expired.push(held.id);
        continue;
      }
      // Spent without reaching the limit: nothing goes off.
      if (held.intensity <= 0) {
        removeStatus(list, held.id);
        result.expired.push(held.id);
        continue;
      }
    }

    // A condition that empties a pool can bring its bearer down.
    const fatal = def.fatalOnEmpty;
    const fatalPool = fatal ? ctx.pools?.[fatal.resource] : undefined;
    if (fatal && fatalPool && fatalPool.current <= 0) {
      result.fatal = { id: def.id, name: def.name, icon: def.icon, retains: fatal.retains };
    }

    // A ceiling that creeps up every tick the condition is held.
    if (def.ceilingPerTick) {
      held.data = held.data ?? {};
      held.data.debt = Math.min(def.ceilingPerTick.max, (held.data.debt ?? 0) + def.ceilingPerTick.per);
      held.debtPool = def.ceilingPerTick.resource;
    }

    // A condition that pays a debt back ends when it has paid it all.
    if (def.ceilingDecay) {
      held.data = held.data ?? {};
      held.data.debt = Math.max(0, (held.data.debt ?? 0) - def.ceilingDecay);
      if (held.data.debt <= 0) {
        removeStatus(list, held.id);
        result.expired.push(held.id);
        continue;
      }
      if (held.intensity <= 0) {
        removeStatus(list, held.id);
        result.expired.push(held.id);
        continue;
      }
    }

    // A surplus ledger sheds a share of itself every tick. The last sliver is let go.
    const shed = def.surplus?.decayShare;
    if (shed && held.data?.surplus) {
      const left = held.data.surplus * (1 - shed);
      held.data.surplus = left;
      if (left <= SURPLUS_FLOOR) {
        removeStatus(list, held.id);
        result.expired.push(held.id);
        continue;
      }
    }

    // A tended condition grows in a fight, where pruning can answer it.
    const tends = def.tends;
    if (tends && ctx.inCombat) {
      held.intensity += tends.growPerSecond / TICKS_PER_SECOND;
      if (escalationPrimed(list, held)) {
        escalate(env, list, held, held.source);
        continue;
      }
    }

    if (held.ticksLeft !== null) {
      held.ticksLeft -= ctx.clockRate ?? 1;
      if (held.ticksLeft <= 0) {
        removeStatus(list, held.id);
        result.expired.push(held.id);
        // A parting blow. Only the clock pays it: cured early, nothing.
        const parting = def.expireDamage;
        if (parting) {
          const raw = (parting.flat ?? 0) * held.intensity + (parting.maxHp ?? 0) * held.intensity * ctx.maxHp;
          const res = resistance(parting.type);
          const dealt = Math.max(0, raw * (1 - res));
          if (dealt > 0) {
            result.damage += dealt;
            result.hits.push({ id: def.id, name: def.name, icon: def.icon, type: parting.type, amount: dealt });
          }
        }
        // The successor inherits the bookkeeping: a debt or a heal cap outlives its maker.
        if (def.expiresTo) {
          const next = reform(env, list, { id: def.expiresTo, intensity: held.intensity }, def.name);
          if (next) {
            next.data = { ...held.data };
            if (held.debtPool) next.debtPool = held.debtPool;
          }
        }
      }
    }
  }
  return result;
}

/**
 * A resistance block in the shape `tickStatuses` wants: what a blow of each
 * type would shed. The type's own resistance plus `resElemental` for the
 * elemental types, held at the body's cap.
 */
export function resistBlock(stats: Partial<DerivedStats>): Record<DamageType, number> {
  const out = {} as Record<DamageType, number>;
  const cap = stats.resistCap === undefined ? Infinity : Math.max(0, stats.resistCap);
  for (const [type, key] of Object.entries(RES_STAT_BY_TYPE) as [DamageType, StatKey][]) {
    out[type] = Math.min(cap, (stats[key] ?? 0) + (ELEMENTAL_TYPES.has(type) ? (stats.resElemental ?? 0) : 0));
  }
  return out;
}
