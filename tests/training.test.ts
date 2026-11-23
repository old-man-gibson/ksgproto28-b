/**
 * Port of the old `tests/training.test.ts`: the keeper of the Cages and the
 * dare.
 *
 * Call shape changes:
 * - `g.state.spot = 'the_cages'` is the world slice's spot, patched.
 * - `bus.emit({ type: 'fight:won', spot, forced })` is the event
 *   `combat/fight-won` with the spot as the site.
 * - `applyStatus(state, state, ...)` is the request `statuses/apply`;
 *   `state.resources.hp = 5` is `setHp`; `g.state.attrs.<id>.level` is the
 *   attributes slice, patched; `state.stats[key]` is the counters slice.
 * - `g.answerDare(accept)` is the command `training/answer-dare`.
 * - `startStagedFight` is the request `combat/start-staged`; `inForcedFight`
 *   and `liveEnemies` read the combat slice.
 * - `checkTitleUnlocks` is the event `titles/check`, `setTitle` the command
 *   `titles/wear`.
 * - The old `Game.tick` that banked a tick and returned while a dare waited
 *   is `kernel.tick()` under the dare's play hold (docs/KERNEL.md decision
 *   36); `state.totalTicks` is the kernel's tick number. The old step
 *   buttons (`step`, `stepToEvent`) have no counterpart.
 *
 * New here: the hold's kernel cases (a held tick moves nothing, the answer
 * gets through, catch-up with a dare waiting and with one posed mid-way, the
 * kept flag after a load and a new run), the keeper's lines, the answer's old
 * rules, and the dare window rendered on the server and dispatched as its
 * buttons send.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { catchUp, createKernel, PLAYER, runHeadless, type Kernel } from '../src/kernel';
import { systems } from '../src/systems';
import type { ClockState } from '../src/systems/clock';
import type { AttributesState } from '../src/systems/attributes';
import { BONUS_CAP_TICKS, type BonusState } from '../src/systems/bonus';
import { fightWon, inForcedFight, liveEnemies, startStaged } from '../src/systems/combat';
import type { CountersState } from '../src/systems/counters';
import { MONSTERS } from '../src/systems/monsters';
import { resourceValue, type ResourcesState } from '../src/systems/resources';
import { statOf } from '../src/systems/stats';
import { applyStatus, heldOf, type StatusesState } from '../src/systems/statuses';
import { checkTitles, hasTitle, wearTitle, type TitlesState } from '../src/systems/titles';
import {
  answerDare,
  attrTotal,
  HOLD_KEY,
  holdingForDare,
  keeperTends,
  PATCHED_KEY,
  pendingDare,
  winsUntilDare,
  type TrainingView,
} from '../src/systems/training';
import DareReadout from '../src/systems/training/DareReadout.svelte';
import { selectActivity, siteOf, SPOTS } from '../src/systems/world';
import { combatOf, feedOf, logOf, setHp } from './combatHelpers';
import { ask, emit, makeGame, patch, reads, run, slice } from './helpers';

const CAGES = SPOTS.the_cages;
const EVERY = CAGES.dare!.every;
const CAP = CAGES.healBetweenBouts!.maxAttrTotal;

/** A beginner standing in the Cages, as the hunt leaves them after a win. */
function atTheCages(seed = 1): Kernel {
  const g = makeGame({ seed });
  patch(g, (slices) => {
    slices.world.spot = 'the_cages';
    if (!slices.world.discovered.includes('the_cages')) slices.world.discovered.push('the_cages');
  });
  return g;
}
const win = (g: Kernel, forced = false, site = 'the_cages') => emit(g, fightWon, { site, forced });
const hpOf = (g: Kernel) => resourceValue(slice<ResourcesState>(g, 'resources'), 'hp');
const maxHpOf = (g: Kernel) => statOf(reads(g), 'maxHp');
const holds = (g: Kernel, id: string) => heldOf(slice<StatusesState>(g, 'statuses'), PLAYER).some((s) => s.id === id);
const counter = (g: Kernel, key: string) => slice<CountersState>(g, 'counters').counts[key] ?? 0;
const bankOf = (g: Kernel) => slice<BonusState>(g, 'bonus').banked;
/** Every slice but the bonus bank, and the generator: what a held tick must leave alone. */
const withoutBonus = (g: Kernel) => {
  const snap = g.snapshot();
  const { bonus: _bank, ...rest } = snap.slices;
  return { rng: snap.kernel.rng, tick: snap.kernel.tick, slices: rest };
};
const setAttr = (g: Kernel, id: string, level: number) =>
  patch(g, (slices) => {
    (slices.attributes as AttributesState).attrs[id as 'str'].level = level;
  });

