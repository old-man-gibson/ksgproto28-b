/**
 * Port of the old `tests/chronosense.test.ts`, all 15 cases.
 *
 * What changed in the call shape:
 * - the readers (`describeTimeSense`, `describeMoons`, `SENSE_LEVELS`,
 *   `timePenaltyMult`) are in `clock`;
 * - one call of the old `tickChronosense` at `totalTicks` is one kernel tick
 *   that lands the clock on `totalTicks` (`tickTo`): the trainer runs in the
 *   tick of `weather`;
 * - the old `grantSkillXp`, `raiseSkillCap` and `skillCap` calls are the
 *   skills system's events and read, through the kernel.
 *
 * New here: a save past the first day without the sense manifests it on the
 * next tick, a game minute or not (the old trainer checked every tick; the
 * new one reads the skills slice on such a tick until the sense is held);
 * the view's `timeSense` and the readout the Character panel mounts.
 */
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import {
  CHRONOSENSE_ID,
  CHRONOSENSE_MANIFEST_TICKS,
  clockOf,
  describeMoons,
  describeTimeSense,
  SENSE_LEVELS,
  TICKS_PER_DAY,
  timePenaltyMult,
} from '../src/systems/clock';
import {
  grantSkillXp,
  raiseSkillCap,
  skillCap,
  SKILLS,
  type SkillsState,
  type SkillState,
  type SkillsView,
} from '../src/systems/skills';
import TimeSenseReadout from '../src/systems/skills/TimeSenseReadout.svelte';
import { emit, makeGame, patch, reads, slice } from './helpers';

const at = (d: number, h = 0, m = 0) => (d * 1440 + h * 60 + m) * 10;

/** A new game with the clock at `totalTicks`, and the skills given. */
function world(totalTicks: number, held: Record<string, SkillState> = {}): Kernel {
  const kernel = makeGame();
  patch(kernel, (slices) => {
    slices.clock.totalTicks = totalTicks;
    Object.assign((slices.skills as SkillsState).skills, held);
  });
  return kernel;
}

/** A game whose next tick lands the clock on `totalTicks`: one old `tickChronosense` there. */
function tickTo(totalTicks: number, held: Record<string, SkillState> = {}): Kernel {
  const kernel = world(totalTicks - 1, held);
  kernel.tick();
  return kernel;
}

const sense = (kernel: Kernel): SkillState | undefined => slice<SkillsState>(kernel, 'skills').skills[CHRONOSENSE_ID];

describe('chronosense manifests from lived time alone', () => {
  it('is registered content with tier names matching the sense ladder', () => {
    const def = SKILLS[CHRONOSENSE_ID];
    expect(def).toBeDefined();
    expect(def.tierNames?.map((t) => t.level)).toEqual(Object.values(SENSE_LEVELS));
  });

  it('stays dormant before a full day, wakes after one', () => {
    expect(sense(tickTo(CHRONOSENSE_MANIFEST_TICKS - 1))).toBeUndefined();
    expect(sense(tickTo(CHRONOSENSE_MANIFEST_TICKS))).toEqual({ level: 1, xp: 0 });
    expect(CHRONOSENSE_MANIFEST_TICKS).toBe(TICKS_PER_DAY);
  });

  it('drinks XP once per game minute, not per tick', () => {
    const kernel = tickTo(TICKS_PER_DAY + 10, { [CHRONOSENSE_ID]: { level: 1, xp: 0 } }); // a minute boundary
    const afterMinute = sense(kernel)!.xp;
    expect(afterMinute).toBeGreaterThan(0);

    kernel.tick(); // mid-minute
    expect(sense(kernel)!.xp).toBe(afterMinute);
  });

  it('at the ceiling the minute sends no grant (it would change nothing); a raised ceiling trains again', () => {
    const kernel = tickTo(TICKS_PER_DAY + 10, { [CHRONOSENSE_ID]: { level: 20, xp: 0 } });
    let grants = 0;
    kernel.onEvent((event) => {
      if (event.type === 'skills/grant-xp' && (event.payload as { tags: string[] }).tags[0] === 'time') grants += 1;
    });
    for (let i = 0; i < 30; i++) kernel.tick();
    expect(grants).toBe(0);
    expect(sense(kernel)).toEqual({ level: 20, xp: 0 });
    emit(kernel, raiseSkillCap, { id: CHRONOSENSE_ID, by: 5 });
    for (let i = 0; i < 10; i++) kernel.tick();
    expect(grants).toBe(1);
    expect(sense(kernel)!.xp).toBeGreaterThan(0);
  });

  it('a save past the first day without the sense manifests it on the next tick, a game minute or not', () => {
    const kernel = tickTo(TICKS_PER_DAY + 5);
    expect(sense(kernel)).toEqual({ level: 1, xp: 0 });
    // Held now: the ticks to the next minute pay nothing, the minute pays.
    for (let i = 0; i < 4; i++) kernel.tick();
    expect(sense(kernel)!.xp).toBe(0);
    kernel.tick();
    expect(sense(kernel)!.xp).toBeGreaterThan(0);
  });
});

