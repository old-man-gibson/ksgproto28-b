/**
 * Port of the old `tests/festivalHub.test.ts`: the festival's prep hub, the
 * hall and the five spots off it, their finite stock, and the budget of the
 * ten days. The hub is data in `world/content/spots.json`; the restock is the
 * `festival` system's.
 *
 * Call shape changes:
 * - `new Game(state)` is a kernel over the real systems; `game.climbTo`,
 *   `game.travelTo`, `game.goAndDo` and `game.selectActivity` are the world
 *   commands; `game.tick()` is `kernel.tick()`.
 * - `s.stats[key]` is the `counters` slice; `s.materials` and `s.stock` are
 *   the `materials` slice's `counts` and `stock`; `s.attrs` is the
 *   `attributes` slice.
 * - `searchSpent(state, spot, act)` takes a read context.
 * - An activity's `attrXp` is a list of `{ attr, weight }`.
 * - `Object.keys(ROYALE_SECTIONS)` is `ROYALE_SECTION_IDS` until the royale's
 *   registry comes with step 4 port C5.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { REAGENTS } from '../src/systems/alchemy';
import type { AttributesState } from '../src/systems/attributes';
import { RECIPES } from '../src/systems/crafting';
import { DARK_FLOOR, FESTIVAL_RESTOCK, PREP_TICKS, ROYALE_SECTION_IDS, scoutedKey, type FestivalState } from '../src/systems/festival';
import { FLOORS, floorStructureIssues } from '../src/systems/ladder';
import { MATERIALS, type MaterialsState } from '../src/systems/materials';
import { ATTRIBUTE_IDS } from '../src/systems/stats';
import {
  ADJACENCY,
  climb as climbCommand,
  goAndDoCommand,
  searchKey,
  searchSpent,
  selectActivity,
  spotActivities,
  SPOTS,
  travelTo,
  type ActivityDef,
  type SpotDef,
} from '../src/systems/world';
import { playerStats, setHp } from './combatHelpers';
import { makeGame, patch, reads, run, slice } from './helpers';
import { counterOf, setCounters, worldOf } from './worldHelpers';

const HUB_NEW = ['f15_survey', 'f15_herb_yard', 'f15_workshop', 'f15_gallery'];
const HUB = ['f15_stores', ...HUB_NEW];
const BELOW = Object.values(FLOORS)
  .filter((f) => f.bandId !== undefined && f.index < 15)
  .map((f) => f.id);

/** Festival hours are 600 ticks; a festival day is 14,400. */
const HOUR = 600;
const DAY = 24 * HOUR;
/** What the benches take beyond the searches, as budgeted in the hub's data: about a third of a day. */
const BENCH_ALLOWANCE = 4_000;

const searchesOf = (spot: SpotDef): ActivityDef[] => spot.activities.filter((a) => a.kind === 'search');

/** Every finite search of the restocked spots, with the finds it pays and the ticks each takes. */
function restocked(): { spot: string; act: ActivityDef; finds: number; ticks: number }[] {
  return FESTIVAL_RESTOCK.flatMap((id) =>
    searchesOf(SPOTS[id]).map((act) => ({
      spot: id,
      act,
      finds: (act.rewards ?? []).reduce((n, r) => n + (r.limit ?? 0), 0),
      ticks: act.ticksPer ?? 0,
    })),
  );
}

function clearFloors(k: Kernel, floorIds: string[]): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(k, values);
}

function atFourteen(): Kernel {
  const k = makeGame({ seed: 0 });
  clearFloors(k, BELOW);
  patch(k, (s) => {
    s.world.spot = FLOORS.ascent_f14.landing!;
    if (!s.world.discovered.includes(s.world.spot)) s.world.discovered.push(s.world.spot);
  });
  return k;
}

/** Far past anything on floor 15, so the hub's clock is the only thing under test. */
function strong(k: Kernel): Kernel {
  patch(k, (s) => {
    for (const a of ATTRIBUTE_IDS) (s.attributes as AttributesState).attrs[a].level = 400;
  });
  setHp(k, playerStats(k).maxHp);
  return k;
}

