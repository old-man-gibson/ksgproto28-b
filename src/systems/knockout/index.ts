/**
 * The knockout: what follows a defeat. Port of the old
 * `systems/knockoutReturn.ts`, the knockout half of `onDefeat`
 * (`systems/combat.ts`), the three knockout branches of
 * `tickPlayerStatuses` and the recovery branch of `tickAction`
 * (`systems/actions.ts`), and `returnRecoverTarget` (`systems/huntrest.ts`).
 * See README.md in this folder.
 *
 * A knockout leaves 1 HP, throws the character to the haven and starts the
 * recovery. It records the work it interrupted; when the recovery ends the
 * tick walks back and resumes. A knockout never leaves the character idle
 * while a place to work is known.
 *
 * Phases of a return, in the order a failing spot moves through them:
 * - `return`: back to the spot of the fall. A win there ends it.
 * - `fallback`: after 5 knockouts in a row at one spot, or when that spot
 *   cannot be walked back to, hunt the proven spot until 200 wins or 2 hours,
 *   then retry the target. With no usable proven spot, a spot with a fight
 *   budget that was won at and not lost at since stands in; with neither, a
 *   roofed endless hunt on the floor of the fall.
 * - `hold`: with no fallback, wait at the haven and probe the target after
 *   10, 20, 40, then 80 minutes.
 */
import {
  defineCommand,
  defineSystem,
  handle,
  OK,
  on,
  PLAYER,
  registry,
  skipped,
  TPS,
  type Ctx,
  type DeepReadonly,
} from '../../kernel';
import clock, { totalTicksOf } from '../clock';
import combat, { fightWon, inForcedFight, playerDefeated, restTarget } from '../combat';
import counters, { bumpCounter, clearCounter, counterValue, raiseCounter, setCounter } from '../counters';
import { festivalFloorOf } from '../festival';
import { floorUnlocked, ladderReader, rungIndex, type FloorDef } from '../ladder';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import resources, { availableMax, defeatPlayer, isAlive, poolHooks, resourceValue } from '../resources';
import { statBlockOf } from '../stats';
import { conditionDamage, conditionDetonated, conditionFatal } from '../statuses';
import world, {
  canStartActivity,
  edgesFrom,
  eligibleAt,
  findPath,
  floorOfSpot,
  goNow,
  playerCommand,
  recoverNow,
  retreat,
  rideNow,
  spotActivities,
  spotCleared,
  SPOTS,
  startActivityNow,
  stayOnLeg,
  towerAt,
  type SpotDef,
  type WorldState,
} from '../world';
import knockoutTextData from './content/knockout_text.json';
import { migrations } from './migrations';

// ---- tuning ----

/** Knockouts in a row at one spot after which the return stops going back to it. */
export const STREAK_LIMIT = 5;
/** Consecutive wins at one hunt spot that make it the proven hunt. */
export const PROVEN_STREAK = 10;
/** Wins at the fallback before the target is retried. */
export const FALLBACK_WINS = 200;
/** Game time at the fallback before the target is retried: 2 hours. */
export const FALLBACK_TICKS = 2 * 3600 * TPS;
/** Hold lengths in minutes, one per failed probe. The last repeats. */
export const HOLD_MINUTES = [10, 20, 40, 80];
/** The share of max HP a recovery runs to with no return pending, and when HP cannot recover. */
export const RECOVER_THRESHOLD = 0.6;
/** The share of max HP a recovery runs to while a return is pending. */
export const RETURN_RECOVER_HP = 0.95;

/**
 * Spots the return never targets. The stronghold wall ends the run on its
 * last win. It is step 4 content; the id is kept so the rule is in place.
 */
export const NEVER_TARGET_SPOTS: readonly string[] = ['f11_wall'];
const NEVER_TARGET: ReadonlySet<string> = new Set(NEVER_TARGET_SPOTS);

const koKey = (spot: string): string => `ko:n:${spot}`;
const winKey = (spot: string): string => `win:n:${spot}`;
/** Clock tick of the last win at a spot with a fight budget. */
const lastWinKey = (spot: string): string => `win:at:${spot}`;

// ---- slice ----

export interface ReturnSpot {
  spot: string;
  activity: string;
}

