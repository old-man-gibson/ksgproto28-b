/**
 * Port of old `tests/cookBookView.test.ts`. Changed only where the call shape
 * changed:
 *
 * - The old helpers of `ui/lib/cookBook.ts` read the state; here they are in
 *   `src/systems/cooking/bookView.ts` and take the Book's reads
 *   (`bookOf(reads(g))`) and the recipes read (`recipe:<id>` counters).
 *   `createInitialState(1)` with `state.stats[...]` written is a new game
 *   with counters set by the counter event (`setCounters`).
 * - `state.skills.cooking`, the stock and `state.prestige` are patched.
 * - `cook(state, bus, placement, disc, duration)` is the request
 *   `cooking/cook`; `bus.on('cooked')` is `kernel.onEvent` on
 *   `cooking/cooked`.
 * - `plateTracker(state, bench)` read the live state at each event; here it
 *   takes the Book when the window opened, and `cooked(ev, cooks, book)` the
 *   Book after the event.
 * - `useConsumable(state, bus, id, q)` is the command `consumables/use`; the
 *   old case emptied the log first, here the lines after the count before
 *   are read.
 * - "food stats as percents": `describeMod` is `items/format`; the
 *   foodDuration stat is `statBlockOf`. `sumMods` and `statTipLines` of the
 *   old `ui/lib/format.ts` are not in this build: those two assertions are
 *   `it.todo`.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { DISCIPLINES, recipeKey, type Placement } from '../src/systems/benches';
import {
  bookOf,
  bookSections,
  bookSummary,
  COOK_TIME_COOKS,
  cooked,
  cookedGradeKey,
  cookedKey,
  cookingDishIds,
  cookRequest,
  dishMarks,
  plateFor,
  plateTracker,
  SIGNATURE_COOKS,
  squaresLabel,
  tierColour,
  type BookRow,
  type CookedEvent,
  type Plate,
} from '../src/systems/cooking';
import { useConsumable } from '../src/systems/consumables';
import type { CountersState } from '../src/systems/counters';
import { describeMod } from '../src/systems/items/format';
import { QUALITY_ORDER, type MaterialsState, type QualityTier } from '../src/systems/materials';
import { statBlockOf } from '../src/systems/stats';
import { logOf } from './combatHelpers';
import { ask, makeGame, patch, reads, slice } from './helpers';
import { setCounters } from './worldHelpers';

const STOVE = DISCIPLINES.cooking;
const at = (id: string, quality: QualityTier = 'c') => ({ id, quality });

/** Add units of a graded material. The old `grantGraded(state, id, q, n)`. */
function grantGraded(g: Kernel, id: string, q: QualityTier, n: number) {
  patch(g, (slices) => {
    const m = slices.materials as MaterialsState;
    m.stock[id] ??= {};
    m.stock[id][q] = (m.stock[id][q] ?? 0) + n;
  });
}

function newGame(level = 1): Kernel {
  const g = makeGame({ seed: 1 });
  patch(g, (slices) => {
    slices.skills.skills.cooking = { level, xp: 0 };
    for (const id of ['raw_meat', 'wild_onion']) {
      slices.materials.stock[id] ??= {};
      for (const q of ['c', 'b', 'a'] as QualityTier[]) slices.materials.stock[id][q] = (slices.materials.stock[id][q] ?? 0) + 300;
    }
  });
  return g;
}

/** The old `createInitialState(1)`. */
const initial = (): Kernel => makeGame({ seed: 1 });

/** The old `state.stats[key] = n`. */
const stat = (g: Kernel, key: string, value: number) => setCounters(g, { [key]: value });

const book = (g: Kernel) => bookOf(reads(g));
const known = (g: Kernel): string[] =>
  Object.entries(slice<CountersState>(g, 'counters').counts)
    .filter(([k, v]) => k.startsWith('recipe:') && v > 0)
    .map(([k]) => k.slice('recipe:'.length));
const sectionsOf = (g: Kernel) => bookSections(book(g), known(g));

const rowOf = (g: Kernel, benchId: string, dishName: string): BookRow | undefined =>
  sectionsOf(g).find((s) => s.benchId === benchId)?.rows.find((r) => r.name === dishName);

/** The nth row of a bench, whatever it shows. */
const nth = (g: Kernel, benchId: string, n: number): BookRow => sectionsOf(g).find((s) => s.benchId === benchId)!.rows[n];

