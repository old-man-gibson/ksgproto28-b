/**
 * Port of the old `tests/band3-wards-8-10.test.ts` (11 cases): wards 8 to 10
 * of band 3. Each ward's keeper takes a form by the ward's position: how many
 * of the other three wards are cleared this run. As in the old file, every
 * test writes the position counter itself and clears that many other wards,
 * which sets the band's level step to match. The cases keep their old names.
 *
 * Call shape changes:
 * - `new Game(createInitialState(seed, FOOT))` is `gameAt`; `state.stats`
 *   writes are `setCounters`; the city key is bought through `patch`.
 * - `eligibleEncounters(state, SPOTS[id])` is `eligibleAt(reads, spot)`;
 *   `spawnMonster` and `spawnGroup` take a context and the spot's encounter
 *   site (`siteOf`, which carries the band's level step).
 * - `statsFromAttrs(baseMonsterAttrs(def, level))` is
 *   `monsterStatsFromAttrs(baseMonsterAttrs(def, level))`.
 * - `winKeeperFight` wrote `state.combat` and called `tickCombat` with the
 *   player's HP refilled each tick. Here the combat command `combat/hunt`
 *   opens the fight at the keeper's site as a hunt spawns it; every enemy is
 *   set to 1 HP and set on fire through the request `statuses/apply`, and the
 *   player's maximum HP is raised by the probe so the player stays standing.
 * - `floorCleared` and `spotCleared` take the read context.
 */
import { describe, expect, it } from 'vitest';
import type { Ctx, Kernel } from '../src/kernel';
import { hunt, spawnGroup, type CombatState, type Enemy } from '../src/systems/combat';
import { FLOORS, floorCleared } from '../src/systems/ladder';
import { baseMonsterAttrs, innateArmor, innateResistances, MONSTERS, monsterTagSet } from '../src/systems/monsters';
import type { PrestigeState } from '../src/systems/prestige';
import type { ResourcesState } from '../src/systems/resources';
import { monsterStatsFromAttrs, statMod } from '../src/systems/stats';
import { applyStatus } from '../src/systems/statuses';
import { eligibleAt, siteOf, SPOTS, spotCleared } from '../src/systems/world';
import { combatOf, patchFight, spawn } from './combatHelpers';
import { ask, patch, reads, run, setMods } from './helpers';
import { counterOf, gameAt, ladderOf, setCounters } from './worldHelpers';

const FOOT = 'ascent_foot';
const WARDS = ['ascent_f7', 'ascent_f8', 'ascent_f9', 'ascent_f10'];
const TO_PRESTIGE = ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6'];

interface Keeper {
  floor: string;
  spot: string;
  /** The keeper's monster at positions 0 to 3. */
  forms: string[];
  /** Its level at positions 0 to 3: the row's base plus the band's step. */
  levels: number[];
}

const KEEPERS: Keeper[] = [
  {
    floor: 'ascent_f8',
    spot: 'f8_lodge',
    forms: ['ph_rogue_beast_young', 'ph_rogue_beast_young', 'ph_rogue_beast_final', 'ph_rogue_beast_final'],
    levels: [14, 16, 19, 23],
  },
  {
    floor: 'ascent_f9',
    spot: 'f9_ossuary',
    forms: ['ph_death_squire', 'ph_death_squire', 'death_knight', 'death_knight'],
    levels: [14, 16, 18, 22],
  },
  {
    floor: 'ascent_f10',
    spot: 'f10_foundry',
    forms: ['ph_ore_eater_1', 'ph_ore_eater_2', 'ph_ore_eater_3', 'ph_ore_eater_4'],
    levels: [14, 16, 19, 23],
  },
];

const SIZES = ['diminutive', 'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan', 'colossal'];
const sizeOf = (id: string): number => SIZES.findIndex((s) => MONSTERS[id].tags.includes(s));

/** Book-value health and damage of a species at a level, before tier and variance. */
const bookStats = (id: string, level: number) => monsterStatsFromAttrs(baseMonsterAttrs(MONSTERS[id], level));

/** Set the counters each floor's `clear` reads. The old fixture `clearFloors`. */
function clearFloors(k: Kernel, floorIds: string[] = TO_PRESTIGE): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = Math.max(counterOf(k, c.key), c.value);
  }
  setCounters(k, values);
}