function climb(k: Kernel, floorId: string | null): void {
  expect(k.dispatch(climbCommand({ floor: floorId })).ok, `climb to ${floorId}`).toBe(true);
  for (let i = 0; i < 2000 && worldOf(k).travel; i++) k.tick();
  expect(worldOf(k).travel).toBeNull();
}

function tickUntil(k: Kernel, done: () => boolean, max = 200_000): number {
  let n = 0;
  for (; n < max && !done(); n++) k.tick();
  expect(done(), 'condition never held').toBe(true);
  return n;
}

/** Walk to a spot and wait for the arrival. */
function goTo(k: Kernel, spotId: string): void {
  expect(k.dispatch(travelTo({ to: spotId })).ok, `travel to ${spotId}`).toBe(true);
  tickUntil(k, () => !worldOf(k).travel && worldOf(k).spot === spotId, 500);
}

const runOf = (k: Kernel) => slice<FestivalState>(k, 'festival').run;
/** `searchSpent` read through a live context: a snapshot every tick would copy every slice. */
const spentNow = (k: Kernel, spot: string, act: ActivityDef): boolean => run(k, (ctx) => searchSpent(ctx as never, spot, act));
const held = (k: Kernel) => slice<MaterialsState>(k, 'materials');

/** A festival attempt with the dark room emptied, standing in the hall. */
function inHall(k = strong(atFourteen())): Kernel {
  climb(k, DARK_FLOOR);
  tickUntil(k, () => runOf(k)?.phase === 'prep');
  goTo(k, 'f15_hall');
  return k;
}

