/**
 * Shadow Clone, deployed. Port of old `systems/clones.ts` (user 2026-11-03)
 * and the clone half of old `facet/host.ts` (`cloneCell`, `cloneRulesOf`,
 * `syncCloneCount`).
 *
 * A clone is sent to one task at one spot: a gathering or job activity, or a
 * bench run with its own copy of the layout. It works that task on its own,
 * whatever the player does, until:
 *   A) a clone is sent while every clone is out: the oldest one fades;
 *   B) the player recalls it;
 *   C) the player stands more than max(0, floor((level - 10) / 5)) floors
 *      from it (Threshold is floor 0, the ascent's first floor 1);
 *   D) the player is knocked out, by anything.
 * At work it keeps the player's pace on an activity and yields its share
 * (40%) of the materials or pay; at a bench it makes whole crafts from the
 * player's stock, each taking the bench's time divided by that share. Its
 * skill XP is its own share (25%); on an activity it earns no attribute XP.
 * The numbers come from the held ability's clone cell; with no such cell, no
 * clones.
 */
import type { Ctx, DeepReadonly } from '../../kernel';
import { benchJobTicks, benchOwner, DISCIPLINES, type AssembledPlacement, type Placement } from '../benches';
import { bumpCounter } from '../counters';
import { addGold } from '../gold';
import levels from '../levels';
import { logLine, repeatLine } from '../log';
import { grantMaterial, MATERIALS } from '../materials';
import { grantSkillXp } from '../skills';
import { scopedMult, statBlockOf, type DerivedStats, type StatKey } from '../stats';
import world, {
  activityCost,
  activityFillRate,
  activityOutputMult,
  activityXpTags,
  floorOfSpot,
  SPOTS,
  spotActivities,
  type ActivityDef,
} from '../world';
import type { FacetCell, FacetDoc } from './facet';
import type { QuantityReads } from './quantities';
import { PLAYER_REF, type CloneJob, type FacetState } from './state';

type C = Ctx<FacetState>;

/** What the held ability allows: the most clones out at once, a clone's yield share and its skill XP share. */
export interface CloneRules {
  max: number;
  yieldShare: number;
  xpShare: number;
}

/** The held document's clone cell: the first cell whose carrier states `cloneYield`. Null without one. */
export function cloneCell(
  docs: readonly DeepReadonly<FacetDoc>[],
): { doc: DeepReadonly<FacetDoc>; cell: DeepReadonly<FacetCell> } | null {
  for (const doc of docs) {
    const cell = doc.cells?.find((c) => typeof c.status?.cloneYield === 'number');
    if (cell) return { doc, cell };
  }
  return null;
}

/**
 * The rules of the held ability, or null when it has no clone cell. Call
 * inside `withCtx` or `withReads`: the cap reads the character's level.
 */
export function rulesOf(docs: readonly DeepReadonly<FacetDoc>[]): CloneRules | null {
  const found = cloneCell(docs);
  if (!found) return null;
  const yieldShare = found.cell.status!.cloneYield as number;
  const xp = found.cell.status!.cloneXp;
  return {
    max: Math.max(0, Math.floor(Facet.evalExpr(found.cell.cap, { ref: PLAYER_REF, facet: found.doc as FacetDoc, bindings: {} }))),
    yieldShare,
    xpShare: typeof xp === 'number' ? xp : yieldShare,
  };
}

/** The floor a spot is on: its ascent floor's index, 0 off the ascent (Threshold, the hold). */
export function floorIndexOf(spotId: string): number {
  return floorOfSpot(spotId)?.index ?? 0;
}

/** How many floors from the player a clone keeps working. */
export function cloneReach(level: number): number {
  return Math.max(0, Math.floor((level - 10) / 5));
}

type CloneActivity = ActivityDef & { kind: 'gather' | 'job' };

/** A gathering or job activity at a spot, which a clone can work; null otherwise. */
export function cloneActivity(spotId: string, activityId: string | undefined): CloneActivity | null {
  const spot = SPOTS[spotId];
  const act = spot ? spotActivities(spot).find((a) => a.id === activityId) : undefined;
  return act && (act.kind === 'gather' || act.kind === 'job') ? (act as CloneActivity) : null;
}

/** What a clone is doing, for lines and lists: "Wash Out the Retorts" or "Cutting Board". */
export function cloneTask(job: Pick<DeepReadonly<CloneJob>, 'spot' | 'activity' | 'bench'>): string {
  if (job.bench) return DISCIPLINES[job.bench.discipline]?.name ?? job.bench.discipline;
  return cloneActivity(job.spot, job.activity)?.name ?? job.activity ?? 'work';
}

