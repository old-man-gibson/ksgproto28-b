/**
 * Port of the old `tests/festival.test.ts`: the Vermin Festival, floors 15
 * and 16 (`src/systems/festival`). The cases keep their old names.
 *
 * Call shape changes:
 * - `new Game(state)` is a kernel over the real systems; the old state
 *   writes are `patch`, `setCounters`, `giveItem` and `equip`.
 * - `game.climbTo(floor)` is the command `world/climb`; `game.tick()` is
 *   `kernel.tick()`. `festivalRun(s)` reads the `festival` slice.
 * - `s.stats[key]` is the `counters` slice; `s.totalTicks` is the clock's.
 *   `kills:weapon:<family>` is the festival slice's `weaponKills[family]`.
 * - `lockoutLeft(s)` takes the slice and the clock's tick.
 * - `prestigeNow(s, 1)` is the command `prestige/now`, after the floors that
 *   open prestige are cleared; the next run is read from the slices after it.
 * - `game.spendFestivalToken(i, choice)` is `festival/spend-token`;
 *   `game.takeFromStash(i)` is `items/take-from-stash`; `stashToken(s, seed)`
 *   writes the token into the legacy with `patch`.
 * - `s.prestige.stash.tokens`, `festivalBonus` and `festivalTechniques` are
 *   the `festival` slice's `legacy`; the stash's items are the `items`
 *   slice's `stash`.
 *
 * Floor 16 and the royale are step 4 port C5. Every case that climbs into
 * floor 16 or plays the royale is an `it.todo` with that port. A royale won
 * is the debug command `festival/debug-win` here, from the hall, so the
 * rewards, the tokens and the hidden title run now; the old cases climbed
 * the ladder into the royale and played it.
 *
 * The festival clock's offline cases ("pauses offline", "banks at most the
 * cap", "the summary reports", "a catch-up whose climb lands in the dark
 * room", "the quiet short-gap path") wait for a kernel decision: the old
 * catch-up loop stopped at the first tick the festival held the player and
 * banked the rest. They are `it.todo`.
 *
 * Left out: "an attempt started before the door took flasks returns its gear
 * all the same" was a save from before the door held flasks; this save
 * starts at version 1 with the field.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AlchemyState } from '../src/systems/alchemy';
import type { AttributesState } from '../src/systems/attributes';
import type { ClockState } from '../src/systems/clock';
import { totalTicksOf } from '../src/systems/clock';
import type { CombatState } from '../src/systems/combat';
import {
  DARK_FLOOR,
  DARK_ROOM,
  DARK_ROOM_WAVES,
  debugWin,
  FESTIVAL_DOOR_KEY,
  FESTIVAL_REWARD,
  FESTIVAL_SWIFT_KEY,
  FESTIVAL_WINS_KEY,
  festivalLadder,
  issuedWeapon,
  LOCKOUT_TICKS,
  lockoutLeft,
  PREP_TICKS,
  ROYALE_FLOOR,
  spendToken,
  SURVIVOR_LEVELS,
  survivorLevel,
  SWIFT_ENTRY_TICKS,
  TOKEN_BONUS,
  TOKEN_REGALIA,
  TOKEN_TECHNIQUES,
  offersOf,
  type FestivalState,
  type TokenChoice,
} from '../src/systems/festival';
import { sellItems, takeFromStash, type ItemInstance, type ItemsState } from '../src/systems/items';
import { FLOORS, floorCleared, floorUnlocked, TOWERS, type LadderView } from '../src/systems/ladder';
import type { MartialState } from '../src/systems/martial';
import type { MaterialsState } from '../src/systems/materials';
import { prestigeNow } from '../src/systems/prestige';
import { conditionReader } from '../src/systems/skills';
import { ATTRIBUTE_IDS } from '../src/systems/stats';
import { TITLES, type TitlesState } from '../src/systems/titles';
import { climb as climbCommand, SPOTS, travelTo, type WorldView } from '../src/systems/world';
import { playerStats, setHp } from './combatHelpers';
import { equip, giveItem, makeGame, patch, reads, slice, unequip } from './helpers';
import { counterOf, setCounters, worldOf } from './worldHelpers';

const FOOT = TOWERS.the_ascent.hubSpot;
const BELOW = Object.values(FLOORS)
  .filter((f) => f.bandId !== undefined && f.index < 15)
  .map((f) => f.id);
const PRESTIGE_FLOORS = ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6'];

const festivalOf = (k: Kernel): FestivalState => slice<FestivalState>(k, 'festival');
const runOf = (k: Kernel) => festivalOf(k).run;
const itemsOf = (k: Kernel): ItemsState => slice<ItemsState>(k, 'items');
const nowOf = (k: Kernel): number => totalTicksOf(slice<ClockState>(k, 'clock'));
const lockLeft = (k: Kernel): number => lockoutLeft(festivalOf(k), nowOf(k));
const reader = (k: Kernel) => conditionReader(reads(k));
const fightOf = (k: Kernel) => slice<CombatState>(k, 'combat').fight;

/** Set the counters each floor's `clear` reads, as if the player had cleared it. The old `clearFloors`. */
function clearFloors(k: Kernel, floorIds: string[]): void {
  const values: Record<string, number> = {};
  for (const id of floorIds) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(k, values);
}

