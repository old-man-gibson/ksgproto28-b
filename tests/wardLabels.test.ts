/**
 * Port of the old `tests/wardLabels.test.ts` (3 cases): the ladder says band
 * 3's ward terms in words. Step 4 port C1.
 *
 * The old cases called `termText` and `condText` of the old
 * `ui/lib/format.ts`. Here a term's words are the ladder view's `TermView`
 * (`text`, with `met` for the old trailing check mark). Changed:
 * - "✓" at the end of the old text is `met: true` here.
 * - The view only says the terms of a floor's gate and clear. The second
 *   case puts its conditions on floor 7's gate for its duration and reads
 *   the rung's gate terms.
 * - A fight count reads in the view's frame, "4 wins at <spot>", where the
 *   old `condText` said "win 4 fights at <spot>". The ward position terms
 *   read the same.
 * - The boss latch case: `it.todo`. Floor 17 came with step 4 port C6, but
 *   the case reads a road's terms on the map, which this build does not
 *   print (the UI step).
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { Condition } from '../src/systems/counters';
import { FLOORS, type LadderView, type TermView } from '../src/systems/ladder';
import { SPOTS } from '../src/systems/world';
import { makeGame } from './helpers';
import { setCounters } from './worldHelpers';

const ladderView = (k: Kernel): LadderView => k.view().systems.ladder as LadderView;
const rung = (k: Kernel, id: string) => ladderView(k).towers.flatMap((t) => t.rungs).find((r) => r.id === id)!;

describe('ward terms in words', () => {
  it("floor 7's stamp clear names the place that can finish it at the ward's position", () => {
    const k = makeGame({ seed: 0 });
    const clear = (): TermView => rung(k, 'ascent_f7').clear[0];
    expect(clear().text).toBe(`Win ${SPOTS.f7_merchant_road.name}`);
    setCounters(k, { 'band:pos:ascent_f7': 1 });
    expect(clear().text).toBe(`Win ${SPOTS.f7_chiefs_tent.name}`);
    setCounters(k, { 'band:pos:ascent_f7': 3 });
    expect(clear().text).toBe(`Win ${SPOTS.f7_burnt_camp.name}`);
    expect(clear().met).toBe(false);
    setCounters(k, { 'ward:f7:done': 1 });
    // The old text ended in "✓".
    expect(clear().met).toBe(true);
  });

  it('fight counts and ward positions read as words, not counter keys', () => {
    const conds: Condition[] = [
      { type: 'stat', key: 'fights:f7_stockade', value: 4 },
      { type: 'statMax', key: 'band:pos:ascent_f7', value: 0 },
      { type: 'stat', key: 'band:pos:ascent_f7', value: 3 },
    ];
    const floor = FLOORS.ascent_f7;
    const saved = floor.gate;
    floor.gate = conds;
    try {
      const k = makeGame({ seed: 0 });
      // The band's gate (the city key) comes first, then the floor's.
      const words = rung(k, 'ascent_f7').gate.slice(1).map((t) => t.text);
      expect(words).toEqual([
        `4 wins at ${SPOTS.f7_stockade.name}`,
        'at most 0 other floors of The City cleared',
        '3+ other floors of The City cleared',
      ]);
      for (const w of words) expect(w).not.toMatch(/fights:|band:pos:/);
    } finally {
      if (saved === undefined) delete floor.gate;
      else floor.gate = saved;
    }
  });

  // Floor 17 is here since step 4 port C6: its descent (Malgeri Peak to the
  // Mountain Base) is the one road shut by a boss latch. The old case read
  // the road's terms as the map's barrier and the go button printed them
  // (`routeInfo.shut`, the map plan); this build's map says "No known route."
  // and prints no road terms. The UI step.
  it.todo('a boss latch reads as the keeper to defeat, on every road that is shut by one (UI step: the map prints no road terms, old `routeInfo.shut`)');
});