/** Why a clone cannot be sent now, or null when it can. The old `cloneBlocked`. */
export function cloneBlocked(reads: QuantityReads, rules: CloneRules | null): string | null {
  if (!rules || rules.max < 1) return 'No Shadow Clone';
  if (reads.read(world).recovering) return 'Knocked out';
  return null;
}

/** The clones out, oldest first: none while the field is absent. */
export const clonesOf = (state: DeepReadonly<FacetState>): readonly DeepReadonly<CloneJob>[] => state.clones ?? [];

/** Write the list; an empty list leaves the field absent, as a new slice has it. */
function setClones(ctx: C, list: CloneJob[]): void {
  if (list.length) ctx.state.clones = list;
  else delete ctx.state.clones;
}

function say(ctx: C, msg: string): void {
  ctx.emit(logLine, { msg, kind: 'action' });
}

/** Write the count out onto the clone cell, so the carrier reserves the mana. The old `syncCloneCount`. */
function synced(ctx: C): void {
  const found = cloneCell(ctx.state.docs);
  if (!found) return;
  const cell = found.cell as FacetCell;
  const out = ctx.state.clones?.length ?? 0;
  if ((cell.state?.v ?? 0) !== out) Facet.cellStep(cell, 'set', out, { ref: PLAYER_REF, facet: found.doc as FacetDoc, bindings: {} });
}

function remove(ctx: C, gone: readonly CloneJob[]): void {
  if (!gone.length) return;
  setClones(ctx, (ctx.state.clones ?? []).filter((c) => !gone.includes(c)));
  synced(ctx);
}

/**
 * Send a clone. With every clone out, the oldest fade first. Call inside
 * `withCtx`; the caller has checked `cloneBlocked`. The old `send`.
 */
export function sendClone(ctx: C, rules: CloneRules, job: Omit<CloneJob, 'order'>): void {
  const list = ctx.state.clones ?? [];
  const faded: CloneJob[] = [];
  while (list.length - faded.length >= rules.max) {
    const oldest = list.find((c) => !faded.includes(c))!;
    faded.push(oldest);
    say(ctx, `👥 Your oldest clone fades from ${cloneTask(oldest)}.`);
  }
  const kept = list.filter((c) => !faded.includes(c));
  const order = kept.reduce((n, c) => Math.max(n, c.order), 0) + 1;
  setClones(ctx, [...kept, { order, ...job }]);
  synced(ctx);
  say(ctx, `👥 A clone takes up ${cloneTask(job)} at ${SPOTS[job.spot]?.name ?? job.spot}.`);
}

/** The clock of a bench run for a clone: the bench's pace, each pass divided by the yield share. The old `sendCloneToBench`. */
export function benchPassOf(
  ctx: C,
  rules: CloneRules,
  discipline: string,
  placement: Placement,
  duration?: number,
  forge?: AssembledPlacement,
): { ticksPer: number; batch: number } {
  const disc = DISCIPLINES[discipline];
  const owner = benchOwner(discipline);
  const assembled = disc.assembles && owner?.ticks ? owner.ticks(forge ?? {}) : undefined;
  const pace = benchJobTicks(disc, placement, statBlockOf(ctx).craftSpeed, duration, assembled);
  return { ticksPer: Math.ceil(pace.ticksPer / rules.yieldShare), batch: pace.batch };
}

/** Recall one clone. False when none has that order. The old `recallClone`. */
export function recallOne(ctx: C, order: number): boolean {
  const job = ctx.state.clones?.find((c) => c.order === order);
  if (!job) return false;
  remove(ctx, [job]);
  say(ctx, `👥 You recall the clone from ${cloneTask(job)}.`);
  return true;
}

/** Recall every clone. How many were out. The old `recallClones`. */
export function recallAll(ctx: C): number {
  const all = [...(ctx.state.clones ?? [])];
  remove(ctx, all);
  if (all.length) say(ctx, `👥 You recall ${all.length === 1 ? 'your clone' : `all ${all.length} clones`}.`);
  return all.length;
}

/** Floor plus a roll on the remainder. The old `integerYield`. */
function integerYield(ctx: C, expected: number): number {
  const whole = Math.floor(expected);
  return whole + (ctx.rng.chance(expected - whole) ? 1 : 0);
}

