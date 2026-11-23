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
 * Floor 16 and the royale (step 4 port C5) are played as the old cases
 * played them: `winFromHall` climbs the ladder into the royale and ticks
 * until the attempt ends. Call shapes for the royale:
 * - `game.setRoyalePlan(ids)` is `festival/set-plan`; `royalePlan(s)` is
 *   `royalePlan` over the slice's `plan`; `game.moveOnField(x, y)` is
 *   `festival/move-on-field`.
 * - The old cases held `run` and `field` as live objects and wrote into
 *   them. Here every read is a copy (`runOf`, `fieldOf`), taken again after
 *   each step, and every write is `patch` (a save and a load; the field is
 *   re-read after it). An old identity check (`toBe(field)`, `toBe(run)`)
 *   checks what the field or the attempt holds: the layout, the fighters
 *   and the opening tick; the seed and the phase.
 * - `game.sell` and `game.sellMany` are `items/sell`; `game.unequip` is
 *   `items/unequip`; `getDerivedStats(s).maxHp` is `playerStats(k).maxHp`;
 *   `s.resources.hp` is the resources slice (`setHp`, `hpOf`). Setting every
 *   attribute and health to 1 mid-fight is `patch` and `setHp`.
 * - `royaleFightWon(s, new EventBus(), run)` runs in the probe's context
 *   (`run` from tests/helpers, `runIn` here) on a copy of the attempt; the
 *   field it leaves is written back with `patch`.
 *
 * Rebuild differences in the royale:
 * - The save keeps an open fight (src/systems/combat/README.md). "a save
 *   mid-royale fight reloads with its survivors walking again" is ported as
 *   "a save mid-wave ..." is: the name is kept, and the case asserts that the
 *   fight is still open after the load with the same survivors engaged, and
 *   that the royale can still be won.
 * - "one saved without a seed draws its own", the second half of "the
 *   attempt draws its field's seed ...", cannot happen: the door always sets
 *   `fieldSeed`. That half and its clause of the name are dropped.
 * - The field's random draws come from the kernel generator, so the seed,
 *   the map and every position differ from the old build's; the cases assert
 *   counts, flags and outcomes.
 *
 * The festival clock's offline cases: `runOfflineProgress(game, ms)` and
 * `catchUpTicks(game, n)` are `catchUp` over the save, loaded back (`away`).
 * The old catch-up stopped at the first tick the festival held the player
 * and banked the rest: the festival's `catchUpHold` here (kernel decision
 * 35). A gap longer than one frame's 30 ticks goes to `catchUp`, so the old
 * quiet path of short gaps is the same call. The offline summary's fields
 * (`festivalSkipped`, `festivalBanked`) are the UI step: the cases read the
 * bank.
 *
 * Left out: "an attempt started before the door took flasks returns its gear
 * all the same" was a save from before the door held flasks; this save
 * starts at version 1 with the field.
 */
