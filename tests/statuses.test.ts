import { afterEach, describe, expect, it } from 'vitest';
import { defineSystem, on, PLAYER, type GameEvent, type Kernel, type Modifier } from '../src/kernel';
import {
  availableMax,
  drawPool,
  healPlayer,
  playerHealed,
  poolHooks,
  reserveFloor,
  trueMax,
  type ResourcesState,
} from '../src/systems/resources';
import {
  armedFact,
  ELEMENTAL_TYPES,
  statBlockOf,
  statMod,
  statOf,
  wieldTagFact,
  type DamageType,
  type StatKey,
} from '../src/systems/stats';
import statuses, {
  APPLICATION_FLOOR,
  amplifyStatuses,
  applyStatus,
  conditionFatal,
  dueGraftSpread,
  escalationChance,
  fieldHunger,
  findStatus,
  fireStatusEvent,
  graftHarvest,
  graftLedger,
  hasStatus,
  healAllowance,
  heldOf,
  HUNGER_SLOW_CEILING,
  removeStatus,
  setSituation,
  statusBarDamage,
  statusBlocks,
  statusCeiling,
  statusCostMult,
  statusDampingFor,
  statusDisadvantage,
  statusDisplacedExit,
  STATUSES,
  statusForcedStyle,
  statusMissChance,
  statusNegativeHeadroom,
  statusRetaliation,
  statusReversesBar,
  stripStatuses,
  tendOnDamage,
  tickStatuses,
  type StatusApplication,
  type StatusDef,
  type StatusesState,
  type StatusEvent,
  type StatusEventDetail,
  type StatusInstance,
  type StatusTickInput,
} from '../src/systems/statuses';
import { ask, emit, makeGame, makeKernel, patch, probe, run, setMods, slice } from './helpers';

/**
 * Port of the old tests/statuses.test.ts. Changed: the call shape only.
 *
 * - `applyStatus(state, bearer, app, source, stats, pen)` is `apply(g, who, app,
 *   source, block, pen)`. A block (`{ resPoison: 1 }`) is given to the bearer
 *   through the test-only probe and the dose is marked as done to the bearer;
 *   `true` marks it so with the stats the bearer already has.
 * - A monster is an entity id. Where the old test took a species for its
 *   resistance (an ice slime: cold 0.5), the entity gets that resistance from
 *   the probe. The species data arrives with combat (spine port 4).
 * - `tickStatuses(state, bearer, input)` is the `statuses/tick` request.
 *   `g.tick()` is `kernel.tick()`.
 * - Where the old test wrote to a held instance, `edit` does it through a
 *   save and a load.
 *
 * Left behind, as `it.todo` with the port that owns what the case needs.
 * Every game made by `fresh` is checked for stale stats after its test.
 */

const games: Kernel[] = [];
const track = (g: Kernel): Kernel => {
  games.push(g);
  return g;
};
const fresh = (seed = 1): Kernel => track(makeGame({ seed }));

/** No stat of any game made so far is stale. */
function allSound(): void {
  for (const g of games.splice(0)) expect(g.staleStats()).toEqual([]);
}

afterEach(allSound);

/** A resistance block that stops nothing, for isolating one type at a time. */
const NO_RESIST = {
  slashing: 0, piercing: 0, bludgeoning: 0, heat: 0,
  cold: 0, poison: 0, acid: 0, arcane: 0, lightning: 0,
  earth: 0, water: 0, light: 0, dark: 0, wind: 0,
} as const;

const list = (g: Kernel, who: string = PLAYER) => heldOf(slice<StatusesState>(g, 'statuses'), who) as StatusInstance[];
const find = (g: Kernel, id: string, who: string = PLAYER) => findStatus(list(g, who), id);
const has = (g: Kernel, id: string, who: string = PLAYER) => hasStatus(list(g, who), id);

const statMods = (block: Record<string, number>): Modifier[] =>
  Object.entries(block).map(([key, value]) => statMod(key as StatKey, 'add', value));

/** An entity that is not the player, with the resistances given. */
function body(g: Kernel, id: string, block: Record<string, number> = {}): string {
  setMods(g, statMods(block), id);
  return id;
}

function apply(
  g: Kernel,
  who: string,
  app: StatusApplication,
  source?: string,
  block?: Record<string, number> | true,
  penetration?: number,
): StatusInstance | null {
  if (block && block !== true) setMods(g, statMods(block), who);
  return ask(g, applyStatus, { entity: who, app, source, resist: !!block, penetration });
}

const fire = (g: Kernel, event: StatusEvent, detail?: StatusEventDetail, who: string = PLAYER) =>
  ask(g, fireStatusEvent, { entity: who, on: event, detail });

const hp = (g: Kernel) => slice<ResourcesState>(g, 'resources').values.hp;
const pool = (g: Kernel, id: 'hp' | 'stamina' | 'mana' | 'spirit') => slice<ResourcesState>(g, 'resources').values[id];
const usable = (g: Kernel, id: 'hp' | 'stamina' | 'mana' | 'spirit') => availableMax(statBlockOf(g), poolHooks(g), id);
const setPool = (g: Kernel, id: string, value: number) => patch(g, (s) => (s.resources.values[id] = value));

const tickOf = (g: Kernel, input: StatusTickInput, who: string = PLAYER) => ask(g, tickStatuses, { entity: who, ...input });

/** Tick a bearer's conditions with plausible health numbers. */
function tick(g: Kernel, times = 1, inCombat = true): number {
  let total = 0;
  for (let i = 0; i < times; i++) total += tickOf(g, { hp: hp(g), maxHp: usable(g, 'hp'), inCombat }).damage;
  return total;
}

/** Write to a held instance, the way the old tests did on the live object. */
function edit(g: Kernel, id: string, change: (held: StatusInstance) => void, who: string = PLAYER): void {
  patch(g, (s) => change((s.statuses as StatusesState).held[who].find((h) => h.id === id)!));
}

const RUSTY_SWORD: Modifier[] = [
  armedFact(),
  wieldTagFact('sword'),
  wieldTagFact('metal'),
  statMod('damage', 'add', 3, 'Rusty Sword', { kind: 'item', slot: 'weapon' }),
];

describe('stacking rules', () => {
  it("'highest' keeps the worst dose and ignores weaker ones", () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'poison', intensity: 2 });
    apply(g, PLAYER, { id: 'poison', intensity: 1 }); // weaker: ignored
    expect(find(g, 'poison')!.intensity).toBe(2);

    apply(g, PLAYER, { id: 'poison', intensity: 3 }); // stronger: takes over
    expect(find(g, 'poison')!.intensity).toBe(3);
  });

  it("'absorb' folds part of a new flame in without extending the clock", () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'on_fire', intensity: 2 });
    const clock = find(g, 'on_fire')!.ticksLeft;
    tick(g, 5); // let some of it burn away

    apply(g, PLAYER, { id: 'on_fire', intensity: 2 });
    const after = find(g, 'on_fire')!;
    expect(after.intensity).toBeCloseTo(3); // 2 + 50% of 2
    expect(after.ticksLeft).toBeLessThan(clock!);
  });

  it("'sum' adds up and gives way to something worse at its ceiling", () => {
    const g = fresh();
    for (let i = 0; i < 4; i++) apply(g, PLAYER, { id: 'chilled', intensity: 0.25 });
    expect(has(g, 'chilled')).toBe(false);
    expect(has(g, 'frozen')).toBe(true);
  });

  it("'count' escalates once enough separate wounds are open", () => {
    const g = fresh();
    for (let i = 0; i < 4; i++) apply(g, PLAYER, { id: 'bleeding', intensity: 1 });
    expect(find(g, 'bleeding')!.stacks).toBe(4);

    apply(g, PLAYER, { id: 'bleeding', intensity: 1 }); // the fifth
    expect(has(g, 'bleeding')).toBe(false);
    expect(has(g, 'lacerated')).toBe(true);
  });

  it('a condition can block another outright', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'frozen', intensity: 1 });
    apply(g, PLAYER, { id: 'chilled', intensity: 0.5 });
    expect(has(g, 'chilled')).toBe(false);
  });
});

