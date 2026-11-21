/**
 * Port of the old `tests/wards.test.ts` (32 cases): band 3's ward engine.
 * Ward positions (`band:pos:<floor>`), clear stamps (`stampOnClear`), kept
 * wounds (`keepsWounds`), ward windows, the save migration and the content
 * lints. The cases keep their old names.
 *
 * As in the old file, these run on fixtures: a window pushed into
 * `WARD_WINDOWS` for the test, `keepsWounds` and `stampOnClear` set on floor
 * 1's Vermin Hall and its rats, each restored after. The system reads
 * `WARD_WINDOWS` live, so the fixture window runs through the real tick.
 *
 * Call shape changes:
 * - `createInitialState(seed, spot)` and `new Game(...)` are `gameAt`.
 *   `state.stats[key] = n` is `setCounters`; `s.prestige.purchases` is
 *   written through `patch`.
 * - `checkFloorClears(state, bus)` and `syncBandPositions(state, bus)` are
 *   the event `ladder/check`.
 * - `tickWards(state, bus, false)` runs `tickWards` with a real context (the
 *   probe's), so it reads the counters and emits as the system does.
 * - `sweepDead` after `hp = 0` is a patch of the fight and the request
 *   `combat/sweep`. `g.selectActivity`, `g.travelTo` and `g.climbTo` are the
 *   world commands and the request `world/travel`.
 * - `startStagedGroup` is the request `combat/start-staged` (`stage`).
 * - `statsFromAttrs(m.attrs).maxHp` is `monsterStatsFromAttrs(m.attrs).maxHp`.
 * - `runOfflineProgress` is `catchUp` from the kernel and a load of its
 *   envelope.
 * - The bus `log` listener is `kernel.onEvent` on `log/line`.
 * - A test boon is pushed into `PRESTIGE_BOON_LIST`, which the band-pass read
 *   walks, and removed after.
 * - "a save taken mid-fight": the old save dropped the fight and wrote the
 *   wounds the fight held (`woundsForSave`). The save here holds the fight
 *   (decision of spine port 4), so the save writes no wound counter and the
 *   reloaded game holds the same fight; the wounds are written when that
 *   fight closes. The case checks that instead.
 *
 * `it.todo`:
 * - "a save that cleared wards before positions existed": there is no
 *   importer of the old save, and a position is written with every clear.
 * - "a bonus-time tick ...": bonus time is a step 4 port.
 * - the save migration v59 to v60: no importer of the old save.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { catchUp, type Ctx, type GameEvent, type Kernel } from '../src/kernel';
import { systems } from '../src/systems';
import type { ClockState } from '../src/systems/clock';
import { KEPT_WOUND_CAP, liveEnemies, sweepRequest, type Enemy } from '../src/systems/combat';
import type { CountersState } from '../src/systems/counters';
import { bandPosKey, checkClears, clearSpotIds, FLOORS, floorCleared, type FloorDef } from '../src/systems/ladder';
import { logLine } from '../src/systems/log';
import { MONSTERS } from '../src/systems/monsters';
import { PRESTIGE_BOON_LIST, PRESTIGE_BOONS, prestigeNow, type PrestigeBoonDef, type PrestigeState } from '../src/systems/prestige';
import { monsterStatsFromAttrs } from '../src/systems/stats';
import { climb, selectActivity, SPOTS, type SpotDef } from '../src/systems/world';
import {
  tickWards,
  WARD_WINDOWS,
  wardClockKey,
  wardContentIssues,
  wardStatKeys,
  type WardsState,
  type WardWindowDef,
} from '../src/systems/wards';
import { combatOf, frontEnemy, patchFight, SITES, spawn, stage } from './combatHelpers';
import { emit, makeGame, patch, probe, run, slice } from './helpers';
import { gameAt, hop, ladderOf, patchWorld, setCounters } from './worldHelpers';

const WARDS = ['ascent_f7', 'ascent_f8', 'ascent_f9', 'ascent_f10'];
const HALL = 'f1_storerooms';
const RAT = 'forest_rat';
const FOOT = 'ascent_foot';
const TO_PRESTIGE = ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6'];

/** A counter as stored: `undefined` when never set or cleared. */
const stat = (k: Kernel, key: string): number | undefined => slice<CountersState>(k, 'counters').counts[key];

