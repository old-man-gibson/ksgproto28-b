/**
 * Port of the old `tests/knockoutReturn.test.ts`: after a knockout the
 * character recovers to 95%, walks back and resumes, or falls back, or holds.
 * The cases keep their old names.
 *
 * A pocket world is added to the spot registry for the duration:
 *
 *   kr_camp (haven) - kr_gate - kr_field    (hunt)
 *                           |- kr_meadow   (hunt, the usual fallback)
 *                           |- kr_hopeless (hunt, a level 30 golem)
 *                           |- kr_ring     (hunt, one fight in its budget)
 *                           |- kr_lane     (hunt, three fights in its budget)
 *                           |- kr_yard     (drill, a training activity)
 *                           |- kr_den      (FORCED spot, hunt) - kr_behind (hunt)
 *                           |- kr_pit      (hunt, reached by a FORCED road)
 *                           '- kr_roadstead (hunt, one fight, reached by a FORCED road)
 *
 * Call shape changes:
 * - `fallAt` set the state and called `captureFall`, `retreatToSafety` and
 *   `noteKnockout`. Here it sets the world slice and emits `combat/defeat`,
 *   which the knockout system hears as it hears a lost fight.
 * - `win` emitted `fight:won`. Here it emits `combat/fight-won`.
 * - `recovered` wrote `recovering = false`. Here it makes the request
 *   `world/recover`.
 * - `state.totalTicks`, `state.stats[key]`, `state.proven` and
 *   `state.pendingReturn` are written through a save and a load (`patch`) or
 *   by the counter event.
 * - A function the old test called with the state (`returnBlock`,
 *   `returnRecoverTarget`) is called with a context over the knockout slice.
 * - The old tests cleared an open fight by writing `state.combat = null`.
 *   Here the fight is abandoned by the request `combat/abandon`.
 *
 * Content that is not in this repository:
 * - floor 17 (the roofed fallback cases): the same structure stands on floor
 *   6. The Shrine is the open hunt, the Tunnels the roofed hunt, the Warren
 *   Mouth the haven. Test spots on floor 6 give the ties and the fight budget
 *   floor 6 does not have.
 * - floor 10 (the Row and the Mine): the Tunnels and the Drop of floor 6.
 * - the harbor waters and the roadstead: `kr_pit` and `kr_roadstead`.
 * - the Door of floor 19: a test spot with a boss line behind a forced road.
 * - the festival, performances and prestige are `it.todo`. The bench run
 *   case runs since the alchemy port (step 3).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineSystem, PLAYER, TPS, type Ctx, type DeepReadonly, type Kernel } from '../src/kernel';
import { startBench } from '../src/systems/benches';
import type { ClockState } from '../src/systems/clock';
import combat, { abandon, fightWon, playerDefeated, setHuntRest, startForced, type CombatState } from '../src/systems/combat';
import { setCounter, type CountersState } from '../src/systems/counters';
import type { GoldState } from '../src/systems/gold';
import { FLOORS, floorUnlocked, ladderReader } from '../src/systems/ladder';
import type { LogState } from '../src/systems/log';
import knockout, {
  FALLBACK_TICKS,
  FALLBACK_WINS,
  HOLD_MINUTES,
  NEVER_TARGET_SPOTS,
  PROVEN_STREAK,
  STREAK_LIMIT,
  defeatDialogDue,
  holdTicks,
  knockoutStreak,
  returnBlock,
  returnRecoverTarget,
  type KnockoutState,
  type PendingReturn,
  type ReturnSpot,
} from '../src/systems/knockout';
import { availableMax, poolHooks, type ResourcesState } from '../src/systems/resources';
import { statBlockOf } from '../src/systems/stats';
import { applyStatus, STATUSES, type StatusDef, type StatusesState } from '../src/systems/statuses';
import world, {
  ADJACENCY,
  AREAS,
  SPOTS,
  buildAdjacency,
  cancelPlan,
  climb,
  fastTravel,
  goAndDoCommand,
  recoverNow,
  selectActivity,
  setIntent,
  travelTo,
  type Edge,
  type SpotDef,
  type WorldState,
} from '../src/systems/world';
import { ask, emit, makeKernel, patch, probe, reads, run } from './helpers';

// ---- the pocket world ----

const hunt = { id: 'hunt', kind: 'hunt' as const, name: 'Hunt', icon: '🏹' };
const rats = (): SpotDef['encounters'] => [{ monsterId: 'forest_rat', weight: 100, level: [1, 1] }];
const golem = (): SpotDef['encounters'] => [{ monsterId: 'stone_golem', weight: 100, level: [30, 30] }];

function pocket(id: string, name: string, extra: Partial<SpotDef>): SpotDef {
  return { id, name, icon: '📍', areaId: 'kr_area', desc: '', activities: [], connections: [], ...extra };
}

const KR: Record<string, SpotDef> = {
  kr_camp: pocket('kr_camp', 'Test Camp', {
    waypoint: true,
    activities: [{ id: 'rest', kind: 'rest', name: 'Camp', icon: '🏕️' }],
    connections: [{ to: 'kr_gate', ticks: 5 }],
  }),
  kr_gate: pocket('kr_gate', 'Test Gate', {
    connections: [
      { to: 'kr_field', ticks: 5 },
      { to: 'kr_meadow', ticks: 5 },
      { to: 'kr_hopeless', ticks: 5 },
      { to: 'kr_ring', ticks: 5 },
      { to: 'kr_lane', ticks: 5 },
      { to: 'kr_yard', ticks: 5 },
      { to: 'kr_den', ticks: 5 },
      { to: 'kr_pit', ticks: 5, forced: true },
      { to: 'kr_roadstead', ticks: 5, forced: true },
    ],
  }),
  kr_field: pocket('kr_field', 'Test Field', { activities: [hunt], encounters: rats() }),
  kr_meadow: pocket('kr_meadow', 'Test Meadow', { waypoint: true, activities: [hunt], encounters: rats() }),
  kr_hopeless: pocket('kr_hopeless', 'Test Pit of Golems', { activities: [hunt], encounters: golem() }),
  kr_ring: pocket('kr_ring', 'Test Ring', { fightLimit: 1, activities: [hunt], encounters: rats() }),
  kr_lane: pocket('kr_lane', 'Test Lane', { fightLimit: 3, activities: [hunt], encounters: rats() }),
  kr_yard: pocket('kr_yard', 'Test Yard', {
    activities: [{ id: 'drill', kind: 'train', attr: 'str', name: 'Drill', icon: '🏋️' }],
  }),
  kr_den: pocket('kr_den', 'Test Den', {
    forced: true,
    activities: [hunt],
    encounters: rats(),
    connections: [{ to: 'kr_behind', ticks: 5 }],
  }),
  kr_behind: pocket('kr_behind', 'Test Behind', { activities: [hunt], encounters: rats() }),
  kr_pit: pocket('kr_pit', 'Test Pit', { activities: [hunt], encounters: rats() }),
  kr_roadstead: pocket('kr_roadstead', 'Test Roadstead', { fightLimit: 1, activities: [hunt], encounters: rats() }),
};

/**
 * Test spots on real floors, each with one road from a real spot. `forced`
 * is on the road in and never on the road back, as the registry mirrors.
 */
const SPLICED: { spot: SpotDef; from: string; forced?: boolean }[] = [
  // A hunt spot on floor 3, next to its landing, to fall at with a target.
  { spot: pocket('kr_f3', 'Test Landing Three', { areaId: 'ascent_f3_area', activities: [hunt], encounters: rats() }), from: 'f3_stairhead' },
  // Roofed hunts on floor 6: one level above the other two, and one with a fight budget.
  {
    spot: pocket('kr_f6_vault', 'Test Vault', {
      areaId: 'ascent_f6_area',
      tags: ['indoor'],
      activities: [hunt],
      encounters: [{ monsterId: 'forest_rat', weight: 100, level: [11, 12] }],
    }),
    from: 'f6_warren_mouth',
  },
  {
    spot: pocket('kr_f6_cellar', 'Test Cellar', {
      areaId: 'ascent_f6_area',
      tags: ['indoor'],
      activities: [hunt],
      encounters: [{ monsterId: 'forest_rat', weight: 100, level: [10, 11] }],
    }),
    from: 'f6_warren_mouth',
  },
  {
    spot: pocket('kr_f6_nest', 'Test Nest', {
      areaId: 'ascent_f6_area',
      tags: ['indoor'],
      fightLimit: 1,
      activities: [hunt],
      encounters: [{ monsterId: 'forest_rat', weight: 100, level: [10, 10] }],
    }),
    from: 'f6_warren_mouth',
  },
  // A boss line behind a forced road out of the Tunnels: the Door of the old floor 19.
  {
    spot: pocket('kr_f6_door', 'Test Door', {
      areaId: 'ascent_f6_area',
      activities: [hunt],
      encounters: [{ monsterId: 'forest_rat', weight: 1, boss: true, level: [1, 1] }],
    }),
    from: 'f6_tunnels',
    forced: true,
  },
];

beforeAll(() => {
  AREAS['kr_area'] = { id: 'kr_area', name: 'Return Test', regionId: 'the_ascent' };
  Object.assign(SPOTS, KR);
  // Mirrors every road and leaves `forced` off the way back, as the real build does.
  for (const [id, edges] of buildAdjacency(Object.values(KR))) ADJACENCY.set(id, edges);
  for (const { spot, from, forced } of SPLICED) {
    SPOTS[spot.id] = spot;
    ADJACENCY.get(from)!.push({ from, to: spot.id, ticks: 5, ...(forced ? { forced: true } : {}) });
    ADJACENCY.set(spot.id, [{ from: spot.id, to: from, ticks: 5 }]);
  }
});

afterAll(() => {
  for (const id of Object.keys(KR)) {
    delete SPOTS[id];
    ADJACENCY.delete(id);
  }
  for (const { spot, from } of SPLICED) {
    delete SPOTS[spot.id];
    ADJACENCY.delete(spot.id);
    ADJACENCY.set(
      from,
      ADJACENCY.get(from)!.filter((e) => e.to !== spot.id),
    );
  }
  delete AREAS['kr_area'];
});

// ---- the watcher: a test-only system ----

type Watch = (w: DeepReadonly<WorldState>, c: DeepReadonly<CombatState>, k: DeepReadonly<KnockoutState>) => void;
let onTick: Watch | null = null;

/**
 * Runs last in every tick and hands the three slices to the test that set
 * `onTick`. The 8 hour cases read the state after every tick; a snapshot per
 * tick would copy the whole state 288,000 times.
 */
const watcher = defineSystem<Record<string, never>>({
  id: 'watcher',
  version: 1,
  initial: () => ({}),
  order: 1000,
  tick: (ctx) => onTick?.(ctx.read(world), ctx.read(combat), ctx.read(knockout)),
});

// ---- reads ----

interface Slices {
  world: WorldState;
  knockout: KnockoutState;
  combat: CombatState;
  clock: ClockState;
  counters: CountersState;
  resources: ResourcesState;
  statuses: StatusesState;
  gold: GoldState;
  log: LogState;
}

const st = (g: Kernel): Slices => g.snapshot().slices as unknown as Slices;
const w = (g: Kernel): WorldState => st(g).world;
const ko = (g: Kernel): KnockoutState => st(g).knockout;
const fight = (g: Kernel): CombatState['fight'] => st(g).combat.fight;
const pending = (g: Kernel): PendingReturn => ko(g).pendingReturn!;
const totalTicks = (g: Kernel): number => st(g).clock.totalTicks;
const counter = (g: Kernel, key: string): number | undefined => st(g).counters.counts[key];
const streakAt = (g: Kernel, spot: string): number => knockoutStreak(reads(g), spot);
const maxHp = (g: Kernel): number => availableMax(statBlockOf(reads(g)), poolHooks(reads(g)), 'hp');
/** HP as a share of the usable maximum. The old `hpFraction`. */
const hpFraction = (g: Kernel): number => st(g).resources.values.hp / maxHp(g);

const lines = (g: Kernel): string[] => st(g).log.log.map((l) => l.msg);
const koLines = (g: Kernel): string[] =>
  lines(g).filter((m) => /^(Returning to|Retrying|\d+ knockouts|No safer|.+: .+\. (Hunting|No safer))/.test(m));