import { describe, expect, it } from 'vitest';
import { catchUp, OFFLINE_CAP_MS, offlineTicks, type Kernel } from '../src/kernel';
import { systems } from '../src/systems';
import { BONUS_CAP_TICKS, type BonusState } from '../src/systems/bonus';
import type { AlchemyState } from '../src/systems/alchemy';
import type { AttributesState } from '../src/systems/attributes';
import type { ClockState } from '../src/systems/clock';
import { totalTicksOf } from '../src/systems/clock';
import type { CombatState } from '../src/systems/combat';
import type { CountersState } from '../src/systems/counters';
import {
  ARENA,
  CACHE_WEAPONS,
  DARK_FLOOR,
  DARK_ROOM,
  DARK_ROOM_WAVES,
  DEFAULT_ROYALE_PLAN,
  FESTIVAL_DOOR_KEY,
  FESTIVAL_REWARD,
  FESTIVAL_SWIFT_KEY,
  FESTIVAL_WINS_KEY,
  festivalLadder,
  issuedWeapon,
  LOCKOUT_TICKS,
  lockoutLeft,
  mapOf,
  PREP_TICKS,
  ROYALE_CACHES,
  ROYALE_DENS,
  ROYALE_FIELD,
  ROYALE_FLOOR,
  ROYALE_LAYOUT_VERSION,
  ROYALE_SECTIONS,
  royaleFightWon,
  royalePlan,
  sectionIdOf,
  setRoyalePlan,
  spendToken,
  SURVIVOR_LEVELS,
  survivorLevel,
  SWIFT_ENTRY_TICKS,
  TOKEN_BONUS,
  TOKEN_REGALIA,
  TOKEN_TECHNIQUES,
  offersOf,
  walkOnField,
  type FestivalState,
  type RoyaleField,
  type RoyaleMap,
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
import { hpOf, logOf, playerStats, setHp } from './combatHelpers';
import { equip, giveItem, makeGame, patch, probe, reads, run as runIn, slice, unequip } from './helpers';
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
const bankOf = (k: Kernel): number => slice<BonusState>(k, 'bonus').banked;
/** The counters as written: a key never written is undefined, as the old `s.stats[key]`. */
const countsOf = (k: Kernel): Record<string, number> => slice<CountersState>(k, 'counters').counts;
const goldOf = (k: Kernel): number => slice<{ gold: number }>(k, 'gold').gold;
const TWO_HOURS = offlineTicks(2 * 60 * 60 * 1000);

/**
 * Offline catch-up of `ticks` over the kernel's save, loaded back into the
 * kernel. The old `catchUpTicks`: the ticks simulated and what the bank took.
 */
function away(k: Kernel, ticks: number): { simulated: number; banked: number } {
  const tick = k.tickCount;
  const bank = bankOf(k);
  const after = catchUp({ systems: [...systems, probe], envelope: k.save(0), ticks, now: 0 });
  expect(k.load(after).ok).toBe(true);
  return { simulated: k.tickCount - tick, banked: bankOf(k) - bank };
}

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

/** From the hall, into the royale and through it. */
function winFromHall(k: Kernel): void {
  climb(k, ROYALE_FLOOR);
  tickUntil(k, () => !runOf(k));
  expect(counterOf(k, 'boss:f16_arena')).toBeGreaterThanOrEqual(1);
}

/** Down in one blow: every attribute to 1 and health to 1, as the old cases wrote them mid-fight. */
function weaken(k: Kernel): void {
  patch(k, (s) => {
    for (const a of ATTRIBUTE_IDS) (s.attributes as AttributesState).attrs[a].level = 1;
  });
  setHp(k, 1);
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
  }, 30_000);

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
  }, 30_000);

  it('floor 16 has no door of its own: with no attempt the ladder refuses it, though floor 15 reads cleared', () => {
    // The verdict, from the hub after a lost attempt: closed.
    expect(festivalLadder(null, FOOT, ROYALE_FLOOR)).toBe('closed');
    // From the dark room inside an attempt: shut while the room fights, the royale after.
    expect(festivalLadder({ phase: 'dark' }, DARK_ROOM, ROYALE_FLOOR)).toBe('shut');
    expect(festivalLadder({ phase: 'prep' }, 'f15_hall', ROYALE_FLOOR)).toBe('royale');
  }, 30_000);

  it('floor 16 has no door of its own, by the ladder', () => {
    // A room emptied, then the attempt lost from the hall: the dark room's
    // latch stays, so the ladder reads floor 15 cleared and floor 16 open.
    const k = strong(atFourteen());
    climb(k, DARK_FLOOR);
    tickUntil(k, () => runOf(k)?.phase === 'prep');
    climb(k, null); // the forfeit
    // The lockout's three days pass on the world clock: the old case moved `totalTicks`.
    const end = festivalOf(k).lockedUntil!;
    patch(k, (s) => {
      (s.clock as ClockState).totalTicks = end - 1;
    });
    k.tick();
    expect(floorCleared(reader(k), FLOORS[DARK_FLOOR])).toBe(true);
    expect(floorUnlocked(reader(k), FLOORS[ROYALE_FLOOR])).toBe(true);
    expect(festivalLadder(runOf(k), worldOf(k).spot, ROYALE_FLOOR)).toBe('closed');
    expect(k.dispatch(climbCommand({ floor: ROYALE_FLOOR })).ok).toBe(false);
    expect(worldOf(k).travel).toBeNull();
    expect(worldOf(k).spot).toBe(FOOT);
    // The log is capped, so the refusal is read off its newest line.
    expect(logOf(k).at(-1)).toContain('Floor 16');
    // The way in is still the dark room.
    expect(k.dispatch(climbCommand({ floor: DARK_FLOOR })).ok).toBe(true);
  }, 30_000);

  it('the climb to floor 16 is shut until the room is empty', () => {
    expect(festivalLadder({ phase: 'dark' }, DARK_ROOM, ROYALE_FLOOR)).toBe('shut');
  }, 30_000);

  it('the climb to floor 16 is shut until the room is empty, by the ladder', () => {
    const k = strong(atFourteen());
    setCounters(k, { 'boss:f15_dark_room': 1 }); // a room emptied in an earlier attempt
    climb(k, DARK_FLOOR);
    expect(k.dispatch(climbCommand({ floor: ROYALE_FLOOR })).ok).toBe(false);
    expect(runOf(k)?.phase).toBe('dark');
  }, 30_000);
});