describe('the sense ladder', () => {
  const noon = clockOf(at(12, 9, 23)); // Sixthday, 13th of First Month, 09:23

  it('does not exist below level 1', () => {
    expect(describeTimeSense(noon, 0)).toBeNull();
  });

  it('accretes precision level by level', () => {
    expect(describeTimeSense(noon, SENSE_LEVELS.daypart)).toBe('Morning');
    expect(describeTimeSense(noon, SENSE_LEVELS.season)).toBe('Morning · winter');
    expect(describeTimeSense(noon, SENSE_LEVELS.bell)).toBe('about 09:00 · winter');
    expect(describeTimeSense(noon, SENSE_LEVELS.weekday)).toBe('Sixthday · about 09:00 · winter');
    expect(describeTimeSense(noon, SENSE_LEVELS.date)).toBe('Sixthday, 13th of First Month, Year 1 · about 09:00');
    expect(describeTimeSense(noon, SENSE_LEVELS.minute)).toBe('Sixthday, 13th of First Month, Year 1 · 09:23');
  });

  it('reads the moons from season-sense, and their cycle day from date-sense', () => {
    expect(describeMoons(noon, SENSE_LEVELS.season - 1)).toEqual([]);
    expect(describeMoons(noon, SENSE_LEVELS.season)).toEqual([
      'Large Moon: waxing crescent',
      'Middle Moon: waxing gibbous',
      'Small Moon: waxing gibbous',
    ]);
    expect(describeMoons(noon, SENSE_LEVELS.date)).toEqual([
      'Large Moon: waxing crescent (day 13 of 79)',
      'Middle Moon: waxing gibbous (day 13 of 28)',
      'Small Moon: waxing gibbous (day 13 of 37)',
    ]);
  });

  it('a holy day is felt before it can be named', () => {
    const solstice = clockOf(at(183, 12));
    expect(describeTimeSense(solstice, SENSE_LEVELS.season)).toBe('Midday · summer · a holy day');
    expect(describeTimeSense(solstice, SENSE_LEVELS.date)).toBe('Summer Solstice, Year 1 · about 12:00');
  });
});