describe('removal belongs to the source', () => {
  it('a source can make its condition permanent and name its own cure', () => {
    const g = fresh();
    apply(g, PLAYER, {
      id: 'on_fire',
      intensity: 1,
      duration: 'permanent',
      removal: [{ on: 'cure', tag: 'water', effect: 'remove' }],
    });
    expect(find(g, 'on_fire')!.ticksLeft).toBeNull();

    tick(g, 500); // it will never simply burn out
    expect(has(g, 'on_fire')).toBe(true);

    fire(g, 'cure', { tag: 'fire' }); // wrong cure
    expect(has(g, 'on_fire')).toBe(true);
    fire(g, 'cure', { tag: 'water' });
    expect(has(g, 'on_fire')).toBe(false);
  });

  it('being tended to closes a bleed and eases a laceration back to one', () => {
    const g = fresh();
    setPool(g, 'hp', 10); // room to actually heal

    apply(g, PLAYER, { id: 'lacerated', intensity: 2 });
    emit(g, healPlayer, { amount: 5, kind: 'rest' });
    // One treatment is not enough to close it: it drops back to a bleed.
    expect(has(g, 'lacerated')).toBe(false);
    expect(has(g, 'bleeding')).toBe(true);

    emit(g, healPlayer, { amount: 5, kind: 'rest' });
    expect(has(g, 'bleeding')).toBe(false);
  });

  it('a seared burn ignores idling and yields only to real treatment', () => {
    const g = fresh();
    setPool(g, 'hp', 10);
    apply(g, PLAYER, { id: 'blaze_burn', intensity: 1 });

    emit(g, healPlayer, { amount: 1, kind: 'idle' });
    expect(has(g, 'blaze_burn')).toBe(true);
    emit(g, healPlayer, { amount: 1, kind: 'salve' });
    expect(has(g, 'blaze_burn')).toBe(false);
  });

  it('ice does not survive being hit', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'frozen', intensity: 1 });
    fire(g, 'damageTaken');
    expect(has(g, 'frozen')).toBe(false);
  });
});

describe('a parting blow on expiry', () => {
  it('pays out when the clock runs out — the blade working itself loose', () => {
    const g = fresh(40);
    apply(g, PLAYER, { id: 'skewered', intensity: 1 });
    const def = STATUSES.skewered;

    // Nothing while it is still in: the mods are the cost, not the damage.
    expect(tick(g, 1)).toBe(0);
    const total = tick(g, (def.duration as number) + 2);
    expect(total).toBeCloseTo(def.expireDamage!.flat!);
    expect(has(g, 'skewered')).toBe(false);
  });

  it('pays nothing when it is dealt with early — which is what a technique buys', () => {
    const g = fresh(41);
    apply(g, PLAYER, { id: 'skewered', intensity: 1 });
    ask(g, stripStatuses, { entity: PLAYER, ids: ['skewered'] });
    expect(tick(g, 200)).toBe(0);
  });
});

describe('damage over time', () => {
  it('a bleed is priced off current health and eases off out of combat', () => {
    const g = fresh();
    setPool(g, 'hp', 1000);
    apply(g, PLAYER, { id: 'bleeding', intensity: 1 });

    const fighting = tickOf(g, { hp: 1000, maxHp: 1000, inCombat: true }).damage;
    const resting = tickOf(g, { hp: 1000, maxHp: 1000, inCombat: false }).damage;
    expect(fighting).toBeGreaterThan(0);
    expect(resting).toBeLessThan(fighting);
  });

  it('resistance blunts a condition the same way it blunts a blow', () => {
    const bare = fresh();
    const warded = fresh();
    for (const g of [bare, warded]) apply(g, PLAYER, { id: 'poison', intensity: 4 });

    const plain = tickOf(bare, { hp: 100, maxHp: 100, inCombat: true });
    const resisted = tickOf(warded, { hp: 100, maxHp: 100, inCombat: true, resists: { ...NO_RESIST, poison: 0.5 } });
    expect(resisted.damage).toBeCloseTo(plain.damage * 0.5);
  });

  it.todo('a condition can kill outside of combat (port 6: the knockout, `recovering`)');
});

describe('a pierced dot is partly unresistable', () => {
  // Nothing but Anupama's hunger carries `pierce`, so these borrow poison's
  // dot and put it back.
  function bite(share: number | undefined, res: number): number {
    const dot = STATUSES.poison.dot!;
    const original = dot.pierce;
    if (share === undefined) delete dot.pierce;
    else dot.pierce = share;
    try {
      const g = fresh();
      apply(g, PLAYER, { id: 'poison', intensity: 4 });
      return tickOf(g, { hp: 100, maxHp: 100, inCombat: true, resists: { ...NO_RESIST, poison: res } }).damage;
    } finally {
      if (original === undefined) delete dot.pierce;
      else dot.pierce = original;
    }
  }

  it('is absent by default, and unset behaves exactly as zero', () => {
    expect(STATUSES.poison.dot!.pierce).toBeUndefined();
    expect(bite(undefined, 0.5)).toBeCloseTo(bite(0, 0.5));
  });

  it('resists only the share that was not pierced', () => {
    expect(bite(0.5, 0.5)).toBeCloseTo(bite(0, 0) * 0.75);
  });

  it('still lands against immunity, and against more than immunity', () => {
    const unresisted = bite(0, 0);
    expect(bite(0.5, 1)).toBeCloseTo(unresisted * 0.5);
    // The floor belongs to the resisted half alone.
    expect(bite(0.5, 5)).toBeCloseTo(unresisted * 0.5);
  });

  it('a fully pierced dot ignores resistance altogether', () => {
    expect(bite(1, 0.9)).toBeCloseTo(bite(0, 0));
  });

  it('clamps a mis-authored share instead of inverting the tick', () => {
    const unresisted = bite(0, 0);
    expect(bite(-1, 0.5)).toBeCloseTo(bite(0, 0.5));
    expect(bite(2, 0.5)).toBeCloseTo(unresisted);
  });
});

describe('Anupama: the fast', () => {
  it('hunger declares no cap, where every other stacking condition does', () => {
    const g = fresh();
    for (let i = 0; i < 30; i++) apply(g, PLAYER, { id: 'hunger_anupama', intensity: 0.3 });
    expect(find(g, 'hunger_anupama')!.intensity).toBeCloseTo(9);
    expect(STATUSES.hunger_anupama.stacking.cap).toBeUndefined();
  });

  it('counts applications and magnitude separately', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'hunger_anupama', intensity: 0.2 });
    apply(g, PLAYER, { id: 'hunger_anupama', intensity: 0.6 });
    const held = find(g, 'hunger_anupama')!;
    expect(held.intensity).toBeCloseTo(0.8);
    expect(held.stacks).toBe(2);
  });

  it('bites through dark immunity for exactly half', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'hunger_anupama', intensity: 4 });
    const ctx = { hp: 100, maxHp: 100, inCombat: true };
    const open = tickOf(g, { ...ctx, resists: { ...NO_RESIST, dark: 0 } }).damage;
    const immune = tickOf(g, { ...ctx, resists: { ...NO_RESIST, dark: 1 } }).damage;
    expect(open).toBeGreaterThan(0);
    expect(immune).toBeCloseTo(open * 0.5);
  });

  it('the weight lifts when the bar fills, not only when its clock runs out', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'weight_of_hunger', intensity: 0.5 });
    expect(has(g, 'weight_of_hunger')).toBe(true);
    fire(g, 'barFill');
    expect(has(g, 'weight_of_hunger')).toBe(false);
  });

  // Ported in tests/combatStatuses.test.ts (spine port 4): a monster wears what it IS from the moment it spawns

  it('fasting refuses the plain blow without touching what is deliberate', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'fasting', intensity: 1 });
    expect(statusBlocks(list(g), 'swing')).toBe(true);
    expect(statusBlocks(list(g), 'attack')).toBe(false);
    expect(statusBlocks(list(g), 'spell')).toBe(false);
    // The gate reads the same on another entity.
    apply(g, 'rat', { id: 'fasting', intensity: 1 });
    expect(statusBlocks(list(g, 'rat'), 'swing')).toBe(true);
    expect(statusBlocks(list(g, 'rat'), 'spell')).toBe(false);
  });

  it('field hunger counts both sides, in stacks rather than magnitude', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'hunger_anupama', intensity: 0.2 });
    apply(g, PLAYER, { id: 'hunger_anupama', intensity: 5 });
    expect(fieldHunger([list(g)])).toBe(2);
    apply(g, 'foe', { id: 'hunger_anupama', intensity: 1 });
    expect(fieldHunger([list(g), list(g, 'foe')])).toBe(3);
  });

  it('a ward sheds a share of every wound', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'hunger_anupama', intensity: 4 });
    const ctx = { hp: 100, maxHp: 100, inCombat: true, resists: { ...NO_RESIST, dark: 0 } };
    const full = tickOf(g, ctx).damage;
    expect(tickOf(g, { ...ctx, ward: 0.5 }).damage).toBeCloseTo(full * 0.5);
  });

  it('a pierced tick is unresistable, but never unwardable', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'hunger_anupama', intensity: 4 });
    const ctx = { hp: 100, maxHp: 100, inCombat: true, resists: { ...NO_RESIST, dark: 1 } };
    const immune = tickOf(g, ctx).damage;
    expect(immune).toBeGreaterThan(0);
    expect(tickOf(g, { ...ctx, ward: 0.5 }).damage).toBeCloseTo(immune * 0.5);
  });

  it.todo('the defence arm hardens the body and dulls what conditions do to it (mutagens: `fasts`)');

  it('the slow is scaled by intensity, so the ability owns the ceiling', () => {
    const light = fresh();
    const heavy = fresh();
    apply(light, PLAYER, { id: 'weight_of_hunger', intensity: 0.2 });
    apply(heavy, PLAYER, { id: 'weight_of_hunger', intensity: HUNGER_SLOW_CEILING });
    expect(statOf(heavy, 'speed')).toBeLessThan(statOf(light, 'speed'));
    expect(statOf(heavy, 'speed')).toBeCloseTo(statOf(fresh(), 'speed') * (1 - HUNGER_SLOW_CEILING));
  });
});

