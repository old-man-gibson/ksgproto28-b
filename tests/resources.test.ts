import { describe, expect, it } from 'vitest';
import { defineSystem, TPS, type GameEvent, type Kernel, type Modifier } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import type { LogState } from '../src/systems/log';
import resources, {
  attackUpkeep,
  availableMax,
  defeatPlayer,
  drainPool,
  drawPool,
  exerted,
  exerting,
  exertPool,
  EXHAUSTED_REGEN_MULT,
  EXHAUSTED_SPEED_PENALTY,
  healPlayer,
  hookStat,
  hpFraction,
  hurtPlayer,
  IN_COMBAT_REGEN_MULT,
  isAlive,
  LOCKS_SOURCE,
  playerDamaged,
  playerHealed,
  poolHooks,
  poolSpent,
  RECOVERY_MULT,
  regenResource,
  RESOURCES,
  rollExtraHits,
  setExerting,
  setPace,
  spendPool,
  STAMINA_RESERVE,
  trueMax,
  UPKEEP_SHARE,
  type Exertion,
  type ExertionSpec,
  type HealResult,
  type Pace,
  type Pools,
  type ResourceLock,
  type ResourcesState,
} from '../src/systems/resources';
import {
  contentMod,
  HP_REGEN_SHARE,
  STAMINA_EFF_FLOOR,
  statBlockOf,
  statMod,
  statOf,
  type AttributeId,
} from '../src/systems/stats';
import { emit, makeGame, makeKernel, patch, probe, setMods, slice } from './helpers';

/**
 * Port of the old tests/regen.test.ts and tests/stamina.test.ts.
 *
 * Changed: the call shape. What the activity, the fight and the conditions
 * did to the pools in the old tests arrives here the way the later ports
 * will send it: the pace request (`resources/set-pace`) for what the activity
 * does to regeneration, and the hook stats (`resources/ceiling.<id>`,
 * `resources/healAllowance`, ...) for what a condition does. The exertion
 * numbers of the styles are copied from the old `data/styles.data.ts`.
 *
 * Left behind, for the ports of the systems they need:
 * - which activity gives which pace, and `combatRegenMult` (world, combat):
 *   "a wound that seals off stamina does not read as permanent strain" and
 *   "is not dragged lower by being winded or exhausted";
 * - "carries what you were doing, so conditions can tell rest from idling":
 *   the condition's removal rule (statuses). The heal kind it reads is
 *   tested here;
 * - "exertion in a fight", "opting in" (combat, styles): Crush draining to
 *   the reserve in a hunt, Cleave's splash, Quick's momentum, upkeep per swing.
 */

const res = (kernel: Kernel) => slice<ResourcesState>(kernel, 'resources');
const lockOf = (kernel: Kernel): ResourceLock => res(kernel).locks.stamina ?? 'none';

function setup(change: {
  values?: Partial<ResourcesState['values']>;
  locks?: ResourcesState['locks'];
  exerting?: boolean;
  attrs?: Partial<Record<AttributeId, number>>;
}): Kernel {
  const kernel = makeGame();
  patch(kernel, (slices) => {
    const state = slices.resources as ResourcesState;
    Object.assign(state.values, change.values ?? {});
    if (change.locks) {
      state.locks = { ...change.locks };
      state.announced = { ...change.locks };
    }
    if (change.exerting !== undefined) state.exerting = change.exerting;
    for (const [id, level] of Object.entries(change.attrs ?? {}))
      (slices.attributes as AttributesState).attrs[id as AttributeId].level = level!;
  });
  return kernel;
}

/** A character wounded enough to have room to heal. */
const wounded = (hp = 5) => setup({ values: { hp } });

/** HP gained over `ticks` ticks. */
function healedOver(kernel: Kernel, ticks: number): number {
  const before = res(kernel).values.hp;
  kernel.tick(ticks);
  return res(kernel).values.hp - before;
}

