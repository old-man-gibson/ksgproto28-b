/**
 * The world: where the character stands, travel, the pathfinder, the ladder
 * rides, activities, finds and the retreat. Port of the old
 * `systems/locations.ts`, `systems/actions.ts` (without the condition tick),
 * `systems/mapped.ts`, `systems/safety.ts`, `systems/search.ts`,
 * `systems/activitydrops.ts`, `systems/keyitems.ts`, the moving half of
 * `systems/towers.ts` and `officeArrival` of `systems/floodedFloor.ts`.
 */
import { defineEvent, type Ctx, type DeepReadonly, type DerivedReads, type SystemDef } from '../../kernel';
import { grantAttrXpSplit } from '../attributes';
import combat, {
  abandon,
  eligibleEncounters,
  fightsKey,
  inForcedFight,
  setHunt,
  startForced,
  stopHuntLoop,
  type CombatState,
  type EncounterLine,
  type EncounterSite,
} from '../combat';
import counters, { bumpCounter, conditionsMet, counterValue, setCounter, type ConditionReader } from '../counters';
import gold, { addGold, goldOf, spendGold } from '../gold';
import { grantItem, grantRune, ITEMS, RUNES } from '../items';
import {
  bandDynamicLevel,
  bandLevelStep,
  checkClears,
  climbVerb,
  FLOOR_BY_AREA,
  FLOORS,
  floorStop,
  hubStop,
  rideStops,
  rideTicks,
  spotIndex,
  stopOpen,
  TOWERS,
  towerAtSpot,
  type FloorDef,
  type RideStop,
  type TowerDef,
} from '../ladder';
import { fillText, logLine, repeatLine, type LogTally, type TextRecord } from '../log';
import materials, { grantGraded, grantMaterial, heldOf, MATERIALS, type QualityTier } from '../materials';
import { rollMercyChance } from '../mercy';
import { RECOVERY_MULT, setPace } from '../resources';
import skills, { checkDiscovery, conditionReader, grantSkillXp, skillLevel, SKILLS, skillTrainedBy } from '../skills';
import { BASE_ACTION_BAR, BASE_SPEED, formulaAttr, scopedMult, statBlockOf, type AttributeId, type DerivedStats, type StatKey } from '../stats';
import { setSituation } from '../statuses';
import worldTextData from './content/world_text.json';
import {
  AREAS,
  craftProvider,
  edgesFrom,
  getSpot,
  isUnconditionalHaven,
  KEY_ITEMS,
  REGIONS,
  restActivities,
  spotActivities,
  SPOTS,
  STARTING_SPOT,
  type ActivityDef,
  type Edge,
  type ExploreGate,
  type FindPayload,
  type SearchReward,
  type SpotDef,
  type SpotFind,
} from './defs';

// ---- slice ----

export interface Travel {
  from: string;
  to: string;
  ticksLeft: number;
  total: number;
  /**
   * Set when a system started the leg inside a tick, before this system
   * ticked. The first tick clears it and does not count, as the old loop
   * returned after the step that set out.
   */
  fresh?: true;
}

export interface WorldState {
  spot: string;
  discovered: string[];
  travel: Travel | null;
  /** The hops still to walk after the leg under way. */
  travelPlan: string[];
  /** What the journey is for. An empty `activity` starts nothing on arrival. */
  travelIntent: { spot: string; activity: string } | null;
  activity: string | null;
  activityProgress: number;
  /** The last activity chosen at each spot. Key order is recency, oldest first. */
  resumeActivity: Record<string, string>;
  /** Ticks of exploring done per spot. */
  explored: Record<string, number>;
  /** Find ids claimed per spot. */
  finds: Record<string, string[]>;
  safeSpots: { nearest: string | null; unconditional: string | null };
  /** Knocked out and resting until the recovery mark. */
  recovering: boolean;
}

type W = Ctx<WorldState>;
type State = DeepReadonly<WorldState>;
/** What a read of this system needs: derived values and other slices. */
export type Reads = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

// ---- text ----

type TextKey =
  | 'no_leaving_fight'
  | 'disengage'
  | 'blocked'
  | 'heading'
  | 'via'
  | 'setting_out'
  | 'legs'
  | 'unknown_place'
  | 'discovered'
  | 'region_mapped'
  | 'arrived'
  | 'route_blocked'
  | 'stop_requested'
  | 'caravan_unaffordable'
  | 'fast_traveled'
  | 'wake'
  | 'moving'
  | 'started'
  | 'recovered'
  | 'find_generic'
  | 'gate_generic'
  | 'explored_paths'
  | 'explored'
  | 'find_marks_spot'
  | 'find_opens_path'
  | 'drop_found'
  | 'search_spent'
  | 'key_item'
  | 'office_wrong'
  | 'office_reception'
  | 'office_drop'
  | 'craft_locked';

export const TEXT = Object.fromEntries((worldTextData as TextRecord[]).map((r) => [r.id, r.text])) as Record<TextKey, string>;

function say(ctx: W, id: TextKey, params: Record<string, unknown> | undefined, kind: string): void {
  ctx.emit(logLine, { msg: fillText(TEXT[id], params), kind });
}

// ---- events ----

/** The character arrived at a spot, by a walk, a ride, the caravan or the retreat. `ambushed`: a forced fight owns the arrival. */
export const arrived = defineEvent<{ spot: string; from: string; ambushed: boolean }>('world/arrived');
/** The activity changed. `activity: null` is a stop. */
export const activityChanged = defineEvent<{ spot: string; activity: string | null; kind: string | null }>('world/activity-changed');
/** The player gave a command this system accepted. A knockout return in flight ends. */
export const playerCommand = defineEvent<{ type: string }>('world/player-command');
/** A cycle of a train, job or gather activity completed. */
export const cycleDone = defineEvent<{ spot: string; activity: string; kind: string; tags: string[]; baseTicks: number }>('world/cycle');
/** A spot was discovered. */
export const discovered = defineEvent<{ spot: string }>('world/discovered');

/** Bumped on every arrival: a walk, a ride, the caravan, the retreat. */
export const TRIPS_KEY = 'travel:trips';

// ---- small reads ----

const reader = (ctx: Reads): ConditionReader => conditionReader(ctx);

const combatOf = (ctx: Reads): DeepReadonly<CombatState> => ctx.read(combat);

/** The fight budget of the spot is spent. The old `spotCleared`. */
export function spotCleared(ctx: Reads, spot: Pick<SpotDef, 'id' | 'fightLimit'>): boolean {
  return !!spot.fightLimit && counterValue(ctx.read(counters), fightsKey(spot.id)) >= spot.fightLimit;
}

/** The encounter site of a spot, as combat takes it. */
export function siteOf(ctx: Reads, spot: SpotDef): EncounterSite {
  const levelStep = bandLevelStep(reader(ctx), spot.areaId);
  const dynamicLevel = bandDynamicLevel(spot.areaId);
  return {
    id: spot.id,
    name: spot.name,
    encounters: (spot.encounters ?? []) as EncounterLine[],
    ...(spot.groupWeights ? { groupWeights: spot.groupWeights } : {}),
    ...(spot.modifierWeights ? { modifierWeights: spot.modifierWeights } : {}),
    ...(spot.fightLimit ? { fightLimit: spot.fightLimit } : {}),
    ...(spot.stampOnClear ? { stampOnClear: spot.stampOnClear } : {}),
    ...(levelStep ? { levelStep } : {}),
    ...(dynamicLevel ? { dynamicLevel } : {}),
  };
}

