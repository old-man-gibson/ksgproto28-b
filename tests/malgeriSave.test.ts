/**
 * Floor 17 in the save. Port of the old `tests/malgeriSave.test.ts` (6
 * cases), step 4 port C6.
 *
 * The old file tested save step v64 to v65: floor 17 changed its clear from
 * a placeholder fight (`fights:f17_keeper`) to the regent's boss kill
 * (`boss:f17_keeper`) behind the peak gate (`boss:f17_peak`), and a save
 * standing at the old keeper spot without the peak was moved to the landing.
 * This build's save starts at version 1 and has no importer from the old
 * save (docs/REBUILD.md section 1); the placeholder floor never existed here.
 *
 * - Four cases keep their meaning as a save and a load at the current
 *   versions: the clear and the peak gate carry, a save at the keeper spot
 *   stays there with its activity, a save at the landing and an uncleared
 *   save stay as they were, the save text round-trips.
 * - The move to the landing and the idempotence of the step test the old
 *   migration only: `it.todo`, as the other old save migrations of the
 *   rebuild (docs/SPINE.md).
 *
 * No slice changes shape in this port: no migration, no fixture.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { CountersState } from '../src/systems/counters';
import { clearMet, FLOORS, ladderReader } from '../src/systems/ladder';
import { selectActivity, type WorldState } from '../src/systems/world';
import { makeGame, patch, reads, slice } from './helpers';

/** A game standing at `spot` with the given counters. */
function saved(spot: string, counts: Record<string, number> = {}, hunt = false): Kernel {
  const k = makeGame({ seed: 7 });
  patch(k, (slices) => {
    slices.world.spot = spot;
    if (!slices.world.discovered.includes(spot)) slices.world.discovered.push(spot);
    Object.assign(slices.counters.counts, counts);
  });
  if (hunt) expect(k.dispatch(selectActivity({ activity: 'hunt' })).ok).toBe(true);
  return k;
}

/** Save `k` as text and load the text into a new game. */
function reload(k: Kernel): Kernel {
  const text = JSON.stringify(k.save(0));
  const next = makeGame({ seed: 99 });
  const loaded = next.load(JSON.parse(text));
  expect(loaded.ok, loaded.ok ? '' : loaded.error).toBe(true);
  return next;
}

const counts = (k: Kernel) => slice<CountersState>(k, 'counters').counts;
const worldOf = (k: Kernel) => slice<WorldState>(k, 'world');
const cleared = (k: Kernel) => clearMet(ladderReader(reads(k)), FLOORS.ascent_f17);

describe('floor 17 in the save', () => {
  it('keeps the clear and the peak gate of a save that killed the regent', () => {
    // On floor 18's landing, as the old case (step 4 port C7; Hamlet Square before it).
    const k = reload(saved('f18_well_head', { 'boss:f17_keeper': 1, 'boss:f17_peak': 1 }));
    expect(counts(k)['boss:f17_keeper']).toBe(1);
    expect(counts(k)['boss:f17_peak']).toBe(1);
    // Floors 18 to 20 open on the clear.
    expect(cleared(k)).toBe(true);
    expect(worldOf(k).spot).toBe('f18_well_head');
  });

  it('keeps a save that was cleared and standing at the keeper spot where it is, hunting', () => {
    const k = reload(saved('f17_keeper', { 'boss:f17_keeper': 1, 'boss:f17_peak': 1 }, true));
    expect(worldOf(k).spot).toBe('f17_keeper');
    expect(worldOf(k).activity).toBe('hunt');
  });

  it.todo('moves a save standing at the old keeper spot without the peak to the landing (the old v64 to v65 step: no importer here)');

  it('leaves a save at the landing, and an uncleared save elsewhere, as they were', () => {
    const atLanding = reload(saved('f17_landing', {}, true));
    expect(worldOf(atLanding).spot).toBe('f17_landing');
    expect(worldOf(atLanding).activity).toBe('hunt');
    expect(counts(atLanding)['boss:f17_peak'] ?? 0).toBe(0);
    const below = reload(saved('ascent_foot'));
    expect(counts(below)['boss:f17_keeper'] ?? 0).toBe(0);
    expect(counts(below)['boss:f17_peak'] ?? 0).toBe(0);
    expect(cleared(below)).toBe(false);
  });

  it.todo('is idempotent: a second pass over a migrated save changes nothing (the old v64 to v65 step: no importer here)');

  it('round-trips through the save text: a second save and load reads the same', () => {
    const once = reload(saved('f17_keeper', { 'boss:f17_keeper': 1, 'boss:f17_peak': 1 }, true));
    const twice = reload(once);
    expect(twice.save(0)).toEqual(once.save(0));
    expect(counts(twice)['boss:f17_keeper']).toBe(1);
  });
});
