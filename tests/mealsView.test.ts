/**
 * Port of old `tests/mealsView.test.ts`. Changed only where the call shape
 * changed:
 *
 * - The old helpers of `ui/lib/meals.ts` read the state; here they are in
 *   `src/systems/cooking/mealsView.ts` and take what they read:
 *   `eatButton(id, q, plan, meals, cooling)` with the plan of `eatPlan`, the
 *   dishes of `activeMeals(meals slice, held statuses)` and the cooldown of
 *   `cooldownLeft`; `dishHeading(meals)`, `dishRows(meals)`;
 *   `queuedRow(queued, recovering, fight)`.
 * - The game is a kernel. The Cages hunt is the command
 *   `world/select-activity`; `respawnTimer` and the stock are patched;
 *   `abandonCombat` is the request `combat/abandon`; `state.activity = null`
 *   is the command `world/select-activity` with no activity.
 * - `g.eat(id, q)` is the command `cooking/eat`; `g.step(n)` is
 *   `kernel.tick(n)`.
 * - The old `state.recovering = true` is the world's `recovering` and the
 *   statuses' `down`, patched together (one flag in the old state).
 * - `state.meals` is the `meals` slice's `slots`, patched.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { abandon } from '../src/systems/combat';
import { cooldownLeft, type ConsumablesState } from '../src/systems/consumables';
import {
  dishHeading,
  dishRows,
  eat,
  eatButton,
  eatPlan,
  queuedRow,
  timeLeftText,
  type CookingState,
} from '../src/systems/cooking';
import type { MaterialsState, QualityTier } from '../src/systems/materials';
import { activeMeals, type MealsState } from '../src/systems/meals';
import { heldOf, type StatusesState } from '../src/systems/statuses';
import { selectActivity, type WorldState } from '../src/systems/world';
import { combatOf } from './combatHelpers';
import { ask, patch, reads, slice } from './helpers';
import { gameAt } from './worldHelpers';

/** Add units of a graded material. The old `grantGraded(state, id, q, n)`. */
function grantGraded(g: Kernel, id: string, q: QualityTier, n: number) {
  patch(g, (slices) => {
    const m = slices.materials as MaterialsState;
    m.stock[id] ??= {};
    m.stock[id][q] = (m.stock[id][q] ?? 0) + n;
  });
}

/** In the Cages with the fight on, every dish stocked. */
function fighting() {
  const g = gameAt(3, 'the_cages');
  expect(g.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);
  patch(g, (slices) => (slices.combat.respawnTimer = 0));
  g.tick();
  expect(combatOf(g).fight).not.toBeNull();
  for (const id of ['hearty_stew', 'mushroom_broth', 'steeped_broth', 'skewered_fish', 'seared_stew', 'healing_salve']) {
    grantGraded(g, id, 'c', 3);
  }
  return g;
}

const idle = (g: Kernel) => {
  ask(g, abandon, undefined);
  g.dispatch(selectActivity({ activity: null }));
};

/** The old `state.recovering = true`. */
const knockOut = (g: Kernel) =>
  patch(g, (slices) => {
    (slices.world as WorldState).recovering = true;
    (slices.statuses as StatusesState).down = true;
  });

const meals = (g: Kernel) => activeMeals(slice<MealsState>(g, 'meals'), heldOf(slice<StatusesState>(g, 'statuses'), PLAYER));
const button = (g: Kernel, id: string, quality: QualityTier) =>
  eatButton(
    id,
    quality,
    eatPlan({ ...reads(g), tick: g.tickCount }, id, quality),
    meals(g),
    cooldownLeft(slice<ConsumablesState>(g, 'consumables'), id, g.tickCount),
  );
const rows = (g: Kernel) => dishRows(meals(g));
const heading = (g: Kernel) => dishHeading(meals(g));
const queued = (g: Kernel) =>
  queuedRow(slice<CookingState>(g, 'cooking').queued, slice<WorldState>(g, 'world').recovering, combatOf(g).fight !== null);
const eatIt = (g: Kernel, id: string, quality: QualityTier) => g.dispatch(eat({ id, quality }));

describe('the Eat button words', () => {
  it('reads Eat out of a fight, and Drink for a dish that is drunk', () => {
    const g = fighting();
    idle(g);
    expect(button(g, 'hearty_stew', 'c')).toMatchObject({ label: 'Eat', disabled: false, cancels: false, tip: [] });
    expect(button(g, 'mushroom_broth', 'c').label).toBe('Drink');
  });

  it('reads "Eat after this fight" in a fight, with a tooltip that says what happens', () => {
    const g = fighting();
    const b = button(g, 'hearty_stew', 'c');
    expect(b.label).toBe('Eat after this fight');
    expect(b.disabled).toBe(false);
    expect(b.tip.join(' ')).toContain('eaten the moment the fight ends');
    expect(button(g, 'mushroom_broth', 'c').label).toBe('Drink after this fight');
  });

  it('turns into a cancel once that dish is the queued one', () => {
    const g = fighting();
    eatIt(g, 'hearty_stew', 'c');
    expect(button(g, 'hearty_stew', 'c')).toMatchObject({ label: 'Queued: cancel', cancels: true });
    // Another dish still queues, in its place.
    expect(button(g, 'skewered_fish', 'c')).toMatchObject({ label: 'Eat after this fight', cancels: false });
  });

  it('leaves a salve alone: its own verb, in a fight or out', () => {
    const g = fighting();
    expect(button(g, 'healing_salve', 'c')).toMatchObject({ label: 'Applied', disabled: false });
    idle(g);
    expect(button(g, 'healing_salve', 'c').label).toBe('Applied');
  });

  it('is disabled with a reason when nothing is held', () => {
    const g = fighting();
    const b = button(g, 'berry_pie', 'c');
    expect(b.disabled).toBe(true);
    expect(b.tip).toEqual(['None held']);
  });

  it('says which dish a fourth one replaces, in the tooltip and in a line under the buttons', () => {
    const g = fighting();
    idle(g);
    for (const id of ['mushroom_broth', 'steeped_broth', 'skewered_fish']) {
      eatIt(g, id, 'c');
      g.tick(200);
    }
    const b = button(g, 'seared_stew', 'c');
    expect(b.replaces).toMatch(/^Replaces Fair Mushroom Broth \(\d+m \d+s left\)$/);
    expect(b.tip.join(' ')).toContain('At most 3 dishes can be active at once');
    // A dish already in a slot is renewed, and says so.
    const again = button(g, 'steeped_broth', 'c');
    expect(again.replaces).toBeNull();
    expect(again.tip.join(' ')).toContain('eating it again renews its time');
  });
});

