/**
 * Port of the old `tests/desert.test.ts` (28 cases), step 4 port C7. Band 7,
 * the desert (old docs/FLOOR_IDEAS.md section 4): the Weighing on floor 19,
 * the judge's level rise, method drops and the killing blow's type, the seam
 * verb, the band's gates and clears, and the broker. The cases keep their
 * old names.
 *
 * Call shape changes:
 * - `encounterLevel(state, line, rolled)` is `encounterLevel(rise, counter,
 *   playerLevel, rolled)` of `levels`: the old one read the counter and the
 *   level from the state.
 * - `spawnMonster` is the combat helper `spawn` on the spot's encounter site;
 *   `spawnGroup` is a hunt started at a test site (`combat/hunt`).
 * - `spawnLevels(id, state)` takes a read context.
 * - `winByCondition` stood the player at the spot and ran the combat clock
 *   with the player's HP refilled each tick. Here the hunt at the real spot
 *   starts the fight; every foe is set to 1 HP and given the condition, the
 *   player is dazed (no swing lands) and given a large health pool through
 *   the probe's modifiers, so the condition is what kills.
 * - `claimedFinds(state, spot)` reads the world slice; `explore` is the
 *   command `world/select-activity` and ticks.
 * - `climbTo(s, bus, floor)` is the command `world/climb`; the log line is
 *   read from the log slice. Floor 18 lends its record a seam for one case,
 *   as the old case did.
 * - `startTravel` and `tickTravel` are one hop (`world/travel`) and ticks.
 *   The arrival tick runs the fight too, and the player's first blow spends
 *   the front crew member's surprise; the player is dazed for that case.
 * - The broker's sale is the command `materials/sell` at the quay and at the
 *   Foot; `resaleCeiling(state, line, qty)` takes the gold gain.
 * - The old `mercy` field is the mercy slice's ledger.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { dropRowsFor } from '../src/systems/loot';
import { spawnLevels } from '../src/systems/bestiary';
import { enemyKilled, hunt, type EncounterSite, type Enemy } from '../src/systems/combat';
import { clearMet, FLOORS, floorUnlocked, ladderFloors, type FloorDef } from '../src/systems/ladder';
import { encounterLevel, type LevelRise } from '../src/systems/levels';
import { heldOf, materialSellPrice, sellStackable, type MaterialsState } from '../src/systems/materials';
import type { MercyState } from '../src/systems/mercy';
import { MONSTERS, monsterTagsOf } from '../src/systems/monsters';
import { NPCS } from '../src/systems/npcs';
import { resaleCeiling, visibleLines } from '../src/systems/shops';
import { statOf } from '../src/systems/stats';
import { applyStatus, heldOf as conditionsOf, type StatusesState } from '../src/systems/statuses';
import { ADJACENCY, claimedFinds, climb, eligibleAt, selectActivity, spotCleared, SPOTS, type SpotDef } from '../src/systems/world';
import { combatOf, logOf, patchFight, setHp, spawn } from './combatHelpers';
import { ask, makeGame, patch, reads, setMods, slice } from './helpers';
import { counterOf, gameAt, hop, ladderOf, setCounters, walkUntilStill, worldOf } from './worldHelpers';

const FOOT = 'ascent_foot';
const TAKEN = 'flag:tomb:taken';
const DESERT_FLOORS = ['ascent_f18', 'ascent_f19', 'ascent_f20'];

type Encounter = NonNullable<SpotDef['encounters']>[number];

/** Every ladder floor below rung `index`, by id. */
const below = (index: number): string[] =>
  ladderFloors('the_ascent')
    .filter((f) => f.index < index)
    .map((f) => f.id);

/** Set the counters each floor's `clear` reads. The old fixture `clearFloors`. */
function clearFloors(k: Kernel, floorIds: string[]): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = Math.max(counterOf(k, c.key), c.value);
  }
  setCounters(k, values);
}

