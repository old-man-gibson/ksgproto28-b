/**
 * The world system: the slice, the commands of the player, the requests of
 * the knockout system and the view of the Location panel. The rules are in
 * `engine.ts`, the registries in `defs.ts`. See README.md in this folder.
 */
import {
  answer,
  defineCommand,
  defineRequest,
  defineSystem,
  handle,
  OK,
  on,
  registry,
  skipped,
  type DeepReadonly,
} from '../../kernel';
import combat, { enemyKilled, inForcedFight, TOLL_GOLEM } from '../combat';
import counters, { conditionsMet, counterValue, setCounter } from '../counters';
import { floorClearedEvent, FLOORS } from '../ladder';
import { textSchema } from '../log';
import { conditionReader } from '../skills';
import { statBlockOf } from '../stats';
import worldTextData from './content/world_text.json';
import {
  areas,
  AREAS,
  craftProvider,
  edgesFrom,
  getSpot,
  keyItems,
  REGIONS,
  regions,
  spotActivities,
  spots,
  SPOTS,
  STARTING_SPOT,
  type Edge,
} from './defs';
import {
  activityCost,
  ARRIVE_IDLE,
  blockingGate,
  cancelTravelPlan,
  canStartActivity,
  climbTo,
  climbToHub,
  craftUnlocked,
  currentActivity,
  dropActivity,
  exploreProgress,
  fastTravelTo,
  goAndDo,
  grantKeyItem,
  hasKeyItem,
  hopEdge,
  journeyEnd,
  placeAt,
  playerCommand,
  recover,
  refreshHunt,
  retreatToSafety,
  revealMapped,
  rideEdges,
  routableStops,
  runWorldTick,
  setJourneyIntent,
  spotCleared,
  startActivity,
  startTravel,
  syncPace,
  towerAt,
  travelPlanTo,
  visibleEdges,
  type Reads,
  type WorldState,
  rideVerdict,
} from './engine';
import { migrations } from './migrations';

export * from './defs';
export * from './engine';

const worldText = registry(textSchema, worldTextData, 'World text');

// ---- commands ----

/** Walk to a spot by the shortest known route. */
export const travelTo = defineCommand<{ to: string }>('world/travel-to');
/** Walk to a spot and start an activity there. Standing there, it starts. */
export const goAndDoCommand = defineCommand<{ spot: string; activity: string }>('world/go-and-do');
/** Pick the work at the spot. `null` stops. */
export const selectActivity = defineCommand<{ activity: string | null }>('world/select-activity');
/** Change what the journey under way is for. `null`: resume on arrival. `''`: stay idle on arrival. */
export const setIntent = defineCommand<{ activity: string | null }>('world/set-intent');
/** Stop at the end of the leg under way. */
export const cancelPlan = defineCommand<void>('world/cancel-plan');
/** Ride the ladder to the landing of a floor. `null` is the hub of the tower. */
export const climb = defineCommand<{ floor: string | null }>('world/climb');
/** Ride the ladder to the hub of a band (band 3's castle). */
export const climbHub = defineCommand<{ band: string }>('world/climb-hub');
/** The caravan: waypoint to waypoint for gold. */
export const fastTravel = defineCommand<{ to: string }>('world/fast-travel');

// ---- requests (the knockout system) ----

/** Start or stop an activity without ending a knockout return. False when refused. */
export const startActivityNow = defineRequest<{ activity: string | null }, boolean>('world/start-activity');
/** Go to a spot and do an activity, as a step of a system inside a tick. False when no journey began and nothing started. */
export const goNow = defineRequest<{ spot: string; activity: string }, boolean>('world/go');
/** Ride the ladder to a floor, as a step of a system inside a tick. */
export const rideNow = defineRequest<{ floor: string | null }, boolean>('world/ride');
/** Throw the character to the haven. `knockedOut` starts the recovery. Answers the spot left. */
export const retreat = defineRequest<{ reason: string; knockedOut: boolean }, string>('world/retreat');
/**
 * "Stay here": drop the legs still planned and make the leg under way start
 * nothing on arrival. Answers the name of the spot that leg ends at, or null
 * when the character stands.
 */
