import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { startBench, type Placement } from '../src/systems/benches';
import {
  CORE,
  grantFacet,
  hitTaken,
  recallClone,
  recallClones,
  sendCloneCommand,
  sendCloneToBench,
  switchFacet,
  type FacetState,
} from '../src/systems/facet';
import { cloneReach, floorIndexOf } from '../src/systems/facet/clones';
import type { GoldState } from '../src/systems/gold';
import { gradesHeld, type MaterialsState, type QualityTier } from '../src/systems/materials';
import type { SkillsState } from '../src/systems/skills';
import { statBlockOf } from '../src/systems/stats';
import { selectActivity, SPOTS } from '../src/systems/world';
import { ask, makeGame, patch, reads, slice } from './helpers';

// Skipped without the Facet core (docs/SETUP.md); tests/facet.test.ts says so.

/**
 * Shadow Clone, deployed (old `systems/clones.ts`, docs/FACET.md): a clone
 * sent to a job, gathering or a bench works it on its own at 40% of the
 * yield and 25% of the skill XP; bench crafts are whole but take 2.5 times as
 * long. Clones end when replaced, recalled, left too many floors behind, or
 * on a knockout. Old `tests/shadowClone.test.ts`, the 8 cases.
 *
 * Changed from the old tests where the skeleton changed the call: the old
 * `state.level`, `state.spot` and `state.recovering` writes are a `patch`;
 * `game.step()` is `kernel.tick()`; the old `facetSignal('hitTaken')` is the
 * request `facet/hit-taken`; the old bench case stood in the shelved home
 * (`my_home`), here the Granary Kitchens, whose board is the same bench.
 */

const BOARD: Placement = { board: { id: 'wild_onion', quality: 'c' }, technique: { id: 'sliced', quality: 'c' } };

/** A new game at `spot`, character level `level`, the switch on, Shadow Clone granted when `clones`. The old `at`. */
function at(spot: string, clones: boolean, level = 1): Kernel {
  const k = makeGame({ seed: 7 });
  patch(k, (slices) => {
    slices.levels.level = level;
    slices.world.spot = spot;
  });
  expect(k.dispatch(switchFacet({ on: true })).ok).toBe(true);
  if (clones) expect(k.dispatch(grantFacet({ id: 'shadow_clone' })).ok).toBe(true);
  return k;
}

const facetOf = (k: Kernel) => slice<FacetState>(k, 'facet');
const goldOf = (k: Kernel) => slice<GoldState>(k, 'gold').gold;
const cookingXp = (k: Kernel) => slice<SkillsState>(k, 'skills').skills.cooking?.xp ?? 0;
const send = (k: Kernel, activity: string) => k.dispatch(sendCloneCommand({ activity })).ok;
const clones = (k: Kernel) => facetOf(k).clones ?? [];
const orders = (k: Kernel) => clones(k).map((c) => c.order);

function grantGraded(k: Kernel, id: string, q: QualityTier, n: number) {
  patch(k, (slices) => {
    const m = slices.materials as MaterialsState;
    m.stock[id] ??= {};
    m.stock[id][q] = (m.stock[id][q] ?? 0) + n;
  });
}

const setCooking = (k: Kernel) => patch(k, (slices) => (slices.skills.skills.cooking = { level: 1, xp: 0 }));
const stockOf = (k: Kernel, id: string, q: QualityTier) => slice<MaterialsState>(k, 'materials').stock[id]?.[q] ?? 0;
const sliced = (k: Kernel) => gradesHeld(slice<MaterialsState>(k, 'materials'), 'wild_onion_sliced').reduce((n, e) => n + e.qty, 0);

/** The first spot on the ascent floor of `index`. */
const spotOnFloor = (index: number) => Object.keys(SPOTS).find((id) => floorIndexOf(id) === index)!;