describe('a burn rations what healing may undo', () => {
  it('caps healing at a share of what it has burned, and remembers what it allowed', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'blazing', intensity: 2 });
    const burned = tick(g, 3);
    expect(burned).toBeGreaterThan(0);

    setPool(g, 'hp', 1);
    // Half of what the blaze took is all that may come back.
    expect(healAllowance(list(g))).toBeCloseTo(burned * 0.5);
    emit(g, healPlayer, { amount: 999, kind: 'rest' });
    expect(hp(g) - 1).toBeCloseTo(burned * 0.5);
    // And it does not refill: the allowance is spent.
    expect(healAllowance(list(g))).toBeCloseTo(0);
  });
});

describe('conditions that seal off a pool', () => {
  it('a laceration cuts usable health without touching the true maximum', () => {
    const g = fresh();
    const full = trueMax(statBlockOf(g), 'hp');

    apply(g, PLAYER, { id: 'lacerated', intensity: 3 });
    expect(trueMax(statBlockOf(g), 'hp')).toBe(full); // the stat is untouched
    expect(usable(g, 'hp')).toBeCloseTo(full * (1 - 0.04 * 3));
    expect(statusCeiling(list(g), 'hp')).toBeLessThan(1);
  });

  it('rot eats what you spend, and the reserve floor does NOT shrink with it', () => {
    const g = fresh();
    const floorBefore = reserveFloor(statBlockOf(g), 'stamina');
    const fullBefore = usable(g, 'stamina');

    apply(g, PLAYER, { id: 'rotting', intensity: 1 });
    emit(g, drawPool, { id: 'stamina', amount: 4 });

    expect(usable(g, 'stamina')).toBeLessThan(fullBefore);
    // The floor is measured against the true max.
    expect(reserveFloor(statBlockOf(g), 'stamina')).toBeCloseTo(floorBefore);
  });

  it('what rot ate comes back slowly once it has passed', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'rotting', intensity: 1, duration: 2 });
    emit(g, drawPool, { id: 'stamina', amount: 4 });
    const debt = find(g, 'rotting')!.data!.debt;
    expect(debt).toBeGreaterThan(0);

    tick(g, 3); // the rot itself passes
    expect(has(g, 'rotting')).toBe(false);
    // The debt survives it, carried by the recovery that replaced it.
    expect(find(g, 'rot_recovery')!.data!.debt).toBeCloseTo(debt);
    expect(usable(g, 'stamina')).toBeLessThan(trueMax(statBlockOf(g), 'stamina'));

    tick(g, 5000); // and pays itself off in time
    expect(has(g, 'rot_recovery')).toBe(false);
    expect(usable(g, 'stamina')).toBeCloseTo(trueMax(statBlockOf(g), 'stamina'));
  });
});

describe('conditions that dull equipment', () => {
  it('a chill takes the edge off the weapon, and says so in the breakdown', () => {
    const g = fresh();
    setMods(g, RUSTY_SWORD); // the old `g.equip(1)`: the item source arrives in port 3
    const armed = statOf(g, 'damage');

    apply(g, PLAYER, { id: 'chilled', intensity: 0.5 });
    expect(statOf(g, 'damage')).toBeLessThan(armed);

    // It dulls what the weapon gave, not the arm swinging it.
    expect(statusDampingFor(list(g), { kind: 'item', slot: 'weapon' })).toBeCloseTo(0.75);
    expect(statusDampingFor(list(g), { kind: 'item', slot: 'chest' })).toBe(1);
    expect(statusDampingFor(list(g), { kind: 'training' })).toBe(1);
  });
});

describe('conditions on the other side of the fight', () => {
  it('a chilled monster slows down, and a lacerated one has less to give', () => {
    const g = fresh(7);
    const m = body(g, 'wolf');
    const before = statOf(g, 'speed', m);

    apply(g, m, { id: 'chilled', intensity: 0.5 });
    expect(statOf(g, 'speed', m)).toBeLessThan(before);
  });

  it('an affliction can finish a monster the player never lands a blow on', () => {
    const g = fresh(8);
    const m = body(g, 'wolf');
    apply(g, m, { id: 'on_fire', intensity: 50 });
    const burn = tickOf(g, { hp: 30, maxHp: 30, inCombat: true }, m);
    expect(burn.damage).toBeGreaterThan(0);
    expect(burn.hits[0].id).toBe('on_fire');
  });
});

// describe('afflictions in a real fight'):
// Ported in tests/combatStatuses.test.ts (spine port 4): fighting things that burn you leaves you burning

describe('conditions that stop you doing things', () => {
  it('a rattled head blocks spells and sends blows wide', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'concussed', intensity: 1 });
    expect(statusBlocks(list(g), 'spell')).toBe(true);
    expect(statusBlocks(list(g), 'attack')).toBe(false);
    expect(statusMissChance(list(g))).toBeCloseTo(0.12);
    apply(g, PLAYER, { id: 'concussed', intensity: 2 });
    expect(statusMissChance(list(g))).toBeLessThan(1);
  });

  it('a daze costs one action per instance and wears off as they are spent', () => {
    const g = fresh();
    for (let i = 0; i < 3; i++) apply(g, PLAYER, { id: 'dazed', intensity: 1 });
    expect(find(g, 'dazed')!.stacks).toBe(3);
    expect(statusBlocks(list(g), 'attack')).toBe(true);
    for (let i = 0; i < 3; i++) fire(g, 'barFill');
    expect(has(g, 'dazed')).toBe(false);
  });

  // The status half. `effectiveStyleId` and the untouched selection are left
  // to the styles port: here the forced style is read from the condition.
  it('being run through forces a plain stance and stops stamina coming back', () => {
    const g = fresh();
    expect(statusForcedStyle(list(g))).toBeUndefined();
    apply(g, PLAYER, { id: 'perforated', intensity: 1 });
    expect(statusForcedStyle(list(g))).toBe('balanced');

    setPool(g, 'stamina', 1);
    g.tick(5);
    expect(pool(g, 'stamina')).toBe(1);
  });

  it('a puncture makes effort dearer and keeps widening, up to a cap', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'punctured', intensity: 1 });
    expect(statusCostMult(list(g), 'stamina')).toBeCloseTo(1.25);

    // It widens as it is held: 0.04% of the pool per tick, up to 5%.
    tick(g, 50);
    const partway = statusCeiling(list(g), 'stamina');
    expect(partway).toBeLessThan(1);
    expect(partway).toBeGreaterThan(0.95);

    tick(g, 200);
    expect(has(g, 'punctured')).toBe(true);
    expect(statusCeiling(list(g), 'stamina')).toBeCloseTo(0.95);
    expect(usable(g, 'stamina')).toBeLessThan(trueMax(statBlockOf(g), 'stamina'));
  });
});