export const stayOnLeg = defineRequest<void, string | null>('world/stay');
/** End the recovery. */
export const recoverNow = defineRequest<void, void>('world/recover');
/**
 * One hop: a visible road, else a ride. The old `startTravel`, which the old
 * `Game.travelTo` called. No panel sends it; the ported tests do. Does not end
 * a knockout return.
 */
export const travelHop = defineRequest<{ to: string }, boolean>('world/travel');

/**
 * Stand the player at a spot with no road walked (`placeAt` in engine.ts):
 * the skip of floor 0, and with `newRun` the start of a run after a
 * prestige. False for an unknown spot. Does not end a knockout return.
 */
export const placeNow = defineRequest<{ spot: string; newRun?: boolean }, boolean>('world/place');

/**
 * Clear the activity and nothing else (`dropActivity` in engine.ts): the
 * start of a bench run. Step 3 (benches).
 */
export const dropActivityNow = defineRequest<void, void>('world/drop-activity');

// ---- view ----

export interface ActivityView {
  id: string;
  name: string;
  icon: string;
  kind: string;
  /** Null when it can start now. */
  blocked: string | null;
  /** craft: the recipe is locked. */
  locked: boolean;
  /** craft: the cost line when unlocked, the requirement when locked. Null for other kinds. */
  detail: string | null;
}

export interface MapSpotView {
  id: string;
  /** "Unknown place" for a spot not discovered. */
  name: string;
  icon: string;
  known: boolean;
  here: boolean;
  /** Base ticks of the route from here, or null with no route. */
  ticks: number | null;
  legs: number;
  /** Arriving starts a fight that cannot be fled. */
  forced: boolean;
  cleared: boolean;
  desc: string;
  activities: ActivityView[];
  /** The activity resumed on arrival, or null. */
  resumes: string | null;
}

/**
 * A visible road from a discovered spot of the current region into another
 * region: the only way off a region by road. One entry per road, as the old
 * map drew one label per road (`mapPlan.ts` exitList). A one-way road shows
 * only from its source end.
 */
export interface MapExitView {
  /** The spot the road leaves from. */
  from: string;
  fromName: string;
  /** The spot the road arrives at, in the other region. */
  to: string;
  /** The name of the region the road leads into. */
  region: string;
}

export interface WorldView {
  spot: { id: string; name: string; icon: string; desc: string; area: string; region: string };
  recovering: boolean;
  travel: { to: string; toName: string; endName: string; legsLeft: number; progress: number; secondsLeft: number; intent: string | null } | null;
  activity: { id: string; name: string; kind: string; progress: number } | null;
  activities: ActivityView[];
  explore: { progress: number; gate: string | null } | null;
  inForcedFight: boolean;
  /** The areas of the region the character is in, with every spot the map shows. */
  map: { region: string; areas: { id: string; name: string; spots: MapSpotView[] }[]; exits: MapExitView[] };
  /** The ladder rides open from here, by landing spot. */
  rides: { to: string; ticks: number; label: string }[];
  /** The tower whose ladder answers where the character stands, or null. */
  tower: string | null;
  /**
   * A registered rule's verdict on a ride from here, by floor id (`''`: the
   * tower's hub): `forfeit` (the ride ends a festival attempt), `refuse`
   * with its line, `enter`. A floor with no verdict is absent.
   */
  rideVerdicts: Record<string, { kind: 'forfeit' | 'refuse' | 'enter'; msg: string }>;
  discoveredCount: number;
}

