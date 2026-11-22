/**
 * Port of the old `tests/stronghold.test.ts`: floor 11's stronghold. Holding
 * the wave ends the run unasked, and the stronghold is kept on every run
 * after. The cases keep their old names.
 *
 * Call shape changes:
 * - `prestigeNow(state)` is the command `prestige/now`; the next run is read
 *   from the slices after it. `canPrestige`, `strongholdHeld` and
 *   `autoPrestigeDue` take a condition reader.
 * - `Game.tick` is `kernel.tick`: the automatic prestige is the prestige
 *   system's tick, through `ctx.endRun()`.
 * - `runOfflineProgress(game, ms)` is `catchUp` over the save for the same
 *   number of ticks.
 * - `eligibleEncounters(state, SPOTS[id])` is `eligibleAt(reads, spot)`.
 * - `state.bonusTime.banked` is the `bonus` slice.
 * - `floorUnlocked(state, floor)` takes the ladder reader.
 *
 * The harbor half of "its clear is the harbor’s roadstead" (the road's edge
 * on to `f11_quay`) came with port C3.
 *
 * Left out: the offline summary of
 * the old case (kills and gold not negative) has no counterpart: the summary
 * is the UI step.
 */
import { describe, expect, it } from 'vitest';
import { catchUp, TPS, type Kernel } from '../src/kernel';
import { systems } from '../src/systems';
import type { BonusState } from '../src/systems/bonus';
import { FLOORS, floorUnlocked } from '../src/systems/ladder';
import {
  autoPrestigeDue,
  canPrestige,
  prestigeNow,
  STRONGHOLD_KEY,
  STRONGHOLD_WAVE,
  strongholdHeld,
  type PrestigeState,
} from '../src/systems/prestige';
import { conditionReader } from '../src/systems/skills';
import { TUTORIAL_EXIT } from '../src/systems/tutorial';
import { eligibleAt, SPOTS } from '../src/systems/world';
import { makeGame, patch, reads, slice } from './helpers';
import { counterOf, ladderOf, setCounters, worldOf } from './worldHelpers';

const fresh = (seed = 0): Kernel => makeGame({ seed });
const prestigeOf = (k: Kernel): PrestigeState => slice<PrestigeState>(k, 'prestige');
const bankOf = (k: Kernel): number => slice<BonusState>(k, 'bonus').banked;
const reader = (k: Kernel) => conditionReader(reads(k));

/** The wave held: every fight on the wall won. */
function held(k: Kernel): Kernel {
  setCounters(k, { 'fights:f11_wall': STRONGHOLD_WAVE });
  return k;
}

/** Both repairs done: `f11_arm_the_wall` turned in. */
function armed(k: Kernel): Kernel {
  patch(k, (s) => {
    s.quests.quests.f11_shore_up_the_gate = { status: 'done', progress: [0, 0] };
    s.quests.quests.f11_arm_the_wall = { status: 'done', progress: [0, 0] };
  });
  return k;
}

/** Set the counters each floor's `clear` reads, as if the player had cleared it. The old `clearFloors`. */
function clearFloors(k: Kernel, floorIds = ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6']): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(k, values);
}

function prestige(k: Kernel): void {
  const result = k.dispatch(prestigeNow());
  if (!result.ok) throw new Error(result.reason);
}

const wallMonsters = (k: Kernel): string[] => eligibleAt(reads(k), SPOTS.f11_wall).map((e) => e.monsterId);

