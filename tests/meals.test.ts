/**
 * Port of old `tests/meals.test.ts`: dishes out of combat, the eating queue
 * (after a fight, after a knockout), the dish slots and their claims.
 * Changed only where the call shape changed:
 *
 * - The game is a kernel. The Cages hunt is the command
 *   `world/select-activity`; `respawnTimer`, the stock, the counters and
 *   other slices are patched (`patch`, `setCounters`). `g.step(n)` is
 *   `kernel.tick(n)`. `abandonCombat` is the request `combat/abandon`;
 *   `state.activity = null` is the command `world/select-activity` with no
 *   activity. `g.setHuntRest(at, toFull)` is the command
 *   `combat/set-hunt-rest`.
 * - The old `state.recovering = true` is the world's `recovering` and the
 *   statuses' `down`, patched together (one flag in the old state). The old
 *   tick skipped combat while recovering; here combat ticks on, and a real
 *   knockout stops the hunt. "waits through a knockout recovery" stops the
 *   hunt loop (`combat/stop-hunt`) with its hand-made knockout, or the
 *   respawn clock runs out on the floor and a fight opens the tick the
 *   recovery ends.
 * - `canUse(state, id, q)` and `canUseOutOfFight` take reads and the
 *   consumables slice; `useConsumable(state, bus, id, q)` is the command
 *   `consumables/use` (non-null is `ok`); `eatPlan(state, id, q)` is
 *   `eatPlan(reads, id, q)` of `cooking`, whose `replaces` is
 *   `{ dish, quality, ticksLeft }` (the old held the active meal:
 *   `replaces.slot.dish` is `replaces.dish`).
 * - `g.eat(id, q)` is the command `cooking/eat`. The old answer
 *   (`'queued'`, `'ate'`, `'refused'`) is read back: refused when the command
 *   is skipped, queued when that dish is the queued one after it, else ate.
 *   `g.cancelQueuedMeal()` is the command `cooking/cancel-meal`.
 * - `state.meals`, `state.foreignClaims` and `state.queuedMeal` are the
 *   `meals` slice's `slots` and `foreign` and the `cooking` slice's
 *   `queued`. `activeMeals(state)` and `mealToReplace(state, dish)` take
 *   the meals slice and the held statuses. `dishLimit()` takes nothing.
 * - `drink` brews through `alchemy/brew` and drinks with the command
 *   `alchemy/use-flask`; the old `useFlask` returned the brew, here it is
 *   `resolveBrew` of the flask before it is drunk. The old direct
 *   `useFlask(state, bus, 0)` ("not through Game: nothing told the slots")
 *   applies the brew's grants with the request `statuses/apply`, a change
 *   no one records.
 * - `applyStatus(state, state, app, source)` is the request
 *   `statuses/apply`; `state.statuses.length = 0` is `statuses/clear`.
 * - `tickMealClaims(state, rate)` has no call of its own: the meals tick runs
 *   the clock rate `cooking`'s tick states. Rate 0 is a tick on a journey
 *   (one hop to the Ironyard Gate), rate 5 a tick knocked out.
 * - "the per-tick bookkeeping writes nothing": the arrays are read live
 *   from inside a system context (`run`), as the snapshot is a copy.
 * - "is part of the save, and a reload keeps the order to eat": a fight is
 *   saved here (combat README), where the old save dropped it. The loaded
 *   game has the fight; the case abandons it, then ticks.
 * - "save v59": the save here starts at version 1 and has no importer. The
 *   version and migration cases are `it.todo`. "keeps a food condition that
 *   was already running" applies the condition with no slot instead of
 *   loading a v58 save. The round trip uses `kernel.save` and `kernel.load`;
 *   the prestige is the command `prestige/now` after the floor counters are
 *   set (the old `clearFloors`).
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { brewRequest, resolveBrew, useFlask, type AlchemyState } from '../src/systems/alchemy';
import { abandon, setHuntRest, stopHuntLoop } from '../src/systems/combat';
import { canUse, canUseOutOfFight, useConsumable, type ConsumablesState } from '../src/systems/consumables';
import { cancelMeal, cookedKey, eat, eatPlan, type CookingState } from '../src/systems/cooking';
import { FLOORS } from '../src/systems/ladder';
import { QUALITY_TIERS, type MaterialsState, type QualityTier } from '../src/systems/materials';
import meals, { activeMeals, dishLimit, MAX_ACTIVE_DISHES, mealToReplace, type MealsState } from '../src/systems/meals';
import { prestigeNow } from '../src/systems/prestige';
import { statBlockOf } from '../src/systems/stats';
import { applyStatus, clearStatuses, heldOf, STATUSES, type StatusApplication, type StatusesState } from '../src/systems/statuses';
import { selectActivity, type WorldState } from '../src/systems/world';
import { combatOf, logOf, setHp } from './combatHelpers';
import { ask, makeGame, patch, reads, run, slice } from './helpers';
import { gameAt, hop, setCounters, worldOf } from './worldHelpers';

/** A hunt in the Cages, between fights, with a stocked table. */
function hunting(seed = 3) {
  const g = gameAt(seed, 'the_cages');
  expect(g.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);
  patch(g, (slices) => (slices.combat.respawnTimer = 0));
  return g;
}

/** Hunting, with the fight already on. */
function fighting(seed = 3) {
  const g = hunting(seed);
  g.tick();
  expect(combatOf(g).fight).not.toBeNull();
  return g;
}

/** Add units of a graded material. The old `grantGraded(state, id, q, n)`. */
function grantGraded(g: Kernel, id: string, q: QualityTier, n: number) {
  patch(g, (slices) => {
    const m = slices.materials as MaterialsState;
    m.stock[id] ??= {};
    m.stock[id][q] = (m.stock[id][q] ?? 0) + n;
  });
}

const stock = (g: Kernel, ...ids: string[]) => {
  patch(g, (slices) => {
    const m = slices.materials as MaterialsState;
    for (const id of ids) {
      m.stock[id] ??= {};
      m.stock[id].c = (m.stock[id].c ?? 0) + 5;
    }
  });
};
const stockOf = (g: Kernel, id: string) => slice<MaterialsState>(g, 'materials').stock[id];
const logLines = (g: Kernel) => logOf(g);
const heldList = (g: Kernel) => heldOf(slice<StatusesState>(g, 'statuses'), PLAYER);
const held = (g: Kernel, id: string) => heldList(g).find((s) => s.id === id);
const hasStatus = (g: Kernel, id: string) => !!held(g, id);
const mealsOf = (g: Kernel) => slice<MealsState>(g, 'meals');
const active = (g: Kernel) => activeMeals(mealsOf(g), heldList(g));
const slots = (g: Kernel) => active(g).map((m) => m.slot.dish);
const queuedOf = (g: Kernel) => slice<CookingState>(g, 'cooking').queued;
const rd = (g: Kernel) => ({ ...reads(g), tick: g.tickCount });
const cons = (g: Kernel) => slice<ConsumablesState>(g, 'consumables');
const can = (g: Kernel, id: string, q: QualityTier) => canUse(rd(g), cons(g), id, q);
const plan = (g: Kernel, id: string, q: QualityTier) => eatPlan(rd(g), id, q);
const toReplace = (g: Kernel, dish: string) => mealToReplace(mealsOf(g), heldList(g), dish);
const use = (g: Kernel, id: string, quality: QualityTier) => g.dispatch(useConsumable({ id, quality })).ok;
const maxHp = (g: Kernel) => statBlockOf(reads(g)).maxHp;
const abandonCombat = (g: Kernel) => ask(g, abandon, undefined);
const setQueued = (g: Kernel, q: CookingState['queued']) => patch(g, (slices) => ((slices.cooking as CookingState).queued = q));