describe('the festival clock', () => {
  it('starts at the door and runs while the game runs on its floors', () => {
    const k = inHall();
    const at = runOf(k)!.clock;
    for (let i = 0; i < 100; i++) k.tick();
    expect(runOf(k)!.clock).toBe(at + 100);
  });

  it('pauses offline: nothing is simulated, and the time away is banked 1:1', () => {
    const k = inHall();
    const clock = runOf(k)!.clock;
    const now = nowOf(k);
    const kills = counterOf(k, 'kills');
    const r = away(k, TWO_HOURS);
    expect(r.simulated).toBe(0);
    expect(nowOf(k)).toBe(now);
    expect(runOf(k)!.clock).toBe(clock);
    expect(counterOf(k, 'kills')).toBe(kills);
    expect(r.banked).toBe(TWO_HOURS);
  });

  it('banks at most the cap, and a short gap banks too (the quiet path, catchUpTicks)', () => {
    const k = inHall();
    patch(k, (s) => {
      (s.bonus as BonusState).banked = 0;
    });
    // A gap past one frame's ticks goes to catch-up here, a short one too.
    expect(away(k, 300)).toEqual({ simulated: 0, banked: 300 });
    expect(bankOf(k)).toBe(300);
    away(k, offlineTicks(24 * 60 * 60 * 1000));
    expect(bankOf(k)).toBe(BONUS_CAP_TICKS);
  });

  it('the summary reports what the bank took, not the time skipped', () => {
    // The offline summary is the UI step: what the bank took is read off the bank.
    const k = inHall();
    patch(k, (s) => {
      (s.bonus as BonusState).banked = BONUS_CAP_TICKS - 100;
    });
    const r = away(k, TWO_HOURS);
    expect(r.simulated).toBe(0);
    expect(r.banked).toBe(100);
    expect(bankOf(k)).toBe(BONUS_CAP_TICKS);
    // A full bank takes nothing.
    expect(away(k, TWO_HOURS).banked).toBe(0);
  });

  it('a catch-up whose climb lands in the dark room stops at the door and banks the rest', () => {
    const k = strong(geared(atFourteen()));
    expect(k.dispatch(climbCommand({ floor: DARK_FLOOR })).ok).toBe(true); // the tab closes mid-ride
    patch(k, (s) => {
      (s.bonus as BonusState).banked = 0;
    });
    const kills = counterOf(k, 'kills');
    const all = offlineTicks(OFFLINE_CAP_MS);
    const r = away(k, all);
    // The ride landed and the attempt began, and nothing after it was simulated.
    expect(worldOf(k).spot).toBe(DARK_ROOM);
    expect(runOf(k)?.phase).toBe('dark');
    expect(runOf(k)?.wave).toBe(0);
    expect(fightOf(k)).toBeNull();
    expect(counterOf(k, 'kills')).toBe(kills);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(0);
    expect(lockLeft(k)).toBe(0);
    expect(r.simulated).toBeGreaterThan(0);
    expect(r.simulated).toBeLessThan(200);
    expect(r.banked).toBe(all - r.simulated);
  });

  it('the quiet short-gap path stops at the door too', () => {
    const k = strong(atFourteen());
    expect(k.dispatch(climbCommand({ floor: DARK_FLOOR })).ok).toBe(true);
    patch(k, (s) => {
      (s.bonus as BonusState).banked = 0;
    });
    const r = away(k, 550); // a 55-second gap, longer than the ride
    expect(r.simulated).toBeGreaterThan(0);
    expect(r.simulated).toBeLessThan(550);
    expect(r.banked).toBe(550 - r.simulated);
    expect(worldOf(k).spot).toBe(DARK_ROOM);
    expect(runOf(k)?.wave).toBe(0);
    expect(fightOf(k)).toBeNull();
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(0);
  });

  it('runs no catch-up for the world outside either', () => {
    // Outside the festival, offline time is simulated as before.
    const k = atFourteen();
    const now = nowOf(k);
    const r = away(k, 3000);
    expect(r.simulated).toBe(3000);
    expect(nowOf(k)).toBe(now + 3000);
  });

  // New here (kernel decision 35): the hold before the first tick, and the kept flag.
  it('a catch-up that starts inside an attempt runs no tick: the kernel tick, the clock and the generator stand', () => {
    const k = inHall();
    const before = k.save(0);
    const after = catchUp({ systems: [...systems, probe], envelope: before, ticks: TWO_HOURS, now: 0 });
    expect(after.kernel).toEqual(before.kernel);
    expect(after.slices.clock).toEqual(before.slices.clock);
    expect(after.slices.festival).toEqual(before.slices.festival);
  });

  it('the hold is read again after a load and after a new run', () => {
    // `catchUpHeld(0)` asks the holds as catch-up does; with 0 ticks left the bank takes nothing.
    const hall = inHall();
    const outside = atFourteen();
    expect(outside.catchUpHeld(0)).toBeNull();
    // The same kernel, loaded with a save inside an attempt: held at once.
    expect(outside.load(hall.save(0)).ok).toBe(true);
    expect(outside.catchUpHeld(0)).toBe('festival');
    // And loaded back outside: not held.
    expect(outside.load(atFourteen().save(0)).ok).toBe(true);
    expect(outside.catchUpHeld(0)).toBeNull();
    // A new run inside an attempt: the run's attempt is gone, and so is the hold.
    expect(hall.catchUpHeld(0)).toBe('festival');
    prestige(hall);
    expect(runOf(hall)).toBeNull();
    expect(hall.catchUpHeld(0)).toBeNull();
    // An attempt ended in play: the kept flag follows it.
    const k = inHall();
    expect(k.catchUpHeld(0)).toBe('festival');
    climb(k, null); // the forfeit
    expect(k.catchUpHeld(0)).toBeNull();
  });
});

describe('the time jump', () => {
  it('climbing into the royale early sets the clock to day ten and keeps the entry time', () => {
    const k = inHall();
    for (let i = 0; i < 300; i++) k.tick();
    const at = runOf(k)!.clock;
    expect(at).toBeLessThan(PREP_TICKS);
    expect(k.dispatch(climbCommand({ floor: ROYALE_FLOOR })).ok).toBe(true);
    const run = runOf(k)!;
    expect(run.phase).toBe('royale');
    expect(run.enteredAt).toBe(at);
    expect(run.clock).toBe(PREP_TICKS);
  }, 30_000);

  it('the survivors get the rest of their preparation either way', () => {
    const full = SURVIVOR_LEVELS.base + SURVIVOR_LEVELS.growth;
    expect(survivorLevel(PREP_TICKS, 0)).toBe(full);
    expect(survivorLevel(0, 0)).toBe(SURVIVOR_LEVELS.base);
  });

  it('the survivors get the rest of their preparation either way, on the field', () => {
    const full = SURVIVOR_LEVELS.base + SURVIVOR_LEVELS.growth;
    // The jump: whatever the clock read, the field opens at the full curve.
    const k = inHall();
    climb(k, ROYALE_FLOOR);
    // The first survivor fight (a den's monsters are pinned at their own levels).
    const survivor = () => fightOf(k)?.enemies.find((e) => e?.defId.startsWith('ph_survivor'));
    tickUntil(k, () => !!survivor());
    expect(survivor()!.level).toBeGreaterThanOrEqual(full);
  }, 30_000);

  it('day ten walks the player up to floor 16 on its own', () => {
    const k = inHall();
    patch(k, (s) => {
      (s.festival as FestivalState).run!.clock = PREP_TICKS - 1;
    });
    tickUntil(k, () => worldOf(k).spot === ARENA, 500);
    expect(runOf(k)!.phase).toBe('royale');
    expect(runOf(k)!.enteredAt).toBe(PREP_TICKS);
  });
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
    // The old `festivalLocked(s, floor 16)`: the ladder's rung for floor 16 reads shut.
    const ladder = k.view().systems.ladder as LadderView;
    expect(ladder.towers[0].rungs.find((r) => r.id === ROYALE_FLOOR)!.shut).toBe(true);
    // The floors above are untouched: the lock shuts, it does not un-clear.
    expect(floorCleared(reader(k), FLOORS.ascent_f14)).toBe(true);
  }, 30_000);

  it('a knockout in the royale ejects too', () => {
    const k = atFourteen();
    setCounters(k, { 'boss:f15_dark_room': 1 });
    strong(k);
    climb(k, DARK_FLOOR);
    tickUntil(k, () => runOf(k)?.phase === 'prep');
    climb(k, ROYALE_FLOOR);
    tickUntil(k, () => !!fightOf(k));
    // Down in one blow: hp to the floor, and the field's next swing finishes it.
    weaken(k);
    tickUntil(k, () => worldOf(k).recovering, 5_000);
    expect(worldOf(k).spot).toBe(FOOT);
    expect(runOf(k)).toBeNull();
    expect(lockLeft(k)).toBe(LOCKOUT_TICKS);
  }, 30_000);

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
    const k = inHall();
    climb(k, ROYALE_FLOOR);
    expect(fightOf(k)).toBeNull();
    expect(k.dispatch(climbCommand({ floor: DARK_FLOOR })).ok).toBe(true);
    expect(worldOf(k).spot).toBe(FOOT);
    expect(lockLeft(k)).toBe(LOCKOUT_TICKS);
  }, 30_000);

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

  it('marks floor 15 shut after a loss, cleared or not, and names no verdict outside an attempt but floor 16’s refusal', () => {
    const k = inHall();
    expect(rung(k, DARK_FLOOR).shut).toBe(false);
    climb(k, null); // the forfeit
    expect(rung(k, DARK_FLOOR).shut).toBe(true);
    expect(rung(k, DARK_FLOOR).status).toBe('cleared');
    expect(rung(k, 'ascent_f14').shut).toBe(false);
    // With no attempt the ladder never goes to floor 16 (old `festivalLadder`: `closed`), and nothing else has a verdict.
    const verdicts = worldView(k).rideVerdicts;
    expect(Object.keys(verdicts)).toEqual([ROYALE_FLOOR]);
    expect(verdicts[ROYALE_FLOOR].kind).toBe('refuse');
    expect(verdicts[ROYALE_FLOOR].msg).toContain('Floor 16');
  }, 30_000);
});