/** The lines a spot can roll now. The old `eligibleEncounters(state, spot)`. */
export function eligibleAt(ctx: Reads, spot: SpotDef): DeepReadonly<EncounterLine>[] {
  if (!spot.encounters?.length) return [];
  // The combat read takes its own context type and uses only reads and the skip log.
  const asCombat = { skip: () => {}, ...ctx, read: ctx.read, derived: ctx.derived, stats: ctx.stats, modifiers: ctx.modifiers } as unknown as Ctx<CombatState>;
  return eligibleEncounters(asCombat, siteOf(ctx, spot));
}

export function currentActivity(state: State): ActivityDef | null {
  if (!state.activity) return null;
  return spotActivities(getSpot(state.spot)).find((a) => a.id === state.activity) ?? null;
}

// ---- exploring: reads ----

export function exploreProgress(state: State, spot: SpotDef): number {
  const needed = spot.exploreTicks ?? 100;
  return Math.min(1, (state.explored[spot.id] ?? 0) / needed);
}

export function isExplored(state: State, spotId: string): boolean {
  return exploreProgress(state, getSpot(spotId)) >= 1;
}

export function claimedFinds(state: State, spotId: string): readonly string[] {
  return state.finds[spotId] ?? [];
}

/** Finds whose depth is reached and which have not fired, shallowest first. */
export function pendingFinds(ctx: Reads, state: State, spot: SpotDef): SpotFind[] {
  const claimed = claimedFinds(state, spot.id);
  const progress = exploreProgress(state, spot);
  const r = reader(ctx);
  return (spot.finds ?? [])
    .filter((f) => !claimed.includes(f.id) && progress >= f.at && (!f.requires || conditionsMet(r, f.requires)))
    .sort((a, b) => a.at - b.at);
}

/** The gate holding the search up, if any. */
export function blockingGate(ctx: Reads, state: State, spot: SpotDef): ExploreGate | null {
  const progress = exploreProgress(state, spot);
  const r = reader(ctx);
  return [...(spot.exploreGates ?? [])].sort((a, b) => a.at - b.at).find((g) => progress >= g.at && !conditionsMet(r, g.requires)) ?? null;
}

/** Hidden roads out of a spot that a `path` find has opened. */
export function foundPaths(state: State, spotId: string): Set<string> {
  const claimed = claimedFinds(state, spotId);
  const open = new Set<string>();
  for (const find of getSpot(spotId).finds ?? []) {
    if (find.path && claimed.includes(find.id)) open.add(find.path);
  }
  return open;
}

// ---- searching ----

export const searchKey = (spot: string, activity: string): string => `flag:search:${spot}:${activity}`;

/** `extra`: bumps made in this handler and not yet in the counters, by key. */
function eligibleRewards(ctx: Reads, spot: string, act: ActivityDef, extra: Record<string, number> = {}): SearchReward[] {
  const key = searchKey(spot, act.id);
  const counts = ctx.read(counters);
  const r = reader(ctx);
  const at = (k: string) => counterValue(counts, k) + (extra[k] ?? 0);
  return (act.rewards ?? []).filter(
    (rw) => rw.weight > 0 && (rw.limit === undefined || at(`${key}:${rw.id}`) < rw.limit) && conditionsMet(r, rw.requires ?? []),
  );
}

/** A search with no reward left to pay. */
export function searchSpent(ctx: Reads, spot: string, act: ActivityDef): boolean {
  return eligibleRewards(ctx, spot, act).length === 0;
}

function rollSearch(ctx: W, spot: string, act: ActivityDef): SearchReward | null {
  const key = searchKey(spot, act.id);
  ctx.emit(bumpCounter, { key });
  const counts = ctx.read(counters);
  const done = counterValue(counts, key) + 1;
  const eligible = eligibleRewards(ctx, spot, act);
  if (!eligible.length) return null;
  let chosen = eligible.find((rw) => rw.guaranteedBy !== undefined && done >= rw.guaranteedBy && !counterValue(counts, `${key}:${rw.id}`));
  if (!chosen) {
    let roll = ctx.rng.next() * eligible.reduce((n, rw) => n + rw.weight, 0);
    chosen = eligible.find((rw) => (roll -= rw.weight) < 0) ?? eligible[eligible.length - 1];
  }
  ctx.emit(bumpCounter, { key: `${key}:${chosen.id}` });
  return chosen;
}

// ---- activities: reads ----

/** Baseline ticks per training rep. */
export const TRAIN_REP_TICKS = 20;

/** A craft activity whose recipe is unlocked. False without a craft provider. */
export function craftUnlocked(ctx: Reads, act: ActivityDef): boolean {
  const kind = craftProvider();
  return !!kind && !!act.recipe && kind.unlocked(ctx, act.recipe);
}

/**
 * Whether an activity can be started at a spot now: a craft is unlocked and
 * affordable, a search has a reward left to pay. The old `canStartActivity`.
 */
export function canStartActivity(ctx: Reads, spotId: string, activityId: string): boolean {
  const act = spotActivities(getSpot(spotId)).find((a) => a.id === activityId);
  if (!act) return false;
  if (act.kind === 'craft') {
    const kind = craftProvider();
    return !!kind && !!act.recipe && kind.unlocked(ctx, act.recipe) && kind.affordable(ctx, act.recipe);
  }
  if (act.kind === 'search') return !searchSpent(ctx, spotId, act);
  return true;
}

/** The attribute XP split of an activity, with the default of its kind. */
export function attrXpWeights(act: ActivityDef): Partial<Record<AttributeId, number>> {
  if (act.attrXp) return Object.fromEntries(act.attrXp.map((w) => [w.attr, w.weight]));
  switch (act.kind) {
    case 'train':
      return act.attr ? { [act.attr]: 1 } : {};
    case 'gather':
      return { wis: 1 };
    case 'job':
      return { cha: 1 };
    default:
      return {};
  }
}

/** The tags a cycle of an activity grants skill XP under. */
export function activityXpTags(act: ActivityDef): string[] {
  switch (act.kind) {
    case 'train':
      return ['training', ...Object.keys(attrXpWeights(act)), ...(act.tags ?? [])];
    case 'gather':
      return ['explore', 'gather', ...(act.tags ?? [])];
    case 'job':
      return ['job', ...(act.tags ?? [])];
    case 'craft':
      return ['craft', ...(act.tags ?? [])];
    case 'search':
    case 'explore':
      return ['explore', ...(act.tags ?? [])];
    case 'hunt':
      return ['combat', 'hunt'];
    default:
      return [];
  }
}

/** Discovered spots with an activity that trains a skill or an attribute. Unlocked crafts only. */
export function trainingSpots(ctx: Reads, state: State, target: { skill: string } | { attr: AttributeId }): { spot: string; activity: string }[] {
  const def = 'skill' in target ? SKILLS[target.skill] : null;
  if ('skill' in target && !def) return [];
  const trains = (act: ActivityDef) =>
    def ? skillTrainedBy(def, activityXpTags(act)) : act.kind === 'train' && 'attr' in target && (attrXpWeights(act)[target.attr] ?? 0) > 0;
  const out: { spot: string; activity: string }[] = [];
  for (const spotId of state.discovered) {
    const spot = SPOTS[spotId];
    if (!spot) continue;
    for (const act of spotActivities(spot)) {
      if (act.kind === 'craft' && !craftUnlocked(ctx, act)) continue;
      if (trains(act)) out.push({ spot: spotId, activity: act.id });
    }
  }
  return out;
}

