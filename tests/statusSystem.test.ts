import { describe, expect, it } from 'vitest';
import { catchUp, PLAYER, TPS, type GameEvent, type Kernel } from '../src/kernel';
import { systems } from '../src/systems';
import type { LogState } from '../src/systems/log';
import { hurtPlayer, setPace, type ResourcesState, type ResourcesView } from '../src/systems/resources';
import { statBlockOf, statOf } from '../src/systems/stats';
import {
  applyStatus,
  conditionDamage,
  conditionDetonated,
  conditionsExpired,
  forgetEntity,
  HELD_SOURCE,
  heldOf,
  inflictStatuses,
  SELF_RUN,
  setSituation,
  statusHook,
  STATUSES,
  tickStatuses,
  WARD_STAT,
  type StatusApplication,
  type StatusesState,
  type StatusesView,
} from '../src/systems/statuses';
import { ask, emit, makeGame, patch, probe, setMods, slice } from './helpers';

/**
 * The statuses system around its engine: the player's tick, the events it
 * hears and emits, the pool hooks, entities, the view and the save. The old
 * build had these in `tickPlayerStatuses` (`systems/actions.ts`), in
 * `health.ts` and in `resources.ts`; tests/statuses.test.ts ports the engine
 * cases.
 */

const fresh = (seed = 1): Kernel => makeGame({ seed });
const held = (g: Kernel, who: string = PLAYER) => heldOf(slice<StatusesState>(g, 'statuses'), who);
const has = (g: Kernel, id: string, who: string = PLAYER) => held(g, who).some((h) => h.id === id);
const apply = (g: Kernel, app: StatusApplication, who: string = PLAYER) => ask(g, applyStatus, { entity: who, app });
const hp = (g: Kernel) => slice<ResourcesState>(g, 'resources').values.hp;
const sound = (g: Kernel) => expect(g.staleStats()).toEqual([]);
const view = (g: Kernel) => g.view().systems.statuses as StatusesView;

function heard<P>(g: Kernel, type: string): P[] {
  const seen: P[] = [];
  g.onEvent((event: GameEvent) => {
    if (event.type === type) seen.push(event.payload as P);
  });
  return seen;
}

/** Stop the health trickle, so a tick changes health through conditions only. */
const noTrickle = (g: Kernel) => emit(g, setPace, { hpMult: 0 });