/** A save on floor 14's landing with every floor below the festival cleared. */
function atFourteen(seed = 0): Kernel {
  const k = makeGame({ seed });
  clearFloors(k, BELOW);
  patch(k, (s) => {
    s.world.spot = FLOORS.ascent_f14.landing!;
    if (!s.world.discovered.includes(s.world.spot)) s.world.discovered.push(s.world.spot);
  });
  return k;
}

/** Far past anything on floor 15, so a test of the flow is not a test of the balance. */
function strong(k: Kernel): Kernel {
  patch(k, (s) => {
    for (const a of ATTRIBUTE_IDS) (s.attributes as AttributesState).attrs[a].level = 400;
  });
  setHp(k, playerStats(k).maxHp);
  return k;
}

/** Wear and carry a few pieces, so the hold has something to hold. */
function geared(k: Kernel): Kernel {
  const sword = giveItem(k, 'iron_sword');
  const vest = giveItem(k, 'leather_vest');
  expect(equip(k, sword.uid).ok).toBe(true);
  expect(equip(k, vest.uid).ok).toBe(true);
  giveItem(k, 'old_spear');
  return k;
}

/** Ride the ladder and tick until the ride lands. */
function climb(k: Kernel, floorId: string | null): void {
  const result = k.dispatch(climbCommand({ floor: floorId }));
  expect(result.ok, `climb to ${floorId}: ${result.ok ? '' : result.reason}`).toBe(true);
  for (let i = 0; i < 2000 && worldOf(k).travel; i++) k.tick();
  expect(worldOf(k).travel).toBeNull();
}

/** Tick until `done` holds, at most `max` ticks. */
function tickUntil(k: Kernel, done: () => boolean, max = 50_000): void {
  for (let i = 0; i < max && !done(); i++) k.tick();
  expect(done(), 'condition never held').toBe(true);
}

/** A festival attempt with the dark room emptied: standing in the hall, the clock at the door. */
function inHall(k = strong(atFourteen())): Kernel {
  climb(k, DARK_FLOOR);
  tickUntil(k, () => runOf(k)?.phase === 'prep');
  expect(k.dispatch(travelTo({ to: 'f15_hall' })).ok).toBe(true);
  for (let i = 0; i < 200 && worldOf(k).travel; i++) k.tick();
  expect(worldOf(k).spot).toBe('f15_hall');
  return k;
}

const uids = (list: { uid: number }[]) => list.map((i) => i.uid).sort((a, b) => a - b);
const worn = (k: Kernel): ItemInstance[] => Object.values(itemsOf(k).equipment).filter((i): i is ItemInstance => !!i);
const everything = (k: Kernel): ItemInstance[] => [...worn(k), ...itemsOf(k).inventory];

/** How many of a def the player holds, worn or carried. */
const owned = (k: Kernel, defId: string): number => everything(k).filter((i) => i.defId === defId).length;

/** The royale won, from the hall. Port C5 plays it; here the debug command ends the attempt as won. */
function winFromHall(k: Kernel): void {
  const result = k.dispatch(debugWin());
  expect(result.ok, result.ok ? '' : result.reason).toBe(true);
  expect(runOf(k)).toBeNull();
}

/** A token in the stash, as the old `stashToken(s, seed)`. */
function stashToken(k: Kernel, seed: number): void {
  patch(k, (s) => {
    (s.festival as FestivalState).legacy.tokens.push({ seed: seed >>> 0 });
  });
}

const spend = (k: Kernel, index: number, choice: TokenChoice) => k.dispatch(spendToken({ index, choice })).ok;
const take = (k: Kernel, index: number) => k.dispatch(takeFromStash({ index })).ok;

/** A prestige: the floors that open it cleared, then the command. The next run is the same kernel's slices. */
function prestige(k: Kernel): void {
  clearFloors(k, PRESTIGE_FLOORS);
  const result = k.dispatch(prestigeNow());
  expect(result.ok, result.ok ? '' : result.reason).toBe(true);
}