/**
 * Each game tick with clones out: the end rules, then each clone's work.
 * Call inside `withCtx`. The old `tickClones`.
 */
export function tickClones(ctx: C): void {
  const out = () => ctx.state.clones ?? [];
  const rules = rulesOf(ctx.state.docs);
  if (!rules) {
    remove(ctx, [...out()]);
    return;
  }
  const w = ctx.read(world);
  if (w.recovering) {
    remove(ctx, [...out()]);
    say(ctx, '👥 Knocked out: your clones vanish.');
    return;
  }
  // Fewer allowed than are out (a reset level): the oldest go first.
  const list = out();
  if (list.length > rules.max) remove(ctx, list.slice(0, list.length - rules.max));
  const reach = cloneReach(ctx.read(levels).level);
  const here = floorIndexOf(w.spot);
  const far = out().filter((c) => Math.abs(floorIndexOf(c.spot) - here) > reach);
  for (const c of far) say(ctx, `👥 Too far away: your clone at ${cloneTask(c)} vanishes.`);
  remove(ctx, far);
  // Work whose activity no longer exists (content changed under a save) ends quietly.
  remove(
    ctx,
    out().filter((c) => !c.bench && !cloneActivity(c.spot, c.activity)),
  );
  if (!out().length) return;
  const stats = statBlockOf(ctx);
  for (const c of out()) {
    if (c.bench) workBench(ctx, c.bench, rules);
    else workActivity(ctx, c, cloneActivity(c.spot, c.activity)!, rules, stats);
  }
}

function workActivity(ctx: C, job: CloneJob, act: CloneActivity, rules: CloneRules, stats: Readonly<DerivedStats>): void {
  job.progress += activityFillRate(ctx, act, stats);
  const cost = activityCost(act, stats);
  if (job.progress < cost) return;
  job.progress -= cost;
  const tags = activityXpTags(act);
  const xp = 0.25 * (act.ticksPer ?? 0) * rules.xpShare;
  if (xp > 0) ctx.emit(grantSkillXp, { tags, amount: xp });
  if (act.kind === 'gather') {
    if (!act.material) return;
    const amount = integerYield(ctx, activityOutputMult(ctx, stats, act) * rules.yieldShare);
    if (amount <= 0) return;
    ctx.request(grantMaterial, { id: act.material, qty: amount, luck: stats.loot * scopedMult(ctx, 'loot' as StatKey, tags) });
    ctx.emit(bumpCounter, { key: `gather:${act.material}`, amount });
    const mat = MATERIALS[act.material];
    ctx.emit(
      logLine,
      repeatLine({
        group: `clone:${job.order}`,
        prefix: '👥 Clone gathered:',
        tally: [{ label: `${mat?.icon ?? '📦'} ${mat?.name ?? act.material}`, qty: amount }],
        kind: 'loot',
      }),
    );
  } else {
    const mult = act.outputFactors?.length ? activityOutputMult(ctx, stats, act) : stats.goldGain;
    const pay = Math.round((act.gold ?? 0) * mult * rules.yieldShare);
    if (pay <= 0) return;
    ctx.request(addGold, { amount: pay, earned: true });
    ctx.emit(
      logLine,
      repeatLine({
        group: `clone:${job.order}`,
        prefix: '👥 Clone pay:',
        tally: [{ label: 'gold', qty: pay, style: 'amount' }],
        kind: 'action',
      }),
    );
  }
}

/**
 * One tick of a clone's bench run. Short of stock it waits for the next pass
 * rather than leaving, and says nothing (the old `cloneCraft` previewed first
 * so a clone short of stock waits quietly). The skill XP of its crafts is its
 * share (`xpScale`, the old `scaledSkillXp`).
 */
function workBench(ctx: C, bench: NonNullable<CloneJob['bench']>, rules: CloneRules): void {
  bench.ticksLeft -= 1;
  if (bench.ticksLeft > 0) return;
  bench.ticksLeft = bench.ticksPer;
  const owner = benchOwner(bench.discipline);
  if (!owner) return;
  for (let i = 0; i < bench.batch; i++) {
    if (!owner.preview(ctx, bench.placement, bench.duration, bench.forge).ok) break;
    const made = ctx.request(owner.craft, {
      placement: bench.placement,
      ...(bench.duration !== undefined ? { duration: bench.duration } : {}),
      ...(bench.forge ? { forge: bench.forge } : {}),
      xpScale: rules.xpShare,
    });
    if (!made) break;
  }
}