/** The old `cook(state, bus, placement, disc, duration)`. */
const cook = (g: Kernel, placement: Placement, disc = STOVE, duration?: number) =>
  ask(g, cookRequest, { discipline: disc.id, placement, ...(duration !== undefined ? { duration } : {}) });

describe('the Cook’s Book sections', () => {
  it('has one section per bench that makes dishes, labelled with the bench, whether or not it is reached', () => {
    const sections = sectionsOf(initial());
    expect(sections.map((s) => s.label)).toEqual(['Cooking Stove', 'Open Grill', 'Clay Oven', 'Cold Counter']);
    // The cutting board makes cuts, which are not dishes.
    expect(sections.some((s) => s.benchId === 'preparing')).toBe(false);
  });

  it('lists a row for every outcome, in the core’s order', () => {
    const stove = sectionsOf(initial())[0].rows;
    expect(stove).toHaveLength(DISCIPLINES.cooking.outcomes.length);
  });

  it('counts dishes, not rows: a dish several benches make is one', () => {
    const g = initial();
    expect(bookSummary(book(g))).toEqual({ made: 0, total: cookingDishIds().length, text: `0 of ${cookingDishIds().length} dishes made` });
    // The Traveler's Ration is on all four benches.
    stat(g, cookedKey('travelers_ration'), 3);
    expect(bookSummary(book(g)).made).toBe(1);
    stat(g, cookedKey('hearty_stew'), 1);
    expect(bookSummary(book(g)).text).toBe(`2 of ${cookingDishIds().length} dishes made`);
  });
});

describe('what a row shows', () => {
  it('prints a dish whose card is unread as a blank row: no name, no icon, no requirements', () => {
    const g = initial();
    const seared = nth(g, 'cooking', DISCIPLINES.cooking.outcomes.findIndex((o) => o.id === 'seared_stew'));
    expect(seared.blank).toBe(true);
    expect(seared.name).toBe('');
    expect(seared.icon).toBe('');
    expect(seared.made).toBe(0);
    expect(seared.cookTime).toBe('not yet made');
    expect(seared.signature).toBe('');
    expect(seared.squares.every((s) => s.state === 'none')).toBe(true);
    // Nothing the row prints names the dish, its tags or its window (`key` is for the list, not the page).
    const { key, ...printed } = seared;
    expect(key).toBeTruthy();
    expect(JSON.stringify(printed)).not.toMatch(/seared|meat|stew|units/i);
  });

  it('names a dish that needs no card, with zero counts, before it is ever made', () => {
    const stew = rowOf(initial(), 'cooking', 'Hearty Stew')!;
    expect(stew.blank).toBe(false);
    expect(stew.icon).toBe('🍲');
    expect(stew.made).toBe(0);
    expect(stew.squares.every((s) => s.state === 'none')).toBe(true);
    // No window on the fallback dish; its Signature is not earned yet.
    expect(stew.cookTime).toBe('—');
    expect(stew.signature).toBe(`after ${SIGNATURE_COOKS} cooks`);
  });

  it('shows a blank row’s dish once the card is read, with its cook time still to earn', () => {
    const g = initial();
    stat(g, recipeKey('seared_stew'), 1);
    const seared = rowOf(g, 'cooking', 'Seared Stew')!;
    expect(seared.blank).toBe(false);
    expect(seared.made).toBe(0);
    expect(seared.cookTime).toBe(`shown after ${COOK_TIME_COOKS} cooks`);
    expect(seared.cookTimeDim).toBe(true);
  });

  it('shows the window in words once the cook time is known, and not before', () => {
    const g = initial();
    for (const id of ['seared_stew', 'braised_meat', 'steeped_broth']) stat(g, recipeKey(id), 1);
    stat(g, cookedKey('seared_stew'), COOK_TIME_COOKS - 1);
    stat(g, cookedKey('braised_meat'), COOK_TIME_COOKS);
    stat(g, cookedKey('steeped_broth'), COOK_TIME_COOKS + 40);
    stat(g, cookedKey('hearty_stew'), COOK_TIME_COOKS);
    expect(rowOf(g, 'cooking', 'Seared Stew')!.cookTime).toBe(`shown after ${COOK_TIME_COOKS} cooks`);
    expect(rowOf(g, 'cooking', 'Braised Meat')!.cookTime).toBe('meat 14 or more units');
    expect(rowOf(g, 'cooking', 'Steeped Broth')!.cookTime).toBe('herb 8 or more units');
    expect(rowOf(g, 'cooking', 'Braised Meat')!.cookTimeDim).toBe(false);
    // A dish with no window of its own has nothing to show, however often it is cooked.
    const hearty = rowOf(g, 'cooking', 'Hearty Stew')!;
    expect(hearty.cookTime).toBe('—');
    expect(hearty.cookTimeDim).toBe(true);
    stat(g, cookedKey('seared_stew'), COOK_TIME_COOKS);
    expect(rowOf(g, 'cooking', 'Seared Stew')!.cookTime).toBe('meat under 6 units');
  });

  it('shows the Signature’s condition once earned, the count to go before, and a dash for the failure dish', () => {
    const g = initial();
    stat(g, cookedKey('hearty_stew'), SIGNATURE_COOKS - 1);
    const before = rowOf(g, 'cooking', 'Hearty Stew')!;
    expect(before.signature).toBe(`after ${SIGNATURE_COOKS} cooks`);
    expect(before.signatureDim).toBe(true);
    stat(g, cookedKey('hearty_stew'), SIGNATURE_COOKS);
    const after = rowOf(g, 'cooking', 'Hearty Stew')!;
    expect(after.signature).toBe('Stoked');
    expect(after.signatureDim).toBe(false);
    stat(g, cookedKey('scorched_mess'), 500);
    const mess = rowOf(g, 'cooking', 'Scorched Mess')!;
    expect(mess.signature).toBe('—');
    expect(mess.signatureDim).toBe(true);
  });

  it('shares one count between the benches that make a dish', () => {
    const g = initial();
    stat(g, cookedKey('travelers_ration'), 7);
    for (const bench of ['cooking', 'grilling', 'baking', 'assembling']) {
      expect(rowOf(g, bench, "Traveler's Ration")!.made, bench).toBe(7);
    }
  });
});

