/**
 * The four states of the speed test (`tests/speed.test.ts`), built from John
 * the way the baseline of docs/PERFORMANCE.md (section 2.2) built them. No
 * stored save files: a save format change cannot break them.
 *
 * John (seed 42, Skip tutorial, `through: 7`) climbs to floor 6, prestiges,
 * and climbs run 2 to floor 7. The state at the close of the segments
 * `floor1`, `floor6` and `floor7` is kept. From each, a new kernel loads the
 * state, lets any fight in progress end, and the game's own commands set the
 * scenario:
 *
 * - floor1: walk to `f1_storerooms` (the Vermin Hall), hunt. The spot's
 *   6-fight limit is lifted (`liftFloorOneLimit`), as the baseline did in the
 *   set-up and in every measuring process; floor 1 has no other hunting spot.
 * - floor6: walk to `f6_tunnels`, hunt.
 * - town: from the floor 6 state, leave the tower, walk to `chancery_arch`, no
 *   activity.
 * - floor7: walk to `f7_docks`, hunt.
 *
 * Each state is a save envelope as JSON text without the probe's slice, so a
 * kernel over `systems` alone loads it, as the page and the catch-up worker
 * do.
 */
import { performance } from 'node:perf_hooks';
import { TPS, type Command, type Ctx } from '../src/kernel';
import combat, { type CombatState } from '../src/systems/combat';
import world, { climb, selectActivity, SPOTS, travelTo, type WorldState } from '../src/systems/world';
import { runJohn, type ClimbSegment } from './john';
import { makeGame, run } from './helpers';

export const SPEED_STATES = ['floor1', 'floor6', 'town', 'floor7'] as const;
export type SpeedState = (typeof SPEED_STATES)[number];

export interface SpeedStates {
  /** Save envelope JSON per state. */
  json: Record<SpeedState, string>;
  /** Wall-clock ms John's climb took. */
  johnMs: number;
  /** Ticks of set-up after the snapshot, per state (walking, a fight ending). */
  setupTicks: Record<SpeedState, number>;
}

/** The segment whose close each state starts from. */
const FROM: Record<SpeedState, ClimbSegment> = { floor1: 'floor1', floor6: 'floor6', town: 'floor6', floor7: 'floor7' };

/**
 * Delete the Vermin Hall's fight limit from the spot record; returns a
 * function that puts it back. The baseline lifted it in the set-up of every
 * state and in every measuring process.
 */
export function liftFloorOneLimit(): () => void {
  const spot = SPOTS.f1_storerooms as { fightLimit?: number };
  const had = Object.prototype.hasOwnProperty.call(spot, 'fightLimit');
  const was = spot.fightLimit;
  delete spot.fightLimit;
  return () => {
    if (had) spot.fightLimit = was;
  };
}

/** John's climb, then the four scenarios. Call with the floor 1 limit in place: John's climb needs it. */
export function buildSpeedStates(): SpeedStates {
  const snaps: Partial<Record<ClimbSegment, string>> = {};
  const started = performance.now();
  const report = runJohn({
    seed: 42,
    weapon: 'skip',
    through: 7,
    onRecord: (seg, _t, k) => {
      if ((seg === 'floor1' || seg === 'floor6' || seg === 'floor7') && snaps[seg] === undefined) snaps[seg] = JSON.stringify(k.save(0));
    },
  });
  const johnMs = performance.now() - started;
  for (const seg of ['floor1', 'floor6', 'floor7'] as const) {
    if (snaps[seg] === undefined) throw new Error(`John did not close ${seg} (stuck: ${Object.keys(report.stuck).join(', ') || 'none'})`);
  }

  const restore = liftFloorOneLimit();
  try {
    const json = {} as Record<SpeedState, string>;
    const setupTicks = {} as Record<SpeedState, number>;
    for (const name of SPEED_STATES) {
      const built = scenario(name, snaps[FROM[name]]!);
      json[name] = built.json;
      setupTicks[name] = built.ticks;
    }
    return { json, johnMs, setupTicks };
  } finally {
    restore();
  }
}

function scenario(name: SpeedState, snapshot: string): { json: string; ticks: number } {
  const k = makeGame({ seed: 1 });
  const loaded = k.load(JSON.parse(snapshot));
  if (!loaded.ok) throw new Error(`${name}: the snapshot did not load: ${loaded.error}`);
  const eye = run(k, (ctx) => ctx) as Ctx<unknown>;
  const W = () => eye.read(world) as WorldState;
  const C = () => eye.read(combat) as CombatState;
  const send = (command: Command) => {
    const r = k.dispatch(command);
    if (!r.ok) throw new Error(`${name}: ${command.type} refused: ${r.reason}`);
  };
  let ticks = 0;
  const until = (done: () => boolean, max: number) => {
    for (let i = 0; !done() && i < max; i++) {
      k.tick();
      ticks++;
    }
    return done();
  };
  const walk = (spot: string) => {
    for (let leg = 0; leg < 8 && W().spot !== spot; leg++) {
      if (C().fight?.forced) until(() => !C().fight, 5 * 60 * TPS);
      send(travelTo({ to: spot }));
      until(() => !W().travel && W().travelPlan.length === 0, 10 * 60 * TPS);
    }
    if (W().spot !== spot) throw new Error(`${name}: did not reach ${spot}, at ${W().spot}`);
  };

  // Let a fight in progress end first: the baseline's states held no fight.
  until(() => !C().fight && !W().recovering, 10 * 60 * TPS);
  if (name === 'floor1') {
    walk('f1_storerooms');
    send(selectActivity({ activity: 'hunt' }));
  } else if (name === 'floor6') {
    walk('f6_tunnels');
    send(selectActivity({ activity: 'hunt' }));
  } else if (name === 'town') {
    send(climb({ floor: null }));
    until(() => !W().travel, 60 * TPS);
    walk('chancery_arch');
  } else {
    walk('f7_docks');
    send(selectActivity({ activity: 'hunt' }));
  }
  const envelope = k.save(0);
  delete (envelope.slices as Record<string, unknown>).probe;
  return { json: JSON.stringify(envelope), ticks };
}