/** The character level, written as the old tests wrote `state.level`. */
const setLevel = (k: Kernel, level: number) => patch(k, (slices) => (slices.levels.level = level));

/** Units held of a material, plain or graded. */
const held = (k: Kernel, id: string): number => heldOf(slice<MaterialsState>(k, 'materials'), id);

/** The site of a spot as combat reads it (band 7 has no step and no dynamic levels). */
const siteOf = (spotId: string): EncounterSite => ({
  id: spotId,
  name: SPOTS[spotId].name,
  encounters: (SPOTS[spotId].encounters ?? []) as EncounterSite['encounters'],
});

/** The judge's row on floor 19's door. */
const judgeRow = (): Encounter => SPOTS.f19_door.encounters!.find((e) => e.monsterId === 'ph_sabaket')!;

/** Explore at the spot the game stands on for `ticks`. The old `explore`. */
function explore(k: Kernel, ticks: number): void {
  expect(k.dispatch(selectActivity({ activity: 'explore' })).ok).toBe(true);
  k.tick(ticks);
}

/** A game standing at `spot`, hunting, with a health pool no foe of the desert can empty. */
function hunter(spot: string, seed = 1): Kernel {
  const k = gameAt(seed, spot);
  setMods(k, [{ stat: 'stats/maxHp', kind: 'add', value: 1e7 }]);
  setHp(k, 1e7);
  expect(k.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);
  return k;
}

/**
 * Win the next fight at the spot the hunter stands on by damage over time:
 * every enemy at 1 HP and carrying `statusId`, the player dazed so no swing
 * lands. Returns the foes and the `lastHit` each kill carried.
 */
function winByCondition(k: Kernel, statusId: string): { foes: Enemy[]; lastHits: (string | null)[] } {
  for (let i = 0; i < 2000 && !combatOf(k).fight; i++) k.tick();
  expect(combatOf(k).fight, `${worldOf(k).spot}: no fight started`).toBeTruthy();
  setHp(k, 1e7);
  patchFight(k, (c) => {
    for (const e of c.fight!.enemies) if (e) e.hp = 1;
  });
  const foes = combatOf(k).fight!.enemies.filter((e): e is Enemy => e !== null);
  for (let i = 0; i < 8; i++) ask(k, applyStatus, { entity: PLAYER, app: { id: 'dazed', intensity: 1 } });
  for (const foe of foes) ask(k, applyStatus, { entity: foe.entity, app: { id: statusId, intensity: 5 } });
  const lastHits: (string | null)[] = [];
  const off = k.onEvent((event) => {
    if (event.type === enemyKilled.type) lastHits.push((event.payload as { lastHit: string | null }).lastHit);
  });
  for (let i = 0; i < 600 && combatOf(k).fight; i++) k.tick();
  off?.();
  expect(combatOf(k).fight, `${worldOf(k).spot}: the fight did not end`).toBeNull();
  expect(combatOf(k).lastFight?.outcome).toBe('won');
  return { foes, lastHits };
}

