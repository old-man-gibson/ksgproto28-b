/**
 * Port of the damage cases of the old `tests/breakdown.test.ts`. The stat
 * and attribute breakdown cases of that file were ported with the stats
 * system (`tests/attributes.test.ts`, port 1). The cases keep their names.
 *
 * Call shape changes: a monster outside a fight is its species' block from
 * attributes (`speciesStats`), and `monsterSlice` takes that block.
 */
import { describe, expect, it } from 'vitest';
import { incomingDamage, incomingSlice, monsterSlice } from '../src/systems/combat';
import type { LogState } from '../src/systems/log';
import { speciesStats } from '../src/systems/monsters';
import { feedOf, huntingGame, playerStats } from './combatHelpers';
import { makeGame, slice } from './helpers';

/** A bare specimen: only its species matters for armour and resistances. */
const specimen = (defId: string) => speciesStats(defId, { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, 1);

describe('stat breakdowns (tooltips)', () => {
  it('damage tooltips itemise what was resisted, pierced and blocked', () => {
    const golem = specimen('stone_golem');
    // A stone golem is inorganic, construct and earth: the toughest of the
    // three sets its armour. Armour comes off first, then the typed
    // resistance takes its share of what got through.
    const worn = golem.armor;
    expect(worn).toBeGreaterThan(0);

    // stone_golem: 0.6 slashing resistance. Penetration erases half of it.
    const cut = monsterSlice(golem, 'slashing', 'Iron Sword', 100, 0.3);
    expect(cut.resistance).toBeCloseTo(0.3, 5);
    expect(cut.pierced).toBeCloseTo(0.3, 5);
    expect(cut.armor).toBeCloseTo(worn, 5);
    expect(cut.dealt).toBeCloseTo((100 - worn) * 0.7, 5);
    expect(cut.resisted).toBeCloseTo((100 - worn) * 0.3, 5);

    // A weakness reads as negative resistance, applied to what the armour left.
    const weak = monsterSlice(golem, 'bludgeoning', 'Club', 100, 0.3);
    expect(weak.resisted).toBeCloseTo((100 - worn) * -0.5, 5);
    expect(weak.pierced).toBe(0);

    // Something soft has nothing to take off the top.
    const rat = specimen('forest_rat');
    expect(rat.armor).toBe(0);
    expect(monsterSlice(rat, 'slashing', 'Iron Sword', 100).armor).toBe(0);

    // Incoming: flat armour first, then the typed resistance on what is left.
    const g = makeGame({ seed: 105 });
    const stats = { ...playerStats(g), armor: 10, resSlashing: 0.5 };
    const hit = incomingSlice(stats, 'slashing', 'Wolf', 30);
    expect(hit.armor).toBe(10);
    expect(hit.resisted).toBeCloseTo(10, 5);
    expect(hit.dealt).toBe(10);
    expect(incomingDamage(stats, 'slashing', 30)).toBe(hit.dealt);
    // Armour never claims more than the blow carried.
    expect(incomingSlice(stats, 'slashing', 'Wolf', 5).armor).toBe(5);
  });

  it('every damage line in the fight feed carries its own breakdown', () => {
    const g = huntingGame(106, 'woods_edge');
    const reports = [];
    // The live feed keeps 40 lines; collect across the run, as the old test
    // read the feed once after 2,000 ticks.
    for (let i = 0; i < 2000; i++) g.tick();
    for (const line of feedOf(g)) if (line.damage) reports.push(line.damage);
    for (const line of slice<LogState>(g, 'log').transcript ?? []) if (line.damage) reports.push(line.damage);

    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      expect(r.slices.length).toBeGreaterThan(0);
      expect(r.steps.length).toBeGreaterThan(0);
      // The parts add up to the number the feed line printed (rounded, and
      // never below the one point every blow at least deals).
      const dealt = r.slices.reduce((sum, s) => sum + s.dealt, 0);
      expect(r.total).toBe(Math.max(1, Math.round(dealt)));
      for (const s of r.slices) expect(s.source).not.toBe('');
    }
    // Both directions are explained: what was dealt, and what was taken.
    expect(reports.some((r) => !r.incoming && r.slices[0].source === 'Rusty Sword')).toBe(true);
    expect(reports.some((r) => r.incoming && r.target === 'You')).toBe(true);
  });
});