/** What the vitality rune on a worn charm states in the old content: +0.4 HP regen. */
const VITALITY_CHARM: Modifier[] = [statMod('hpRegen', 'add', 0.4, 'Greater Rune of Vitality (Lucky Charm)', { kind: 'rune', slot: 'accessory' })];

const hook = (stat: string, kind: 'add' | 'mult', value: number): Modifier => ({ stat, kind, value });

describe('the hpRegen stat', () => {
  it('is a share of the pool it refills, plus a little constitution', () => {
    const kernel = makeGame();
    const stats = statBlockOf(kernel);
    expect(stats.hpRegen).toBeCloseTo(stats.maxHp * HP_REGEN_SHARE + 1 * 0.01, 3);
  });

  it('grows with constitution — the pool gets bigger and refills no slower for it', () => {
    const w = statBlockOf(makeGame());
    const h = statBlockOf(setup({ attrs: { con: 40 } }));
    expect(h.hpRegen).toBeGreaterThan(w.hpRegen);
    // Seconds to refill from empty: never worse than it was at a smaller size.
    expect(h.maxHp / h.hpRegen).toBeLessThanOrEqual(w.maxHp / w.hpRegen);
  });

  it('is reachable: a modifier on the stat adds to it', () => {
    const bare = makeGame();
    const charmed = makeGame();
    setMods(charmed, VITALITY_CHARM);
    expect(statOf(charmed, 'hpRegen')).toBeCloseTo(statOf(bare, 'hpRegen') + 0.4, 3);
  });
});