describe('the door: gear held and returned', () => {
  it('holds everything worn and carried, and issues one plain weapon', () => {
    const k = geared(atFourteen());
    const wornBefore = uids(worn(k));
    const carried = uids(itemsOf(k).inventory);
    climb(k, DARK_FLOOR);
    expect(worldOf(k).spot).toBe(DARK_ROOM);
    const run = runOf(k)!;
    expect(run.phase).toBe('dark');
    expect(uids(Object.values(run.held.equipment) as ItemInstance[])).toEqual(wornBefore);
    expect(uids(run.held.inventory)).toEqual(carried);
    // On the player: the issued weapon and nothing else.
    expect(itemsOf(k).inventory).toEqual([]);
    expect(Object.keys(itemsOf(k).equipment)).toEqual(['weapon']);
    expect(itemsOf(k).equipment.weapon!.uid).toBe(run.issued);
    expect(itemsOf(k).equipment.weapon!.slots).toBe(0);
    expect(itemsOf(k).equipment.weapon!.affix).toBeUndefined();
  });

  it('returns the held set and takes the issued weapon back when the attempt is lost', () => {
    const k = geared(atFourteen());
    const before = uids(everything(k));
    climb(k, DARK_FLOOR);
    const issued = runOf(k)!.issued!;
    climb(k, 'ascent_f14'); // the ladder out: a forfeit
    const after = everything(k);
    expect(uids(after)).toEqual(before);
    expect(after.some((i) => i.uid === issued)).toBe(false);
    expect(itemsOf(k).equipment.weapon?.defId).toBe('iron_sword');
    expect(itemsOf(k).equipment.chest?.defId).toBe('leather_vest');
  });

  it('returns the held set when the royale is won', () => {
    const k = strong(geared(atFourteen()));
    const before = uids(everything(k));
    inHall(k);
    winFromHall(k);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(1);
    // The held set, plus the first win's reward in the pack.
    expect(uids(everything(k).filter((i) => i.defId !== FESTIVAL_REWARD))).toEqual(before);
    expect(itemsOf(k).equipment.weapon?.defId).toBe('iron_sword');
  });

  it('holds flasks and provisions, leaves cards, and adds the held ones to what the attempt left', () => {
    const k = atFourteen();
    patch(k, (s) => {
      (s.alchemy as AlchemyState).flasks = [{ steps: [] }, { steps: [] }];
      const m = s.materials as MaterialsState;
      m.stock.travelers_ration = { c: 4, b: 1 };
      m.counts.healing_salve = 2; // a plain count is held as well as graded stock
      m.counts.recipe_herb_rubbed_meat = 1;
    });
    climb(k, DARK_FLOOR);
    const held = runOf(k)!.held;
    expect(held.flasks).toHaveLength(2);
    expect(held.provisions.stock.travelers_ration).toEqual({ c: 4, b: 1 });
    expect(held.provisions.materials.healing_salve).toBe(2);
    const m = () => slice<MaterialsState>(k, 'materials');
    expect(slice<AlchemyState>(k, 'alchemy').flasks).toEqual([]);
    expect(m().stock.travelers_ration).toBeUndefined();
    expect(m().counts.healing_salve).toBeUndefined();
    expect(m().counts.recipe_herb_rubbed_meat).toBe(1);
    // The stores' rations, found during the attempt, are kept on top.
    patch(k, (s) => {
      (s.materials as MaterialsState).stock.travelers_ration = { c: 2 };
    });
    climb(k, 'ascent_f14');
    expect(slice<AlchemyState>(k, 'alchemy').flasks).toHaveLength(2);
    expect(m().stock.travelers_ration).toEqual({ c: 6, b: 1 });
    expect(m().counts.healing_salve).toBe(2);
  });

  it('a find worn at the end stays worn; the held piece for that slot goes to the pack', () => {
    const k = geared(atFourteen());
    const heldVest = itemsOf(k).equipment.chest!.uid;
    climb(k, DARK_FLOOR);
    const found = giveItem(k, 'leather_vest');
    expect(equip(k, found.uid).ok).toBe(true);
    climb(k, 'ascent_f14');
    expect(itemsOf(k).equipment.chest!.uid).toBe(found.uid);
    expect(itemsOf(k).inventory.some((i) => i.uid === heldVest)).toBe(true);
    // The issued weapon was taken back, so the held sword's slot was free.
    expect(itemsOf(k).equipment.weapon?.defId).toBe('iron_sword');
  });

  it('a held piece never goes back into a hand the body lost during the attempt', () => {
    const k = atFourteen();
    // The old case slotted the dvibahu gene: one more arm, which the body states to `items`.
    patch(k, (s) => {
      (s.items as ItemsState).bearer.grants = ['arms:+1'];
    });
    const shield = giveItem(k, 'wooden_shield');
    const dagger = giveItem(k, 'iron_dagger');
    expect(equip(k, shield.uid, 'offhand').ok).toBe(true);
    expect(equip(k, dagger.uid, 'hand3').ok).toBe(true);
    climb(k, DARK_FLOOR);
    patch(k, (s) => {
      (s.items as ItemsState).bearer.grants = []; // the third arm is gone
    });
    climb(k, 'ascent_f14');
    expect(itemsOf(k).equipment.offhand?.uid).toBe(shield.uid);
    expect(itemsOf(k).equipment.hand3).toBeUndefined();
    expect(itemsOf(k).inventory.some((i) => i.uid === dagger.uid)).toBe(true);
  });

  it('a sheathed blade is held and given back', () => {
    const k = atFourteen();
    const dagger = giveItem(k, 'iron_dagger');
    patch(k, (s) => {
      (s.martial as MartialState).sheathed = { ...dagger };
      (s.items as ItemsState).inventory = (s.items as ItemsState).inventory.filter((i) => i.uid !== dagger.uid);
    });
    climb(k, DARK_FLOOR);
    expect(runOf(k)!.held.sheathed?.uid).toBe(dagger.uid);
    expect(slice<MartialState>(k, 'martial').sheathed).toBeNull();
    climb(k, 'ascent_f14');
    expect(slice<MartialState>(k, 'martial').sheathed?.uid).toBe(dagger.uid);
  });
});