/** Tick until `done` holds, at most `max` ticks. The old `for (i < max && !done) g.tick()`. */
function tickUntil(g: Kernel, max: number, done: (s: Slices) => boolean): void {
  for (let i = 0; i < max && !done(st(g)); i++) g.tick();
}

const at =
  (spot: string, activity: string) =>
  (s: Slices): boolean =>
    s.world.spot === spot && s.world.activity === activity;

/** Call a function of the knockout system that reads its slice, with a context over that slice. */
function asKnockout<T>(g: Kernel, fn: (ctx: Ctx<KnockoutState>) => T): T {
  return run(g, (ctx) => {
    const k = Object.create(ctx) as Ctx<KnockoutState>;
    Object.defineProperty(k, 'state', { value: ctx.read(knockout) });
    return fn(k);
  });
}

const blockOf = (g: Kernel, goal: ReturnSpot, viaRoad = false) => asKnockout(g, (ctx) => returnBlock(ctx, goal, viaRoad));
const recoverTarget = (g: Kernel) => asKnockout(g, (ctx) => returnRecoverTarget(ctx));

// ---- set-up ----

function game(seed: number): Kernel {
  return makeKernel([probe, watcher], { seed });
}

function patchWorld(g: Kernel, change: (world: WorldState) => void): void {
  patch(g, (s) => change(s.world as WorldState));
}

function patchKnockout(g: Kernel, change: (state: KnockoutState) => void): void {
  patch(g, (s) => change(s.knockout as KnockoutState));
}

const setPending = (g: Kernel, p: PendingReturn | null) => patchKnockout(g, (k) => (k.pendingReturn = p));
const setProven = (g: Kernel, proven: ReturnSpot | null) => patchKnockout(g, (k) => (k.proven = proven));
const setTotalTicks = (g: Kernel, ticks: number) => patch(g, (s) => ((s.clock as ClockState).totalTicks = ticks));
const setStat = (g: Kernel, key: string, value: number) => emit(g, setCounter, { key, value });
const setRespawn = (g: Kernel, ticks: number) => patch(g, (s) => ((s.combat as CombatState).respawnTimer = ticks));
const setHp = (g: Kernel, hp: number) => patch(g, (s) => ((s.resources as ResourcesState).values.hp = hp));
const discover = (g: Kernel, ...spots: string[]) => patchWorld(g, (x) => void x.discovered.push(...spots.filter((id) => !x.discovered.includes(id))));
const setHaven = (g: Kernel, spot: string) => patchWorld(g, (x) => (x.safeSpots = { nearest: spot, unconditional: spot }));
const select = (g: Kernel, activity: string | null) => g.dispatch(selectActivity({ activity }));

/** A game standing at `spot`, the whole pocket world known, with a haven at the camp. */
function pocketGame(seed: number, spot = 'kr_field'): Kernel {
  const g = game(seed);
  patchWorld(g, (x) => {
    x.spot = spot;
    x.discovered.push(...Object.keys(KR));
    x.safeSpots = { nearest: 'kr_camp', unconditional: 'kr_camp' };
  });
  return g;
}

/** A game standing at a real spot. */
function gameAt(seed: number, spot: string): Kernel {
  const g = game(seed);
  patchWorld(g, (x) => {
    x.spot = spot;
    if (!x.discovered.includes(spot)) x.discovered.push(spot);
  });
  return g;
}

/** Set the counters each floor's `clear` reads, as if the player had cleared it. The old `clearFloors`. */
function clearFloors(g: Kernel, floorIds: string[]): void {
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) {
      if (c.type === 'stat') setStat(g, c.key, Math.max(counter(g, c.key) ?? 0, c.value));
    }
  }
}

const unlocked = (g: Kernel, floor: string): boolean => floorUnlocked(ladderReader(reads(g)), FLOORS[floor]);

/** Close an open fight with no outcome. The old `state.combat = null`. */
function dropFight(g: Kernel): void {
  if (fight(g)) ask(g, abandon, undefined);
}

/**
 * One knockout at `spot` doing `activity`: the world slice is set to the
 * moment of the fall and `combat/defeat` is emitted. The knockout system
 * leaves 1 HP, retreats and records, as for a lost fight.
 */
function fallAt(g: Kernel, spot: string, activity: string | null = 'hunt', forced = false): void {
  dropFight(g);
  patchWorld(g, (x) => {
    x.spot = spot;
    x.activity = activity;
    x.travel = null;
    x.travelPlan = [];
    x.travelIntent = null;
  });
  emit(g, playerDefeated, { monster: null, forced, outcome: 'knocked_out', cause: '', site: spot, byCondition: false });
}

/** Up and healthy at the haven, as if the recovery had run. */
function recovered(g: Kernel): void {
  setHp(g, maxHp(g));
  ask(g, recoverNow, undefined);
}

/** A won hunt at `spot`. */
function win(g: Kernel, spot: string, forced = false): void {
  const x = w(g);
  if (x.spot !== spot || x.activity !== 'hunt') {
    patchWorld(g, (y) => {
      y.spot = spot;
      y.activity = 'hunt';
    });
  }
  emit(g, fightWon, { site: spot, forced });
}

/**
 * A tick where the world is not moving though it should be: a fight open on
 * the road, a fight open with no work selected (nothing ticks it), or a return
 * pending outside its hold with nothing running, walking or recovering.
 */
function stalled(x: DeepReadonly<WorldState>, c: DeepReadonly<CombatState>, k: DeepReadonly<KnockoutState>): boolean {
  if (c.fight && x.travel) return true;
  if (c.fight && !x.activity && !c.fight.forced) return true;
  const p = k.pendingReturn;
  return !!p && p.phase !== 'hold' && !x.activity && !x.travel && !c.fight && !x.recovering;
}

describe('a fall: haven, 95%, walk, hunting', () => {
  it('a real lost fight at a hunt spot is followed by the walk back', () => {
    const g = pocketGame(3, 'kr_hopeless');
    select(g, 'hunt');
    tickUntil(g, 4000, (s) => s.world.recovering);

    // The retreat stays: the character wakes at the haven, out cold.
    expect(w(g).recovering).toBe(true);
    expect(w(g).spot).toBe('kr_camp');
    expect(w(g).activity).toBeNull();
    expect(pending(g)).toMatchObject({
      phase: 'return',
      target: { spot: 'kr_hopeless', activity: 'hunt' },
    });
    expect(streakAt(g, 'kr_hopeless')).toBe(1);
    expect(lines(g)).toContain('Returning to Test Pit of Golems.');
    // The ledger is still written; only the window waits for nothing to follow.
    expect(st(g).combat.lastFight?.outcome).toBe('knocked_out');
    expect(defeatDialogDue(ko(g))).toBe(false);

    // Recovery runs to 95%, not the old 60%.
    tickUntil(g, 4000, (s) => !s.world.recovering);
    expect(w(g).recovering).toBe(false);
    expect(hpFraction(g)).toBeGreaterThanOrEqual(0.94);

    // Then the walk, the arrival, and the work: with nothing to clear it on the way.
    tickUntil(g, 400, at('kr_hopeless', 'hunt'));
    expect(w(g).spot).toBe('kr_hopeless');
    expect(w(g).activity).toBe('hunt');
    expect(pending(g).phase).toBe('return');
  });

  it('a fall at f4_deep_woods: the Treeline camp, 95%, the walk, then hunting', () => {
    const g = gameAt(8, 'f4_deep_woods');
    discover(g, 'f4_treeline', 'f4_woods_edge', 'f4_deep_woods');
    setHaven(g, 'f4_treeline');
    select(g, 'hunt');
    tickUntil(g, 6000, (s) => s.world.recovering);

    expect(w(g).recovering).toBe(true);
    expect(w(g).spot).toBe('f4_treeline');
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'f4_deep_woods', activity: 'hunt' } });
    expect(lines(g)).toContain('Returning to The Deep Woods.');

    tickUntil(g, 4000, (s) => !s.world.recovering);
    expect(hpFraction(g)).toBeGreaterThanOrEqual(0.94);
    tickUntil(g, 400, at('f4_deep_woods', 'hunt'));
    expect(w(g).spot).toBe('f4_deep_woods');
    expect(w(g).activity).toBe('hunt');
    expect(pending(g).phase).toBe('return');
  });

  it('the return’s own arrival does not clear it; a win at the target does', () => {
    const g = pocketGame(4);
    fallAt(g, 'kr_field');
    recovered(g);
    expect(w(g).spot).toBe('kr_camp');

    // The tick after recovery sets out; the arrival starts the hunt. The loop
    // stops on the tick of the arrival, before the hunt rolls a fight.
    tickUntil(g, 100, at('kr_field', 'hunt'));
    expect(w(g).spot).toBe('kr_field');
    expect(w(g).activity).toBe('hunt');
    expect(w(g).travelIntent).toBeNull();
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'kr_field' } });

    win(g, 'kr_field');
    expect(ko(g).pendingReturn).toBeNull();
    expect(streakAt(g, 'kr_field')).toBe(0);
  });

  it('a haven that is its own target starts the work in place', () => {
    const g = pocketGame(5, 'kr_camp');
    KR.kr_camp.activities.push(hunt);
    try {
      fallAt(g, 'kr_camp');
      expect(pending(g).phase).toBe('return');
      recovered(g);
      g.tick();
      expect(w(g).spot).toBe('kr_camp');
      expect(w(g).activity).toBe('hunt');
      expect(pending(g).phase).toBe('return');
    } finally {
      KR.kr_camp.activities.pop();
    }
  });

  it('work with no fights ends the return on arrival', () => {
    const g = pocketGame(6, 'kr_camp');
    fallAt(g, 'kr_camp', 'rest');
    recovered(g);
    g.tick();
    expect(w(g).activity).toBe('rest');
    g.tick();
    expect(ko(g).pendingReturn).toBeNull();
  });
});

describe('the four knockout sites', () => {
  it('a condition that finishes the player is followed by the return too', () => {
    const g = pocketGame(4);
    select(g, 'hunt');
    setRespawn(g, 1_000_000); // no fight: the condition does it
    setHp(g, 3);
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'blazing', intensity: 5 } });
    tickUntil(g, 60, (s) => s.world.recovering);
    expect(w(g).recovering).toBe(true);
    expect(w(g).spot).toBe('kr_camp');
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'kr_field', activity: 'hunt' } });
  });

  it('a sealed pool (the fatal-condition site) records the same fall', () => {
    const g = pocketGame(31);
    select(g, 'hunt');
    setRespawn(g, 1_000_000);
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'corrupted', intensity: 7 } });
    patch(g, (s) => {
      (s.statuses as StatusesState).held[PLAYER].find((h) => h.id === 'corrupted')!.intensity = 10;
    });
    tickUntil(g, 10, (s) => s.world.recovering);
    expect(w(g).recovering).toBe(true);
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'kr_field' } });
  });
});