function factorSum(ctx: Reads, stats: Readonly<DerivedStats>, factors?: ActivityDef['speedFactors']): number {
  let sum = 0;
  for (const f of factors ?? []) {
    const value = f.attr
      ? formulaAttr(ctx, f.attr)
      : f.stat
        ? ((stats as unknown as Record<string, number>)[f.stat] ?? 0)
        : f.skill
          ? skillLevel(ctx.read(skills), f.skill)
          : 0;
    sum += f.weight * (value - (f.base ?? 0));
  }
  return sum;
}

const softCap = (x: number, cap?: number): number => (cap ? (cap * x) / (x + cap) : x);

export function activitySpeedMult(ctx: Reads, stats: Readonly<DerivedStats>, act: ActivityDef): number {
  return Math.max(0.1, 1 + factorSum(ctx, stats, act.speedFactors));
}

export function activityOutputMult(ctx: Reads, stats: Readonly<DerivedStats>, act: ActivityDef): number {
  if (!act.outputFactors?.length) return 1;
  return 1 + softCap(Math.max(0, factorSum(ctx, stats, act.outputFactors)), act.outputCap);
}

/** Units the action bar of an activity needs. 0 for a kind with no cycle. */
export function activityCost(act: ActivityDef, stats: Readonly<DerivedStats>): number {
  let baselineTicks = 0;
  switch (act.kind) {
    case 'train':
      baselineTicks = TRAIN_REP_TICKS;
      break;
    case 'gather':
    case 'job':
    case 'search':
      baselineTicks = act.ticksPer ?? 0;
      break;
    case 'craft':
      baselineTicks = (act.recipe ? craftProvider()?.ticks(act.recipe) : undefined) ?? 50;
      break;
    default:
      return 0;
  }
  if (act.staticTime) return baselineTicks * BASE_SPEED;
  return baselineTicks * BASE_SPEED * (stats.actionBar / BASE_ACTION_BAR);
}

/** Units the activity bar gains per tick. */
export function activityFillRate(ctx: Reads, act: ActivityDef, stats: Readonly<DerivedStats>): number {
  if (act.staticTime) return BASE_SPEED;
  const speed = stats.speed * activitySpeedMult(ctx, stats, act);
  if (act.kind !== 'craft') return speed;
  // The flat craftSpeed, then the craftSpeed scoped to the tags of the recipe.
  return speed * stats.craftSpeed * scopedMult(ctx, 'craftSpeed' as StatKey, act.tags ?? []);
}

// ---- roads ----

/** Roads the player can see from a spot. The old `visibleEdges`. */
export function visibleEdges(ctx: Reads, state: State, spotId: string): Edge[] {
  const r = reader(ctx);
  const edges = edgesFrom(spotId).filter((e) => conditionsMet(r, e.revealWhen ?? []));
  if (edges.every((e) => !e.hidden)) return edges;
  const opened = foundPaths(state, spotId);
  return edges.filter((e) => !e.hidden || isExplored(state, e.from) || opened.has(e.to));
}

const areaOf = (spotId: string): string => SPOTS[spotId]?.areaId ?? '';

/** The tower whose ladder answers at a spot. */
export function towerAt(spotId: string): TowerDef | null {
  return towerAtSpot(spotId, areaOf(spotId));
}

/** The floor a spot is on. */
export function floorOfSpot(spotId: string): FloorDef | null {
  return FLOOR_BY_AREA.get(areaOf(spotId)) ?? null;
}

/** The stops the router may send the player to: discovered, and the gate open. */
export function routableStops(ctx: Reads, state: State): RideStop[] {
  const r = reader(ctx);
  return Object.values(TOWERS)
    .flatMap(rideStops)
    .filter((stop) => state.discovered.includes(stop.spot) && stopOpen(r, stop));
}

const RIDE_LABEL = { Climbing: 'Ladder: climb', Descending: 'Ladder: descend', Crossing: 'Ladder: cross' } as const;

/** The rides the router may take from a spot. Derived on every call. */
export function rideEdges(ctx: Reads, state: State, from: string, stops?: RideStop[]): Edge[] {
  const tower = towerAt(from);
  if (!tower) return [];
  const open = stops ?? routableStops(ctx, state);
  const fromIndex = spotIndex(from, areaOf(from));
  const fromFloor = floorOfSpot(from);
  return open
    .filter((st) => st.tower === tower.id && st.spot !== from && (!st.floor || st.floor.id !== fromFloor?.id))
    .map((st) => ({
      from,
      to: st.spot,
      ticks: rideTicks(fromIndex, st.index),
      label: RIDE_LABEL[climbVerb(tower, fromIndex, st.index)],
      ride: true as const,
      toIndex: st.index,
    }));
}

/** The base price of the ride between two spots, or null when `to` is no stop of the tower at `from`. */
export function rideBaseTicks(from: string, to: string): number | null {
  const tower = towerAt(from);
  const stop = tower ? rideStops(tower).find((st) => st.spot === to) : undefined;
  return stop ? rideTicks(spotIndex(from, areaOf(from)), stop.index) : null;
}

interface RideCache {
  stops?: RideStop[];
}

function hopEdges(ctx: Reads, state: State, spotId: string, cache: RideCache): Edge[] {
  const roads = visibleEdges(ctx, state, spotId);
  if (!towerAt(spotId)) return roads;
  if (!cache.stops) cache.stops = routableStops(ctx, state);
  const rides = rideEdges(ctx, state, spotId, cache.stops).filter((ride) => !roads.some((e) => e.to === ride.to));
  return rides.length > 0 ? [...roads, ...rides] : roads;
}

/** The edge a hop between two adjacent spots takes: the visible road, else the ride. */
export function hopEdge(ctx: Reads, state: State, from: string, to: string): Edge | undefined {
  return visibleEdges(ctx, state, from).find((e) => e.to === to) ?? rideEdges(ctx, state, from).find((e) => e.to === to);
}

/**
 * Shortest path by ticks over discovered spots, visible roads and the rides
 * of the ladder. The hop list without `from`, or null. `unknownDest`: the
 * destination itself may be undiscovered. The old `findPath`.
 */
export function findPath(ctx: Reads, state: State, from: string, to: string, opts: { unknownDest?: boolean } = {}): string[] | null {
  if (from === to) return [];
  if (!opts.unknownDest && !state.discovered.includes(to)) return null;
  const r = reader(ctx);
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const queue = new Set<string>([from]);
  const rides: RideCache = {};
  const known = new Set(state.discovered);

  while (queue.size > 0) {
    let current: string | null = null;
    let best = Infinity;
    for (const id of queue) {
      const d = dist.get(id)!;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    queue.delete(current!);
    if (current === to) break;
    for (const edge of hopEdges(ctx, state, current!, rides)) {
      if (!known.has(edge.to) && edge.to !== to) continue;
      // A shut road neither routes through nor to.
      if (edge.requires && !conditionsMet(r, edge.requires)) continue;
      // Never through a fight that cannot be fled. As the destination it is allowed. A cleared spot forces nothing.
      if (edge.to !== to && (edge.forced || SPOTS[edge.to]?.forced) && !(SPOTS[edge.to] && spotCleared(ctx, SPOTS[edge.to]))) continue;
      const next = best + edge.ticks;
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, current!);
        queue.add(edge.to);
      }
    }
  }

  if (!prev.has(to)) return null;
  const path: string[] = [];
  for (let node = to; node !== from; node = prev.get(node)!) path.unshift(node);
  return path;
}