describe('conditions that ride the action bar', () => {
  const owed = (g: Kernel, when: 'onFill' | 'onDeplete', who: string = PLAYER) =>
    ask(g, statusBarDamage, { entity: who, when });

  it('a jolt discharges when the bar completes', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'jolted', intensity: 2 });
    const fill = owed(g, 'onFill');
    expect(fill).toHaveLength(1);
    expect(fill[0].amount).toBeCloseTo(2.4); // 1.2 flat, times intensity 2
    expect(fill[0].dropWeaponBelow).toBe(0.5);
    expect(owed(g, 'onDeplete')).toHaveLength(0);
  });

  it('a shock runs the bar backwards and goes off when it empties', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'shocked', intensity: 1 });
    expect(statusReversesBar(list(g))).toBe(true);
    expect(owed(g, 'onDeplete')[0].amount).toBeCloseTo(2.5);
    fire(g, 'barDeplete');
    expect(has(g, 'shocked')).toBe(false); // all at once
  });

  it('enough jolts stop being a jolt — the cap makes it certain', () => {
    const g = fresh();
    for (let i = 0; i < 6; i++) apply(g, PLAYER, { id: 'jolted', intensity: 1 });
    expect(has(g, 'shocked')).toBe(true);
  });

  it('but never certain before the cap — a shock cannot be scheduled', () => {
    const turnedOn: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const g = fresh(seed);
      for (let dose = 1; dose <= 6; dose++) {
        apply(g, PLAYER, { id: 'jolted', intensity: 1 });
        if (has(g, 'shocked')) {
          turnedOn.push(dose);
          break;
        }
      }
    }
    expect(turnedOn, 'every seed must shock by the cap').toHaveLength(40);
    expect(Math.min(...turnedOn), 'never at or below the threshold').toBeGreaterThan(2);
    expect(new Set(turnedOn).size, 'and not always the same dose').toBeGreaterThan(1);
  });

  it('the odds of a shock ride the charge, and the readout reads the same curve', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'jolted', intensity: 2 });
    // Sitting exactly on the threshold is still safe.
    expect(escalationChance(list(g), find(g, 'jolted')!)).toBe(0);
    edit(g, 'jolted', (held) => (held.intensity = 4));
    expect(escalationChance(list(g), find(g, 'jolted')!)).toBeCloseTo(0.5);
    edit(g, 'jolted', (held) => (held.intensity = 6));
    expect(escalationChance(list(g), find(g, 'jolted')!)).toBe(1);
  });

  it('a blow earths part of the charge instead of all of it', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'jolted', intensity: 4 });
    fire(g, 'damageTaken', { damageType: 'slashing', amount: 5 });
    expect(has(g, 'jolted')).toBe(true);
    expect(find(g, 'jolted')!.intensity).toBeCloseTo(2);
  });
});

describe("the action bar is not the player's alone", () => {
  it('what rides the bar is owed by a monster too', () => {
    const g = fresh(7);
    const e = body(g, 'wolf');
    apply(g, e, { id: 'jolted', intensity: 2 });
    expect(ask(g, statusBarDamage, { entity: e, when: 'onFill' })[0].amount).toBeCloseTo(2.4);
  });

  // Ported in tests/combatStatuses.test.ts (spine port 4): a shocked enemy runs its bar backwards instead of filling it
  // Ported in tests/combatStatuses.test.ts (spine port 4): and a shock finally has a way OFF an enemy short of the fight ending
});

describe('conditions that strike back', () => {
  it('stone bites when you swing and when you are struck', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'shardbound', intensity: 2 });
    expect(statusRetaliation(list(g), 'onAttack')[0].amount).toBeCloseTo(1.6);
    expect(statusRetaliation(list(g), 'onContact')[0].amount).toBeCloseTo(1.6);
  });

  it('a bloom cuts less itself but opens a fresh wound each time', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'shardbloom', intensity: 1 });
    const back = statusRetaliation(list(g), 'onAttack')[0];
    expect(back.amount).toBeCloseTo(0.4);
    expect(back.inflicts?.[0].id).toBe('shard_bleed');

    // And that bleed is a dead end: it never becomes a laceration.
    for (let i = 0; i < 10; i++) apply(g, PLAYER, { id: 'shard_bleed', intensity: 2 });
    expect(has(g, 'shard_bleed')).toBe(true);
    expect(has(g, 'lacerated')).toBe(false);
  });
});

describe('a bleed sums its volume but not its depth', () => {
  it('stacks add flat damage while the proportional part tracks the deepest cut', () => {
    const g = fresh();
    const ctx = { hp: 1000, maxHp: 1000, inCombat: true };

    apply(g, PLAYER, { id: 'bleeding', intensity: 1 });
    const one = tickOf(g, ctx).damage;

    apply(g, PLAYER, { id: 'bleeding', intensity: 1 });
    const two = tickOf(g, ctx).damage;
    const held = find(g, 'bleeding')!;
    expect(held.intensity).toBe(2); // volume adds
    expect(held.peak).toBe(1); // depth does not

    // Only the flat part doubled.
    expect(two).toBeCloseTo(one + 0.08);

    apply(g, PLAYER, { id: 'bleeding', intensity: 3 });
    expect(find(g, 'bleeding')!.peak).toBe(3);
  });
});

describe('monster resistances go through the same pipeline', () => {
  // The species' innate values and `monsterSlice` arrive with combat (port
  // 4). The innate value comes from the probe here.
  it('species innate is the base, and conditions modify it like the player', () => {
    const g = fresh(21);
    const golem = body(g, 'golem', { resSlashing: 0.5, resBludgeoning: 0.2 });
    expect(statOf(g, 'resSlashing', golem)).toBeCloseTo(0.5);

    // Frozen makes anything brittle, through the same modifier that works on the player.
    apply(g, golem, { id: 'frozen', intensity: 1 });
    expect(statOf(g, 'resBludgeoning', golem)).toBeCloseTo(0.2 - 0.5);
  });
});

describe('a drenching decides your resistances rather than nudging them', () => {
  it('wet trades fire for everything fire is not', () => {
    const g = fresh();
    const dry = { ...statBlockOf(g) };
    apply(g, PLAYER, { id: 'wet', intensity: 1 });
    const damp = statBlockOf(g);
    expect(damp.resHeat).toBeGreaterThan(dry.resHeat);
    expect(damp.resCold).toBeLessThan(dry.resCold);
    expect(damp.resLightning).toBeLessThan(dry.resLightning);
  });

  it('fire drives a drenching off one layer at a time, and nothing else does', () => {
    const g = fresh();
    for (let i = 0; i < 3; i++) apply(g, PLAYER, { id: 'wet', intensity: 1 });
    expect(find(g, 'wet')!.stacks).toBe(3);

    fire(g, 'damageTaken', { damageType: 'slashing' });
    expect(find(g, 'wet')!.stacks).toBe(3); // a sword does nothing

    fire(g, 'damageTaken', { damageType: 'heat' });
    expect(find(g, 'wet')!.stacks).toBe(2);
  });

  it('five layers is a soaking, which DICTATES the numbers', () => {
    const g = fresh();
    for (let i = 0; i < 5; i++) apply(g, PLAYER, { id: 'wet', intensity: 1 });
    expect(has(g, 'wet')).toBe(false);
    expect(has(g, 'soaked')).toBe(true);

    const stats = statBlockOf(g);
    expect(stats.resHeat).toBeCloseTo(0.75); // its 80% meets the resistance cap
    expect(stats.resCold).toBeCloseTo(-0.5);
    expect(stats.resLightning).toBeCloseTo(-0.5);
    expect(stats.resPoison).toBeCloseTo(-0.5);
  });

  it('a soaking sours venom, deepens cold, and shortens the road to a shock', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'poison', intensity: 3 });
    apply(g, PLAYER, { id: 'soaked', intensity: 1 });
    expect(has(g, 'poison')).toBe(false);
    expect(find(g, 'rotting')!.intensity).toBeCloseTo(2); // 3 x 2/3

    // Cold carries three times as far.
    apply(g, PLAYER, { id: 'chilled', intensity: 0.1 });
    expect(find(g, 'chilled')!.intensity).toBeCloseTo(0.3);

    // And a charge reaches a shock in three jolts instead of six.
    for (let i = 0; i < 3; i++) apply(g, PLAYER, { id: 'jolted', intensity: 1 });
    expect(has(g, 'shocked')).toBe(true);
  });

  it('a soaking takes three of what it conducts to drive off', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'soaked', intensity: 1 });
    for (let i = 0; i < 2; i++) fire(g, 'damageTaken', { damageType: 'heat' });
    expect(has(g, 'soaked')).toBe(true); // two is not enough
    fire(g, 'damageTaken', { damageType: 'heat' });
    expect(has(g, 'soaked')).toBe(false);
  });
});

describe('glare', () => {
  it('a second flash lasts longer rather than blinding harder', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'dazzled', intensity: 1 });
    const first = find(g, 'dazzled')!;
    const clock = first.ticksLeft!;
    const bite = first.intensity;

    apply(g, PLAYER, { id: 'dazzled', intensity: 1 });
    const after = find(g, 'dazzled')!;
    expect(after.intensity).toBe(bite); // no worse
    expect(after.ticksLeft).toBeGreaterThan(clock); // just longer
    expect(after.stacks).toBe(2);
  });

  it('four flashes blind you, and blindness makes you roll twice for the worse', () => {
    const g = fresh();
    for (let i = 0; i < 4; i++) apply(g, PLAYER, { id: 'dazzled', intensity: 1 });
    expect(has(g, 'dazzled')).toBe(false);
    expect(has(g, 'blinded')).toBe(true);
    expect(statusDisadvantage(list(g))).toBe(true);
    expect(statOf(g, 'dodge')).toBeLessThan(statOf(fresh(), 'dodge'));
  });
});

