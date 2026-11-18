/**
 * The bench run (old `systems/benchwork.ts`) at the Alembic, and the session
 * memory of layouts (old `tests/benchLayouts.test.ts`, ported as it was).
 * The old build had no test file for `benchwork.ts`; these cases state its
 * rules.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AlchemyState } from '../src/systems/alchemy';
import {
  benchJobTicks,
  benchPace,
  DISCIPLINES,
  forgetLayouts,
  recallLayout,
  rememberLayout,
  startBench,
  stopBench,
  type BenchesState,
  type Placement,
} from '../src/systems/benches';
import { startForced } from '../src/systems/combat';
import { selectActivity, travelTo } from '../src/systems/world';
import { SITES } from './combatHelpers';
import { ask, patch, slice } from './helpers';
import { gameAt, worldOf } from './worldHelpers';
import { logOf } from './combatHelpers';

const LAYOUT: Placement = { step1: { id: 'spring_water', quality: 'c' }, step2: { id: 'mendroot', quality: 'c' } };

function atAlembic(seed = 1, units = 10): Kernel {
  const g = gameAt(seed, 'the_alembics');
  patch(g, (slices) => {
    slices.materials.stock.spring_water = { c: units };
    slices.materials.stock.mendroot = { c: units };
  });
  return g;
}

const job = (g: Kernel) => slice<BenchesState>(g, 'benches').job;
const flasks = (g: Kernel) => slice<AlchemyState>(g, 'alchemy').flasks.length;
const start = (g: Kernel, count: number | null, placement: Placement = LAYOUT) =>
  g.dispatch(startBench({ discipline: 'alchemy', placement, count }));

describe('the bench run', () => {
  it('a single brew takes 45 ticks, spends nothing until it lands, and ends without a stop line', () => {
    const g = atAlembic();
    expect(start(g, 1).ok).toBe(true);
    expect(job(g)?.ticksPer).toBe(45);
    g.tick(44);
    expect(flasks(g)).toBe(0);
    expect(slice<{ stock: Record<string, Record<string, number>> }>(g, 'materials').stock.mendroot.c).toBe(10);
    g.tick(1);
    expect(flasks(g)).toBe(1);
    expect(job(g)).toBeNull();
    expect(logOf(g).some((l) => l.startsWith('⏹️'))).toBe(false);
    expect(logOf(g).some((l) => l.startsWith('▶️'))).toBe(false);
  });

  it('a run of three announces itself and stops "finished"', () => {
    const g = atAlembic();
    expect(start(g, 3).ok).toBe(true);
    expect(logOf(g)).toContain('▶️ Alembic: working ×3');
    g.tick(135);
    expect(flasks(g)).toBe(3);
    expect(logOf(g)).toContain('⏹️ Alembic: finished (3 done)');
  });

  it('keep going runs until the stock is out, and says why it stopped', () => {
    const g = atAlembic(1, 2);
    expect(start(g, null).ok).toBe(true);
    expect(logOf(g)).toContain('▶️ Alembic: working until stopped');
    g.tick(45 * 3);
    expect(flasks(g)).toBe(2);
    expect(job(g)).toBeNull();
    expect(logOf(g)).toContain('⏹️ Alembic: out of stock (2 done)');
  });

  it('refuses a layout the Alembic would not brew, with the reason logged', () => {
    const g = atAlembic();
    const result = start(g, 1, { step1: { id: 'spring_water', quality: 'c' } });
    expect(result.ok).toBe(false);
    expect(logOf(g)).toContain('🔒 An alembic needs at least two reagents');
    expect(job(g)).toBeNull();
  });

  it('the bench is the activity: starting a run drops the activity, picking one drops the run', () => {
    const g = atAlembic();
    expect(g.dispatch(selectActivity({ activity: 'job_retorts' })).ok).toBe(true);
    expect(worldOf(g).activity).toBe('job_retorts');
    expect(start(g, 3).ok).toBe(true);
    expect(worldOf(g).activity).toBeNull();
    expect(g.dispatch(selectActivity({ activity: 'job_retorts' })).ok).toBe(true);
    expect(job(g)).toBeNull();
  });

  it('walking away leaves the bench behind', () => {
    const g = atAlembic();
    expect(start(g, 3).ok).toBe(true);
    expect(g.dispatch(travelTo({ to: 'alembic_row_gate' })).ok).toBe(true);
    g.tick(2);
    expect(job(g)).toBeNull();
    expect(logOf(g)).toContain('⏹️ Alembic: left behind (0 done)');
  });

  it('a fight interrupts it', () => {
    const g = atAlembic();
    expect(start(g, 3).ok).toBe(true);
    expect(ask(g, startForced, { site: SITES.woods_edge })).toBe(true);
    g.tick();
    expect(job(g)).toBeNull();
    expect(logOf(g)).toContain('⏹️ Alembic: interrupted (0 done)');
  });

  it('stop ends it, and a second stop is refused', () => {
    const g = atAlembic();
    expect(start(g, 3).ok).toBe(true);
    expect(g.dispatch(stopBench(undefined)).ok).toBe(true);
    expect(logOf(g)).toContain('⏹️ Alembic: stopped (0 done)');
    expect(g.dispatch(stopBench(undefined)).ok).toBe(false);
  });

  it('a bench with no owner is refused', () => {
    const g = atAlembic();
    expect(g.dispatch(startBench({ discipline: 'no_such_bench', placement: LAYOUT, count: 1 })).ok).toBe(false);
  });
});

describe('the clock', () => {
  it('glassware answers to the reaction, not the hand: the Alembic ignores craft speed', () => {
    expect(benchJobTicks(DISCIPLINES.alchemy, LAYOUT, 5)).toEqual({ ticksPer: 45, batch: 1 });
  });

  it('a skill-scaled bench divides by craft speed, floors at one second, and batches past it', () => {
    expect(benchPace(1, 60)).toEqual({ ticksPer: 60, batch: 1 });
    expect(benchPace(2, 60)).toEqual({ ticksPer: 30, batch: 1 });
    expect(benchPace(12, 60)).toEqual({ ticksPer: 10, batch: 2 });
  });
});

describe('the last layout at each bench', () => {
  beforeEach(forgetLayouts);

  it('has nothing for a bench the session has not touched', () => {
    expect(recallLayout('cooking')).toBeUndefined();
  });

  it('keeps one layout per bench', () => {
    rememberLayout('cooking', { main: { id: 'raw_meat', quality: 'c' } }, 8);
    rememberLayout('baking', { main: { id: 'wheat', quality: 'b' } }, null);
    expect(recallLayout('cooking')).toEqual({ placement: { main: { id: 'raw_meat', quality: 'c' } }, units: 8 });
    expect(recallLayout('baking')?.placement.main?.id).toBe('wheat');
  });

  it('a later layout replaces the earlier one', () => {
    rememberLayout('cooking', { main: { id: 'raw_meat', quality: 'c' } }, 8);
    rememberLayout('cooking', { second: { id: 'wild_onion', quality: 'a' } }, null);
    expect(recallLayout('cooking')).toEqual({ placement: { second: { id: 'wild_onion', quality: 'a' } }, units: null });
  });

  it('copies what it is given, so editing the bench afterwards does not edit the memory', () => {
    const stack = { id: 'raw_meat', quality: 'c' as const };
    const placement: Placement = { main: stack };
    rememberLayout('cooking', placement, 12);
    placement.main = { id: 'wild_onion', quality: 'c' };
    (stack as { quality: string }).quality = 's';
    expect(recallLayout('cooking')?.placement.main).toEqual({ id: 'raw_meat', quality: 'c' });
  });

  it('drops empty slots', () => {
    rememberLayout('cooking', { main: { id: 'raw_meat', quality: 'c' }, second: undefined }, null);
    expect(Object.keys(recallLayout('cooking')!.placement)).toEqual(['main']);
  });
});