// ---------- The royale's field (src/systems/festival/royale.ts) ----------

interface Spot {
  x: number;
  y: number;
}

/** The attempt's field in a slice set `patch` hands over. */
const fieldIn = (s: Record<string, any>): RoyaleField => (s.festival as FestivalState).run!.field!;
/** The attempt's field, as a copy. */
const fieldOf = (k: Kernel): RoyaleField => runOf(k)!.field!;

/** Points far from the start, every den and every cache, and apart from each other: where a trimmed field keeps its survivors. */
function remote(map: RoyaleMap, count: number): Spot[] {
  const picks: Spot[] = [];
  const far = (p: Spot, q: Spot, d: number) => Math.hypot(p.x - q.x, p.y - q.y) >= d;
  for (let y = 6; y < map.size - 12; y += 6) {
    for (let x = 6; x < map.size - 6; x += 6) {
      const p = { x, y };
      if (!far(p, map.start, 100)) continue;
      if (ROYALE_DENS.some((d) => !far(p, map.dens[d.id], d.radius + 10))) continue;
      if (ROYALE_CACHES.some((c) => !far(p, map.caches[c.id], 10))) continue;
      if (picks.some((q) => !far(p, q, 30))) continue;
      picks.push(p);
      if (picks.length === count) return picks;
    }
  }
  throw new Error(`seed ${map.seed}: no ${count} remote spots`);
}

/** The cell of a section nearest the middle of its cells, so a step does not leave it. */
function heartOf(map: RoyaleMap, sectionId: string): Spot {
  const cells: Spot[] = [];
  for (let i = 0; i < map.cells.length; i++) {
    if (sectionIdOf(map.cells[i]) === sectionId) cells.push({ x: (i % map.size) + 0.5, y: Math.floor(i / map.size) + 0.5 });
  }
  if (!cells.length) throw new Error(`seed ${map.seed}: no ${sectionId} on the map`);
  const mid = { x: cells.reduce((a, c) => a + c.x, 0) / cells.length, y: cells.reduce((a, c) => a + c.y, 0) / cells.length };
  return cells.reduce((a, b) => (Math.hypot(a.x - mid.x, a.y - mid.y) <= Math.hypot(b.x - mid.x, b.y - mid.y) ? a : b));
}

/** Tick until the fight, if any, is over. */
function settle(k: Kernel): void {
  tickUntil(k, () => !fightOf(k), 5000);
}

interface Royale {
  k: Kernel;
  map: RoyaleMap;
}

/** In the royale with the board cleared: three survivors far from everything, nothing taken, cleared or seen, the player free. */
function inRoyale(k: Kernel = inHall()): Royale {
  climb(k, ROYALE_FLOOR);
  k.tick(); // the field opens
  patch(k, (s) => {
    const field = fieldIn(s);
    field.fighters = remote(mapOf(field), 3).map((p, i) => ({ id: i + 1, monsterId: 'ph_survivor_blade', x: p.x, y: p.y, hp: 1, wins: 0 }));
    field.taken = [];
    field.cleared = [];
    field.seen = [];
  });
  return { k, map: mapOf(fieldOf(k)) };
}

/** Put the player on a spot, the plan clear, and tick once. */
function standAt(k: Kernel, p: Spot): void {
  patch(k, (s) => {
    const player = fieldIn(s).player;
    player.x = p.x;
    player.y = p.y;
    delete player.target;
    delete player.goal;
  });
  k.tick();
}

/** Everything the player owns: worn, carried, sheathed. */
const everythingOwned = (k: Kernel): ItemInstance[] => {
  const sheathed = slice<MartialState>(k, 'martial').sheathed;
  return [...everything(k), ...(sheathed ? [sheathed] : [])];
};

