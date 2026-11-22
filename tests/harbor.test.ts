/**
 * Port of the old `tests/harbor.test.ts`: the harbor band (floors 11 to 14).
 * The convoy resolver, the battery, the side pick, and floors 11 to 14
 * walked by each side. The cases keep their old names.
 *
 * Call shape changes:
 * - The game is a kernel (`makeGame`). The old tests wrote `state.spot`,
 *   `state.activity`, `state.totalTicks`, `state.materials` and `state.stats`;
 *   here the slices are patched through a save and a load (the clock's
 *   `totalTicks`, the world's spot and activity, the materials slice), and
 *   counters are set by the event.
 * - `tickSea(state, bus, offline)` is `tickSea(ctx)` run in a probe context;
 *   `offline` is the kernel's `catchingUp` (a kernel made with
 *   `catchingUp: true`). `fireBattery(state)` is `fireBattery(ctx)`.
 * - `seaSide(state)`, `cargoBefore(state, side, ...)` and `legKills(state,
 *   ...)` take the counters slice (and the side's flow); `batteryOf(state)`
 *   takes the materials slice; `dealPrice(state)` takes the Speechcraft level.
 * - `registerSeaListeners` plus `bus.emit({ type: 'kill' })` is the event
 *   `combat/kill` with the fight's site; `fight:won` is `combat/fight-won`.
 * - `acceptQuest(state, bus, id)` is the command `quests/accept`;
 *   `availableQuests(state, npc)` takes the reads and the quests slice.
 * - `eligibleEncounters(state, SPOTS[id])` is `eligibleAt(reads, spot)`;
 *   `visibleEdges(state, from)` takes the reads and the world slice;
 *   `floorCleared` and `floorUnlocked` take the ladder reader.
 * - The catch-up cases: old `runOfflineProgress` and `catchUpTicks` set
 *   `Game.catchingUp`; here `catchUp` makes a kernel whose `ctx.catchingUp`
 *   is true (docs/KERNEL.md decision 34). "Catch-up marks its ticks as
 *   offline" is the kernel case in `tests/runner.test.ts`; the UI source scan
 *   reads `src/ui/catchup.ts`.
 *
 * New here: the panel's controls (`view.actions`), rendered on the server
 * and dispatched as the panel's buttons send them.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { catchUp, type Kernel, type KernelOptions } from '../src/kernel';
import { systems } from '../src/systems';
import type { ClockState } from '../src/systems/clock';
import { enemyKilled, fightWon } from '../src/systems/combat';
import { conditionsMet, type CountersState } from '../src/systems/counters';
import { RECIPES } from '../src/systems/crafting';
import { clearSpotIds, FLOORS, floorCleared, floorUnlocked } from '../src/systems/ladder';
import { materialSellPrice, type MaterialsState } from '../src/systems/materials';
import { NPCS } from '../src/systems/npcs';
import { acceptedKey, acceptQuest, availableQuests, type QuestsState } from '../src/systems/quests';
import {
  batteryOf,
  cargoBefore,
  CONVOYS,
  dealPrice,
  fireBattery,
  killLeg,
  legEnding,
  legKills,
  legRoll,
  resolveLeg,
  SEA,
  SEA_CRATES_OFFLINE,
  SEA_CRATES_WON,
  SEA_DEAL,
  SEA_MISSION_DONE,
  SEA_SIDES,
  seaClock,
  seaSide,
  startingCargo,
  tickSea,
  type ConvoyDef,
  type LegRoll,
  type SeaSideDef,
  type SeaView,
} from '../src/systems/sea';
import SeaReadout from '../src/systems/sea/SeaReadout.svelte';
import { buyPrice, resaleCeiling } from '../src/systems/shops';
import { conditionReader } from '../src/systems/skills';
import { statOf } from '../src/systems/stats';
import { eligibleAt, SPOTS, visibleEdges, type WorldView } from '../src/systems/world';
import { emit, makeGame, patch, readText, reads, run, slice } from './helpers';
import { counterOf, ladderOf, setCounters, worldOf } from './worldHelpers';

const fresh = (seed = 0): Kernel => makeGame({ seed });

/** A row for formula tests, independent of the authored waters. */
const ROW: ConvoyDef = { id: 'test_water', raiders: [1, 3], monsters: [0, 2], guard: [1, 2], cargo: ['iron_ingot'] };

const roll = (raiders: number, monsters: number, guard: number): LegRoll => ({ raiders, monsters, guard });

const countsOf = (k: Kernel): CountersState => slice<CountersState>(k, 'counters');
const heldOf = (k: Kernel): MaterialsState => slice<MaterialsState>(k, 'materials');
const goldOf = (k: Kernel): number => slice<{ gold: number }>(k, 'gold').gold;

/** Run four legs of one flow and return what the side is credited. */
function convoyCredit(flow: SeaSideDef['flow'], rolls: LegRoll[], battery: number, kills: number[] = [0, 0, 0, 0]): number {
  let cargo = startingCargo(flow);
  let credited = 0;
  rolls.forEach((r, i) => {
    const out = resolveLeg(flow, r, cargo, battery, kills[i]);
    cargo = out.cargo;
    credited += out.credited;
  });
  return flow === 'convoy' || flow === 'escort' ? cargo.crates : credited;
}