describe('the health trickle', () => {
  it('runs while you are simply standing about', () => {
    const kernel = wounded();
    const rate = statOf(kernel, 'hpRegen');
    expect(healedOver(kernel, TPS)).toBeCloseTo(rate * RECOVERY_MULT.none, 2);
  });

  it('runs while you explore — the baseline is not something you have to earn', () => {
    const kernel = wounded();
    emit(kernel, setPace, { hpMult: RECOVERY_MULT.explore });
    const rate = statOf(kernel, 'hpRegen');
    expect(healedOver(kernel, TPS)).toBeCloseTo(rate * RECOVERY_MULT.explore, 2);
  });

  it('resting is the same trickle, several times over', () => {
    const idle = wounded();
    const resting = wounded();
    emit(resting, setPace, { resting: true, hpMult: RECOVERY_MULT.rest, healKind: 'rest' });
    const idleGain = healedOver(idle, TPS);
    const restGain = healedOver(resting, TPS);
    expect(restGain / idleGain).toBeCloseTo(RECOVERY_MULT.rest / RECOVERY_MULT.none, 3);
  });

  it('a live fight halves it — straining slows mending, it does not stop it', () => {
    const kernel = wounded();
    emit(kernel, setPace, { hpMult: RECOVERY_MULT.hunt * IN_COMBAT_REGEN_MULT });
    const rate = statOf(kernel, 'hpRegen');
    expect(healedOver(kernel, TPS)).toBeCloseTo(rate * IN_COMBAT_REGEN_MULT, 2);
  });

  it('carries what you were doing, so an observer can tell rest from idling', () => {
    const kinds = (kernel: Kernel): string[] => {
      const seen: string[] = [];
      kernel.onEvent((event: GameEvent) => {
        if (event.type === playerHealed.type) seen.push((event.payload as HealResult).kind);
      });
      kernel.tick(3);
      return seen;
    };
    const resting = wounded();
    emit(resting, setPace, { resting: true, hpMult: RECOVERY_MULT.rest, healKind: 'rest' });
    expect(kinds(wounded())).toEqual(['idle', 'idle', 'idle']);
    expect(kinds(resting)).toEqual(['rest', 'rest', 'rest']);
  });

  it('comes in through heal, so a heal cap still rations what may be undone', () => {
    const kernel = wounded(5);
    // What a burn that dealt 20 and lets half be undone states: 10 allowed.
    // The statuses port lowers the allowance as healing lands; a fixed 0.4 a
    // tick here stands for a cap that is nearly spent.
    setMods(kernel, [hook(hookStat.healCapped, 'add', 1), hook(hookStat.healAllowance, 'add', 0.01)]);
    const seen: HealResult[] = [];
    kernel.onEvent((event: GameEvent) => {
      if (event.type === playerHealed.type) seen.push(event.payload as HealResult);
    });
    kernel.tick(10);
    expect(res(kernel).values.hp).toBeCloseTo(5 + 10 * 0.01, 6);
    expect(seen).toHaveLength(10);
    expect(seen[0].allowed).toBe(0.01);
    expect(seen[0].asked).toBeCloseTo(statOf(kernel, 'hpRegen') / TPS, 6);
    // A cap of 0 lets nothing through, and the heal is still reported.
    setMods(kernel, [hook(hookStat.healCapped, 'add', 1)]);
    const before = res(kernel).values.hp;
    kernel.tick(5);
    expect(res(kernel).values.hp).toBe(before);
    expect(seen).toHaveLength(15);
    expect(seen[14]).toMatchObject({ allowed: 0, healed: 0 });
  });

  it('picks up whatever raises the stat, and resting multiplies that too', () => {
    const bonus = 0.4;
    const charmed = wounded();
    setMods(charmed, VITALITY_CHARM);
    // The bonus is worth its face value while idling...
    const idleGain = healedOver(charmed, TPS) - healedOver(wounded(), TPS);
    expect(idleGain).toBeCloseTo(bonus * RECOVERY_MULT.none, 2);

    const plainRest = wounded();
    const charmedRest = wounded();
    setMods(charmedRest, VITALITY_CHARM);
    for (const kernel of [plainRest, charmedRest])
      emit(kernel, setPace, { resting: true, hpMult: RECOVERY_MULT.rest, healKind: 'rest' });
    // ...and RECOVERY_MULT.rest times that with your feet up.
    expect(healedOver(charmedRest, TPS) - healedOver(plainRest, TPS)).toBeCloseTo(bonus * RECOVERY_MULT.rest, 2);
  });

  it('stops while the pace is halted, and so does every other pool', () => {
    // The old loop did not tick pools while travelling.
    const kernel = setup({ values: { hp: 5, stamina: 0, mana: 0 }, attrs: { int: 20 } });
    emit(kernel, setPace, { halted: true });
    kernel.tick(50);
    expect(res(kernel).values).toMatchObject({ hp: 5, stamina: 0, mana: 0 });
    emit(kernel, setPace, { halted: false });
    kernel.tick(1);
    expect(res(kernel).values.hp).toBeGreaterThan(5);
  });

  it('never fills past the available max', () => {
    const kernel = wounded(49.99);
    kernel.tick(20);
    expect(res(kernel).values.hp).toBe(50);
  });
});

describe('resting and the other pools', () => {
  /** Mana gained over `ticks` ticks, from a pool with room to refill. */
  function manaOver(pace: Partial<Pace> | undefined, ticks: number): { gained: number; rate: number } {
    const kernel = setup({ values: { hp: 5, mana: 0 }, attrs: { int: 20 } });
    if (pace) emit(kernel, setPace, pace);
    kernel.tick(ticks);
    return { gained: res(kernel).values.mana, rate: statOf(kernel, 'manaRegen') };
  }
  const REST: Partial<Pace> = { resting: true, hpMult: RECOVERY_MULT.rest, healKind: 'rest' };

  it('mana comes back faster while resting', () => {
    expect(manaOver(REST, TPS).gained / manaOver(undefined, TPS).gained).toBeCloseTo(RESOURCES.mana.restRegenMult!, 3);
    expect(RESOURCES.mana.restRegenMult).toBe(3);
  });

  it('and at its ordinary rate for anything else', () => {
    const { gained, rate } = manaOver({ hpMult: RECOVERY_MULT.explore }, TPS);
    expect(gained).toBeCloseTo(rate, 3);
  });

  it('leaves stamina alone — it declares no rest bonus', () => {
    const idle = setup({ values: { stamina: 0 } });
    const resting = setup({ values: { stamina: 0 } });
    emit(resting, setPace, { resting: true, hpMult: RECOVERY_MULT.rest, healKind: 'rest' });
    idle.tick(TPS);
    resting.tick(TPS);
    expect(res(resting).values.stamina).toBeCloseTo(res(idle).values.stamina, 4);
  });

  it('spirit is static: it sits at its available max', () => {
    const kernel = setup({ values: { spirit: 1 } });
    kernel.tick(1);
    expect(res(kernel).values.spirit).toBe(statOf(kernel, 'maxSpirit'));
  });
});