describe('the royale', () => {
  it('a plan alone wins the royale in the game, with no hand on the field', () => {
    const k = inHall();
    k.dispatch(setRoyalePlan({ ids: ['lie_low', 'hunt_weakest'] }));
    climb(k, ROYALE_FLOOR);
    let hand = 0;
    tickUntil(k, () => {
      const run = runOf(k);
      if (run?.field?.player.target) hand += 1;
      return !run;
    });
    expect(hand).toBe(0);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(1);
    expect(counterOf(k, 'boss:f16_arena')).toBe(1);
  }, 30_000);

  it('a click on the field walks the player there, and the plan takes over on arrival', () => {
    const k = inHall();
    climb(k, ROYALE_FLOOR);
    k.tick();
    // Clear the way so no fight interrupts the walk.
    patch(k, (s) => {
      const field = fieldIn(s);
      field.fighters = remote(mapOf(field), 3).map((p, i) => ({ id: i + 1, monsterId: 'ph_survivor_blade', x: p.x, y: p.y, hp: 1, wins: 0 }));
    });
    const at = fieldOf(k).player;
    const goal = { x: at.x - 12, y: at.y - 12 };
    expect(k.dispatch(walkOnField(goal)).ok).toBe(true);
    expect(fieldOf(k).player.target).toEqual(goal);
    tickUntil(k, () => !fieldOf(k).player.target, 4000);
    const p = fieldOf(k).player;
    expect(Math.hypot(p.x - goal.x, p.y - goal.y)).toBeLessThan(0.5);
    expect(k.dispatch(walkOnField({ x: 500, y: -3 })).ok).toBe(true);
    expect(fieldOf(k).player.target).toEqual({ x: ROYALE_FIELD.size, y: 0 });
  }, 30_000);

  it('the plan is ranked, kept between attempts, and cleans up what it is given', () => {
    const k = inHall();
    k.dispatch(setRoyalePlan({ ids: ['keep_away', 'nonsense', 'keep_away', 'press_nearest', 'hold_centre', 'lie_low'] }));
    expect(royalePlan(festivalOf(k).plan).map((s) => s.id)).toEqual(['keep_away', 'press_nearest', 'hold_centre']);
    climb(k, null); // a forfeit
    expect(festivalOf(k).plan).toEqual(['keep_away', 'press_nearest', 'hold_centre']);
    expect(royalePlan(festivalOf(makeGame({ seed: 0 })).plan).map((s) => s.id)).toEqual(DEFAULT_ROYALE_PLAN);
  });

  it('a knockout mid-royale loses the attempt even from a field fight against the champion', () => {
    // Covered by 'a knockout in the royale ejects too'; here the field is
    // down to its champion before the player is put down.
    const k = inHall();
    climb(k, ROYALE_FLOOR);
    k.tick();
    patch(k, (s) => {
      const field = fieldIn(s);
      field.fighters = field.fighters.slice(0, 1).map((f) => ({ ...f, x: field.player.x, y: field.player.y - 1 }));
    });
    tickUntil(k, () => !!fightOf(k), 200);
    expect(fightOf(k)!.enemies[0]!.defId).toBe('ph_survivor_champion');
    weaken(k);
    tickUntil(k, () => worldOf(k).recovering, 5_000);
    expect(worldOf(k).spot).toBe(FOOT);
    expect(countsOf(k)['boss:f16_arena']).toBeUndefined();
    expect(floorCleared(reader(k), FLOORS[ROYALE_FLOOR])).toBe(false);
  }, 30_000);

  it("a win clears floor 16 and counts the run's win; the field is empty after", () => {
    const k = inHall();
    climb(k, ROYALE_FLOOR);
    tickUntil(k, () => !runOf(k));
    expect(counterOf(k, 'boss:f16_arena')).toBe(1);
    expect(floorCleared(reader(k), FLOORS[ROYALE_FLOOR])).toBe(true);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(1);
    expect(lockLeft(k)).toBe(0);
    // Nothing fights on an empty field.
    for (let i = 0; i < 500; i++) k.tick();
    expect(fightOf(k)).toBeNull();
    expect(worldOf(k).spot).toBe(ARENA);
  }, 30_000);
});