/**
 * The city open (floors 1-6 cleared, the key owned) with `pos` of the other
 * wards cleared and the ward's position counter written as the engine would.
 */
function atPosition(floor: string, pos: number, seed = 1): Kernel {
  const k = gameAt(seed, FOOT);
  clearFloors(k);
  patch(k, (slices) => {
    (slices.prestige as PrestigeState).purchases.city_key = 1;
  });
  clearFloors(
    k,
    WARDS.filter((w) => w !== floor).slice(0, pos),
  );
  setCounters(k, { [`band:pos:${floor}`]: pos });
  return k;
}

const rowsAt = (k: Kernel, spotId: string) => eligibleAt(reads(k), SPOTS[spotId]).map((e) => e.monsterId);

/**
 * Win the keeper fight by damage over time: the field spawned as a hunt would
 * spawn it, every enemy at 1 HP and on fire (no form resists heat), the player
 * kept standing.
 */
function winKeeperFight(k: Kernel, spotId: string): Enemy[] {
  setMods(k, [statMod('maxHp', 'add', 1e6)]);
  patch(k, (slices) => {
    (slices.resources as ResourcesState).values.hp = 1e6;
  });
  const result = k.dispatch(hunt({ site: siteOf(reads(k), SPOTS[spotId]) }));
  expect(result.ok, `${spotId}: the hunt did not start`).toBe(true);
  for (let i = 0; i < 50 && !combatOf(k).fight; i++) k.tick();
  expect(combatOf(k).fight, `${spotId}: no fight opened`).not.toBeNull();
  const foes = combatOf(k).fight!.enemies.filter((e): e is Enemy => e !== null);
  patchFight(k, (c) => {
    for (const e of c.fight!.enemies) if (e) e.hp = 1;
  });
  for (const foe of foes) ask(k, applyStatus, { entity: foe.entity, app: { id: 'on_fire', intensity: 5 } });
  for (let i = 0; i < 100 && combatOf(k).fight; i++) k.tick();
  expect(combatOf(k).fight, `${spotId}: the fight did not end`).toBeNull();
  return foes;
}

describe('the keepers of wards 8 to 10, by position', () => {
  it('each position leaves exactly one keeper row, the form the design names', () => {
    for (const k of KEEPERS) {
      for (let pos = 0; pos < 4; pos++) {
        const g = atPosition(k.floor, pos);
        expect(rowsAt(g, k.spot), `${k.spot} at position ${pos}`).toEqual([k.forms[pos]]);
      }
    }
  });

  it('the keeper spawns at its row’s base level plus the band’s step', () => {
    for (const k of KEEPERS) {
      for (let pos = 0; pos < 4; pos++) {
        const g = atPosition(k.floor, pos);
        const m = spawn(g, siteOf(reads(g), SPOTS[k.spot]));
        expect(m.defId, `${k.spot} at position ${pos}`).toBe(k.forms[pos]);
        expect(m.level, `${k.spot} at position ${pos}`).toBe(k.levels[pos]);
      }
    }
  });

  it('a keeper fight is the keeper alone', () => {
    for (const k of KEEPERS) {
      for (let pos = 0; pos < 4; pos++) {
        const g = atPosition(k.floor, pos);
        const site = siteOf(reads(g), SPOTS[k.spot]);
        for (let i = 0; i < 30; i++) {
          const field = run(g, (ctx) => {
            const scratch = Object.create(ctx) as Ctx<CombatState>;
            Object.defineProperty(scratch, 'state', { value: { nextEntity: 1 } });
            return spawnGroup(scratch, site);
          }).filter((e) => e !== null);
          expect(
            field.map((e) => e!.defId),
            `${k.spot} at position ${pos}`,
          ).toEqual([k.forms[pos]]);
        }
      }
    }
  });

  it('only the keeper rows read the position', () => {
    // Only the keeper rows read the position: the hunts are the same table at
    // every position, and only the band's step moves their levels.
    for (const k of KEEPERS) {
      const spots = Object.values(SPOTS).filter((s) => s.areaId === FLOORS[k.floor].areaId);
      for (const spot of spots) {
        const readsPos = (spot.encounters ?? []).some((e) =>
          (e.requires ?? []).some((c) => (c.type === 'stat' || c.type === 'statMax') && c.key.startsWith('band:pos:')),
        );
        expect(readsPos, spot.id).toBe(spot.id === k.spot);
      }
    }
  });
});