describe('the cage keeper patches up beginners', () => {
  it('a win heals to full and clears bleeding while the attributes are under the cap', () => {
    const g = atTheCages();
    expect(attrTotal(reads(g))).toBeLessThanOrEqual(CAP);
    setHp(g, 5);
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'bleeding', intensity: 3 }, source: 'a goblin' });
    expect(holds(g, 'bleeding')).toBe(true);
    win(g);
    expect(hpOf(g)).toBeCloseTo(maxHpOf(g), 5);
    expect(holds(g, 'bleeding')).toBe(false);
  });

  it('stops once the six attributes total more than the cap', () => {
    const g = atTheCages();
    setAttr(g, 'str', CAP); // with five others at 1+, the total is past it
    expect(keeperTends(reads(g), CAGES)).toBe(false);
    setHp(g, 5);
    win(g);
    expect(hpOf(g)).toBe(5);
  });

  it('only at the spot that has a keeper', () => {
    const g = makeGame({ seed: 1 });
    patch(g, (slices) => {
      slices.world.spot = 'f0_field';
    });
    setHp(g, 5);
    win(g, false, 'f0_field');
    expect(hpOf(g)).toBe(5);
  });
});

describe('the keeper’s lines (new)', () => {
  it('the first patch names the cap; later patches are the short line; nothing to patch, no line', () => {
    const g = atTheCages();
    setHp(g, 5);
    win(g);
    expect(counter(g, PATCHED_KEY)).toBe(1);
    expect(logOf(g).some((l) => l.includes('Train safely') && l.includes(`total ${CAP} or less`))).toBe(true);
    setHp(g, 5);
    win(g);
    expect(counter(g, PATCHED_KEY)).toBe(2);
    expect(logOf(g).some((l) => l.includes('The cage keeper patches you up: HP full.'))).toBe(true);
    // Full health, no condition: the keeper has nothing to do and says nothing.
    win(g);
    expect(counter(g, PATCHED_KEY)).toBe(2);
  });
});