describe('the issued weapon', () => {
  /** Kills by family, as the old cases wrote `kills:weapon:<family>`. */
  const weaponKillsTo = (k: Kernel, kills: Record<string, number>) =>
    patch(k, (s) => {
      Object.assign((s.festival as FestivalState).weaponKills, kills);
    });
  const skillsTo = (k: Kernel, levels: Record<string, number>) =>
    patch(k, (s) => {
      for (const [id, level] of Object.entries(levels)) s.skills.skills[id] = { level, xp: 0 };
    });

  it('is the family with the highest weapon skill', () => {
    const k = makeGame({ seed: 0 });
    skillsTo(k, { spear_combat: 12, swordsmanship: 9 });
    weaponKillsTo(k, { sword: 500 });
    expect(issuedWeapon(reads(k)).item).toBe('old_spear');
  });

  it('breaks a tie on skill by kills with the family', () => {
    const k = makeGame({ seed: 0 });
    skillsTo(k, { dagger_combat: 10, club_combat: 10 });
    weaponKillsTo(k, { dagger: 3, blunt: 7 });
    expect(issuedWeapon(reads(k)).item).toBe('old_hammer');
  });

  it('is the rusty sword with no weapon skill, and bare hands for an unarmed fighter', () => {
    expect(issuedWeapon(reads(makeGame({ seed: 0 }))).item).toBe('rusty_sword');
    const k = makeGame({ seed: 0 });
    skillsTo(k, { unarmed_combat: 20 });
    expect(issuedWeapon(reads(k)).item).toBeUndefined();
  });

  it('cannot be sold: it is lent for the attempt', () => {
    const k = strong(atFourteen());
    climb(k, DARK_FLOOR);
    const issued = runOf(k)!.issued!;
    expect(unequip(k, 'weapon').ok).toBe(true);
    expect(itemsOf(k).inventory.some((i) => i.uid === issued)).toBe(true);
    const gold = slice<{ gold: number }>(k, 'gold').gold;
    expect(k.dispatch(sellItems({ uids: [issued] })).ok).toBe(false);
    expect(slice<{ gold: number }>(k, 'gold').gold).toBe(gold);
    expect(itemsOf(k).inventory.some((i) => i.uid === issued)).toBe(true);
    // Anything else still sells.
    const other = giveItem(k, 'iron_sword');
    expect(k.dispatch(sellItems({ uids: [issued, other.uid] })).ok).toBe(true);
    expect(itemsOf(k).inventory.some((i) => i.uid === other.uid)).toBe(false);
    expect(itemsOf(k).inventory.some((i) => i.uid === issued)).toBe(true);
    expect(slice<{ gold: number }>(k, 'gold').gold).toBeGreaterThan(gold);
  });

  it('kills are counted by the family in hand', () => {
    const k = inHall();
    // The dark room's nine fell to the issued rusty sword.
    expect(festivalOf(k).weaponKills.sword).toBe(DARK_ROOM_WAVES.flat().length);
  });
});

describe('the dark room', () => {
  it('fights its nine in waves; the door opens when the room is empty', () => {
    const k = strong(atFourteen());
    climb(k, DARK_FLOOR);
    expect(counterOf(k, FESTIVAL_DOOR_KEY)).toBe(0);
    // The way to the hall is shut while the room fights.
    expect(k.dispatch(travelTo({ to: 'f15_hall' })).ok).toBe(false);
    tickUntil(k, () => runOf(k)?.phase === 'prep');
    expect(counterOf(k, FESTIVAL_DOOR_KEY)).toBe(1);
    expect(counterOf(k, 'boss:f15_dark_room')).toBe(1);
    expect(floorCleared(reader(k), FLOORS[DARK_FLOOR])).toBe(true);
    expect(counterOf(k, 'kills')).toBe(DARK_ROOM_WAVES.flat().length);
  });

  it('the door shuts when the attempt is lost, not only when the next one starts', () => {
    const k = strong(atFourteen());
    climb(k, DARK_FLOOR);
    tickUntil(k, () => runOf(k)?.phase === 'prep');
    expect(counterOf(k, FESTIVAL_DOOR_KEY)).toBe(1);
    climb(k, null); // the forfeit: a loss, with the ejection
    expect(runOf(k)).toBeNull();
    expect(counterOf(k, FESTIVAL_DOOR_KEY)).toBe(0);
  });

  it('the door shuts when the royale is won', () => {
    const k = inHall();
    expect(counterOf(k, FESTIVAL_DOOR_KEY)).toBe(1);
    winFromHall(k);
    expect(counterOf(k, FESTIVAL_DOOR_KEY)).toBe(0);
  });

  it('floor 16 has no door of its own: with no attempt the ladder refuses it, though floor 15 reads cleared', () => {
    // The verdict, from the hub after a lost attempt: closed.
    expect(festivalLadder(null, FOOT, ROYALE_FLOOR)).toBe('closed');
    // From the dark room inside an attempt: shut while the room fights, the royale after.
    expect(festivalLadder({ phase: 'dark' }, DARK_ROOM, ROYALE_FLOOR)).toBe('shut');
    expect(festivalLadder({ phase: 'prep' }, 'f15_hall', ROYALE_FLOOR)).toBe('royale');
  });
  it.todo('floor 16 has no door of its own, by the ladder (step 4 port C5: floor 16)');

  it('the climb to floor 16 is shut until the room is empty', () => {
    expect(festivalLadder({ phase: 'dark' }, DARK_ROOM, ROYALE_FLOOR)).toBe('shut');
  });
  it.todo('the climb to floor 16 is shut until the room is empty, by the ladder (step 4 port C5: floor 16)');
});