/** Set the counters each floor's `clear` reads, as if the player had cleared it. The old fixture `clearFloors`. */
function clearFloors(k: Kernel, floorIds: string[] = TO_PRESTIGE): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) {
      if (c.type === 'stat') values[c.key] = Math.max(stat(k, c.key) ?? 0, c.value);
    }
  }
  setCounters(k, values);
}

function buyBoons(k: Kernel, ranks: Record<string, number>): void {
  patch(k, (slices) => Object.assign((slices.prestige as PrestigeState).purchases, ranks));
}

/** Floors 1-6 cleared and the city key owned: the city is open. */
function cityOpen(spot = FOOT): Kernel {
  const k = gameAt(0, spot);
  setCounters(k, { 'flag:tutorial_done': 1 });
  clearFloors(k);
  buyBoons(k, { city_key: 1 });
  return k;
}

/** A new game standing at a spot, past the tutorial. */
function freshAt(seed: number, spot: string): Kernel {
  const k = gameAt(seed, spot);
  setCounters(k, { 'flag:tutorial_done': 1 });
  return k;
}

const check = (k: Kernel): void => emit(k, checkClears, undefined);

const pos = (k: Kernel, floorId: string): number => stat(k, bandPosKey(floorId)) ?? 0;

/** Hunt the Vermin Hall until a rat fight starts; returns the rat. */
function ratFight(g: Kernel): Enemy {
  patchWorld(g, (w) => {
    w.spot = HALL;
    if (!w.discovered.includes(HALL)) w.discovered.push(HALL);
  });
  patchFight(g, (c) => {
    c.respawnTimer = 0;
  });
  g.dispatch(selectActivity({ activity: 'hunt' }));
  for (let i = 0; i < 50 && !combatOf(g).fight; i++) g.tick();
  const rat = liveEnemies(combatOf(g).fight!).find((e) => e.defId === RAT);
  expect(rat, 'a rat fight started').toBeTruthy();
  return rat as Enemy;
}

/** Take the front enemy down through the real kill path. */
function killFront(g: Kernel): void {
  patchFight(g, (c) => {
    c.fight!.enemies[0]!.hp = 0;
  });
  run(g, (ctx) => ctx.request(sweepRequest, undefined));
}

/** Set the front enemy's HP. Returns it as it now stands. */
function setFrontHp(g: Kernel, hp: number): Enemy {
  patchFight(g, (c) => {
    c.fight!.enemies[0]!.hp = hp;
  });
  return frontEnemy(g);
}

const maxHpOf = (m: Pick<Enemy, 'attrs'>) => monsterStatsFromAttrs(m.attrs).maxHp;

const walkAway = (g: Kernel) => g.dispatch(selectActivity({ activity: null }));

/** The old `tickWards(state, bus, false)`: the window step alone, with a real context. */
const wardStep = (g: Kernel) => run(g, (ctx) => tickWards(ctx as Ctx<WardsState>));

// ---------- Ward positions ----------