describe("the keeper's dare holds play", () => {
  it(`comes after ${EVERY} wins, and the dare's own forced fight never counts`, () => {
    const g = atTheCages();
    for (let i = 0; i < EVERY - 1; i++) win(g);
    win(g, true); // a forced win: not a cage bout
    expect(pendingDare(reads(g))).toBeNull();
    expect(winsUntilDare(reads(g), CAGES)).toBe(1);
    win(g);
    expect(pendingDare(reads(g))?.id).toBe('the_cages');
  });

  it('while held, ticks bank bonus time and move nothing; the step buttons do nothing at all', () => {
    const g = atTheCages();
    for (let i = 0; i < EVERY; i++) win(g);
    const ticks = g.tickCount;
    const banked = bankOf(g);
    const before = withoutBonus(g);
    for (let i = 0; i < 50; i++) g.tick();
    expect(g.tickCount).toBe(ticks);
    expect(bankOf(g)).toBe(banked + 50);
    // No other system ticked: every slice but the bank is as it was.
    expect(withoutBonus(g)).toEqual(before);
    // The old step buttons (`step`, `stepToEvent`) have no counterpart here.
  });

  it('fleeing lifts the hold and the cages carry on', () => {
    const g = atTheCages();
    for (let i = 0; i < EVERY; i++) win(g);
    expect(g.dispatch(answerDare({ accept: false })).ok).toBe(true);
    expect(holdingForDare(reads(g))).toBe(false);
    expect(combatOf(g).fight).toBeNull();
    const ticks = g.tickCount;
    g.tick();
    expect(g.tickCount).toBe(ticks + 1);
    expect(winsUntilDare(reads(g), CAGES)).toBe(EVERY);
  });

  it('fighting starts the staged slime: alone, plain, and unfleeable', () => {
    const g = atTheCages();
    for (let i = 0; i < EVERY; i++) win(g);
    expect(g.dispatch(answerDare({ accept: true })).ok).toBe(true);
    const c = combatOf(g);
    expect(inForcedFight(c)).toBe(true);
    const foes = liveEnemies(c.fight!);
    expect(foes.map((m) => m.defId)).toEqual(['suspiciously_large_slime']);
    expect(foes[0].level).toBe(CAGES.dare!.level);
    expect(foes[0].modifier).toBe('normal');
    expect(foes[0].rarity).toBe('common');
  });

  it('a stale hold with no dare behind it is dropped instead of freezing the game', () => {
    const g = atTheCages();
    patch(g, (slices) => {
      (slices.counters as CountersState).counts[HOLD_KEY] = 1;
    });
    const ticks = g.tickCount;
    g.tick();
    expect(g.tickCount).toBe(ticks + 1);
    expect(holdingForDare(reads(g))).toBe(false);
  });

  it('stops asking once the slime is beaten, and never asks a player past the cap', () => {
    const beaten = atTheCages();
    patch(beaten, (slices) => {
      (slices.counters as CountersState).counts['kills:suspiciously_large_slime'] = 1;
    });
    for (let i = 0; i < EVERY * 2; i++) win(beaten);
    expect(pendingDare(reads(beaten))).toBeNull();

    const grown = atTheCages();
    setAttr(grown, 'con', CAP);
    for (let i = 0; i < EVERY * 2; i++) win(grown);
    expect(pendingDare(reads(grown))).toBeNull();
  });
});