/** Put materials in the hold: plain counts, and graded stock by grade. */
function stock(k: Kernel, counts: Record<string, number>, graded: Record<string, Record<string, number>> = {}): void {
  patch(k, (s) => {
    const m = s.materials as MaterialsState;
    Object.assign(m.counts, counts);
    Object.assign(m.stock, graded);
  });
}

/** Everything held, plain counts and graded stock together. */
const holdings = (k: Kernel): number => {
  const m = heldOf(k);
  return (
    Object.values(m.counts).reduce((n, q) => n + q, 0) +
    Object.values(m.stock).reduce((n, grades) => n + Object.values(grades).reduce((a, b) => a + (b ?? 0), 0), 0)
  );
};

/** One sea tick in a system context, as the old tests called `tickSea`. */
const seaTick = (k: Kernel): void => run(k, (ctx) => tickSea(ctx as never));

/** A kill event at a site, as combat sends it. */
function kill(k: Kernel, site: string, defId: string): void {
  emit(k, enemyKilled, {
    entity: 'monster:test',
    defId,
    name: defId,
    level: 25,
    rewardLevel: 25,
    xp: 1,
    tags: [],
    lastHit: null,
    site,
    boss: false,
    once: false,
  });
}

const won = (k: Kernel, site: string): void => emit(k, fightWon, { site, forced: false });

/** Set the clock to a tick. */
function setClock(k: Kernel, totalTicks: number): void {
  patch(k, (s) => {
    (s.clock as ClockState).totalTicks = totalTicks;
  });
}

// ---------- The schedule and the formulas ----------

describe('the schedule', () => {
  it('a convoy every 3,600 ticks, four legs of 300, then port', () => {
    expect(seaClock(0)).toEqual({ convoy: 0, offset: 0, leg: 0 });
    expect(seaClock(299).leg).toBe(0);
    expect(seaClock(300).leg).toBe(1);
    expect(seaClock(1199).leg).toBe(3);
    expect(seaClock(1200).leg).toBeNull();
    expect(seaClock(3599).leg).toBeNull();
    expect(seaClock(3600)).toEqual({ convoy: 1, offset: 0, leg: 0 });
  });

  it('a leg resolves on the tick that ends it, and only then', () => {
    const ends = [];
    for (let t = 0; t < 2 * SEA.convoyTicks; t++) if (legEnding(t)) ends.push([t, legEnding(t)!.leg]);
    expect(ends).toEqual([
      [300, 0], [600, 1], [900, 2], [1200, 3],
      [3900, 0], [4200, 1], [4500, 2], [4800, 3],
    ]);
  });

  it('a leg roll is a pure function of water, convoy and leg, inside the row', () => {
    for (let c = 0; c < 50; c++) {
      for (let leg = 0; leg < SEA.legs; leg++) {
        const r = legRoll(ROW, c, leg);
        expect(r).toEqual(legRoll(ROW, c, leg));
        expect(r.raiders).toBeGreaterThanOrEqual(1);
        expect(r.raiders).toBeLessThanOrEqual(3);
        expect(r.monsters).toBeGreaterThanOrEqual(0);
        expect(r.monsters).toBeLessThanOrEqual(2);
        expect(r.guard).toBeGreaterThanOrEqual(1);
        expect(r.guard).toBeLessThanOrEqual(2);
      }
    }
    // Every value in a range turns up over enough convoys.
    const seen = new Set<number>();
    for (let c = 0; c < 200; c++) seen.add(legRoll(ROW, c, 0).raiders);
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });
});

describe('the convoy formulas, one per side', () => {
  // The spec's example (idea 3, the battery): threat [3, 3, 4, 4].
  const threat = [roll(2, 1, 0), roll(2, 1, 0), roll(2, 2, 0), roll(2, 2, 0)];

  it('merchants: crates lost = clamp(threat − kills − battery); the rest are sold', () => {
    // Base battery alone loses 2 + 2 + 3 + 3, clamped to all 8.
    expect(convoyCredit('convoy', threat, 1)).toBe(0);
    // Two cannons, a cannonball a leg and a ration: rating 4, nothing lost.
    expect(convoyCredit('convoy', threat, 4)).toBe(8);
    // Kills subtract threat on top of the battery.
    expect(convoyCredit('convoy', threat, 1, [2, 2, 3, 3])).toBe(8);
    expect(convoyCredit('convoy', threat, 1, [1, 1, 1, 1])).toBe(2);
  });

  it('navy: crates lost = clamp(monsters − kills − battery); raiders are not its fight', () => {
    expect(convoyCredit('escort', [roll(9, 2, 0), roll(9, 2, 0), roll(9, 3, 0), roll(9, 3, 0)], 1)).toBe(2);
    expect(convoyCredit('escort', [roll(9, 2, 0), roll(9, 2, 0), roll(9, 3, 0), roll(9, 3, 0)], 3)).toBe(8);
    expect(convoyCredit('escort', [roll(9, 2, 0), roll(9, 2, 0), roll(9, 3, 0), roll(9, 3, 0)], 1, [1, 1, 2, 2])).toBe(8);
  });

  it('pirates: crates seized = clamp(battery − (guard − kills)), credited per leg', () => {
    const guarded = [roll(0, 0, 2), roll(0, 0, 2), roll(0, 0, 3), roll(0, 0, 3)];
    expect(convoyCredit('raid', guarded, 1)).toBe(0);
    expect(convoyCredit('raid', guarded, 4)).toBe(2 + 2 + 1 + 1);
    expect(convoyCredit('raid', guarded, 1, [2, 2, 3, 3])).toBe(4);
    // Never more than the convoy holds.
    expect(convoyCredit('raid', guarded, 20)).toBe(SEA.crates);
  });

  it('privateers: crates recovered = clamp(battery − (crew − kills)) out of the pirates’ prize', () => {
    const crews = [roll(2, 0, 0), roll(2, 0, 0), roll(3, 0, 0), roll(3, 0, 0)];
    expect(startingCargo('recover')).toEqual({ crates: 0, carried: SEA.crates });
    expect(convoyCredit('recover', crews, 1)).toBe(0);
    expect(convoyCredit('recover', crews, 4)).toBe(2 + 2 + 1 + 1);
    expect(convoyCredit('recover', crews, 1, [2, 2, 3, 3])).toBe(4);
    expect(convoyCredit('recover', crews, 20)).toBe(SEA.crates);
  });

  it('crates are conserved and every number stays an integer', () => {
    for (const flow of ['convoy', 'escort', 'raid', 'recover'] as const) {
      for (let c = 0; c < 40; c++) {
        let cargo = startingCargo(flow);
        let credited = 0;
        for (let leg = 0; leg < SEA.legs; leg++) {
          const out = resolveLeg(flow, legRoll(ROW, c, leg), cargo, c % 6, c % 4);
          for (const n of [out.cargo.crates, out.cargo.carried, out.moved, out.credited]) {
            expect(Number.isInteger(n) && n >= 0).toBe(true);
          }
          cargo = out.cargo;
          credited += out.credited;
        }
        expect(cargo.crates + cargo.carried + credited).toBeLessThanOrEqual(SEA.crates);
      }
    }
  });
});