describe('the royale: the attempt’s field', () => {
  it('the attempt draws its field’s seed at the start and the field opens on it', () => {
    const k = inHall();
    expect(Number.isInteger(runOf(k)!.fieldSeed)).toBe(true);
    climb(k, ROYALE_FLOOR);
    k.tick();
    const run = runOf(k)!;
    expect(run.field!.seed).toBe(run.fieldSeed);
    expect(run.field!.layout).toBe(ROYALE_LAYOUT_VERSION);
    expect(run.field!.openedAt).toBeLessThanOrEqual(nowOf(k));
    // On the map’s start (a tick of walking has passed).
    const start = mapOf(run.field!).start;
    expect(Math.hypot(run.field!.player.x - start.x, run.field!.player.y - start.y)).toBeLessThan(1);
  }, 30_000);

  it('a field from an older layout is replaced whole, but never during a fight', () => {
    const { k } = inRoyale();
    patch(k, (s) => {
      const field = fieldIn(s);
      field.fighters[0].x = field.player.x;
      field.fighters[0].y = field.player.y - 1;
    });
    tickUntil(k, () => !!fightOf(k), 50);
    patch(k, (s) => {
      delete fieldIn(s).layout;
    });
    const before = fieldOf(k);
    let during = 0;
    for (let i = 0; i < 30 && fightOf(k); i++) {
      k.tick();
      if (fightOf(k)) {
        during += 1;
        // The same field: no layout, its trimmed survivors, the same opening tick.
        const field = fieldOf(k);
        expect(field.layout).toBeUndefined();
        expect(field.fighters.map((f) => f.id)).toEqual(before.fighters.map((f) => f.id));
        expect(field.openedAt).toBe(before.openedAt);
      }
    }
    expect(during, 'the fight lasted at least a tick past the layout change').toBeGreaterThan(0);
    settle(k);
    k.tick();
    // The fight over: a new field on the attempt’s terrain.
    const run = runOf(k)!;
    expect(run.field!.openedAt).toBeGreaterThan(before.openedAt!);
    expect(run.field!.layout).toBe(ROYALE_LAYOUT_VERSION);
    expect(run.field!.fighters).toHaveLength(99);
    expect(run.field!.seed).toBe(run.fieldSeed);
  }, 30_000);

  it('the champion’s fall is the win; a field emptied without it is not, and gets its champion back', () => {
    const { k } = inRoyale();
    // A copy of the attempt: the fight's end runs on it in the probe's context, and its field goes back by `patch`.
    const run = runOf(k)!;
    const field = run.field!;
    const [a, b] = field.fighters;
    // Two survivors in one fight and no one else standing: a fight that did not hold the champion.
    a.engaged = true;
    b.engaged = true;
    field.fighters = [a, b];
    const now = nowOf(k);
    expect(runIn(k, (ctx) => royaleFightWon(ctx as never, run, now))).toBe(false);
    expect(field.fighters).toHaveLength(0);
    patch(k, (s) => {
      (s.festival as FestivalState).run!.field = field;
    });
    expect(runOf(k)).not.toBeNull();
    expect(countsOf(k)[FESTIVAL_WINS_KEY]).toBeUndefined();
    k.tick();
    expect(fieldOf(k).fighters).toHaveLength(1);
    // That champion reaches the player: its fall is the win.
    patch(k, (s) => {
      const f = fieldIn(s);
      const champion = f.fighters[0];
      champion.x = f.player.x;
      champion.y = f.player.y - 1;
    });
    tickUntil(k, () => !runOf(k));
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(1);
    expect(counterOf(k, 'boss:f16_arena')).toBe(1);
  }, 30_000);

  it('a plan alone wins within a festival day with the default plan, and the field ran on its radar', () => {
    const k = inHall();
    climb(k, ROYALE_FLOOR);
    const from = nowOf(k);
    expect(royalePlan(festivalOf(k).plan).map((p) => p.id)).toEqual(DEFAULT_ROYALE_PLAN);
    tickUntil(k, () => !runOf(k), 14_400);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(1);
    expect(nowOf(k) - from).toBeLessThanOrEqual(14_400);
  }, 30_000);
});