export interface PendingReturn {
  /** Null when the spot of the knockout is never walked back to. */
  target: ReturnSpot | null;
  phase: 'return' | 'fallback' | 'hold';
  fallback?: ReturnSpot;
  /** Wins at the fallback in this phase. */
  wins: number;
  /** Clock tick that ends a hold, or the time cap of the fallback. */
  until?: number;
  /** Failed probes of the target since the hold began. */
  probes: number;
  /** The spot the fall happened at: the ceiling for the fallback picks. */
  from?: string;
}

export interface KnockoutState {
  pendingReturn: PendingReturn | null;
  /** The last hunt spot where 10 fights were won in a row. */
  proven: ReturnSpot | null;
}

type K = Ctx<KnockoutState>;
type World = DeepReadonly<WorldState>;

// ---- text ----

const knockoutText = registry(textSchema, knockoutTextData, 'Knockout text');
const TEXT = Object.fromEntries((knockoutTextData as TextRecord[]).map((r) => [r.id, r.text]));

function say(ctx: K, id: string, params?: Record<string, unknown>, kind = 'action'): void {
  ctx.emit(logLine, { msg: fillText(TEXT[id], params), kind });
}

// ---- reads ----

const now = (ctx: Pick<K, 'read'>): number => totalTicksOf(ctx.read(clock));
const count = (ctx: Pick<K, 'read'>, key: string): number => counterValue(ctx.read(counters), key);

/** Knockouts in a row at a spot: up by 1 per knockout, cleared by a win there. */
export function knockoutStreak(ctx: Pick<K, 'read'>, spot: string): number {
  return count(ctx, koKey(spot));
}

/** Ticks a hold lasts after `probes` failed probes: 10, 20, 40, 80, 80 minutes. */
export function holdTicks(probes: number): number {
  const i = Math.max(0, Math.min(HOLD_MINUTES.length - 1, probes));
  return HOLD_MINUTES[i] * 60 * TPS;
}

/** Whether the defeat summary opens for the knockout just recorded: only when no return or fallback follows. */
export function defeatDialogDue(state: DeepReadonly<KnockoutState>): boolean {
  const p = state.pendingReturn;
  return !p || p.phase === 'hold';
}

/**
 * Where a knockout recovery stops: at least 95%, or the rest target of the
 * hunt when that is set and higher, while a return is pending. Null with no
 * return pending and when HP cannot recover: the 60% mark applies.
 */
export function returnRecoverTarget(ctx: K): number | null {
  if (!ctx.state.pendingReturn) return null;
  if (statBlockOf(ctx).hpRegen <= 0 || ctx.derived('resources/regenBlocked.hp') > 0) return null;
  const cfg = ctx.read(combat).huntRest;
  return Math.max(RETURN_RECOVER_HP, cfg.at > 0 ? restTarget(cfg) : 0);
}

// ---- routes ----

function floorOf(spotId: string): FloorDef | null {
  return SPOTS[spotId] ? floorOfSpot(spotId) : null;
}

/**
 * The hops from where the character stands to `to`: a road route, else the
 * ladder to the landing of the target floor and a road route from there.
 */
function hopsTo(ctx: K, w: World, to: string): { start: string; path: string[] } | null {
  const direct = findPath(ctx, w, w.spot, to);
  if (direct) return { start: w.spot, path: direct };
  const floor = floorOf(to);
  if (!floor?.landing || floor.id === floorOf(w.spot)?.id) return null;
  const tower = towerAt(w.spot);
  if (!tower || tower.id !== floor.towerId || !floorUnlocked(ladderReader(ctx), floor)) return null;
  const path = findPath(ctx, w, floor.landing, to);
  return path ? { start: floor.landing, path } : null;
}

/** Why the return cannot go to a spot. */
type Why = 'forced_spot' | 'forced_road' | 'wall' | 'festival' | 'route' | 'start';

/** A hunt the return may walk a forced road to: an endless-style hunt at a spot that is not forced and holds no boss line. */
function roadHuntOk(goal: ReturnSpot): boolean {
  const spot = SPOTS[goal.spot];
  if (!spot || spot.forced || spot.encounters?.some((e) => e.boss)) return false;
  return spotActivities(spot).find((a) => a.id === goal.activity)?.kind === 'hunt';
}

/**
 * Why the character cannot be sent from where it stands to `goal` and put to
 * work, or null when it can. `viaRoad`: a forced last road is allowed to a
 * goal `roadHuntOk` accepts.
 */