describe('the festival clock', () => {
  it('starts at the door and runs while the game runs on its floors', () => {
    const k = inHall();
    const at = runOf(k)!.clock;
    for (let i = 0; i < 100; i++) k.tick();
    expect(runOf(k)!.clock).toBe(at + 100);
  });

  it.todo('pauses offline: nothing is simulated, and the time away is banked 1:1 (kernel: the catch-up hold)');
  it.todo('banks at most the cap, and a short gap banks too (kernel: the catch-up hold)');
  it.todo('the summary reports what the bank took, not the time skipped (kernel: the catch-up hold; the summary is the UI step)');
  it.todo('a catch-up whose climb lands in the dark room stops at the door and banks the rest (kernel: the catch-up hold)');
  it.todo('the quiet short-gap path stops at the door too (kernel: the catch-up hold)');
  it.todo('runs no catch-up for the world outside either (kernel: the catch-up hold)');
});

describe('the time jump', () => {
  it.todo('climbing into the royale early sets the clock to day ten and keeps the entry time (step 4 port C5: floor 16)');

  it('the survivors get the rest of their preparation either way', () => {
    const full = SURVIVOR_LEVELS.base + SURVIVOR_LEVELS.growth;
    expect(survivorLevel(PREP_TICKS, 0)).toBe(full);
    expect(survivorLevel(0, 0)).toBe(SURVIVOR_LEVELS.base);
  });
  it.todo('the survivors get the rest of their preparation either way, on the field (step 4 port C5: the royale)');

  it.todo('day ten walks the player up to floor 16 on its own (step 4 port C5: floor 16)');
});

describe('losing: ejection and the lockout', () => {
  it('a knockout in the dark room lands outside the tower and shuts both floors', () => {
    const k = geared(atFourteen());
    climb(k, DARK_FLOOR);
    // A level-one fighter against the room: the first wave puts them down.
    tickUntil(k, () => worldOf(k).recovering, 20_000);
    expect(worldOf(k).spot).toBe(FOOT);
    expect(runOf(k)).toBeNull();
    expect(lockLeft(k)).toBe(LOCKOUT_TICKS);
    expect(floorUnlocked(reader(k), FLOORS[DARK_FLOOR])).toBe(false);
    // The floors above are untouched: the lock shuts, it does not un-clear.
    expect(floorCleared(reader(k), FLOORS.ascent_f14)).toBe(true);
  });

  it.todo('a knockout in the royale ejects too (step 4 port C5: the royale)');

  it('the lockout ends after three days of the world clock', () => {
    const k = geared(atFourteen());
    climb(k, DARK_FLOOR);
    climb(k, 'ascent_f14');
    expect(floorUnlocked(reader(k), FLOORS[DARK_FLOOR])).toBe(false);
    // Three days of the world clock, less one tick: the clock moved, as the old case moved `totalTicks`.
    const end = festivalOf(k).lockedUntil!;
    patch(k, (s) => {
      (s.clock as ClockState).totalTicks = end - 2;
    });
    k.tick();
    expect(nowOf(k)).toBe(end - 1);
    expect(floorUnlocked(reader(k), FLOORS[DARK_FLOOR])).toBe(false);
    k.tick();
    expect(floorUnlocked(reader(k), FLOORS[DARK_FLOOR])).toBe(true);
    expect(k.dispatch(climbCommand({ floor: DARK_FLOOR })).ok).toBe(true);
  });

  it('the lockout ends at the next prestige', () => {
    const k = atFourteen();
    climb(k, DARK_FLOOR);
    climb(k, null);
    expect(lockLeft(k)).toBeGreaterThan(0);
    prestige(k);
    expect(lockLeft(k)).toBe(0);
    expect(festivalOf(k).run).toBeNull();
    clearFloors(k, BELOW);
    expect(floorUnlocked(reader(k), FLOORS[DARK_FLOOR])).toBe(true);
  });

  it('a festival floor is never a haven: a later knockout elsewhere does not land inside it', () => {
    const k = inHall();
    expect(worldOf(k).safeSpots.nearest).not.toBe('f15_hall');
    expect(SPOTS.f15_hall.activities.some((a) => a.kind === 'rest')).toBe(true);
  });
});