/** Total base ticks along a hop path. A hop with no road is a ride. */
export function pathTicks(from: string, path: readonly string[]): number {
  let total = 0;
  let current = from;
  for (const hop of path) {
    total += edgesFrom(current).find((e) => e.to === hop)?.ticks ?? rideBaseTicks(current, hop) ?? 0;
    current = hop;
  }
  return total;
}

/** Where the journey in progress ends, or null when standing. */
export function journeyEnd(state: State): string | null {
  if (!state.travel) return null;
  return state.travelPlan.length > 0 ? state.travelPlan[state.travelPlan.length - 1] : state.travel.to;
}

// ---- pace ----

/** State what the character is doing to the pools and the conditions. */
export function syncPace(ctx: W): void {
  const state = ctx.state;
  if (state.travel) {
    ctx.emit(setPace, { halted: true });
    return;
  }
  if (state.recovering) {
    ctx.emit(setPace, { halted: false, resting: true, hpMult: RECOVERY_MULT.rest, healKind: 'rest' });
    return;
  }
  const kind = currentActivity(state)?.kind ?? 'none';
  const resting = kind === 'rest';
  ctx.emit(setPace, { halted: false, resting, hpMult: RECOVERY_MULT[kind], healKind: resting ? 'rest' : 'idle' });
}

// ---- activities: start and stop ----

function leaveFight(ctx: W): boolean {
  const c = combatOf(ctx);
  const had = c.fight !== null;
  if (had) ctx.request(abandon, undefined);
  if (c.hunting) ctx.request(stopHuntLoop, undefined);
  return had;
}

/**
 * Start or stop an activity without ending a knockout return. False when the
 * pick was refused. The old `startActivity`.
 */
export function startActivity(ctx: W, activityId: string | null): boolean {
  const state = ctx.state;
  if (state.activity === activityId) return true;
  if (inForcedFight(combatOf(ctx))) {
    say(ctx, 'no_leaving_fight', undefined, 'danger');
    return false;
  }
  if (activityId) {
    const picked = spotActivities(getSpot(state.spot)).find((a) => a.id === activityId);
    if (picked?.kind === 'craft' && !craftUnlocked(ctx, picked)) {
      say(ctx, 'craft_locked', undefined, 'danger');
      return false;
    }
  }
  leaveFight(ctx);
  state.activity = activityId;
  state.activityProgress = 0;
  state.travelPlan = [];
  state.travelIntent = null;
  if (activityId) {
    delete state.resumeActivity[state.spot];
    state.resumeActivity[state.spot] = activityId;
  } else delete state.resumeActivity[state.spot];

  const act = currentActivity(state);
  if (act) say(ctx, 'started', { name: act.name }, 'action');
  syncPace(ctx);
  ctx.emit(activityChanged, { spot: state.spot, activity: act?.id ?? null, kind: act?.kind ?? null });
  return true;
}

/**
 * Clear the activity and nothing else: the start of a bench run (old
 * `startBenchWork`: `activity = null`, progress 0). No fight is left, no plan
 * cleared, the resume choice kept. Step 3 (benches).
 */
export function dropActivity(ctx: W): void {
  const state = ctx.state;
  const had = state.activity !== null;
  state.activity = null;
  state.activityProgress = 0;
  syncPace(ctx);
  if (had) ctx.emit(activityChanged, { spot: state.spot, activity: null, kind: null });
}

/** An intent with this activity starts nothing on arrival. */
export const ARRIVE_IDLE = '';

/** The end of a journey, peacefully reached. The old `settleArrival`. */
function settleArrival(ctx: W): void {
  const state = ctx.state;
  const intent = state.travelIntent;
  state.travelIntent = null;
  if (state.travel || state.travelPlan.length > 0 || state.recovering || combatOf(ctx).fight) return;
  const wanted = intent && intent.spot === state.spot ? intent.activity : state.resumeActivity[state.spot];
  if (wanted && canStartActivity(ctx, state.spot, wanted)) startActivity(ctx, wanted);
}

// ---- discovery and the map ----

function discover(ctx: W, spotId: string): boolean {
  if (ctx.state.discovered.includes(spotId)) return false;
  ctx.state.discovered.push(spotId);
  ctx.emit(discovered, { spot: spotId });
  return true;
}

/** Discover the rest of every mapped region the player has a foothold in. The old `revealMapped`. */
export function revealMapped(ctx: W): { region: string; added: number }[] {
  const known = new Set(ctx.state.discovered);
  const byRegion = new Map<string, string[]>();
  for (const spot of Object.values(SPOTS)) {
    const regionId = AREAS[spot.areaId]?.regionId;
    if (!regionId || !REGIONS[regionId]?.mapped) continue;
    const list = byRegion.get(regionId);
    if (list) list.push(spot.id);
    else byRegion.set(regionId, [spot.id]);
  }
  const opened: { region: string; added: number }[] = [];
  for (const [regionId, ids] of byRegion) {
    if (!ids.some((id) => known.has(id))) continue;
    let added = 0;
    for (const id of ids) {
      if (known.has(id)) continue;
      discover(ctx, id);
      known.add(id);
      added++;
    }
    if (added > 0) opened.push({ region: regionId, added });
  }
  return opened;
}

function logMapped(ctx: W): void {
  for (const { region, added } of revealMapped(ctx)) {
    say(ctx, 'region_mapped', { region: REGIONS[region]?.name ?? region, count: added }, 'travel');
  }
}

// ---- havens and the retreat (old `safety.ts`) ----

/** A spot with a rest this character may use. */
export function canRestAt(ctx: Reads, spot: SpotDef): boolean {
  const r = reader(ctx);
  return restActivities(spot).some((a) => !a.requires || conditionsMet(r, a.requires));
}

function noteSafeSpot(ctx: W, spotId: string): void {
  const spot = SPOTS[spotId];
  if (!spot) return;
  if (canRestAt(ctx, spot)) ctx.state.safeSpots.nearest = spotId;
  if (isUnconditionalHaven(spot)) ctx.state.safeSpots.unconditional = spotId;
}

/** The spot to retreat to. Never nowhere. The old `retreatSpot`. */
export function retreatSpot(ctx: Reads, state: State): string {
  const nearest = state.safeSpots.nearest;
  if (nearest && SPOTS[nearest] && canRestAt(ctx, SPOTS[nearest])) return nearest;
  const fallback = state.safeSpots.unconditional;
  if (fallback && SPOTS[fallback]) return fallback;
  if (isUnconditionalHaven(getSpot(STARTING_SPOT))) return STARTING_SPOT;
  const anyHaven = Object.values(SPOTS).find((sp) => isUnconditionalHaven(sp));
  return anyHaven?.id ?? STARTING_SPOT;
}

/**
 * Throw the player clear of a fight. Combat is already over. Answers the
 * spot left. The old `retreatToSafety`; `knockedOut` also sets `recovering`.
 */
export function retreatToSafety(ctx: W, reason: string, knockedOut: boolean): string {
  const state = ctx.state;
  const to = retreatSpot(ctx, state);
  const from = state.spot;
  const hadActivity = state.activity;
  if (combatOf(ctx).hunting) ctx.request(stopHuntLoop, undefined);
  state.spot = to;
  state.activity = null;
  state.travel = null;
  state.travelPlan = [];
  state.travelIntent = null;
  if (knockedOut && !state.recovering) {
    state.recovering = true;
    ctx.emit(setSituation, { down: true });
  }
  discover(ctx, to);
  revealMapped(ctx);
  const dest = getSpot(to);
  say(ctx, 'wake', { reason, icon: dest.icon, spot: dest.name }, 'danger');
  syncPace(ctx);
  if (hadActivity) ctx.emit(activityChanged, { spot: to, activity: null, kind: null });
  ctx.emit(arrived, { spot: to, from, ambushed: false });
  ctx.emit(bumpCounter, { key: TRIPS_KEY });
  ctx.emit(checkClears, undefined);
  return from;
}