describe('the grade squares', () => {
  const squares = (tiers: Partial<Record<QualityTier, number>>) => {
    const g = initial();
    const values: Record<string, number> = {};
    for (const [tier, n] of Object.entries(tiers)) values[cookedGradeKey('hearty_stew', tier as QualityTier)] = n;
    values[cookedKey('hearty_stew')] = Object.values(tiers).reduce((a, b) => a + b, 0);
    setCounters(g, values);
    return rowOf(g, 'cooking', 'Hearty Stew')!.squares;
  };
  const states = (sq: ReturnType<typeof squares>) => sq.map((s) => s.state);

  it('runs F to S, seven squares', () => {
    expect(squares({}).map((s) => s.tier)).toEqual(QUALITY_ORDER);
    expect(QUALITY_ORDER).toHaveLength(7);
  });

  it('fills the grades made and dashes the one above the best', () => {
    // Made Fair and Fine: the next grade up is Superb.
    expect(states(squares({ c: 4, b: 1 }))).toEqual(['none', 'none', 'none', 'made', 'made', 'next', 'none']);
    // Gaps stay empty: Poor and Superb made, Common and Fair not.
    expect(states(squares({ e: 2, a: 1 }))).toEqual(['none', 'made', 'none', 'none', 'none', 'made', 'next']);
  });

  it('dashes nothing at the top grade, nor before the first cook', () => {
    expect(states(squares({ s: 1 })).includes('next')).toBe(false);
    expect(states(squares({})).includes('next')).toBe(false);
  });

  it('carries the count per grade for the tooltip', () => {
    const sq = squares({ c: 4, b: 1 });
    expect(sq.find((s) => s.tier === 'c')!.count).toBe(4);
    expect(squaresLabel(sq)).toBe('Made at Fair (4), Fine (1). Next grade up: Superb.');
    expect(squaresLabel(squares({}))).toBe('Not made yet.');
  });

  it('draws Refuse in a legible colour', () => {
    expect(tierColour('f')).toBe('var(--text-dim)');
    expect(tierColour('s')).not.toBe('var(--text-dim)');
  });
});

/** Collect the `cooking/cooked` events while `fn` runs. */
function hearCooked<T>(g: Kernel, fn: () => T): { out: T; events: CookedEvent[] } {
  const events: CookedEvent[] = [];
  const off = g.onEvent((e) => {
    if (e.type === cooked.type) events.push(e.payload as CookedEvent);
  });
  const out = fn();
  off();
  return { out, events };
}