describe('the stronghold opens prestige and ends the run', () => {
  it('holding the wave opens prestige without the warchief', () => {
    const k = fresh();
    expect(canPrestige(reader(k))).toBe(false);
    held(k);
    expect(strongholdHeld(reader(k))).toBe(true);
    expect(canPrestige(reader(k))).toBe(true);
    expect(autoPrestigeDue(reader(k))).toBe(true);
  });

  it('the next run keeps the stronghold and stamps its key', () => {
    const k = held(fresh());
    prestige(k);
    expect(prestigeOf(k).stronghold).toBe(true);
    expect(counterOf(k, STRONGHOLD_KEY)).toBe(1);
    // A later run cannot hold it again, so it never prestiges unasked.
    held(k);
    expect(strongholdHeld(reader(k))).toBe(false);
    expect(autoPrestigeDue(reader(k))).toBe(false);
  });

  it('the stronghold carries through every later prestige', () => {
    const k = held(fresh());
    prestige(k);
    clearFloors(k);
    prestige(k);
    expect(prestigeOf(k).count).toBe(2);
    expect(prestigeOf(k).stronghold).toBe(true);
    expect(counterOf(k, STRONGHOLD_KEY)).toBe(1);
  });

  it('a prestige from the warchief alone leaves the stronghold unheld', () => {
    const k = fresh();
    clearFloors(k);
    prestige(k);
    expect(prestigeOf(k).stronghold).toBe(false);
    expect(slice<{ counts: Record<string, number> }>(k, 'counters').counts[STRONGHOLD_KEY]).toBeUndefined();
  });

  it('the unasked prestige keeps the bank; a chosen one does not', () => {
    const auto = held(fresh());
    patch(auto, (s) => (s.bonus.banked = 20_000));
    prestige(auto);
    expect(bankOf(auto)).toBe(20_000);
    const chosen = fresh();
    clearFloors(chosen);
    patch(chosen, (s) => (s.bonus.banked = 20_000));
    prestige(chosen);
    expect(bankOf(chosen)).toBe(0);
  });

  it('Game.tick prestiges on the tick after the wave is held', () => {
    const k = held(fresh());
    k.tick();
    expect(prestigeOf(k).count).toBe(1);
    expect(prestigeOf(k).review).toBe(true);
    expect(prestigeOf(k).stronghold).toBe(true);
    expect(worldOf(k).spot).toBe(TUTORIAL_EXIT);
  });

  it('offline catch-up prestiges once, banks the rest and reports no negative gains', () => {
    const k = held(fresh());
    const back = makeGame();
    const ticks = 60 * 60 * TPS;
    expect(back.load(catchUp({ systems, envelope: k.save(0), ticks, now: 0 })).ok).toBe(true);
    expect(prestigeOf(back).count).toBe(1);
    expect(bankOf(back)).toBeGreaterThan(0);
    // Idle at the Foot for the rest of the hour: every tick of the new run but its first is banked.
    expect(bankOf(back)).toBeGreaterThanOrEqual(ticks - 2);
  });
});

describe('the wave on the wall', () => {
  it('is shut until the second repair quest is done', () => {
    expect(wallMonsters(fresh())).toEqual([]);
    expect(wallMonsters(armed(fresh())).length).toBeGreaterThan(0);
  });

  it('seven fights of raiders and brutes, then the captain', () => {
    const k = armed(fresh());
    for (let won = 0; won < STRONGHOLD_WAVE - 1; won++) {
      setCounters(k, { 'fights:f11_wall': won });
      expect(wallMonsters(k), `after ${won} won`).not.toContain('ph_siege_captain');
    }
    setCounters(k, { 'fights:f11_wall': STRONGHOLD_WAVE - 1 });
    expect(wallMonsters(k)).toEqual(['ph_siege_captain']);
  });

  it('the wall holds as many fights as the wave needs', () => {
    expect(SPOTS.f11_wall.fightLimit).toBe(STRONGHOLD_WAVE);
  });

  it('is shut on every run after the stronghold', () => {
    const k = armed(fresh());
    setCounters(k, { [STRONGHOLD_KEY]: 1 });
    expect(wallMonsters(k)).toEqual([]);
  });
});

describe('the hold door and the wall stair', () => {
  it('the hold is not a caravan stop, so a save that rode there before cannot ride back in', () => {
    expect(SPOTS.base_entrance.waypoint).toBeFalsy();
  });

  it('the wall is reachable only while armed and before the stronghold', () => {
    const stair = SPOTS.f11_yard.connections.find((c) => c.to === 'f11_wall')!;
    expect(stair.requires).toEqual([
      { type: 'quest', id: 'f11_arm_the_wall' },
      { type: 'statMax', key: STRONGHOLD_KEY, value: 0 },
    ]);
    expect(SPOTS.f11_yard.activities.some((a) => a.kind === 'hunt')).toBe(false);
  });
});

describe('floor 11 on the ladder', () => {
  it('opens only once every floor below is cleared', () => {
    const k = fresh();
    patch(k, (s) => (s.prestige.purchases.city_key = 1));
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f11)).toBe(false);
    clearFloors(
      k,
      Object.values(FLOORS)
        .filter((f) => f.bandId && f.index < 11)
        .map((f) => f.id),
    );
    expect(floorUnlocked(ladderOf(k), FLOORS.ascent_f11)).toBe(true);
  });

  it('its clear is the harbor’s roadstead, which a first climb never reaches', () => {
    expect(FLOORS.ascent_f11.clear).toEqual([
      { type: 'stat', key: 'sea:crates:won', value: 8 },
      { type: 'stat', key: 'fights:f11_roadstead', value: 1 },
    ]);
    // Port C3: the road on to the quay.
    expect(SPOTS.f11_road.connections.find((c) => c.to === 'f11_quay')?.requires).toEqual([
      { type: 'stat', key: STRONGHOLD_KEY, value: 1 },
    ]);
  });
});