/**
 * Stand the player at a spot with no road walked: the activity, the journey
 * and the plan stop. The skip of floor 0 (old `skipTutorial`): the spot is
 * discovered and noted as a haven, the mapped region is revealed and
 * `world/arrived` is sent. The start of a run (old `prestigeNow`,
 * `newRun: true`): the spot is the only one discovered, the region is
 * revealed, nothing is noted and no arrival is sent.
 */
export function placeAt(ctx: W, spotId: string, newRun: boolean): boolean {
  const state = ctx.state;
  if (!SPOTS[spotId]) return false;
  const from = state.spot;
  const hadActivity = state.activity;
  if (combatOf(ctx).hunting) ctx.request(stopHuntLoop, undefined);
  state.activity = null;
  state.travel = null;
  state.travelPlan = [];
  state.travelIntent = null;
  if (newRun) {
    state.spot = spotId;
    state.discovered = [spotId];
  } else if (state.spot !== spotId) {
    state.spot = spotId;
    discover(ctx, spotId);
    noteSafeSpot(ctx, spotId);
  }
  revealMapped(ctx);
  syncPace(ctx);
  if (hadActivity) ctx.emit(activityChanged, { spot: spotId, activity: null, kind: null });
  if (!newRun) ctx.emit(arrived, { spot: spotId, from, ambushed: false });
  return true;
}

/** Recovery is over. */
export function recover(ctx: W): void {
  if (!ctx.state.recovering) return;
  ctx.state.recovering = false;
  ctx.emit(setSituation, { down: false });
  say(ctx, 'recovered', undefined, 'action');
  syncPace(ctx);
}

// ---- the flooded offices (old `officeArrival`) ----

export const OFFICE_PROGRESS = 'flag:toll_office_sequence';
export const OFFICE_ROOMS = ['f1_reception', 'f1_scribe', 'f1_auditor', 'f1_break_room', 'f1_registry', 'f1_dispatch', 'f1_supplies', 'f1_records', 'f1_toll_hall'];
export const OFFICE_SEQUENCE = ['f1_scribe', 'f1_auditor', 'f1_break_room', 'f1_scribe', 'f1_toll_hall'];

export const keyItemKey = (id: string): string => `flag:key_item:${id}`;

export function hasKeyItem(ctx: Reads, id: string): boolean {
  return counterValue(ctx.read(counters), keyItemKey(id)) > 0;
}

/** Hand over a key item once. The old `grantKeyItem`. */
export function grantKeyItem(ctx: W, id: string): void {
  const item = KEY_ITEMS[id];
  if (!item || hasKeyItem(ctx, id)) return;
  ctx.emit(setCounter, { key: keyItemKey(id), value: 1 });
  say(ctx, 'key_item', { icon: item.icon, name: item.name, desc: item.desc }, 'loot');
}

/** Where a walk into the office block of floor 1 ends. Runs before discovery and the ambush check. */
function officeArrival(ctx: W, from: string, to: string): string {
  const set = (value: number) => ctx.emit(setCounter, { key: OFFICE_PROGRESS, value });
  if (!OFFICE_ROOMS.includes(to)) {
    if (OFFICE_ROOMS.includes(from)) set(0);
    return to;
  }
  if (to === 'f1_reception') {
    set(0);
    return to;
  }
  const counts = ctx.read(counters);
  // A cleared floor stays freely walkable.
  if (counterValue(counts, 'boss:f1_toll_hall') > 0) return to;
  const progress = counterValue(counts, OFFICE_PROGRESS);
  const key = hasKeyItem(ctx, 'toll_office_key');
  if (OFFICE_ROOMS.includes(from) && key && to === OFFICE_SEQUENCE[progress]) {
    set(progress + 1);
    return to;
  }
  const restart = key && to === OFFICE_SEQUENCE[0];
  set(restart ? 1 : 0);
  ctx.state.travelPlan = [];
  ctx.state.travelIntent = null;
  say(ctx, 'office_wrong', undefined, 'explore');
  if (to === 'f1_toll_hall') {
    say(ctx, 'office_reception', undefined, 'explore');
    return 'f1_reception';
  }
  if (restart) return to;
  const drops = OFFICE_ROOMS.filter((room) => room !== to && room !== 'f1_reception' && room !== 'f1_toll_hall' && room !== OFFICE_SEQUENCE[0]);
  const landed = drops[ctx.rng.int(drops.length)];
  say(ctx, 'office_drop', { landed: SPOTS[landed]?.name ?? 'another office', named: SPOTS[to]?.name ?? 'the office it named' }, 'explore');
  return landed;
}

// ---- travel ----

interface TravelOpts {
  /** A leg of a planned journey: keep the plan and stay quiet in the log. */
  planned?: boolean;
  /** Started by another system inside a tick. */
  fresh?: boolean;
}

function setOut(ctx: W, to: string, baseTicks: number, opts: TravelOpts): void {
  const state = ctx.state;
  if (leaveFight(ctx)) say(ctx, 'disengage', undefined, 'combat');
  const hadActivity = state.activity;
  state.activity = null;
  if (!opts.planned) {
    state.travelPlan = [];
    state.travelIntent = null;
  }
  const speed = statBlockOf(ctx).travelSpeed;
  const ticks = Math.max(1, Math.round(baseTicks / speed));
  state.travel = { from: state.spot, to, ticksLeft: ticks, total: ticks, ...(opts.fresh ? { fresh: true as const } : {}) };
  syncPace(ctx);
  if (hadActivity) ctx.emit(activityChanged, { spot: state.spot, activity: null, kind: null });
}

/** One ride of the ladder. The old `ride`. */
function ride(ctx: W, tower: TowerDef, to: string, toIndex: number, seam: string | undefined, opts: TravelOpts): boolean {
  const state = ctx.state;
  if (to === state.spot) return false;
  const fromIndex = spotIndex(state.spot, areaOf(state.spot));
  setOut(ctx, to, rideTicks(fromIndex, toIndex), opts);
  if (!opts.planned) {
    const dest = getSpot(to);
    say(ctx, 'moving', { verb: seam ?? climbVerb(tower, fromIndex, toIndex), icon: dest.icon, name: dest.name }, 'travel');
  }
  return true;
}

/** One ride as a leg of a journey: the edge must be one the ladder offers now. The old `rideLeg`. */
function rideLeg(ctx: W, to: string, opts: TravelOpts): boolean {
  const tower = towerAt(ctx.state.spot);
  const edge = tower ? rideEdges(ctx, ctx.state, ctx.state.spot).find((e) => e.to === to) : undefined;
  if (!tower || !edge) return false;
  return ride(ctx, tower, edge.to, edge.toIndex!, undefined, opts);
}