describe('what the return never walks back into', () => {
  it('a forced spot: fall back, never walk in', () => {
    const g = pocketGame(7, 'kr_den');
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    fallAt(g, 'kr_den');
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: null, fallback: { spot: 'kr_meadow' } });
    expect(lines(g)).toContain('Test Den: forced fight, not re-entered. Hunting Test Meadow for 200 wins.');
  });

  it('a forced last road: fall back, never walk in', () => {
    const g = pocketGame(8, 'kr_pit');
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    // The spot itself is not forced; only the road into it is.
    expect(SPOTS.kr_pit.forced).toBeUndefined();
    expect(blockOf(g, { spot: 'kr_pit', activity: 'hunt' })).toBeNull(); // from the pit itself
    patchWorld(g, (x) => (x.spot = 'kr_camp'));
    expect(blockOf(g, { spot: 'kr_pit', activity: 'hunt' })).toBe('forced_road');
    fallAt(g, 'kr_pit');
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: null });
    expect(lines(g)).toContain('Test Pit: forced road in, not re-entered. Hunting Test Meadow for 200 wins.');
  });

  it('a spot only a forced spot leads to has no route, so it falls back', () => {
    const g = pocketGame(9, 'kr_behind');
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    fallAt(g, 'kr_behind');
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: null });
    expect(lines(g)).toContain('Test Behind: no known route back. Hunting Test Meadow for 200 wins.');
  });

  it('with no proven spot, an ineligible fall idles and the log says why', () => {
    const g = pocketGame(10, 'kr_den');
    fallAt(g, 'kr_den');
    expect(ko(g).pendingReturn).toBeNull();
    expect(lines(g)).toContain('Test Den: forced fight, not re-entered. No safer hunt known.');
    expect(defeatDialogDue(ko(g))).toBe(true);
  });

  it('the stronghold wall is never a target', () => {
    expect(NEVER_TARGET_SPOTS).toContain('f11_wall');
    for (const id of NEVER_TARGET_SPOTS) expect(SPOTS[id], `${id} must exist`).toBeDefined();
    const g = pocketGame(11);
    expect(blockOf(g, { spot: 'f11_wall', activity: 'hunt' })).toBe('wall');
  });

  it.todo('a festival floor is never a target (step 4: the festival floors and `festivalFloorOf` are not here)');

  it('an idle character is sent nowhere: no return, no fallback, no hold, no line', () => {
    const g = pocketGame(13);
    const before = lines(g).length;
    fallAt(g, 'kr_camp', null);
    expect(ko(g).pendingReturn).toBeNull();
    // Even with a proven hunt in hand.
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    fallAt(g, 'kr_camp', null);
    expect(ko(g).pendingReturn).toBeNull();
    expect(koLines(g)).toEqual([]);
    expect(lines(g).length).toBeGreaterThan(before); // the retreat still says where it woke
    expect(streakAt(g, 'kr_camp')).toBe(0);
    expect(defeatDialogDue(ko(g))).toBe(true);
    // And it stays idle after recovering.
    recovered(g);
    g.tick(100);
    expect(w(g).activity).toBeNull();
    expect(w(g).travel).toBeNull();
  });

  it('a return already in flight carries on through a knockout with no work running', () => {
    const g = pocketGame(46);
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    const before = pending(g);
    expect(before.phase).toBe('fallback');
    fallAt(g, 'kr_camp', null);
    expect(pending(g)).toEqual(before);
    expect(lines(g)).toContain('Returning to Test Meadow.');
  });

  it('a forced fight with no activity selected is still work walked into: it falls back', () => {
    // Travel clears the activity, so an ambush is lost with `activity` null.
    const g = pocketGame(47, 'kr_den');
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    fallAt(g, 'kr_den', null, true);
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: null, fallback: { spot: 'kr_meadow' } });
    expect(lines(g)).toContain('Test Den: forced fight, not re-entered. Hunting Test Meadow for 200 wins.');
    // By a forced road, on a spot that is not itself forced.
    const h = pocketGame(48, 'kr_pit');
    setProven(h, { spot: 'kr_meadow', activity: 'hunt' });
    fallAt(h, 'kr_pit', null, true);
    expect(lines(h)).toContain('Test Pit: forced road in, not re-entered. Hunting Test Meadow for 200 wins.');
    // With nothing to fall back to, the character idles and the log says why.
    const k = pocketGame(49, 'kr_den');
    fallAt(k, 'kr_den', null, true);
    expect(ko(k).pendingReturn).toBeNull();
    expect(lines(k)).toContain('Test Den: forced fight, not re-entered. No safer hunt known.');
  });

  it('a real ambush lost at a forced spot falls back to the proven hunt', () => {
    const g = pocketGame(50, 'kr_gate');
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    expect(g.dispatch(travelTo({ to: 'kr_den' })).ok).toBe(true);
    tickUntil(g, 100, (s) => !s.world.travel);
    expect(fight(g)?.forced).toBe(true);
    expect(w(g).activity).toBeNull(); // nothing was selected: the walk cleared it
    setHp(g, 1);
    tickUntil(g, 3000, (s) => s.world.recovering);
    expect(w(g).recovering).toBe(true);
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: null, fallback: { spot: 'kr_meadow' } });
  });
});

describe('the loop guard and the fallback', () => {
  it('the 5th knockout in a row goes to the proven hunt', () => {
    const g = pocketGame(14);
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    for (let i = 1; i < STREAK_LIMIT; i++) {
      fallAt(g, 'kr_field');
      expect(pending(g).phase, `knockout ${i}`).toBe('return');
    }
    fallAt(g, 'kr_field');
    expect(streakAt(g, 'kr_field')).toBe(5);
    expect(pending(g)).toMatchObject({
      phase: 'fallback',
      target: { spot: 'kr_field', activity: 'hunt' },
      fallback: { spot: 'kr_meadow', activity: 'hunt' },
      wins: 0,
    });
    expect(pending(g).until).toBe(totalTicks(g) + FALLBACK_TICKS);
    expect(lines(g)).toContain('5 knockouts in a row at Test Field. Hunting Test Meadow for 200 wins.');
  });

  it('a win at the spot ends the streak', () => {
    const g = pocketGame(15);
    for (let i = 0; i < 3; i++) fallAt(g, 'kr_field');
    expect(streakAt(g, 'kr_field')).toBe(3);
    win(g, 'kr_field');
    expect(streakAt(g, 'kr_field')).toBe(0);
  });

  it('200 wins at the fallback lead to a retry of the target', () => {
    const g = pocketGame(16);
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    for (let i = 1; i < FALLBACK_WINS; i++) win(g, 'kr_meadow');
    expect(pending(g)).toMatchObject({ phase: 'fallback', wins: FALLBACK_WINS - 1 });
    win(g, 'kr_meadow');
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'kr_field', activity: 'hunt' }, wins: 0 });
    expect(lines(g)).toContain('Retrying Test Field.');

    // And the walk happens on the next free tick.
    recovered(g);
    g.tick();
    expect(w(g).travel?.from).toBe('kr_meadow');
  });

  it('2 h at the fallback also lead to a retry, at the next free tick', () => {
    const g = pocketGame(17);
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    recovered(g);
    g.tick(); // sets out for the meadow
    tickUntil(g, 100, at('kr_meadow', 'hunt'));
    expect(w(g).activity).toBe('hunt');
    expect(pending(g).phase).toBe('fallback');
    dropFight(g);
    setTotalTicks(g, pending(g).until!);
    g.tick();
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'kr_field' } });
  });

  it('a fallback with no target ends where it is, hunting on as normal', () => {
    const g = pocketGame(18, 'kr_den');
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    fallAt(g, 'kr_den');
    for (let i = 0; i < FALLBACK_WINS; i++) win(g, 'kr_meadow');
    expect(ko(g).pendingReturn).toBeNull();
  });

  it('a knockout at the fallback keeps the target and goes back to the fallback', () => {
    const g = pocketGame(19, 'kr_meadow');
    const until = totalTicks(g) + FALLBACK_TICKS;
    setPending(g, {
      target: { spot: 'kr_field', activity: 'hunt' },
      phase: 'fallback',
      fallback: { spot: 'kr_meadow', activity: 'hunt' },
      wins: 7,
      until,
      probes: 0,
    });
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    fallAt(g, 'kr_meadow');
    expect(pending(g)).toMatchObject({
      phase: 'fallback',
      target: { spot: 'kr_field' },
      fallback: { spot: 'kr_meadow' },
      wins: 7,
      until,
    });
    expect(lines(g)).toContain('Returning to Test Meadow.');
    // The mover goes to the fallback, not the target.
    recovered(g);
    g.tick();
    tickUntil(g, 100, at('kr_meadow', 'hunt'));
    expect(w(g).spot).toBe('kr_meadow');
  });

  it('5 knockouts in a row at the fallback hold on the target', () => {
    const g = pocketGame(20, 'kr_meadow');
    setPending(g, {
      target: { spot: 'kr_field', activity: 'hunt' },
      phase: 'fallback',
      fallback: { spot: 'kr_meadow', activity: 'hunt' },
      wins: 3,
      until: totalTicks(g) + FALLBACK_TICKS,
      probes: 0,
    });
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_meadow');
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: 'kr_field' }, probes: 0 });
    expect(lines(g)).toContain('5 knockouts in a row at Test Meadow. Retrying Test Field in 10 min.');
    // A spot that sent the character down 5 times is no longer the proven one.
    expect(ko(g).proven).toBeNull();
  });

  it('a cleared, forced, unreachable or higher-floor proven spot is not used', () => {
    const cases: [string, { spot: string; activity: string }][] = [
      ['cleared', { spot: 'kr_ring', activity: 'hunt' }],
      ['forced', { spot: 'kr_den', activity: 'hunt' }],
      ['behind a forced spot', { spot: 'kr_behind', activity: 'hunt' }],
      ['no hunt there', { spot: 'kr_gate', activity: 'hunt' }],
      ['an unknown spot', { spot: 'nowhere', activity: 'hunt' }],
    ];
    for (const [label, proven] of cases) {
      const g = pocketGame(21);
      setStat(g, 'fights:kr_ring', 1); // the ring's one fight is spent
      setProven(g, proven);
      for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
      expect(pending(g).phase, label).toBe('hold');
    }
  });

  it('a proven spot on a higher floor than the fall is not used; on the same floor it is', () => {
    const open = (seed: number): Kernel => {
      const g = game(seed);
      // Floors 1 to 4 cleared and floor 5's gate met: the ladder reaches floor 5.
      clearFloors(g, ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4']);
      setStat(g, 'gold:earned', 100_000);
      setStat(g, 'kills:tag:goblin', 100);
      expect(unlocked(g, 'ascent_f5')).toBe(true);
      discover(g, ...Object.values(SPOTS).filter((spot) => /^ascent_f[45]_area$/.test(spot.areaId)).map((spot) => spot.id));
      setProven(g, { spot: 'f5_drowned_village', activity: 'hunt' });
      return g;
    };
    // Fell on floor 4 with the last haven there: floor 5 is above the fall.
    const below = open(22);
    setHaven(below, 'f4_treeline');
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(below, 'f4_woods_edge');
    expect(pending(below).phase).toBe('hold');
    // The same candidate, fallen on floor 5: reachable and not higher, so it is used.
    const level = open(23);
    setHaven(level, 'f5_causeway');
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(level, 'f5_bog');
    expect(pending(level)).toMatchObject({ phase: 'fallback', fallback: { spot: 'f5_drowned_village' } });
  });

  it('the proven hunt is the last spot with 10 wins in a row, never a budgeted, forced or festival spot', () => {
    const g = pocketGame(23);
    for (let i = 0; i < PROVEN_STREAK - 1; i++) win(g, 'kr_field');
    expect(ko(g).proven).toBeNull();
    win(g, 'kr_field');
    expect(ko(g).proven).toEqual({ spot: 'kr_field', activity: 'hunt' });
    // Ten more elsewhere move it.
    for (let i = 0; i < PROVEN_STREAK; i++) win(g, 'kr_meadow');
    expect(ko(g).proven).toEqual({ spot: 'kr_meadow', activity: 'hunt' });
    // A knockout breaks the streak at that spot.
    fallAt(g, 'kr_field');
    for (let i = 0; i < PROVEN_STREAK - 1; i++) win(g, 'kr_field');
    expect(ko(g).proven).toEqual({ spot: 'kr_meadow', activity: 'hunt' });
    // Spots with a fight budget or a forced arrival never qualify.
    const h = pocketGame(24);
    for (let i = 0; i < PROVEN_STREAK + 2; i++) win(h, 'kr_ring');
    for (let i = 0; i < PROVEN_STREAK + 2; i++) win(h, 'kr_den');
    expect(ko(h).proven).toBeNull();
    // Nor does a forced fight, wherever it is.
    for (let i = 0; i < PROVEN_STREAK + 2; i++) win(h, 'kr_field', true);
    expect(ko(h).proven).toBeNull();
  });
});