describe('the hold of play (kernel decision 36, new)', () => {
  /** A beginner with a dare waiting at the Cages. */
  function dared(seed = 1): Kernel {
    const g = atTheCages(seed);
    for (let i = 0; i < EVERY; i++) win(g);
    expect(holdingForDare(reads(g))).toBe(true);
    return g;
  }
  const kernelTick = (e: ReturnType<Kernel['save']>) => (e.kernel.data as { tick: number }).tick;
  const bankIn = (e: ReturnType<Kernel['save']>) => (e.slices.bonus.data as unknown as BonusState).banked;

  it('a held tick leaves the tick number, the clock and the conditions alone and banks one tick per call', () => {
    const g = dared();
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'bleeding', intensity: 3 }, source: 'a goblin' });
    const clock = slice<ClockState>(g, 'clock');
    const conditions = slice<StatusesState>(g, 'statuses');
    const ticks = g.tickCount;
    const banked = bankOf(g);
    for (let i = 1; i <= 5; i++) {
      g.tick();
      expect(bankOf(g)).toBe(banked + i);
    }
    expect(g.tickCount).toBe(ticks);
    expect(slice<ClockState>(g, 'clock')).toEqual(clock);
    expect(slice<StatusesState>(g, 'statuses')).toEqual(conditions);
  });

  it('the answer gets through while held, lifts the hold, and the view still publishes', () => {
    const g = dared();
    g.tick(3);
    expect((g.view().systems.training as TrainingView).dare).not.toBeNull();
    const ticks = g.tickCount;
    expect(g.dispatch(answerDare({ accept: true })).ok).toBe(true);
    expect(combatOf(g).fight).not.toBeNull();
    g.tick(3);
    expect(g.tickCount).toBe(ticks + 3);
    expect((g.view().systems.training as TrainingView).dare).toBeNull();
  });

  it('catch-up that starts with a dare waiting runs no tick and banks the ticks left, up to the cap', () => {
    const g = dared();
    const before = g.save(0);
    const after = catchUp({ systems, envelope: before, ticks: 5000, now: 0 });
    expect(kernelTick(after)).toBe(kernelTick(before));
    expect(bankIn(after)).toBe(bankIn(before) + 5000);
    // Near the cap: the bank stops at it.
    patch(g, (slices) => {
      (slices.bonus as BonusState).banked = BONUS_CAP_TICKS - 10;
    });
    const capped = catchUp({ systems, envelope: g.save(0), ticks: 5000, now: 0 });
    expect(bankIn(capped)).toBe(BONUS_CAP_TICKS);
  });

  it('a dare posed mid catch-up stops the catch-up there and banks the rest', () => {
    // One win short of the dare, hunting the Cages, kept healthy by the keeper.
    const g = atTheCages(3);
    patch(g, (slices) => {
      (slices.counters as CountersState).counts[`dare:the_cages:wins`] = EVERY - 1;
    });
    expect(g.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);
    const start = g.save(0);
    const k = createKernel({ systems, validateContent: false, catchingUp: true });
    expect(k.load(start).ok).toBe(true);
    const bank0 = bankOf(k);
    const result = runHeadless(k, { ticks: 20000, hold: true });
    expect(result.heldBy).toBe('training');
    expect(result.ticks).toBeGreaterThan(0);
    expect(result.ticks).toBeLessThan(20000);
    expect(k.tickCount).toBe(kernelTick(start) + result.ticks);
    expect(pendingDare(reads(k))?.id).toBe('the_cages');
    // The ticks before the dare banked nothing (hunting is not idle); the rest went to the bank.
    expect(bankOf(k)).toBe(bank0 + (20000 - result.ticks));
  });

  it('the kept flag is right after a load and after a new run', () => {
    const held = dared();
    // Loaded into a kernel that never saw the dare: it holds.
    const other = makeGame({ seed: 2 });
    other.tick(2);
    expect(other.load(held.save(0)).ok).toBe(true);
    const t = other.tickCount;
    other.tick(4);
    expect(other.tickCount).toBe(t);
    // A save with no dare loaded into the held kernel: it ticks.
    expect(held.load(makeGame({ seed: 3 }).save(0)).ok).toBe(true);
    const t2 = held.tickCount;
    held.tick(4);
    expect(held.tickCount).toBe(t2 + 4);
    // A new run while a dare waits: the counters start new, and play runs.
    const renewed = dared(4);
    run(renewed, (ctx) => ctx.endRun());
    expect(holdingForDare(reads(renewed))).toBe(false);
    const t3 = renewed.tickCount;
    renewed.tick(4);
    expect(renewed.tickCount).toBe(t3 + 4);
  });
});

describe('the answer, old rules kept (new)', () => {
  it('accepting away from the spot reads as a pass: the hold lifts, no fight, the pass line', () => {
    const g = atTheCages();
    for (let i = 0; i < EVERY; i++) win(g);
    patch(g, (slices) => {
      slices.world.spot = 'f0_field';
    });
    expect(g.dispatch(answerDare({ accept: true })).ok).toBe(true);
    expect(combatOf(g).fight).toBeNull();
    expect(counter(g, HOLD_KEY)).toBe(0);
    expect(logOf(g).some((l) => l.startsWith('You pass on the'))).toBe(true);
  });

  it('an answer with no dare waiting is refused with a reason, and still clears a stray hold', () => {
    const g = atTheCages();
    patch(g, (slices) => {
      (slices.counters as CountersState).counts[HOLD_KEY] = 1;
    });
    const result = g.dispatch(answerDare({ accept: false }));
    expect(result).toEqual({ ok: false, reason: 'no dare is waiting' });
    expect(counter(g, HOLD_KEY)).toBe(0);
  });
});