/** One hop: a visible road, else a ride. The old `startTravel`. */
export function startTravel(ctx: W, to: string, opts: TravelOpts = {}): boolean {
  const state = ctx.state;
  if (state.travel || state.recovering) return false;
  if (inForcedFight(combatOf(ctx))) {
    say(ctx, 'no_leaving_fight', undefined, 'danger');
    return false;
  }
  const edge = visibleEdges(ctx, state, state.spot).find((e) => e.to === to);
  if (!edge) return rideLeg(ctx, to, opts);
  if (edge.requires && !conditionsMet(reader(ctx), edge.requires)) {
    say(ctx, 'blocked', undefined, 'travel');
    return false;
  }
  setOut(ctx, to, edge.ticks, opts);
  if (!opts.planned) {
    const dest = getSpot(to);
    say(
      ctx,
      'heading',
      {
        name: state.discovered.includes(to) ? dest.name : TEXT.unknown_place,
        via: edge.label ? fillText(TEXT.via, { label: edge.label }) : '',
      },
      'travel',
    );
  }
  return true;
}

/**
 * Ride the stack to the landing of a floor, or with null to the hub. The old
 * `climbTo`, without the festival verdicts.
 */
export function climbTo(ctx: W, floorId: string | null, opts: TravelOpts = {}): boolean {
  const state = ctx.state;
  if (state.travel || state.recovering) return false;
  if (inForcedFight(combatOf(ctx))) {
    say(ctx, 'no_leaving_fight', undefined, 'danger');
    return false;
  }
  const tower = towerAt(state.spot);
  if (!tower) return false;
  const floor: FloorDef | null | undefined = floorId === null ? null : FLOORS[floorId];
  if (floor === undefined) return false;
  const stop = floor ? floorStop(floor) : hubStop(tower);
  if (!stop || stop.tower !== tower.id || !stopOpen(reader(ctx), stop)) return false;
  if (!floor) return ride(ctx, tower, stop.spot, 0, undefined, opts);
  const here = floorOfSpot(state.spot);
  const seam = here && stop.index === spotIndex(state.spot, areaOf(state.spot)) + 1 ? here.seam?.verb : undefined;
  return ride(ctx, tower, stop.spot, stop.index, seam, opts);
}

/** Walk to any discovered spot, or to an unknown place one visible road past known ground. The old `travelPlanTo`. */
export function travelPlanTo(ctx: W, to: string, opts: TravelOpts = {}): boolean {
  const state = ctx.state;
  if (state.travel || state.recovering || to === state.spot) return false;
  const path = findPath(ctx, state, state.spot, to, { unknownDest: true });
  if (!path || path.length === 0) return false;
  state.travelPlan = path.slice(1);
  if (!startTravel(ctx, path[0], { planned: true, fresh: opts.fresh })) {
    state.travelPlan = [];
    return false;
  }
  state.travelIntent = null;
  const dest = getSpot(to);
  const known = state.discovered.includes(to);
  say(
    ctx,
    'setting_out',
    {
      icon: known ? dest.icon : '❓',
      name: known ? dest.name : TEXT.unknown_place,
      legs: path.length > 1 ? fillText(TEXT.legs, { legs: path.length }) : '',
    },
    'travel',
  );
  return true;
}

/** Walk to a spot and start an activity on arrival. Standing there, it starts. The old `goAndDo`. */
export function goAndDo(ctx: W, spotId: string, activityId: string, opts: TravelOpts = {}): boolean {
  const state = ctx.state;
  const spot = SPOTS[spotId];
  if (!spot || !spotActivities(spot).some((a) => a.id === activityId)) return false;
  if (spotId === state.spot && !state.travel) {
    if (!canStartActivity(ctx, spotId, activityId)) return false;
    startActivity(ctx, activityId);
    return state.activity === activityId;
  }
  if (!travelPlanTo(ctx, spotId, opts)) return false;
  state.travelIntent = { spot: spotId, activity: activityId };
  return true;
}

/** Change what the journey in progress is for. `null`: nothing, arrival resumes. The old `setJourneyIntent`. */
export function setJourneyIntent(state: WorldState, activityId: string | null): boolean {
  const end = journeyEnd(state);
  if (!end) return false;
  if (activityId === null) {
    state.travelIntent = null;
    return true;
  }
  if (activityId !== ARRIVE_IDLE && !spotActivities(getSpot(end)).some((a) => a.id === activityId)) return false;
  state.travelIntent = { spot: end, activity: activityId };
  return true;
}

/** Abandon the remaining legs. The leg under way still completes. */
export function cancelTravelPlan(ctx: W): boolean {
  if (ctx.state.travelPlan.length === 0) return false;
  ctx.state.travelPlan = [];
  ctx.state.travelIntent = null;
  say(ctx, 'stop_requested', undefined, 'travel');
  return true;
}

/** What follows every arrival: the haven, the events, the ambush or the settle. */
function arrive(ctx: W, from: string, walked: Edge | undefined): void {
  const state = ctx.state;
  const dest = getSpot(state.spot);
  // A cleared spot forces nothing.
  const ambushed = !!(dest.forced || walked?.forced) && !spotCleared(ctx, dest);
  // Only a peaceful arrival records a haven.
  if (!ambushed) noteSafeSpot(ctx, dest.id);
  syncPace(ctx);
  ctx.emit(arrived, { spot: dest.id, from, ambushed });
  ctx.emit(bumpCounter, { key: TRIPS_KEY });
  ctx.emit(checkClears, undefined);

  if (ambushed) {
    state.travelPlan = [];
    state.travelIntent = null;
    ctx.request(startForced, { site: siteOf(ctx, dest) });
    return;
  }
  if (state.travelPlan.length > 0 && !state.recovering) {
    const next = state.travelPlan.shift()!;
    if (!startTravel(ctx, next, { planned: true })) {
      state.travelPlan = [];
      state.travelIntent = null;
      say(ctx, 'route_blocked', undefined, 'travel');
    }
    return;
  }
  settleArrival(ctx);
}

function tickTravel(ctx: W): void {
  const state = ctx.state;
  const t = state.travel!;
  if (t.fresh) {
    delete t.fresh;
    return;
  }
  t.ticksLeft -= 1;
  if (t.ticksLeft > 0) return;

  state.travel = null;
  const to = officeArrival(ctx, t.from, t.to);
  state.spot = to;

  // Walking grants Scouting XP by distance.
  ctx.emit(checkDiscovery, { tags: ['travel', 'explore'] });
  ctx.emit(grantSkillXp, { tags: ['travel', 'explore'], amount: t.total * 0.08 });

  const morePlanned = state.travelPlan.length > 0;
  const spot = getSpot(to);
  if (discover(ctx, to)) say(ctx, 'discovered', { icon: spot.icon, name: spot.name }, 'travel');
  else if (!morePlanned) say(ctx, 'arrived', { name: spot.name }, 'travel');
  logMapped(ctx);
  arrive(
    ctx,
    t.from,
    edgesFrom(t.from).find((e) => e.to === to),
  );
}

// ---- fast travel ----

/** Gold price of the caravan between waypoints. */
export function fastTravelCost(ctx: Reads, state: State, to: string): number {
  const path = findPath(ctx, state, state.spot, to);
  if (!path || path.length === 0) return 1000;
  return Math.max(100, pathTicks(state.spot, path) * 2);
}

export function canFastTravel(state: State, to: string): boolean {
  return (
    !state.travel &&
    !state.recovering &&
    to !== state.spot &&
    !!getSpot(state.spot).waypoint &&
    !!SPOTS[to]?.waypoint &&
    state.discovered.includes(to)
  );
}