// ---- stamina ----

// The exertion halves of the styles, from the old data/styles.data.ts.
const CRUSH: ExertionSpec = { cost: 0.1, hit: { damage: 0.5, penetration: 0.15 } };
const JIGEN_RYU: ExertionSpec = { cost: 1, drain: true, hit: { damage: 1.5, penetration: 0.3 } };

/** Send one exertion and return what it bought. */
function exert(kernel: Kernel, spec: ExertionSpec): Exertion {
  let result: Exertion | undefined;
  const remove = kernel.onEvent((event: GameEvent) => {
    if (event.type === exerted.type) result = event.payload as Exertion;
  });
  emit(kernel, exertPool, { spec });
  remove();
  return result!;
}

/** A `Pools` over a copy of the kernel's slice, for the pool functions that have no request. */
function poolsOf(kernel: Kernel): Pools {
  return { state: res(kernel), stats: statBlockOf(kernel), hooks: poolHooks(kernel), note: () => {} };
}

describe('exertion', () => {
  it('spends a fraction of MAX stamina and pays the full bonus for a full price', () => {
    const kernel = setup({ exerting: true });
    const stats = statBlockOf(kernel);
    const ex = exert(kernel, CRUSH);
    expect(ex.spent).toBeCloseTo(stats.maxStamina * CRUSH.cost * stats.staminaEff);
    // Not 1: stamina power pays back what efficiency saves, even untrained.
    expect(ex.ratio).toBeCloseTo(stats.staminaPower);
    expect(ex.ratio).toBeCloseTo(1, 2);
    expect(ex.damage).toBeCloseTo(CRUSH.hit!.damage! * stats.staminaPower);
    expect(ex.penetration).toBeCloseTo(CRUSH.hit!.penetration! * stats.staminaPower);
    expect(lockOf(kernel)).toBe('none');
  });

  it('a partial payment buys a proportional share, then latches winded', () => {
    const base = statBlockOf(makeGame());
    const floor = base.maxStamina * STAMINA_RESERVE;
    // Only a fifth of the intended cost is left above the reserve.
    const affordable = base.maxStamina * CRUSH.cost * base.staminaEff * 0.2;
    const kernel = setup({ exerting: true, values: { stamina: floor + affordable } });

    const ex = exert(kernel, CRUSH);
    expect(ex.ratio).toBeCloseTo(0.2 * base.staminaPower, 3);
    expect(ex.damage).toBeCloseTo(CRUSH.hit!.damage! * 0.2 * base.staminaPower, 3);
    expect(res(kernel).values.stamina).toBeCloseTo(floor);
    expect(lockOf(kernel)).toBe('low');

    // Winded: nothing more is spent and nothing more is bought.
    const again = exert(kernel, CRUSH);
    expect(again.spent).toBe(0);
    expect(again.damage).toBe(0);
    expect(res(kernel).values.stamina).toBeCloseTo(floor);
  });

  it('buys nothing while the player has not opted in', () => {
    const kernel = makeGame();
    expect(exert(kernel, CRUSH).spent).toBe(0);
    expect(res(kernel).values.stamina).toBe(11);
    expect(kernel.dispatch(setExerting({ on: true })).ok).toBe(true);
    expect(kernel.dispatch(setExerting({ on: true }))).toEqual({ ok: false, reason: 'exertion is already on' });
    expect(exert(kernel, CRUSH).spent).toBeGreaterThan(0);
  });

  it('the lockout clears only on a completely full bar', () => {
    const max = statOf(makeGame(), 'maxStamina');
    const kernel = setup({ exerting: true, locks: { stamina: 'low' }, values: { stamina: max - 0.5 } });
    const pools = poolsOf(kernel);
    regenResource(pools, 'stamina', 0.25);
    expect(pools.state.locks.stamina).toBe('low'); // still short
    regenResource(pools, 'stamina', 0.25);
    expect(pools.state.values.stamina).toBe(max);
    expect(pools.state.locks.stamina).toBe('none');
  });

  it('fractional extra hits roll as a chance, whole ones are guaranteed', () => {
    let state = 5;
    const next = (): number => {
      // Lehmer generator: the product stays under 2^53.
      state = (state * 48271) % 2147483647;
      return state / 2147483647;
    };
    const rng = { next, int: (n: number) => Math.floor(next() * n), chance: (p: number) => next() < p };
    expect(rollExtraHits(rng, 0)).toBe(0);
    expect(rollExtraHits(rng, 1)).toBe(1);
    const rolls = Array.from({ length: 40 }, () => rollExtraHits(rng, 1.5));
    expect(Math.min(...rolls)).toBe(1);
    expect(Math.max(...rolls)).toBe(2);
  });
});