/** The old `Game.eat`: what pressing Eat did. */
function eatIt(g: Kernel, id: string, quality: QualityTier): 'queued' | 'ate' | 'refused' {
  if (!g.dispatch(eat({ id, quality })).ok) return 'refused';
  const q = queuedOf(g);
  return q && q.dish === id && q.quality === quality ? 'queued' : 'ate';
}
const cancelQueuedMeal = (g: Kernel) => g.dispatch(cancelMeal()).ok;

/** The old `state.recovering = true`. */
const knockOut = (g: Kernel) =>
  patch(g, (slices) => {
    (slices.world as WorldState).recovering = true;
    (slices.statuses as StatusesState).down = true;
  });
const recovering = (g: Kernel) => worldOf(g).recovering;

/** Four dishes that share no condition, so only the slot limit is under test. */
const FOUR = ['mushroom_broth', 'steeped_broth', 'skewered_fish', 'seared_stew'];

describe('dishes are eaten out of combat', () => {
  it('canUse refuses a dish while a fight is on, and nothing is spent', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    const check = can(g, 'hearty_stew', 'c');
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('Not during a fight.');
    expect(use(g, 'hearty_stew', 'c')).toBe(false);
    expect(stockOf(g, 'hearty_stew')!.c).toBe(5);
    expect(hasStatus(g, 'well_fed')).toBe(false);
  });

  it('a salve stays usable in a fight', () => {
    const g = fighting();
    grantGraded(g, 'healing_salve', 'c', 1);
    expect(can(g, 'healing_salve', 'c').ok).toBe(true);
    expect(use(g, 'healing_salve', 'c')).toBe(true);
  });

  it('a flask stays drinkable in a fight', () => {
    const g = fighting();
    expect(drink(g)).not.toBeNull();
    expect(hasStatus(g, 'well_fed')).toBe(true);
  });

  it('the same dish is allowed the moment the fight is over', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    abandonCombat(g);
    expect(combatOf(g).fight).toBeNull();
    expect(can(g, 'hearty_stew', 'c').ok).toBe(true);
  });

  it('the respawn gap between chained hunt fights has no fight in it', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    abandonCombat(g);
    expect(combatOf(g).respawnTimer).toBeGreaterThan(5);
    g.tick(3);
    expect(combatOf(g).fight).toBeNull();
    expect(combatOf(g).respawnTimer).toBeGreaterThan(0);
    expect(can(g, 'hearty_stew', 'c').ok).toBe(true);
    expect(use(g, 'hearty_stew', 'c')).toBe(true);
  });

  it('a hunt resting before its next fight has no fight in it', () => {
    const g = hunting();
    stock(g, 'hearty_stew');
    setHp(g, maxHp(g) * 0.2);
    g.dispatch(setHuntRest({ at: 0.5, toFull: true }));
    g.tick();
    expect(combatOf(g).fight).toBeNull();
    expect(combatOf(g).huntRest.active).toBe(true);
    expect(can(g, 'hearty_stew', 'c').ok).toBe(true);
  });

  it('canUseOutOfFight ignores the fight but not the stock', () => {
    const g = fighting();
    // The old `text('consumables.reason.none_held')`.
    expect(canUseOutOfFight(rd(g), cons(g), 'hearty_stew', 'c').reason).toBe('None held');
    stock(g, 'hearty_stew');
    expect(canUseOutOfFight(rd(g), cons(g), 'hearty_stew', 'c').ok).toBe(true);
  });
});

