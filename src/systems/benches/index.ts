/**
 * Benches: the discipline registry, the layout rules and the bench run (the
 * same layout worked over and over on the clock). Port of old
 * `systems/disciplines.ts` and `systems/benchwork.ts` as far as the Alembic
 * uses them. The system that owns a bench registers it at module load
 * (`registerBench`); this system does not import its owners. See README.md.
 */
import {
  defineCommand,
  defineEvent,
  defineSystem,
  handle,
  OK,
  on,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type RequestDef,
  type SystemDef,
} from '../../kernel';
import combat from '../combat';
import { fillText, logLine } from '../log';
import { statBlockOf } from '../stats';
import world, { activityChanged, dropActivityNow, playerCommand } from '../world';
import { benchesText, benchJobTicks, DISCIPLINES, disciplines, TEXT, type Placement } from './defs';
import { migrations } from './migrations';

export * from './defs';
export * from './layouts';

export type BenchReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

/** What the owner of a bench answers. The old `benchPreview` and `benchCraft`. */
export interface BenchOwner {
  /** Whether the layout would make anything now, and why not. */
  preview(ctx: BenchReadCtx, placement: Placement): { ok: boolean; reason?: string };
  /** Work it once: spend and make. False when it could not be made (the owner logs why). */
  craft: RequestDef<{ placement: Placement }, boolean>;
}

const OWNERS = new Map<string, BenchOwner>();

/** Register the owner of a bench. Called at module load by the system that owns it. */
export function registerBench(discipline: string, owner: BenchOwner): void {
  if (OWNERS.has(discipline)) throw new Error(`benches: bench "${discipline}" is registered twice`);
  OWNERS.set(discipline, owner);
}

export function benchOwner(discipline: string): BenchOwner | undefined {
  return OWNERS.get(discipline);
}

// ---- slice ----

export interface BenchJob {
  discipline: string;
  /** Where the bench stands. Leaving cancels the run. */
  spot: string;
  /** The layout being repeated. */
  placement: Placement;
  /** Crafts still wanted; null: until the stock runs out. */
  remaining: number | null;
  ticksLeft: number;
  ticksPer: number;
  /** Crafts resolved per completion. */
  batch: number;
  /** Crafts finished so far. */
  done: number;
}

export interface BenchesState {
  job: BenchJob | null;
}

// ---- commands and events ----

/** Start a run: `count` crafts, or until the stock runs out (null). The old `startBenchWork`. */
export const startBench = defineCommand<{ discipline: string; placement: Placement; count: number | null }>(
  'benches/start',
);
/** Stop the run. The old `stopBenchWork`. */
export const stopBench = defineCommand<void>('benches/stop');

/**
 * A craft was made at a bench. Emitted by the bench's owner where the old
 * code emitted the bus event `craft`; quests hear it.
 */
export const benchCrafted = defineEvent<{ discipline: string; recipe?: string }>('benches/crafted');

type B = Ctx<BenchesState>;

function stopJob(ctx: B, reason?: string): void {
  const job = ctx.state.job;
  if (!job) return;
  ctx.state.job = null;
  // A single craft finishing quietly already logged its result.
  if (reason === 'finished' && job.done === 1) return;
  const disc = DISCIPLINES[job.discipline];
  ctx.emit(logLine, {
    msg: fillText(TEXT.stopped, { bench: disc?.benchName ?? job.discipline, reason: reason ?? 'stopped', done: job.done }),
    kind: 'action',
  });
}

/** One tick of the run. The old `tickBenchWork`. */
function tickJob(ctx: B): void {
  const job = ctx.state.job;
  if (!job) return;
  const w = ctx.read(world);
  if (w.spot !== job.spot || w.travel) {
    stopJob(ctx, 'left behind');
    return;
  }
  if (ctx.read(combat).fight) {
    stopJob(ctx, 'interrupted');
    return;
  }
  job.ticksLeft -= 1;
  if (job.ticksLeft > 0) return;
  const owner = OWNERS.get(job.discipline);
  for (let i = 0; i < job.batch; i++) {
    const made = owner ? ctx.request(owner.craft, { placement: job.placement }) : false;
    if (!made) {
      // The owner already logged why (out of stock, usually).
      stopJob(ctx, 'out of stock');
      return;
    }
    job.done += 1;
    if (job.remaining !== null) {
      job.remaining -= 1;
      if (job.remaining <= 0) {
        stopJob(ctx, 'finished');
        return;
      }
    }
  }
  job.ticksLeft = job.ticksPer;
}

// ---- view ----

export interface BenchJobView {
  discipline: string;
  spot: string;
  ticksLeft: number;
  ticksPer: number;
  /** 0 to 1, how far the craft underway is. */
  progress: number;
  done: number;
  remaining: number | null;
  batch: number;
}

export interface BenchesView {
  job: BenchJobView | null;
}

const benches = defineSystem<BenchesState, BenchesView>({
  id: 'benches',
  version: 1,
  migrations,
  initial: () => ({ job: null }),
  order: 15,
  content: { disciplines, benches_text: benchesText },

  tick: (ctx) => tickJob(ctx),

  commands: [
    handle(startBench, (ctx, { discipline, placement, count }) => {
      const disc = DISCIPLINES[discipline];
      if (!disc) return skipped(`no bench has the id "${discipline}"`);
      const owner = OWNERS.get(discipline);
      if (!owner) return skipped(`no system works the bench "${discipline}"`);
      const check = owner.preview(ctx, placement);
      if (!check.ok) {
        const reason = check.reason ?? `the ${disc.benchName ?? disc.name} cannot work this layout`;
        ctx.emit(logLine, { msg: fillText(TEXT.locked, { reason }), kind: 'danger' });
        return skipped(reason);
      }
      // The bench is the activity now.
      ctx.request(dropActivityNow, undefined);
      const { ticksPer, batch } = benchJobTicks(disc, placement, statBlockOf(ctx).craftSpeed);
      ctx.state.job = {
        discipline,
        spot: ctx.read(world).spot,
        placement: JSON.parse(JSON.stringify(placement)) as Placement,
        remaining: count,
        ticksLeft: ticksPer,
        ticksPer,
        batch,
        done: 0,
      };
      // A bench run is the player's own work: it ends a knockout return.
      ctx.emit(playerCommand, { type: startBench.type });
      // A single craft announces itself when it lands; only a run is news.
      if (count !== 1) {
        ctx.emit(logLine, {
          msg: fillText(TEXT.started, {
            bench: disc.benchName ?? disc.name,
            count: count ? fillText(TEXT.times, { qty: count }) : TEXT.until_stopped,
          }),
          kind: 'action',
        });
      }
      return OK;
    }),
    handle(stopBench, (ctx) => {
      if (!ctx.state.job) return skipped('no bench run is going');
      stopJob(ctx);
      return OK;
    }),
  ],

  events: [
    // Picking an activity steps away from the bench (old `selectActivity`).
    on(activityChanged, (ctx, { payload }) => {
      if (payload.activity !== null && ctx.state.job) ctx.state.job = null;
    }),
  ],

  view: (ctx): BenchesView => {
    const job = ctx.state.job;
    return {
      job: job
        ? {
            discipline: job.discipline,
            spot: job.spot,
            ticksLeft: job.ticksLeft,
            ticksPer: job.ticksPer,
            progress: job.ticksPer > 0 ? Math.min(1, Math.max(0, 1 - Math.max(0, job.ticksLeft) / job.ticksPer)) : 0,
            done: job.done,
            remaining: job.remaining,
            batch: job.batch,
          }
        : null,
    };
  },
});

export default benches;