describe('the hold', () => {
  it('waits 10, 20, 40, 80 and 80 minutes, probing the target each time', () => {
    const g = pocketGame(25);
    const waits: number[] = [];
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    expect(pending(g).phase).toBe('hold');
    expect(lines(g)).toContain('No safer hunt known. Retrying Test Field in 10 min.');
    for (let probeNo = 0; probeNo < 5; probeNo++) {
      const p = pending(g);
      waits.push((p.until! - totalTicks(g)) / (60 * TPS));
      // Nothing happens until the wait is over: idle at the haven.
      recovered(g);
      setTotalTicks(g, p.until! - 2); // a tick adds one before the world moves
      g.tick();
      expect(pending(g).phase).toBe('hold');
      expect(w(g).activity).toBeNull();
      g.tick();
      expect(pending(g).phase, `probe ${probeNo}`).toBe('return');
      expect(lines(g)).toContain('Retrying Test Field.');
      // The probe is lost: the wait doubles.
      fallAt(g, 'kr_field');
      expect(pending(g).phase).toBe('hold');
    }
    expect(waits).toEqual([10, 20, 40, 80, 80]);
    expect(waits).toEqual([...HOLD_MINUTES, HOLD_MINUTES[HOLD_MINUTES.length - 1]]);
    expect(holdTicks(99)).toBe(80 * 60 * TPS);
  });

  it('a win at the target ends the hold schedule', () => {
    const g = pocketGame(26);
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    const p = pending(g);
    recovered(g);
    setTotalTicks(g, p.until! - 1);
    g.tick();
    expect(pending(g).phase).toBe('return');
    win(g, 'kr_field');
    expect(ko(g).pendingReturn).toBeNull();
    // The next streak starts from zero: a fresh knockout is a plain return.
    fallAt(g, 'kr_field');
    expect(pending(g)).toMatchObject({ phase: 'return', probes: 0 });
  });

  it('a hopeless spot never idles the character for more than 80 minutes, over 8 hours', () => {
    const g = pocketGame(27, 'kr_hopeless');
    select(g, 'hunt');
    const EIGHT_HOURS = 8 * 3600 * TPS;
    const LIMIT = 80 * 60 * TPS;
    const start = totalTicks(g);
    let longest = 0;
    let stretch = 0;
    let longestStall = 0;
    let stall = 0;
    let probes = 0;
    let lastPhase: PendingReturn['phase'] | undefined = ko(g).pendingReturn?.phase;
    onTick = (x, c, k) => {
      // Idle: nothing selected, not walking, not fighting. Being out cold counts.
      if (!x.activity && !x.travel && !c.fight) stretch++;
      else stretch = 0;
      if (stretch > longest) longest = stretch;
      stall = stalled(x, c, k) ? stall + 1 : 0;
      if (stall > longestStall) longestStall = stall;
      const phase = k.pendingReturn?.phase;
      if (phase === 'return' && lastPhase === 'hold') probes++;
      lastPhase = phase;
    };
    try {
      g.tick(EIGHT_HOURS);
    } finally {
      onTick = null;
    }
    // Nothing waited on a fight that no tick would ever resolve.
    expect(longestStall).toBeLessThanOrEqual(3);
    // The hold is counted from the knockout, so the recovery inside it adds nothing;
    // a minute of slack covers the tick that starts the probe.
    expect(longest).toBeLessThanOrEqual(LIMIT + 60 * TPS);
    // The stretch reaches the limit: the longest hold really was 80 minutes.
    expect(longest).toBeGreaterThanOrEqual(LIMIT - 60 * TPS);
    // It really did cycle: knocked out many times, waiting and probing between.
    expect(counter(g, 'ko:n:kr_hopeless')).toBeGreaterThan(STREAK_LIMIT + 3);
    expect(probes).toBeGreaterThanOrEqual(5);
    expect(totalTicks(g) - start).toBeGreaterThanOrEqual(EIGHT_HOURS);
  }, 120_000);

  it('with a proven hunt to fall back to, the character is idle only while recovering, over 8 hours', () => {
    const g = pocketGame(44, 'kr_hopeless');
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    select(g, 'hunt');
    const EIGHT_HOURS = 8 * 3600 * TPS;
    let longest = 0;
    let stretch = 0;
    let longestStall = 0;
    let stall = 0;
    let fallbacks = 0;
    let lastPhase: PendingReturn['phase'] | undefined = ko(g).pendingReturn?.phase;
    onTick = (x, c, k) => {
      if (!x.activity && !x.travel && !c.fight) stretch++;
      else stretch = 0;
      if (stretch > longest) longest = stretch;
      stall = stalled(x, c, k) ? stall + 1 : 0;
      if (stall > longestStall) longestStall = stall;
      const phase = k.pendingReturn?.phase;
      if (phase === 'fallback' && lastPhase !== 'fallback') fallbacks++;
      lastPhase = phase;
    };
    try {
      g.tick(EIGHT_HOURS);
    } finally {
      onTick = null;
    }
    expect(longestStall).toBeLessThanOrEqual(3);
    // Only the recovery after a knockout is idle time: seconds, never a hold.
    expect(longest).toBeLessThanOrEqual(60 * TPS);
    // The 5-knockout streak sent it to the meadow, and the retries sent it back again.
    expect(fallbacks).toBeGreaterThanOrEqual(2);
    expect(counter(g, 'kills') ?? 0).toBeGreaterThan(200);
  }, 120_000);
});

describe('player commands end the return', () => {
  function pendingAtCamp(seed: number): Kernel {
    const g = pocketGame(seed);
    fallAt(g, 'kr_field');
    recovered(g);
    return g;
  }

  it('selecting an activity clears it, and John’s rest-while-recovering keeps today’s behaviour', () => {
    const g = pocketGame(28);
    fallAt(g, 'kr_field');
    expect(w(g).recovering).toBe(true);
    select(g, 'rest');
    expect(ko(g).pendingReturn).toBeNull();
    g.tick(300);
    expect(w(g).recovering).toBe(false);
    expect(w(g).spot).toBe('kr_camp');
    expect(w(g).activity).toBe('rest');
  });

  it('stopping by hand clears it', () => {
    const g = pendingAtCamp(29);
    select(g, null);
    expect(ko(g).pendingReturn).toBeNull();
    g.tick(50);
    expect(w(g).spot).toBe('kr_camp');
    expect(w(g).travel).toBeNull();
  });

  it('a refused command ends nothing', () => {
    const g = pocketGame(30);
    fallAt(g, 'kr_field'); // still out cold
    expect(g.dispatch(travelTo({ to: 'kr_meadow' })).ok).toBe(false);
    expect(g.dispatch(travelTo({ to: 'kr_gate' })).ok).toBe(false);
    expect(g.dispatch(goAndDoCommand({ spot: 'kr_meadow', activity: 'hunt' })).ok).toBe(false);
    expect(ko(g).pendingReturn).not.toBeNull();
    // A pick the game refuses: a forced fight closes the door.
    expect(ask(g, startForced, { site: { id: 'kr_den', name: 'Test Den', encounters: rats()! } })).toBe(true);
    expect(select(g, 'rest').ok).toBe(false);
    dropFight(g);
    expect(ko(g).pendingReturn).not.toBeNull();
  });

  it.each([
    ['travelPlanTo', (g: Kernel) => g.dispatch(travelTo({ to: 'kr_meadow' })).ok],
    ['travelTo', (g: Kernel) => g.dispatch(travelTo({ to: 'kr_gate' })).ok],
    ['goAndDo', (g: Kernel) => g.dispatch(goAndDoCommand({ spot: 'kr_meadow', activity: 'hunt' })).ok],
    [
      'fastTravelTo',
      (g: Kernel) => {
        patch(g, (s) => ((s.gold as GoldState).gold = 5000));
        return g.dispatch(fastTravel({ to: 'kr_meadow' })).ok;
      },
    ],
  ])('%s clears it', (_name, command) => {
    const g = pendingAtCamp(31);
    expect(command(g)).toBe(true);
    expect(ko(g).pendingReturn).toBeNull();
  });

  it('cancelling a walk clears it', () => {
    const g = pendingAtCamp(32);
    g.dispatch(travelTo({ to: 'kr_field' }));
    setPending(g, { target: { spot: 'kr_field', activity: 'hunt' }, phase: 'return', wins: 0, probes: 0 });
    g.dispatch(cancelPlan());
    expect(ko(g).pendingReturn).toBeNull();
  });

  it('changing what a walk is for clears it', () => {
    const g = pendingAtCamp(32);
    g.dispatch(travelTo({ to: 'kr_field' }));
    setPending(g, { target: { spot: 'kr_field', activity: 'hunt' }, phase: 'return', wins: 0, probes: 0 });
    expect(g.dispatch(setIntent({ activity: null })).ok).toBe(true);
    expect(ko(g).pendingReturn).toBeNull();
  });

  it('a climb clears it', () => {
    const g = gameAt(33, 'ascent_foot');
    setPending(g, { target: { spot: 'f1_storerooms', activity: 'hunt' }, phase: 'return', wins: 0, probes: 0 });
    expect(g.dispatch(climb({ floor: 'ascent_f1' })).ok).toBe(true);
    expect(ko(g).pendingReturn).toBeNull();
  });

  it('a bench run or a performance is the player’s own work and ends it: a bench run (performances are not here)', () => {
    const g = pendingAtCamp(34);
    expect(ko(g).pendingReturn).not.toBeNull();
    patch(g, (slices) => {
      slices.materials.stock.spring_water = { c: 1 };
      slices.materials.stock.mendroot = { c: 1 };
    });
    const placement = { step1: { id: 'spring_water', quality: 'c' as const }, step2: { id: 'mendroot', quality: 'c' as const } };
    expect(g.dispatch(startBench({ discipline: 'alchemy', placement, count: 1 })).ok).toBe(true);
    expect(ko(g).pendingReturn).toBeNull();
  });

  it.todo('a prestige clears it, and the proven hunt with it (port 7: prestige is not here)');
});

describe('recovery runs higher while a return is pending', () => {
  it('95%, or the hunt’s rest target when that is higher', () => {
    const g = pocketGame(36);
    expect(recoverTarget(g)).toBeNull();
    fallAt(g, 'kr_field');
    expect(recoverTarget(g)).toBe(0.95);
    g.dispatch(setHuntRest({ at: 0.5, toFull: true }));
    expect(recoverTarget(g)).toBe(1);
    g.dispatch(setHuntRest({ at: 0.5, toFull: false }));
    expect(recoverTarget(g)).toBe(0.95);
  });

  it('a body that cannot mend stops at the old 60%', () => {
    (STATUSES as Record<string, StatusDef>).test_no_mending = {
      id: 'test_no_mending',
      name: 'No Mending',
      icon: '🚫',
      desc: 'test',
      blocksRegen: ['hp'],
    } as StatusDef;
    try {
      const g = pocketGame(37);
      fallAt(g, 'kr_field');
      ask(g, applyStatus, { entity: PLAYER, app: { id: 'test_no_mending', duration: 100_000 }, source: 'test' });
      expect(recoverTarget(g)).toBeNull();
    } finally {
      delete (STATUSES as Record<string, StatusDef>).test_no_mending;
    }
  });

  it('with no return pending the old 60% mark holds', () => {
    const g = pocketGame(38);
    select(g, 'hunt');
    fallAt(g, 'kr_camp', null); // nothing to return to, no proven spot
    expect(ko(g).pendingReturn).toBeNull();
    setHp(g, maxHp(g) * 0.7);
    g.tick();
    expect(w(g).recovering).toBe(false);
  });
});

describe('the defeat window', () => {
  it('opens only when no return or fallback follows', () => {
    const state: KnockoutState = { pendingReturn: null, proven: null };
    expect(defeatDialogDue(state)).toBe(true);
    state.pendingReturn = { target: { spot: 'kr_field', activity: 'hunt' }, phase: 'return', wins: 0, probes: 0 };
    expect(defeatDialogDue(state)).toBe(false);
    state.pendingReturn = { target: null, phase: 'fallback', fallback: { spot: 'kr_meadow', activity: 'hunt' }, wins: 0, probes: 0 };
    expect(defeatDialogDue(state)).toBe(false);
    state.pendingReturn = { target: { spot: 'kr_field', activity: 'hunt' }, phase: 'hold', until: 10, wins: 0, probes: 0 };
    expect(defeatDialogDue(state)).toBe(true);
  });

  it('each knockout says what follows, in one line', () => {
    const g = pocketGame(40);
    fallAt(g, 'kr_field');
    expect(koLines(g)).toEqual(['Returning to Test Field.']);
    fallAt(g, 'kr_den');
    expect(koLines(g).slice(1)).toEqual(['Test Den: forced fight, not re-entered. No safer hunt known.']);
  });
});