export function returnBlock(ctx: K, goal: ReturnSpot, viaRoad = false): Why | null {
  const w = ctx.read(world);
  const spot = SPOTS[goal.spot];
  if (!spot) return 'route';
  if (NEVER_TARGET.has(goal.spot)) return 'wall';
  if (spot.forced) return 'forced_spot';
  if (festivalFloorOf(goal.spot)) return 'festival';
  if (!canStartActivity(ctx, goal.spot, goal.activity)) return 'start';
  if (goal.spot === w.spot) return null;
  const hops = hopsTo(ctx, w, goal.spot);
  if (!hops) return 'route';
  // The last hop is a road when the walk has hops; a climb alone ends on the landing.
  if (hops.path.length > 0) {
    const prev = hops.path.length > 1 ? hops.path[hops.path.length - 2] : hops.start;
    if (edgesFrom(prev).find((e) => e.to === goal.spot)?.forced) return viaRoad && roadHuntOk(goal) ? null : 'forced_road';
  }
  return null;
}

/** Why a forced fight with no activity at a spot is not walked back into. */
function ambushWhy(spotId: string): Why {
  if (NEVER_TARGET.has(spotId)) return 'wall';
  if (SPOTS[spotId]?.forced) return 'forced_spot';
  if (festivalFloorOf(spotId)) return 'festival';
  return 'forced_road';
}

/** What a knockout interrupted, read before the retreat clears it. */
export interface Fall {
  spot: string;
  activity: string | null;
  forced: boolean;
}

/** The hunt a knockout behind a forced road resumes when there is no fallback, or null. */
function roadHunt(fall: Fall): ReturnSpot | null {
  const spot = SPOTS[fall.spot];
  if (!spot) return null;
  const acts = spotActivities(spot);
  const act = fall.activity ? acts.find((a) => a.id === fall.activity) : acts.find((a) => a.kind === 'hunt');
  const goal = act ? { spot: fall.spot, activity: act.id } : null;
  return goal && roadHuntOk(goal) ? goal : null;
}

const whyText = (why: Why): string => TEXT[`why_${why}`];

/**
 * A hunt spot the return may send the character to as a fallback, or null:
 * a hunt at a spot that is not forced and not the wall, not cleared, with a
 * line eligible now, reachable with no forced hop, and not on a higher floor
 * than the fall. The spot of the fall is never its own fallback.
 */
function huntUsable(ctx: K, cand: ReturnSpot | null | undefined, fallSpot: string): ReturnSpot | null {
  if (!cand || cand.spot === fallSpot) return null;
  const spot = SPOTS[cand.spot];
  if (!spot || spot.forced || NEVER_TARGET.has(cand.spot) || festivalFloorOf(cand.spot)) return null;
  const act = spotActivities(spot).find((a) => a.id === cand.activity);
  if (act?.kind !== 'hunt') return null;
  if (spotCleared(ctx, spot) || eligibleAt(ctx, spot).length === 0) return null;
  const here = floorOf(fallSpot);
  const there = floorOf(cand.spot);
  if (here && there && rungIndex(there) > rungIndex(here)) return null;
  return returnBlock(ctx, cand) === null ? cand : null;
}

/** The proven hunt, if usable. It has no fight budget. */
function usableHunt(ctx: K, cand: ReturnSpot | null | undefined, fallSpot: string): ReturnSpot | null {
  if (cand && SPOTS[cand.spot]?.fightLimit) return null;
  return huntUsable(ctx, cand, fallSpot);
}

/**
 * A spot with a fight budget to fall back to when no proven hunt is usable:
 * discovered, fights left, a win there and no knockout there since. Of
 * those, the spot won at most recently. `lost`: a spot knocked out at in
 * this handler, whose win counter is cleared by an event not yet delivered.
 */
function limitedHunt(ctx: K, fallSpot: string, lost?: string): ReturnSpot | null {
  let best: ReturnSpot | null = null;
  let bestAt = -1;
  for (const id of ctx.read(world).discovered) {
    const spot = SPOTS[id];
    if (!spot?.fightLimit || id === lost || count(ctx, winKey(id)) < 1) continue;
    const act = spotActivities(spot).find((a) => a.kind === 'hunt');
    if (!act) continue;
    const at = count(ctx, lastWinKey(id));
    if (at <= bestAt) continue;
    const cand = huntUsable(ctx, { spot: id, activity: act.id }, fallSpot);
    if (cand) {
      best = cand;
      bestAt = at;
    }
  }
  return best;
}