describe('taint', () => {
  it('lowers everything, and light and dark twice over', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'tainted', intensity: 1 });
    const stats = statBlockOf(g);
    expect(stats.resSlashing).toBeCloseTo(-0.05);
    expect(stats.resLight).toBeCloseTo(-0.1);
    expect(stats.resDark).toBeCloseTo(-0.1);
  });

  it('can only drag you so far, and each stack digs that floor deeper', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'tainted', intensity: 1 });

    // Set the bite past anything the floor allows. (Applying this much
    // through the front door would escalate it instead: the cap is 5.)
    edit(g, 'tainted', (held) => (held.intensity = 20));
    expect(statOf(g, 'resSlashing')).toBeCloseTo(-0.25);

    // A second stack lets it reach 5% further, without the penalty changing.
    edit(g, 'tainted', (held) => (held.stacks = 2));
    expect(statOf(g, 'resSlashing')).toBeCloseTo(-0.3);
  });

  it('loosens its grip as its clock runs down', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'tainted', intensity: 2 });
    const atFull = statOf(g, 'resSlashing');

    edit(g, 'tainted', (held) => (held.ticksLeft = Math.floor(held.ticksLeft! * 0.25))); // three quarters gone
    expect(statOf(g, 'resSlashing')).toBeGreaterThan(atFull); // less negative: it is fading
  });
});

describe('corruption', () => {
  it('closes off spirit, and takes a share of everything else with it', () => {
    const g = fresh();
    const wholeSpirit = usable(g, 'spirit');
    const wholeHp = usable(g, 'hp');

    apply(g, PLAYER, { id: 'corrupted', intensity: 4 });
    expect(statusCeiling(list(g), 'spirit')).toBeCloseTo(0.6);
    expect(usable(g, 'spirit')).toBeLessThan(wholeSpirit);
    expect(usable(g, 'hp')).toBeLessThan(wholeHp);
    expect(trueMax(statBlockOf(g), 'hp')).toBe(wholeHp);
  });

  // `recovering` is the world's (port 6). A test-only system stands in for
  // it: it hears `statuses/fatal` and states that the player is down.
  it('emptying your spirit takes you down and keeps half its hold', () => {
    const world = defineSystem<{ downs: number }>({
      id: 'world',
      version: 1,
      initial: () => ({ downs: 0 }),
      events: [
        on(conditionFatal, (ctx, event) => {
          ctx.state.downs++;
          ctx.emit(setSituation, { down: true });
          expect(event.payload.id).toBe('corrupted');
        }),
      ],
    });
    const g = track(makeKernel([probe, world], { seed: 31 }));
    // Ten points of corruption seals spirit away entirely.
    apply(g, PLAYER, { id: 'corrupted', intensity: 7 });
    edit(g, 'corrupted', (held) => (held.intensity = 10));

    g.tick(5);
    expect(slice<{ downs: number }>(g, 'world').downs).toBe(1);
    expect(slice<StatusesState>(g, 'statuses').down).toBe(true);
    // Half, rounded up, and it does not tick away on its own.
    const held = find(g, 'corrupted')!;
    expect(held.intensity).toBe(5);
    expect(held.ticksLeft).toBeNull();
  });
});

describe('manaburn', () => {
  /** A character with a mana pool worth burning, filled. */
  function mage(seed: number): { g: Kernel; pool: number } {
    const g = fresh(seed);
    patch(g, (s) => (s.attributes.attrs.int.level = 60));
    const size = trueMax(statBlockOf(g), 'mana');
    setPool(g, 'mana', size);
    return { g, pool: size };
  }

  it('drives mana into debt and detonates for the overdraft', () => {
    const { g, pool: size } = mage(41);
    // More burn than the pool and its debt limit can absorb.
    apply(g, PLAYER, { id: 'manaburn', intensity: size * 4 });

    let detonated = false;
    for (let i = 0; i < 4000 && !detonated; i++) {
      g.tick();
      if (!has(g, 'manaburn')) detonated = true;
      // While it burns, mana may sit below zero.
      expect(pool(g, 'mana')).toBeGreaterThanOrEqual(-size - 1);
    }
    expect(detonated).toBe(true);
  });

  it('a burn smaller than the pool gutters out instead of going off', () => {
    const { g } = mage(42);
    apply(g, PLAYER, { id: 'manaburn', intensity: 2 });
    for (let i = 0; i < 500 && has(g, 'manaburn'); i++) g.tick();
    expect(has(g, 'manaburn')).toBe(false);
    expect(pool(g, 'mana')).toBeGreaterThan(0);
  });

  it('each stack buys another quarter-pool of headroom', () => {
    const one = [{ id: 'manaburn', intensity: 10, peak: 10, stacks: 1, ticksLeft: null }];
    const three = [{ id: 'manaburn', intensity: 10, peak: 10, stacks: 3, ticksLeft: null }];
    expect(statusNegativeHeadroom(one, 'mana', 100)).toBeCloseTo(100);
    expect(statusNegativeHeadroom(three, 'mana', 100)).toBeCloseTo(150);
  });
});

describe('flat-footed', () => {
  // The old cases registered a title and an item. Titles and items are not
  // ported; the same modifiers come from the probe with the same origins.

  it('leaves innate defences alone', () => {
    const g = fresh(1);
    setMods(g, [statMod('dodge', 'add', 0.1, 'Probe', { kind: 'title' })]);
    const before = statOf(g, 'dodge');
    apply(g, PLAYER, { id: 'flat_footed', intensity: 1 });
    expect(statOf(g, 'dodge')).toBeCloseTo(before, 10);
  });

  it('strips a worn defence, and only on the stats it names', () => {
    const g = fresh(2);
    setMods(g, [
      statMod('dodge', 'add', 0.2, 'Probe Cloak', { kind: 'item', slot: 'back' }),
      statMod('damage', 'add', 5, 'Probe Cloak', { kind: 'item', slot: 'back' }),
    ]);
    const before = { ...statBlockOf(g) };
    apply(g, PLAYER, { id: 'flat_footed', intensity: 1 });
    const after = statBlockOf(g);

    expect(after.dodge).toBeLessThan(before.dodge); // the worn dodge is gone
    expect(after.damage).toBeCloseTo(before.damage, 10); // the sword arm is not
  });

  it('an undampened bonus keeps working — the uncanny-dodge hatch', () => {
    const g = fresh(3);
    setMods(g, [{ ...statMod('dodge', 'add', 0.2, 'Probe Charm', { kind: 'item', slot: 'accessory' }), undampened: true } as Modifier]);
    const before = statOf(g, 'dodge');
    apply(g, PLAYER, { id: 'flat_footed', intensity: 1 });
    expect(statOf(g, 'dodge')).toBeCloseTo(before, 10);
  });
});

describe('the end of a fight lets go of what only a fight could shed', () => {
  // Ported in tests/combatStatuses.test.ts (spine port 4): being knocked out sheds conditions the action bar was the only cure for
  // Ported in tests/combatStatuses.test.ts (spine port 4): winning does the same — a daze you never worked off does not follow you out

  // The status half: the hook combat will send when a fight ends.
  it('the end of a fight removes what names `combatEnd`', () => {
    const g = fresh(13);
    for (let i = 0; i < 8; i++) apply(g, PLAYER, { id: 'dazed', intensity: 1 });
    apply(g, PLAYER, { id: 'shocked', intensity: 1 });
    fire(g, 'combatEnd');
    expect(has(g, 'dazed')).toBe(false);
    expect(has(g, 'shocked')).toBe(false);
  });
});

describe('a knockout is a floor, not a step you can fall through twice', () => {
  it.todo('a rot that outlives the fight cannot knock you out while you are down (port 6: the knockout)');
  // Ported in tests/combatStatuses.test.ts (spine port 4): it does not overwrite the summary of the fight that actually felled you
  it.todo('you still come round once the rot has run its course (port 6: the knockout)');
});

describe('being out cold is time passing', () => {
  it('clocks run at the rate the caller asks for', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'rotting', intensity: 1 });
    const full = find(g, 'rotting')!.ticksLeft!;

    const ctx = { hp: 100, maxHp: 100, inCombat: false };
    tickOf(g, ctx);
    expect(find(g, 'rotting')!.ticksLeft).toBe(full - 1);

    tickOf(g, { ...ctx, clockRate: 5 });
    expect(find(g, 'rotting')!.ticksLeft).toBe(full - 6);
  });

  // The status half of the two cases below: the system's own tick runs the
  // player's clocks five times as fast while the player is down.
  it('the clocks of a downed player run five times as fast', () => {
    const g = fresh(3);
    apply(g, PLAYER, { id: 'rotting', intensity: 1 });
    const full = find(g, 'rotting')!.ticksLeft!;
    g.tick();
    expect(find(g, 'rotting')!.ticksLeft).toBe(full - 1);
    emit(g, setSituation, { down: true });
    g.tick();
    expect(find(g, 'rotting')!.ticksLeft).toBe(full - 6);
  });

  it.todo('a rot does not pick up where it left off once you are back on your feet (port 6: the knockout)');
  it.todo('and the floor is not a long stay — a heavy rot burns out in a fraction of its clock (port 6: the knockout)');
});

