/**
 * Practice targets: the XP shaping of a fight against training equipment.
 * Port of the shaping half of the old `systems/practice.ts` and of
 * `data/practice.data.ts`. The other half (`isPracticeFight`, no `hunt` tag
 * and no level XP from a practice target) is in `combat`. See README.md in
 * this folder.
 *
 * Every skill or attribute payout P at level L made inside a practice fight's
 * tick lands as
 *
 *   max(P × PRACTICE_XP_CUT × F / (F + L − 1),  min(P, PRACTICE_XP_FLOOR × gap))
 *
 * with F = PRACTICE_XP_FALLOFF and gap = seconds since this fight last paid
 * that skill or attribute, capped at PRACTICE_FLOOR_GAP. The first payout of
 * a fight counts one second. The floor never pays more than P.
 *
 * The scope (the old module-level `practising`): `combat` opens it at the
 * start of its tick when the fight is a practice fight (`practice/open`).
 * Every event the combat tick emits is delivered in the drain that follows
 * the combat tick hook, before the next tick hook runs, so every payout the
 * old synchronous tick made falls inside it. This system's tick, ordered
 * right after `combat`, closes it. The scope is memory (one slot, as the old
 * one), never saved: it is closed at the end of every tick.
 */
import { answer, defineEvent, defineRequest, defineSystem, on, TPS, type Ctx, type DeepReadonly } from '../../kernel';
import { migrations } from './migrations';

// ---- the rule (old `data/practice.data.ts`) ----

/** Share of a payout a practice target pays at level 1. */
export const PRACTICE_XP_CUT = 0.1;

/**
 * Levels above 1 at which the share halves. It is a third at twice that and
 * a sixth at five times that: F / (F + L − 1).
 */
export const PRACTICE_XP_FALLOFF = 10;

/** XP per second of practice each trained skill and attribute gets at least. */
export const PRACTICE_XP_FLOOR = 1;

/**
 * Longest gap, in seconds, between two payouts to the same skill or attribute
 * that the floor credits. A skill exercised once and then left idle earns the
 * floor for this long, not for the rest of the fight.
 */
export const PRACTICE_FLOOR_GAP = 5;

export interface PracticeState {
  /**
   * The practice clock of the fight under way: for each skill (`skill:<id>`)
   * and attribute (`attr:<id>`) the fight has paid, the tick of its last
   * payout. The old `CombatState.practiceAt`. Emptied when a fight starts.
   */
  at: Record<string, number>;
}

type P = Ctx<PracticeState>;

/** The share of a payout a practice target pays at `level`, before the floor. The old `practiceShare`. */
export function practiceShare(level: number): number {
  return (PRACTICE_XP_CUT * PRACTICE_XP_FALLOFF) / (PRACTICE_XP_FALLOFF + Math.max(1, level) - 1);
}

/**
 * What a payout of `amount` to one skill or attribute at `level` lands as
 * inside a practice tick at tick `now`, with `clock` the fight's practice
 * clock: the larger of the cut payout and the floor for the time since the
 * fight last paid `key`. Stamps `key` on `clock`. The body of the old
 * `practiceXp` inside its scope.
 */
export function shapePracticeXp(
  clock: Record<string, number>,
  now: number,
  key: string,
  level: number,
  amount: number,
): number {
  const last = clock[key];
  const gap = last === undefined ? 1 : Math.min(PRACTICE_FLOOR_GAP, (now - last) / TPS);
  clock[key] = now;
  return Math.max(amount * practiceShare(level), Math.min(amount, PRACTICE_XP_FLOOR * gap));
}

// ---- the scope ----

/**
 * The practice slice whose scope is open, or null: the old module-level
 * `scope`. One slot is enough, since a tick runs to its end before any other
 * kernel's. Memory, never saved; the closing tick reads this and nothing
 * else.
 */
let openFor: object | null = null;

/** True while a practice fight's tick is running (and its events drain). The old `scope === state`. */
export function practising(state: DeepReadonly<PracticeState>): boolean {
  return state === openFor;
}

/** True when the clock holds a stamp: a fight start then empties it. */
export function clockRunning(state: DeepReadonly<PracticeState>): boolean {
  for (const _ in state.at) return true;
  return false;
}

/** Request: open the scope for this tick. Sent by `combat` at the start of a practice fight's tick. */
export const openPractice = defineRequest<void, void>('practice/open');

/**
 * Request: what a payout lands as (the old `practiceXp`). The amount
 * unchanged outside the scope; inside it, shaped and stamped. Callers ask
 * only while `practising` is true, so a payout outside costs no request.
 */
export const practiceXp = defineRequest<{ key: string; level: number; amount: number }, number>('practice/xp');

/** A fight started: the practice clock starts empty (the old clock lived on the fight). */
export const practiceFightStarted = defineEvent('practice/fight-started');

/**
 * The amount a payout of `amount` to `key` at `level` lands as, for a skill
 * or attribute grant handler: unchanged unless the scope is open.
 */
export function practicePayout(
  ctx: Pick<Ctx<unknown>, 'read' | 'request'>,
  key: string,
  level: number,
  amount: number,
): number {
  return practising(ctx.read(practice)) ? ctx.request(practiceXp, { key, level, amount }) : amount;
}

// ---- the declaration ----

const practice = defineSystem<PracticeState>({
  id: 'practice',
  version: 1,
  migrations,
  initial: () => ({ at: {} }),
  // Right after `combat` (10), before `benches` (15): the scope covers the
  // combat tick and the drain after it, and nothing a later tick hook pays.
  order: 11,

  tick: () => {
    if (openFor !== null) openFor = null;
  },

  requests: [
    answer(openPractice, (ctx: P) => {
      openFor = ctx.state;
    }),
    answer(practiceXp, (ctx: P, { key, level, amount }) =>
      ctx.state === openFor ? shapePracticeXp(ctx.state.at, ctx.tick, key, level, amount) : amount,
    ),
  ],

  events: [
    on(practiceFightStarted, (ctx: P) => {
      ctx.state.at = {};
    }),
  ],
});

export default practice;
