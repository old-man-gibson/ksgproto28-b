/**
 * The calm secret across offline catch-up: the same ticks leave the same
 * state whether the player watched them or was away. Port of the old
 * `tests/malgeriCatchup.test.ts` (1 case), step 4 port C6. The old catch-up
 * once skipped the first-calm stamp, so the calm lines were fought offline
 * with the flag unset, their kills stayed veiled and the bestiary came out
 * three entries short of the live run.
 *
 * Call shape:
 * - `new Game(state)` and 288,000 `tick()` calls are a kernel loaded from the
 *   hunter's save and `tick(288_000)`; `runOfflineProgress` is `catchUp` on
 *   the same save.
 * - The hunter: `state.attrs[*].level = 150`, `state.level = 60` and
 *   `startActivity('hunt')` are a patch and the command
 *   `world/select-activity`.
 * - `summary.firstCalm` (the old summarised catch-up suppressed the log and
 *   the summary carried the line): here catch-up keeps log lines. The log
 *   slice keeps the newest lines only, and eight hours of fights push the
 *   calm line out of it, so a recorder system in both runs keeps every log
 *   line that names the calm. The away run must have logged the first-calm
 *   line, as the live one did.
 */
import { describe, expect, it } from 'vitest';
import { catchUp, defineSystem, on, type Kernel } from '../src/kernel';
import { systems } from '../src/systems';
import { ATTRIBUTE_LIST, type AttributesState } from '../src/systems/attributes';
import type { BestiaryState } from '../src/systems/bestiary';
import type { CountersState } from '../src/systems/counters';
import { logLine } from '../src/systems/log';
import { CALM_SEEN_KEY, calmSpell, firstCalmLine, worldSeedOf } from '../src/systems/weather';
import { selectActivity } from '../src/systems/world';
import { makeKernel, patch, probe, slice } from './helpers';

const CREATED = 1_754_000_000_000;
const SEED = worldSeedOf(CREATED);
const TICKS_PER_MINUTE = 10;
const OFFLINE_TICKS = 288_000;
const TRIO = ['malgeri_ridge_wolf', 'malgeri_cairn_brute', 'malgeri_hollow_seer'];

/** Keeps every log line that names the calm. Exists only in this test. */
const recorder = defineSystem<{ calm: string[] }>({
  id: 'calm-recorder',
  version: 1,
  initial: () => ({ calm: [] }),
  events: [
    on(logLine, (ctx, { payload }) => {
      if (/calm/i.test(payload.msg)) ctx.state.calm.push(payload.msg);
    }),
  ],
});

const game = (): Kernel => makeKernel([probe, recorder], { seed: 17 });

/** A strong hunter on the open east ridge, the clock a little before the first calm spell. */
function ridgeHunter(): Kernel {
  const k = game();
  const [start] = calmSpell(SEED, 'malgeri_range', 2);
  patch(k, (slices) => {
    slices.world.spot = 'f17_east_ridge';
    slices.world.discovered.push('f17_east_ridge');
    slices.clock.totalTicks = Math.max(0, Math.ceil(start / 3) * 3 * TICKS_PER_MINUTE - 3000);
    slices.weather.seed = SEED;
    for (const a of ATTRIBUTE_LIST) (slices.attributes as AttributesState).attrs[a.id].level = 150;
    slices.levels.level = 60;
  });
  expect(k.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);
  return k;
}

describe('catch-up and the first calm', () => {
  it('288,000 ticks offline and the same ticks live leave the same flag and bestiary count', () => {
    const envelope = ridgeHunter().save(0);

    const live = game();
    expect(live.load(envelope).ok).toBe(true);
    live.tick(OFFLINE_TICKS);

    const away = game();
    expect(away.load(catchUp({ systems: [...systems, probe, recorder], envelope, ticks: OFFLINE_TICKS, now: 0 })).ok).toBe(true);

    const counts = (k: Kernel) => slice<CountersState>(k, 'counters').counts;
    const book = (k: Kernel) => slice<BestiaryState>(k, 'bestiary').entries;
    const liveFlag = counts(live)[CALM_SEEN_KEY] ?? 0;
    expect(liveFlag, 'the live run must stand under a calm for the comparison to mean anything').toBe(1);
    expect(counts(away)[CALM_SEEN_KEY] ?? 0).toBe(liveFlag);
    expect(counts(away)['bestiary:entries'] ?? 0).toBe(counts(live)['bestiary:entries'] ?? 0);
    expect(slice<{ calm: string[] }>(away, 'calm-recorder').calm).toEqual([firstCalmLine()]);
    expect(slice<{ calm: string[] }>(live, 'calm-recorder').calm).toEqual([firstCalmLine()]);
    // The hunter really fought the calm lines, so the comparison covers veiled kills.
    expect(book(live).malgeri_ridge_wolf?.kills ?? 0).toBeGreaterThan(0);
    for (const id of TRIO) {
      expect((book(away)[id]?.firstKill ?? 0) > 0, id).toBe((book(live)[id]?.firstKill ?? 0) > 0);
      expect(book(away)[id]?.kills ?? 0, id).toBe(book(live)[id]?.kills ?? 0);
    }
  }, 180_000);
});
