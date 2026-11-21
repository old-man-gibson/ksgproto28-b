/**
 * The outcome digest of John's climb to the first prestige (`tests/john.ts`,
 * floors 0 to 6), for `tests/outcome.test.ts` and `scripts/budget-runs.ts`.
 */
import { digestOf, type Digest } from './budgetRuns';
import { runJohn, SEGMENTS } from './john';

/** The segments of run 1 (floors 0 to 6): the digest stops at the first prestige. */
const RUN_ONE = SEGMENTS.slice(0, SEGMENTS.indexOf('floor6') + 1);
const runOne = <T>(rec: Record<string, T>): Record<string, T> => Object.fromEntries(RUN_ONE.map((k) => [k, rec[k]]));

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
    done: runOne(r.done),
    knockouts: runOne(r.knockouts),
    levels: runOne(r.levels),
    gold: runOne(r.gold),
    bossTries: runOne(r.bossTries),
    fights: r.fights,
    goldEarned: r.goldEarned,
    harvest: r.harvest,
    end: digestOf(r.kernel.save(0)),
  };
}