describe('a saved return', () => {
  /** A new kernel loaded from the save of another. The old `new Game(deserialize(serialize(state)))`. */
  function reloaded(g: Kernel, change?: (slices: Record<string, { version: number; data: any }>) => void): Kernel {
    const envelope = JSON.parse(JSON.stringify(g.save(0)));
    change?.(envelope.slices);
    const h = game(1);
    expect(h.load(envelope).ok).toBe(true);
    return h;
  }

  it('survives a save and a load', () => {
    const g = pocketGame(41);
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    const before = pending(g);
    expect(g.save(0).slices.knockout.version).toBe(knockout.version);
    const back = reloaded(g);
    expect(pending(back)).toEqual(before);
    expect(ko(back).proven).toEqual({ spot: 'kr_meadow', activity: 'hunt' });
    expect(counter(back, 'ko:n:kr_field')).toBe(STREAK_LIMIT);
  });

  // The save starts at version 1 here. The old case loaded a save from before
  // the two fields existed; here that is a save with no knockout slice.
  it('a v62 save loads with nothing pending and no proven hunt', () => {
    const g = pocketGame(42);
    const loaded = reloaded(g, (slices) => {
      delete slices.knockout;
    });
    expect(ko(loaded).pendingReturn).toBeNull();
    expect(ko(loaded).proven).toBeNull();
    expect(knockout.initial()).toEqual({ pendingReturn: null, proven: null });
    expect(knockout.version).toBeGreaterThanOrEqual(1);
  });

  it('a return in flight carries on after a load', () => {
    const g = pocketGame(43);
    fallAt(g, 'kr_field');
    const h = reloaded(g);
    ask(h, recoverNow, undefined);
    tickUntil(h, 100, at('kr_field', 'hunt'));
    expect(w(h).spot).toBe('kr_field');
    expect(w(h).activity).toBe('hunt');
  });
});

describe('across floors', () => {
  const rideEdges: Edge[] = [
    { from: 'f3_stairhead', to: 'f4_treeline', ticks: 40 },
    { from: 'f4_treeline', to: 'f3_stairhead', ticks: 40 },
  ];

  /** Fell at the Deep Woods with the last haven on floor 3. */
  function fellOnFloor4(seed: number): Kernel {
    const g = game(seed);
    clearFloors(g, ['ascent_f1', 'ascent_f2', 'ascent_f3']);
    setStat(g, 'gold:earned', 100_000);
    discover(g, 'f3_stairhead', 'f4_treeline', 'f4_woods_edge', 'f4_deep_woods');
    setHaven(g, 'f3_stairhead');
    expect(unlocked(g, 'ascent_f4')).toBe(true);
    fallAt(g, 'f4_deep_woods');
    expect(w(g).spot).toBe('f3_stairhead');
    recovered(g);
    return g;
  }

  /** The stops of the walk back. No hunt runs on the road, so no fight opens before the arrival. */
  function walkBack(g: Kernel): string[] {
    const stops: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const s = st(g);
      if (s.world.spot === 'f4_deep_woods' && s.world.activity === 'hunt') break;
      g.tick();
      const travel = w(g).travel;
      if (travel && !stops.includes(travel.to)) stops.push(travel.to);
    }
    return stops;
  }

  it('climbs to the target’s floor, then walks, when no route crosses', () => {
    const g = fellOnFloor4(44);
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'f4_deep_woods' } });
    const stops = walkBack(g);
    expect(stops[0]).toBe('f4_treeline'); // the ladder
    expect(stops).toContain('f4_deep_woods');
    expect(w(g).spot).toBe('f4_deep_woods');
    expect(w(g).activity).toBe('hunt');
    expect(pending(g).phase).toBe('return');
  });

  it('uses the route when the router crosses floors (ride edges)', () => {
    for (const e of rideEdges) ADJACENCY.get(e.from)!.push(e);
    try {
      const g = fellOnFloor4(45);
      const stops = walkBack(g);
      expect(stops[0]).toBe('f4_treeline'); // the same first stop, by a road this time
      expect(w(g).spot).toBe('f4_deep_woods');
      expect(w(g).activity).toBe('hunt');
      expect(pending(g).phase).toBe('return');
      expect(lines(g).some((m) => /Climbing|Descending/.test(m))).toBe(false);
    } finally {
      for (const e of rideEdges) {
        ADJACENCY.set(
          e.from,
          ADJACENCY.get(e.from)!.filter((x) => x !== e),
        );
      }
    }
  });
});

/** Floors 1 to 4 cleared and floor 5's gate met, the Greenwood and the Mire on the map. */
function greenwood(seed: number): Kernel {
  const g = game(seed);
  clearFloors(g, ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4']);
  setStat(g, 'gold:earned', 100_000);
  setStat(g, 'kills:tag:goblin', 100);
  discover(g, ...Object.values(SPOTS).filter((spot) => /^ascent_f[45]_area$/.test(spot.areaId)).map((spot) => spot.id));
  setHaven(g, 'f4_treeline');
  return g;
}

describe('a retry that sets out rolls no fight on the road', () => {
  /**
   * Hunting the fallback at the Woods Edge, the 2 h cap one tick away, the
   * respawn timer one tick from rolling an encounter: the tick the mover sets
   * out is also the tick a stale hunt would roll one.
   */
  function atCap(seed: number, target: ReturnSpot): Kernel {
    const g = greenwood(seed);
    patchWorld(g, (x) => (x.spot = 'f4_woods_edge'));
    select(g, 'hunt');
    setPending(g, {
      target,
      phase: 'fallback',
      fallback: { spot: 'f4_woods_edge', activity: 'hunt' },
      wins: 0,
      until: totalTicks(g) + 1,
      probes: 0,
    });
    setRespawn(g, 1);
    return g;
  }

  /** Tick to the target's hunt, failing if a fight is ever open on the road. */
  function walkThere(g: Kernel, spot: string): boolean {
    let fightOnRoad = false;
    for (let i = 0; i < 800; i++) {
      const s = st(g);
      if (s.world.spot === spot && s.world.activity === 'hunt' && !s.world.travel) break;
      g.tick();
      const after = st(g);
      if (after.world.travel && after.combat.fight) fightOnRoad = true;
    }
    return fightOnRoad;
  }

  it('on the same floor', () => {
    const g = atCap(51, { spot: 'f4_deep_woods', activity: 'hunt' });
    g.tick();
    expect(pending(g).phase).toBe('return');
    g.tick();
    expect(w(g).travel).not.toBeNull();
    expect(fight(g)).toBeNull();
    expect(walkThere(g, 'f4_deep_woods')).toBe(false);
    expect(w(g).spot).toBe('f4_deep_woods');
    expect(w(g).activity).toBe('hunt');
    expect(fight(g)).toBeNull();
  });

  it('by the ladder, when the target is on another floor', () => {
    const g = atCap(52, { spot: 'f5_bog', activity: 'hunt' });
    g.tick();
    g.tick();
    expect(w(g).travel?.to).toBe('f5_causeway'); // the climb, not a road
    expect(fight(g)).toBeNull();
    expect(walkThere(g, 'f5_bog')).toBe(false);
    expect(w(g).spot).toBe('f5_bog');
    expect(w(g).activity).toBe('hunt');
  });

  // The old case called `tickCombat` with a journey under way. Here the hunt
  // loop is the combat system's: the case runs its tick with the loop on and
  // the timer at 0, on the road and standing.
  it('a hunt asked to roll an encounter on the road refuses', () => {
    const hunting = (seed: number): Kernel => {
      const g = pocketGame(seed, 'kr_field');
      select(g, 'hunt');
      setRespawn(g, 1_000_000);
      g.tick(); // the hunt loop is on
      expect(st(g).combat.hunting).toBe(true);
      setRespawn(g, 0);
      return g;
    };
    const g = hunting(53);
    expect(g.dispatch(travelTo({ to: 'kr_gate' })).ok).toBe(true);
    g.tick(3);
    expect(w(g).travel).not.toBeNull();
    expect(fight(g)).toBeNull();
    const h = hunting(53);
    h.tick();
    expect(fight(h)).not.toBeNull(); // the same tick rolls one standing still
  });

  it('a step that sets out gives the activity it leaves no tick of work', () => {
    const g = pocketGame(54, 'kr_yard');
    select(g, 'drill');
    setPending(g, { target: { spot: 'kr_field', activity: 'hunt' }, phase: 'return', wins: 0, probes: 0 });
    patchWorld(g, (x) => (x.activityProgress = 0));
    g.tick();
    expect(w(g).travel).not.toBeNull();
    expect(w(g).activityProgress).toBe(0);
  });
});

describe('a probe whose route is shut', () => {
  it('holds again with the doubled wait, and walks back once the road is open', () => {
    const g = pocketGame(55);
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    expect(pending(g)).toMatchObject({ phase: 'hold', probes: 0 });
    recovered(g);
    const roads = ADJACENCY.get('kr_camp')!;
    ADJACENCY.set('kr_camp', []); // nothing leaves the haven
    try {
      setTotalTicks(g, pending(g).until! - 1);
      g.tick(); // the wait is over: a probe
      expect(pending(g).phase).toBe('return');
      g.tick(); // no route
      expect(pending(g)).toMatchObject({ phase: 'hold', probes: 1, target: { spot: 'kr_field' } });
      expect(pending(g).until).toBe(totalTicks(g) + holdTicks(1));
      expect(lines(g)).toContain('Test Field: no known route back. No safer hunt known. Retrying in 20 min.');
      expect(w(g).activity).toBeNull();
    } finally {
      ADJACENCY.set('kr_camp', roads);
    }
    // Open again: the next probe walks back and resumes.
    setTotalTicks(g, pending(g).until! - 1);
    g.tick();
    tickUntil(g, 100, at('kr_field', 'hunt'));
    expect(w(g).spot).toBe('kr_field');
    expect(w(g).activity).toBe('hunt');
    expect(pending(g).phase).toBe('return');
  });

  it('a hold that keeps failing never waits longer than 80 minutes', () => {
    const g = pocketGame(56);
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    recovered(g);
    const roads = ADJACENCY.get('kr_camp')!;
    ADJACENCY.set('kr_camp', []);
    try {
      const waits: number[] = [];
      for (let i = 0; i < 6; i++) {
        waits.push((pending(g).until! - totalTicks(g)) / (60 * TPS));
        setTotalTicks(g, pending(g).until! - 1);
        g.tick();
        g.tick();
        expect(pending(g).phase).toBe('hold');
      }
      expect(waits).toEqual([10, 20, 40, 80, 80, 80]);
    } finally {
      ADJACENCY.set('kr_camp', roads);
    }
  });

  /** The road into the field shut: the field is unreachable, the meadow is not. */
  function shutField(): () => void {
    const roads = ADJACENCY.get('kr_gate')!;
    ADJACENCY.set(
      'kr_gate',
      roads.filter((e) => e.to !== 'kr_field'),
    );
    return () => ADJACENCY.set('kr_gate', roads);
  }

  /** A hold on the field, then its probe at a shut road, with the meadow proven. */
  function probeAtShutRoad(seed: number): { g: Kernel; open: () => void } {
    const g = pocketGame(seed);
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    expect(pending(g).phase).toBe('hold');
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    recovered(g);
    const open = shutField();
    try {
      setTotalTicks(g, pending(g).until! - 1);
      g.tick(); // the wait is over: a probe
      expect(pending(g).phase).toBe('return');
      g.tick(); // no road to the field
    } catch (error) {
      open();
      throw error;
    }
    return { g, open };
  }

  /** The 200th win at the meadow is one win away. */
  const oneWinLeft = (g: Kernel) => patchKnockout(g, (k) => (k.pendingReturn!.wins = FALLBACK_WINS - 1));

  it('with a proven hunt it hunts there, keeps the target, and retries it after 200 wins', () => {
    const { g, open } = probeAtShutRoad(60);
    try {
      expect(pending(g)).toMatchObject({
        phase: 'fallback',
        target: { spot: 'kr_field', activity: 'hunt' },
        fallback: { spot: 'kr_meadow', activity: 'hunt' },
        wins: 0,
        probes: 1,
      });
      expect(pending(g).until).toBe(totalTicks(g) + FALLBACK_TICKS);
      expect(lines(g)).toContain('Test Field: no known route back. Hunting Test Meadow for 200 wins or 2 h, then retrying.');
    } finally {
      // The road opens again while the character hunts the meadow.
      open();
    }
    tickUntil(g, 100, at('kr_meadow', 'hunt'));
    expect(w(g).spot).toBe('kr_meadow');
    oneWinLeft(g);
    win(g, 'kr_meadow');
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'kr_field' }, probes: 1 });
    // The loop stops on the tick of the arrival, before the hunt there rolls a fight.
    dropFight(g);
    tickUntil(g, 100, at('kr_field', 'hunt'));
    expect(w(g).spot).toBe('kr_field');
    expect(w(g).activity).toBe('hunt');
    expect(pending(g).phase).toBe('return');
  });

  it('still shut at the retry: it falls back again, and the target is still kept', () => {
    const { g, open } = probeAtShutRoad(61);
    try {
      tickUntil(g, 100, at('kr_meadow', 'hunt'));
      oneWinLeft(g);
      win(g, 'kr_meadow');
      expect(pending(g).phase).toBe('return');
      dropFight(g);
      g.tick(); // the road is still shut
      expect(pending(g)).toMatchObject({
        phase: 'fallback',
        target: { spot: 'kr_field' },
        fallback: { spot: 'kr_meadow' },
        wins: 0,
        probes: 2,
      });
    } finally {
      open();
    }
  });

  it('only a spot the return never walks into loses its target', () => {
    const g = pocketGame(62);
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    recovered(g);
    SPOTS.kr_field.forced = true; // the field turned into an ambush since the hold began
    try {
      setTotalTicks(g, pending(g).until! - 1);
      g.tick();
      g.tick();
      expect(pending(g)).toMatchObject({ phase: 'fallback', target: null, fallback: { spot: 'kr_meadow' } });
      expect(lines(g)).toContain('Test Field: forced fight, not re-entered. Hunting Test Meadow for 200 wins.');
      // And with no proven hunt there is nothing to fall back to: the return ends.
      setProven(g, null);
      setPending(g, { target: { spot: 'kr_field', activity: 'hunt' }, phase: 'return', wins: 0, probes: 0 });
      patchWorld(g, (x) => {
        x.spot = 'kr_camp';
        x.activity = null;
      });
      g.tick();
      expect(ko(g).pendingReturn).toBeNull();
      expect(lines(g)).toContain('Test Field: forced fight, not re-entered. No safer hunt known.');
    } finally {
      delete SPOTS.kr_field.forced;
    }
  });
});