describe('eat after this fight', () => {
  it('pressing Eat in a fight queues the dish and spends nothing', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    expect(eatIt(g, 'hearty_stew', 'c')).toBe('queued');
    expect(queuedOf(g)).toEqual({ dish: 'hearty_stew', quality: 'c', why: 'fight' });
    expect(stockOf(g, 'hearty_stew')!.c).toBe(5);
    expect(hasStatus(g, 'well_fed')).toBe(false);
    expect(logLines(g).some((l) => l.includes('queued') && l.includes('Hearty Stew'))).toBe(true);
  });

  it('only a dish queues: a salve pressed in a fight is used at once', () => {
    const g = fighting();
    grantGraded(g, 'healing_salve', 'c', 1);
    expect(eatIt(g, 'healing_salve', 'c')).toBe('ate');
    expect(queuedOf(g)).toBeNull();
  });

  it('a dish pressed out of a fight is eaten at once', () => {
    const g = hunting();
    stock(g, 'hearty_stew');
    abandonCombat(g);
    expect(eatIt(g, 'hearty_stew', 'c')).toBe('ate');
    expect(queuedOf(g)).toBeNull();
    expect(hasStatus(g, 'well_fed')).toBe(true);
  });

  it('a dish you do not hold cannot be queued', () => {
    const g = fighting();
    expect(eatIt(g, 'hearty_stew', 'c')).toBe('refused');
    expect(queuedOf(g)).toBeNull();
  });

  it('pressing another dish replaces the pending one, and pressing the same one changes nothing', () => {
    const g = fighting();
    stock(g, 'hearty_stew', 'mushroom_broth');
    eatIt(g, 'hearty_stew', 'c');
    const lines = logLines(g).length;
    eatIt(g, 'hearty_stew', 'c');
    expect(logLines(g)).toHaveLength(lines);
    eatIt(g, 'mushroom_broth', 'c');
    expect(queuedOf(g)).toEqual({ dish: 'mushroom_broth', quality: 'c', why: 'fight' });
    expect(logLines(g).at(-1)).toContain('in place of Fair Hearty Stew');
    // A different grade of the same dish is a different pending dish too.
    grantGraded(g, 'mushroom_broth', 'b', 1);
    eatIt(g, 'mushroom_broth', 'b');
    expect(queuedOf(g)).toEqual({ dish: 'mushroom_broth', quality: 'b', why: 'fight' });
  });

  it('can be cancelled', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    eatIt(g, 'hearty_stew', 'c');
    expect(cancelQueuedMeal(g)).toBe(true);
    expect(queuedOf(g)).toBeNull();
    expect(cancelQueuedMeal(g)).toBe(false);
    abandonCombat(g);
    g.tick();
    expect(hasStatus(g, 'well_fed')).toBe(false);
    expect(stockOf(g, 'hearty_stew')!.c).toBe(5);
  });

  it('stays queued for as long as the fight lasts', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    eatIt(g, 'hearty_stew', 'c');
    let inFight = 0;
    for (let i = 0; i < 20 && combatOf(g).fight; i++) {
      g.tick();
      if (combatOf(g).fight) {
        inFight += 1;
        expect(queuedOf(g)).not.toBeNull();
        expect(hasStatus(g, 'well_fed')).toBe(false);
      }
    }
    expect(inFight).toBeGreaterThan(3);
  });

  it('is eaten on the first tick with no fight, and says it was queued', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    eatIt(g, 'hearty_stew', 'c');
    abandonCombat(g);
    g.tick();
    expect(queuedOf(g)).toBeNull();
    expect(hasStatus(g, 'well_fed')).toBe(true);
    expect(stockOf(g, 'hearty_stew')!.c).toBe(4);
    expect(logLines(g)).toContain(`🍲 Ate ${QUALITY_TIERS.c.name} Hearty Stew (queued during the fight).`);
    expect(slots(g)).toEqual(['hearty_stew']);
  });

  it('a Signature rides along, and the line names it', () => {
    const g = fighting();
    setCounters(g, { [cookedKey('hearty_stew')]: 100 });
    stock(g, 'hearty_stew');
    eatIt(g, 'hearty_stew', 'c');
    abandonCombat(g);
    g.tick();
    expect(logLines(g).at(-1)).toMatch(/\(queued during the fight\)\. Signature: also Stoked/);
  });

  it('waits through a knockout recovery, then eats the tick recovery ends', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    eatIt(g, 'hearty_stew', 'c');
    // The fight ends with the player on the floor.
    abandonCombat(g);
    // The old tick skipped combat while recovering, so no encounter was rolled
    // until a tick after the recovery. Here combat ticks on; the knockout of
    // this build stops the hunt, so the hand-made knockout stops it too.
    ask(g, stopHuntLoop, undefined);
    knockOut(g);
    setHp(g, 1);
    g.tick(30);
    expect(recovering(g)).toBe(true);
    expect(queuedOf(g)).not.toBeNull();
    expect(hasStatus(g, 'well_fed')).toBe(false);
    expect(stockOf(g, 'hearty_stew')!.c).toBe(5);
    // Back on their feet: the dish is eaten on the first tick that opens with
    // no recovery, at its full length (it did not burn down on the floor).
    setHp(g, maxHp(g));
    g.tick();
    expect(recovering(g)).toBe(false);
    expect(queuedOf(g)).not.toBeNull();
    g.tick();
    expect(queuedOf(g)).toBeNull();
    expect(held(g, 'well_fed')!.ticksLeft).toBeGreaterThanOrEqual(STATUSES.well_fed.duration! - 1);
  });

  it('survives an actual knockout: queued in the fight, eaten after the recovery', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    eatIt(g, 'hearty_stew', 'c');
    setHp(g, 0);
    let downed = false;
    for (let i = 0; i < 400 && !downed; i++) {
      g.tick();
      if (recovering(g)) downed = true;
    }
    expect(downed).toBe(true);
    expect(queuedOf(g)).not.toBeNull();
    expect(hasStatus(g, 'well_fed')).toBe(false);
    for (let i = 0; i < 20000 && recovering(g); i++) g.tick();
    expect(recovering(g)).toBe(false);
    expect(queuedOf(g)).not.toBeNull();
    g.tick();
    expect(queuedOf(g)).toBeNull();
    expect(hasStatus(g, 'well_fed')).toBe(true);
  });

  it('checks the stock again when it fires, drops the queue and says why', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    eatIt(g, 'hearty_stew', 'c');
    patch(g, (slices) => delete (slices.materials as MaterialsState).stock.hearty_stew);
    abandonCombat(g);
    g.tick();
    expect(queuedOf(g)).toBeNull();
    expect(hasStatus(g, 'well_fed')).toBe(false);
    expect(logLines(g).at(-1)).toContain('not eaten: None held');
  });

  it('is part of the save, and a reload keeps the order to eat', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    eatIt(g, 'hearty_stew', 'c');
    const g2 = makeGame({ seed: 3 });
    expect(g2.load(g.save(0)).ok).toBe(true);
    expect(queuedOf(g2)).toEqual({ dish: 'hearty_stew', quality: 'c', why: 'fight' });
    // The old save dropped the fight; this one keeps it, so the fight is ended here.
    abandonCombat(g2);
    expect(combatOf(g2).fight).toBeNull();
    g2.tick();
    expect(queuedOf(g2)).toBeNull();
    expect(hasStatus(g2, 'well_fed')).toBe(true);
  });

  it('the plan names what the button will do', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    expect(plan(g, 'hearty_stew', 'c')).toMatchObject({ mode: 'queue', queued: false });
    eatIt(g, 'hearty_stew', 'c');
    expect(plan(g, 'hearty_stew', 'c')).toMatchObject({ mode: 'queue', queued: true });
    expect(plan(g, 'mushroom_broth', 'c')).toMatchObject({ mode: 'blocked', reason: 'None held' });
    abandonCombat(g);
    expect(plan(g, 'hearty_stew', 'c').mode).toBe('eat');
  });
});

/** A Cages hunt with the fight over and nothing left to start one: time moves only when a test steps it. */
function idle(seed = 3) {
  const g = hunting(seed);
  abandonCombat(g);
  g.dispatch(selectActivity({ activity: null }));
  return g;
}

/** The time a dish in a slot has left, on its own clocks. */
const own = (g: Kernel, dish: string): number | null | undefined => active(g).find((m) => m.slot.dish === dish)?.ticksLeft;

/** A dish's own claim on a condition. */
const claim = (g: Kernel, dish: string, id: string) => mealsOf(g).slots.find((m) => m.dish === dish)?.claims.find((c) => c.id === id);

/**
 * Cut a dish's own clock on a condition to `ticks`, and the condition's with it
 * (it is that dish's claim that leads), so a test need not wait out minutes to make
 * one dish the shortest. Only for a dish that leads its condition.
 */
function shorten(g: Kernel, dish: string, id: string, ticks: number) {
  patch(g, (slices) => {
    (slices.meals as MealsState).slots.find((m) => m.dish === dish)!.claims.find((c) => c.id === id)!.left = ticks;
    (slices.statuses as StatusesState).held[PLAYER].find((s) => s.id === id)!.ticksLeft = ticks;
  });
}

/** Brew a Mendroot elixir, the flask at index 0. */
function brewElixir(g: Kernel, quality: QualityTier) {
  grantGraded(g, 'spring_water', quality, 1);
  grantGraded(g, 'mendroot', quality, 1);
  patch(g, (slices) => (slices.skills.skills.alchemy = { level: 40, xp: 0 }));
  ask(g, brewRequest, { placement: { step1: { id: 'spring_water', quality }, step2: { id: 'mendroot', quality } } });
  return resolveBrew(slice<AlchemyState>(g, 'alchemy').flasks[0]);
}

/** Drink a Mendroot elixir through the game (Fair: Well Fed x0.65 for 450; Divine: x2.6 for 450). */
function drink(g: Kernel, quality: QualityTier = 'c') {
  const spec = brewElixir(g, quality);
  return g.dispatch(useFlask({ index: 0 })).ok ? spec : null;
}