describe('the dare window (new)', () => {
  const viewOf = (g: Kernel) => g.view().systems.training as TrainingView;
  /** The window's button path: the control is rendered, and a click sends the command its action carries. */
  function press(g: Kernel, id: 'fight' | 'flee'): boolean {
    const view = viewOf(g);
    const html = render(DareReadout, { props: { view, onAction: () => {} } }).body;
    const action = view.actions.find((a) => a.id === id);
    expect(action, `no ${id} action`).toBeDefined();
    expect(html).toContain(`data-action="${id}"`);
    expect(html).toContain(action!.label);
    return g.dispatch(action!.command).ok;
  }

  it('is closed while no dare waits', () => {
    const g = atTheCages();
    expect(viewOf(g)).toEqual({ dare: null, actions: [] });
    expect(render(DareReadout, { props: { view: viewOf(g), onAction: () => {} } }).body).not.toContain('dare-title');
  });

  it('shows the foe, its size against the player, the keeper’s words, HP and the bank', () => {
    const g = atTheCages();
    for (let i = 0; i < EVERY; i++) win(g);
    const view = viewOf(g);
    const slime = MONSTERS.suspiciously_large_slime;
    expect(view.dare?.foe).toEqual({ name: slime.name, icon: slime.icon, level: CAGES.dare!.level });
    expect(view.dare?.sizeLine).toMatch(/size step|your size/);
    const html = render(DareReadout, { props: { view, onAction: () => {} } }).body;
    expect(html).toContain('the keeper stops the cages');
    expect(html).toContain(CAGES.dare!.desc);
    expect(html).toContain(`Your HP: ${view.dare!.hp} / ${view.dare!.maxHp}.`);
    expect(html).toContain(`asks again after ${EVERY} more wins`);
    expect(view.actions.map((a) => a.label)).toEqual([`⚔️ Fight the ${slime.name}`, '🏃 Flee: back to normal cages']);
  });

  it('Fight starts the slime; the window closes', () => {
    const g = atTheCages();
    for (let i = 0; i < EVERY; i++) win(g);
    expect(press(g, 'fight')).toBe(true);
    expect(liveEnemies(combatOf(g).fight!).map((m) => m.defId)).toEqual(['suspiciously_large_slime']);
    expect(viewOf(g).dare).toBeNull();
  });

  it('Flee passes; the window closes and no fight starts', () => {
    const g = atTheCages();
    for (let i = 0; i < EVERY; i++) win(g);
    expect(press(g, 'flee')).toBe(true);
    expect(combatOf(g).fight).toBeNull();
    expect(viewOf(g).dare).toBeNull();
  });
});

describe('David and Goslimath', () => {
  it('beating the slime earns the hidden title; it pays per size step against larger things', () => {
    const g = makeGame({ seed: 1 });
    expect(hasTitle(slice<TitlesState>(g, 'titles'), 'david_and_goslimath')).toBe(false);
    patch(g, (slices) => {
      (slices.counters as CountersState).counts['kills:suspiciously_large_slime'] = 1;
    });
    emit(g, checkTitles, undefined);
    expect(hasTitle(slice<TitlesState>(g, 'titles'), 'david_and_goslimath')).toBe(true);
    // Earned: the small part always applies. Worn: the large part on top.
    expect(statOf(reads(g), 'vsLarger')).toBeCloseTo(0.03, 6);
    expect(g.dispatch(wearTitle({ title: 'david_and_goslimath' })).ok).toBe(true);
    expect(statOf(reads(g), 'vsLarger')).toBeCloseTo(0.18, 6);
  });

  it('the bonus shows up in the blow against something one size step up', () => {
    const g = atTheCages(7);
    patch(g, (slices) => {
      (slices.counters as CountersState).counts['kills:suspiciously_large_slime'] = 1;
    });
    emit(g, checkTitles, undefined);
    g.dispatch(wearTitle({ title: 'david_and_goslimath' }));
    // A rematch, staged directly: once beaten, the keeper no longer asks.
    ask(g, startStaged, {
      site: siteOf(reads(g), CAGES),
      members: [{ monsterId: 'suspiciously_large_slime', level: CAGES.dare!.level }],
    });
    for (let i = 0; i < 600 && combatOf(g).fight; i++) g.tick();
    const mine = feedOf(g)
      .map((l) => l.damage)
      .filter((d) => d !== undefined && !d.incoming);
    expect(mine.length).toBeGreaterThan(0);
    const step = mine[0]!.steps.find((s) => s.label === 'Damage vs Larger');
    expect(step?.mult).toBeCloseTo(1.18, 6);
  });
});