function huntLevel(ctx: K, spot: SpotDef): number {
  let low = Infinity;
  for (const e of eligibleAt(ctx, spot)) low = Math.min(low, e.level[0]);
  return low;
}

function huntTop(ctx: K, spot: SpotDef): number {
  let top = 0;
  for (const e of eligibleAt(ctx, spot)) top = Math.max(top, e.level[1]);
  return top;
}

/** The level a roofed fallback may not exceed: the top of the spot of the fall, when that is a plain hunt. */
function fallCeiling(ctx: K, fallSpot: string): number {
  const spot = SPOTS[fallSpot];
  if (!spot || spot.forced || spot.encounters?.some((e) => e.boss)) return Infinity;
  return huntTop(ctx, spot) || Infinity;
}

/** A roofed (`indoor`) endless hunt on the floor of the fall, the lowest level first. */
function indoorHunt(ctx: K, fallSpot: string): ReturnSpot | null {
  const floor = floorOf(fallSpot);
  if (!floor) return null;
  const ceiling = fallCeiling(ctx, fallSpot);
  let best: ReturnSpot | null = null;
  let bestLevel = Infinity;
  for (const id of ctx.read(world).discovered) {
    const spot = SPOTS[id];
    if (!spot?.tags?.includes('indoor') || spot.fightLimit || floorOf(id)?.id !== floor.id) continue;
    const act = spotActivities(spot).find((a) => a.kind === 'hunt');
    if (!act) continue;
    if (huntTop(ctx, spot) > ceiling) continue;
    const cand = huntUsable(ctx, { spot: id, activity: act.id }, fallSpot);
    if (!cand) continue;
    const level = huntLevel(ctx, spot);
    if (level < bestLevel) {
      best = cand;
      bestLevel = level;
    }
  }
  return best;
}

/** Where a fallback hunts: the proven spot, else the limited spot won at most recently, else a roofed hunt. */
function pickFallback(ctx: K, fallSpot: string, lost?: string): ReturnSpot | null {
  return usableHunt(ctx, ctx.state.proven, fallSpot) ?? limitedHunt(ctx, fallSpot, lost) ?? indoorHunt(ctx, fallSpot);
}

// ---- phases ----

const spotName = (id: string): string => SPOTS[id]?.name ?? id;
const minutes = (ticks: number): number => Math.max(1, Math.round(ticks / (60 * TPS)));
const copy = (spot: DeepReadonly<ReturnSpot>): ReturnSpot => ({ spot: spot.spot, activity: spot.activity });

function fallbackPhase(ctx: K, target: ReturnSpot | null, fallback: ReturnSpot, probes: number, from: string): PendingReturn {
  return { target: target && copy(target), phase: 'fallback', fallback: copy(fallback), wins: 0, until: now(ctx) + FALLBACK_TICKS, probes, from };
}

const fallOf = (p: PendingReturn, replaced: string): string => p.from ?? p.target?.spot ?? replaced;

function repicked(p: PendingReturn, fb: ReturnSpot, from: string): PendingReturn {
  return {
    target: p.target && copy(p.target),
    phase: 'fallback',
    fallback: copy(fb),
    wins: p.wins,
    ...(p.until !== undefined ? { until: p.until } : {}),
    probes: p.probes,
    from,
  };
}

function holdPhase(ctx: K, target: ReturnSpot, probes: number): PendingReturn {
  return { target: copy(target), phase: 'hold', wins: 0, until: now(ctx) + holdTicks(probes), probes };
}

function returnPhase(target: ReturnSpot, probes: number, fallback?: ReturnSpot): PendingReturn {
  return { target: copy(target), phase: 'return', ...(fallback ? { fallback: copy(fallback) } : {}), wins: 0, probes };
}