describe('the judge’s level (SpotEncounter.levelRise)', () => {
  // The entry's own example: B = 30, r = 0.1, C = 45.
  const EXAMPLE: LevelRise = { stat: TAKEN, share: 0.1, ceiling: 45 };
  const judgeAt = (taken: number, level: number): number => encounterLevel(EXAMPLE, taken, level, 30);

  it('matches the example points: six pieces at P 20, 30, 40, 50; three at P 30', () => {
    expect(judgeAt(6, 20)).toBe(42);
    expect(judgeAt(6, 30)).toBe(45);
    expect(judgeAt(6, 40)).toBe(45);
    expect(judgeAt(6, 50)).toBe(45);
    expect(judgeAt(3, 30)).toBe(39);
  });

  it('nothing taken is the base; every piece costs at least one level', () => {
    expect(judgeAt(0, 40)).toBe(30);
    expect(judgeAt(6, 5)).toBe(36); // round(6 × 0.1 × 5) = 3, floored at 6
    expect(judgeAt(1, 1)).toBe(31);
  });

  it('a line without levelRise keeps its roll', () => {
    expect(encounterLevel(undefined, 6, 30, 30)).toBe(30);
  });

  it('the live judge keeps 6r < 1 and a ceiling at or under the band’s top monster level', () => {
    const rise = judgeRow().levelRise!;
    expect(6 * rise.share).toBeLessThan(1);
    const top = Math.max(
      ...DESERT_FLOORS.flatMap((id) =>
        Object.values(SPOTS)
          .filter((sp) => sp.areaId === FLOORS[id].areaId)
          .flatMap((sp) => (sp.encounters ?? []).filter((e) => !e.levelRise).map((e) => e.level[1])),
      ),
    );
    expect(rise.ceiling).toBeLessThanOrEqual(top);
    expect(rise.ceiling).toBeGreaterThanOrEqual(judgeRow().level[1]);
  });

  it('the live judge is priced per piece: it rises with every piece taken until the ceiling', () => {
    // Pins the LIVE row, so a dial change that flattens the Weighing fails
    // here: with too little room between base and ceiling, the first piece or
    // two reach the cap and the rest are free.
    const row = judgeRow();
    const ceiling = row.levelRise!.ceiling;
    const curve = (level: number): number[] =>
      [0, 1, 2, 3, 4, 5, 6].map((taken) => encounterLevel(row.levelRise, taken, level, row.level[0]));
    for (const level of [15, 25, 35]) {
      const c = curve(level);
      for (let k = 1; k < c.length; k++) {
        // Never falls; strictly rises while there is room under the ceiling.
        if (c[k - 1] < ceiling) expect(c[k], `P ${level}: piece ${k}`).toBeGreaterThan(c[k - 1]);
        else expect(c[k], `P ${level}: piece ${k}`).toBe(ceiling);
      }
    }
    expect(new Set(curve(25)).size, 'P 25: the curve flattened').toBeGreaterThanOrEqual(3);
    // The manager's reference points (fix round 1).
    expect(curve(25)[3]).toBe(41);
    expect(curve(25)[6]).toBe(45);
    expect(curve(20)[3]).toBe(39);
    expect(curve(20)[6]).toBe(45);
  });

  it('a group filler rolled from a rising line rises with it', () => {
    const site: EncounterSite = {
      id: 'test_rising_den',
      name: 'Rising Den',
      groupWeights: [{ size: 3, weight: 100 }],
      encounters: [
        { monsterId: 'ph_scarab', weight: 1, level: [30, 30], levelRise: { stat: 'flag:test_rise', share: 0.1, ceiling: 45 } },
      ],
    };
    const k = makeGame({ seed: 1 });
    setCounters(k, { 'flag:test_rise': 6 });
    setLevel(k, 20);
    expect(k.dispatch(hunt({ site })).ok).toBe(true);
    for (let i = 0; i < 2000 && !combatOf(k).fight; i++) k.tick();
    const group = combatOf(k).fight!.enemies.filter((e): e is Enemy => e !== null);
    expect(group).toHaveLength(3);
    // 30 + max(6, round(6 × 0.1 × 20)) = 42, leader and both fillers.
    expect(group.map((m) => m.level)).toEqual([42, 42, 42]);
  });

  it('spawning applies it after the roll; a pinned override spawn does not', () => {
    const k = makeGame({ seed: 1 });
    const door = siteOf('f19_door');
    const base = judgeRow().level[0];
    expect(spawn(k, door).level).toBe(base);
    setCounters(k, { [TAKEN]: 2 });
    setLevel(k, 10);
    expect(spawn(k, door).level).toBe(base + 2); // max(2, round(2)) = 2
    setCounters(k, { [TAKEN]: 6 });
    setLevel(k, 20);
    expect(spawn(k, door).level).toBe(judgeRow().levelRise!.ceiling);
    expect(spawn(k, door, { monsterId: 'ph_sabaket', level: base }).level).toBe(base);
  });

  it('the bestiary’s level range reads the same function', () => {
    const k = makeGame({ seed: 1 });
    const base = judgeRow().level[0];
    expect(spawnLevels('ph_sabaket')).toEqual([base, base]);
    expect(spawnLevels('ph_sabaket', reads(k))).toEqual([base, base]);
    setCounters(k, { [TAKEN]: 1 });
    setLevel(k, 20);
    expect(spawnLevels('ph_sabaket', reads(k))).toEqual([base + 2, base + 2]);
  });
});