describe("the player's tick", () => {
  it('deals the damage of a condition to the player every tick, as one sum', () => {
    const g = fresh();
    noTrickle(g);
    apply(g, { id: 'poison', intensity: 4 });
    const damage = heard<{ damage: number }>(g, conditionDamage.type);
    const before = hp(g);
    g.tick(10);
    // 0.05 per tick per intensity.
    expect(before - hp(g)).toBeCloseTo(0.05 * 4 * 10, 3);
    expect(damage).toHaveLength(10);
    sound(g);
  });

  it('feeds one floating run and settles it when the condition is gone', () => {
    const g = fresh();
    noTrickle(g);
    apply(g, { id: 'poison', intensity: 2, duration: 5 });
    g.tick(3);
    const run = slice<LogState>(g, 'log').floatingFeed.find((f) => f.group === SELF_RUN)!;
    expect(run.prefix).toBe('🩸 You suffer:');
    expect(run.tally).toEqual([{ label: '🤢 poisoned', qty: expect.closeTo(0.3, 6), style: 'amount' }]);

    g.tick(3);
    expect(has(g, 'poison')).toBe(false);
    const log = slice<LogState>(g, 'log');
    expect(log.floatingFeed.find((f) => f.group === SELF_RUN)).toBeUndefined();
    // Nothing to stick to: the run became a line of the fight feed.
    expect(log.combatFeed.at(-1)!.text).toContain('You suffer:');
    sound(g);
  });

  it('settles a run whose condition dealt damage on one tick only', () => {
    const g = fresh();
    noTrickle(g);
    apply(g, { id: 'poison', intensity: 2, duration: 1 });
    g.tick(2);
    expect(slice<LogState>(g, 'log').floatingFeed).toEqual([]);
  });

  it('writes a line and emits an event when a condition runs out, but not for a hidden one', () => {
    const g = fresh();
    apply(g, { id: 'poison', intensity: 1, duration: 2 });
    apply(g, { id: 'fasting', intensity: 1, duration: 2 }); // hidden
    const expired = heard<{ ids: string[] }>(g, conditionsExpired.type);
    g.tick(3);
    expect(expired.flatMap((e) => e.ids).sort()).toEqual(['fasting', 'poison']);
    const lines = slice<LogState>(g, 'log').log.map((l) => l.msg);
    expect(lines).toContain('🤢 Poisoned has passed.');
    expect(lines.some((l) => l.includes(STATUSES.fasting.name))).toBe(false);
  });

  it('does not tick while regeneration is halted (the old loop did not tick conditions while travelling)', () => {
    const g = fresh();
    apply(g, { id: 'poison', intensity: 4 });
    emit(g, setPace, { halted: true });
    const clock = held(g)[0].ticksLeft;
    const before = hp(g);
    g.tick(20);
    expect(held(g)[0].ticksLeft).toBe(clock);
    expect(hp(g)).toBe(before);
  });

  it('reads the fight from the situation: a bleed eases off out of combat', () => {
    const drop = (inCombat: boolean) => {
      const g = fresh();
      noTrickle(g);
      emit(g, setSituation, { inCombat });
      apply(g, { id: 'bleeding', intensity: 1 });
      const before = hp(g);
      g.tick(10);
      return before - hp(g);
    };
    expect(drop(false)).toBeCloseTo(drop(true) * STATUSES.bleeding.dot!.outOfCombat!, 2);
  });

  it('sheds the share the ward hook states', () => {
    const drop = (ward: number) => {
      const g = makeGame();
      noTrickle(g);
      if (ward > 0) setMods(g, [{ stat: WARD_STAT, kind: 'add', value: ward }]);
      apply(g, { id: 'poison', intensity: 4 });
      const before = hp(g);
      g.tick(10);
      return before - hp(g);
    };
    expect(drop(0.5)).toBeCloseTo(drop(0) * 0.5, 3);
  });

  it('a dish feeds health back through heal, a little every tick', () => {
    const g = fresh();
    noTrickle(g);
    patch(g, (s) => (s.resources.values.hp = 10));
    apply(g, { id: 'well_fed', intensity: 1 });
    g.tick(10);
    const max = statOf(g, 'maxHp');
    expect(hp(g) - 10).toBeCloseTo(STATUSES.well_fed.restores![0].ofMax! * max * 10, 3);
  });

  it('a detonation hurts through the health door, writes a line and emits an event', () => {
    const g = fresh(41);
    patch(g, (s) => (s.attributes.attrs.int.level = 60));
    const size = statOf(g, 'maxMana');
    patch(g, (s) => (s.resources.values.mana = size));
    apply(g, { id: 'manaburn', intensity: size * 4 });
    const booms = heard<{ dealt: number; type: string }>(g, conditionDetonated.type);
    const before = hp(g);
    noTrickle(g);
    for (let i = 0; i < 4000 && booms.length === 0; i++) g.tick();
    expect(booms).toHaveLength(1);
    expect(booms[0].type).toBe('arcane');
    expect(booms[0].dealt).toBeGreaterThanOrEqual(1);
    expect(before - hp(g)).toBeCloseTo(Math.min(before, booms[0].dealt), 3);
    expect(slice<LogState>(g, 'log').log.some((l) => l.msg.includes('detonates for'))).toBe(true);
    sound(g);
  });
});

describe('what the system hears', () => {
  it('a blow on the player reaches the conditions with its type and amount', () => {
    const g = fresh();
    apply(g, { id: 'frozen', intensity: 1 });
    for (let i = 0; i < 3; i++) apply(g, { id: 'wet', intensity: 1 });
    emit(g, hurtPlayer, { amount: 2, type: 'heat' });
    expect(has(g, 'frozen')).toBe(false); // any damage
    expect(held(g).find((h) => h.id === 'wet')!.stacks).toBe(2); // heat only
    sound(g);
  });

  it('`statuses/hook` fires a removal event for a caller that needs no answer', () => {
    const g = fresh();
    apply(g, { id: 'poison', intensity: 1 });
    apply(g, { id: 'dazed', intensity: 1 }, 'wolf');
    emit(g, statusHook, { entity: PLAYER, on: 'cure', detail: { tag: 'poison' } });
    emit(g, statusHook, { entity: 'wolf', on: 'combatEnd' });
    expect(has(g, 'poison')).toBe(false);
    expect(held(g, 'wolf')).toEqual([]);
    sound(g);
  });

  it('`statuses/inflict` applies a list, resisted when the caller says the dose is done to the player', () => {
    const g = fresh();
    setMods(g, [{ stat: 'stats/resSlashing', kind: 'add', value: 0.6 }]);
    emit(g, inflictStatuses, {
      entity: PLAYER,
      apps: [{ id: 'bleeding', intensity: 1 }, { id: 'steady_hand' }],
      source: 'a claw',
      resist: true,
    });
    expect(held(g).find((h) => h.id === 'bleeding')!.intensity).toBeCloseTo(0.4);
    expect(held(g).find((h) => h.id === 'steady_hand')!.source).toBe('a claw');
    sound(g);
  });

  it('logs a skip for a status id that does not exist', () => {
    const g = fresh();
    emit(g, inflictStatuses, { entity: PLAYER, apps: [{ id: 'no_such_status' }] });
    expect(apply(g, { id: 'also_missing' })).toBeNull();
    const reasons = g.skips().map((s) => `${s.action}: ${s.reason}`);
    expect(reasons).toContain('statuses/inflict: unknown status "no_such_status"');
    expect(reasons).toContain('statuses/apply: unknown status "also_missing"');
    expect(held(g)).toEqual([]);
  });
});