describe('the plate card', () => {
  function cookOnce(g: Kernel, placement: Placement, duration = 12) {
    const before = dishMarks(book(g));
    const { out: done, events } = hearCooked(g, () => cook(g, placement, STOVE, duration));
    expect(done).not.toBeNull();
    expect(events).toHaveLength(1);
    const ev = events[0];
    return { ev, before: before.get(ev.dish), after: dishMarks(book(g)).get(ev.dish)! };
  }
  const stew = (q: QualityTier): Placement => ({ main: at('raw_meat', q), second: at('wild_onion', q) });

  it('names the dish, its grade and what the Book now holds', () => {
    const g = newGame();
    const { ev, before, after } = cookOnce(g, stew('c'));
    const plate = plateFor(ev, before, after, 1);
    expect(plate.name).toBe('Hearty Stew');
    expect(plate.icon).toBe('🍲');
    expect(plate.quality).toBe(ev.quality);
    expect(plate.made).toBe(1);
    expect(plate.best).toBe(ev.quality);
    expect(plate.signature).toBe(false);
    expect(plate.cooks).toBe(1);
  });

  it('gives a range only where the preview promised a spread', () => {
    const g = newGame();
    const { ev, before, after } = cookOnce(g, stew('c'));
    expect(plateFor(ev, before, after, 1).range).toBeNull();
    const spread: CookedEvent = { ...ev, low: 'b', high: 'a' };
    expect(plateFor(spread, before, after, 1).range).toBe('Fine to Superb');
  });

  it('says new best when the best grade rose, and not for the first cook, a repeat or a lower grade', () => {
    const g = newGame();
    const first = cookOnce(g, stew('c'));
    expect(plateFor(first.ev, first.before, first.after, 1).news.newBest).toBe(false);
    const again = cookOnce(g, stew('c'));
    expect(plateFor(again.ev, again.before, again.after, 2).news.newBest).toBe(false);
    const better = cookOnce(g, stew('a'));
    expect(QUALITY_ORDER.indexOf(better.ev.quality)).toBeGreaterThan(QUALITY_ORDER.indexOf(first.ev.quality));
    expect(plateFor(better.ev, better.before, better.after, 3).news.newBest).toBe(true);
    const lower = cookOnce(g, stew('c'));
    expect(plateFor(lower.ev, lower.before, lower.after, 4).news.newBest).toBe(false);
  });

  it('says the cook time is shown on the cook that makes it known, for a dish that has one', () => {
    const g = newGame();
    stat(g, recipeKey('seared_stew'), 1);
    stat(g, cookedKey('seared_stew'), COOK_TIME_COOKS - 1);
    // Meat midway on a Quick simmer: 5.4 units, under 6.
    const seared: Placement = { main: at('wild_onion'), second: at('raw_meat') };
    const crossing = cookOnce(g, seared, 8);
    expect(crossing.ev.dish).toBe('seared_stew');
    expect(plateFor(crossing.ev, crossing.before, crossing.after, 1).news.timeShown).toBe(true);
    const next = cookOnce(g, seared, 8);
    expect(plateFor(next.ev, next.before, next.after, 2).news.timeShown).toBe(false);
  });

  it('does not say it for a dish with no window to show', () => {
    const g = newGame();
    stat(g, cookedKey('hearty_stew'), COOK_TIME_COOKS - 1);
    const crossing = cookOnce(g, stew('c'));
    expect(crossing.ev.dish).toBe('hearty_stew');
    expect(plateFor(crossing.ev, crossing.before, crossing.after, 1).news.timeShown).toBe(false);
  });

  it('does not say it when Cook’s Notes already carried the cook time', () => {
    const g = newGame();
    stat(g, recipeKey('seared_stew'), 1);
    stat(g, cookedKey('seared_stew'), COOK_TIME_COOKS - 1);
    patch(g, (slices) => {
      slices.prestige.purchases.cooks_notes = 1;
      slices.cooking.carried = { timed: ['seared_stew'], signed: [] };
    });
    setCounters(g, { 'prestige:count': 1 });
    const crossing = cookOnce(g, { main: at('wild_onion'), second: at('raw_meat') }, 8);
    expect(crossing.ev.dish).toBe('seared_stew');
    expect(crossing.before!.timeKnown).toBe(true);
    expect(plateFor(crossing.ev, crossing.before, crossing.after, 1).news.timeShown).toBe(false);
  });

  it('marks a Signature dish once earned', () => {
    const g = newGame();
    stat(g, cookedKey('hearty_stew'), SIGNATURE_COOKS - 1);
    const crossing = cookOnce(g, stew('c'));
    expect(plateFor(crossing.ev, crossing.before, crossing.after, 1).signature).toBe(true);
  });

  it('counts the dishes cooked with the layout it is handed', () => {
    const g = newGame();
    const { ev, before, after } = cookOnce(g, stew('c'));
    expect(plateFor(ev, before, after, 4).cooks).toBe(4);
  });
});