describe('the Weighing: the tomb seals when the judge falls', () => {
  it('searching the treasury takes all six goods, each bumping flag:tomb:taken', () => {
    const k = gameAt(1, 'f19_treasury');
    explore(k, 400);
    expect(counterOf(k, TAKEN)).toBe(6);
    expect(claimedFinds(worldOf(k), 'f19_treasury')).toHaveLength(6);
    expect(held(k, 'bronze_ingot')).toBeGreaterThan(0);
  });

  it('after the judge’s first kill nothing can be taken', () => {
    const k = gameAt(1, 'f19_treasury');
    setCounters(k, { 'boss:f19_door': 1 });
    explore(k, 400);
    expect(counterOf(k, TAKEN)).toBe(0);
    expect(claimedFinds(worldOf(k), 'f19_treasury')).toEqual([]);
    expect(held(k, 'bronze_ingot')).toBe(0);
  });

  it('goods taken before the clear stay counted; the rest stay sealed', () => {
    const k = gameAt(1, 'f19_treasury');
    explore(k, 200); // past 0.16, 0.33 and 0.5 of 360 ticks
    const before = counterOf(k, TAKEN);
    expect(before).toBe(3);
    setCounters(k, { 'boss:f19_door': 1 });
    explore(k, 300);
    expect(counterOf(k, TAKEN)).toBe(before);
    expect(claimedFinds(worldOf(k), 'f19_treasury')).toHaveLength(3);
  });

  it('the chamber → door edge is forced one way; the way back is a plain road', () => {
    const into = ADJACENCY.get('f19_chamber')!.find((e) => e.to === 'f19_door')!;
    const back = ADJACENCY.get('f19_door')!.find((e) => e.to === 'f19_chamber')!;
    expect(into.forced).toBe(true);
    expect(back.forced).toBeFalsy();
    // Exploring the chamber takes nothing: the goods are in their own room.
    expect(SPOTS.f19_chamber.finds ?? []).toEqual([]);
  });
});