describe('the pool hooks of resources', () => {
  it('a laceration seals health, a puncture raises the cost of stamina, a perforation blocks its regeneration', () => {
    const g = fresh();
    const pools = () => (g.view().systems.resources as ResourcesView).pools;
    const full = pools().find((p) => p.id === 'hp')!.max;
    apply(g, { id: 'lacerated', intensity: 3 });
    expect(pools().find((p) => p.id === 'hp')!.max).toBe(Math.floor(full * (1 - 0.04 * 3)));

    apply(g, { id: 'punctured', intensity: 1 });
    expect(g.derived('resources/costMult.stamina')).toBeCloseTo(1.25);
    expect(g.derived('resources/regenBlocked.stamina')).toBe(0);
    apply(g, { id: 'perforated', intensity: 1 });
    expect(g.derived('resources/regenBlocked.stamina')).toBe(1);
    sound(g);
  });

  it('manaburn gives the mana pool headroom below zero, by stacks', () => {
    const g = fresh();
    expect(g.derived('resources/headroom.mana')).toBe(0);
    apply(g, { id: 'manaburn', intensity: 10 });
    const spec = STATUSES.manaburn.negativeHeadroom!;
    expect(g.derived('resources/headroom.mana')).toBeCloseTo(spec.base);
    sound(g);
  });

  it('a blaze caps healing through the allowance hook, and the cap follows what it burns', () => {
    const g = fresh();
    expect(g.derived('resources/healCapped')).toBe(0);
    apply(g, { id: 'blazing', intensity: 2 });
    expect(g.derived('resources/healCapped')).toBe(1);
    expect(g.derived('resources/healAllowance')).toBe(0);
    noTrickle(g);
    const before = hp(g);
    g.tick(3);
    expect(g.derived('resources/healAllowance')).toBeCloseTo((before - hp(g)) * STATUSES.blazing.healCap!, 3);
    sound(g);
  });
});

describe('entities', () => {
  it('keeps one list per entity and feeds each its own stats', () => {
    const g = fresh();
    const base = statOf(g, 'speed');
    apply(g, { id: 'chilled', intensity: 0.5 }, 'wolf');
    expect(statOf(g, 'speed')).toBe(base);
    expect(statOf(g, 'speed', 'wolf')).toBeLessThan(base);
    expect(held(g)).toEqual([]);
    sound(g);
  });

  it('ticks another entity only when its owner asks, and reports instead of applying', () => {
    const g = fresh();
    apply(g, { id: 'poison', intensity: 4 }, 'wolf');
    const clock = held(g, 'wolf')[0].ticksLeft!;
    g.tick(5);
    expect(held(g, 'wolf')[0].ticksLeft).toBe(clock);
    const result = ask(g, tickStatuses, { entity: 'wolf', hp: 20, maxHp: 20, inCombat: true });
    expect(result.damage).toBeCloseTo(0.2);
    expect(held(g, 'wolf')[0].ticksLeft).toBe(clock - 1);
    sound(g);
  });

  it('forgets the list of an entity its owner dropped', () => {
    const g = fresh();
    apply(g, { id: 'chilled', intensity: 0.5 }, 'wolf');
    expect(g.entities()).toContain('wolf');
    // The owner of the entity sends the event and drops the entity.
    g.dispatch({
      type: 'probe/run',
      payload: (ctx: { emit: Function; dropEntity: (e: string) => void }) => {
        ctx.emit(forgetEntity, { entity: 'wolf' });
        ctx.dropEntity('wolf');
      },
    });
    expect(slice<StatusesState>(g, 'statuses').held).toEqual({});
    expect(g.entities()).toEqual([PLAYER]);
    sound(g);
  });

  it('an entity that holds nothing has no key in the slice', () => {
    const g = fresh();
    apply(g, { id: 'poison', intensity: 1, duration: 1 });
    g.tick(2);
    expect(slice<StatusesState>(g, 'statuses').held).toEqual({});
    // An application that did not land leaves no empty list either.
    setMods(g, [{ stat: 'stats/resPoison', kind: 'add', value: 1 }], 'knight');
    expect(apply(g, { id: 'poison' }, 'knight')).toBeNull();
    expect(slice<StatusesState>(g, 'statuses').held).toEqual({});
  });
});