describe('exhaustion', () => {
  it('an all-in school strike empties the bar and leaves you spent', () => {
    const kernel = setup({ exerting: true });
    const power = statOf(kernel, 'staminaPower');
    const ex = exert(kernel, JIGEN_RYU);
    expect(res(kernel).values.stamina).toBe(0);
    expect(lockOf(kernel)).toBe('empty');
    // A full bar buys the whole bonus.
    expect(ex.ratio).toBeCloseTo(power);
    expect(ex.damage).toBeCloseTo(JIGEN_RYU.hit!.damage! * power);
  });

  it('a half-empty bar buys half the all-in bonus', () => {
    const max = statOf(makeGame(), 'maxStamina');
    const kernel = setup({ exerting: true, values: { stamina: max * 0.5 } });
    const ex = exert(kernel, JIGEN_RYU);
    expect(ex.ratio).toBeCloseTo(0.5 * statOf(makeGame(), 'staminaPower'));
    expect(lockOf(kernel)).toBe('empty');
  });

  it('drags every action bar down until recovery', () => {
    const rested = statOf(makeGame(), 'speed');
    const kernel = setup({ exerting: true, locks: { stamina: 'empty' }, values: { stamina: 0 } });
    expect(statOf(kernel, 'speed')).toBeCloseTo(rested * (1 - EXHAUSTED_SPEED_PENALTY));
    expect(EXHAUSTED_SPEED_PENALTY).toBe(0.15);
  });

  it('the penalty arrives and leaves with the lock, with no stale stat', () => {
    const kernel = setup({ exerting: true });
    const rested = statOf(kernel, 'speed');
    exert(kernel, JIGEN_RYU);
    expect(statOf(kernel, 'speed')).toBeCloseTo(rested * (1 - EXHAUSTED_SPEED_PENALTY));
    expect(kernel.staleStats()).toEqual([]);
    // Regeneration refills the bar; the lock clears on a full bar.
    for (let i = 0; i < 2000 && lockOf(kernel) !== 'none'; i++) {
      kernel.tick(1);
      expect(kernel.staleStats()).toEqual([]);
    }
    expect(lockOf(kernel)).toBe('none');
    expect(statOf(kernel, 'speed')).toBeCloseTo(rested);
  });

  it('crawls back for the first half of the bar, then recovers normally', () => {
    const max = statOf(makeGame(), 'maxStamina');
    const empty = poolsOf(setup({ exerting: true, locks: { stamina: 'empty' }, values: { stamina: 0 } }));
    regenResource(empty, 'stamina', 1);
    expect(empty.state.values.stamina).toBeCloseTo(EXHAUSTED_REGEN_MULT); // slowed

    const past = poolsOf(setup({ exerting: true, locks: { stamina: 'empty' }, values: { stamina: max * 0.6 } }));
    regenResource(past, 'stamina', 1);
    expect(past.state.values.stamina).toBeCloseTo(max * 0.6 + 1); // full speed
    expect(past.state.locks.stamina).toBe('empty'); // but still locked out
  });

  it('says so in the log, once per change', () => {
    const kernel = setup({ exerting: true });
    exert(kernel, JIGEN_RYU);
    kernel.tick(3);
    const lines = () => slice<LogState>(kernel, 'log').log.map((line) => line.msg);
    expect(lines()).toEqual([RESOURCES.stamina.reserve!.emptyMsg]);
    for (let i = 0; i < 2000 && lockOf(kernel) !== 'none'; i++) kernel.tick(1);
    kernel.tick(1);
    expect(lines()).toEqual([RESOURCES.stamina.reserve!.emptyMsg, RESOURCES.stamina.reserve!.clearedMsg]);
  });
});

