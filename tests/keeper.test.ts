/**
 * Port of the old `tests/keeper.test.ts`: who can appear when. The keeper
 * of a site changes with the clock, and the ambush pair spawns only inside
 * the power window. The cases keep their names.
 *
 * Call shape changes: the hall is an `EncounterSite`; the hour is set on
 * the clock slice; `eligibleEncounters` and `encounterPowerRatio` take a
 * context.
 */
import { describe, expect, it } from 'vitest';
import type { Ctx, Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import { clockOf, TICKS_PER_GAME_MINUTE, type ClockState } from '../src/systems/clock';
import { eligibleEncounters, encounterPowerRatio, type CombatState, type EncounterSite } from '../src/systems/combat';
import { SITES } from './combatHelpers';
import { makeGame, patch, run } from './helpers';

// The old keeper table, a fixture for the clock and window rules.
const hall: EncounterSite = {
  ...SITES.f1_toll_hall,
  encounters: [
    { monsterId: 'goblin', weight: 40, level: [2, 5] },
    { monsterId: 'hobgoblin', weight: 15, level: [6, 7], daypart: 'day', boss: true },
    { monsterId: 'slime_base_advanced', weight: 15, level: [6, 7], daypart: 'night', boss: true },
    { monsterId: 'hobgoblin_champion', weight: 15, level: [11, 12], daypart: 'day', boss: true, window: { min: 0.9, max: 0.98 } },
    { monsterId: 'slime_king', weight: 15, level: [11, 12], daypart: 'night', boss: true, window: { min: 0.9, max: 0.98 } },
  ],
};

/** A new game at hour `h` of the first day. */
function at(hour: number, extraTicks = 0): Kernel {
  const g = makeGame({ seed: 1 });
  patch(g, (slices) => {
    (slices.clock as ClockState).totalTicks = hour * 60 * TICKS_PER_GAME_MINUTE + extraTicks;
  });
  return g;
}

const ids = (g: Kernel) => run(g, (ctx) => eligibleEncounters(ctx as Ctx<CombatState>, hall).map((e) => e.monsterId));

describe('the keeper changes with the clock', () => {
  it('daylight rolls the hobgoblin and never the night slime', () => {
    const noon = ids(at(12));
    expect(noon).toContain('hobgoblin');
    expect(noon).not.toContain('slime_base_advanced');
  });

  it('night rolls the slime and never the hobgoblin', () => {
    const midnight = ids(at(0));
    expect(midnight).toContain('slime_base_advanced');
    expect(midnight).not.toContain('hobgoblin');
  });

  it('a full moon is still night: moonlight never moves the boundary', () => {
    const extra = 14 * 24 * 60 * TICKS_PER_GAME_MINUTE; // the 15th: Middle Moon full
    const fullMoon = at(0, extra);
    expect(clockOf(extra).moons.find((m) => m.id === 'middle_moon')?.phaseId).toBe('full');
    expect(ids(fullMoon)).toContain('slime_base_advanced');
    expect(ids(fullMoon)).not.toContain('hobgoblin');
  });

  it('the trash table ignores the clock', () => {
    for (const hour of [0, 12]) {
      expect(ids(at(hour))).toContain('goblin');
    }
  });
});

describe('the ambush window', () => {
  const champion = hall.encounters.find((e) => e.monsterId === 'hobgoblin_champion')!;
  const ratio = (g: Kernel) => run(g, (ctx) => encounterPowerRatio(ctx as Ctx<CombatState>, champion));

  it('a fresh level-1 save is far below the window, so no champion appears', () => {
    const noon = at(12);
    expect(ratio(noon)).toBeLessThan(0.9);
    expect(ids(noon)).not.toContain('hobgoblin_champion');
    expect(ids(at(0))).not.toContain('slime_king');
  });

  it('inside the window the champion joins the table; past it, gone again', () => {
    // Walk attributes up until the ratio crosses into the window, then past
    // it: a grid of a uniform base and a few points of CON on top.
    const g = at(12);
    const setAttrs = (base: number, conExtra: number) =>
      patch(g, (slices) => {
        const attrs = (slices.attributes as AttributesState).attrs;
        for (const a of Object.values(attrs)) a.level = base;
        attrs.con.level = base + conExtra;
      });
    let inWindow: [number, number] | null = null;
    let past: [number, number] | null = null;
    outer: for (let base = 1; base <= 400; base++) {
      for (let extra = 0; extra < 10; extra++) {
        setAttrs(base, extra);
        const r = ratio(g);
        if (!inWindow && r >= 0.9 && r <= 0.98) inWindow = [base, extra];
        if (!past && r > 0.98) past = [base, extra];
        if (past) break outer;
      }
    }
    // The window is reachable by ordinary growth.
    expect(inWindow, 'no attribute level lands inside the 90 to 98% window').not.toBeNull();
    setAttrs(...inWindow!);
    expect(ids(g)).toContain('hobgoblin_champion');
    expect(past).not.toBeNull();
    setAttrs(...past!);
    expect(ids(g)).not.toContain('hobgoblin_champion');
  });
});