describe('a knockout at the fallback right after the retry', () => {
  it('keeps the target and the probe count', () => {
    const g = pocketGame(57, 'kr_meadow');
    const meadow = { spot: 'kr_meadow', activity: 'hunt' };
    setPending(g, {
      target: { spot: 'kr_field', activity: 'hunt' },
      phase: 'fallback',
      fallback: meadow,
      wins: FALLBACK_WINS - 1,
      until: totalTicks(g) + FALLBACK_TICKS,
      probes: 2,
    });
    win(g, 'kr_meadow'); // the 200th win: the retry begins, the character still at the meadow
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'kr_field' }, fallback: meadow, probes: 2 });

    fallAt(g, 'kr_meadow');
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'kr_field' }, probes: 2 });
    expect(lines(g)).toContain('Returning to Test Field.');

    // Five in a row at the fallback: a hold on the target, the wait from the kept count.
    for (let i = 1; i < STREAK_LIMIT; i++) fallAt(g, 'kr_meadow');
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: 'kr_field' }, probes: 2 });
    expect(pending(g).until).toBe(totalTicks(g) + holdTicks(2));
    expect(lines(g)).toContain('5 knockouts in a row at Test Meadow. Retrying Test Field in 40 min.');
  });

  it('on the Greenwood: the target stays the Deep Woods', () => {
    const g = greenwood(58);
    patchWorld(g, (x) => (x.spot = 'f4_woods_edge'));
    setPending(g, {
      target: { spot: 'f4_deep_woods', activity: 'hunt' },
      phase: 'return',
      fallback: { spot: 'f4_woods_edge', activity: 'hunt' },
      wins: 0,
      probes: 2,
    });
    fallAt(g, 'f4_woods_edge');
    expect(pending(g)).toMatchObject({ phase: 'return', target: { spot: 'f4_deep_woods' }, probes: 2 });
  });

  it('a knockout at the target after the retry is still a knockout at the target', () => {
    const g = pocketGame(59, 'kr_field');
    setPending(g, {
      target: { spot: 'kr_field', activity: 'hunt' },
      phase: 'return',
      fallback: { spot: 'kr_meadow', activity: 'hunt' },
      wins: 0,
      probes: 1,
    });
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: 'kr_field' } });
    expect(pending(g).fallback).toBeUndefined();
  });
});

/** Advance the clock with no tick. The old `state.totalTicks += n`. */
const later = (g: Kernel, ticks: number) => setTotalTicks(g, totalTicks(g) + ticks);

describe('a spot with a fight budget as the fallback', () => {
  /** Five losses at the field: the fallback is needed. */
  const streak = (g: Kernel): void => {
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
  };

  it('is chosen when no proven hunt exists, if it was won at and has fights left', () => {
    const g = pocketGame(70);
    win(g, 'kr_ring');
    expect(ko(g).proven).toBeNull(); // a budget runs out before 10 wins in a row
    streak(g);
    expect(pending(g)).toMatchObject({
      phase: 'fallback',
      target: { spot: 'kr_field' },
      fallback: { spot: 'kr_ring', activity: 'hunt' },
    });
    expect(lines(g)).toContain('5 knockouts in a row at Test Field. Hunting Test Ring for 200 wins.');
  });

  it('is chosen after a forced-spot loss too, with no target', () => {
    const g = pocketGame(71, 'kr_den');
    win(g, 'kr_ring');
    fallAt(g, 'kr_den', null, true);
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: null, fallback: { spot: 'kr_ring' } });
    expect(lines(g)).toContain('Test Den: forced fight, not re-entered. Hunting Test Ring for 200 wins.');
  });

  it('loses to a usable proven hunt, which never runs out, even when it was won at less recently', () => {
    const g = pocketGame(72);
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    win(g, 'kr_ring'); // the more recent win
    streak(g);
    expect(pending(g)).toMatchObject({ phase: 'fallback', fallback: { spot: 'kr_meadow' } });
  });

  it('takes the most recent win among the limited spots', () => {
    const g = pocketGame(73);
    win(g, 'kr_ring');
    later(g, 100);
    win(g, 'kr_lane');
    streak(g);
    expect(pending(g).fallback).toMatchObject({ spot: 'kr_lane' });

    const h = pocketGame(74);
    win(h, 'kr_lane');
    later(h, 100);
    win(h, 'kr_ring');
    streak(h);
    expect(pending(h).fallback).toMatchObject({ spot: 'kr_ring' });
  });

  it('is not used if a knockout there came after its last win; a later win makes it usable again', () => {
    const g = pocketGame(75);
    win(g, 'kr_ring');
    fallAt(g, 'kr_ring');
    expect(counter(g, 'win:n:kr_ring')).toBeUndefined();
    streak(g);
    expect(pending(g).phase).toBe('hold');

    const h = pocketGame(76);
    win(h, 'kr_ring');
    fallAt(h, 'kr_ring');
    win(h, 'kr_ring');
    streak(h);
    expect(pending(h)).toMatchObject({ phase: 'fallback', fallback: { spot: 'kr_ring' } });
  });

  it('is not used if it was never fought', () => {
    const g = pocketGame(77);
    streak(g);
    expect(pending(g).phase).toBe('hold');
  });

  it('is not used once cleared, and never when forced, a festival floor or the wall', () => {
    const g = pocketGame(78);
    win(g, 'kr_ring');
    setStat(g, 'fights:kr_ring', 1); // the one fight is spent
    streak(g);
    expect(pending(g).phase).toBe('hold');

    // The wall is a limited hunt spot (8 fights) that ends the run: no win there is recorded.
    const h = pocketGame(79);
    win(h, 'f11_wall');
    win(h, 'kr_den'); // forced
    expect(counter(h, 'win:n:f11_wall')).toBeUndefined();
    expect(counter(h, 'win:n:kr_den')).toBeUndefined();
    streak(h);
    expect(pending(h).phase).toBe('hold');
  });

  it('counts its fights toward the retry like any fallback', () => {
    const g = pocketGame(80);
    win(g, 'kr_lane');
    streak(g);
    win(g, 'kr_lane');
    win(g, 'kr_lane');
    expect(pending(g)).toMatchObject({ phase: 'fallback', wins: 2 });
  });

  describe('when it is spent', () => {
    /** Hunting the lane as the fallback, a win at the ring behind it, 7 wins in. */
    function huntingLane(seed: number, target: boolean): Kernel {
      const g = pocketGame(seed, target ? 'kr_field' : 'kr_den');
      win(g, 'kr_ring');
      later(g, 100);
      win(g, 'kr_lane');
      if (target) streak(g);
      else fallAt(g, 'kr_den', null, true);
      expect(pending(g).fallback).toMatchObject({ spot: 'kr_lane' });
      recovered(g);
      tickUntil(g, 100, at('kr_lane', 'hunt'));
      expect(w(g).activity).toBe('hunt');
      patchKnockout(g, (k) => (k.pendingReturn!.wins = 7));
      return g;
    }

    it('picks again, with the wins and the clock carried over', () => {
      const g = huntingLane(81, true);
      const until = pending(g).until;
      setStat(g, 'fights:kr_lane', 3); // the budget is spent
      g.tick();
      expect(pending(g)).toMatchObject({
        phase: 'fallback',
        target: { spot: 'kr_field' },
        fallback: { spot: 'kr_ring' },
        wins: 7,
        until,
      });
      expect(lines(g)).toContain('Test Lane: no fights left. Hunting Test Ring.');
      // And it walks there.
      tickUntil(g, 100, at('kr_ring', 'hunt'));
      expect(w(g).spot).toBe('kr_ring');
    });

    it('with none left and a target, holds on it and idles', () => {
      const g = huntingLane(82, true);
      setStat(g, 'fights:kr_lane', 3);
      setStat(g, 'fights:kr_ring', 1);
      g.tick();
      expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: 'kr_field' }, probes: 0 });
      expect(pending(g).until).toBe(totalTicks(g) + holdTicks(0));
      expect(w(g).activity).toBeNull();
      expect(lines(g)).toContain('Test Lane: no fights left. No safer hunt known. Retrying Test Field in 10 min.');
    });

    it('with none left and no target (a forced-spot loss), the return ends and the character idles', () => {
      const g = huntingLane(83, false);
      setStat(g, 'fights:kr_lane', 3);
      setStat(g, 'fights:kr_ring', 1);
      g.tick();
      expect(ko(g).pendingReturn).toBeNull();
      expect(w(g).activity).toBeNull();
      expect(lines(g)).toContain('Test Lane: no fights left. No safer hunt known.');
    });
  });

  it('after a band-1 boss loss, falls back to the Vermin Hall it has won at', () => {
    // Real content: the toll collector's office is a forced spot, lost with no activity selected.
    const g = game(84);
    discover(g, 'f1_landing', 'f1_storerooms', 'f1_toll_hall');
    setHaven(g, 'f1_landing');
    win(g, 'f1_storerooms');
    fallAt(g, 'f1_toll_hall', null, true);
    expect(pending(g)).toMatchObject({
      phase: 'fallback',
      target: null,
      fallback: { spot: 'f1_storerooms', activity: 'hunt' },
    });
    expect(lines(g)).toContain('Toll Collector’s Office: forced fight, not re-entered. Hunting The Vermin Hall for 200 wins.');
    // With the Vermin Hall cleared, nothing is left and the character idles as before.
    const h = game(85);
    discover(h, 'f1_landing', 'f1_storerooms', 'f1_toll_hall');
    setHaven(h, 'f1_landing');
    win(h, 'f1_storerooms');
    setStat(h, 'fights:f1_storerooms', 6);
    fallAt(h, 'f1_toll_hall', null, true);
    expect(ko(h).pendingReturn).toBeNull();
  });
});