describe('the ceiling at 20', () => {
  it('is declared on the skill', () => {
    expect(SKILLS[CHRONOSENSE_ID].maxLevel).toBe(20);
    // The minute tier sits past it: exact time needs a raised cap.
    expect(SENSE_LEVELS.minute).toBeGreaterThan(20);
  });

  it('discards XP at the cap instead of banking it', () => {
    const kernel = world(0, { [CHRONOSENSE_ID]: { level: 20, xp: 0 } });
    emit(kernel, grantSkillXp, { tags: ['time'], amount: 10_000 });
    expect(sense(kernel)).toMatchObject({ level: 20, xp: 0 });
  });

  it('a grant that crosses the cap stops there and forfeits the overflow', () => {
    const kernel = world(0, { [CHRONOSENSE_ID]: { level: 19, xp: 0 } });
    emit(kernel, grantSkillXp, { tags: ['time'], amount: 1_000_000 });
    expect(sense(kernel)).toMatchObject({ level: 20, xp: 0 });
  });

  it('a raised cap opens the road again, then closes at the new ceiling', () => {
    const kernel = world(0, { [CHRONOSENSE_ID]: { level: 20, xp: 0 } });
    expect(skillCap(reads(kernel), CHRONOSENSE_ID)).toBe(20);
    emit(kernel, raiseSkillCap, { id: CHRONOSENSE_ID, by: 5 });
    expect(skillCap(reads(kernel), CHRONOSENSE_ID)).toBe(25);
    emit(kernel, grantSkillXp, { tags: ['time'], amount: 1_000_000 });
    expect(sense(kernel)).toMatchObject({ level: 25, xp: 0 });
  });

  it('uncapped skills are untouched by all of this', () => {
    const kernel = world(0, { fighting: { level: 90, xp: 0 } });
    expect(skillCap(reads(kernel), 'fighting')).toBe(Infinity);
    emit(kernel, raiseSkillCap, { id: 'fighting', by: 5 });
    expect(slice<SkillsState>(kernel, 'skills').skills.fighting.capRaised).toBeUndefined();
  });
});

describe('the time sense in the view and the Character panel (new here)', () => {
  const view = (kernel: Kernel) => (kernel.view().systems.skills as SkillsView).timeSense;

  it('the view carries nothing before the sense, then what its level reads', () => {
    expect(view(world(at(12, 9, 23)))).toBeNull();
    const season = view(world(at(12, 9, 23), { [CHRONOSENSE_ID]: { level: SENSE_LEVELS.season, xp: 0 } }))!;
    expect(season.text).toBe('Morning · winter');
    expect(season.moons.map((m) => m.text)).toEqual(describeMoons(clockOf(at(12, 9, 23)), SENSE_LEVELS.season));
    expect(season.moons.map((m) => m.icon)).toEqual(['🌒', '🌔', '🌔']);
  });

  it('the readout says the clock cannot be read before the sense, and renders each moon line from the season level', () => {
    const none = render(TimeSenseReadout, { props: { sense: null } }).body;
    expect(none).toContain('Time: unknown until Chronosense manifests');
    expect(none).not.toContain('time-sense-moon');
    const daypart = render(TimeSenseReadout, { props: { sense: view(world(at(12, 9, 23), { [CHRONOSENSE_ID]: { level: 1, xp: 0 } })) } }).body;
    expect(daypart).toContain('Time: Morning');
    expect(daypart).not.toContain('time-sense-moon');
    const date = render(TimeSenseReadout, {
      props: { sense: view(world(at(12, 9, 23), { [CHRONOSENSE_ID]: { level: SENSE_LEVELS.date, xp: 0 } })) },
    }).body;
    expect(date).toContain('Time: Sixthday, 13th of First Month, Year 1 · about 09:00');
    expect(date.match(/data-testid="time-sense-moon"/g)).toHaveLength(3);
    expect(date).toContain('Middle Moon: waxing gibbous (day 13 of 28)');
  });
});

describe('time-resistance past the ceiling', () => {
  it('grants nothing at or below the base cap', () => {
    expect(timePenaltyMult(1)).toBe(1);
    expect(timePenaltyMult(20)).toBe(1);
  });

  it('follows the schedule: 1% a level, 3% on decades, 5% extra at 50/75/100', () => {
    expect(timePenaltyMult(21)).toBeCloseTo(0.99, 10);
    expect(timePenaltyMult(30)).toBeCloseTo(0.99 ** 9 * 0.97, 10);
    expect(timePenaltyMult(50)).toBeCloseTo(0.99 ** 27 * 0.97 ** 3 * 0.95, 10);
    expect(timePenaltyMult(75)).toBeCloseTo(0.99 ** 50 * 0.97 ** 5 * 0.95 ** 2, 10);
    expect(timePenaltyMult(100)).toBeCloseTo(0.99 ** 72 * 0.97 ** 8 * 0.95 ** 3, 10);
  });

  it('the full ladder shaves roughly two thirds off a time penalty', () => {
    const remaining = timePenaltyMult(100);
    expect(remaining).toBeGreaterThan(0.3);
    expect(remaining).toBeLessThan(0.35);
  });
});