describe('method drops (DropEntry.killedBy) and the killing blow (MonsterInstance.lastHit)', () => {
  it('unmatched rows leave the table and their weight rolls as nothing', () => {
    const loot = MONSTERS.ph_mummy.loot;
    const total = loot.entries.reduce((sum, e) => sum + e.weight, 0);
    const ids = (rows: ReturnType<typeof dropRowsFor>) => rows.filter((r) => r.kind !== 'nothing').map((r) => (r as { id: string }).id);
    const weight = (rows: ReturnType<typeof dropRowsFor>) => rows.reduce((sum, e) => sum + e.weight, 0);

    expect(ids(dropRowsFor(loot, 'heat'))).toEqual(['bone_ash']);
    expect(ids(dropRowsFor(loot, 'bludgeoning'))).toEqual(['bone_dust']);
    expect(ids(dropRowsFor(loot, 'slashing'))).toEqual([]);
    expect(ids(dropRowsFor(loot, undefined))).toEqual([]);
    // Every row keeps its authored share: the table weighs the same.
    for (const type of ['heat', 'bludgeoning', 'slashing', undefined] as const) {
      expect(weight(dropRowsFor(loot, type))).toBe(total);
    }
  });

  it('damage over time sets lastHit to its type', () => {
    for (const [status, type] of [
      ['poison', 'poison'],
      ['on_fire', 'heat'],
    ] as const) {
      const k = hunter('f18_forecourt');
      const { foes, lastHits } = winByCondition(k, status);
      expect(foes.map((f) => f.defId)).toEqual(['ph_sand_colossus']);
      expect(lastHits, status).toEqual([type]);
    }
  });

  it('a kill by an unmatched type banks no drought miss for the keyed row', () => {
    // The colossus: quicksilver (6%) is keyed to bludgeoning, the boss token
    // (10%) to nothing. Both sit under the 15% line, so mercy tracks both.
    const k = hunter('f18_forecourt');
    const keyed = 'loot:ph_sand_colossus:material:quicksilver';
    const plain = 'loot:ph_sand_colossus:material:boss_token';
    const ledger = () => slice<MercyState>(k, 'mercy').ledger;
    let plainSeen = false;
    for (let i = 0; i < 12; i++) {
      winByCondition(k, 'poison');
      expect(ledger()[keyed], `kill ${i}: a poison kill wrote the quicksilver ledger`).toBeUndefined();
      plainSeen ||= (ledger()[plain] ?? 0) > 0;
    }
    expect(plainSeen, 'the unkeyed rare row never banked a miss').toBe(true);
    expect(held(k, 'quicksilver')).toBe(0);
  });

  it('heat kills of mummies pay bone ash and never bone dust', () => {
    const k = hunter('f18_tomb_row', 7);
    let kills = 0;
    for (let fights = 0; kills < 40 && fights < 200; fights++) {
      for (const foe of winByCondition(k, 'on_fire').foes) {
        if (foe.defId === 'ph_mummy') kills += 1;
      }
    }
    expect(kills).toBeGreaterThanOrEqual(40);
    expect(held(k, 'bone_ash')).toBeGreaterThan(0);
    expect(held(k, 'bone_dust')).toBe(0);
  });
});

describe('the seam verb (FloorDef.seam)', () => {
  /** Floors up to 19 cleared and both gates met, standing on floor 18's landing. */
  function climber(): Kernel {
    const k = gameAt(0, FLOORS.ascent_f18.landing!);
    clearFloors(k, below(20));
    setCounters(k, { 'kills:tag:desert': 150 });
    return k;
  }
  const lastLine = (k: Kernel) => logOf(k).at(-1) ?? '';
  const climbTo = (k: Kernel, floor: string) => k.dispatch(climb({ floor })).ok;
  const arrive = (k: Kernel) => {
    walkUntilStill(k, 10_000);
    expect(worldOf(k).travel).toBeNull();
  };

  it('floor 20 → 21 is Sailing', () => {
    expect(FLOORS.ascent_f20.seam?.verb).toBe('Sailing');
  });

  it('is read on a climb of exactly one rung up from the floor that declares it', () => {
    // Floor 21 does not exist yet, so floor 18 lends its seam for the test.
    const f18 = FLOORS.ascent_f18 as FloorDef & { seam?: { verb?: string } };
    const had = f18.seam;
    f18.seam = { verb: 'Wading' };
    try {
      const k = climber();
      expect(climbTo(k, 'ascent_f19')).toBe(true);
      expect(lastLine(k)).toContain('Wading to');
      arrive(k);

      // Down a rung, then two rungs up: neither is the seam.
      expect(climbTo(k, 'ascent_f18')).toBe(true);
      expect(lastLine(k)).toContain('Descending to');
      arrive(k);
      expect(climbTo(k, 'ascent_f20')).toBe(true);
      expect(lastLine(k)).toContain('Climbing to');
      arrive(k);

      // Out of floor 20, down, Sailing stays on its own step.
      expect(climbTo(k, 'ascent_f19')).toBe(true);
      expect(lastLine(k)).toContain('Descending to');
    } finally {
      if (had) f18.seam = had;
      else delete f18.seam;
    }
  });

  it('climbing into floor 20 is an ordinary climb', () => {
    const k = climber();
    patch(k, (slices) => {
      slices.world.spot = FLOORS.ascent_f19.landing!;
      slices.world.discovered.push(FLOORS.ascent_f19.landing!);
    });
    expect(climbTo(k, 'ascent_f20')).toBe(true);
    expect(lastLine(k)).toContain('Climbing to');
  });
});