describe.skipIf(!CORE)('Shadow Clone, deployed', () => {
  it('a clone works a job on its own for 40% of the pay', () => {
    // The player on the job, for comparison.
    const self = at('the_alembics', false);
    expect(self.dispatch(selectActivity({ activity: 'job_retorts' })).ok).toBe(true);
    const start = goldOf(self);
    self.tick(2_100);
    const paid = goldOf(self) - start;
    // A clone on it while the player stands idle.
    const k = at('the_alembics', true);
    const before = goldOf(k);
    expect(send(k, 'job_retorts')).toBe(true);
    k.tick(2_100);
    expect(paid).toBeGreaterThan(0);
    expect((goldOf(k) - before) / paid).toBeGreaterThan(0.3);
    expect((goldOf(k) - before) / paid).toBeLessThan(0.5);
  });

  it('a craft by a clone pays 25% of the skill XP yours does', () => {
    // The cut's grade is rolled, capped at the onion's, and its XP grows with
    // the grade. The old case used grade c and its stream gave both crafts
    // the same cut. Here the generator also draws on every tick (the
    // kernel's toy `counter` system), so the two crafts, made on different
    // ticks, roll differently. Grade f, the lowest, pins the cut to f in
    // both, and the case tests the share alone.
    const lowest: Placement = { board: { id: 'wild_onion', quality: 'f' }, technique: { id: 'sliced', quality: 'f' } };
    const one = (clone: boolean) => {
      const k = at('granary_kitchens', clone);
      grantGraded(k, 'wild_onion', 'f', 1);
      setCooking(k);
      if (clone) expect(k.dispatch(sendCloneToBench({ discipline: 'preparing', placement: lowest })).ok).toBe(true);
      else expect(k.dispatch(startBench({ discipline: 'preparing', placement: lowest, count: 1 })).ok).toBe(true);
      k.tick(400);
      return cookingXp(k);
    };
    const mine = one(false);
    expect(mine).toBeGreaterThan(0);
    expect(one(true)).toBeCloseTo(mine * 0.25);
  });

  it('a new clone with every clone out replaces the oldest; recall ends one or all', () => {
    const k = at('the_alembics', true, 25);
    send(k, 'job_retorts');
    send(k, 'job_retorts');
    send(k, 'job_retorts');
    expect(orders(k)).toEqual([1, 2, 3]);
    send(k, 'job_retorts');
    expect(orders(k)).toEqual([2, 3, 4]);
    expect(k.dispatch(recallClone({ order: 3 })).ok).toBe(true);
    expect(orders(k)).toEqual([2, 4]);
    expect(k.dispatch(recallClones()).ok).toBe(true);
    expect(facetOf(k).clones).toBeUndefined();
  });

  it('level 1 allows one clone, and each clone out takes 5% off max mana', () => {
    const k = at('the_alembics', true, 25);
    const mana = statBlockOf(reads(k)).maxMana;
    send(k, 'job_retorts');
    send(k, 'job_retorts');
    expect(Math.abs(statBlockOf(reads(k)).maxMana - mana * 0.9)).toBeLessThan(1);
    expect(k.staleStats()).toEqual([]);
    const low = at('the_alembics', true, 1);
    send(low, 'job_retorts');
    send(low, 'job_retorts');
    expect(clones(low)).toHaveLength(1);
  });

  it('clones stop when the player is more floors away than (level - 10) / 5', () => {
    expect(floorIndexOf('the_alembics')).toBe(0);
    const one = spotOnFloor(1);
    const three = spotOnFloor(3);
    const near = at('the_alembics', true, 1);
    expect(cloneReach(1)).toBe(0);
    send(near, 'job_retorts');
    patch(near, (slices) => (slices.world.spot = one));
    near.tick();
    expect(clones(near)).toHaveLength(0);
    const far = at('the_alembics', true, 20);
    expect(cloneReach(20)).toBe(2);
    send(far, 'job_retorts');
    patch(far, (slices) => (slices.world.spot = one));
    far.tick();
    expect(clones(far)).toHaveLength(1);
    patch(far, (slices) => (slices.world.spot = three));
    far.tick();
    expect(clones(far)).toHaveLength(0);
  });

  it('a knockout ends every clone; a hit does not', () => {
    const k = at('the_alembics', true, 25);
    send(k, 'job_retorts');
    ask(k, hitTaken, { amount: 3, blow: 3, type: 'slashing', attacker: 'foe:0', self: 0, boss: 0 });
    k.tick();
    expect(clones(k)).toHaveLength(1);
    patch(k, (slices) => (slices.world.recovering = true));
    k.tick();
    expect(clones(k)).toHaveLength(0);
    expect(k.dispatch(sendCloneCommand({ activity: 'job_retorts' }))).toEqual({ ok: false, reason: 'Knocked out' });
  });

  it('at a bench a clone makes whole crafts from stock, 2.5 times slower than you', () => {
    const k = at('granary_kitchens', true);
    grantGraded(k, 'wild_onion', 'c', 4);
    setCooking(k);
    expect(k.dispatch(sendCloneToBench({ discipline: 'preparing', placement: BOARD })).ok).toBe(true);
    const bench = clones(k)[0].bench!;
    k.tick(bench.ticksPer * 2 + 1);
    expect(sliced(k)).toBe(2 * bench.batch);
    k.tick(bench.ticksPer * 10);
    expect(sliced(k)).toBe(4);
    expect(stockOf(k, 'wild_onion', 'c')).toBe(0);
    expect(clones(k)).toHaveLength(1);
  });

  it('clones survive a save and load', () => {
    const k = at('the_alembics', true, 25);
    send(k, 'job_retorts');
    const loaded = makeGame({ seed: 5 });
    expect(loaded.load(JSON.parse(JSON.stringify(k.save(0)))).ok).toBe(true);
    expect(clones(loaded)).toHaveLength(1);
    expect(clones(loaded)[0].activity).toBe('job_retorts');
  });
});