/** A limited fallback is gone: spent, or lost at since its last win. Pick again, else hold on the target, else end. */
function replaceFallback(ctx: K, p: PendingReturn, gone: ReturnSpot, why: 'spent' | 'lost'): void {
  const from = fallOf(p, gone.spot);
  const fb = pickFallback(ctx, from, why === 'lost' ? gone.spot : undefined);
  if (fb) {
    ctx.state.pendingReturn = repicked(p, fb, from);
    say(ctx, why === 'spent' ? 'spent_fallback' : 'lost_fallback', { spot: spotName(gone.spot), fallback: spotName(fb.spot) });
    return;
  }
  if (why === 'spent') ctx.request(startActivityNow, { activity: null });
  if (p.target) {
    ctx.state.pendingReturn = holdPhase(ctx, p.target, p.probes);
    say(ctx, why === 'spent' ? 'spent_hold' : 'lost_hold', {
      spot: spotName(gone.spot),
      target: spotName(p.target.spot),
      minutes: minutes(holdTicks(p.probes)),
    });
    return;
  }
  ctx.state.pendingReturn = null;
  say(ctx, why === 'spent' ? 'spent_idle' : 'lost_idle', { spot: spotName(gone.spot) });
}

/** Count a knockout at a spot. Answers the streak. */
function bumpKnockouts(ctx: K, spot: string): number {
  const n = count(ctx, koKey(spot)) + 1;
  ctx.emit(bumpCounter, { key: koKey(spot) });
  if (count(ctx, winKey(spot)) !== 0) ctx.emit(clearCounter, { key: winKey(spot) });
  if (count(ctx, lastWinKey(spot)) !== 0) ctx.emit(clearCounter, { key: lastWinKey(spot) });
  if (n >= STREAK_LIMIT && ctx.state.proven?.spot === spot) ctx.state.proven = null;
  return n;
}

/** Say again what a return already in flight does next. */
function announce(ctx: K, p: PendingReturn): void {
  if (p.phase === 'hold') {
    const left = Math.max(0, (p.until ?? 0) - now(ctx));
    say(ctx, 'hold', { spot: spotName(p.target?.spot ?? ''), minutes: minutes(left) });
    return;
  }
  const goal = p.phase === 'fallback' ? p.fallback : p.target;
  if (goal) say(ctx, 'return', { spot: spotName(goal.spot) });
}

/**
 * A knockout has happened and the retreat has run: decide what follows and
 * say it in one log line. The old `noteKnockout`.
 */
function noteKnockout(ctx: K, fall: Fall): void {
  const state = ctx.state;
  const old = state.pendingReturn ?? null;
  // No work was running and the fight was not forced: an idle character is sent nowhere.
  if (!fall.activity && !fall.forced) {
    if (old) announce(ctx, old);
    return;
  }

  const n = bumpKnockouts(ctx, fall.spot);
  const lost = fall.spot;

  // A knockout at the fallback itself, in the fallback phase or right after its retry.
  if (old?.fallback?.spot === fall.spot && (old.phase === 'fallback' || old.phase === 'return')) {
    if (old.phase === 'return' && old.target && n < STREAK_LIMIT) {
      say(ctx, 'return', { spot: spotName(old.target.spot) });
      return;
    }
    if (old.phase === 'fallback' && SPOTS[fall.spot]?.fightLimit) {
      replaceFallback(ctx, old, old.fallback, 'lost');
      return;
    }
    if (old.phase === 'fallback' && n < STREAK_LIMIT && huntUsable(ctx, old.fallback, '')) {
      say(ctx, 'return', { spot: spotName(fall.spot) });
      return;
    }
    const target = old.target ?? old.fallback;
    state.pendingReturn = holdPhase(ctx, target, old.probes);
    say(ctx, 'fallback_failed', {
      count: n,
      spot: spotName(fall.spot),
      target: spotName(target.spot),
      minutes: minutes(holdTicks(old.probes)),
    });
    return;
  }

  // A forced fight with no activity is the walk into an ambush: no work to resume.
  const target: ReturnSpot | null = fall.activity ? { spot: fall.spot, activity: fall.activity } : null;
  const why: Why | null = target ? returnBlock(ctx, target) : ambushWhy(fall.spot);

  if (target && why === null) {
    const carried = old?.target?.spot === target.spot ? old.probes : 0;
    if (n < STREAK_LIMIT) {
      state.pendingReturn = returnPhase(target, carried);
      say(ctx, 'return', { spot: spotName(target.spot) });
      return;
    }
    // The streak is reached. A return after that is a retry or a probe that failed, which doubles the hold.
    const failed = n > STREAK_LIMIT;
    const fb = pickFallback(ctx, target.spot, lost);
    if (fb) {
      state.pendingReturn = fallbackPhase(ctx, target, fb, failed ? carried + 1 : carried, target.spot);
      say(ctx, 'streak_fallback', { count: n, spot: spotName(target.spot), fallback: spotName(fb.spot), wins: FALLBACK_WINS });
      return;
    }
    const probes = failed ? carried + 1 : 0;
    state.pendingReturn = holdPhase(ctx, target, probes);
    say(ctx, 'hold', { spot: spotName(target.spot), minutes: minutes(holdTicks(probes)) });
    return;
  }

  // Not a spot the return walks back to: hunt a fallback with no target, or idle.
  const fb = pickFallback(ctx, fall.spot, lost);
  if (fb) {
    state.pendingReturn = fallbackPhase(ctx, null, fb, 0, fall.spot);
    say(ctx, 'blocked_fallback', { spot: spotName(fall.spot), why: whyText(why!), fallback: spotName(fb.spot), wins: FALLBACK_WINS });
    return;
  }

  // No fallback anywhere. A plain hunt behind a forced road is held on and walked to again.
  const road = why === 'forced_road' ? roadHunt(fall) : null;
  if (road && returnBlock(ctx, road, true) === null) {
    const probes = old && old.phase === 'return' && old.target?.spot === road.spot ? old.probes + 1 : 0;
    state.pendingReturn = holdPhase(ctx, road, probes);
    say(ctx, 'hold', { spot: spotName(road.spot), minutes: minutes(holdTicks(probes)) });
    return;
  }
  state.pendingReturn = null;
  say(ctx, 'blocked_idle', { spot: spotName(fall.spot), why: whyText(why!) });
}