describe('the band’s gates', () => {
  it('every species on floors 18 to 20 carries the desert tag', () => {
    for (const id of DESERT_FLOORS) {
      for (const spot of Object.values(SPOTS).filter((sp) => sp.areaId === FLOORS[id].areaId)) {
        for (const e of spot.encounters ?? []) {
          expect(monsterTagsOf(MONSTERS[e.monsterId]), `${spot.id}: ${e.monsterId}`).toContain('desert');
        }
      }
    }
  });

  it('floor 19 opens at 60 desert kills, floor 20 at 150', () => {
    for (const [floor, needed] of [
      ['ascent_f19', 60],
      ['ascent_f20', 150],
    ] as const) {
      const k = makeGame({ seed: 0 });
      clearFloors(k, below(FLOORS[floor].index));
      setCounters(k, { 'kills:tag:desert': needed - 1 });
      expect(floorUnlocked(ladderOf(k), FLOORS[floor]), `${floor} at ${needed - 1}`).toBe(false);
      setCounters(k, { 'kills:tag:desert': needed });
      expect(floorUnlocked(ladderOf(k), FLOORS[floor]), `${floor} at ${needed}`).toBe(true);
    }
  });

  it('a desert kill counts toward the gates', () => {
    const k = hunter('f18_forecourt');
    winByCondition(k, 'poison');
    expect(counterOf(k, 'kills:tag:desert')).toBe(1);
  });
});

describe('each floor’s clear', () => {
  const eligibleIds = (k: Kernel, spot: string) => eligibleAt(reads(k), SPOTS[spot]).map((e) => e.monsterId);

  it('floor 18: the forecourt guardian’s kill, and it fights again', () => {
    const k = hunter('f18_forecourt');
    expect(clearMet(ladderOf(k), FLOORS.ascent_f18)).toBe(false);
    winByCondition(k, 'poison');
    expect(clearMet(ladderOf(k), FLOORS.ascent_f18)).toBe(true);
    expect(eligibleIds(k, 'f18_forecourt')).toEqual(['ph_sand_colossus']);
  });

  it('floor 19: the judge’s kill, and it fights again', () => {
    const k = hunter('f19_door');
    expect(clearMet(ladderOf(k), FLOORS.ascent_f19)).toBe(false);
    const { foes } = winByCondition(k, 'poison');
    expect(foes.map((f) => f.defId)).toEqual(['ph_sabaket']);
    expect(clearMet(ladderOf(k), FLOORS.ascent_f19)).toBe(true);
    expect(eligibleIds(k, 'f19_door')).toEqual(['ph_sabaket']);
  });

  it('floor 20: the roadstead’s one fight, against all three of the crew', () => {
    const k = hunter('f20_roadstead');
    expect(clearMet(ladderOf(k), FLOORS.ascent_f20)).toBe(false);
    const { foes } = winByCondition(k, 'poison');
    expect(foes.map((m) => m.defId)).toEqual(['ph_roadstead_crew', 'ph_roadstead_crew', 'ph_roadstead_crew']);
    expect(clearMet(ladderOf(k), FLOORS.ascent_f20)).toBe(true);
    expect(spotCleared(reads(k), SPOTS.f20_roadstead)).toBe(true);
  });

  it('three obelisk reads leave the roadstead crew surprised; two do not', () => {
    for (const [reads_, surprised] of [
      [2, false],
      [3, true],
    ] as const) {
      const k = gameAt(1, 'f20_quay');
      setCounters(k, { 'flag:chart': reads_ });
      // The old case ran the travel clock only and read the crew at arrival.
      // Here the arrival tick runs the fight too, and a surprised formation
      // hands the player the first move, which spends the front one's
      // surprise: the player is dazed so that no blow lands in that tick.
      for (let i = 0; i < 8; i++) ask(k, applyStatus, { entity: PLAYER, app: { id: 'dazed', intensity: 1 } });
      expect(hop(k, 'f20_roadstead')).toBe(true);
      walkUntilStill(k, 10_000);
      const crew = (combatOf(k).fight?.enemies ?? []).filter((e): e is Enemy => e !== null);
      expect(crew.length, 'the forced edge started no fight').toBe(3);
      const statuses = slice<StatusesState>(k, 'statuses');
      for (const m of crew) {
        expect(conditionsOf(statuses, m.entity).some((st) => st.id === 'surprised'), `${reads_} reads`).toBe(surprised);
      }
    }
  });
});