describe('ward positions (band:pos:<floor>)', () => {
  it('are live while a ward is uncleared and frozen at its clear', () => {
    const k = cityOpen();
    check(k);
    for (const id of WARDS) expect(pos(k, id), id).toBe(0);

    clearFloors(k, ['ascent_f8']);
    check(k);
    expect([pos(k, 'ascent_f7'), pos(k, 'ascent_f8'), pos(k, 'ascent_f9'), pos(k, 'ascent_f10')]).toEqual([1, 0, 1, 1]);

    clearFloors(k, ['ascent_f9']);
    check(k);
    expect([pos(k, 'ascent_f7'), pos(k, 'ascent_f8'), pos(k, 'ascent_f9'), pos(k, 'ascent_f10')]).toEqual([2, 0, 1, 2]);

    clearFloors(k, ['ascent_f10']);
    check(k);
    expect([pos(k, 'ascent_f7'), pos(k, 'ascent_f8'), pos(k, 'ascent_f9'), pos(k, 'ascent_f10')]).toEqual([3, 0, 1, 2]);

    clearFloors(k, ['ascent_f7']);
    check(k);
    expect(pos(k, 'ascent_f7')).toBe(3);
  });

  it('a ward cleared first stays at position 0 while the others fall', () => {
    // Its later forms are gated on the position, so they never reopen.
    const k = cityOpen();
    clearFloors(k, ['ascent_f7']);
    check(k);
    for (const id of ['ascent_f8', 'ascent_f9', 'ascent_f10']) {
      clearFloors(k, [id]);
      check(k);
      expect(pos(k, 'ascent_f7')).toBe(0);
    }
  });

  it('two wards cleared between one check and the next freeze at the same count', () => {
    const k = cityOpen();
    clearFloors(k, ['ascent_f8', 'ascent_f9']);
    check(k);
    expect(pos(k, 'ascent_f8')).toBe(0);
    expect(pos(k, 'ascent_f9')).toBe(0);
    expect(pos(k, 'ascent_f7')).toBe(2);
    expect(pos(k, 'ascent_f10')).toBe(2);
  });

  it.todo(
    'a save that cleared wards before positions existed reads them on load and on import (no importer of the old save; a position is written with every clear)',
  );

  it('prestige wipes them: the new run reads 0 everywhere', () => {
    const k = cityOpen();
    clearFloors(k, ['ascent_f8', 'ascent_f9', 'ascent_f10']);
    check(k);
    expect(pos(k, 'ascent_f7')).toBe(3);
    expect(k.dispatch(prestigeNow()).ok).toBe(true);
    for (const id of WARDS) expect(stat(k, bandPosKey(id)), id).toBeUndefined();
  });

  it('lower band passes move nothing; a pass on the band freezes every position where it stands', () => {
    const k = gameAt(0, FOOT);
    buyBoons(k, { pass_lower: 1, pass_wilds: 1, city_key: 1 });
    check(k);
    for (const id of WARDS) expect(pos(k, id), id).toBe(0);

    clearFloors(k, ['ascent_f8']);
    check(k);
    expect(pos(k, 'ascent_f7')).toBe(1);
    const testPass = {
      ...PRESTIGE_BOONS.pass_wilds,
      id: 'test_pass_city',
      effect: { ...PRESTIGE_BOONS.pass_wilds.effect, kind: 'bandPass', bandId: 'ascent_upper' },
    } as PrestigeBoonDef;
    PRESTIGE_BOON_LIST.push(testPass);
    PRESTIGE_BOONS.test_pass_city = testPass;
    try {
      buyBoons(k, { test_pass_city: 1 });
      clearFloors(k, ['ascent_f9']);
      check(k);
      expect([pos(k, 'ascent_f7'), pos(k, 'ascent_f9'), pos(k, 'ascent_f10')]).toEqual([1, 1, 1]);
    } finally {
      PRESTIGE_BOON_LIST.splice(PRESTIGE_BOON_LIST.indexOf(testPass), 1);
      delete PRESTIGE_BOONS.test_pass_city;
    }
  });
});

// ---------- M10: stampOnClear ----------

describe('a spot stamps its clear (stampOnClear)', () => {
  const stamp = 'test:hall:done';
  beforeEach(() => {
    SPOTS[HALL].stampOnClear = stamp;
  });
  afterEach(() => {
    delete SPOTS[HALL].stampOnClear;
  });

  it('writes 1 the moment the fight budget is spent, not before', () => {
    const g = freshAt(1, HALL);
    setCounters(g, { [`fights:${HALL}`]: 4 });
    ratFight(g);
    killFront(g);
    expect(stat(g, `fights:${HALL}`)).toBe(5);
    expect(stat(g, stamp)).toBeUndefined();
    ratFight(g);
    killFront(g);
    expect(stat(g, `fights:${HALL}`)).toBe(6);
    expect(stat(g, stamp)).toBe(1);
  });

  it('once: a stamp another spot already wrote is left as it is', () => {
    const g = freshAt(2, HALL);
    setCounters(g, { [`fights:${HALL}`]: 5, [stamp]: 2 });
    ratFight(g);
    killFront(g);
    expect(stat(g, `fights:${HALL}`)).toBe(6);
    expect(stat(g, stamp)).toBe(2);
  });
});

// ---------- M11: keepsWounds ----------

