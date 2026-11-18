/**
 * Port of the old `tests/job.test.ts`.
 *
 * The old file tested two pieces of the UI: `currentJob` (`ui/lib/job.ts`, the
 * job strip of the header) and `RateMeter` (`ui/lib/rates.svelte.ts`, the rate
 * chip). Neither is ported. The numbers the strip drew for an activity cycle
 * and for a walk are in the published view of `world` (`activity.progress`,
 * `travel.progress`); the cases that read only those are ported on the view.
 * The rest are `it.todo`.
 *
 * The old cases stood at the training area of the hold (a drill and a dummy
 * to hunt). Here: `the_sand` (`train_dex_sand` and `hunt`).
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { statBlockOf } from '../src/systems/stats';
import world, { activityCost, activityFillRate, currentActivity, selectActivity, SPOTS, type WorldView } from '../src/systems/world';
import { patch, reads } from './helpers';
import { gameAt, patchWorld, sent, worldOf } from './worldHelpers';

const DRILL = 'train_dex_sand';

/** A game standing at the Sand (a drill and a hunt). */
const atTraining = (seed = 1): Kernel => gameAt(seed, 'the_sand');

const viewOf = (k: Kernel): WorldView => k.view().systems[world.id] as WorldView;

/** The bars the view publishes stay inside 0 to 1. */
function expectBars(k: Kernel): void {
  const view = viewOf(k);
  for (const bar of [view.activity?.progress, view.travel?.progress]) {
    if (bar === undefined) continue;
    expect(Number.isFinite(bar)).toBe(true);
    expect(bar).toBeGreaterThanOrEqual(0);
    expect(bar).toBeLessThanOrEqual(1);
  }
  if (view.activity) expect(view.activity.name.length).toBeGreaterThan(0);
}

describe('currentJob', () => {
  it('reads idle with no bar when nothing runs', () => {
    const k = atTraining();
    const view = viewOf(k);
    expect(view.activity).toBeNull();
    expect(view.travel).toBeNull();
    expect(view.recovering).toBe(false);
  });

  it('shows an activity cycle: the share done and the time left', () => {
    const k = atTraining();
    expect(sent(k, selectActivity({ activity: DRILL }))).toBe(true);
    const start = viewOf(k).activity!;
    expect(start.kind).toBe('train');
    expect(start.name).toBe(SPOTS.the_sand.activities.find((a) => a.id === DRILL)!.name);
    expect(start.progress).toBe(0);
    // The time left, as the old strip computed it.
    const act = currentActivity(worldOf(k))!;
    const stats = statBlockOf(reads(k));
    expect((activityCost(act, stats) - worldOf(k).activityProgress) / activityFillRate(reads(k), act, stats)).toBeGreaterThan(0);
    let highest = 0;
    for (let i = 0; i < 20; i++) {
      k.tick();
      expectBars(k);
      expect(viewOf(k).activity?.kind).toBe('train');
      highest = Math.max(highest, viewOf(k).activity!.progress);
    }
    expect(highest).toBeGreaterThan(0);
  });

  it.todo('agrees with the stats it is given (UI step: the job strip, `ui/lib/job.ts`)');
  it.todo('shows a hunt with no cycle bar between fights, then the front foe’s HP in a fight (UI step: the job strip, `ui/lib/job.ts`)');
  it.todo('shows a combat bar of null when no foe is up front (UI step: the job strip, `ui/lib/job.ts`)');

  it('shows the walk, a knockout, a performance, bench work and rest-before-a-fight: the walk', () => {
    const k = atTraining();
    patchWorld(k, (w) => {
      w.travel = { from: 'the_sand', to: 'ironyard_gate', ticksLeft: 25, total: 100 };
    });
    const view = viewOf(k);
    expect(view.travel?.progress).toBeCloseTo(0.75, 5);
    expect(view.travel?.secondsLeft).toBe(3);
    expect(view.activity).toBeNull();
    expectBars(k);
  });
  it.todo(
    'shows the walk, a knockout, a performance, bench work and rest-before-a-fight: the knockout and the rest before a fight (UI step: the job strip, `ui/lib/job.ts`)',
  );
  it.todo('shows the walk, a knockout, a performance, bench work and rest-before-a-fight: a performance and bench work (step 3: performances and benches)');

  // 30 s limit since the alchemy port: 2.3 s alone, over 5 s under the full parallel run.
  it('keeps pct inside 0..1 or null across a long mixed run', { timeout: 30000 }, () => {
    const k = atTraining(5);
    patch(k, (slices) => {
      slices.levels.level = 30;
    });
    const picks = [DRILL, 'hunt', null, 'hunt', DRILL];
    for (const pick of picks) {
      k.dispatch(selectActivity({ activity: pick }));
      for (let i = 0; i < 400; i++) {
        k.tick();
        expectBars(k);
      }
    }
    expect(k.staleStats()).toEqual([]);
  });

  it.todo('puts the walk before a knockout, a knockout before everything it interrupts (UI step: the job strip, `ui/lib/job.ts`)');
});

describe('the rate chip', () => {
  it.todo('reads blank until the window spans enough game time (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
  it.todo('reports per-minute figures over the last 600 ticks (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
  it.todo('forgets what is older than the window (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
  it.todo('stays at its figure while paused, and stepping while paused keeps it (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
  it.todo('clears on a jump of more than 600 ticks (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
  it.todo('keeps its figure across a jump of exactly 600 ticks (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
  it.todo('clears when the prestige count changes (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
  it.todo('clears on a sample lower than the one before it, and never reads negative (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
  it.todo('ignores samples closer than a second apart (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
  it.todo('clear() empties the window (UI step: the rate chip, `ui/lib/rates.svelte.ts`)');
});
