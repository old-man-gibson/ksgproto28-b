/**
 * The outcome digest of John's climb to the first prestige (`tests/john.ts`,
 * floors 0 to 6), for `tests/outcome.test.ts` and `scripts/budget-runs.ts`.
 */
import { digestOf, type Digest } from './budgetRuns';
import { runJohn } from './john';

export const JOHN_SEEDS = [42, 7, 1234];

export interface JohnDigest {
  done: Record<string, number | null>;
  knockouts: Record<string, number>;
  levels: Record<string, number | null>;
  gold: Record<string, number | null>;
  bossTries: Record<string, number>;
  fights: number;
  goldEarned: number;
  harvest: number | null;
  end: Digest;
}

export function johnDigest(seed: number): JohnDigest {
  const r = runJohn({ seed, weapon: 'skip', through: 6 });
  return {
    done: r.done,
    knockouts: r.knockouts,
    levels: r.levels,
    gold: r.gold,
    bossTries: r.bossTries,
    fights: r.fights,
    goldEarned: r.goldEarned,
    harvest: r.harvest,
    end: digestOf(r.kernel.save(0)),
  };
}