describe('a monster keeps its wounds (keepsWounds)', () => {
  const key = 'test:rat:wounds';
  beforeEach(() => {
    MONSTERS[RAT].keepsWounds = { key, share: 0.5 };
  });
  afterEach(() => {
    delete MONSTERS[RAT].keepsWounds;
  });

  function hurtRat(seed: number): { g: Kernel; rat: Enemy; expected: number } {
    const g = freshAt(seed, HALL);
    const first = ratFight(g);
    const rat = setFrontHp(g, Math.round(maxHpOf(first) * 0.4));
    return { g, rat, expected: 0.5 * (1 - rat.hp / maxHpOf(rat)) };
  }

  it('walking away (an activity switch) writes share × the share of max HP it is missing', () => {
    const { g, expected } = hurtRat(3);
    walkAway(g);
    expect(combatOf(g).fight).toBeNull();
    expect(stat(g, key)).toBeCloseTo(expected, 10);
  });

  it('travel and the ladder write it too', () => {
    const walk = hurtRat(4);
    expect(hop(walk.g, 'f1_landing')).toBe(true);
    expect(stat(walk.g, key)).toBeCloseTo(walk.expected, 10);

    const ride = hurtRat(5);
    expect(ride.g.dispatch(climb({ floor: null })).ok).toBe(true);
    expect(combatOf(ride.g).fight).toBeNull();
    expect(stat(ride.g, key)).toBeCloseTo(ride.expected, 10);
  });

  it('a knockout writes it', () => {
    const g = freshAt(6, HALL);
    const [first] = stage(g, [{ monsterId: RAT, level: 60 }], SITES[HALL]);
    let rat = setFrontHp(g, Math.round(maxHpOf(first) * 0.5));
    for (let i = 0; i < 5000 && combatOf(g).fight; i++) {
      g.tick();
      const live = combatOf(g).fight?.enemies.find((e) => e?.entity === first.entity);
      if (live) rat = live;
    }
    expect(combatOf(g).lastFight?.outcome).toBe('knocked_out');
    expect(stat(g, key)).toBeCloseTo(0.5 * (1 - rat.hp / maxHpOf(rat)), 10);
  });

  it('a save taken mid-fight holds the fight; the wounds are written when it closes', () => {
    const { g, expected } = hurtRat(7);
    const envelope = g.save(0);
    const counts = (envelope.slices.counters.data as unknown as CountersState).counts;
    expect(counts[key]).toBeUndefined();
    expect(stat(g, key)).toBeUndefined();
    expect(combatOf(g).fight).not.toBeNull();
    const reloaded = makeGame();
    expect(reloaded.load(JSON.parse(JSON.stringify(envelope))).ok).toBe(true);
    expect(combatOf(reloaded).fight).toEqual(combatOf(g).fight);
    walkAway(reloaded);
    expect(stat(reloaded, key)).toBeCloseTo(expected, 10);
  });

  it('the next spawn starts that much lower, and never at or under 0', () => {
    const g = freshAt(8, HALL);
    setCounters(g, { [key]: 0.3 });
    const a = spawn(g, HALL, { monsterId: RAT, level: 1 });
    expect(a.hp).toBe(Math.max(1, Math.round(maxHpOf(a) * 0.7)));
    setCounters(g, { [key]: 5 });
    const b = spawn(g, HALL, { monsterId: RAT, level: 1 });
    expect(b.hp).toBe(Math.max(1, Math.round(maxHpOf(b) * (1 - KEPT_WOUND_CAP))));
    expect(b.hp).toBeGreaterThanOrEqual(1);
  });

  it('is held to the cap', () => {
    MONSTERS[RAT].keepsWounds = { key, share: 1 };
    const g = freshAt(9, HALL);
    ratFight(g);
    setFrontHp(g, 1);
    walkAway(g);
    expect(stat(g, key)).toBe(KEPT_WOUND_CAP);
  });

  it('keeps every earlier wound, and adds share × only what this fight took', () => {
    const g = freshAt(11, HALL);
    setCounters(g, { [key]: 0.3 });
    // Untouched: it leaves as hurt as it came in, never healed by a retreat.
    ratFight(g);
    walkAway(g);
    expect(stat(g, key)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(stat(g, key)).toBeLessThan(0.31);
    // Hurt to 40% of max: of the missing share, 0.3 was old; keeps old + 0.5 × the rest.
    const before = stat(g, key)!;
    const first = ratFight(g);
    const rat = setFrontHp(g, Math.round(maxHpOf(first) * 0.4));
    const missing = 1 - rat.hp / maxHpOf(rat);
    walkAway(g);
    expect(stat(g, key)).toBeCloseTo(before + 0.5 * (missing - before), 10);
  });

  it('its death deletes the stat', () => {
    const g = freshAt(10, HALL);
    setCounters(g, { [key]: 0.3 });
    ratFight(g);
    killFront(g);
    expect(combatOf(g).fight).toBeNull();
    expect(stat(g, key)).toBeUndefined();
  });
});

// ---------- M12: ward windows ----------

describe('ward windows', () => {
  const W: WardWindowDef = {
    id: 'test_window',
    floorId: 'ascent_f7',
    position: 3,
    ticks: 20,
    spotId: HALL,
    monsterId: RAT,
    doneKey: 'test:w:done',
    atKey: 'test:w:at',
    goneKey: 'test:w:gone',
    foughtKey: 'test:w:fought',
    flags: { fought: 'flag:test:w:fought', unmet: 'flag:test:w:unmet' },
  };
  const clock = wardClockKey(W);
  const windows = WARD_WINDOWS as WardWindowDef[];
  let savedClear: FloorDef['clear'];

  beforeEach(() => {
    windows.push(W);
    savedClear = FLOORS[W.floorId].clear;
    FLOORS[W.floorId].clear = [{ type: 'stat', key: W.doneKey, value: 1 }];
  });
  afterEach(() => {
    windows.splice(windows.indexOf(W), 1);
    FLOORS[W.floorId].clear = savedClear;
    delete SPOTS[HALL].stampOnClear;
  });

  /** Wards 8-10 cleared, so ward 7 sits at position 3; idle at the Foot. */
  function lastWardLeft(): Kernel {
    const g = cityOpen();
    clearFloors(g, ['ascent_f8', 'ascent_f9', 'ascent_f10']);
    check(g);
    return g;
  }

  /** Exactly one flag or none, and which. */
  const flags = (g: Kernel) => [W.flags.fought, W.flags.unmet].filter((k) => (stat(g, k) ?? 0) >= 1);

  it('opens when the ward reaches its position, not before', () => {
    const g = cityOpen();
    clearFloors(g, ['ascent_f8', 'ascent_f9']);
    check(g);
    g.tick();
    expect(stat(g, W.atKey)).toBeUndefined();
    clearFloors(g, ['ascent_f10']);
    check(g);
    g.tick();
    expect(stat(g, W.atKey)).toBe(slice<ClockState>(g, 'clock').totalTicks);
  });

  it('never opens on a ward already cleared', () => {
    const g = lastWardLeft();
    setCounters(g, { [W.doneKey]: 1 });
    g.tick();
    expect(stat(g, W.atKey)).toBeUndefined();
  });

  it('lapses unmet after its ticks of play: the ward is cleared, one silent flag', () => {
    // No clear XP for the ward here, so the lapse tick's only log line is the
    // city's "every floor cleared": nothing names the flag.
    const xp = FLOORS[W.floorId].clearXp;
    delete FLOORS[W.floorId].clearXp;
    try {
      const g = lastWardLeft();
      g.tick();
      expect(stat(g, W.atKey)).toBeDefined();
      for (let i = 0; i < W.ticks - 1; i++) g.tick();
      expect(stat(g, W.doneKey)).toBeUndefined();
      const logs: string[] = [];
      g.onEvent((e: GameEvent) => {
        if (e.type === logLine.type) logs.push((e.payload as { msg: string }).msg);
      });
      g.tick();
      expect(stat(g, clock)).toBe(W.ticks);
      expect(stat(g, W.goneKey)).toBe(1);
      expect(stat(g, W.doneKey)).toBe(1);
      expect(flags(g)).toEqual([W.flags.unmet]);
      expect(floorCleared(ladderOf(g), FLOORS[W.floorId])).toBe(true);
      expect(stat(g, 'cleared:band:ascent_upper')).toBe(1);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('The City');
      // Nothing more happens to it.
      for (let i = 0; i < 50; i++) g.tick();
      expect(flags(g)).toEqual([W.flags.unmet]);
    } finally {
      FLOORS[W.floorId].clearXp = xp;
    }
  });

  it('a fight that hurt the threat and was walked away from lapses as fought', () => {
    const g = lastWardLeft();
    g.tick();
    ratFight(g);
    for (let i = 0; i < 500 && combatOf(g).fight && frontEnemy(g).lastHit === undefined; i++) g.tick();
    expect(combatOf(g).fight, 'the rat is still standing').not.toBeNull();
    expect(frontEnemy(g).lastHit, 'the player landed a hit').toBeDefined();
    walkAway(g);
    expect(stat(g, W.foughtKey)).toBe(1);
    for (let i = 0; i < W.ticks && !stat(g, W.doneKey); i++) g.tick();
    expect(stat(g, W.goneKey)).toBe(1);
    expect(flags(g)).toEqual([W.flags.fought]);
  });

  it('walking in and straight out marks nothing', () => {
    const g = lastWardLeft();
    g.tick();
    ratFight(g);
    walkAway(g);
    expect(stat(g, W.foughtKey)).toBeUndefined();
    for (let i = 0; i < W.ticks && !stat(g, W.doneKey); i++) g.tick();
    expect(flags(g)).toEqual([W.flags.unmet]);
  });

  it('killed in the window: the stamp clears the ward and no flag is set', () => {
    SPOTS[HALL].stampOnClear = W.doneKey;
    const g = lastWardLeft();
    g.tick();
    setCounters(g, { [`fights:${HALL}`]: 5 });
    ratFight(g);
    killFront(g);
    expect(stat(g, W.doneKey)).toBe(1);
    for (let i = 0; i < W.ticks + 5; i++) g.tick();
    expect(stat(g, W.goneKey)).toBeUndefined();
    expect(flags(g)).toEqual([]);
  });

  it('a fight with the threat live at the lapse is waited out', () => {
    const g = lastWardLeft();
    g.tick();
    setCounters(g, { [clock]: W.ticks - 1 });
    ratFight(g);
    wardStep(g);
    wardStep(g);
    expect(stat(g, clock)).toBe(W.ticks);
    expect(stat(g, W.doneKey)).toBeUndefined();
    // Walked away unhurt: the next tick lapses it, unmet.
    walkAway(g);
    wardStep(g);
    expect(flags(g)).toEqual([W.flags.unmet]);
  });

  it('a kill in the waited-out fight sets no flag', () => {
    SPOTS[HALL].stampOnClear = W.doneKey;
    const g = lastWardLeft();
    g.tick();
    setCounters(g, { [clock]: W.ticks, [`fights:${HALL}`]: 5 });
    ratFight(g);
    wardStep(g);
    expect(stat(g, W.doneKey)).toBeUndefined();
    killFront(g);
    wardStep(g);
    expect(stat(g, W.doneKey)).toBe(1);
    expect(stat(g, W.goneKey)).toBeUndefined();
    expect(flags(g)).toEqual([]);
  });

  it('offline catch-up does not run the clock; play does', () => {
    const g = lastWardLeft();
    g.tick();
    setCounters(g, { [clock]: 5 });
    // Ten minutes away (the old `runOfflineProgress(g, 10 * 60 * 1000)`).
    const ticks = 6000;
    expect(ticks).toBeGreaterThan(W.ticks);
    const caught = catchUp({ systems: [...systems, probe], envelope: g.save(0), ticks, now: 0 });
    expect(g.load(caught).ok).toBe(true);
    expect(stat(g, clock)).toBe(5);
    expect(stat(g, W.doneKey)).toBeUndefined();
    for (let i = 0; i < W.ticks - 5; i++) g.tick();
    expect(flags(g)).toEqual([W.flags.unmet]);
  });

  it.todo('a bonus-time tick is a second advance and counts twice, travel included (step 4: bonus time)');
});

// ---------- Save migration v59 → v60 ----------

describe('save migration v59 → v60', () => {
  it.todo('a skeleton keeper killed keeps its ward cleared under the new clears (no importer of the old save)');
});

// ---------- The lints, on fixtures ----------

describe('ward lints', () => {
  const bands = { city: { id: 'city', order: 'any' }, low: { id: 'low', order: 'sequence' } };
  const floors = {
    w1: { id: 'w1', bandId: 'city', areaId: 'a1', clear: [{ type: 'stat', key: 'w1:done' }] },
    w2: { id: 'w2', bandId: 'city', areaId: 'a2', clear: [{ type: 'stat', key: 'x' }] },
    s1: { id: 's1', bandId: 'low', areaId: 'a3', clear: [{ type: 'stat', key: 'y' }] },
  };
  const spot = (id: string, areaId: string, extra: Partial<SpotDef> = {}) =>
    ({ id, areaId, fightLimit: 1, encounters: [{ monsterId: 'demon', weight: 1, level: [1, 1] }], ...extra }) as SpotDef;
  const spots = {
    camp: spot('camp', 'a1', { stampOnClear: 'w1:done' }),
    elsewhere: spot('elsewhere', 'a2', { stampOnClear: 'w1:done' }),
    loose: spot('loose', 'a2', { fightLimit: undefined, stampOnClear: 'z' }),
  };
  const monsters = { demon: {}, bad: { keepsWounds: { key: 'k', share: 0 } }, big: { keepsWounds: { key: 'k2', share: 1.5 } } };
  const good: WardWindowDef = {
    id: 'ok',
    floorId: 'w1',
    position: 1,
    ticks: 10,
    spotId: 'camp',
    monsterId: 'demon',
    doneKey: 'w1:done',
    atKey: 'w1:at',
    goneKey: 'w1:gone',
    foughtKey: 'w1:fought',
    flags: { fought: 'flag:w1:a', unmet: 'flag:w1:b' },
  };
  const lint = (list: WardWindowDef[]) =>
    wardContentIssues(list, { bands, floors, spots, monsters } as never).map((i) => `${i.kind} ${i.id}: ${i.message}`);

  it('stamps need a fight budget; kept wounds need a share in (0, 1]', () => {
    const issues = lint([]);
    expect(issues.some((m) => m.startsWith('spot loose') && m.includes('needs a fightLimit'))).toBe(true);
    expect(issues.some((m) => m.startsWith('monster bad'))).toBe(true);
    expect(issues.some((m) => m.startsWith('monster big'))).toBe(true);
    expect(issues).toHaveLength(3);
  });

  it('a well-formed window passes', () => {
    expect(lint([good])).toHaveLength(3); // only the fixture's deliberate spot and monster faults
  });

  it('each window rule fires', () => {
    const cases: [Partial<WardWindowDef>, string][] = [
      [{ floorId: 'nope' }, "unknown floor 'nope'"],
      [{ floorId: 's1' }, 'not in an any-order band'],
      [{ spotId: 'elsewhere' }, "is not on floor 'w1'"],
      [{ monsterId: 'bad' }, 'never spawns'],
      [{ position: 2 }, 'outside 0..1'],
      [{ position: -1 }, 'outside 0..1'],
      [{ ticks: 0 }, 'ticks must be above 0'],
      [{ goneKey: 'w1:at' }, 'keys must be distinct'],
      [{ doneKey: 'w1:other' }, "must stamp 'w1:other'"],
    ];
    for (const [change, needle] of cases) {
      const issues = lint([{ ...good, ...change }]);
      expect(issues.some((m) => m.includes(needle)), `${JSON.stringify(change)} → ${needle}\n${issues.join('\n')}`).toBe(true);
    }
    expect(lint([{ ...good, doneKey: 'x' }]).some((m) => m.includes("must clear on 'x'"))).toBe(true);
    const twins = lint([good, { ...good, id: 'twin', floorId: 'w1', doneKey: 'w1:done', foughtKey: 'w1:fought2', goneKey: 'w1:gone2' }]);
    expect(twins.some((m) => m.includes("atKey 'w1:at' is window 'ok'"))).toBe(true);
  });

  it('the stat keys content may read include positions, stamps and window keys', () => {
    const keys = wardStatKeys([good], { bands, floors, spots } as never);
    for (const k of ['band:pos:w1', 'band:pos:w2', 'w1:done', 'z', 'w1:at', 'w1:gone', 'w1:fought', 'flag:w1:a', 'flag:w1:b']) {
      expect(keys.has(k), k).toBe(true);
    }
    expect(keys.has('band:pos:s1')).toBe(false);
  });

  it('a floor that clears on a stamp names the stamping spots for the floor rules', () => {
    expect(clearSpotIds({ clear: [{ type: 'stat', key: 'w1:done' }] } as never, spots).sort()).toEqual(['camp', 'elsewhere']);
    expect(clearSpotIds({ clear: [{ type: 'stat', key: 'w1:done' }] } as never)).toEqual([]);
  });
});