describe('eat after recovering', () => {
  /** Knocked out, no fight on, a stew in the pack. */
  function floored() {
    const g = idle();
    stock(g, 'hearty_stew', 'healing_salve');
    knockOut(g);
    setHp(g, 1);
    return g;
  }

  it('a dish pressed while knocked out waits, and spends nothing', () => {
    const g = floored();
    expect(plan(g, 'hearty_stew', 'c')).toMatchObject({ mode: 'queue', wait: 'recovery' });
    expect(eatIt(g, 'hearty_stew', 'c')).toBe('queued');
    expect(queuedOf(g)).toEqual({ dish: 'hearty_stew', quality: 'c', why: 'recovery' });
    expect(stockOf(g, 'hearty_stew')!.c).toBe(5);
    expect(hasStatus(g, 'well_fed')).toBe(false);
    expect(logLines(g).at(-1)).toContain('it is eaten when you are back on your feet');
  });

  it('is eaten the tick after the recovery ends, at full length, and says so', () => {
    const g = floored();
    eatIt(g, 'hearty_stew', 'c');
    g.tick(30);
    expect(recovering(g)).toBe(true);
    expect(queuedOf(g)).not.toBeNull();
    expect(slots(g)).toEqual([]);
    setHp(g, maxHp(g));
    g.tick();
    expect(recovering(g)).toBe(false);
    g.tick();
    expect(queuedOf(g)).toBeNull();
    expect(logLines(g)).toContain(`🍲 Ate ${QUALITY_TIERS.c.name} Hearty Stew (queued while knocked out).`);
    expect(own(g, 'hearty_stew')!).toBeGreaterThanOrEqual(STATUSES.well_fed.duration! - 1);
  });

  it('a salve is still used at once while knocked out', () => {
    const g = floored();
    expect(eatIt(g, 'healing_salve', 'c')).toBe('ate');
    expect(queuedOf(g)).toBeNull();
  });

  it('a dish queued in the fight keeps the fight wording when a knockout comes first', () => {
    const g = fighting();
    stock(g, 'hearty_stew');
    eatIt(g, 'hearty_stew', 'c');
    abandonCombat(g);
    knockOut(g);
    setHp(g, 1);
    g.tick(5);
    setHp(g, maxHp(g));
    g.tick(3);
    expect(logLines(g)).toContain(`🍲 Ate ${QUALITY_TIERS.c.name} Hearty Stew (queued during the fight).`);
  });
});

describe('at most three dishes active', () => {
  it('the limit is one constant behind one function', () => {
    expect(MAX_ACTIVE_DISHES).toBe(3);
    expect(dishLimit()).toBe(3);
  });

  it('a dish holds one slot with everything it gave, Signature included', () => {
    const g = idle();
    setCounters(g, { [cookedKey('hearty_stew')]: 100 });
    stock(g, 'hearty_stew');
    use(g, 'hearty_stew', 'c');
    const list = active(g);
    expect(list).toHaveLength(1);
    expect(list[0].slot.claims.map((c) => c.id).sort()).toEqual(['stoked', 'well_fed']);
    expect(list[0].ticksLeft).toBe(STATUSES.well_fed.duration);
    expect(claim(g, 'hearty_stew', 'stoked')!.left).toBe(STATUSES.stoked.duration);
  });

  it('eating a dish that is already active renews its slot instead of taking another', () => {
    const g = idle();
    stock(g, 'hearty_stew', 'mushroom_broth');
    use(g, 'hearty_stew', 'c');
    use(g, 'mushroom_broth', 'c');
    g.tick(2000);
    expect(own(g, 'hearty_stew')!).toBeLessThan(STATUSES.well_fed.duration! - 1500);
    use(g, 'hearty_stew', 'c');
    expect(slots(g)).toEqual(['mushroom_broth', 'hearty_stew']);
    expect(own(g, 'hearty_stew')).toBe(STATUSES.well_fed.duration);
    expect(held(g, 'well_fed')!.ticksLeft).toBe(STATUSES.well_fed.duration);
    expect(stockOf(g, 'hearty_stew')!.c).toBe(3);
  });

  it('a second helping at a worse grade keeps the better grade on the slot', () => {
    const g = idle();
    grantGraded(g, 'hearty_stew', 'b', 1);
    grantGraded(g, 'hearty_stew', 'd', 1);
    use(g, 'hearty_stew', 'b');
    use(g, 'hearty_stew', 'd');
    expect(active(g)).toHaveLength(1);
    expect(active(g)[0].slot.quality).toBe('b');
  });

  it('the fourth different dish replaces the one with the least time left, and its conditions end', () => {
    const g = idle();
    stock(g, ...FOUR);
    const [a, b, c, d] = FOUR;
    use(g, a, 'c'); // clear_headed, 4800
    g.tick(300);
    use(g, b, 'c'); // steeped, 6000
    g.tick(300);
    use(g, c, 'c'); // steady_hand, 4800
    expect(slots(g)).toEqual([a, b, c]);
    // a has run 600 ticks, c none: a has the least left.
    expect(own(g, a)!).toBeLessThan(own(g, c)!);
    expect(own(g, a)!).toBeLessThan(own(g, b)!);
    expect(toReplace(g, d)!.slot.dish).toBe(a);
    use(g, d, 'c');
    expect(slots(g)).toEqual([b, c, d]);
    expect(hasStatus(g, 'clear_headed')).toBe(false);
    expect(hasStatus(g, 'steeped')).toBe(true);
    expect(hasStatus(g, 'steady_hand')).toBe(true);
    expect(hasStatus(g, 'stoked')).toBe(true);
    expect(logLines(g).at(-1)).toContain(
      'Fair Mushroom Broth dropped for Fair Seared Stew: at most 3 dishes can be active. Ended: Clear-Headed.',
    );
    // The stock of the replaced dish is spent, not returned.
    expect(stockOf(g, a)!.c).toBe(4);
  });

  it('a replaced dish stops giving its stats at once (the derived cache sees it)', () => {
    const g = idle();
    stock(g, 'hearty_stew', 'mushroom_broth', 'steeped_broth', 'skewered_fish');
    use(g, 'hearty_stew', 'c');
    const fed = maxHp(g);
    g.tick(5950); // the stew has 50 ticks left
    use(g, 'mushroom_broth', 'c');
    use(g, 'steeped_broth', 'c');
    use(g, 'skewered_fish', 'c');
    expect(slots(g)).toEqual(['mushroom_broth', 'steeped_broth', 'skewered_fish']);
    expect(hasStatus(g, 'well_fed')).toBe(false);
    expect(maxHp(g)).toBe(fed - 8);
  });

  it('equal time goes to the dish eaten first', () => {
    const g = idle();
    stock(g, ...FOUR);
    // Broth and fish both run 4800 and were eaten on the same tick; the broth was first.
    for (const id of FOUR.slice(0, 3)) use(g, id, 'c');
    expect(own(g, FOUR[0])).toBe(own(g, FOUR[2]));
    use(g, FOUR[3], 'c');
    expect(slots(g)).toEqual([FOUR[1], FOUR[2], FOUR[3]]);
  });

  it('a slot frees when its dish runs out, so the next dish replaces nobody', () => {
    const g = idle();
    stock(g, 'seared_stew', 'steeped_broth', 'skewered_fish', 'mushroom_broth');
    for (const id of ['seared_stew', 'steeped_broth', 'skewered_fish']) use(g, id, 'c');
    g.tick(STATUSES.stoked.duration! + 1); // the stew's Stoked, 3000, runs out first
    expect(hasStatus(g, 'stoked')).toBe(false);
    expect(slots(g)).toEqual(['steeped_broth', 'skewered_fish']);
    expect(mealsOf(g).slots.map((s) => s.dish)).toEqual(['steeped_broth', 'skewered_fish']);
    use(g, 'mushroom_broth', 'c');
    expect(slots(g)).toEqual(['steeped_broth', 'skewered_fish', 'mushroom_broth']);
    expect(hasStatus(g, 'steeped')).toBe(true);
    expect(hasStatus(g, 'steady_hand')).toBe(true);
    expect(logLines(g).filter((l) => l.includes('dropped for'))).toHaveLength(0);
  });

  it('a dish whose conditions are cleared another way frees its slot too', () => {
    const g = idle();
    stock(g, 'hearty_stew');
    use(g, 'hearty_stew', 'c');
    ask(g, clearStatuses, { entity: PLAYER });
    expect(active(g)).toHaveLength(0);
    g.tick();
    expect(mealsOf(g).slots).toHaveLength(0);
  });

  it('a dish that gave nothing nourishing holds no slot and evicts nobody', () => {
    const g = idle();
    stock(g, ...FOUR.slice(0, 3), 'scorched_mess');
    for (const id of FOUR.slice(0, 3)) use(g, id, 'c');
    expect(plan(g, 'scorched_mess', 'c').replaces).toBeUndefined();
    use(g, 'scorched_mess', 'c');
    expect(hasStatus(g, 'queasy')).toBe(true);
    expect(slots(g)).toEqual(FOUR.slice(0, 3));
  });

  it('a spoiled helping of a real dish holds no slot either', () => {
    const g = idle();
    stock(g, ...FOUR.slice(0, 3));
    grantGraded(g, 'hearty_stew', 'f', 1);
    for (const id of FOUR.slice(0, 3)) use(g, id, 'c');
    expect(plan(g, 'hearty_stew', 'f').replaces).toBeUndefined();
    use(g, 'hearty_stew', 'f');
    expect(slots(g)).toEqual(FOUR.slice(0, 3));
  });

  it('a food condition already running (an old save) holds no slot and counts toward nothing', () => {
    const g = idle();
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'well_fed', intensity: 1 }, source: 'Old Stew' });
    stock(g, ...FOUR.slice(0, 3));
    for (const id of FOUR.slice(0, 3)) use(g, id, 'c');
    expect(slots(g)).toEqual(FOUR.slice(0, 3));
    expect(hasStatus(g, 'well_fed')).toBe(true);
  });

  it('the plan tells the fourth dish which one it replaces, and an active dish that it renews', () => {
    const g = idle();
    stock(g, ...FOUR);
    for (const id of FOUR.slice(0, 3)) {
      use(g, id, 'c');
      g.tick(100);
    }
    expect(plan(g, FOUR[3], 'c').replaces!.dish).toBe(FOUR[0]);
    expect(plan(g, FOUR[1], 'c').replaces).toBeUndefined();
    // The first dish runs out (4800, eaten 300 ticks ago): a free slot replaces nobody.
    g.tick(4500);
    expect(slots(g)).not.toContain(FOUR[0]);
    expect(plan(g, FOUR[3], 'c').replaces).toBeUndefined();
  });

  it('a queued fourth dish replaces by the time left when it is eaten, not when it was queued', () => {
    const g = idle();
    stock(g, ...FOUR);
    use(g, 'steeped_broth', 'c'); // 6000
    g.tick(5000); // 1000 left: the shortest once the others are eaten
    use(g, 'mushroom_broth', 'c');
    use(g, 'skewered_fish', 'c');
    setQueued(g, { dish: 'seared_stew', quality: 'c', why: 'fight' });
    g.tick();
    expect(slots(g)).toEqual(['mushroom_broth', 'skewered_fish', 'seared_stew']);
  });
});