/** Waypoint to waypoint for gold, at once. The old `fastTravelTo`. */
export function fastTravelTo(ctx: W, to: string): string | null {
  const state = ctx.state;
  if (!canFastTravel(state, to)) return 'the caravan does not run between these two spots now';
  if (inForcedFight(combatOf(ctx))) {
    say(ctx, 'no_leaving_fight', undefined, 'danger');
    return 'the fight cannot be left';
  }
  const cost = fastTravelCost(ctx, state, to);
  if (goldOf(ctx.read(gold)) < cost || !ctx.request(spendGold, { amount: cost })) {
    say(ctx, 'caravan_unaffordable', { cost }, 'travel');
    return `the caravan fee is ${cost} gold`;
  }
  leaveFight(ctx);
  const from = state.spot;
  const hadActivity = state.activity;
  state.activity = null;
  state.travelPlan = [];
  state.travelIntent = null;
  state.spot = to;
  if (hadActivity) ctx.emit(activityChanged, { spot: to, activity: null, kind: null });
  const dest = getSpot(to);
  say(ctx, 'fast_traveled', { icon: dest.icon, name: dest.name, cost }, 'travel');
  arrive(ctx, from, undefined);
  return null;
}

// ---- finds ----

const randInt = (ctx: W, lo: number, hi: number): number => lo + ctx.rng.int(hi - lo + 1);

/** Hand over the payload of a find and remember it as claimed. The old `grantFind`. */
function grantFind(ctx: W, spot: SpotDef, find: FindPayload & { spot?: string; path?: string }, remember = true): void {
  const state = ctx.state;
  if (remember) {
    if (!state.finds[spot.id]) state.finds[spot.id] = [];
    state.finds[spot.id].push(find.id);
  }
  if (find.keyItem) grantKeyItem(ctx, find.keyItem);

  const tally: LogTally[] = [];
  if (find.gold) {
    const amount = randInt(ctx, find.gold.min, find.gold.max);
    ctx.request(addGold, { amount, earned: true });
    tally.push({ label: 'gold', qty: amount, style: 'amount' });
  }
  if (find.material) {
    const qty = find.material.qty ?? 1;
    // A raw find: no loot multiplier.
    ctx.request(grantMaterial, { id: find.material.id, qty, luck: 1 });
    ctx.emit(bumpCounter, { key: `gather:${find.material.id}`, amount: qty });
    const mat = MATERIALS[find.material.id];
    tally.push({ label: `${mat?.icon ?? '📦'} ${mat?.name ?? find.material.id}`, qty });
  }
  if (find.item) {
    ctx.request(grantItem, { defId: find.item });
    const item = ITEMS[find.item];
    tally.push({ label: `${item?.icon ?? '📦'} ${item?.name ?? find.item}`, qty: 1 });
  }
  if (find.rune) {
    ctx.request(grantRune, { id: find.rune, qty: 1, silent: true });
    const rune = RUNES[find.rune];
    tally.push({ label: `${rune?.icon ?? '🔣'} ${rune?.name ?? find.rune}`, qty: 1 });
  }
  if (find.skillXp) {
    ctx.emit(checkDiscovery, { tags: find.skillXp.tags });
    ctx.emit(grantSkillXp, { tags: find.skillXp.tags, amount: find.skillXp.xp });
  }
  if (find.stat) {
    if (find.stat.set !== undefined) ctx.emit(setCounter, { key: find.stat.key, value: find.stat.set });
    else ctx.emit(bumpCounter, { key: find.stat.key, amount: find.stat.amount ?? 1 });
  }

  ctx.emit(logLine, { msg: find.desc ?? fillText(TEXT.find_generic, { spot: spot.name }), kind: 'explore' });
  if (tally.length > 0) ctx.emit(logLine, repeatLine({ group: `find:${spot.id}:${find.id}`, prefix: '🎁 Found:', tally, kind: 'loot' }));

  if (find.spot && discover(ctx, find.spot)) {
    const target = getSpot(find.spot);
    say(ctx, 'find_marks_spot', { icon: target.icon, name: target.name }, 'explore');
    revealMapped(ctx);
  }
  if (find.path) {
    const edge = spot.connections.find((c) => c.to === find.path);
    say(ctx, 'find_opens_path', { spot: spot.name, label: edge?.label ?? getSpot(find.path).name }, 'explore');
  }
}

function tickExplore(ctx: W, spot: SpotDef, lootLuck: number, extraTags: readonly string[]): void {
  const state = ctx.state;
  const tags = ['explore', ...extraTags];
  ctx.emit(checkDiscovery, { tags });
  ctx.emit(grantSkillXp, { tags, amount: 0.3 });

  const gate = blockingGate(ctx, state, spot);
  if (gate) {
    ctx.emit(
      logLine,
      repeatLine({
        group: `gate:${spot.id}:${gate.at}`,
        prefix: gate.desc ?? fillText(TEXT.gate_generic, { percent: Math.round(gate.at * 100) }),
        tally: [],
        kind: 'explore',
      }),
    );
    return;
  }

  const before = isExplored(state, spot.id);
  state.explored[spot.id] = (state.explored[spot.id] ?? 0) + 1;

  // At most one find per tick.
  const pending = pendingFinds(ctx, state, spot);
  if (pending.length > 0) grantFind(ctx, spot, pending[0]);

  if (!before && isExplored(state, spot.id)) {
    const hidden = spot.connections.filter((c) => c.hidden);
    if (hidden.length > 0) say(ctx, 'explored_paths', { spot: spot.name, paths: hidden.map((c) => c.label ?? c.to).join(', ') }, 'explore');
    else say(ctx, 'explored', { spot: spot.name }, 'explore');
    return;
  }

  // A fully explored spot still yields the occasional find.
  if (ctx.rng.chance(0.008 * lootLuck)) {
    const amount = randInt(ctx, 1, 4 + Math.floor(lootLuck * 3));
    ctx.request(addGold, { amount, earned: true });
    ctx.emit(
      logLine,
      repeatLine({
        group: `explore:${spot.id}`,
        prefix: '🪙 Found while exploring:',
        tally: [{ label: 'gold', qty: amount, style: 'amount' }],
        kind: 'loot',
      }),
    );
  }
}

// ---- rare finds on work (old `activitydrops.ts`) ----

export const foundKey = (materialId: string): string => `found:${materialId}`;

/** The chance this cycle, after `rarer` has thinned it for every previous find. */
export function dropChance(ctx: Reads, d: NonNullable<ActivityDef['drops']>[number]): number {
  if (!d.rarer || d.rarer <= 1) return d.chance;
  return d.chance / Math.pow(d.rarer, counterValue(ctx.read(counters), foundKey(d.material)));
}

/**
 * A card: a consumable that teaches or stamps once. The old `isCard`, on the
 * fields the material registry carries.
 */
function isOneTimeCard(materialId: string): boolean {
  const spec = (MATERIALS[materialId] as { consumable?: Record<string, unknown> } | undefined)?.consumable;
  if (!spec || spec.votive) return false;
  return !!(spec.teaches || spec.unlocksWord || spec.teachesTechnique || spec.stamps);
}

/** Whether a card's effect has already happened. Registered by `consumables`. */
export type CardSpentCheck = (reads: Reads, materialId: string) => boolean;

let cardSpentCheck: CardSpentCheck = () => false;

/**
 * The old `cardSpent`, handed in by the system that owns it (`consumables`
 * imports `martial`, which imports this system). Called at module load.
 */
export function registerCardSpent(check: CardSpentCheck): void {
  cardSpentCheck = check;
}