// ---- wins ----

/** A fallback or a hold is over: go back to the target, or with none hunt on here. */
function retryTarget(ctx: K, p: PendingReturn): void {
  if (!p.target) {
    ctx.state.pendingReturn = null;
    return;
  }
  ctx.state.pendingReturn = returnPhase(p.target, p.probes, p.fallback);
  say(ctx, 'retry', { spot: spotName(p.target.spot) });
}

/** A fight was won. The old `onWin`. */
function onWin(ctx: K, spotId: string, forced: boolean): void {
  const state = ctx.state;
  if (count(ctx, koKey(spotId)) !== 0) ctx.emit(clearCounter, { key: koKey(spotId) });

  const w = ctx.read(world);
  const spot = SPOTS[spotId];
  // The activity where the character stands, as the old `currentActivity` read it.
  const act = w.activity ? spotActivities(SPOTS[w.spot] ?? ({ activities: [] } as unknown as SpotDef)).find((a) => a.id === w.activity) : undefined;
  if (!forced && act?.kind === 'hunt' && spot && !spot.forced && !NEVER_TARGET.has(spotId) && !festivalFloorOf(spotId)) {
    const n = Math.min(PROVEN_STREAK, count(ctx, winKey(spotId)) + 1);
    ctx.emit(raiseCounter, { key: winKey(spotId), value: n });
    if (spot.fightLimit) {
      // A fight budget runs out before 10 wins in a row: such a spot is never the proven hunt.
      ctx.emit(setCounter, { key: lastWinKey(spotId), value: now(ctx) });
    } else if (n >= PROVEN_STREAK && (state.proven?.spot !== spotId || state.proven.activity !== act.id)) {
      state.proven = { spot: spotId, activity: act.id };
    }
  }

  const p = state.pendingReturn;
  if (!p) return;
  if (p.phase === 'fallback' && p.fallback?.spot === spotId) {
    p.wins += 1;
    if (p.wins >= FALLBACK_WINS) retryTarget(ctx, p);
  } else if (p.phase === 'return' && p.target?.spot === spotId) {
    // A boarding fight on a forced road is not the hunt: the return ends with
    // the first hunt win, or when the fight cleared the spot.
    if (!forced || (spot && spotCleared(ctx, spot))) state.pendingReturn = null;
  }
}

// ---- the tick ----

type Drive = 'moving' | 'there' | 'stuck';

/** One step toward `goal`, for a character that is idle, recovered and out of combat. */
function driveTo(ctx: K, goal: ReturnSpot, viaRoad: boolean): Drive {
  const w = ctx.read(world);
  if (w.spot === goal.spot) {
    if (w.activity === goal.activity) return 'there';
    if (!canStartActivity(ctx, goal.spot, goal.activity)) return 'stuck';
    ctx.request(startActivityNow, { activity: goal.activity });
    return ctx.read(world).activity === goal.activity ? 'there' : 'stuck';
  }
  if (returnBlock(ctx, goal, viaRoad) !== null) return 'stuck';
  if (findPath(ctx, w, w.spot, goal.spot)) return ctx.request(goNow, goal) ? 'moving' : 'stuck';
  const floor = floorOf(goal.spot);
  if (floor && towerAt(w.spot) && ctx.request(rideNow, { floor: floor.id })) return 'moving';
  return 'stuck';
}