describe('claims: every dose has a clock of its own', () => {
  it('the dish the screen named is the dish that goes, even when the new dose raises its condition', () => {
    const g = idle();
    stock(g, 'hearty_stew', 'mushroom_broth', 'steeped_broth');
    grantGraded(g, 'berry_pie', 'b', 1);
    use(g, 'hearty_stew', 'c');
    g.tick(5950); // the stew has 5 seconds left
    use(g, 'mushroom_broth', 'c'); // 4800
    use(g, 'steeped_broth', 'c');
    const p = plan(g, 'berry_pie', 'b');
    expect(p.replaces!.dish).toBe('hearty_stew');
    expect(p.replaces!.ticksLeft!).toBeLessThanOrEqual(50);
    use(g, 'berry_pie', 'b'); // a Fine pie: Well Fed x1.6
    expect(slots(g)).toEqual(['mushroom_broth', 'steeped_broth', 'berry_pie']);
    expect(logLines(g).filter((l) => l.includes('dropped for')).at(-1)).toContain('Fair Hearty Stew dropped for Fine Berry Pie');
    // The broth is untouched, and Well Fed is the pie's, at the pie's own time.
    expect(own(g, 'mushroom_broth')!).toBeGreaterThan(4700);
    expect(hasStatus(g, 'clear_headed')).toBe(true);
    const pie = claim(g, 'berry_pie', 'well_fed')!;
    expect(pie.dose).toBeGreaterThan(1);
    expect(held(g, 'well_fed')!.intensity).toBe(pie.dose);
    expect(held(g, 'well_fed')!.ticksLeft).toBe(pie.left);
    expect(own(g, 'berry_pie')).toBe(pie.left);
  });

  it('re-eating a dish never extends a stronger dose another source made', () => {
    const g = idle();
    stock(g, 'hearty_stew');
    use(g, 'hearty_stew', 'c');
    const spec = drink(g, 's')!; // Divine: Well Fed x2.6 for 450
    const dose = spec.grants[0].intensity!;
    const span = spec.grants[0].duration as number;
    expect(held(g, 'well_fed')!.intensity).toBe(dose);
    use(g, 'hearty_stew', 'c');
    // The flask is still the strength, and still only for its own 450 ticks.
    expect(held(g, 'well_fed')!.intensity).toBe(dose);
    expect(held(g, 'well_fed')!.ticksLeft!).toBeLessThanOrEqual(span);
    // The stew's own clock is renewed in full, though.
    expect(own(g, 'hearty_stew')).toBe(STATUSES.well_fed.duration);
    // Tick by tick: the flask's strength never outlasts the flask.
    let flaskTicks = 0;
    for (let i = 0; i < span + 20; i++) {
      g.tick();
      if (held(g, 'well_fed')!.intensity === dose) flaskTicks += 1;
    }
    expect(flaskTicks).toBeLessThanOrEqual(span);
    expect(held(g, 'well_fed')!.intensity).toBe(1);
    expect(held(g, 'well_fed')!.ticksLeft!).toBeGreaterThan(STATUSES.well_fed.duration! - span - 40);
    // Handed over before it could expire: no "has passed" in between.
    expect(logLines(g).some((l) => l.includes('Well Fed has passed'))).toBe(false);
  });

  it('a flask claim lapses: the dish evicted after it does takes the condition with it', () => {
    const g = idle();
    stock(g, 'hearty_stew', ...FOUR.slice(0, 3));
    const spec = drink(g, 'c')!; // Fair: Well Fed x0.65 for 450
    const span = spec.grants[0].duration as number;
    use(g, 'hearty_stew', 'c');
    expect(mealsOf(g).foreign.map((c) => c.id)).toEqual(['well_fed']);
    g.tick(5700); // the flask ran out long ago; the stew has 300 left
    expect(span).toBeLessThan(5700);
    expect(mealsOf(g).foreign).toEqual([]);
    for (const id of FOUR.slice(0, 3)) use(g, id, 'c');
    // The stew had the least time left and went; nothing else gives Well Fed.
    expect(slots(g)).toEqual(FOUR.slice(0, 3));
    expect(hasStatus(g, 'well_fed')).toBe(false);
    expect(logLines(g).at(-1)).toContain('Ended: Well Fed.');
  });

  it("an old save's running condition lapses the same way", () => {
    const g = idle();
    stock(g, 'hearty_stew', ...FOUR.slice(0, 3));
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'well_fed', intensity: 0.65, duration: 450 }, source: 'Old Stew' });
    use(g, 'hearty_stew', 'c');
    expect(mealsOf(g).foreign).toEqual([{ id: 'well_fed', dose: 0.65, left: 450 }]);
    g.tick(5700);
    expect(mealsOf(g).foreign).toEqual([]);
    for (const id of FOUR.slice(0, 3)) use(g, id, 'c');
    expect(slots(g)).toEqual(FOUR.slice(0, 3));
    expect(hasStatus(g, 'well_fed')).toBe(false);
  });

  it("while the flask is live, the evicted dish leaves the flask's dose and its remaining time", () => {
    const g = idle();
    stock(g, 'hearty_stew', ...FOUR.slice(0, 3));
    use(g, 'hearty_stew', 'c');
    g.tick(5400); // the stew has 600 left
    const spec = drink(g, 'c')!; // Well Fed x0.65 for 450: weaker than the stew, so the condition ignores it
    const dose = spec.grants[0].intensity!;
    expect(held(g, 'well_fed')!.intensity).toBe(1);
    use(g, FOUR[0], 'c');
    use(g, FOUR[1], 'c');
    expect(toReplace(g, FOUR[2])!.slot.dish).toBe('hearty_stew');
    use(g, FOUR[2], 'c');
    expect(slots(g)).toEqual(FOUR.slice(0, 3));
    // The condition is now the flask's: its dose, its remaining time.
    expect(held(g, 'well_fed')!.intensity).toBe(dose);
    expect(held(g, 'well_fed')!.ticksLeft).toBe(mealsOf(g).foreign[0].left);
    expect(held(g, 'well_fed')!.ticksLeft!).toBeLessThanOrEqual(450);
    expect(logLines(g).at(-1)).toContain('Still given by another dish or source: Well Fed.');
    g.tick(460);
    expect(hasStatus(g, 'well_fed')).toBe(false);
  });

  it('evicting the stronger of two dishes drops the condition to the other dish, at its dose and time', () => {
    const g = idle();
    stock(g, 'hearty_stew', 'steeped_broth', 'mushroom_broth');
    grantGraded(g, 'berry_pie', 'b', 1);
    use(g, 'berry_pie', 'b'); // Well Fed x1.6, eaten first
    g.tick(100);
    use(g, 'hearty_stew', 'c'); // Well Fed x1: the pie still leads
    expect(held(g, 'well_fed')!.intensity).toBe(claim(g, 'berry_pie', 'well_fed')!.dose);
    g.tick(100);
    use(g, 'steeped_broth', 'c');
    // The pie has run 200 ticks, the stew 100, the steeped broth none: the pie has the least left.
    expect(toReplace(g, 'mushroom_broth')!.slot.dish).toBe('berry_pie');
    use(g, 'mushroom_broth', 'c');
    expect(slots(g)).toEqual(['hearty_stew', 'steeped_broth', 'mushroom_broth']);
    const stew = claim(g, 'hearty_stew', 'well_fed')!;
    expect(stew.dose).toBe(1);
    expect(held(g, 'well_fed')!.intensity).toBe(1);
    expect(held(g, 'well_fed')!.ticksLeft).toBe(stew.left);
    expect(own(g, 'hearty_stew')).toBe(stew.left);
    expect(logLines(g).at(-1)).toContain('Still given by another dish or source: Well Fed.');
  });

  it('evicting the weaker of two dishes leaves the stronger one as it was', () => {
    const g = idle();
    stock(g, 'hearty_stew', 'steeped_broth', 'mushroom_broth');
    grantGraded(g, 'berry_pie', 'b', 1);
    use(g, 'hearty_stew', 'c'); // eaten first: the least time left
    g.tick(100);
    use(g, 'berry_pie', 'b');
    const lead = { ...claim(g, 'berry_pie', 'well_fed')! };
    use(g, 'steeped_broth', 'c');
    use(g, 'mushroom_broth', 'c');
    expect(slots(g)).toEqual(['berry_pie', 'steeped_broth', 'mushroom_broth']);
    expect(held(g, 'well_fed')!.intensity).toBe(lead.dose);
    expect(held(g, 'well_fed')!.ticksLeft).toBe(own(g, 'berry_pie'));
  });

  it('two dishes of different grades: the first to go keeps it, the last to go ends it', () => {
    const g = idle();
    stock(g, 'hearty_stew', 'steeped_broth', 'mushroom_broth', 'skewered_fish');
    grantGraded(g, 'berry_pie', 'b', 2);
    use(g, 'hearty_stew', 'c');
    g.tick(50);
    use(g, 'berry_pie', 'b');
    use(g, 'steeped_broth', 'c');
    expect(held(g, 'well_fed')!.intensity).toBeGreaterThan(1);
    use(g, 'mushroom_broth', 'c'); // the stew goes first: the pie still gives it
    expect(slots(g)).toEqual(['berry_pie', 'steeped_broth', 'mushroom_broth']);
    expect(hasStatus(g, 'well_fed')).toBe(true);
    // Then the pie, with the least time left, goes: nothing is left giving it.
    shorten(g, 'berry_pie', 'well_fed', 10);
    use(g, 'skewered_fish', 'c');
    expect(slots(g)).toEqual(['steeped_broth', 'mushroom_broth', 'skewered_fish']);
    expect(hasStatus(g, 'well_fed')).toBe(false);
    expect(logLines(g).at(-1)).toContain('Ended: Well Fed.');
  });

  it('a flask used through alchemy directly is noticed by the tick and recorded as a claim', () => {
    const g = idle();
    stock(g, 'hearty_stew');
    use(g, 'hearty_stew', 'c');
    const spec = brewElixir(g, 's');
    // Not through the use-flask command: nothing told the slots.
    for (const app of spec.grants) ask(g, applyStatus, { entity: PLAYER, app: app as StatusApplication, source: spec.name });
    expect(held(g, 'well_fed')!.intensity).toBeGreaterThan(1);
    expect(mealsOf(g).foreign).toEqual([]);
    g.tick(1);
    expect(mealsOf(g).foreign).toHaveLength(1);
    expect(mealsOf(g).foreign[0].dose).toBeGreaterThan(1);
    expect(mealsOf(g).foreign[0].left!).toBeLessThanOrEqual(450);
    expect(held(g, 'well_fed')!.intensity).toBe(mealsOf(g).foreign[0].dose);
  });

  it('the slots keep time with the conditions, in a knockout and out of one, and invent no claims', () => {
    const g = idle();
    stock(g, 'hearty_stew', 'mushroom_broth', 'skewered_fish');
    for (const id of ['hearty_stew', 'mushroom_broth', 'skewered_fish']) use(g, id, 'c');
    const agree = () => {
      for (const m of active(g)) {
        for (const c of m.slot.claims) expect(held(g, c.id)!.ticksLeft).toBe(Math.max(...allClaimLefts(g, c.id)));
      }
    };
    g.tick(200);
    agree();
    // Knocked out, with the conditions running five times faster.
    const before = own(g, 'hearty_stew')!;
    for (let i = 0; i < 20; i++) {
      knockOut(g);
      setHp(g, 1);
      g.tick();
    }
    expect(before - own(g, 'hearty_stew')!).toBe(100);
    agree();
    setHp(g, maxHp(g));
    g.tick(50);
    expect(recovering(g)).toBe(false);
    agree();
    expect(mealsOf(g).foreign).toEqual([]);
    expect(active(g)).toHaveLength(3);
  });

  it('claims do not run while travelling', () => {
    const g = idle();
    stock(g, 'hearty_stew');
    use(g, 'hearty_stew', 'c');
    const before = own(g, 'hearty_stew')!;
    // The old `tickMealClaims(state, 0)`: a tick on a journey.
    expect(hop(g, 'ironyard_gate')).toBe(true);
    expect(worldOf(g).travel).not.toBeNull();
    g.tick();
    expect(own(g, 'hearty_stew')).toBe(before);
    // The old `tickMealClaims(state, 5)`: a tick knocked out.
    patch(g, (slices) => ((slices.world as WorldState).travel = null));
    knockOut(g);
    setHp(g, 1);
    g.tick();
    expect(own(g, 'hearty_stew')).toBe(before - 5);
  });

  it('claims are part of the save', () => {
    const g = idle();
    stock(g, 'hearty_stew');
    drink(g, 'c');
    use(g, 'hearty_stew', 'c');
    const loaded = makeGame({ seed: 3 });
    expect(loaded.load(g.save(0)).ok).toBe(true);
    expect(mealsOf(loaded).foreign).toEqual(mealsOf(g).foreign);
    expect(mealsOf(loaded).slots).toEqual(mealsOf(g).slots);
    expect(mealsOf(loaded).foreign).toHaveLength(1);
  });
});