// ---------- Wind: displacement ----------

describe('displacement — the wind takes your footing', () => {
  const displaced = (g: Kernel) =>
    run(g, (ctx) => statusDisplacedExit((p) => ctx.rng.chance(p), heldOf(ctx.read(statuses))));

  it('unfooted steals every exit; buffeted only sometimes', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'unfooted', intensity: 1 });
    for (let i = 0; i < 20; i++) expect(displaced(g)).toBe('off_balance');
    ask(g, removeStatus, { entity: PLAYER, id: 'unfooted' });

    // One point of buffeting is a 12% chance, so most exits survive it.
    apply(g, PLAYER, { id: 'buffeted', intensity: 1 });
    let taken = 0;
    for (let i = 0; i < 200; i++) if (displaced(g)) taken += 1;
    expect(taken).toBeGreaterThan(0);
    expect(taken).toBeLessThan(100);
  });

  it('says nothing when the air is still — the technique keeps its own exit', () => {
    expect(displaced(fresh())).toBeUndefined();
  });

  it('only ever displaces toward a dead end — the prime directive guardrail', () => {
    for (const def of Object.values(STATUSES)) {
      if (!def.displaces) continue;
      expect(def.displaces.to).toBe('off_balance');
    }
  });

  it('buffeting escalates into being unfooted', () => {
    const g = fresh();
    // The cap is checked when a second dose lands, so the first application
    // never escalates however heavy it is.
    apply(g, PLAYER, { id: 'buffeted', intensity: 4 });
    expect(has(g, 'unfooted')).toBe(false);
    apply(g, PLAYER, { id: 'buffeted', intensity: 1 });
    expect(has(g, 'unfooted')).toBe(true);
    expect(has(g, 'buffeted')).toBe(false);
  });
});

// ---------- Wood: the seed ----------

describe('the seed — a condition that grows while it is ignored', () => {
  const tend = (g: Kernel, type: DamageType) => ask(g, tendOnDamage, { entity: PLAYER, type });
  const spread = (g: Kernel) => ask(g, dueGraftSpread, { entity: PLAYER });

  it('thickens on its own in a fight, and does not out of one', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'seeded', intensity: 1 });
    const start = find(g, 'seeded')!.intensity;
    tick(g, 10, false);
    expect(find(g, 'seeded')!.intensity).toBeCloseTo(start, 5);
    tick(g, 10, true);
    expect(find(g, 'seeded')!.intensity).toBeGreaterThan(start);
  });

  it('matures into a root network if nobody sees to it', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'seeded', intensity: 1 });
    tick(g, 400);
    expect(has(g, 'rootbound')).toBe(true);
  });

  it('is pruned by a blow, and cut twice as hard by metal', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'seeded', intensity: 4 });
    tend(g, 'bludgeoning');
    expect(find(g, 'seeded')!.intensity).toBeCloseTo(3.5, 5);
    tend(g, 'piercing');
    expect(find(g, 'seeded')!.intensity).toBeCloseTo(2.5, 5);
  });

  it('is FED by water rather than pruned — the generative arrow, in combat', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'seeded', intensity: 2 });
    tend(g, 'water');
    expect(find(g, 'seeded')!.intensity).toBeCloseTo(3, 5);
  });

  it('records what else lands in the body, and carries the ledger when it matures', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'seeded', intensity: 1 });
    apply(g, PLAYER, { id: 'chilled', intensity: 2 });
    apply(g, PLAYER, { id: 'jolted', intensity: 1 });
    expect(graftLedger(find(g, 'seeded')!)).toEqual(
      expect.arrayContaining([
        { id: 'chilled', intensity: 2 },
        { id: 'jolted', intensity: 1 },
      ]),
    );

    tick(g, 400);
    const grown = find(g, 'rootbound');
    expect(grown).toBeTruthy();
    // Maturing keeps the ledger.
    expect(graftLedger(grown!)).toEqual(expect.arrayContaining([{ id: 'chilled', intensity: 2 }]));
  });

  it('never records its own family', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'seeded', intensity: 1 });
    apply(g, PLAYER, { id: 'seeded', intensity: 1 });
    expect(graftLedger(find(g, 'seeded')!)).toEqual([]);
  });

  it('pays out when fire takes it — wood feeding fire, at the combat layer', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'seeded', intensity: 1 });
    apply(g, PLAYER, { id: 'chilled', intensity: 3 });
    const [payout] = graftHarvest(list(g), 'heat');
    expect(payout.type).toBe('heat');
    expect(payout.amount).toBeCloseTo(12, 5); // 3 recorded x 4 per point

    // Nothing else harvests it.
    expect(graftHarvest(list(g), 'cold')).toEqual([]);
  });

  it('an empty ledger pays nothing', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'seeded', intensity: 3 });
    expect(graftHarvest(list(g), 'heat')).toEqual([]);
  });

  it('only the matured form spreads, and only on its own schedule', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'seeded', intensity: 1 });
    apply(g, PLAYER, { id: 'chilled', intensity: 4 });
    // A seed records but does not propagate.
    expect(spread(g)).toBeNull();

    ask(g, removeStatus, { entity: PLAYER, id: 'seeded' });
    expect(apply(g, PLAYER, { id: 'rootbound', intensity: 1 })).not.toBeNull();
    edit(g, 'rootbound', (root) => (root.data = { 'graft:chilled': 4 }));

    expect(spread(g)).toEqual([{ id: 'chilled', intensity: 1 }]); // a quarter of it
    expect(spread(g)).toBeNull(); // not due again yet
  });
});

describe('removal that answers to how HARD, not how often', () => {
  /** A bearer holding one condition with a magnitude-gated removal rule. */
  function bearing(afterDamage: number): Kernel {
    const g = fresh(11);
    apply(g, PLAYER, {
      id: 'chilled',
      intensity: 4,
      removal: [{ on: 'damageTaken', damageTypes: ['heat'], afterDamage, effect: 'remove' }],
    });
    return g;
  }

  it('holds until enough has landed, then gives way', () => {
    const g = bearing(50);
    for (let i = 0; i < 4; i++) fire(g, 'damageTaken', { damageType: 'heat', amount: 10 });
    expect(has(g, 'chilled')).toBe(true);
    fire(g, 'damageTaken', { damageType: 'heat', amount: 10 });
    expect(has(g, 'chilled')).toBe(false);
  });

  it('takes one hard blow as readily as many soft ones', () => {
    const g = bearing(50);
    fire(g, 'damageTaken', { damageType: 'heat', amount: 500 });
    expect(has(g, 'chilled')).toBe(false);
  });

  it('still respects the type gate while accumulating', () => {
    const g = bearing(50);
    fire(g, 'damageTaken', { damageType: 'cold', amount: 999 });
    expect(has(g, 'chilled')).toBe(true);
  });
});

// describe('a monster hears the type it was actually hit with'):
// Ported in tests/combatStatuses.test.ts (spine port 4): never reports a slice key as a damage type