describe('the Eat button for a worse grade of an active dish', () => {
  it('says the better grade stays, and a worse one takes over when it runs out', () => {
    const g = fighting();
    idle(g);
    grantGraded(g, 'hearty_stew', 'b', 2);
    grantGraded(g, 'hearty_stew', 'd', 1);
    eatIt(g, 'hearty_stew', 'b');
    expect(button(g, 'hearty_stew', 'd').tip.join(' ')).toMatch(
      /Already active as Fine \(\d+m \d+s left\): a worse grade takes over when that one runs out\./,
    );
    expect(button(g, 'hearty_stew', 'b').tip.join(' ')).toContain('eating it again renews its time');
    eatIt(g, 'hearty_stew', 'd');
    const list = rows(g);
    expect(list).toHaveLength(1);
    // The label is the grade in effect; one line per condition, with the longest time on it.
    expect(list[0].name).toBe('Fine Hearty Stew');
    expect(list[0].conditions).toHaveLength(1);
  });
});

describe('the Eat button while knocked out', () => {
  it('reads "Eat after recovering", says why in its tooltip, and cancels once queued', () => {
    const g = fighting();
    idle(g);
    knockOut(g);
    const b = button(g, 'hearty_stew', 'c');
    expect(b.label).toBe('Eat after recovering');
    expect(b.disabled).toBe(false);
    expect(b.tip.join(' ')).toContain('knocked out');
    expect(button(g, 'mushroom_broth', 'c').label).toBe('Drink after recovering');
    eatIt(g, 'hearty_stew', 'c');
    expect(button(g, 'hearty_stew', 'c')).toMatchObject({ label: 'Queued: cancel', cancels: true });
    expect(queued(g)).toMatchObject({ label: 'After recovering:', name: 'Fair Hearty Stew' });
  });

  it('the queued line says fight while a fight is on', () => {
    const g = fighting();
    eatIt(g, 'hearty_stew', 'c');
    expect(queued(g)!.label).toBe('After this fight:');
  });
});

describe('the dish list', () => {
  it('counts the slots and lists each dish with its time left, oldest first', () => {
    const g = fighting();
    idle(g);
    expect(rows(g)).toEqual([]);
    eatIt(g, 'mushroom_broth', 'c');
    g.tick(300);
    eatIt(g, 'hearty_stew', 'c');
    expect(heading(g)).toBe('Dishes 2/3');
    const list = rows(g);
    expect(list.map((r) => r.dish)).toEqual(['mushroom_broth', 'hearty_stew']);
    expect(list[0]).toMatchObject({ name: 'Fair Mushroom Broth', replacedFirst: false });
    expect(list[0].time).toMatch(/^\d+m \d+s$/);
    expect(list[1].conditions[0]).toContain('Well Fed');
  });

  it('marks the dish a new one would replace first, only when every slot is full', () => {
    const g = fighting();
    idle(g);
    for (const id of ['mushroom_broth', 'steeped_broth', 'skewered_fish']) {
      eatIt(g, id, 'c');
      g.tick(200);
    }
    const list = rows(g);
    expect(heading(g)).toBe('Dishes 3/3');
    expect(list.filter((r) => r.replacedFirst).map((r) => r.dish)).toEqual(['mushroom_broth']);
    // The least time left, not the first eaten, is what is marked.
    patch(g, (slices) => {
      (slices.meals as MealsState).slots.find((m) => m.dish === 'steeped_broth')!.claims[0].left = 5;
    });
    expect(rows(g).find((r) => r.replacedFirst)!.dish).toBe('steeped_broth');
    expect(rows(g).find((r) => r.dish === 'steeped_broth')!.conditions).toEqual(['🫖 Steeped: 1s']);
  });

  it('shows the queued dish, and nothing when none waits', () => {
    const g = fighting();
    expect(queued(g)).toBeNull();
    eatIt(g, 'hearty_stew', 'b');
    expect(queued(g)).toBeNull();
    eatIt(g, 'hearty_stew', 'c');
    expect(queued(g)).toMatchObject({ name: 'Fair Hearty Stew' });
  });

  it('reads a clockless condition as no time limit', () => {
    expect(timeLeftText(null)).toBe('no time limit');
    expect(timeLeftText(650)).toBe('1m 5s');
    // Rounded up to whole seconds: never "9m 60s", never zero with time left.
    expect(timeLeftText(5999)).toBe('10m 0s');
    expect(timeLeftText(5991)).toBe('10m 0s');
    expect(timeLeftText(5990)).toBe('9m 59s');
    expect(timeLeftText(1)).toBe('1s');
    expect(timeLeftText(0)).toBe('0s');
  });
});