describe('a dish that lands on the tick the leading claim lapses', () => {
  /** Stew eaten, then a Divine flask leads Well Fed (x2.6, 450): 449 ticks later it has 1 left. */
  function flaskOnItsLastTick() {
    const g = idle();
    stock(g, 'hearty_stew');
    grantGraded(g, 'berry_pie', 'c', 3);
    use(g, 'hearty_stew', 'c');
    drink(g, 's');
    g.tick(449);
    expect(mealsOf(g).foreign.map((c) => c.left)).toEqual([1]);
    return g;
  }

  const survives = (g: Kernel, dishes: string[]) => {
    expect(logLines(g).some((l) => l.includes('Well Fed has passed'))).toBe(false);
    expect(hasStatus(g, 'well_fed')).toBe(true);
    expect(slots(g)).toEqual(dishes);
    // The condition moved on to a claim that outlasts the tick, and is the stronger of them.
    expect(held(g, 'well_fed')!.ticksLeft!).toBeGreaterThan(1000);
    expect(mealsOf(g).foreign).toEqual([]);
  };

  it('a queued dish fired on that tick leaves the condition and every slot that claimed it', () => {
    const g = flaskOnItsLastTick();
    setQueued(g, { dish: 'berry_pie', quality: 'c', why: 'fight' });
    g.tick();
    expect(logLines(g)).toContain(`🥧 Ate ${QUALITY_TIERS.c.name} Berry Pie (queued during the fight).`);
    survives(g, ['hearty_stew', 'berry_pie']);
  });

  it('the same with dishes only: the leader is a dish whose clock runs out as the queued one lands', () => {
    const g = idle();
    stock(g, 'feast_platter', 'hearty_stew');
    grantGraded(g, 'berry_pie', 'c', 3);
    use(g, 'feast_platter', 'c'); // Well Fed x2, 6000
    g.tick(3000);
    use(g, 'hearty_stew', 'c'); // x1, 6000: the platter still leads
    expect(held(g, 'well_fed')!.intensity).toBe(2);
    g.tick(2999);
    expect(claim(g, 'feast_platter', 'well_fed')!.left).toBe(1);
    setQueued(g, { dish: 'berry_pie', quality: 'c', why: 'fight' });
    g.tick();
    expect(logLines(g).some((l) => l.includes('Well Fed has passed'))).toBe(false);
    expect(hasStatus(g, 'well_fed')).toBe(true);
    // The platter's own time ran out with the tick, so its slot is free; the other two stand.
    expect(slots(g)).toEqual(['hearty_stew', 'berry_pie']);
    expect(held(g, 'well_fed')!.ticksLeft!).toBeGreaterThan(1000);
  });

  it('a dish eaten between ticks at that point is fine too (the control)', () => {
    const g = flaskOnItsLastTick();
    use(g, 'berry_pie', 'c');
    g.tick();
    survives(g, ['hearty_stew', 'berry_pie']);
  });
});