describe('the modifier source', () => {
  it('is touched for the entity that changed and for no other', () => {
    const g = fresh();
    statBlockOf(g);
    statBlockOf(g, 'wolf');
    const player = g.stats();
    const wolf = g.stats('wolf');
    apply(g, { id: 'chilled', intensity: 0.5 }, 'wolf');
    expect(g.stats()).toBe(player);
    expect(g.stats('wolf')).not.toBe(wolf);
    expect(HELD_SOURCE).toBe('statuses/held');
  });

  it('a condition the source reads nothing of rebuilds nothing', () => {
    const g = fresh();
    const before = g.stats();
    apply(g, { id: 'eyeless' });
    expect(g.stats()).toBe(before);
    sound(g);
  });
});

describe('the view', () => {
  it('lists the visible conditions of the player, strongest first, with their facts', () => {
    const g = fresh();
    apply(g, { id: 'poison', intensity: 2 });
    apply(g, { id: 'bleeding', intensity: 3 });
    apply(g, { id: 'fasting', intensity: 9 }); // hidden
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'jolted', intensity: 4 }, source: 'a Spark Slime' });
    const v = view(g);
    expect(v.player.map((s) => s.id)).toEqual(['jolted', 'bleeding', 'poison']);

    const poison = v.player.find((s) => s.id === 'poison')!;
    expect(poison).toMatchObject({ name: 'Poisoned', icon: '🤢', stacks: 1, seconds: 300 / TPS, source: null });
    expect(poison.facts[0]).toBe(STATUSES.poison.desc);

    expect(v.player.find((s) => s.id === 'bleeding')!.seconds).toBeNull();
    const jolted = v.player.find((s) => s.id === 'jolted')!;
    expect(jolted.escalation).toBeCloseTo(0.5);
    expect(jolted.facts).toContain(`Next dose: 50% to become ${STATUSES.shocked.icon} Shocked`);
    expect(jolted.facts).toContain('Source: a Spark Slime');
  });

  it('lists other entities apart from the player', () => {
    const g = fresh();
    apply(g, { id: 'chilled', intensity: 0.5 }, 'wolf');
    const v = view(g);
    expect(v.player).toEqual([]);
    expect(v.entities.wolf.map((s) => s.id)).toEqual(['chilled']);
  });
});

/**
 * tests/runner.test.ts budgets 8 hours for a character that holds nothing.
 * This is the same span with a condition that deals damage on every tick: a
 * timerless bleed, which sends four events per tick. Measured 2,650 ms alone
 * on 2026-11-16 (1,450 ms with a condition that only changes stats, 700 ms
 * with none).
 */
const HELD_EIGHT_HOUR_BUDGET_MS = 8000;

describe('offline catch-up with a condition held', () => {
  it(`simulates 8 hours of a bleeding character within ${HELD_EIGHT_HOUR_BUDGET_MS} ms`, () => {
    const g = makeGame({ seed: 9 });
    apply(g, { id: 'bleeding', intensity: 2 });
    apply(g, { id: 'tainted', intensity: 2, duration: 'permanent' });
    const envelope = g.save(0);
    const started = performance.now();
    const result = catchUp({ systems: [...systems, probe], envelope, ticks: 288_000, now: 0 });
    const elapsed = performance.now() - started;
    expect((result.slices.statuses.data as unknown as StatusesState).held[PLAYER].map((h) => h.id)).toEqual(['bleeding', 'tainted']);
    expect(elapsed, `8 hours took ${elapsed.toFixed(0)} ms`).toBeLessThan(HELD_EIGHT_HOUR_BUDGET_MS);
  });
});

describe('save', () => {
  it('a run split by a save and a load equals the whole run', () => {
    const script = (g: Kernel) => {
      apply(g, { id: 'poison', intensity: 3 });
      apply(g, { id: 'tainted', intensity: 2 });
      for (let i = 0; i < 3; i++) apply(g, { id: 'jolted', intensity: 1 });
      apply(g, { id: 'chilled', intensity: 0.4 }, 'wolf');
    };
    const whole = fresh(9);
    script(whole);
    whole.tick(400);

    const first = fresh(9);
    script(first);
    first.tick(150);
    const second = fresh(1);
    expect(second.load(first.save(0)).ok).toBe(true);
    second.tick(250);
    expect(second.snapshot()).toEqual(whole.snapshot());
    sound(second);
  });

  it('catch-up runs conditions the same as running in place', () => {
    const g = makeGame({ seed: 5 });
    apply(g, { id: 'poison', intensity: 3 });
    apply(g, { id: 'rotting', intensity: 1 });
    const envelope = g.save(0);
    g.tick(600);
    const caught = catchUp({ systems: [...systems, probe], envelope, ticks: 600, now: 0 });
    expect(caught.slices.statuses).toEqual(g.save(0).slices.statuses);
    expect(caught.slices.resources).toEqual(g.save(0).slices.resources);
  });
});
