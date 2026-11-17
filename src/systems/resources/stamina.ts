/**
 * Stamina as a fighting resource. Port of the old `systems/stamina.ts`.
 *
 * - Upkeep: one attack costs a little, priced per second of wind-up, at just
 *   under the rate stamina recovers.
 * - Exertion: the style's bargain, paid only while the player has opted in.
 *
 * Two floors: the reserve (spending stops there until the bar is full again:
 * winded) and zero (every action slows and the first half of the refill is
 * slowed: exhausted). Both locks clear only on a full bar.
 */
import type { DeepReadonly, Rng } from '../../kernel';
import type { DerivedStats } from '../stats';
import {
  availableMax,
  drawResource,
  regenResource,
  resourceReady,
  resourceValue,
  RESOURCES,
  spendResource,
  type Pools,
  type ResourceId,
  type ResourcesState,
} from './pools';

/** Stamina's reserve behaviour, from the resources registry. */
const RESERVE = RESOURCES.stamina.reserve!;

/** Spending stops once the pool falls to this share of max. */
export const STAMINA_RESERVE = RESERVE.share;
/** Exhaustion lowers speed by this fraction. */
export const EXHAUSTED_SPEED_PENALTY = -(RESERVE.emptyPenalty?.[0]?.value ?? 0);
/** Regen multiplier while exhausted and still below EXHAUSTED_SLOW_UNTIL. */
export const EXHAUSTED_REGEN_MULT = RESERVE.emptyRegenMult;
/** Exhausted regen is slowed until the pool passes this share of max. */
export const EXHAUSTED_SLOW_UNTIL = RESERVE.slowUntil;

/** Upkeep per attack, as a share of the stamina recovered while winding it up. */
export const UPKEEP_SHARE = 0.9;

/** True while stamina may still be spent (neither winded nor exhausted). */
export function staminaReady(state: DeepReadonly<ResourcesState>): boolean {
  return resourceReady(state, 'stamina');
}

/**
 * Whether the style's exertion is being paid for right now: the player has
 * opted in, and the fuelling pool is not locked.
 */
export function exerting(state: DeepReadonly<ResourcesState>, pool: ResourceId = 'stamina'): boolean {
  return state.exerting === true && resourceReady(state, pool);
}

/** What one attack costs for being thrown, before any style bargain. */
export function attackUpkeep(stats: Pick<DerivedStats, 'staminaRegen' | 'staminaEff'>, secondsPerAttack: number): number {
  return stats.staminaRegen * secondsPerAttack * UPKEEP_SHARE * stats.staminaEff;
}

/** Draw stamina for a cost that respects the reserve floor. Returns the amount spent. */
export function drawStamina(pools: Pools, want: number): number {
  return drawResource(pools, 'stamina', want);
}

/** Spend stamina from any source, ignoring the reserve. Returns the amount paid. */
export function spendStamina(pools: Pools, amount: number): number {
  return spendResource(pools, 'stamina', amount);
}

/** The cost half of a style's exertion. The styles port owns the rest of the record. */
export interface ExertionSpec {
  /** The pool that fuels it. Default stamina. */
  pool?: ResourceId;
  /** Share of max spent per event. */
  cost: number;
  /** Spend the whole bar, below the reserve, into exhaustion. */
  drain?: boolean;
  /** What a full payment buys per event. */
  hit?: {
    damage?: number;
    penetration?: number;
    splash?: number;
    extraHits?: number;
    dodge?: number;
    armor?: number;
    parry?: number;
  };
}

/** What an exertion bought. Every field is already scaled by `ratio`. */
export interface Exertion {
  /** Amount paid. Zero when locked out, out of reserve, or not exerting. */
  spent: number;
  /** The share of the intended cost that was paid, times stamina power. May exceed 1. */
  ratio: number;
  damage: number;
  penetration: number;
  splash: number;
  extraHits: number;
  dodge: number;
  armor: number;
  parry: number;
}

export const NO_EXERTION: Exertion = {
  spent: 0,
  ratio: 0,
  damage: 0,
  penetration: 0,
  splash: 0,
  extraHits: 0,
  dodge: 0,
  armor: 0,
  parry: 0,
};

/**
 * Burn a pool for a style's per-event payoff, only while the player has opted
 * in. The cost is a fraction of max, trimmed by efficiency and raised by a
 * cost-multiplying condition. A partial payment buys a proportional bonus.
 * For stamina, everything bought is multiplied by stamina power.
 */
export function exert(pools: Pools, spec: ExertionSpec | undefined): Exertion {
  const { state, stats, hooks } = pools;
  const pool = spec?.pool ?? 'stamina';
  const max = pool === 'stamina' ? stats.maxStamina : availableMax(stats, hooks, pool);
  if (!spec || !exerting(state, pool) || max <= 0) return NO_EXERTION;

  // A draining style intends to spend a full bar; efficiency does not cheapen it.
  const eff = pool === 'stamina' ? stats.staminaEff : pool === 'mana' ? stats.manaEff : 1;
  const wound = hooks.costMult(pool);
  const want = spec.drain ? max : max * spec.cost * eff * wound;
  if (want <= 0) return NO_EXERTION;

  // Draining styles go below the reserve, into exhaustion.
  const spent = spec.drain
    ? spendResource(pools, pool, Math.min(want, resourceValue(state, pool)))
    : drawResource(pools, pool, want);
  if (spent <= 0) return NO_EXERTION;

  // Stamina pays back as power; other pools pay at par.
  const payoff = Math.min(1, spent / want) * (pool === 'stamina' ? stats.staminaPower : 1);
  const hit = spec.hit;
  return {
    spent,
    ratio: payoff,
    damage: (hit?.damage ?? 0) * payoff,
    penetration: (hit?.penetration ?? 0) * payoff,
    splash: (hit?.splash ?? 0) * payoff,
    extraHits: (hit?.extraHits ?? 0) * payoff,
    dodge: (hit?.dodge ?? 0) * payoff,
    armor: (hit?.armor ?? 0) * payoff,
    parry: (hit?.parry ?? 0) * payoff,
  };
}

/** Turn a fractional extra-hit count into whole swings. The fraction is a chance. */
export function rollExtraHits(rng: Rng, extraHits: number): number {
  if (extraHits <= 0) return 0;
  const whole = Math.floor(extraHits);
  return whole + (rng.chance(extraHits - whole) ? 1 : 0);
}

/** One tick of stamina recovery. */
export function regenStamina(pools: Pools, perTick: number): void {
  regenResource(pools, 'stamina', perTick);
}