function rollActivityDrops(ctx: W, act: ActivityDef): void {
  if (!act.drops?.length) return;
  for (const d of act.drops) {
    const def = MATERIALS[d.material];
    if (!def) continue;
    const held = heldOf(ctx.read(materials), d.material);
    if (isOneTimeCard(d.material) && (cardSpentCheck(ctx, d.material) || held > 0)) continue;
    if (d.unique && held > 0) continue;
    if (!ctx.request(rollMercyChance, { key: `drop:${act.id}:${d.material}`, rate: dropChance(ctx, d) })) continue;
    const qty = d.qty ?? 1;
    if (d.quality && def.graded) ctx.request(grantGraded, { id: d.material, quality: d.quality as QualityTier, qty });
    else ctx.request(grantMaterial, { id: d.material, qty });
    ctx.emit(bumpCounter, { key: foundKey(d.material) });
    say(ctx, 'drop_found', { icon: def.icon, name: qty > 1 ? `${def.name} ×${qty}` : def.name, activity: act.name }, 'loot');
  }
}

// ---- the tick ----

/** Floor plus a roll on the remainder. The old `integerYield`. */
function integerYield(ctx: W, expected: number): number {
  const whole = Math.floor(expected);
  return whole + (ctx.rng.chance(expected - whole) ? 1 : 0);
}

/** Keep the hunt loop of combat on at this spot. */
function ensureHunt(ctx: W, spot: SpotDef): void {
  const c = combatOf(ctx);
  if (c.hunting && c.site?.id === spot.id) return;
  ctx.request(setHunt, { site: siteOf(ctx, spot) });
}

/** Send the site again: the level step of its band may have moved. */
export function refreshHunt(ctx: W): void {
  const c = combatOf(ctx);
  const spot = SPOTS[ctx.state.spot];
  if (!spot || !c.hunting || c.site?.id !== spot.id || c.fight) return;
  ctx.request(setHunt, { site: siteOf(ctx, spot) });
}

/** One tick. The travel branch and the activity half of the old `tickAction`. */
export function runWorldTick(ctx: W): void {
  const state = ctx.state;
  if (state.travel) {
    tickTravel(ctx);
    return;
  }
  // Knocked out: forced rest. The knockout system ends it.
  if (state.recovering) return;

  const spot = getSpot(state.spot);
  // A forced fight starts on arrival and ticks whatever is selected.
  if (!combatOf(ctx).fight && spot.forced && !spotCleared(ctx, spot)) ctx.request(startForced, { site: siteOf(ctx, spot) });
  if (inForcedFight(combatOf(ctx))) return;

  const act = currentActivity(state);
  if (!act) return;
  const stats = statBlockOf(ctx);

  switch (act.kind) {
    case 'train': {
      const weights = attrXpWeights(act);
      const tags = activityXpTags(act);
      ctx.emit(checkDiscovery, { tags });
      state.activityProgress += activityFillRate(ctx, act, stats);
      const cost = activityCost(act, stats);
      if (state.activityProgress >= cost) {
        state.activityProgress -= cost;
        const xpMult = activityOutputMult(ctx, stats, act);
        ctx.emit(grantAttrXpSplit, { weights, amount: TRAIN_REP_TICKS * stats.trainXp * xpMult });
        ctx.emit(grantSkillXp, { tags, amount: 0.25 * TRAIN_REP_TICKS });
        ctx.emit(cycleDone, { spot: spot.id, activity: act.id, kind: act.kind, tags, baseTicks: TRAIN_REP_TICKS });
        rollActivityDrops(ctx, act);
      }
      break;
    }
    case 'rest':
      break;
    case 'search': {
      state.activityProgress += activityFillRate(ctx, act, stats);
      const cost = activityCost(act, stats);
      if (state.activityProgress >= cost) {
        state.activityProgress -= cost;
        const reward = rollSearch(ctx, spot.id, act);
        if (reward) grantFind(ctx, spot, reward, false);
        else {
          say(ctx, 'search_spent', undefined, 'explore');
          // Spent: stop. The resume entry stays.
          state.activity = null;
          state.activityProgress = 0;
          syncPace(ctx);
          ctx.emit(activityChanged, { spot: spot.id, activity: null, kind: null });
        }
        const tags = activityXpTags(act);
        ctx.emit(checkDiscovery, { tags });
        ctx.emit(grantSkillXp, { tags, amount: 2 });
      }
      break;
    }
    case 'explore': {
      const tags = act.tags ?? [];
      tickExplore(ctx, spot, stats.loot * scopedMult(ctx, 'loot' as StatKey, tags), tags);
      break;
    }
    case 'hunt': {
      if (!spot.encounters?.length) return;
      ctx.emit(checkDiscovery, { tags: ['combat', 'hunt'] });
      ensureHunt(ctx, spot);
      break;
    }
    case 'gather': {
      const tags = activityXpTags(act);
      const ticksPer = act.ticksPer ?? 0;
      ctx.emit(checkDiscovery, { tags });
      state.activityProgress += activityFillRate(ctx, act, stats);
      const cost = activityCost(act, stats);
      if (state.activityProgress >= cost && act.material) {
        state.activityProgress -= cost;
        ctx.emit(grantSkillXp, { tags, amount: 0.25 * ticksPer });
        ctx.emit(grantAttrXpSplit, { weights: attrXpWeights(act), amount: 0.5 * ticksPer * stats.trainXp });
        ctx.emit(cycleDone, { spot: spot.id, activity: act.id, kind: act.kind, tags, baseTicks: ticksPer });
        const amount = integerYield(ctx, activityOutputMult(ctx, stats, act));
        ctx.request(grantMaterial, { id: act.material, qty: amount, luck: stats.loot * scopedMult(ctx, 'loot' as StatKey, tags) });
        ctx.emit(bumpCounter, { key: `gather:${act.material}`, amount });
        const mat = MATERIALS[act.material];
        ctx.emit(
          logLine,
          repeatLine({
            group: `act:${act.id}`,
            prefix: '🧺 Gathered:',
            tally: [{ label: `${mat?.icon ?? '📦'} ${mat?.name ?? act.material}`, qty: amount }],
            kind: 'loot',
          }),
        );
        rollActivityDrops(ctx, act);
      }
      break;
    }
    case 'job': {
      const tags = activityXpTags(act);
      const ticksPer = act.ticksPer ?? 0;
      ctx.emit(checkDiscovery, { tags });
      state.activityProgress += activityFillRate(ctx, act, stats);
      const cost = activityCost(act, stats);
      if (state.activityProgress >= cost) {
        state.activityProgress -= cost;
        ctx.emit(grantSkillXp, { tags, amount: 0.25 * ticksPer });
        ctx.emit(grantAttrXpSplit, { weights: attrXpWeights(act), amount: 0.6 * ticksPer * stats.trainXp });
        ctx.emit(cycleDone, { spot: spot.id, activity: act.id, kind: act.kind, tags, baseTicks: ticksPer });
        const rewardMult = act.outputFactors?.length ? activityOutputMult(ctx, stats, act) : stats.goldGain;
        const pay = Math.max(1, Math.round((act.gold ?? 0) * rewardMult));
        ctx.request(addGold, { amount: pay, earned: true });
        ctx.emit(
          logLine,
          repeatLine({
            group: `act:${act.id}`,
            prefix: '💰 Shift pay:',
            tally: [{ label: 'gold', qty: pay, style: 'amount' }],
            kind: 'action',
          }),
        );
        rollActivityDrops(ctx, act);
      }
      break;
    }
    case 'craft': {
      const kind = craftProvider();
      if (!kind) break;
      if (!kind.tick(ctx, act, stats)) {
        // Starved: stop. The resume entry stays.
        state.activity = null;
        state.activityProgress = 0;
        syncPace(ctx);
        ctx.emit(activityChanged, { spot: spot.id, activity: null, kind: null });
      }
      break;
    }
  }
}