describe('a window that hears every bench’s cooks', () => {
  /** A stove window open since before the grill cooked anything; the Ration is made at both. */
  function windowOpenAtStove() {
    const g = newGame();
    for (const q of ['c', 'a'] as QualityTier[]) grantGraded(g, 'forest_berries', q, 20);
    const stoveRation = (): Placement => ({ main: at('wild_onion', 'c'), second: at('forest_berries', 'c') });
    // The best Ration made at the stove so far is Fair.
    expect(cook(g, stoveRation(), STOVE, 12)!.quality).toBe('c');
    const tracker = plateTracker(book(g), 'cooking');
    const heard: (Plate | null)[] = [];
    // The tracker hears each event after the Book has taken the cook in.
    const pending: CookedEvent[] = [];
    g.onEvent((e) => {
      if (e.type === cooked.type) pending.push(e.payload as CookedEvent);
    });
    const cookHeard = (placement: Placement, disc = STOVE, duration?: number) => {
      const done = cook(g, placement, disc, duration);
      for (const ev of pending.splice(0)) heard.push(tracker.cooked(ev, 1, book(g)));
      return done;
    };
    return { g, stoveRation, heard, cookHeard };
  }

  it('does not call a Fair stove Ration a new best after the grill made a Superb one', () => {
    const { stoveRation, heard, cookHeard } = windowOpenAtStove();
    // A Superb Ration lands at the grill while the stove window is open.
    expect(cookHeard({ main: at('forest_berries', 'a') }, DISCIPLINES.grilling)!.quality).toBe('a');
    expect(cookHeard(stoveRation(), STOVE, 12)!.quality).toBe('c');
    expect(heard[0]).toBeNull(); // the grill's cook makes no card here
    expect(heard[1]!.news.newBest).toBe(false);
    expect(heard[1]!.best).toBe('a'); // the Book's best is still the grill's Superb
    expect(heard[1]!.made).toBe(3);
  });

  it('still says new best when the stove itself raises it', () => {
    const { heard, cookHeard } = windowOpenAtStove();
    const better: Placement = { main: at('wild_onion', 'a'), second: at('forest_berries', 'a') };
    expect(QUALITY_ORDER.indexOf(cookHeard(better, STOVE, 12)!.quality)).toBeGreaterThan(QUALITY_ORDER.indexOf('c'));
    expect(heard[0]!.news.newBest).toBe(true);
  });
});

describe('the eat line', () => {
  function eat(count: number, quality: QualityTier): string {
    const g = newGame();
    stat(g, cookedKey('hearty_stew'), count);
    grantGraded(g, 'hearty_stew', quality, 1);
    const from = logOf(g).length;
    expect(g.dispatch(useConsumable({ id: 'hearty_stew', quality })).ok).toBe(true);
    return logOf(g).slice(from).join('\n');
  }

  it('names the Signature and its dose when it comes with the dish', () => {
    // Fine is ×1.6 and the Signature is 0.5 of a dose: Stoked at 0.8.
    expect(eat(SIGNATURE_COOKS, 'b')).toBe('🍲 Ate Fine Hearty Stew. Signature: also Stoked ×0.8.');
  });

  it('stays the plain line before the Signature is earned', () => {
    expect(eat(SIGNATURE_COOKS - 1, 'b')).toBe('🍲 Ate Fine Hearty Stew.');
  });

  it('says nothing of it for spoiled food', () => {
    expect(eat(SIGNATURE_COOKS, 'f')).toBe('🍲 Ate Refuse Hearty Stew.');
  });
});

describe('food stats as percents', () => {
  it('reads a milestone as +6%', () => {
    expect(describeMod({ stat: 'foodDuration', op: 'add', value: 0.06 })).toBe('+6% Food Duration');
    expect(describeMod({ stat: 'foodPotency', op: 'add', value: 0.05 })).toBe('+5% Food Potency');
  });

  it.todo('reads the milestones together as a sum: `sumMods` of the old ui/lib/format.ts is not in this build');

  it('reaches 112% food duration at cooking level 20', () => {
    const g = newGame(20);
    expect(statBlockOf(reads(g)).foodDuration).toBeCloseTo(1.12);
  });

  it.todo('reads the stat tooltip in percents from base to total: `statTipLines` of the old ui/lib/format.ts is not in this build');
});