describe('a limited fallback is picked again from the fall floor', () => {
  // `kr_f3` (mounted above): a hunt spot on floor 3, next to its landing, to fall at with a target.

  /**
   * On floor 3 with the haven at its landing. Two limited spots won at: the
   * Mail Carts on floor 2 (the older win) and the Vermin Hall on floor 1 (the
   * newer one).
   */
  function floorThree(seed: number): Kernel {
    const g = game(seed);
    clearFloors(g, ['ascent_f1']);
    setStat(g, 'gold:earned', 1000);
    discover(g, 'f1_landing', 'f1_storerooms', 'f2_stairhead', 'f2_hall_1', 'f3_stairhead', 'f3_hearing_room', 'kr_f3');
    setHaven(g, 'f3_stairhead');
    expect(unlocked(g, 'ascent_f2')).toBe(true);
    win(g, 'f2_hall_1');
    later(g, 100);
    win(g, 'f1_storerooms');
    return g;
  }
  const withTarget = (g: Kernel): void => {
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_f3');
  };
  const spend = (g: Kernel, spot: string): void => {
    setStat(g, `fights:${spot}`, SPOTS[spot].fightLimit!);
    recovered(g);
    g.tick();
  };

  it('the floor-1 spot is picked first, and records where the fall was', () => {
    const g = floorThree(90);
    withTarget(g);
    expect(pending(g)).toMatchObject({
      phase: 'fallback',
      target: { spot: 'kr_f3' },
      fallback: { spot: 'f1_storerooms' },
      from: 'kr_f3',
    });
    const h = floorThree(91);
    fallAt(h, 'f3_hearing_room', null, true);
    expect(pending(h)).toMatchObject({ target: null, fallback: { spot: 'f1_storerooms' }, from: 'f3_hearing_room' });
  });

  it('when it is spent, the older floor-2 spot is still under the ceiling (a target)', () => {
    const g = floorThree(92);
    withTarget(g);
    patchKnockout(g, (k) => (k.pendingReturn!.wins = 4));
    const until = pending(g).until;
    spend(g, 'f1_storerooms');
    expect(pending(g)).toMatchObject({
      phase: 'fallback',
      target: { spot: 'kr_f3' },
      fallback: { spot: 'f2_hall_1' },
      wins: 4,
      until,
      from: 'kr_f3',
    });
    spend(g, 'f2_hall_1');
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: 'kr_f3' } });
  });

  it('when it is spent, the older floor-2 spot is still under the ceiling (no target)', () => {
    const g = floorThree(93);
    fallAt(g, 'f3_hearing_room', null, true);
    spend(g, 'f1_storerooms');
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: null, fallback: { spot: 'f2_hall_1' }, from: 'f3_hearing_room' });
    spend(g, 'f2_hall_1');
    expect(ko(g).pendingReturn).toBeNull();
    expect(w(g).activity).toBeNull();
  });

  it('a knockout at the floor-1 fallback picks the floor-2 spot, not a hold', () => {
    const g = floorThree(94);
    withTarget(g);
    fallAt(g, 'f1_storerooms');
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: { spot: 'kr_f3' }, fallback: { spot: 'f2_hall_1' } });
  });

  // The save starts at version 1 here, so no save lacks the field by its
  // version. The rule the old case stood on is kept: a fallback with no
  // `from` picks again from the floor of its target.
  it('a fallback without the field (a v63 save) uses the target’s floor', () => {
    const g = floorThree(95);
    withTarget(g);
    const envelope = JSON.parse(JSON.stringify(g.save(0)));
    expect(envelope.slices.knockout.data.pendingReturn.from).toBe('kr_f3');
    delete envelope.slices.knockout.data.pendingReturn.from;
    const h = game(1);
    expect(h.load(envelope).ok).toBe(true);
    expect(pending(h).from).toBeUndefined();
    expect(pending(h)).toMatchObject({ phase: 'fallback', fallback: { spot: 'f1_storerooms' } });
    spend(h, 'f1_storerooms');
    expect(ko(h).pendingReturn).toMatchObject({ phase: 'fallback', fallback: { spot: 'f2_hall_1' } });
  });

  // The old case also ran migration 63, which only moved the version. The
  // knockout slice is at version 1 and has no migration step.
  it('survives a save with the field set; the migration only moves the version', () => {
    const g = floorThree(96);
    withTarget(g);
    const h = game(1);
    expect(h.load(JSON.parse(JSON.stringify(g.save(0)))).ok).toBe(true);
    expect(pending(h)).toEqual(pending(g));
    expect(pending(h).from).toBe('kr_f3');
    expect(knockout.migrations ?? {}).toEqual({});
    expect(knockout.version).toBe(1);
  });
});

describe('a knockout at a limited fallback', () => {
  /** Wins at the ring (older) and the lane (newer), then five losses at the field: the lane is the fallback. */
  function laneFallback(seed: number): Kernel {
    const g = pocketGame(seed);
    win(g, 'kr_ring');
    later(g, 100);
    win(g, 'kr_lane');
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    expect(pending(g)).toMatchObject({ phase: 'fallback', fallback: { spot: 'kr_lane' } });
    return g;
  }

  it('ends it at once: another limited spot is picked, the wins and the clock carried', () => {
    const g = laneFallback(100);
    patchKnockout(g, (k) => (k.pendingReturn!.wins = 4));
    const until = pending(g).until;
    fallAt(g, 'kr_lane');
    expect(counter(g, 'win:n:kr_lane')).toBeUndefined();
    expect(pending(g)).toMatchObject({
      phase: 'fallback',
      target: { spot: 'kr_field' },
      fallback: { spot: 'kr_ring' },
      wins: 4,
      until,
      from: 'kr_field',
    });
    expect(lines(g)).toContain('Test Lane: knocked out there. Hunting Test Ring.');
  });

  it('with none left, holds on the target at the haven', () => {
    const g = laneFallback(101);
    fallAt(g, 'kr_lane');
    fallAt(g, 'kr_ring');
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: 'kr_field' }, probes: 0 });
    expect(pending(g).until).toBe(totalTicks(g) + holdTicks(0));
    expect(w(g).spot).toBe('kr_camp');
    expect(lines(g)).toContain('Test Ring: knocked out there. No safer hunt known. Retrying Test Field in 10 min.');
  });

  it('with none left and no target, ends the return and idles', () => {
    const g = pocketGame(102, 'kr_den');
    win(g, 'kr_ring');
    later(g, 100);
    win(g, 'kr_lane');
    fallAt(g, 'kr_den', null, true);
    expect(pending(g)).toMatchObject({ target: null, fallback: { spot: 'kr_lane' } });
    fallAt(g, 'kr_lane');
    expect(pending(g)).toMatchObject({ target: null, fallback: { spot: 'kr_ring' } });
    fallAt(g, 'kr_ring');
    expect(ko(g).pendingReturn).toBeNull();
    expect(w(g).activity).toBeNull();
    expect(lines(g)).toContain('Test Ring: knocked out there. No safer hunt known.');
    expect(defeatDialogDue(ko(g))).toBe(true);
  });

  it('a proven fallback is still returned to, and holds only after 5 in a row', () => {
    const g = pocketGame(103);
    setProven(g, { spot: 'kr_meadow', activity: 'hunt' });
    win(g, 'kr_lane');
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, 'kr_field');
    expect(pending(g).fallback).toMatchObject({ spot: 'kr_meadow' });
    fallAt(g, 'kr_meadow');
    expect(pending(g)).toMatchObject({ phase: 'fallback', fallback: { spot: 'kr_meadow' }, target: { spot: 'kr_field' } });
    expect(lines(g)).toContain('Returning to Test Meadow.');
    for (let i = 1; i < STREAK_LIMIT; i++) fallAt(g, 'kr_meadow');
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: 'kr_field' } });
  });
});

// Floor 17 is not here. The same structure on floor 6: the Shrine is the open
// hunt (levels 11 to 12), the Tunnels the roofed hunt (10 to 12), the Drop a
// roofed hunt above the Shrine (11 to 13), the Warren Mouth the haven.
describe('a roofed hunt as the last fallback', () => {
  const OPEN = 'f6_shrine';
  const ROOFED = 'f6_tunnels';
  const HAVEN = 'f6_warren_mouth';
  /** Floor 6's spots as found in a walk in from the landing. */
  const FOUND = [HAVEN, ROOFED, 'f6_pens', 'f6_kitchens', OPEN, 'f6_drop'];

  /** At the open Shrine with `found` on the map and the landing as the haven. */
  function ridge(seed: number, found: string[] = FOUND): Kernel {
    const g = game(seed);
    patchWorld(g, (x) => {
      x.spot = OPEN;
      x.discovered.push(...found);
      x.safeSpots = { nearest: HAVEN, unconditional: HAVEN };
    });
    return g;
  }

  const streak = (g: Kernel, spot = OPEN): void => {
    for (let i = 0; i < STREAK_LIMIT; i++) fallAt(g, spot);
  };

  it('five knockouts at the open ridge with nothing proven go to the lowest-level roofed hunt', () => {
    const g = ridge(110);
    expect(ko(g).proven).toBeNull();
    streak(g);
    expect(pending(g)).toMatchObject({
      phase: 'fallback',
      target: { spot: OPEN, activity: 'hunt' },
      fallback: { spot: ROOFED, activity: 'hunt' },
      from: OPEN,
    });
    expect(lines(g)).toContain(`5 knockouts in a row at ${SPOTS[OPEN].name}. Hunting ${SPOTS[ROOFED].name} for 200 wins.`);
    // The character is not left idle: recovered, it hunts the roofed spot.
    recovered(g);
    tickUntil(g, 50, at(ROOFED, 'hunt'));
    expect(w(g).spot).toBe(ROOFED);
    expect(w(g).activity).toBe('hunt');
  });

  it('a forced-spot loss with no target takes it too', () => {
    const g = ridge(111);
    fallAt(g, OPEN, null, true);
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: null, fallback: { spot: ROOFED } });
  });

  it('takes the lowest level, then the earlier-found spot', () => {
    // The vault (11 to 12) is found first; the cellar and the Tunnels (from 10) follow.
    const g = ridge(112, [HAVEN, 'kr_f6_vault', 'kr_f6_cellar', ROOFED, OPEN]);
    streak(g);
    expect(pending(g).fallback).toMatchObject({ spot: 'kr_f6_cellar' });
  });

  it('skips a spot with a fight budget, an unfound spot and a spot on another floor', () => {
    // Floor 5's roofed hunt is reachable by the ladder with floors 1 to 4 cleared (the Greenwood's
    // setup above), so only the same-floor rule keeps it out.
    const lower = Object.values(SPOTS).find(
      (sp) => sp.areaId === 'ascent_f5_area' && !!sp.tags?.includes('indoor') && !sp.fightLimit && sp.activities.some((a) => a.kind === 'hunt'),
    );
    expect(lower).toBeDefined();
    expect(SPOTS.kr_f6_nest.fightLimit).toBeGreaterThan(0);
    // Found: floor 5, the nest (a fight budget of 1) and the Shrine, with the Warren Mouth (no
    // hunt) as the haven. The Tunnels are not found. The Shrine has no route back from the
    // haven, so the fall is a blocked one, which idles with no pick.
    const g = ridge(113, [HAVEN, 'kr_f6_nest', OPEN]);
    clearFloors(g, ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4']);
    setStat(g, 'gold:earned', 100_000);
    setStat(g, 'kills:tag:goblin', 100);
    discover(g, ...Object.values(SPOTS).filter((sp) => sp.areaId === 'ascent_f5_area').map((sp) => sp.id));
    expect(unlocked(g, 'ascent_f5')).toBe(true);
    const lowerHunt = lower!.activities.find((a) => a.kind === 'hunt')!;
    expect(blockOf(g, { spot: lower!.id, activity: lowerHunt.id })).toBeNull();
    streak(g);
    expect(w(g).spot).toBe(HAVEN);
    expect(ko(g).pendingReturn).toBeNull();
    expect(lines(g)).toContain(`${SPOTS[OPEN].name}: no known route back. No safer hunt known.`);
  });

  it('never picks the spot that was lost at', () => {
    const g = ridge(114, [HAVEN, ROOFED]);
    streak(g, ROOFED);
    // The Tunnels are the only roofed hunt found, and they are the fall.
    expect(pending(g).phase).toBe('hold');
  });

  it('ranks behind a usable proven hunt', () => {
    const g = ridge(115);
    setProven(g, { spot: 'f6_drop', activity: 'hunt' });
    streak(g);
    expect(pending(g).fallback).toMatchObject({ spot: 'f6_drop' });
  });

  it('ranks behind a limited hunt that was won at', () => {
    const g = ridge(116, [...FOUND, 'kr_f6_nest']);
    win(g, 'kr_f6_nest');
    expect(counter(g, 'win:n:kr_f6_nest')).toBe(1);
    patchWorld(g, (x) => (x.spot = OPEN));
    streak(g);
    expect(pending(g).fallback).toMatchObject({ spot: 'kr_f6_nest' });
  });

  it('a knockout at the roofed fallback returns to it; five in a row hold on the target', () => {
    const g = ridge(117);
    streak(g);
    expect(pending(g).fallback).toMatchObject({ spot: ROOFED });
    fallAt(g, ROOFED);
    expect(pending(g)).toMatchObject({
      phase: 'fallback',
      fallback: { spot: ROOFED },
      target: { spot: OPEN },
    });
    expect(lines(g)).toContain(`Returning to ${SPOTS[ROOFED].name}.`);
    for (let i = 1; i < STREAK_LIMIT; i++) fallAt(g, ROOFED);
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: OPEN } });
  });

  it('a floor with no roofed hunt still holds', () => {
    const g = pocketGame(118);
    streak(g, 'kr_field');
    expect(pending(g).phase).toBe('hold');
  });

  it('a roofed fallback lost again and again doubles the hold: 10, 20, 40, 80 minutes', () => {
    const g = ridge(130);
    const waits: number[] = [];
    streak(g);
    for (let round = 0; round < 4; round++) {
      expect(pending(g)).toMatchObject({ phase: 'fallback', fallback: { spot: ROOFED } });
      // Five in a row at the roofed spot the first time; the streak stays reached after that.
      for (let i = 0; i < (round === 0 ? STREAK_LIMIT : 1); i++) fallAt(g, ROOFED);
      expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: OPEN }, probes: round });
      waits.push((pending(g).until! - totalTicks(g)) / (60 * TPS));
      // The wait is over, the probe is at the Shrine, and the Shrine loses again.
      recovered(g);
      setTotalTicks(g, pending(g).until! - 1);
      g.tick();
      expect(pending(g).phase).toBe('return');
      fallAt(g, OPEN);
    }
    expect(waits).toEqual([10, 20, 40, 80]);
  });

  it('a spot whose top level is above the fall spot is not a fallback', () => {
    const top = (id: string): number => Math.max(...SPOTS[id].encounters!.map((e) => e.level[1]));
    // The picks above are legal: the Tunnels are no harder than the Shrine.
    expect(top(ROOFED)).toBeLessThanOrEqual(top(OPEN));
    // Lower the Shrine under every roofed hunt on the floor: none is the answer to a loss there.
    const rows = SPOTS[OPEN].encounters!;
    const saved = rows.map((e) => e.level);
    for (const e of rows) e.level = [1, 1];
    try {
      const g = ridge(131);
      streak(g);
      expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: OPEN } });
      expect(pending(g).fallback).toBeUndefined();
    } finally {
      rows.forEach((e, i) => (e.level = saved[i]));
    }
  });
});