/** The registered rule's verdicts on the rides from where the character stands (old `ladderView` `rideAction`). */
function rideVerdictsOf(ctx: Reads): WorldView['rideVerdicts'] {
  const out: WorldView['rideVerdicts'] = {};
  for (const floorId of [null, ...Object.keys(FLOORS)]) {
    const v = rideVerdict(ctx, floorId);
    if (!v) continue;
    out[floorId ?? ''] = { kind: v.kind, msg: v.kind === 'refuse' ? v.msg : v.kind === 'forfeit' ? v.reason : '' };
  }
  return out;
}

const UNKNOWN = 'Unknown place';
const UNKNOWN_PLACE = 'an undiscovered place';

/** Distances from one spot to every spot a journey could end at, with the rule of `findPath`. */
function reach(ctx: Reads, state: DeepReadonly<WorldState>, from: string): Map<string, { ticks: number; legs: number }> {
  const r = conditionReader(ctx);
  const known = new Set(state.discovered);
  // `through`: reached with no forced last step, so the route may go on.
  const through = new Map<string, { ticks: number; legs: number }>([[from, { ticks: 0, legs: 0 }]]);
  const final = new Map<string, { ticks: number; legs: number }>();
  const queue = new Set<string>([from]);
  const stops = routableStops(ctx, state);
  while (queue.size > 0) {
    let current = '';
    let best = Infinity;
    for (const id of queue) {
      const d = through.get(id)!.ticks;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    queue.delete(current);
    const at = through.get(current)!;
    const roads = visibleEdges(ctx, state, current);
    const edges: Edge[] = [...roads, ...rideEdges(ctx, state, current, stops).filter((ride) => !roads.some((e) => e.to === ride.to))];
    for (const edge of edges) {
      if (edge.requires && !conditionsMet(r, edge.requires)) continue;
      const next = { ticks: at.ticks + edge.ticks, legs: at.legs + 1 };
      const dest = SPOTS[edge.to];
      const ends = !known.has(edge.to) || ((edge.forced || dest?.forced) && !(dest && spotCleared(ctx, dest)));
      if (next.ticks < (final.get(edge.to)?.ticks ?? Infinity)) final.set(edge.to, next);
      if (!ends && next.ticks < (through.get(edge.to)?.ticks ?? Infinity)) {
        through.set(edge.to, next);
        queue.add(edge.to);
      }
    }
  }
  return final;
}

/**
 * The activities a panel lists. A secret recipe not yet unlocked is left
 * out (old `recipeHidden`). A craft is blocked only while locked: the old
 * panel let an unaffordable craft start, and its first tick stops it.
 */
function activityViews(ctx: Reads, spotId: string): ActivityView[] {
  const kind = craftProvider();
  const out: ActivityView[] = [];
  for (const a of spotActivities(getSpot(spotId))) {
    if (a.kind === 'craft') {
      if (!kind || !a.recipe || kind.hidden(ctx, a.recipe)) continue;
      const locked = !kind.unlocked(ctx, a.recipe);
      const detail = kind.detail(ctx, a.recipe);
      out.push({ id: a.id, name: a.name, icon: locked ? '🔒' : a.icon, kind: a.kind, blocked: locked ? detail : null, locked, detail });
      continue;
    }
    out.push({
      id: a.id,
      name: a.name,
      icon: a.icon,
      kind: a.kind,
      blocked: canStartActivity(ctx, spotId, a.id) ? null : 'Nothing left to find.',
      locked: false,
      detail: null,
    });
  }
  return out;
}

// ---- the declaration ----

const world = defineSystem<WorldState, WorldView>({
  id: 'world',
  version: 1,
  migrations,
  // After `resources`, `statuses` and `knockout`, before `combat`: the old
  // loop ran the pools, the conditions, the return step and then the activity.
  order: 5,
  initial: () => ({
    spot: STARTING_SPOT,
    discovered: [STARTING_SPOT],
    travel: null,
    travelPlan: [],
    travelIntent: null,
    activity: null,
    activityProgress: 0,
    resumeActivity: {},
    explored: {},
    finds: {},
    // Nothing recorded yet, as in the old initial state: `retreatSpot` falls to the start.
    safeSpots: { nearest: null, unconditional: null },
    recovering: false,
  }),
  content: { regions, areas, spots, key_items: keyItems, world_text: worldText },

  tick: runWorldTick,

  commands: [
    handle(travelTo, (ctx, { to }) => {
      if (!SPOTS[to]) return skipped(`no spot has the id "${to}"`);
      if (ctx.state.travel) return skipped('a journey is under way');
      if (ctx.state.recovering) return skipped('the character is knocked out');
      if (to === ctx.state.spot) return skipped('the character stands there');
      // The hop logs the refusal of a forced fight, as the old `startTravel` did.
      if (!travelPlanTo(ctx, to)) return skipped(inForcedFight(ctx.read(combat)) ? 'the fight cannot be left' : `no known route leads to "${to}"`);
      ctx.emit(playerCommand, { type: travelTo.type });
      return OK;
    }),
    handle(goAndDoCommand, (ctx, { spot, activity }) => {
      const def = SPOTS[spot];
      if (!def) return skipped(`no spot has the id "${spot}"`);
      if (!spotActivities(def).some((a) => a.id === activity)) return skipped(`"${spot}" has no activity "${activity}"`);
      // Standing at the spot it is a pick, which the old `goAndDo` took during
      // the recovery as `selectActivity` did. A journey does not start then.
      if (!goAndDo(ctx, spot, activity)) {
        if (inForcedFight(ctx.read(combat))) return skipped('the fight cannot be left');
        if (spot === ctx.state.spot && !ctx.state.travel) return skipped(`"${activity}" has nothing left to pay`);
        if (ctx.state.recovering) return skipped('the character is knocked out');
        return skipped(ctx.state.travel ? 'a journey is under way' : `no known route leads to "${spot}"`);
      }
      ctx.emit(playerCommand, { type: goAndDoCommand.type });
      return OK;
    }),
    handle(selectActivity, (ctx, { activity }) => {
      const state = ctx.state;
      if (state.travel) return skipped('a journey is under way');
      // Not refused while knocked out: the old `selectActivity` took a pick during the
      // recovery, and the pick ends a knockout return (old knockoutReturn test, "rest-while-recovering").
      const picked = activity === null ? undefined : spotActivities(getSpot(state.spot)).find((a) => a.id === activity);
      if (activity !== null) {
        if (!picked) return skipped(`this spot has no activity "${activity}"`);
        // A craft is refused only while locked (in `startActivity`, which logs it): the old
        // `selectActivity` started an unaffordable craft, and its first tick stops it.
        if (picked.kind !== 'craft' && !canStartActivity(ctx, state.spot, activity)) return skipped(`"${activity}" has nothing left to pay`);
      }
      if (!startActivity(ctx, activity)) {
        if (inForcedFight(ctx.read(combat))) return skipped('the fight cannot be left');
        if (picked?.kind === 'craft' && !craftUnlocked(ctx, picked)) return skipped(`the recipe "${picked.recipe}" is locked`);
        return skipped('the activity was refused');
      }
      ctx.emit(playerCommand, { type: selectActivity.type });
      return OK;
    }),
    handle(setIntent, (ctx, { activity }) => {
      if (!journeyEnd(ctx.state)) return skipped('no journey is under way');
      if (!setJourneyIntent(ctx.state, activity)) return skipped(`the end of the journey has no activity "${activity}"`);
      ctx.emit(playerCommand, { type: setIntent.type });
      return OK;
    }),
    handle(cancelPlan, (ctx) => {
      if (!cancelTravelPlan(ctx)) return skipped('no further leg is planned');
      ctx.emit(playerCommand, { type: cancelPlan.type });
      return OK;
    }),
    handle(climb, (ctx, { floor }) => {
      if (ctx.state.travel) return skipped('a journey is under way');
      if (ctx.state.recovering) return skipped('the character is knocked out');
      if (!climbTo(ctx, floor)) {
        if (inForcedFight(ctx.read(combat))) return skipped('the fight cannot be left');
        return skipped(floor === null ? 'no ladder answers here' : `the ladder does not go to "${floor}" from here now`);
      }
      ctx.emit(playerCommand, { type: climb.type });
      return OK;
    }),
    handle(climbHub, (ctx, { band }) => {
      if (ctx.state.travel) return skipped('a journey is under way');
      if (ctx.state.recovering) return skipped('the character is knocked out');
      if (!climbToHub(ctx, band)) {
        if (inForcedFight(ctx.read(combat))) return skipped('the fight cannot be left');
        return skipped(`the ladder does not go to the hub of "${band}" from here now`);
      }
      ctx.emit(playerCommand, { type: climbHub.type });
      return OK;
    }),
    handle(fastTravel, (ctx, { to }) => {
      if (!SPOTS[to]) return skipped(`no spot has the id "${to}"`);
      const refused = fastTravelTo(ctx, to);
      if (refused) return skipped(refused);
      ctx.emit(playerCommand, { type: fastTravel.type });
      return OK;
    }),
  ],

  requests: [
    answer(startActivityNow, (ctx, { activity }) => {
      if (activity !== null && !canStartActivity(ctx, ctx.state.spot, activity)) return false;
      return startActivity(ctx, activity);
    }),
    answer(goNow, (ctx, { spot, activity }) => goAndDo(ctx, spot, activity, { fresh: true })),
    answer(rideNow, (ctx, { floor }) => climbTo(ctx, floor, { fresh: true })),
    answer(retreat, (ctx, { reason, knockedOut }) => retreatToSafety(ctx, reason, knockedOut)),
    answer(recoverNow, (ctx) => recover(ctx)),
    answer(travelHop, (ctx, { to }) => (SPOTS[to] ? startTravel(ctx, to) : false)),
    answer(placeNow, (ctx, { spot, newRun = false }) => placeAt(ctx, spot, newRun)),
    answer(dropActivityNow, (ctx) => dropActivity(ctx)),
    answer(stayOnLeg, (ctx) => {
      const state = ctx.state;
      cancelTravelPlan(ctx);
      const leg = state.travel;
      state.travelIntent = leg ? { spot: leg.to, activity: ARRIVE_IDLE } : null;
      if (!leg) return null;
      return state.discovered.includes(leg.to) ? getSpot(leg.to).name : UNKNOWN_PLACE;
    }),
  ],

  events: [
    // A band step may have moved the levels of the site hunted at.
    on(floorClearedEvent, (ctx) => refreshHunt(ctx)),
    // The reward of the toll collector. The old `rewardTollGolem`.
    on(enemyKilled, (ctx, { payload }) => {
      if (payload.defId !== TOLL_GOLEM) return;
      if (!hasKeyItem(ctx, 'toll_stamp')) grantKeyItem(ctx, 'toll_stamp');
      if (counterValue(ctx.read(counters), 'flag:toll_encounter_spell') < 1) ctx.emit(setCounter, { key: 'flag:toll_brute_force', value: 1 });
    }),
  ],

  view: (ctx) => {
    const state = ctx.state;
    const here = getSpot(state.spot);
    const area = AREAS[here.areaId];
    const region = REGIONS[area.regionId];
    const stats = statBlockOf(ctx);
    const act = currentActivity(state);
    const cost = act ? activityCost(act, stats) : 0;
    const known = new Set(state.discovered);
    const routes = state.travel || state.recovering ? new Map<string, { ticks: number; legs: number }>() : reach(ctx, state, state.spot);

    // The map shows discovered spots, and unknown places one visible road past known ground.
    // A visible road into another region is an exit, not a spot of this map.
    // The old `buildPlan` exitList: from known spots only, every visible road,
    // shut or not; the travel command reports a shut road.
    const shown = new Set<string>();
    const exits: MapExitView[] = [];
    for (const id of state.discovered) {
      if (AREAS[SPOTS[id]?.areaId]?.regionId !== region.id) continue;
      shown.add(id);
      for (const edge of visibleEdges(ctx, state, id)) {
        const to = REGIONS[AREAS[SPOTS[edge.to].areaId].regionId];
        if (to.id === region.id) shown.add(edge.to);
        else exits.push({ from: id, fromName: SPOTS[id].name, to: edge.to, region: to.name });
      }
    }
    const spotView = (id: string): MapSpotView => {
      const spot = SPOTS[id];
      const isKnown = known.has(id);
      const route = routes.get(id);
      return {
        id,
        name: isKnown ? spot.name : UNKNOWN,
        icon: isKnown ? spot.icon : '❓',
        known: isKnown,
        here: id === state.spot && !state.travel,
        ticks: id === state.spot ? 0 : (route?.ticks ?? null),
        legs: route?.legs ?? 0,
        forced: isKnown && (!!spot.forced || edgesFrom(state.spot).some((e) => e.to === id && e.forced)) && !spotCleared(ctx, spot),
        cleared: isKnown && spotCleared(ctx, spot),
        desc: isKnown ? spot.desc : '',
        activities: isKnown ? activityViews(ctx, id) : [],
        resumes: isKnown ? (state.resumeActivity[id] ?? null) : null,
      };
    };
    const end = journeyEnd(state);
    const travelTicksLeft = state.travel
      ? state.travel.ticksLeft +
        state.travelPlan.reduce(
          (sum, hop, i) => sum + (hopEdge(ctx, state, i === 0 ? state.travel!.to : state.travelPlan[i - 1], hop)?.ticks ?? 0) / stats.travelSpeed,
          0,
        )
      : 0;

    return {
      spot: { id: here.id, name: here.name, icon: here.icon, desc: here.desc, area: area.name, region: region.name },
      recovering: state.recovering,
      travel: state.travel
        ? {
            to: state.travel.to,
            toName: known.has(state.travel.to) ? getSpot(state.travel.to).name : UNKNOWN,
            endName: end && known.has(end) ? getSpot(end).name : UNKNOWN,
            legsLeft: state.travelPlan.length + 1,
            progress: 1 - state.travel.ticksLeft / state.travel.total,
            secondsLeft: Math.ceil(travelTicksLeft / 10),
            intent: state.travelIntent?.activity ?? null,
          }
        : null,
      activity: act ? { id: act.id, name: act.name, kind: act.kind, progress: cost > 0 ? Math.min(1, state.activityProgress / cost) : 0 } : null,
      activities: state.travel ? [] : activityViews(ctx, state.spot),
      explore: here.exploreTicks
        ? { progress: exploreProgress(state, here), gate: blockingGate(ctx, state, here)?.desc ?? (blockingGate(ctx, state, here) ? 'Requirement not met.' : null) }
        : null,
      inForcedFight: inForcedFight(ctx.read(combat)),
      rideVerdicts: rideVerdictsOf(ctx),
      map: {
        region: region.name,
        areas: Object.values(AREAS)
          .filter((a) => a.regionId === region.id)
          .map((a) => ({
            id: a.id,
            name: a.name,
            spots: Object.values(SPOTS)
              .filter((sp) => sp.areaId === a.id && shown.has(sp.id))
              .map((sp) => spotView(sp.id)),
          }))
          .filter((a) => a.spots.length > 0),
        exits,
      },
      rides: state.travel ? [] : rideEdges(ctx, state, state.spot).map((e) => ({ to: e.to, ticks: e.ticks, label: e.label ?? '' })),
      tower: state.travel ? null : (towerAt(state.spot)?.id ?? null),
      discoveredCount: state.discovered.length,
    };
  },
});

export default world;

export { revealMapped, syncPace };