describe('a worse helping of a dish already active', () => {
  /** A Fine Hearty Stew (Well Fed x1.6), then 100 ticks, then a Common one (x0.6). */
  function fineThenCommon() {
    const g = idle();
    grantGraded(g, 'hearty_stew', 'b', 1);
    grantGraded(g, 'hearty_stew', 'd', 1);
    use(g, 'hearty_stew', 'b');
    g.tick(100);
    use(g, 'hearty_stew', 'd');
    return g;
  }

  it('never lowers or extends the stronger claim: it is a second claim on the same slot', () => {
    const g = fineThenCommon();
    expect(held(g, 'well_fed')!.intensity).toBe(1.6);
    expect(held(g, 'well_fed')!.ticksLeft).toBe(STATUSES.well_fed.duration! - 100);
    expect(slots(g)).toEqual(['hearty_stew']);
    const claims = mealsOf(g).slots[0].claims.filter((c) => c.id === 'well_fed');
    expect(claims.map((c) => c.dose).sort()).toEqual([0.6, 1.6]);
    // The slot's time left is its longest claim: the Common helping's fresh clock.
    expect(own(g, 'hearty_stew')).toBe(STATUSES.well_fed.duration);
    // And the label is the grade still in effect.
    expect(active(g)[0].quality).toBe('b');
    expect(stockOf(g, 'hearty_stew')).toBeUndefined();
  });

  it('takes over when the stronger one runs out, and the label follows', () => {
    const g = fineThenCommon();
    g.tick(STATUSES.well_fed.duration! - 100 - 5); // the Fine claim has 5 left
    expect(held(g, 'well_fed')!.intensity).toBe(1.6);
    g.tick(10);
    expect(held(g, 'well_fed')!.intensity).toBe(0.6);
    expect(held(g, 'well_fed')!.ticksLeft).toBe(own(g, 'hearty_stew'));
    expect(active(g)[0].quality).toBe('d');
    expect(mealsOf(g).slots[0].claims.filter((c) => c.id === 'well_fed')).toHaveLength(1);
    expect(logLines(g).some((l) => l.includes('Well Fed has passed'))).toBe(false);
    g.tick(120);
    expect(slots(g)).toEqual([]);
    expect(hasStatus(g, 'well_fed')).toBe(false);
  });

  it('a stronger helping later replaces the weaker one, which it outlasts', () => {
    const g = idle();
    grantGraded(g, 'hearty_stew', 'b', 1);
    grantGraded(g, 'hearty_stew', 'd', 1);
    use(g, 'hearty_stew', 'd');
    g.tick(100);
    use(g, 'hearty_stew', 'b');
    expect(mealsOf(g).slots[0].claims.filter((c) => c.id === 'well_fed').map((c) => c.dose)).toEqual([1.6]);
    expect(held(g, 'well_fed')!.intensity).toBe(1.6);
    expect(held(g, 'well_fed')!.ticksLeft).toBe(STATUSES.well_fed.duration);
    expect(active(g)[0].quality).toBe('b');
  });

  it('an equal helping renews, and does not pile up claims', () => {
    const g = idle();
    stock(g, 'hearty_stew');
    use(g, 'hearty_stew', 'c');
    g.tick(500);
    use(g, 'hearty_stew', 'c');
    expect(mealsOf(g).slots[0].claims).toHaveLength(1);
    expect(own(g, 'hearty_stew')).toBe(STATUSES.well_fed.duration);
  });
});