describe('the hub’s spots', () => {
  it('the four new spots exist on floor 15, each reached from the hall by a road that runs both ways', () => {
    const area = FLOORS.ascent_f15.areaId;
    for (const id of HUB_NEW) {
      expect(SPOTS[id], `${id} exists`).toBeDefined();
      expect(SPOTS[id].areaId, `${id} lies on floor 15`).toBe(area);
      expect(ADJACENCY.get('f15_hall')!.some((e) => e.to === id), `hall -> ${id}`).toBe(true);
      expect(ADJACENCY.get(id)!.some((e) => e.to === 'f15_hall'), `${id} -> hall`).toBe(true);
    }
    const hall = SPOTS.f15_hall;
    for (const id of HUB) {
      const edge = hall.connections.find((c) => c.to === id);
      expect(edge, `the hall declares the road to ${id}`).toBeDefined();
      expect(edge!.ticks, `${id} is a short walk`).toBeLessThanOrEqual(20);
      expect(edge!.oneWay, `${id} is not a one-way road`).toBeFalsy();
    }
  });

  it('the dark room’s door to the hall is as it was', () => {
    const door = SPOTS.f15_dark_room.connections.find((c) => c.to === 'f15_hall')!;
    expect(door.ticks).toBe(20);
    expect(door.requires).toEqual([{ type: 'stat', key: 'festival:door', value: 1 }]);
    expect(door.revealWhen).toEqual([{ type: 'stat', key: 'festival:door', value: 1 }]);
  });

  it('floor 15 passes the floor rules: the gallery’s stair is the wing’s one-way way back to the dark room', () => {
    const stair = SPOTS.f15_gallery.connections.find((c) => c.to === 'f15_dark_room');
    expect(stair?.oneWay).toBe(true);
    expect(floorStructureIssues(FLOORS.ascent_f15, SPOTS, ADJACENCY).issues).toEqual([]);
  });

  it('the map places every floor-15 spot on the canvas, apart from each other', () => {
    const spots = Object.values(SPOTS).filter((s) => s.areaId === FLOORS.ascent_f15.areaId);
    expect(spots.length).toBe(2 + HUB.length);
    for (const s of spots) {
      expect(s.map, `${s.id} has a map position`).toBeDefined();
      expect(s.map!.x).toBeGreaterThanOrEqual(0);
      expect(s.map!.x).toBeLessThanOrEqual(100);
      expect(s.map!.y).toBeGreaterThanOrEqual(0);
      expect(s.map!.y).toBeLessThanOrEqual(75);
    }
    for (const a of spots) {
      for (const b of spots) {
        if (a.id >= b.id) continue;
        const apart = Math.hypot(a.map!.x - b.map!.x, a.map!.y - b.map!.y);
        expect(apart, `${a.id} and ${b.id} are ${apart.toFixed(1)} apart`).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('every spot has a description', () => {
    for (const id of ['f15_hall', ...HUB]) expect(SPOTS[id].desc, `${id}.desc`).toBeTruthy();
  });

  it('the workshop holds the alchemy and forging benches and the smelt; the hall keeps its stove', () => {
    expect(SPOTS.f15_workshop.benches).toEqual(['alchemy', 'forging']);
    expect(SPOTS.f15_workshop.recipes).toContain('iron_ingot');
    expect(SPOTS.f15_hall.benches).toEqual(['cooking']);
  });

  it('the gallery trains several attributes at once, and has a rest', () => {
    const acts = SPOTS.f15_gallery.activities;
    const train = acts.find((a) => a.kind === 'train');
    expect(train).toBeDefined();
    const weights = (train!.attrXp ?? []).filter((w) => w.weight > 0);
    expect(weights.length).toBeGreaterThanOrEqual(3);
    expect(acts.some((a) => a.kind === 'rest')).toBe(true);
  });
});

describe('the hub’s stock', () => {
  it('every restocked spot exists and holds a search, and every hub search is restocked', () => {
    for (const id of FESTIVAL_RESTOCK) {
      expect(SPOTS[id], `${id} exists`).toBeDefined();
      expect(searchesOf(SPOTS[id]).length, `${id} has a search`).toBeGreaterThan(0);
    }
    const hubSearches = HUB.filter((id) => searchesOf(SPOTS[id]).length > 0);
    expect(hubSearches.sort()).toEqual([...FESTIVAL_RESTOCK].sort());
  });

  it('every reward is limited, so the stock is finite', () => {
    for (const { spot, act } of restocked()) {
      for (const r of act.rewards ?? []) expect(r.limit, `${spot}/${act.id}/${r.id}`).toBeGreaterThan(0);
    }
  });

  it('every search runs on the clock: a fast body does not shorten the ten days', () => {
    for (const { spot, act } of restocked()) expect(act.staticTime, `${spot}/${act.id}`).toBe(true);
  });

  it('the stores pay about twelve finds', () => {
    const stores = restocked().find((r) => r.spot === 'f15_stores')!;
    expect(stores.finds).toBe(12);
    expect(stores.ticks).toBe(4 * HOUR);
  });

  it('the herb yard pays about eight finds, every one a reagent the alembic reads', () => {
    const yard = restocked().find((r) => r.spot === 'f15_herb_yard')!;
    expect(yard.finds).toBe(8);
    for (const r of yard.act.rewards ?? []) {
      const id = r.material!.id;
      expect(REAGENTS[id], `${id} is a reagent`).toBeDefined();
      expect(MATERIALS[id].craftTags, `${id} carries the reagent tag`).toContain('reagent');
    }
  });

  it('the workshop pays six finds, each one a bench takes: scrap smelts, the rest goes to the anvil or the alembic', () => {
    const shop = restocked().find((r) => r.spot === 'f15_workshop')!;
    expect(shop.finds).toBe(6);
    const smelts = new Set((SPOTS.f15_workshop.recipes ?? []).flatMap((id) => RECIPES[id].cost.map((c) => c.id)));
    for (const r of shop.act.rewards ?? []) {
      const id = r.material!.id;
      const m = MATERIALS[id];
      const anvil = !!m.smith && (m.craftTags ?? []).some((t) => ['metal', 'wood', 'leather'].includes(t));
      expect(smelts.has(id) || anvil || !!REAGENTS[id], `${id} has a use at the workshop`).toBe(true);
    }
    // The smelt turns the scrap into ingots the anvil takes.
    const scrap = (shop.act.rewards ?? []).filter((r) => r.material!.id === 'iron_scrap');
    const scrapQty = scrap.reduce((n, r) => n + (r.limit ?? 0) * (r.material!.qty ?? 1), 0);
    expect(RECIPES.iron_ingot.cost).toEqual([{ id: 'iron_scrap', qty: 3 }]);
    expect(Math.floor(scrapQty / 3), 'ingots from the scrap').toBeGreaterThanOrEqual(4);
  });

  it('the survey pays one find per royale section, each setting that section’s scouted flag', () => {
    const survey = restocked().find((r) => r.spot === 'f15_survey')!;
    expect(survey.ticks).toBe(12 * HOUR);
    expect(ROYALE_SECTION_IDS).toHaveLength(8);
    expect((survey.act.rewards ?? []).map((r) => r.id)).toEqual(ROYALE_SECTION_IDS);
    for (const r of survey.act.rewards ?? []) {
      expect(r.limit).toBe(1);
      expect(r.stat).toEqual({ key: scoutedKey(r.id), set: 1 });
      expect(r.desc, `${r.id} says what the scouting shows`).toMatch(/caches and dens/);
    }
  });

  it('a full clear plus the benches takes 8 to 10 of the 10 days', () => {
    const searches = restocked().reduce((n, r) => n + r.finds * r.ticks, 0);
    const survey = restocked().find((r) => r.spot === 'f15_survey')!;
    expect(survey.finds * survey.ticks, 'the survey alone is four days').toBe(4 * DAY);
    expect(PREP_TICKS).toBe(10 * DAY);
    const days = (searches + BENCH_ALLOWANCE) / DAY;
    expect(days, `${days.toFixed(2)} days`).toBeGreaterThanOrEqual(8);
    expect(days).toBeLessThanOrEqual(10);
  });
});

describe('a new attempt restocks the hub', () => {
  it('resets every restocked search’s limits and clears the scouted flags', () => {
    const k = strong(atFourteen());
    // A previous attempt's leavings: every limit spent, every section scouted.
    const leavings: Record<string, number> = {};
    for (const { spot, act } of restocked()) {
      const key = searchKey(spot, act.id);
      leavings[key] = 9;
      for (const r of act.rewards ?? []) leavings[`${key}:${r.id}`] = r.limit!;
    }
    for (const id of ROYALE_SECTION_IDS) leavings[scoutedKey(id)] = 1;
    // A flag outside the festival's namespace is left alone.
    leavings['flag:festival:unrelated'] = 3;
    setCounters(k, leavings);

    climb(k, DARK_FLOOR);
    expect(runOf(k), 'the attempt started').not.toBeNull();

    for (const { spot, act } of restocked()) {
      const key = searchKey(spot, act.id);
      expect(counterOf(k, key), `${key} reset`).toBe(0);
      expect(searchSpent(reads(k), spot, act), `${spot}/${act.id} can be searched again`).toBe(false);
      for (const r of act.rewards ?? []) expect(counterOf(k, `${key}:${r.id}`), `${key}:${r.id} reset`).toBe(0);
    }
    for (const id of ROYALE_SECTION_IDS) expect(counterOf(k, scoutedKey(id)), id).toBe(0);
    expect(counterOf(k, 'flag:festival:unrelated')).toBe(3);
  });
});

describe('the hub played through', () => {
  it('a full clear of the searches takes the budgeted clock, whatever the body’s speed', () => {
    const k = inHall();
    const safe = { ...worldOf(k).safeSpots };
    const start = runOf(k)!.clock;
    let searchTicks = 0;

    for (const { spot, act, finds, ticks } of restocked()) {
      // The map's route: a click on a spot two roads away walks through the hall.
      expect(k.dispatch(goAndDoCommand({ spot, activity: act.id })).ok, `go to ${spot}`).toBe(true);
      tickUntil(k, () => worldOf(k).spot === spot && !worldOf(k).travel && worldOf(k).activity === act.id, 500);
      // Stop at the last find: a search left running spends one more cycle finding nothing.
      const took = tickUntil(k, () => spentNow(k, spot, act));
      k.dispatch(selectActivity({ activity: null }));
      searchTicks += took;
      // One find per cycle, to the tick.
      expect(took, `${act.id}`).toBeGreaterThanOrEqual(finds * ticks - 8);
      expect(took, `${act.id}`).toBeLessThanOrEqual(finds * ticks + 8);
    }

    // The survey scouted all eight sections.
    for (const id of ROYALE_SECTION_IDS) expect(counterOf(k, scoutedKey(id)), id).toBe(1);
    // What the searches paid is in hand: scrap, wood, hide, spirit, water.
    expect(held(k).counts.iron_scrap).toBe(15);
    expect(held(k).counts.hardwood).toBe(3);
    expect(held(k).counts.leather).toBe(2);
    expect(Object.values(held(k).stock.healing_salve ?? {}).reduce((n, c) => n + (c ?? 0), 0)).toBe(2);

    // The searches alone leave the budgeted clock, plus the walking, in the ten days.
    const run = runOf(k)!;
    const elapsed = run.clock - start;
    expect(elapsed).toBeGreaterThanOrEqual(searchTicks - 8);
    expect(elapsed / DAY).toBeGreaterThan(8);
    expect(elapsed / DAY).toBeLessThan(9);
    expect(run.phase).toBe('prep');

    // The smelt takes the scrap three to an ingot, at the workshop.
    expect(k.dispatch(goAndDoCommand({ spot: 'f15_workshop', activity: 'craft_iron_ingot' })).ok).toBe(true);
    tickUntil(k, () => worldOf(k).spot === 'f15_workshop' && !worldOf(k).travel && worldOf(k).activity === 'craft_iron_ingot', 500);
    tickUntil(k, () => (held(k).counts.iron_ingot ?? 0) >= 5);
    k.dispatch(selectActivity({ activity: null }));
    expect(held(k).counts.iron_ingot).toBe(5);
    expect(held(k).counts.iron_scrap ?? 0).toBe(0);

    // No hub spot is a haven: a knockout does not land back in the hall.
    expect(worldOf(k).safeSpots).toEqual(safe);
  }, 60_000);

  it('the gallery trains Constitution, Intelligence and Wisdom together', () => {
    const k = inHall();
    goTo(k, 'f15_gallery');
    const mark = () => {
      const attrs = slice<AttributesState>(k, 'attributes').attrs;
      return Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, { ...attrs[id] }]));
    };
    const before = mark();
    expect(k.dispatch(selectActivity({ activity: 'train_f15_gallery' })).ok).toBe(true);
    for (let i = 0; i < 200; i++) k.tick();
    const after = mark();
    // A level gained resets the bar, so a gain is a higher level or more XP at the same level.
    const gained = (id: string) =>
      after[id].level > before[id].level || (after[id].level === before[id].level && after[id].xp > before[id].xp);
    for (const id of ['con', 'int', 'wis']) expect(gained(id), `${id} trained`).toBe(true);
    for (const id of ['str', 'dex', 'cha']) expect(gained(id), `${id} untouched`).toBe(false);
    expect(spotActivities(SPOTS.f15_gallery).some((a) => a.id === 'rest_f15_gallery')).toBe(true);
  });

  it('the gallery’s stair leads down to the dark room without starting another attempt', () => {
    const k = inHall();
    goTo(k, 'f15_gallery');
    const run = runOf(k);
    goTo(k, 'f15_dark_room');
    expect(runOf(k)!.fieldSeed).toBe(run!.fieldSeed);
    expect(runOf(k)!.phase).toBe('prep');
  });
});