describe('conditions are resisted on APPLICATION, not only on their damage', () => {
  it('an ice slime does not freeze from the chill that freezes anything else', () => {
    // `chilled` sums to a cap of 1 and escalates there. Two doses of 0.6 freeze
    // an ordinary body; cold 0.5 halves each of them.
    const chill = (block: Record<string, number>) => {
      const g = fresh(31);
      const m = body(g, 'm', block);
      apply(g, m, { id: 'chilled', intensity: 0.6 });
      apply(g, m, { id: 'chilled', intensity: 0.6 });
      return { g, m };
    };
    const goblin = chill({});
    expect(has(goblin.g, 'frozen', goblin.m)).toBe(true);

    const ice = chill({ resCold: 0.5 });
    expect(has(ice.g, 'frozen', ice.m)).toBe(false);
    expect(find(ice.g, 'chilled', ice.m)!.intensity).toBeCloseTo(0.6);
  });

  it('vulnerability deepens the dose by the same arithmetic', () => {
    const g = fresh(32);
    const fireSlime = body(g, 'fire', { resCold: -0.5 });
    apply(g, fireSlime, { id: 'chilled', intensity: 0.4 });
    expect(find(g, 'chilled', fireSlime)!.intensity).toBeCloseTo(0.6);

    const goblin = body(g, 'goblin');
    apply(g, goblin, { id: 'chilled', intensity: 0.4 });
    expect(find(g, 'chilled', goblin)!.intensity).toBeCloseTo(0.4);
  });

  it('resistance buys the consequences, never the immunity', () => {
    const g = fresh(33);
    const stone = body(g, 'stone', { resSlashing: 0.9 });
    apply(g, stone, { id: 'bleeding', intensity: 1 }, 'a very sharp thing');
    const held = find(g, 'bleeding', stone)!;
    expect(held.intensity).toBeCloseTo(APPLICATION_FLOOR);
    expect(held.intensity).toBeGreaterThan(0);
  });

  it('a condition with no element is never resisted — that is every buff', () => {
    const g = fresh(34);
    expect(STATUSES.steady_hand?.element).toBeUndefined();
    apply(g, PLAYER, { id: 'steady_hand', intensity: 1 }, 'test', { resSlashing: 0.9, resCold: 0.9 });
    expect(find(g, 'steady_hand')!.intensity).toBeCloseTo(1);
  });

  it("the player's block is honoured, and only ever for the player", () => {
    const g = fresh(35);
    apply(g, PLAYER, { id: 'bleeding', intensity: 1 }, 'a claw', { resSlashing: 0.6 });
    expect(find(g, 'bleeding')!.intensity).toBeCloseTo(0.4);

    // Another entity answers with its own resistances, whatever the caller marks.
    const goblin = body(g, 'goblin');
    apply(g, goblin, { id: 'bleeding', intensity: 1 }, 'a claw', true);
    expect(find(g, 'bleeding', goblin)!.intensity).toBeCloseTo(1);
    const stone = body(g, 'stone', { resSlashing: 0.6 });
    apply(g, stone, { id: 'bleeding', intensity: 1 }, 'a claw');
    expect(find(g, 'bleeding', stone)!.intensity).toBeCloseTo(0.4);
  });

  it('a transformation is not billed a second time', () => {
    const g = fresh(36);
    const ice = body(g, 'ice', { resCold: 0.5 });
    apply(g, ice, { id: 'chilled', intensity: 1.6 });
    // 1.6 halved is 0.8: under the cap, so still a chill.
    expect(find(g, 'chilled', ice)!.intensity).toBeCloseTo(0.8);
    // Another of the same tips it over, and `frozen` inherits the full depth.
    apply(g, ice, { id: 'chilled', intensity: 1.6 });
    expect(has(g, 'frozen', ice)).toBe(true);
    expect(find(g, 'frozen', ice)!.intensity).toBeCloseTo(1.6);
  });

  it('raises applications-to-escalation where escalation is measured in depth', () => {
    const doses = (block: Record<string, number>) => {
      const g = fresh(37);
      const m = body(g, 'm', block);
      let n = 0;
      while (!has(g, 'perforated', m) && n < 40) {
        apply(g, m, { id: 'punctured', intensity: 0.5 });
        n++;
      }
      return n;
    };
    expect(doses({ resPiercing: 0.6 })).toBeGreaterThan(doses({}));
  });

  it('leaves count-measured conditions counting, which is what they are for', () => {
    const cuts = (block: Record<string, number>) => {
      const g = fresh(38);
      const m = body(g, 'm', block);
      let n = 0;
      while (!has(g, 'lacerated', m) && n < 40) {
        apply(g, m, { id: 'bleeding', intensity: 1 });
        n++;
      }
      return n;
    };
    expect(cuts({ resSlashing: 0.6 })).toBe(cuts({}));
    expect(STATUSES.bleeding?.stacking.mode).toBe('count');
  });
});