/** The goal cannot be reached or started any more. The old `giveUp`. */
function giveUp(ctx: K, p: PendingReturn): void {
  const state = ctx.state;
  if (p.phase === 'fallback') {
    if (!p.target) {
      state.pendingReturn = null;
      return;
    }
    state.pendingReturn = holdPhase(ctx, p.target, p.probes);
    say(ctx, 'hold', { spot: spotName(p.target.spot), minutes: minutes(holdTicks(p.probes)) });
    return;
  }
  const target = p.target;
  if (!target) {
    state.pendingReturn = null;
    return;
  }
  const block = returnBlock(ctx, target, true) ?? 'route';
  const why = whyText(block);
  const fb = pickFallback(ctx, target.spot);

  // A spot the return never walks into loses its target.
  if (block === 'forced_spot' || block === 'forced_road' || block === 'wall' || block === 'festival') {
    if (fb) {
      state.pendingReturn = fallbackPhase(ctx, null, fb, 0, target.spot);
      say(ctx, 'blocked_fallback', { spot: spotName(target.spot), why, fallback: spotName(fb.spot), wins: FALLBACK_WINS });
    } else {
      state.pendingReturn = null;
      say(ctx, 'blocked_idle', { spot: spotName(target.spot), why });
    }
    return;
  }

  // Anything else may be open at the next try: the target is kept and the failure counted.
  const probes = p.probes + 1;
  if (fb) {
    state.pendingReturn = fallbackPhase(ctx, target, fb, probes, target.spot);
    say(ctx, 'blocked_retry', {
      spot: spotName(target.spot),
      why,
      fallback: spotName(fb.spot),
      wins: FALLBACK_WINS,
      hours: FALLBACK_TICKS / (3600 * TPS),
    });
    return;
  }
  state.pendingReturn = holdPhase(ctx, target, probes);
  say(ctx, 'blocked_hold', { spot: spotName(target.spot), why, minutes: minutes(holdTicks(probes)) });
}

/** One tick of the return. Acts only on a character that is not fighting and not walking. */
function tickReturn(ctx: K): void {
  const p = ctx.state.pendingReturn;
  const w = ctx.read(world);
  if (!p || w.recovering || ctx.read(combat).fight || w.travel || w.travelPlan.length > 0) return;

  if (p.phase === 'hold') {
    if (now(ctx) >= (p.until ?? 0)) retryTarget(ctx, p);
    return;
  }
  if (p.phase === 'fallback' && p.until !== undefined && now(ctx) >= p.until) {
    retryTarget(ctx, p);
    return;
  }
  const spent = p.phase === 'fallback' ? p.fallback : undefined;
  if (spent && SPOTS[spent.spot] && spotCleared(ctx, SPOTS[spent.spot])) {
    replaceFallback(ctx, p, spent, 'spent');
    return;
  }

  const goal = p.phase === 'fallback' ? p.fallback : p.target;
  if (!goal) {
    ctx.state.pendingReturn = null;
    return;
  }
  const step = driveTo(ctx, goal, p.phase === 'return');
  if (step === 'stuck') {
    giveUp(ctx, p);
    return;
  }
  // Work with no fights has no win to end the return: arriving ends it.
  if (step === 'there' && p.phase === 'return') {
    const act = spotActivities(SPOTS[goal.spot]).find((a) => a.id === goal.activity);
    if (act?.kind !== 'hunt') ctx.state.pendingReturn = null;
  }
}

// ---- the knockout ----

/** 1 HP, the retreat, the recovery, and what follows. */
function knockOut(ctx: K, fall: Fall, reason: string): void {
  ctx.emit(defeatPlayer, undefined);
  ctx.request(retreat, { reason, knockedOut: true });
  noteKnockout(ctx, fall);
}