describe('the royale: caches and lent gear', () => {
  it('a cache lends gear for the attempt: worn if its slot is free, in the pack if not, never sold, taken back when the attempt is lost', () => {
    const { k, map } = inRoyale();
    standAt(k, map.caches.woodcutter_hut);
    settle(k);
    expect(fieldOf(k).taken).toContain('woodcutter_hut');
    expect(itemsOf(k).equipment.chest?.defId).toBe('leather_vest');
    const vest = itemsOf(k).equipment.chest!;
    expect(runOf(k)!.lent).toContain(vest.uid);
    expect(vest.slots).toBe(0);
    // A bow is not the issued sword’s family and the weapon slot is taken, so it goes to the pack.
    standAt(k, map.caches.poachers_stash);
    settle(k);
    const lentNow = runOf(k)!.lent!;
    const bow = itemsOf(k).inventory.find((i) => i.defId === 'hunting_bow' && lentNow.includes(i.uid))!;
    expect(bow).toBeDefined();
    expect(itemsOf(k).equipment.weapon?.uid).toBe(runOf(k)!.issued);
    // Lent: not for sale.
    const gold = goldOf(k);
    k.dispatch(sellItems({ uids: [bow.uid] }));
    k.dispatch(sellItems({ uids: [bow.uid, vest.uid] }));
    expect(goldOf(k)).toBe(gold);
    expect(itemsOf(k).inventory.some((i) => i.uid === bow.uid)).toBe(true);
    // Taken once: standing on it again gives nothing more.
    const lent = [...runOf(k)!.lent!];
    standAt(k, map.caches.poachers_stash);
    expect(runOf(k)!.lent).toEqual(lent);
    // A forfeit: everything lent goes back, wherever it is.
    climb(k, null);
    expect(runOf(k)).toBeNull();
    const owned = everythingOwned(k);
    for (const uid of lent) expect(owned.some((i) => i.uid === uid), `lent ${uid}`).toBe(false);
    expect(itemsOf(k).equipment.chest).toBeUndefined();
  }, 30_000);

  it('the lent gear is taken back when the royale is won, too', () => {
    const { k, map } = inRoyale();
    standAt(k, map.caches.woodcutter_hut);
    settle(k);
    standAt(k, map.caches.poachers_stash);
    settle(k);
    const lent = [...runOf(k)!.lent!];
    expect(lent.length).toBeGreaterThanOrEqual(2);
    // The last survivor reaches the player: the champion, fought alone.
    patch(k, (s) => {
      const field = fieldIn(s);
      field.fighters = [{ ...field.fighters[0], x: field.player.x, y: field.player.y - 1 }];
    });
    tickUntil(k, () => !runOf(k));
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(1);
    const owned = everythingOwned(k);
    for (const uid of lent) expect(owned.some((i) => i.uid === uid), `lent ${uid}`).toBe(false);
  }, 30_000);

  it('a lent weapon of the issued family takes the hand; the issued weapon goes to the pack; both are taken back, the held weapon returns', () => {
    const k0 = strong(geared(atFourteen()));
    const heldSword = itemsOf(k0).equipment.weapon!.uid;
    const { k, map } = inRoyale(inHall(k0));
    expect(itemsOf(k).equipment.weapon?.uid).toBe(runOf(k)!.issued);
    expect(itemsOf(k).equipment.weapon?.defId).toBe('rusty_sword');
    const issued = runOf(k)!.issued!;
    // The smithy lends the weapon of the issued family: a step up on the rusty sword.
    standAt(k, map.caches.smithy);
    settle(k);
    expect(fieldOf(k).taken).toContain('smithy');
    const lentSword = itemsOf(k).equipment.weapon!;
    expect(lentSword.defId).toBe(CACHE_WEAPONS.sword);
    expect(runOf(k)!.lent).toContain(lentSword.uid);
    expect(itemsOf(k).inventory.some((i) => i.uid === issued)).toBe(true);
    // The hand holds a lent weapon now, not the issued one: a second one goes to the pack.
    standAt(k, map.caches.trapper_cabin);
    settle(k);
    expect(itemsOf(k).equipment.weapon?.uid).toBe(lentSword.uid);
    const lentNow = runOf(k)!.lent!;
    expect(itemsOf(k).inventory.some((i) => i.defId === 'wolf_fang_blade' && lentNow.includes(i.uid))).toBe(true);
    // Neither the lent weapons nor the issued one can be sold.
    const gold = goldOf(k);
    k.dispatch(sellItems({ uids: [issued, ...lentNow] }));
    expect(goldOf(k)).toBe(gold);
    // A forfeit: all of it goes back, and the held sword is in the hand again.
    const lent = [...runOf(k)!.lent!];
    climb(k, null);
    const owned = everythingOwned(k);
    for (const uid of [issued, ...lent]) expect(owned.some((i) => i.uid === uid), `taken back ${uid}`).toBe(false);
    expect(itemsOf(k).equipment.weapon?.uid).toBe(heldSword);
  }, 30_000);

  it('a two-handed family takes the hand the same way: the smithy’s spear for the issued spear', () => {
    const k0 = strong(atFourteen());
    patch(k0, (s) => {
      s.skills.skills.spear_combat = { level: 12, xp: 0 };
    });
    const { k, map } = inRoyale(inHall(k0));
    expect(itemsOf(k).equipment.weapon?.defId).toBe('old_spear');
    standAt(k, map.caches.smithy);
    settle(k);
    expect(fieldOf(k).taken).toContain('smithy');
    expect(itemsOf(k).equipment.weapon?.defId).toBe(CACHE_WEAPONS.spear);
    expect(runOf(k)!.lent).toContain(itemsOf(k).equipment.weapon!.uid);
    expect(itemsOf(k).inventory.some((i) => i.uid === runOf(k)!.issued)).toBe(true);
  }, 30_000);

  it('a lent weapon that is the issued item itself does not take the hand', () => {
    const k0 = strong(atFourteen());
    patch(k0, (s) => {
      s.skills.skills.spear_combat = { level: 12, xp: 0 };
    });
    const { k, map } = inRoyale(inHall(k0));
    // The cliff cairn holds an old spear, the item the door issued.
    standAt(k, map.caches.cliff_cairn);
    settle(k);
    expect(fieldOf(k).taken).toContain('cliff_cairn');
    expect(itemsOf(k).equipment.weapon?.uid).toBe(runOf(k)!.issued);
    const lentNow = runOf(k)!.lent!;
    expect(itemsOf(k).inventory.some((i) => i.defId === 'old_spear' && lentNow.includes(i.uid))).toBe(true);
  }, 30_000);

  it('a lent weapon is wielded when the hand is empty', () => {
    const { k, map } = inRoyale();
    unequip(k, 'weapon');
    expect(itemsOf(k).equipment.weapon).toBeUndefined();
    standAt(k, map.caches.trapper_cabin);
    settle(k);
    expect(itemsOf(k).equipment.weapon?.defId).toBe('wolf_fang_blade');
    expect(runOf(k)!.lent).toContain(itemsOf(k).equipment.weapon!.uid);
  }, 30_000);

  it('a weapon cache lends a weapon of the issued family; a heal cache restores health at once', () => {
    const { k, map } = inRoyale();
    // The door issued a rusty sword: the sword family.
    standAt(k, map.caches.smithy);
    settle(k);
    expect(fieldOf(k).taken).toContain('smithy');
    const lent = runOf(k)!.lent!;
    expect(everything(k).some((i) => i.defId === CACHE_WEAPONS.sword && lent.includes(i.uid))).toBe(true);
    const max = playerStats(k).maxHp;
    setHp(k, max * 0.2);
    standAt(k, map.caches.fisher_hut);
    settle(k);
    const share = ROYALE_CACHES.find((c) => c.id === 'fisher_hut')!.heal!;
    expect(hpOf(k) - max * 0.2).toBeGreaterThanOrEqual(max * share * 0.9);
  }, 30_000);

  it('the glade’s spring heals the player while they stand in it', () => {
    const { k, map } = inRoyale();
    const max = playerStats(k).maxHp;
    const gain = (p: Spot) => {
      setHp(k, max * 0.5);
      standAt(k, p);
      return hpOf(k) - max * 0.5;
    };
    const base = gain(map.start);
    const spring = gain(heartOf(map, 'glade'));
    expect(spring - base).toBeGreaterThanOrEqual(max * ROYALE_SECTIONS.glade.heal! * 0.9);
  }, 30_000);
});