describe('the battery', () => {
  it('the ship alone fires 1: volleys 1, hit 1, morale 0', () => {
    expect(batteryOf(heldOf(fresh()))).toMatchObject({ volleys: 1, hit: 1, morale: 0, rating: 1 });
  });

  it('rating = volleys × hit + morale; the spec example rates 4', () => {
    const k = fresh();
    stock(k, { [SEA.cannon]: 2, [SEA.shot]: 5 }, { [SEA.ration]: { c: 3 } });
    expect(batteryOf(heldOf(k))).toMatchObject({ cannons: 2, volleys: 3, hit: 1, morale: 1, rating: 4 });
    stock(k, { [SEA.powder]: 1 });
    expect(batteryOf(heldOf(k))).toMatchObject({ volleys: 3, hit: 2, morale: 1, rating: 7 });
  });

  it('cannons without shot are dry, and past four add nothing', () => {
    const k = fresh();
    stock(k, { [SEA.cannon]: 9 });
    expect(batteryOf(heldOf(k))).toMatchObject({ cannons: SEA.maxCannons, volleys: 1, shot: false });
    stock(k, { [SEA.shot]: 1 });
    expect(batteryOf(heldOf(k)).volleys).toBe(1 + SEA.maxCannons);
  });

  it('a leg spends one shot, one powder and the worst ration; cannons are kept', () => {
    const k = fresh();
    stock(k, { [SEA.cannon]: 2, [SEA.shot]: 2, [SEA.powder]: 1 }, { [SEA.ration]: { a: 1, d: 1 } });
    expect(run(k, (ctx) => fireBattery(ctx as never)).rating).toBe(3 * 2 + 1);
    const m = heldOf(k);
    expect(m.counts[SEA.cannon]).toBe(2);
    expect(m.counts[SEA.shot]).toBe(1);
    expect(m.counts[SEA.powder]).toBeUndefined();
    expect(m.stock[SEA.ration]).toEqual({ a: 1 });
    // Shot is not spent with no cannon to load.
    const bare = fresh();
    stock(bare, { [SEA.shot]: 3 });
    run(bare, (ctx) => fireBattery(ctx as never));
    expect(heldOf(bare).counts[SEA.shot]).toBe(3);
  });

  it('the merchants’ price per crate is the base plus each Speechcraft term met', () => {
    expect(dealPrice(0).price).toBe(SEA_DEAL.base);
    expect(dealPrice(15).price).toBe(SEA_DEAL.base + 1 + 2);
    expect(dealPrice(15).terms.map((t) => t.met)).toEqual([true, true, false]);
  });
});

// ---------- The authored harbor (floors 11 to 14) ----------

const SIDES = Object.values(SEA_SIDES);