describe('style mods and the stamina lock', () => {
  // A stand-in for the styles port: Finesse's exertion mods (old
  // data/styles.data.ts) hold only while exertion is being paid for. Its
  // source reads the resources slice and declares that it does.
  const FINESSE = [
    { stat: 'crit', op: 'add', value: 0.12 },
    { stat: 'attackSpeed', op: 'mult', value: -0.12 },
  ] as const;
  const stance = defineSystem<Record<string, never>>({
    id: 'stance',
    version: 1,
    initial: () => ({}),
    modifiers: [
      {
        id: 'stance/exertion',
        dependsOn: [LOCKS_SOURCE],
        collect: ({ read }) =>
          exerting(read(resources)) ? FINESSE.map((m) => contentMod({ ...m }, 'Finesse: exertion', undefined)) : [],
      },
    ],
  });

  it('style mods lapse while winded and return with the breath', () => {
    const kernel = makeKernel([probe, stance]);
    const plain = statOf(kernel, 'crit');
    kernel.dispatch(setExerting({ on: true }));
    const fresh = statOf(kernel, 'crit');
    expect(fresh).toBeCloseTo(plain + 0.12);

    // Draw down to the reserve: winded.
    emit(kernel, drawPool, { id: 'stamina', amount: 1000 });
    expect(lockOf(kernel)).toBe('low');
    expect(statOf(kernel, 'crit')).toBeCloseTo(fresh - 0.12);
    expect(kernel.staleStats()).toEqual([]);

    for (let i = 0; i < 3000 && lockOf(kernel) !== 'none'; i++) kernel.tick(1);
    expect(statOf(kernel, 'crit')).toBeCloseTo(fresh);
    expect(kernel.staleStats()).toEqual([]);
  });
});