describe('the ladder out is a forfeit', () => {
  it('from the dark room between waves: ejected, gear back, both floors shut', () => {
    const k = geared(atFourteen());
    climb(k, DARK_FLOOR);
    expect(fightOf(k)).toBeNull();
    expect(k.dispatch(climbCommand({ floor: 'ascent_f12' })).ok).toBe(true);
    expect(worldOf(k).spot).toBe(FOOT);
    expect(worldOf(k).travel).toBeNull();
    expect(runOf(k)).toBeNull();
    expect(lockLeft(k)).toBe(LOCKOUT_TICKS);
    expect(itemsOf(k).equipment.weapon?.defId).toBe('iron_sword');
  });

  it('from the hall, to the hub, and from the royale back down', () => {
    for (const floor of [null, 'ascent_f14']) {
      const k = inHall();
      expect(k.dispatch(climbCommand({ floor })).ok).toBe(true);
      expect(worldOf(k).spot).toBe(FOOT);
      expect(lockLeft(k)).toBe(LOCKOUT_TICKS);
    }
  });
  it.todo('from the royale back down (step 4 port C5: floor 16)');

  it('refuses during a fight, as every climb does', () => {
    const k = strong(atFourteen());
    climb(k, DARK_FLOOR);
    tickUntil(k, () => !!fightOf(k));
    expect(k.dispatch(climbCommand({ floor: 'ascent_f14' })).ok).toBe(false);
    expect(runOf(k)).not.toBeNull();
  });

  it('walking within a floor is not leaving it', () => {
    const k = inHall();
    climb(k, DARK_FLOOR); // the hall back to the landing: a crossing
    expect(worldOf(k).spot).toBe(DARK_ROOM);
    expect(runOf(k)?.phase).toBe('prep');
  });
});

// New here: what the ladder card reads (the old `ladderView` marks).
describe('the ladder card', () => {
  const ladderView = (k: Kernel) => k.view().systems.ladder as LadderView;
  const worldView = (k: Kernel) => k.view().systems.world as WorldView;
  const rung = (k: Kernel, id: string) => ladderView(k).towers[0].rungs.find((r) => r.id === id)!;

  it('names every ride out of an attempt a forfeit, and the crossing within the floor a ride', () => {
    const k = inHall();
    const verdicts = worldView(k).rideVerdicts;
    expect(verdicts.ascent_f14?.kind).toBe('forfeit');
    expect(verdicts['']?.kind).toBe('forfeit');
    expect(verdicts.ascent_f14?.msg).toContain('forfeits the festival');
    expect(verdicts[DARK_FLOOR]).toBeUndefined();
  });

  it('marks floor 15 shut after a loss, cleared or not, and names no verdict outside an attempt', () => {
    const k = inHall();
    expect(rung(k, DARK_FLOOR).shut).toBe(false);
    climb(k, null); // the forfeit
    expect(rung(k, DARK_FLOOR).shut).toBe(true);
    expect(rung(k, DARK_FLOOR).status).toBe('cleared');
    expect(rung(k, 'ascent_f14').shut).toBe(false);
    expect(worldView(k).rideVerdicts).toEqual({});
  });
});

describe('the royale', () => {
  it.todo('a plan alone wins the royale in the game, with no hand on the field (step 4 port C5)');
  it.todo('a click on the field walks the player there, and the plan takes over on arrival (step 4 port C5)');
  it.todo('the plan is ranked, kept between attempts, and cleans up what it is given (step 4 port C5)');
  it.todo('a knockout mid-royale loses the attempt even from a field fight against the champion (step 4 port C5)');
  it.todo("a win clears floor 16 and counts the run's win; the field is empty after (step 4 port C5)");
});

describe('rewards: the first win pays, reruns pay nothing', () => {
  it('the first win of a run pays the laurel; a rerun pays nothing at all', () => {
    const k = inHall();
    winFromHall(k);
    expect(owned(k, FESTIVAL_REWARD)).toBe(1);
    const gold = slice<{ gold: number }>(k, 'gold').gold;
    const count = everything(k).length;
    // A rerun from the hall: the dark room again, the hall, the win.
    climb(k, DARK_FLOOR);
    expect(runOf(k)?.phase).toBe('dark');
    tickUntil(k, () => runOf(k)?.phase === 'prep');
    winFromHall(k);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(2);
    expect(owned(k, FESTIVAL_REWARD)).toBe(1);
    expect(slice<{ gold: number }>(k, 'gold').gold).toBe(gold);
    expect(everything(k).length).toBe(count);
    expect(festivalOf(k).legacy.tokens).toEqual([]);
  });

  it('the win count restarts with every run', () => {
    const k = strong(atFourteen());
    setCounters(k, { [FESTIVAL_WINS_KEY]: 3 });
    prestige(k);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(0);
  });
});