// Floor 10 is not here. The same structure on floor 6: the Tunnels are the
// spot lost at, the Drop the roofed hunt one level above it.
describe('a roofed fallback is never harder than the spot that was lost at', () => {
  const ROW = 'f6_tunnels';
  const MINE = 'f6_drop';
  const HAVEN = 'f6_warren_mouth';

  /** At the Tunnels, the haven at the Warren Mouth, the Drop and the road to it found. */
  function row(seed: number): Kernel {
    const g = game(seed);
    patchWorld(g, (x) => {
      x.spot = ROW;
      x.discovered.push(HAVEN, ROW, 'f6_shrine', MINE);
      x.safeSpots = { nearest: HAVEN, unconditional: HAVEN };
    });
    return g;
  }

  it('the Mine is a roofed hunt one level above the Row', () => {
    expect(SPOTS[MINE].tags).toContain('indoor');
    const top = (id: string): number => Math.max(...SPOTS[id].encounters!.map((e) => e.level[1]));
    expect(top(MINE)).toBeGreaterThan(top(ROW));
  });

  it('five knockouts at the Row hold; they do not go to the Mine, and the holds double', () => {
    const g = row(140);
    const waits: number[] = [];
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < (round === 0 ? STREAK_LIMIT : 1); i++) fallAt(g, ROW);
      expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: ROW } });
      expect(pending(g).fallback).toBeUndefined();
      waits.push((pending(g).until! - totalTicks(g)) / (60 * TPS));
      recovered(g);
      setTotalTicks(g, pending(g).until! - 1);
      g.tick(); // the wait is over: the probe
      expect(pending(g).phase).toBe('return');
    }
    expect(waits).toEqual([10, 20, 40, 80, 80]);
    expect(lines(g)).not.toContain(`5 knockouts in a row at ${SPOTS[ROW].name}. Hunting ${SPOTS[MINE].name} for 200 wins.`);
  });
});

// The harbor waters and the roadstead are step 4 content, and no road in
// scope is forced. The same structure in the pocket world: `kr_pit` is a
// plain hunt behind a forced road, `kr_roadstead` one with a single fight.
describe('a hunt behind a forced road with nothing to fall back to', () => {
  interface Water {
    spot: string;
    haven: string;
  }
  const WATERS: Water[] = [
    { spot: 'kr_pit', haven: 'kr_camp' },
    { spot: 'kr_roadstead', haven: 'kr_camp' },
  ];

  /** At the water, its haven and the road to it found, nothing else known. */
  function sailor(seed: number, water: Water): Kernel {
    const g = game(seed);
    patchWorld(g, (x) => {
      x.spot = water.spot;
      x.discovered.push(water.haven, 'kr_gate', water.spot);
      x.safeSpots = { nearest: water.haven, unconditional: water.haven };
    });
    return g;
  }

  /** The wait is over: the probe sets out and the boarding fight opens at `spot`. */
  function sailBack(g: Kernel, spot: string): void {
    recovered(g);
    setTotalTicks(g, pending(g).until! - 1);
    tickUntil(g, 600, (s) => !!s.combat.fight);
    expect(w(g).spot).toBe(spot);
    expect(fight(g)?.forced).toBe(true);
  }

  /** The boarding is won. The old `state.combat = null` and the `fight:won` event. */
  function boardingWon(g: Kernel, spot: string): void {
    dropFight(g);
    emit(g, fightWon, { site: spot, forced: true });
  }

  it.each(WATERS)('$spot: the fall holds 10 min, sails the road again and hunts', (water) => {
    const g = sailor(200, water);
    // The water is the proven hunt, which is never its own fallback.
    setProven(g, { spot: water.spot, activity: 'hunt' });
    fallAt(g, water.spot);
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: water.spot, activity: 'hunt' }, probes: 0 });
    expect(pending(g).until).toBe(totalTicks(g) + holdTicks(0));
    expect(lines(g)).toContain(`No safer hunt known. Retrying ${SPOTS[water.spot].name} in 10 min.`);
    expect(w(g).activity).toBeNull();

    sailBack(g, water.spot);
    boardingWon(g, water.spot);
    expect(pending(g).phase).toBe('return'); // the boarding is not the hunt
    g.tick();
    expect(w(g).spot).toBe(water.spot);
    expect(w(g).activity).toBe('hunt');
    // The first hunt win ends the return.
    win(g, water.spot);
    expect(ko(g).pendingReturn).toBeNull();
  });

  it.each(WATERS)('$spot: a boarding fight lost with no activity holds the same way', (water) => {
    const g = sailor(201, water);
    fallAt(g, water.spot, null, true);
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: water.spot, activity: 'hunt' }, probes: 0 });
  });

  it('a boarding that keeps being lost doubles the wait: 10, 20, 40, 80, 80 minutes', () => {
    const water = WATERS[0];
    const g = sailor(202, water);
    fallAt(g, water.spot, null, true);
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      expect(pending(g).phase).toBe('hold');
      waits.push((pending(g).until! - totalTicks(g)) / (60 * TPS));
      sailBack(g, water.spot);
      fallAt(g, water.spot, null, true);
    }
    expect(waits).toEqual([10, 20, 40, 80, 80]);
    expect(pending(g).probes).toBe(5);
  });

  it('the walk to a target may take the road; a fallback never does', () => {
    const water = WATERS[0];
    const g = sailor(203, water);
    patchWorld(g, (x) => (x.spot = water.haven));
    const goal = { spot: water.spot, activity: 'hunt' };
    expect(blockOf(g, goal)).toBe('forced_road');
    expect(blockOf(g, goal, true)).toBeNull();
  });

  it('a pocket pit behind a forced road: hold, sail again, hunt', () => {
    const g = pocketGame(204, 'kr_pit');
    fallAt(g, 'kr_pit');
    expect(pending(g)).toMatchObject({ phase: 'hold', target: { spot: 'kr_pit', activity: 'hunt' }, probes: 0 });
    expect(lines(g)).toContain('No safer hunt known. Retrying Test Pit in 10 min.');
    sailBack(g, 'kr_pit');
    boardingWon(g, 'kr_pit');
    g.tick();
    expect(w(g).activity).toBe('hunt');
  });

  it('a boss door is not sailed into again: it falls back where a fallback exists', () => {
    // The test door: a boss line behind a forced road out of the Tunnels.
    const g = game(205);
    patchWorld(g, (x) => {
      x.spot = 'kr_f6_door';
      x.discovered.push('f6_warren_mouth', 'f6_tunnels', 'kr_f6_door');
      x.safeSpots = { nearest: 'f6_warren_mouth', unconditional: 'f6_warren_mouth' };
    });
    expect(SPOTS.kr_f6_door.encounters!.some((e) => e.boss)).toBe(true);
    patchWorld(g, (x) => (x.spot = 'f6_warren_mouth'));
    const goal = { spot: 'kr_f6_door', activity: 'hunt' };
    expect(blockOf(g, goal)).toBe('forced_road');
    expect(blockOf(g, goal, true)).toBe('forced_road');
    fallAt(g, 'kr_f6_door');
    // The lowest-level roofed hunt on the floor, and no target to come back to.
    expect(pending(g)).toMatchObject({ phase: 'fallback', target: null, fallback: { spot: 'f6_tunnels' } });
    expect(lines(g)).toContain(`${SPOTS.kr_f6_door.name}: forced road in, not re-entered. Hunting ${SPOTS.f6_tunnels.name} for 200 wins.`);
  });

  it('a boss row behind a forced road is one fight to be chosen: with nothing to fall back to, it idles', () => {
    const g = pocketGame(206, 'kr_pit');
    const pit = SPOTS.kr_pit;
    const saved = pit.encounters;
    pit.encounters = [{ monsterId: 'forest_rat', weight: 1, boss: true, level: [1, 1] }];
    try {
      fallAt(g, 'kr_pit');
      expect(ko(g).pendingReturn).toBeNull();
      expect(w(g).activity).toBeNull();
      expect(lines(g)).toContain('Test Pit: forced road in, not re-entered. No safer hunt known.');
    } finally {
      pit.encounters = saved;
    }
  });
});

// New here (spine port 6).
describe('determinism of a knockout and its return', () => {
  const start = (): Kernel => {
    const g = pocketGame(303, 'kr_hopeless');
    select(g, 'hunt');
    return g;
  };

  /** A new kernel with another seed, loaded from the save of `g`. */
  const resumed = (g: Kernel): Kernel => {
    const h = game(1);
    expect(h.load(JSON.parse(JSON.stringify(g.save(0)))).ok).toBe(true);
    return h;
  };

  it('a run split by a save and a load in the recovery and again in the walk back equals the whole run', () => {
    // A scouting run finds the ticks of the knockout, of the end of the recovery and of the arrival.
    const scout = start();
    let down = 0;
    let up = 0;
    let back = 0;
    for (let t = 1; t <= 8000 && !back; t++) {
      scout.tick();
      const s = st(scout);
      if (!down && s.world.recovering) down = t;
      else if (down && !up && !s.world.recovering) up = t;
      else if (up && s.world.spot === 'kr_hopeless' && s.world.activity === 'hunt') back = t;
    }
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(down + 10);
    expect(back).toBeGreaterThan(up + 4);
    const inRecovery = down + Math.floor((up - down) / 2);
    const inWalk = up + Math.floor((back - up) / 2);
    const total = back + 200;

    const whole = start();
    whole.tick(total);

    const first = start();
    first.tick(inRecovery);
    expect(w(first).recovering).toBe(true);
    expect(pending(first).phase).toBe('return');
    const second = resumed(first);
    second.tick(inWalk - inRecovery);
    expect(w(second).travel).not.toBeNull();
    const third = resumed(second);
    third.tick(total - inWalk);

    expect(third.snapshot()).toEqual(whole.snapshot());
    // The run did what the case is about: one knockout at least, and the hunt resumed.
    expect(counter(whole, 'ko:n:kr_hopeless') ?? 0).toBeGreaterThanOrEqual(1);
    expect(whole.staleStats()).toEqual([]);
  });
});