describe('stamina power', () => {
  it('pays back what efficiency saves', () => {
    const raw = statBlockOf(makeGame());
    expect(raw.staminaPower).toBeCloseTo(2 - raw.staminaEff);
    const trained = statBlockOf(setup({ attrs: { str: 120, dex: 120 } }));
    expect(trained.staminaEff).toBeLessThan(raw.staminaEff); // cheaper
    expect(trained.staminaPower).toBeGreaterThan(raw.staminaPower); // and stronger
    expect(trained.staminaPower - 1).toBeCloseTo(1 - trained.staminaEff, 5);
  });

  it('efficiency stops at a floor instead of running to nothing', () => {
    const stats = statBlockOf(setup({ attrs: { str: 100000, dex: 100000 } }));
    expect(stats.staminaEff).toBeCloseTo(STAMINA_EFF_FLOOR);
    expect(stats.staminaPower).toBeCloseTo(2 - STAMINA_EFF_FLOOR);
  });

  it('multiplies what an exertion buys', () => {
    const weak = setup({ exerting: true });
    const strongMax = statOf(setup({ attrs: { str: 150, dex: 150 } }), 'maxStamina');
    // A bigger pool starts empty: fill it.
    const strong = setup({ exerting: true, attrs: { str: 150, dex: 150 }, values: { stamina: strongMax } });
    const a = exert(weak, CRUSH);
    const b = exert(strong, CRUSH);
    expect(b.damage).toBeGreaterThan(a.damage);
    expect(b.damage / CRUSH.hit!.damage!).toBeCloseTo(statOf(strong, 'staminaPower'), 4);
  });

  it('upkeep is priced per second of wind-up, at just under what is recovered', () => {
    const stats = statBlockOf(makeGame());
    expect(attackUpkeep(stats, 2)).toBeCloseTo(stats.staminaRegen * 2 * UPKEEP_SHARE * stats.staminaEff);
    expect(attackUpkeep(stats, 2)).toBeLessThan(stats.staminaRegen * 2);
  });
});

// ---- pools and health ----

describe('pools', () => {
  it('a spend ignores the reserve and latches empty at zero; a draw stops at the reserve', () => {
    const kernel = makeGame();
    const max = statOf(kernel, 'maxStamina');
    emit(kernel, drawPool, { id: 'stamina', amount: 4 });
    expect(res(kernel).values.stamina).toBe(max - 4);
    emit(kernel, drawPool, { id: 'stamina', amount: 100 });
    expect(res(kernel).values.stamina).toBeCloseTo(max * STAMINA_RESERVE);
    expect(lockOf(kernel)).toBe('low');
    emit(kernel, spendPool, { id: 'stamina', amount: 100 });
    expect(res(kernel).values.stamina).toBe(0);
    expect(lockOf(kernel)).toBe('empty');
  });

  it('a draw reports what was spent against the true max, for a condition that eats effort', () => {
    const kernel = makeGame();
    const seen: unknown[] = [];
    kernel.onEvent((event: GameEvent) => {
      if (event.type === poolSpent.type) seen.push(event.payload);
    });
    emit(kernel, drawPool, { id: 'stamina', amount: 2 });
    expect(seen).toEqual([{ id: 'stamina', spent: 2, max: 11 }]);
  });

  it('a sealed pool is clamped to its available max, and the reserve still reads the true max', () => {
    const kernel = makeGame();
    // What a wound sealing off 20% of stamina states.
    setMods(kernel, [hook(hookStat.ceiling('stamina'), 'mult', 0.8)]);
    const stats = statBlockOf(kernel);
    expect(trueMax(stats, 'stamina')).toBe(11);
    expect(availableMax(stats, poolHooks(kernel), 'stamina')).toBe(8); // floor(8.8)
    kernel.tick(1);
    expect(res(kernel).values.stamina).toBe(8);
    emit(kernel, drawPool, { id: 'stamina', amount: 100 });
    expect(res(kernel).values.stamina).toBeCloseTo(11 * STAMINA_RESERVE);
    expect(kernel.staleStats()).toEqual([]);
  });

  it('a blocked pool does not regenerate', () => {
    const kernel = setup({ values: { stamina: 0, mana: 0 }, attrs: { int: 20 } });
    setMods(kernel, [hook(hookStat.regenBlocked('mana'), 'add', 1)]);
    kernel.tick(20);
    expect(res(kernel).values.mana).toBe(0);
    expect(res(kernel).values.stamina).toBeGreaterThan(0);
  });

  it('a pool with headroom is drawn into debt and recovers toward zero first', () => {
    const kernel = setup({ values: { mana: 4 }, attrs: { int: 20 } });
    emit(kernel, drainPool, { id: 'mana', amount: 10 });
    expect(res(kernel).values.mana).toBe(0); // no headroom: stops at zero
    // What a condition that lets mana run 50% of its max into debt states.
    setMods(kernel, [hook(hookStat.headroom('mana'), 'add', 0.5)]);
    emit(kernel, drainPool, { id: 'mana', amount: 100 });
    const debt = -statOf(kernel, 'maxMana') * 0.5;
    expect(res(kernel).values.mana).toBe(debt);
    kernel.tick(1);
    expect(res(kernel).values.mana).toBeGreaterThan(debt);
    expect(res(kernel).values.mana).toBeLessThan(0);
  });

  it('a regeneration multiplier applies to every pool that regenerates', () => {
    const plain = setup({ values: { stamina: 0 } });
    const fasting = setup({ values: { stamina: 0 } });
    setMods(fasting, [hook(hookStat.regenMult, 'mult', 2)]);
    plain.tick(5);
    fasting.tick(5);
    expect(res(fasting).values.stamina).toBeCloseTo(res(plain).values.stamina * 2, 3);
  });

  it('every pool starts full at its level-1 capacity', () => {
    const kernel = makeGame();
    const stats = statBlockOf(kernel);
    expect(res(kernel).values).toEqual({
      hp: stats.maxHp,
      stamina: stats.maxStamina,
      mana: stats.maxMana,
      spirit: stats.maxSpirit,
      focus: stats.maxFocus,
    });
    expect(res(kernel).values).toEqual({ hp: 50, stamina: 11, mana: 1, spirit: 5, focus: 6 });
  });
});