describe('the hundredth win and the stronghold stash', () => {
  it('the hundredth win of a run puts a token in the stash, which survives prestige', () => {
    const k = inHall();
    setCounters(k, { [FESTIVAL_WINS_KEY]: 99 });
    expect(festivalOf(k).legacy.tokens).toEqual([]);
    winFromHall(k);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(100);
    const tokens = festivalOf(k).legacy.tokens;
    expect(tokens).toHaveLength(1);
    prestige(k);
    expect(festivalOf(k).legacy.tokens).toEqual(tokens);
    // The count restarts with the run; the token does not.
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(0);
    prestige(k);
    expect(festivalOf(k).legacy.tokens).toHaveLength(1);
  });

  it('two hundred earns two, one at each hundred, and nothing in between', () => {
    const k = inHall();
    setCounters(k, { [FESTIVAL_WINS_KEY]: 150 });
    winFromHall(k);
    expect(festivalOf(k).legacy.tokens).toEqual([]);
    setCounters(k, { [FESTIVAL_WINS_KEY]: 199 });
    stashToken(k, 5); // the hundredth's, already held
    climb(k, DARK_FLOOR);
    tickUntil(k, () => runOf(k)?.phase === 'prep');
    winFromHall(k);
    expect(festivalOf(k).legacy.tokens).toHaveLength(2);
  });

  it('only keep-marked items enter the stash', () => {
    // A regalia bought with a token is minted into the stash; nothing else is
    // kept there (the items system's `items/stash` request refuses the rest:
    // tests/items.test.ts).
    const k = makeGame({ seed: 0 });
    stashToken(k, 1);
    expect(spend(k, 0, { kind: 'regalia' })).toBe(true);
    expect(itemsOf(k).stash.map((i) => i.defId)).toEqual([TOKEN_REGALIA]);
  });
});

describe('a festival token', () => {
  it('buys a stack of the permanent bonus, capped, kept through prestige', () => {
    const k = makeGame({ seed: 0 });
    for (let i = 0; i < TOKEN_BONUS.cap + 1; i++) stashToken(k, i);
    const before = playerStats(k).damage;
    for (let i = 0; i < TOKEN_BONUS.cap; i++) expect(spend(k, 0, { kind: 'bonus' })).toBe(true);
    expect(festivalOf(k).legacy.bonus).toBe(TOKEN_BONUS.cap);
    expect(playerStats(k).damage).toBeGreaterThan(before);
    // At the cap the bonus is shut; the token stays for another choice.
    expect(spend(k, 0, { kind: 'bonus' })).toBe(false);
    expect(festivalOf(k).legacy.tokens).toHaveLength(1);
    prestige(k);
    expect(festivalOf(k).legacy.bonus).toBe(TOKEN_BONUS.cap);
  });

  it("offers three techniques from its seed; the one taken is known now and from every later run's start", () => {
    const k = makeGame({ seed: 0 });
    stashToken(k, 12345);
    const offers = offersOf(festivalOf(k).legacy, 12345);
    expect(offers).toHaveLength(TOKEN_TECHNIQUES.offer);
    // The same token offers the same three every time it is opened.
    expect(offersOf(festivalOf(k).legacy, 12345)).toEqual(offers);
    for (const id of offers) expect(TOKEN_TECHNIQUES.pool).toContain(id);
    // Not on offer: refused, and the token is kept.
    const other = TOKEN_TECHNIQUES.pool.find((id) => !offers.includes(id))!;
    expect(spend(k, 0, { kind: 'technique', id: other })).toBe(false);
    expect(spend(k, 0, { kind: 'technique', id: offers[1] })).toBe(true);
    expect(slice<MartialState>(k, 'martial').techniques[offers[1]]?.form).toBe('canonical');
    expect(festivalOf(k).legacy.techniques).toEqual([offers[1]]);
    prestige(k);
    expect(slice<MartialState>(k, 'martial').techniques[offers[1]]?.form).toBe('canonical');
    expect(festivalOf(k).legacy.techniques).toEqual([offers[1]]);
    // A later token never offers what is already taken.
    expect(offersOf(festivalOf(k).legacy, 12345)).not.toContain(offers[1]);
  });

  it('buys the regalia, which every prestige returns to the stash from wherever it is', () => {
    const k = makeGame({ seed: 0 });
    stashToken(k, 1);
    expect(spend(k, 0, { kind: 'regalia' })).toBe(true);
    expect(itemsOf(k).stash.map((i) => i.defId)).toEqual([TOKEN_REGALIA]);
    // Taken out and worn: it comes back at prestige.
    expect(take(k, 0)).toBe(true);
    expect(itemsOf(k).stash).toEqual([]);
    const regalia = itemsOf(k).inventory.find((i) => i.defId === TOKEN_REGALIA)!;
    expect(equip(k, regalia.uid).ok).toBe(true);
    expect(itemsOf(k).equipment.accessory?.defId).toBe(TOKEN_REGALIA);
    prestige(k);
    expect(itemsOf(k).stash.map((i) => i.defId)).toEqual([TOKEN_REGALIA]);
    expect(owned(k, TOKEN_REGALIA)).toBe(0);
    // Taken out in the new run, it gets a uid of that run.
    expect(take(k, 0)).toBe(true);
    const taken = itemsOf(k).inventory.find((i) => i.defId === TOKEN_REGALIA)!;
    expect(itemsOf(k).inventory.filter((i) => i.uid === taken.uid)).toHaveLength(1);
  });

  it('hands out nothing inside a festival attempt: the door holds everything', () => {
    const k = strong(atFourteen());
    stashToken(k, 1);
    expect(spend(k, 0, { kind: 'regalia' })).toBe(true);
    climb(k, DARK_FLOOR);
    expect(take(k, 0)).toBe(false);
    expect(itemsOf(k).stash).toHaveLength(1);
    climb(k, null); // out by the ladder: the attempt is over
    expect(take(k, 0)).toBe(true);
  });

  it('a regalia held at the festival door still goes back to the stash at prestige', () => {
    const k = strong(atFourteen());
    stashToken(k, 1);
    expect(spend(k, 0, { kind: 'regalia' })).toBe(true);
    expect(take(k, 0)).toBe(true);
    climb(k, DARK_FLOOR);
    expect(owned(k, TOKEN_REGALIA)).toBe(0);
    expect(runOf(k)!.held.inventory.some((i) => i.defId === TOKEN_REGALIA)).toBe(true);
    prestige(k);
    expect(itemsOf(k).stash.map((i) => i.defId)).toEqual([TOKEN_REGALIA]);
  });
});