describe('the per-tick bookkeeping writes nothing when nothing changed', () => {
  it('leaves the slot and claim arrays alone while every claim still counts', () => {
    const g = idle();
    stock(g, 'hearty_stew', 'mushroom_broth');
    use(g, 'hearty_stew', 'c');
    use(g, 'mushroom_broth', 'c');
    drink(g, 'c');
    // The live slice, read from inside a system context (a snapshot is a copy).
    const live = () => run(g, (ctx) => ctx.read(meals));
    const slotsArr = live().slots;
    const foreign = live().foreign;
    const claims = live().slots.map((m) => m.claims);
    g.tick(100);
    expect(live().slots).toBe(slotsArr);
    expect(live().foreign).toBe(foreign);
    expect(live().slots.map((m) => m.claims)).toEqual(claims);
    live().slots.forEach((m, i) => expect(m.claims).toBe(claims[i]));
  });
});

/** Set the counters each floor's `clear` reads, floors 1 to 6. The old `clearFloors`. */
function clearFloors(g: Kernel): void {
  const values: Record<string, number> = {};
  for (const id of ['ascent_f1', 'ascent_f2', 'ascent_f3', 'ascent_f4', 'ascent_f5', 'ascent_f6']) {
    for (const c of FLOORS[id].clear ?? []) if (c.type === 'stat') values[c.key] = c.value;
  }
  setCounters(g, values);
}

describe('save v59', () => {
  it.todo('is the version this change took, or a later one: not ported, the save here starts at version 1');

  it.todo('migrates a v58 save by adding the empty fields: not ported, the save here starts at version 1');

  it('keeps a food condition that was already running, with no slot for it', () => {
    // The old case loaded a v58 save holding Well Fed at 4000 ticks. Here the
    // condition is applied with no dish behind it.
    const g = makeGame({ seed: 3 });
    ask(g, applyStatus, { entity: PLAYER, app: { id: 'well_fed', intensity: 1, duration: 4000 }, source: 'Hearty Stew' });
    expect(heldList(g).map((s) => s.id)).toEqual(['well_fed']);
    expect(mealsOf(g).slots).toEqual([]);
    // The game runs on it: the condition ticks down and nothing throws.
    g.tick(10);
    expect(held(g, 'well_fed')!.ticksLeft).toBe(3990);
    expect(active(g)).toEqual([]);
  });

  it('round-trips slots, claims and the queue through serialize and deserialize', () => {
    const g = fighting();
    g.dispatch(selectActivity({ activity: null }));
    abandonCombat(g);
    stock(g, 'hearty_stew', 'mushroom_broth');
    use(g, 'hearty_stew', 'c');
    setQueued(g, { dish: 'mushroom_broth', quality: 'c', why: 'fight' });
    const loaded = makeGame({ seed: 3 });
    expect(loaded.load(g.save(0)).ok).toBe(true);
    expect(mealsOf(loaded).slots).toEqual(mealsOf(g).slots);
    expect(queuedOf(loaded)).toEqual({ dish: 'mushroom_broth', quality: 'c', why: 'fight' });
    expect(active(loaded).map((m) => m.slot.dish)).toEqual(['hearty_stew']);
  });

  it.todo('loads an old save through the rails, a backup-v58 copy kept: not ported, the save here starts at version 1');

  it('a prestige starts the next run with no slots, no claims and no queue', () => {
    const g = makeGame({ seed: 5 });
    g.dispatch(selectActivity({ activity: null }));
    stock(g, 'hearty_stew', 'mushroom_broth');
    drink(g, 'c');
    use(g, 'hearty_stew', 'c');
    setQueued(g, { dish: 'mushroom_broth', quality: 'c', why: 'fight' });
    expect(mealsOf(g).slots).toHaveLength(1);
    clearFloors(g);
    expect(g.dispatch(prestigeNow()).ok).toBe(true);
    expect(mealsOf(g).slots).toEqual([]);
    expect(mealsOf(g).foreign).toEqual([]);
    expect(queuedOf(g)).toBeNull();
    expect(heldList(g)).toEqual([]);
  });
});

/** Every live claim's time left on a condition, the dishes' and the other sources'. */
function allClaimLefts(g: Kernel, id: string): number[] {
  const m = mealsOf(g);
  return [...m.slots.flatMap((s) => s.claims.filter((c) => c.id === id)), ...m.foreign.filter((c) => c.id === id)].map(
    (c) => c.left as number,
  );
}