describe('the floors’ clears', () => {
  it('each clear is the keeper spot’s one fight, naming no monster', () => {
    for (const k of KEEPERS) {
      expect(FLOORS[k.floor].clear, k.floor).toEqual([{ type: 'stat', key: `fights:${k.spot}`, value: 1 }]);
      expect(SPOTS[k.spot].fightLimit, k.spot).toBe(1);
    }
  });

  it('winning the keeper fight clears the floor, whichever form fell', () => {
    for (const k of KEEPERS) {
      for (let pos = 0; pos < 4; pos++) {
        const g = atPosition(k.floor, pos);
        expect(floorCleared(ladderOf(g), FLOORS[k.floor]), `${k.floor} before the fight`).toBe(false);
        const [foe] = winKeeperFight(g, k.spot);
        expect(foe.defId).toBe(k.forms[pos]);
        expect(counterOf(g, `fights:${k.spot}`), `${k.spot} at position ${pos}`).toBe(1);
        expect(floorCleared(ladderOf(g), FLOORS[k.floor]), `${k.floor} at position ${pos}`).toBe(true);
        // The spot is spent: no form comes back for a second fight.
        expect(spotCleared(reads(g), SPOTS[k.spot]), `${k.spot} at position ${pos}`).toBe(true);
      }
    }
  });
});

describe('the forms', () => {
  it('the ore eater grows with each stage: health, armour and size all rise', () => {
    const stages = KEEPERS[2].forms;
    for (const level of [14, 23]) {
      const hp = stages.map((id) => bookStats(id, level).maxHp);
      for (let i = 1; i < 4; i++) expect(hp[i], `stage ${i + 1} health at ${level}`).toBeGreaterThan(hp[i - 1]);
    }
    const armor = stages.map((id) => innateArmor(id));
    const size = stages.map(sizeOf);
    expect(size[0], 'stage 1 carries a size tag').toBeGreaterThanOrEqual(0);
    for (let i = 1; i < 4; i++) {
      expect(armor[i], `stage ${i + 1} armour`).toBeGreaterThan(armor[i - 1]);
      expect(size[i], `stage ${i + 1} size`).toBeGreaterThan(size[i - 1]);
    }
  });

  it('every ore eater stage is shelled: edges and points resisted, blunt blows taken harder', () => {
    for (const id of KEEPERS[2].forms) {
      const res = innateResistances(id);
      expect(res.slashing, id).toBeGreaterThan(0);
      expect(res.piercing, id).toBeGreaterThan(0);
      expect(res.bludgeoning, id).toBeLessThan(0);
      expect(innateArmor(id), id).toBeGreaterThanOrEqual(6);
    }
  });

  it('the later form is harder than the earlier at the same level', () => {
    for (const [early, late] of [
      ['ph_rogue_beast_young', 'ph_rogue_beast_final'],
      ['ph_death_squire', 'death_knight'],
    ]) {
      for (const level of [14, 19, 23]) {
        const a = bookStats(early, level);
        const b = bookStats(late, level);
        expect(b.maxHp, `${late} vs ${early} health at ${level}`).toBeGreaterThan(a.maxHp);
        expect(b.damage, `${late} vs ${early} damage at ${level}`).toBeGreaterThan(a.damage);
      }
    }
    expect(sizeOf('ph_rogue_beast_final')).toBeGreaterThan(sizeOf('ph_rogue_beast_young'));
  });
});

describe('floor 8', () => {
  it('has no goblins left: no hunt, keeper or escort on the floor is a goblin', () => {
    const spots = Object.values(SPOTS).filter((s) => s.areaId === FLOORS.ascent_f8.areaId);
    expect(spots.length).toBeGreaterThan(0);
    for (const spot of spots) {
      for (const e of spot.encounters ?? []) {
        for (const id of [e.monsterId, ...(MONSTERS[e.monsterId].escorts ?? [])]) {
          expect(monsterTagSet(id).has('goblin'), `${spot.id}: ${id}`).toBe(false);
        }
      }
    }
  });

  it('every hunt on the floor is beasts', () => {
    const spots = Object.values(SPOTS).filter((s) => s.areaId === FLOORS.ascent_f8.areaId);
    for (const spot of spots) {
      for (const e of spot.encounters ?? []) expect(monsterTagSet(e.monsterId).has('beast'), `${spot.id}: ${e.monsterId}`).toBe(true);
    }
  });
});