// New here: the finds of floors 18 and 19 the old file did not read.
describe('the obelisks and the side tomb (new, step 4 port C7)', () => {
  const OBELISKS = ['f18_first_obelisk', 'f18_second_obelisk', 'f18_third_obelisk', 'f18_fourth_obelisk', 'f18_fifth_obelisk'];

  it('each of the five obelisks is a haven whose read adds one bearing to the chart, once', () => {
    const k = gameAt(1, OBELISKS[0]);
    for (const [i, spot] of OBELISKS.entries()) {
      expect(SPOTS[spot].activities.some((a) => a.kind === 'rest'), spot).toBe(true);
      patch(k, (slices) => {
        slices.world.spot = spot;
        if (!slices.world.discovered.includes(spot)) slices.world.discovered.push(spot);
      });
      explore(k, 200); // the read is at the end of 180 ticks
      expect(counterOf(k, 'flag:chart'), spot).toBe(i + 1);
      expect(claimedFinds(worldOf(k), spot), spot).toHaveLength(1);
    }
    // A read obelisk pays nothing more.
    explore(k, 200);
    expect(counterOf(k, 'flag:chart')).toBe(5);
  });

  it('the side tomb opens at Heat Resistance 10 and pays its three finds', () => {
    const k = gameAt(1, 'f19_valley');
    expect(hop(k, 'f19_side_tomb')).toBe(false);
    patch(k, (slices) => (slices.skills.skills.heat_resistance = { level: 10, xp: 0 }));
    expect(hop(k, 'f19_side_tomb')).toBe(true);
    walkUntilStill(k, 1000);
    expect(worldOf(k).spot).toBe('f19_side_tomb');
    explore(k, 400);
    expect(claimedFinds(worldOf(k), 'f19_side_tomb')).toEqual(['f19_side_quicksilver', 'f19_side_ash', 'f19_side_coffer']);
    expect(held(k, 'quicksilver')).toBe(3);
    expect(held(k, 'bone_ash')).toBe(4);
    expect(held(k, 'brimstone')).toBe(2);
  });
});

describe('the broker', () => {
  it('sells nothing, so nothing it holds can be bought back below resale', () => {
    const broker = NPCS.f20_broker;
    expect(broker.spotId).toBe('f20_quay');
    expect(visibleLines(reads(makeGame({ seed: 0 })), broker)).toEqual([]);
  });

  it('buys at the global sell price: the quay pays what any other spot pays', () => {
    // Bronze ingots: a grave good, and a plain (ungraded) stack.
    const paid = (spot: string): number => {
      const k = gameAt(0, spot);
      patch(k, (slices) => {
        slices.materials.counts.bronze_ingot = 5;
        slices.gold.gold = 0;
      });
      const gain = statOf(reads(k), 'goldGain');
      const expected = materialSellPrice('bronze_ingot', gain) * 5;
      // The no-arbitrage floor reads the same global formula.
      expect(resaleCeiling({ kind: 'material', id: 'bronze_ingot' }, gain)).toBe(materialSellPrice('bronze_ingot', gain));
      expect(k.dispatch(sellStackable({ id: 'bronze_ingot', quality: 'c', qty: 5 })).ok).toBe(true);
      const got = slice<{ gold: number }>(k, 'gold').gold;
      expect(got).toBe(expected);
      return got;
    };
    expect(paid('f20_quay')).toBe(paid(FOOT));
  });
});
