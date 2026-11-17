/**
 * Health, and the one door it changes through. Port of the old
 * `systems/health.ts`.
 *
 * HP is an ordinary pool. Every gain goes through `heal` and every loss
 * through `damagePlayer`, so that conditions and the fight record can observe
 * them: `index.ts` emits an event for each.
 */
import type { DeepReadonly } from '../../kernel';
import type { DamageType, DerivedStats } from '../stats';
import {
  availableMax,
  resourceValue,
  restoreResource,
  setResource,
  spendResource,
  type HealKind,
  type PoolHooks,
  type Pools,
  type ResourcesState,
} from './pools';

/** The damage types that stop a monster's regeneration. */
export const DOUSING_TYPES: ReadonlySet<DamageType> = new Set<DamageType>(['heat', 'acid']);

export interface HealResult {
  kind: HealKind;
  /** The amount asked for. */
  asked: number;
  /** The amount the heal cap let through, before the pool's ceiling. */
  allowed: number;
  /** The amount the pool took. */
  healed: number;
}

/**
 * Restore health. The heal cap limits the amount before it lands; the pool's
 * available max limits what the pool takes. Returns null for an amount of 0
 * or less: nothing happened.
 */
export function heal(pools: Pools, amount: number, kind: HealKind = 'other'): HealResult | null {
  if (amount <= 0) return null;
  const allowed = Math.min(amount, pools.hooks.healAllowance());
  const healed = allowed > 0 ? restoreResource(pools, 'hp', allowed) : 0;
  return { kind, asked: amount, allowed, healed };
}

/** Who dealt a blow, for the fight record. */
export interface DamageSource {
  key: string;
  label: string;
  icon: string;
  /** Entity id of the enemy whose blow it was. */
  by?: string;
  /** The blow as thrown, before armour, resistance and ward. */
  thrown?: number;
  /** The player's own working landing on the player. */
  self?: boolean;
  /** The attacker is the boss of the spot. */
  boss?: boolean;
}

/**
 * Take damage. Returns the amount lost. The caller has already resolved
 * armour, resistances and every other defence.
 */
export function damagePlayer(pools: Pools, amount: number): number {
  if (amount <= 0) return 0;
  return spendResource(pools, 'hp', amount);
}

/** Health as a fraction of the pool's available max. */
export function hpFraction(state: DeepReadonly<ResourcesState>, stats: DerivedStats, hooks: Pick<PoolHooks, 'ceiling'>): number {
  const max = availableMax(stats, hooks, 'hp');
  return max > 0 ? resourceValue(state, 'hp') / max : 0;
}

export function isAlive(state: DeepReadonly<ResourcesState>): boolean {
  return resourceValue(state, 'hp') > 0;
}

/** Drop to the 1 HP a knockout leaves. Not a heal: no condition reads it as treatment. */
export function setHpAfterDefeat(pools: Pools): void {
  setResource(pools, 'hp', 1);
}