describe('saving inside the festival', () => {
  it('a save mid-wave reloads into the same attempt, and the wave is fought again', () => {
    const k = strong(geared(atFourteen()));
    climb(k, DARK_FLOOR);
    tickUntil(k, () => !!fightOf(k));
    const loaded = makeGame({ seed: 0 });
    expect(loaded.load(k.save(0)).ok).toBe(true);
    // The save holds the fight here (src/systems/combat/README.md): the wave
    // goes on after the load, where the old build dropped it and fought the
    // wave again.
    expect(fightOf(loaded)).not.toBeNull();
    expect(runOf(loaded)?.phase).toBe('dark');
    expect(runOf(loaded)!.held.inventory.length).toBeGreaterThan(0);
    tickUntil(loaded, () => runOf(loaded)?.phase === 'prep');
    expect(counterOf(loaded, 'boss:f15_dark_room')).toBe(1);
  });

  it.todo('a save mid-royale fight reloads with its survivors walking again, and the royale can still be won (step 4 port C5)');
});

describe('the hidden title', () => {
  const TITLE = 'first_through_the_door';
  const titlesOf = (k: Kernel): string[] => slice<TitlesState>(k, 'titles').earned;

  /** The climb into the royale began at `clock` (the jump's `enteredAt`): port C5 climbs; here it is written. */
  function enteredAt(k: Kernel, clock: number): void {
    patch(k, (s) => {
      const run = (s.festival as FestivalState).run!;
      run.enteredAt = clock;
      run.clock = Math.max(clock, PREP_TICKS);
      run.phase = 'royale';
    });
  }

  it('fires for a win whose climb began within twelve festival hours of the door', () => {
    const k = inHall();
    enteredAt(k, SWIFT_ENTRY_TICKS - 1);
    expect(counterOf(k, FESTIVAL_SWIFT_KEY)).toBe(0);
    winFromHall(k);
    expect(counterOf(k, FESTIVAL_SWIFT_KEY)).toBe(1);
    expect(titlesOf(k)).toContain(TITLE);
  });

  it('a later climb wins without it, and leaves no trace of it', () => {
    const k = inHall();
    enteredAt(k, SWIFT_ENTRY_TICKS + 1);
    winFromHall(k);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(1);
    expect(slice<{ counts: Record<string, number> }>(k, 'counters').counts[FESTIVAL_SWIFT_KEY]).toBeUndefined();
    expect(titlesOf(k)).not.toContain(TITLE);
  });

  it('an early climb that is lost writes nothing: no counter, no title', () => {
    const k = inHall();
    enteredAt(k, 0);
    climb(k, null); // the forfeit
    expect(slice<{ counts: Record<string, number> }>(k, 'counters').counts[FESTIVAL_SWIFT_KEY]).toBeUndefined();
    expect(titlesOf(k)).not.toContain(TITLE);
    // Secret: hidden from the UI until earned.
    expect(TITLES[TITLE].secret).toBe(true);
  });
});