describe('immunity: resistance of 1, or a status that grants it', () => {
  /** Run `body` with extra conditions registered, then remove them. */
  function withStatuses(extra: Record<string, StatusDef>, run: () => void) {
    Object.assign(STATUSES, extra);
    try {
      run();
      // Checked while the extra records still exist: a held one is read by the source.
      allSound();
    } finally {
      games.length = 0;
      for (const id of Object.keys(extra)) delete STATUSES[id];
    }
  }

  const ironblood: StatusDef = {
    id: 'test_ironblood',
    name: 'Ironblood',
    icon: '🩸',
    desc: 'Test-only: +100% poison resistance.',
    stacking: { mode: 'highest' },
    removal: [{ on: 'combatEnd', effect: 'remove' }],
    mods: [{ stat: 'resPoison', op: 'add', value: 1 }],
  };
  const ward: StatusDef = {
    id: 'test_ward',
    name: 'Warded',
    icon: '🛡️',
    desc: 'Test-only: immune to poison conditions and to bleeding.',
    stacking: { mode: 'highest' },
    removal: [{ on: 'combatEnd', effect: 'remove' }],
    immune: { elements: ['poison'], ids: ['bleeding'] },
  };

  it('a player at resistance 1 is not poisoned; at 0.99 the dose lands at the floor', () => {
    const g = fresh(40);
    expect(apply(g, PLAYER, { id: 'poison', intensity: 1 }, 'a fang', { resPoison: 1 })).toBeNull();
    expect(has(g, 'poison')).toBe(false);
    const landed = apply(g, PLAYER, { id: 'poison', intensity: 1 }, 'a fang', { resPoison: 0.99 });
    expect(landed!.intensity).toBeCloseTo(APPLICATION_FLOOR);
  });

  it('only the condition’s own element is stopped, and only by an afflicting dose', () => {
    const g = fresh(41);
    const block = { resPoison: 1.5 };
    expect(apply(g, PLAYER, { id: 'bleeding', intensity: 1 }, 'a claw', block)).not.toBeNull();
    // A buff has no element, so no resistance reaches it however high.
    expect(STATUSES.steady_hand?.element).toBeUndefined();
    expect(apply(g, PLAYER, { id: 'steady_hand', intensity: 1 }, 'a meal', block)).not.toBeNull();
    // A dose not marked as done to the player reads no resistance.
    expect(apply(g, PLAYER, { id: 'poison', intensity: 1 }, 'a fang')).not.toBeNull();
  });

  it('the applier’s penetration comes off the resistance before the test', () => {
    const poison = (res: number, pen?: number) =>
      apply(fresh(42), PLAYER, { id: 'poison', intensity: 1 }, 'a fang', { resPoison: res }, pen);
    expect(poison(1)).toBeNull();
    expect(poison(1, 0)).toBeNull();
    expect(poison(1, 0.2)!.intensity).toBeCloseTo(APPLICATION_FLOOR);
    // Resistance past 1 needs more to get through: 1.5 - 0.4 is still 1.1.
    expect(poison(1.5, 0.4)).toBeNull();
    expect(poison(1.5, 0.6)).not.toBeNull();
  });

  it('penetration only opens the door: below 1 the dose is the dose it always was', () => {
    const lands = (pen: number) =>
      apply(fresh(43), PLAYER, { id: 'bleeding', intensity: 1 }, 'a claw', { resSlashing: 0.5 }, pen)!.intensity;
    expect(lands(0)).toBeCloseTo(0.5);
    expect(lands(0.4)).toBeCloseTo(0.5);
  });

  // The old case ended with "a copy of the block loses the record". The value
  // before the cap is a stat of the table here; there is no copy to lose it.
  it('reads the player’s resistance before the cap that holds the stat under 1', () => {
    withStatuses({ test_ironblood: ironblood }, () => {
      const g = fresh(44);
      apply(g, PLAYER, { id: 'test_ironblood', intensity: 1 }, 'test');
      // The damage cap holds the stat at 0.75...
      expect(statOf(g, 'resPoison')).toBeCloseTo(0.75);
      // ...but the condition test saw the 1.0 under it.
      expect(apply(g, PLAYER, { id: 'poison', intensity: 1 }, 'a fang', true)).toBeNull();
      expect(apply(g, PLAYER, { id: 'poison', intensity: 1 }, 'a fang', true, 0.2)).not.toBeNull();
    });
  });

  it('a monster at resistance 1 is immune; at 0.9 it is only slowed', () => {
    const g = fresh(45);
    const knight = body(g, 'knight', { resPoison: 1 });
    expect(apply(g, knight, { id: 'poison', intensity: 1 }, 'a fang')).toBeNull();
    expect(has(g, 'poison', knight)).toBe(false);
    // Its other elements still answer by the old arithmetic.
    expect(apply(g, knight, { id: 'bleeding', intensity: 1 }, 'a blade')!.intensity).toBeCloseTo(1);

    // The player's penetration reaches a monster's condition immunity too.
    const pen = apply(g, knight, { id: 'poison', intensity: 1 }, 'a fang', undefined, 0.2);
    expect(pen!.intensity).toBeCloseTo(APPLICATION_FLOOR);

    // Slashing at 0.9, one short: the floor, not a wall.
    const metal = body(g, 'metal', { resSlashing: 0.9 });
    expect(apply(g, metal, { id: 'bleeding', intensity: 1 }, 'a blade')!.intensity).toBeCloseTo(APPLICATION_FLOOR);
  });

  // Ported in tests/combatStatuses.test.ts (spine port 4): every species that declares resistance 1 or more is immune to that element’s conditions
  // Ported in tests/combatStatuses.test.ts (spine port 4): a species whose TAGS give it resistance 1 is immune with nothing declared

  it('a condition that dictates the resistance can take a declared 1 away', () => {
    const g = fresh(53);
    const knight = body(g, 'knight', { resPoison: 1 });
    expect(apply(g, knight, { id: 'poison', intensity: 1 }, 'a fang')).toBeNull();
    apply(g, knight, { id: 'soaked', intensity: 1 }, 'a bucket');
    expect(has(g, 'soaked', knight)).toBe(true);
    expect(statOf(g, 'resPoison', knight)).toBeCloseTo(-0.5);
    // And the dose lands deeper than a plain one.
    expect(apply(g, knight, { id: 'poison', intensity: 1 }, 'a fang')!.intensity).toBeGreaterThan(1);
  });

  it('elemental resistance counts toward the line for the elemental types only', () => {
    const poison = (stats: Record<string, number>) =>
      apply(fresh(54), PLAYER, { id: 'poison', intensity: 1 }, 'a fang', stats);
    expect(poison({ resPoison: 0.95, resElemental: 0.05 })).toBeNull();
    expect(poison({ resPoison: 0.95, resElemental: 0.04 })).not.toBeNull();
    // Slashing is not elemental: the bonus never reaches a bleed.
    expect(ELEMENTAL_TYPES.has('slashing')).toBe(false);
    const bleed = apply(fresh(54), PLAYER, { id: 'bleeding', intensity: 1 }, 'a claw', {
      resSlashing: 0.95,
      resElemental: 0.05,
    });
    expect(bleed!.intensity).toBeCloseTo(APPLICATION_FLOOR);
  });

  it('the player’s elemental resistance is read through the real stat pipeline', () => {
    const warding: StatusDef = {
      id: 'test_warding',
      name: 'Warding',
      icon: '🛡️',
      desc: 'Test-only: +90% poison resistance and +10% elemental resistance.',
      stacking: { mode: 'highest' },
      removal: [{ on: 'combatEnd', effect: 'remove' }],
      mods: [
        { stat: 'resPoison', op: 'add', value: 0.9 },
        { stat: 'resElemental', op: 'add', value: 0.1 },
      ],
    };
    withStatuses({ test_warding: warding }, () => {
      const g = fresh(55);
      apply(g, PLAYER, { id: 'test_warding', intensity: 1 }, 'test');
      expect(statOf(g, 'resPoison')).toBeCloseTo(0.75); // capped
      expect(apply(g, PLAYER, { id: 'poison', intensity: 1 }, 'a fang', true)).toBeNull();
      // Not a poison, not an element: still lands.
      expect(apply(g, PLAYER, { id: 'bleeding', intensity: 1 }, 'a claw', true)).not.toBeNull();
    });
  });

  it('a monster’s elemental resistance counts toward the line too', () => {
    const plus5: StatusDef = {
      id: 'test_hardened',
      name: 'Hardened',
      icon: '🛡️',
      desc: 'Test-only: +5% elemental resistance.',
      stacking: { mode: 'highest' },
      removal: [{ on: 'combatEnd', effect: 'remove' }],
      mods: [{ stat: 'resElemental', op: 'add', value: 0.05 }],
    };
    withStatuses({ test_hardened: plus5 }, () => {
      const g = fresh(56);
      const m = body(g, 'bog', { resPoison: 0.95, resSlashing: 0.95 });
      expect(apply(g, m, { id: 'poison', intensity: 1 }, 'a fang')!.intensity).toBeCloseTo(APPLICATION_FLOOR);
      ask(g, removeStatus, { entity: m, id: 'poison' });
      apply(g, m, { id: 'test_hardened', intensity: 1 }, 'test');
      expect(apply(g, m, { id: 'poison', intensity: 1 }, 'a fang')).toBeNull();
      // The physical type has no elemental share.
      expect(apply(g, m, { id: 'bleeding', intensity: 1 }, 'a claw')).not.toBeNull();
    });
  });

  it('a condition that grants resistance 1 makes its bearer immune, monster or player', () => {
    withStatuses({ test_ironblood: ironblood }, () => {
      const g = fresh(47);
      const wolf = body(g, 'wolf');
      expect(apply(g, wolf, { id: 'poison', intensity: 1 }, 'a fang')).not.toBeNull();
      ask(g, removeStatus, { entity: wolf, id: 'poison' });
      apply(g, wolf, { id: 'test_ironblood', intensity: 1 }, 'test');
      expect(apply(g, wolf, { id: 'poison', intensity: 1 }, 'a fang')).toBeNull();
    });
  });

  it('`immune` refuses the elements and ids it names, and nothing else', () => {
    withStatuses({ test_ward: ward }, () => {
      const g = fresh(48);
      apply(g, PLAYER, { id: 'test_ward', intensity: 1 }, 'test');
      expect(apply(g, PLAYER, { id: 'poison', intensity: 1 }, 'a fang')).toBeNull(); // element
      expect(apply(g, PLAYER, { id: 'rotting', intensity: 1 }, 'a fang')).toBeNull(); // element
      expect(apply(g, PLAYER, { id: 'bleeding', intensity: 1 }, 'a claw')).toBeNull(); // id
      expect(apply(g, PLAYER, { id: 'on_fire', intensity: 1 }, 'a torch')).not.toBeNull();
      expect(apply(g, PLAYER, { id: 'steady_hand', intensity: 1 }, 'a meal')).not.toBeNull();
    });
  });

  it('`immune` blocks applications only: a condition already held stays', () => {
    withStatuses({ test_ward: ward }, () => {
      const g = fresh(49);
      apply(g, PLAYER, { id: 'poison', intensity: 1 }, 'a fang');
      apply(g, PLAYER, { id: 'test_ward', intensity: 1 }, 'test');
      expect(has(g, 'poison')).toBe(true);
      // And a fresh dose of the same thing does not deepen it.
      apply(g, PLAYER, { id: 'poison', intensity: 3 }, 'a fang');
      expect(find(g, 'poison')!.intensity).toBeCloseTo(1);
    });
  });

  it('a monster can wear `immune`, and losing it ends the protection', () => {
    withStatuses({ test_ward: ward }, () => {
      const g = fresh(50);
      const goblin = body(g, 'goblin');
      apply(g, goblin, { id: 'test_ward', intensity: 1 }, 'test');
      expect(apply(g, goblin, { id: 'poison', intensity: 1 }, 'a fang')).toBeNull();
      expect(apply(g, goblin, { id: 'bleeding', intensity: 1 }, 'a blade')).toBeNull();
      ask(g, removeStatus, { entity: goblin, id: 'test_ward' });
      expect(apply(g, goblin, { id: 'poison', intensity: 1 }, 'a fang')).not.toBeNull();
    });
  });

  it('a transformation is refused by `immune` the way `blockedBy` refuses it', () => {
    withStatuses({ test_ward: { ...ward, immune: { ids: ['frozen'] } } }, () => {
      const g = fresh(51);
      apply(g, PLAYER, { id: 'test_ward', intensity: 1 }, 'test');
      apply(g, PLAYER, { id: 'chilled', intensity: 0.6 }, 'frost');
      apply(g, PLAYER, { id: 'chilled', intensity: 0.6 }, 'frost');
      expect(has(g, 'frozen')).toBe(false);
      expect(has(g, 'chilled')).toBe(false);
    });
  });
});

// ---------- Not in the old file: what the old callers did, as events ----------

describe('amplify (old `amplifyStatuses`, Redouble Venom)', () => {
  it('multiplies past the cap and winds the clock back up', () => {
    const g = fresh();
    apply(g, PLAYER, { id: 'poison', intensity: 3 });
    tick(g, 10);
    expect(ask(g, amplifyStatuses, { entity: PLAYER, ids: ['poison', 'rotting'], mult: 2 })).toBe(1);
    const held = find(g, 'poison')!;
    expect(held.intensity).toBe(6); // the cap of 4 is not consulted
    expect(held.ticksLeft).toBe(STATUSES.poison.duration);
  });
});

/** Events of one type, as the kernel delivered them. */
export function heard<P>(g: Kernel, type: string): P[] {
  const seen: P[] = [];
  g.onEvent((event: GameEvent) => {
    if (event.type === type) seen.push(event.payload as P);
  });
  return seen;
}

describe('the heal the pools report', () => {
  it('reaches the conditions also when the cap let nothing through', () => {
    const g = fresh();
    setPool(g, 'hp', 10);
    apply(g, PLAYER, { id: 'blazing', intensity: 1 });
    apply(g, PLAYER, { id: 'bleeding', intensity: 1 });
    const heals = heard<{ healed: number }>(g, playerHealed.type);
    // Nothing burned yet: the allowance is 0, the heal lands nothing.
    emit(g, healPlayer, { amount: 5, kind: 'rest' });
    expect(heals).toEqual([expect.objectContaining({ healed: 0 })]);
    // The treatment still happened: the bleed closed.
    expect(has(g, 'bleeding')).toBe(false);
  });
});