describe('the royale: dens', () => {
  const serpent = ROYALE_DENS.find((d) => d.id === 'serpent_pool')!;

  it('walking into a den is a staged fight with its monsters at their pinned levels; won, the den is cleared and the royale goes on', () => {
    const { k, map } = inRoyale();
    const gold = goldOf(k);
    const run = runOf(k)!;
    const standing = fieldOf(k).fighters.length;
    standAt(k, map.dens[serpent.id]);
    expect(fightOf(k)).not.toBeNull();
    expect(fieldOf(k).denFight).toBe(serpent.id);
    const foes = fightOf(k)!.enemies.filter((e) => !!e);
    expect(foes.map((e) => e!.defId).sort()).toEqual(serpent.foes.map((f) => f.monsterId).sort());
    expect(foes.map((e) => e!.level)).toEqual(serpent.foes.map((f) => f.level));
    settle(k);
    const field = fieldOf(k);
    expect(field.denFight).toBeUndefined();
    expect(field.cleared).toContain(serpent.id);
    expect(field.player.lastFight).toBeDefined();
    // Not a royale fight: nothing leaves the field, nothing is won, and the den’s monsters pay nothing.
    expect(field.fighters).toHaveLength(standing);
    // The same attempt: its seed and phase.
    expect(runOf(k)?.fieldSeed).toBe(run.fieldSeed);
    expect(runOf(k)?.phase).toBe('royale');
    expect(countsOf(k)[FESTIVAL_WINS_KEY]).toBeUndefined();
    expect(goldOf(k)).toBe(gold);
    // The den stays cleared: standing in it starts nothing.
    for (let i = 0; i < 20; i++) k.tick();
    expect(fightOf(k)).toBeNull();
    // What it guarded is open now.
    const guarded = ROYALE_CACHES.find((c) => c.den === serpent.id)!;
    standAt(k, map.caches[guarded.id]);
    settle(k);
    expect(fieldOf(k).taken).toContain(guarded.id);
  }, 30_000);

  it('a knockout in a den is a festival loss like any other on floor 16', () => {
    const { k, map } = inRoyale();
    standAt(k, map.dens[serpent.id]);
    expect(fightOf(k)).not.toBeNull();
    weaken(k);
    tickUntil(k, () => worldOf(k).recovering, 5_000);
    expect(worldOf(k).spot).toBe(FOOT);
    expect(runOf(k)).toBeNull();
    expect(lockLeft(k)).toBe(LOCKOUT_TICKS);
  }, 30_000);
});

describe('rewards: the first win pays, reruns pay nothing', () => {
  it('the first win of a run pays the laurel; a rerun pays nothing at all', () => {
    const k = inHall();
    winFromHall(k);
    expect(owned(k, FESTIVAL_REWARD)).toBe(1);
    const gold = slice<{ gold: number }>(k, 'gold').gold;
    const count = everything(k).length;
    // A rerun from floor 16: the dark room again, the hall, the royale.
    climb(k, DARK_FLOOR);
    expect(runOf(k)?.phase).toBe('dark');
    tickUntil(k, () => runOf(k)?.phase === 'prep');
    winFromHall(k);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(2);
    expect(owned(k, FESTIVAL_REWARD)).toBe(1);
    expect(slice<{ gold: number }>(k, 'gold').gold).toBe(gold);
    expect(everything(k).length).toBe(count);
    expect(festivalOf(k).legacy.tokens).toEqual([]);
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);

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

  it('a save mid-royale fight reloads with its survivors walking again, and the royale can still be won', () => {
    const k = inHall();
    climb(k, ROYALE_FLOOR);
    tickUntil(k, () => !!fightOf(k) && fieldOf(k).fighters.some((f) => f.engaged));
    const before = fieldOf(k);
    expect(before.seed).toBe(runOf(k)!.fieldSeed);
    const loaded = makeGame({ seed: 0 });
    expect(loaded.load(k.save(0)).ok).toBe(true);
    // Only the seed is saved; the terrain is rebuilt from it.
    expect(fieldOf(loaded).seed).toBe(before.seed);
    expect(mapOf(fieldOf(loaded)).start).toEqual(mapOf(before).start);
    // The save holds the fight here (src/systems/combat/README.md): it goes
    // on after the load with the same survivors engaged, where the old build
    // dropped it and the survivors walked again.
    const engaged = (field: RoyaleField) => field.fighters.filter((f) => f.engaged).map((f) => f.id);
    expect(fightOf(loaded)).not.toBeNull();
    expect(engaged(fieldOf(loaded))).toEqual(engaged(before));
    expect(engaged(before).length).toBeGreaterThan(0);
    loaded.tick();
    expect(fieldOf(loaded).fighters.some((f) => f.engaged && !fightOf(loaded))).toBe(false);
    tickUntil(loaded, () => !runOf(loaded));
    expect(counterOf(loaded, FESTIVAL_WINS_KEY)).toBe(1);
  }, 30_000);
});

describe('the hidden title', () => {
  const TITLE = 'first_through_the_door';
  const titlesOf = (k: Kernel): string[] => slice<TitlesState>(k, 'titles').earned;

  /** The festival clock reads `clock` in the hall, as the old cases wrote `run.clock`. */
  function clockTo(k: Kernel, clock: number): void {
    patch(k, (s) => {
      (s.festival as FestivalState).run!.clock = clock;
    });
  }

  it('fires for a win whose climb began within twelve festival hours of the door', () => {
    const k = inHall();
    clockTo(k, SWIFT_ENTRY_TICKS - 1);
    expect(countsOf(k)[FESTIVAL_SWIFT_KEY]).toBeUndefined();
    winFromHall(k);
    expect(counterOf(k, FESTIVAL_SWIFT_KEY)).toBe(1);
    expect(titlesOf(k)).toContain(TITLE);
  }, 30_000);

  it('a later climb wins without it, and leaves no trace of it', () => {
    const k = inHall();
    clockTo(k, SWIFT_ENTRY_TICKS + 1);
    winFromHall(k);
    expect(counterOf(k, FESTIVAL_WINS_KEY)).toBe(1);
    expect(countsOf(k)[FESTIVAL_SWIFT_KEY]).toBeUndefined();
    expect(titlesOf(k)).not.toContain(TITLE);
  }, 30_000);

  it('an early climb that is lost writes nothing: no counter, no title', () => {
    const k = inHall();
    climb(k, ROYALE_FLOOR);
    expect(runOf(k)!.enteredAt).toBeLessThanOrEqual(SWIFT_ENTRY_TICKS);
    climb(k, null); // the forfeit
    expect(countsOf(k)[FESTIVAL_SWIFT_KEY]).toBeUndefined();
    expect(titlesOf(k)).not.toContain(TITLE);
    // Secret: hidden from the UI until earned.
    expect(TITLES[TITLE].secret).toBe(true);
  }, 30_000);
});