/** A condition took the player to 0 HP, or emptied a pool. `line`: the name for the "knocks you out" line, or null for none. */
function fallToCondition(ctx: K, line: string | null): void {
  const w = ctx.read(world);
  // Already down: held at the 1 HP the first knockout left. No line, no second outcome.
  if (w.recovering) {
    ctx.emit(defeatPlayer, undefined);
    return;
  }
  if (line !== null) say(ctx, 'condition_knocks_out', { name: line }, 'danger');
  // Read before combat closes the fight in its own handler of the same event.
  const forced = inForcedFight(ctx.read(combat));
  knockOut(ctx, { spot: w.spot, activity: w.activity, forced }, forced ? TEXT.reason_forced_condition : TEXT.reason_plain);
}

// ---- commands ----

/** End the return in flight and stay. A leg under way completes and starts nothing. */
export const stayHere = defineCommand<void>('knockout/stay-here');

// ---- view ----

export interface KnockoutView {
  /** What the return does next, or null with none in flight. */
  pending: { phase: PendingReturn['phase']; target: string | null; fallback: string | null; wins: number; minutesLeft: number | null } | null;
  proven: string | null;
  defeatDialogDue: boolean;
}

const knockout = defineSystem<KnockoutState, KnockoutView>({
  id: 'knockout',
  version: 1,
  migrations,
  // After `resources` and `statuses`, before `world`: the old loop checked
  // the recovery and took the step of the return before the activity.
  order: 4,
  initial: () => ({ pendingReturn: null, proven: null }),
  content: { knockout_text: knockoutText },

  tick: (ctx) => {
    const w = ctx.read(world);
    if (w.recovering) {
      const stats = statBlockOf(ctx);
      const max = availableMax(stats, poolHooks(ctx), 'hp');
      const share = max > 0 ? resourceValue(ctx.read(resources), 'hp') / max : 0;
      const mark = returnRecoverTarget(ctx);
      if (mark === null ? share >= RECOVER_THRESHOLD : share >= mark - 0.005) ctx.request(recoverNow, undefined);
      return;
    }
    if (ctx.state.pendingReturn) tickReturn(ctx);
  },

  commands: [
    handle(stayHere, (ctx) => {
      if (!ctx.state.pendingReturn) return skipped('no return is in flight');
      ctx.state.pendingReturn = null;
      const leg = ctx.request(stayOnLeg, undefined);
      if (leg) say(ctx, 'stay_leg', { spot: leg });
      else say(ctx, 'stay');
      return OK;
    }),
  ],

  events: [
    on(playerDefeated, (ctx, { payload }) => {
      // A condition that finished the player was handled on its own event, before combat closed the fight.
      if (payload.byCondition) return;
      const w = ctx.read(world);
      knockOut(ctx, { spot: w.spot, activity: w.activity, forced: payload.forced }, payload.forced ? TEXT.reason_forced : TEXT.reason_plain);
    }),
    on(conditionDetonated, (ctx, { payload }) => {
      if (payload.entity === PLAYER && !isAlive(ctx.read(resources))) fallToCondition(ctx, payload.name);
    }),
    on(conditionDamage, (ctx, { payload }) => {
      if (payload.entity === PLAYER && !isAlive(ctx.read(resources))) fallToCondition(ctx, payload.hits[0]?.name ?? '');
    }),
    // A fatal condition takes the bearer down whatever health is left. The status system said so in the log.
    on(conditionFatal, (ctx, { payload }) => {
      if (payload.entity === PLAYER) fallToCondition(ctx, null);
    }),
    on(fightWon, (ctx, { payload }) => onWin(ctx, payload.site, payload.forced)),
    // The player chose something else: the character stays where the player put it.
    on(playerCommand, (ctx) => {
      ctx.state.pendingReturn = null;
    }),
  ],

  view: (ctx) => {
    const p = ctx.state.pendingReturn;
    const tick = totalTicksOf(ctx.read(clock));
    return {
      pending: p
        ? {
            phase: p.phase,
            target: p.target ? spotName(p.target.spot) : null,
            fallback: p.fallback ? spotName(p.fallback.spot) : null,
            wins: p.wins,
            minutesLeft: p.until !== undefined ? Math.max(0, Math.ceil((p.until - tick) / (60 * TPS))) : null,
          }
        : null,
      proven: ctx.state.proven ? spotName(ctx.state.proven.spot) : null,
      defeatDialogDue: defeatDialogDue(ctx.state),
    };
  },
});

export default knockout;
