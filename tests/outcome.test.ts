/**
 * Same seed, same outcome. John's climb to the first prestige, seeds 42, 7
 * and 1234, ends where it ended on `main` before the catch-up work: the tick
 * each floor finished on, the knockouts, the levels, the gold, the generator
 * and a hash of every slice (`tests/outcomeDigests.ts`).
 *
 * The six offline budget runs compare their digests in
 * `tests/budgets.test.ts` and `tests/budgetsWorld.test.ts`, which run them
 * anyway. Project `john`: these are headless climbs.
 */
import { describe, expect, it } from 'vitest';
import { JOHN_DIGESTS } from './outcomeDigests';
import { johnDigest, JOHN_SEEDS } from './johnDigest';

describe('outcome digest', () => {
  for (const seed of JOHN_SEEDS) {
    it(`John, seed ${seed}, reaches the first prestige as recorded`, () => {
      expect(johnDigest(seed)).toEqual(JOHN_DIGESTS[seed]);
    }, 60_000);
  }
});