/** A later run, every floor below 11 cleared. */
function harborRun(options: Partial<KernelOptions> = {}): Kernel {
  const k = makeGame({ seed: 0, ...options });
  const values: Record<string, number> = { 'legacy:stronghold': 1 };
  for (const f of Object.values(FLOORS)) {
    if (!f.bandId || f.index >= 11) continue;
    for (const c of f.clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(k, values);
  return k;
}

/** Stand at a spot, discovered. */
function standAt(k: Kernel, spot: string, activity: string | null = null): void {
  patch(k, (s) => {
    s.world.spot = spot;
    s.world.activity = activity;
    if (!s.world.discovered.includes(spot)) s.world.discovered.push(spot);
  });
}

/** Accept a side's join quest the way the player does: at its giver's berth. */
function join(k: Kernel, side: SeaSideDef): boolean {
  standAt(k, NPCS[side.giver].spotId);
  return k.dispatch(acceptQuest({ quest: side.joinQuest })).ok;
}

/** Every spot reachable from `from` over the roads this state can see and use. */
function reachable(k: Kernel, from: string): Set<string> {
  const r = conditionReader(reads(k));
  const w = worldOf(k);
  const seen = new Set([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const e of visibleEdges(reads(k), w, queue[i])) {
      if (seen.has(e.to) || (e.requires && !conditionsMet(r, e.requires))) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return seen;
}

/** Stand on a water, hunting, on the tick that ends `leg` of `convoy`. */
function atLegEnd(k: Kernel, water: string, convoy: number, leg: number): void {
  patch(k, (s) => {
    s.world.spot = water;
    s.world.activity = 'hunt';
    if (!s.world.discovered.includes(water)) s.world.discovered.push(water);
    (s.clock as ClockState).totalTicks = convoy * SEA.convoyTicks + (leg + 1) * SEA.legTicks;
  });
}

const sideOf = (k: Kernel) => seaSide(countsOf(k));

describe('the side pick', () => {
  it('accepting a join quest stamps it and picks the side; the other three are withdrawn', () => {
    for (const side of SIDES) {
      const k = harborRun();
      expect(sideOf(k)).toBeNull();
      expect(join(k, side)).toBe(true);
      expect(counterOf(k, acceptedKey(side.joinQuest))).toBe(1);
      expect(sideOf(k)?.id).toBe(side.id);
      for (const other of SIDES) {
        if (other.id === side.id) continue;
        standAt(k, NPCS[other.giver].spotId);
        const offered = availableQuests(reads(k), slice<QuestsState>(k, 'quests'), other.giver).map((q) => q.id);
        expect(offered).not.toContain(other.joinQuest);
        expect(k.dispatch(acceptQuest({ quest: other.joinQuest })).ok).toBe(false);
        expect(sideOf(k)?.id).toBe(side.id);
      }
    }
  });

  it('the pick holds for the run: turning the join quest in keeps the side', () => {
    const k = harborRun();
    join(k, SEA_SIDES.navy);
    patch(k, (s) => (s.quests.quests[SEA_SIDES.navy.joinQuest].status = 'done'));
    expect(sideOf(k)?.id).toBe('navy');
  });

  it('a new run starts with no side', () => {
    expect(sideOf(fresh())).toBeNull();
  });

  it('each water rolls only the side’s own crews; before a pick, sea monsters at a clear water and nothing elsewhere', () => {
    // A clear water carries a no-side line so its table never empties (the
    // clear-table rule); the others are reached only after floor 11's clear,
    // which needs a side, so they carry none.
    const clearWaters = new Set(Object.values(FLOORS).flatMap((f) => clearSpotIds(f)));
    for (const water of ['f11_roadstead', 'f12_strait', 'f12_far_water', 'f13_picket', 'f13_blockade']) {
      const noSide = eligibleAt(reads(harborRun()), SPOTS[water]).map((e) => e.monsterId);
      if (clearWaters.has(water)) {
        expect(noSide.length, `${water}: no side`).toBeGreaterThan(0);
        for (const id of noSide) expect(id, `${water}: no side`).toBe('ph_reef_eel');
      } else {
        expect(noSide, `${water}: no side`).toEqual([]);
      }
      for (const side of SIDES) {
        const k = harborRun();
        join(k, side);
        const ids = eligibleAt(reads(k), SPOTS[water]).map((e) => e.monsterId);
        expect(ids.length, `${water} ${side.id}`).toBeGreaterThan(0);
        for (const id of ids) expect(side.prey, `${water} ${side.id} rolls ${id}`).toContain(id);
      }
    }
  });
});

describe('the convoy at a water', () => {
  it('a present merchant sells the crates left after the fourth leg, at the Speechcraft price', () => {
    const k = harborRun();
    join(k, SEA_SIDES.merchants);
    // Strong enough that nothing is lost: four cannons, shot, powder, a ration a leg.
    stock(k, { [SEA.cannon]: 4, [SEA.shot]: 4, [SEA.powder]: 4 }, { [SEA.ration]: { c: 4 } });
    const gold = goldOf(k);
    for (let leg = 0; leg < SEA.legs; leg++) {
      atLegEnd(k, 'f11_roadstead', 7, leg);
      seaTick(k);
      if (leg < SEA.legs - 1) expect(counterOf(k, SEA_CRATES_WON), 'paid at port, not per leg').toBe(0);
    }
    expect(counterOf(k, SEA_CRATES_WON)).toBe(SEA.crates);
    expect(goldOf(k) - gold).toBe(SEA.crates * dealPrice(0).price);
    // Four legs spent four of each; the cannons stay.
    const m = heldOf(k);
    expect(m.counts[SEA.shot] ?? 0).toBe(0);
    expect(m.counts[SEA.powder] ?? 0).toBe(0);
    expect(m.stock[SEA.ration] ?? {}).toEqual({});
    expect(m.counts[SEA.cannon]).toBe(4);
  });

  it('a present pirate is paid per leg, in cargo from the water’s row', () => {
    const k = harborRun();
    join(k, SEA_SIDES.pirates);
    const row = CONVOYS.f11_roadstead;
    stock(k, { [SEA.cannon]: 4, [SEA.shot]: 4, [SEA.powder]: 4 });
    let expected = 0;
    let cargo = startingCargo('raid');
    for (let leg = 0; leg < SEA.legs; leg++) {
      const out = resolveLeg('raid', legRoll(row, 3, leg), cargo, batteryOf(heldOf(k)).rating, 0);
      cargo = out.cargo;
      expected += out.credited;
      const held = holdings(k);
      atLegEnd(k, row.id, 3, leg);
      seaTick(k);
      expect(counterOf(k, SEA_CRATES_WON)).toBe(expected);
      // One shot and one powder spent, one cargo per crate seized.
      expect(holdings(k) - held).toBe(out.credited - 2);
    }
    expect(expected).toBeGreaterThan(0);
  });

  it('kills of the side’s prey at the water count against the leg they fall in', () => {
    const k = harborRun();
    join(k, SEA_SIDES.merchants);
    standAt(k, 'f11_roadstead');
    setClock(k, 5 * SEA.convoyTicks + 10); // leg 0 of convoy 5
    kill(k, 'f11_roadstead', 'ph_pirate_cutthroat');
    kill(k, 'f11_roadstead', 'ph_pirate_cutthroat');
    kill(k, 'f11_roadstead', 'ph_convoy_guard');
    expect(legKills(countsOf(k), 'f11_roadstead', 5, 0)).toBe(2);
    expect((k.view().systems.sea as SeaView).convoy?.kills).toBe(2);
    setClock(k, 5 * SEA.convoyTicks + 10 + SEA.legTicks); // leg 1 counts afresh
    expect((k.view().systems.sea as SeaView).convoy?.kills).toBe(0);
    // The kills reach the formula: leg 0 resolves with them.
    const expected = resolveLeg('convoy', legRoll(CONVOYS.f11_roadstead, 5, 0), startingCargo('convoy'), 1, 2).cargo;
    atLegEnd(k, 'f11_roadstead', 5, 0);
    seaTick(k);
    expect(cargoBefore(countsOf(k), 'convoy', CONVOYS.f11_roadstead, 5, 1)).toEqual(expected);
  });

  it('two kills delivered in one drain both count, the first of a leg included', () => {
    // New: the kernel queues both kill events before either handler's
    // writes land; the leg's count is written at once (`counters/set-now`).
    const k = harborRun();
    join(k, SEA_SIDES.navy);
    standAt(k, 'f11_roadstead');
    setClock(k, 6 * SEA.convoyTicks + 10);
    const payload = (entity: string) => ({
      entity,
      defId: 'ph_reef_eel',
      name: 'eel',
      level: 25,
      rewardLevel: 25,
      xp: 1,
      tags: [],
      lastHit: null,
      site: 'f11_roadstead',
      boss: false,
      once: false,
    });
    run(k, (ctx) => {
      ctx.emit(enemyKilled, payload('m1'));
      ctx.emit(enemyKilled, payload('m2'));
    });
    expect(legKills(countsOf(k), 'f11_roadstead', 6, 0)).toBe(2);
  });

  it('a killing blow on the tick a leg ends counts for that leg, the fourth included', () => {
    const k = harborRun();
    join(k, SEA_SIDES.merchants);
    const row = CONVOYS.f11_roadstead;
    let cargo = startingCargo('convoy');
    for (let leg = 0; leg < SEA.legs; leg++) {
      // The tick that ends `leg`: kills land before the sea's tick.
      atLegEnd(k, row.id, 4, leg);
      const at = slice<ClockState>(k, 'clock').totalTicks;
      expect(killLeg(at)).toEqual({ convoy: 4, leg });
      kill(k, row.id, 'ph_reef_eel');
      expect(legKills(countsOf(k), row.id, 4, leg), `leg ${leg}`).toBe(1);
      seaTick(k);
      cargo = resolveLeg('convoy', legRoll(row, 4, leg), cargo, 1, 1).cargo;
      expect(cargoBefore(countsOf(k), 'convoy', row, 4, leg + 1), `after leg ${leg}`).toEqual(cargo);
    }
    const at = slice<ClockState>(k, 'clock').totalTicks;
    // The fourth leg ends as the convoy reaches port; that kill was still the leg's.
    expect(seaClock(at).leg).toBeNull();
    expect(counterOf(k, SEA_CRATES_WON)).toBe(cargo.crates);
    // One tick later the convoy is in port: a kill counts for no leg.
    expect(killLeg(at + 1)).toBeNull();
    // Leg 0 opens the convoy at offset 0.
    expect(killLeg(5 * SEA.convoyTicks)).toEqual({ convoy: 5, leg: 0 });
  });

  it('a won fight on a water counts under fights:<water>, and the water never clears', () => {
    const k = harborRun();
    for (let i = 0; i < 3; i++) won(k, 'f11_roadstead');
    expect(counterOf(k, 'fights:f11_roadstead')).toBe(3);
    expect(SPOTS.f11_roadstead.fightLimit).toBeUndefined();
  });

  it('no leg resolves for a player who is idle, travelling, elsewhere or sideless', () => {
    const cases: [string, (k: Kernel) => void][] = [
      ['idle', (k) => patch(k, (s) => (s.world.activity = null))],
      ['elsewhere', (k) => patch(k, (s) => (s.world.spot = 'f11_quay'))],
      ['travelling', (k) => patch(k, (s) => (s.world.travel = { from: 'f11_roadstead', to: 'f11_quay', ticksLeft: 5, total: 30 }))],
      ['sideless', (k) => patch(k, (s) => delete s.counters.counts[acceptedKey(SEA_SIDES.navy.joinQuest)])],
    ];
    for (const [why, spoil] of cases) {
      const k = harborRun();
      join(k, SEA_SIDES.navy);
      stock(k, { [SEA.shot]: 1, [SEA.cannon]: 1 });
      atLegEnd(k, 'f11_roadstead', 2, 3);
      spoil(k);
      seaTick(k);
      expect(counterOf(k, SEA_CRATES_WON), why).toBe(0);
      expect(heldOf(k).counts[SEA.shot], `${why}: the hold is untouched`).toBe(1);
    }
  });

  it('legs sailed without the player are folded in with no battery and no kills', () => {
    const k = harborRun();
    join(k, SEA_SIDES.navy);
    const row = CONVOYS.f11_roadstead;
    // Present only for the last leg: the convoy met the monsters alone on the first three.
    let cargo = startingCargo('escort');
    for (let leg = 0; leg < 3; leg++) cargo = resolveLeg('escort', legRoll(row, 9, leg), cargo, 0, 0).cargo;
    expect(cargoBefore(countsOf(k), 'escort', row, 9, 3)).toEqual(cargo);
    const last = resolveLeg('escort', legRoll(row, 9, 3), cargo, 1, 0).cargo.crates;
    atLegEnd(k, row.id, 9, 3);
    seaTick(k);
    expect(counterOf(k, SEA_CRATES_WON)).toBe(last);
  });
});

describe('offline: the convoy coarsens', () => {
  it('offline legs fire the battery without kills, pay cargo at 25%, and never reach crates won', () => {
    const k = harborRun({ catchingUp: true });
    join(k, SEA_SIDES.navy);
    // Kills on record are ignored offline.
    setCounters(k, { 'sea:f11_roadstead:kills:leg': 1, 'sea:f11_roadstead:kills': 99 });
    const before = holdings(k);
    // Eight hours of catch-up: 80 convoys at the base battery.
    let expected = 0;
    for (let c = 0; c < 80; c++) {
      let cargo = startingCargo('escort');
      for (let leg = 0; leg < SEA.legs; leg++) cargo = resolveLeg('escort', legRoll(CONVOYS.f11_roadstead, c, leg), cargo, 1, 0).cargo;
      expected += cargo.crates;
    }
    // Only the tick that ends a leg does anything; the old case ticked every one.
    for (let c = 0; c < 80; c++) {
      for (let leg = 0; leg < SEA.legs; leg++) {
        atLegEnd(k, 'f11_roadstead', c, leg);
        seaTick(k);
      }
    }
    expect(expected).toBeGreaterThan(0);
    expect(counterOf(k, SEA_CRATES_WON)).toBe(0);
    expect(counterOf(k, SEA_CRATES_OFFLINE)).toBe(expected);
    expect(holdings(k) - before).toBe(Math.floor(expected / SEA.offlineShare));
    // No clear moves on offline crates.
    expect(floorCleared(ladderOf(k), FLOORS.ascent_f11)).toBe(false);
  }, 30_000);

  /**
   * The old UI's quiet path: a gap under a minute got no summary but was
   * still simulated, and its ticks were time away too. Here every gap over 3
   * seconds is `catchUp`: a navy player on the roadstead with a full hold, the
   * fourth leg ending inside a 30 second gap. No fight starts in the gap
   * (the respawn timer is long), as the old case's level 90 kept the player
   * standing.
   */
  it('a short gap simulated without a summary is still offline: no crates won', () => {
    const k = harborRun();
    join(k, SEA_SIDES.navy);
    stock(k, { [SEA.cannon]: 4, [SEA.shot]: 10, [SEA.powder]: 10 }, { [SEA.ration]: { c: 10 } });
    atLegEnd(k, 'f11_roadstead', 2, SEA.legs - 1);
    patch(k, (s) => {
      (s.clock as ClockState).totalTicks -= 10;
      s.combat.respawnTimer = 100_000;
    });
    const back = makeGame();
    expect(back.load(catchUp({ systems, envelope: k.save(0), ticks: 300, now: 0 })).ok).toBe(true);
    expect(counterOf(back, 'sea:f11_roadstead:leg'), 'the fourth leg resolved inside the gap').toBe(SEA.legs);
    expect(counterOf(back, SEA_CRATES_WON)).toBe(0);
    expect(counterOf(back, SEA_CRATES_OFFLINE)).toBeGreaterThan(0);
  });

  it('the UI runs every catch-up gap through catchUp, never a bare tick loop', () => {
    const src = readText('src/ui/catchup.ts');
    expect(src).toContain('catchUp(');
    expect(src).not.toMatch(/\.tick\(\)/);
  });
});

describe('the battery’s hold mints nothing', () => {
  /**
   * The no-arbitrage law (shops `buyPrice`) applied to the three new
   * recipes: buy every input at the cheapest counter, craft, sell the output.
   * An input no vendor sells is priced at the least any counter could ever
   * ask for it (its resale + 1, the buyPrice floor), so a vendor added later
   * cannot open a mint either.
   */
  function inputCost(k: Kernel, id: string, goldGain: number): number {
    const line = { kind: 'material' as const, id };
    const vendors = Object.values(NPCS).filter((n) => n.shop?.lines.some((l) => l.kind === 'material' && l.id === id));
    const prices = vendors.map((n) => buyPrice(countsOf(k), n.id, line, goldGain));
    return prices.length ? Math.min(...prices) : resaleCeiling(line, goldGain) + 1;
  }

  for (const cha of [1, 30, 60]) {
    it(`buying the inputs, crafting and selling never profits at Charisma ${cha}`, () => {
      const k = fresh();
      patch(k, (s) => (s.attributes.attrs.cha.level = cha));
      // Every counter's best price.
      setCounters(k, Object.fromEntries(Object.values(NPCS).map((n) => [`met:${n.id}`, 1])));
      const goldGain = statOf(reads(k), 'goldGain');
      for (const id of ['ship_cannon', 'cannonball', 'powder_charge']) {
        const r = RECIPES[id];
        const cost = r.cost.reduce((n, c) => n + c.qty * inputCost(k, c.id, goldGain), 0);
        const revenue = (r.result.qty ?? 1) * materialSellPrice(r.result.id, goldGain);
        expect(revenue - cost, `${id} at Charisma ${cha} (goldGain ${goldGain.toFixed(2)})`).toBeLessThanOrEqual(0);
      }
    });
  }
});

describe('floors 11 to 14, walked by each side', () => {
  const lanes: Record<string, string> = {
    merchants: 'f12_trade_lane',
    pirates: 'f12_hidden_cove',
    privateers: 'f12_hunting_ground',
    navy: 'f12_patrol_lane',
  };

  for (const side of SIDES) {
    it(`${side.id}: every floor is reachable and clears`, () => {
      const k = harborRun();
      const L = () => ladderOf(k);

      // Floor 11: the road leads to the berths and the roadstead.
      expect(floorUnlocked(L(), FLOORS.ascent_f11)).toBe(true);
      expect(reachable(k, 'f11_road').has(NPCS[side.giver].spotId)).toBe(true);
      expect(reachable(k, 'f11_road').has('f11_roadstead')).toBe(true);
      join(k, side);
      expect(floorCleared(L(), FLOORS.ascent_f11)).toBe(false);
      setCounters(k, { [SEA_CRATES_WON]: 8 });
      expect(floorCleared(L(), FLOORS.ascent_f11), 'crates alone do not clear').toBe(false);
      won(k, 'f11_roadstead');
      expect(floorCleared(L(), FLOORS.ascent_f11)).toBe(true);

      // Floor 12: the side's own lane and the strait, never another side's lane.
      // (The cove is hidden until the port is searched: mark it combed.)
      expect(floorUnlocked(L(), FLOORS.ascent_f12)).toBe(true);
      patch(k, (s) => (s.world.explored.f12_landing = SPOTS.f12_landing.exploreTicks!));
      const r12 = reachable(k, 'f12_landing');
      expect(r12.has('f12_far_water')).toBe(true);
      expect(r12.has('f12_strait')).toBe(true);
      for (const [owner, lane] of Object.entries(lanes)) expect(r12.has(lane), `${side.id} sees ${lane}`).toBe(owner === side.id);
      setCounters(k, { [SEA_CRATES_WON]: 40 });
      expect(floorCleared(L(), FLOORS.ascent_f12)).toBe(false);
      won(k, 'f12_far_water');
      expect(floorCleared(L(), FLOORS.ascent_f12)).toBe(true);

      // Floor 13: the blockade by the picket line; the pilot's channel once bought.
      expect(floorUnlocked(L(), FLOORS.ascent_f13)).toBe(true);
      expect(reachable(k, 'f13_landing').has('f13_blockade')).toBe(true);
      const channel = visibleEdges(reads(k), worldOf(k), 'f13_landing').find((e) => e.to === 'f13_blockade')!;
      expect(conditionsMet(conditionReader(reads(k)), channel.requires!)).toBe(false);
      setCounters(k, { 'shop:buys:f13_pilot': 1 });
      expect(conditionsMet(conditionReader(reads(k)), channel.requires!)).toBe(true);
      setCounters(k, { [SEA_CRATES_WON]: 160 });
      won(k, 'f13_blockade');
      expect(floorCleared(L(), FLOORS.ascent_f13)).toBe(true);

      // Floor 14: only the side's own wing; its boss's kill is the clear.
      expect(floorUnlocked(L(), FLOORS.ascent_f14)).toBe(true);
      const r14 = reachable(k, 'f14_landing');
      for (const other of SIDES) {
        expect(r14.has(other.mission.spot), `${side.id} reaches ${other.mission.spot}`).toBe(other.id === side.id);
      }
      expect(floorCleared(L(), FLOORS.ascent_f14)).toBe(false);
      // Another side's boss stamps nothing.
      const stray = SIDES.find((o) => o.id !== side.id)!;
      kill(k, stray.mission.spot, stray.mission.monsterId);
      expect(counterOf(k, SEA_MISSION_DONE)).toBe(0);
      kill(k, side.mission.spot, side.mission.monsterId);
      expect(counterOf(k, SEA_MISSION_DONE)).toBe(1);
      expect(floorCleared(L(), FLOORS.ascent_f14)).toBe(true);
    });
  }

  it('a first climb never reaches the harbor', () => {
    expect(reachable(fresh(), 'f11_road').has('f11_quay')).toBe(false);
  });

  it('each mission boss is a once fight, and the side’s preparation opens its fight with a condition', () => {
    const prep: Record<string, string> = {
      merchants: 'f11_merchants_clearance',
      pirates: 'f11_pirates_signal',
      privateers: 'f11_privateers_letter',
      navy: 'f11_navy_lure',
    };
    for (const side of SIDES) {
      const spot = SPOTS[side.mission.spot];
      expect(spot.fightLimit).toBe(1);
      expect(spot.encounters?.some((e) => e.monsterId === side.mission.monsterId && e.once)).toBe(true);
      const way = Object.values(SPOTS)
        .flatMap((sp) => sp.connections)
        .find((c) => c.to === side.mission.spot)!;
      expect(way.approach?.requires).toEqual([{ type: 'quest', id: prep[side.id] }]);
      expect(way.approach?.enemies?.length).toBeGreaterThan(0);
    }
  });
});

// ---------- The map of floor 12 (old mapplan.test.ts) ----------

/**
 * The old `mapplan.test.ts` drew floor 12 with the UI's surveyed plan, which
 * is not ported (the UI step). Two of its cases state rules of the world that
 * the map of the published view carries: the hidden cove, and the forced
 * road into the strait. The route summaries (`routeInfo`, `noRouteSummary`)
 * are the UI step.
 */
describe('the map of floor 12', () => {
  const mapSpots = (k: Kernel) => (k.view().systems.world as WorldView).map.areas.flatMap((a) => a.spots);

  it('leaves a hidden road out, and the place at its end off the map', () => {
    const k = harborRun();
    standAt(k, 'f12_landing');
    const cove = 'f12_hidden_cove';
    expect(mapSpots(k).some((n) => n.id === cove)).toBe(false);
    // The quest names the cove; the road still waits for the landing to be searched.
    setCounters(k, { [acceptedKey(SEA_SIDES.pirates.joinQuest)]: 1 });
    expect(visibleEdges(reads(k), worldOf(k), 'f12_landing').some((e) => e.to === cove)).toBe(false);
    expect(mapSpots(k).some((n) => n.id === cove)).toBe(false);
    patch(k, (s) => (s.world.explored.f12_landing = SPOTS.f12_landing.exploreTicks!));
    expect(mapSpots(k).some((n) => n.id === cove)).toBe(true);
  });

  it('marks a forced road into the place it leads into, from the road alone', () => {
    const k = harborRun();
    standAt(k, 'f12_landing');
    patch(k, (s) => s.world.discovered.push('f12_strait'));
    expect(mapSpots(k).find((n) => n.id === 'f12_strait')?.forced).toBe(true);
    // The way back out of an ambush is not an ambush, and the strait itself forces no fight.
    standAt(k, 'f12_strait');
    expect(mapSpots(k).find((n) => n.id === 'f12_landing')?.forced).toBe(false);
    expect(SPOTS.f12_strait.forced).toBeUndefined();
  });
});

// ---------- The panel's controls (new) ----------

describe('the harbor readout and its controls', () => {
  const seaView = (k: Kernel): SeaView => k.view().systems.sea as SeaView;
  /** The panel's button path: the control is rendered, and a click sends the command its action carries. */
  function press(k: Kernel, id: string): boolean {
    const view = seaView(k);
    const html = render(SeaReadout, { props: { view, onAction: () => {} } }).body;
    const action = view.actions.find((a) => a.id === id);
    expect(action, `no ${id} action here`).toBeDefined();
    expect(html, `the readout renders no ${id} control`).toContain(`data-action="${id}"`);
    expect(html).toContain(action!.label);
    expect(action!.blocked, `${id} is disabled: ${action!.blocked}`).toBeNull();
    return k.dispatch(action!.command).ok;
  }

  it('is hidden off the harbor and shown at a berth, a water and a port onto a water', () => {
    const k = harborRun();
    standAt(k, 'f11_road');
    expect(seaView(k).shown).toBe(false);
    expect(render(SeaReadout, { props: { view: seaView(k), onAction: () => {} } }).body).not.toContain('sea-readout');
    for (const spot of ['f11_merchant_berth', 'f11_roadstead', 'f11_quay']) {
      standAt(k, spot);
      expect(seaView(k).shown, spot).toBe(true);
    }
  });

  it('a berth offers its side’s join quest; pressing it picks the side and withdraws the other berths', () => {
    const k = harborRun();
    standAt(k, NPCS[SEA_SIDES.privateers.giver].spotId);
    expect(seaView(k).actions.map((a) => a.label)).toEqual(['Sign with The Privateers']);
    expect(press(k, 'sign')).toBe(true);
    expect(sideOf(k)?.id).toBe('privateers');
    expect(seaView(k).actions).toEqual([]);
    standAt(k, NPCS[SEA_SIDES.navy.giver].spotId);
    expect(seaView(k).actions).toEqual([]);
  });

  it('at a water not sailing, the control starts the hunt, and the next leg resolves for the player', () => {
    const k = harborRun();
    join(k, SEA_SIDES.navy);
    standAt(k, 'f11_roadstead');
    // In port for a while: no fight decides presence before the leg ends.
    setClock(k, 3 * SEA.convoyTicks + SEA.legs * SEA.legTicks - 5);
    expect(seaView(k).convoy?.present).toBe(false);
    expect(seaView(k).convoy?.leg).toBe(SEA.legs);
    expect(press(k, 'sail')).toBe(true);
    expect(worldOf(k).activity).toBe('hunt');
    const sail = seaView(k).actions.find((a) => a.id === 'sail')!;
    expect(sail.blocked, 'sailing: the control stays, disabled').toBe('Sailing with the convoy.');
    for (let i = 0; i < 5; i++) k.tick();
    expect(counterOf(k, 'sea:f11_roadstead:leg')).toBe(SEA.legs);
  });
});