describe('health', () => {
  it('a heal restores up to the available max and reports what landed', () => {
    const kernel = wounded(45);
    emit(kernel, setPace, { hpMult: 0 });
    const seen: HealResult[] = [];
    kernel.onEvent((event: GameEvent) => {
      if (event.type === playerHealed.type) seen.push(event.payload as HealResult);
    });
    emit(kernel, healPlayer, { amount: 20, kind: 'salve' });
    expect(res(kernel).values.hp).toBe(50);
    expect(seen).toEqual([{ kind: 'salve', asked: 20, allowed: 20, healed: 5 }]);
    emit(kernel, healPlayer, { amount: 0 });
    expect(kernel.skips().map((skip) => skip.reason)).toEqual(['amount 0 is not above 0']);
  });

  it('damage goes through one door and carries its attribution', () => {
    const kernel = makeGame();
    const seen: unknown[] = [];
    kernel.onEvent((event: GameEvent) => {
      if (event.type === playerDamaged.type) seen.push(event.payload);
    });
    const rat = { key: 'monster:forest_rat', label: 'Forest Rat', icon: '🐀', by: 'm1', thrown: 9 };
    emit(kernel, hurtPlayer, { amount: 7, type: 'piercing', source: rat });
    emit(kernel, hurtPlayer, { amount: 3, source: null });
    emit(kernel, hurtPlayer, { amount: 100 });
    expect(seen).toEqual([
      { lost: 7, type: 'piercing', source: rat },
      { lost: 3, source: null }, // already attributed
      { lost: 40 }, // no source: recorded as unknown by the fight record
    ]);
    const state = res(kernel);
    expect(isAlive(state)).toBe(false);
    expect(hpFraction(state, statBlockOf(kernel), poolHooks(kernel))).toBe(0);
    // HP has no reserve: reaching zero latches no lock.
    expect(state.locks.hp).toBeUndefined();
  });

  it('a knockout leaves 1 HP, and that is not a heal', () => {
    const kernel = wounded(0);
    emit(kernel, setPace, { hpMult: 0 });
    const healed: unknown[] = [];
    kernel.onEvent((event: GameEvent) => {
      if (event.type === playerHealed.type) healed.push(event.payload);
    });
    emit(kernel, defeatPlayer, undefined);
    expect(res(kernel).values.hp).toBe(1);
    expect(healed).toEqual([]);
  });
});
