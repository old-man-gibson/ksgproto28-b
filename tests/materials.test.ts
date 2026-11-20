import { describe, expect, it } from 'vitest';
import { createRng } from '../src/kernel';
import type { LogView } from '../src/systems/log';
import {
  countOf,
  craftTagsOf,
  discardStackable,
  discardStackablesBatch,
  GRADE_WEIGHTS,
  gradesHeld,
  grantGraded,
  grantMaterial,
  heldOf,
  isGraded,
  MATERIAL_LIST,
  MATERIALS,
  QUALITY_ORDER,
  QUALITY_TIER_LIST,
  QUALITY_TIERS,
  qualityAtLeast,
  qualityMult,
  rollQuality,
  stockOf,
  takeGraded,
  takeStack,
  type MaterialsState,
  type MaterialsView,
  type QualityTier,
} from '../src/systems/materials';
import { ask, makeGame, patch, slice } from './helpers';

/**
 * Port of the stackable cases of the old tests/inventory-actions.test.ts, and
 * new cases for the graded stock (old `systems/disciplines.ts` had no test
 * file of its own for it).
 *
 * Changed: the call shape. `grantGraded` and the others are requests; a
 * discard is a command.
 *
 * Left behind, as `it.todo`: every sale (shops, port 7). The rune sale and
 * discard cases are in `tests/runecarving.test.ts` (step 3, runecarving).
 */

const stock = (kernel: ReturnType<typeof makeGame>) => slice<MaterialsState>(kernel, 'materials');
const logLines = (kernel: ReturnType<typeof makeGame>) => (kernel.view().systems.log as LogView).log;

describe('material content', () => {
  it('holds every record of the old registry', () => {
    expect(MATERIAL_LIST).toHaveLength(189);
    expect(MATERIALS.slime_gel).toMatchObject({ name: 'Slime Gel', value: 2 });
    expect(isGraded('slime_gel')).toBe(false);
    expect(isGraded('warm_slime_gel')).toBe(true);
    expect(craftTagsOf('warm_slime_gel')).toEqual(['inlay', 'gel']);
    expect(craftTagsOf('no_such_material')).toEqual([]);
  });

  it('the quality file lists the tiers worst to best', () => {
    expect(QUALITY_TIER_LIST.map((t) => t.id)).toEqual([...QUALITY_ORDER]);
    expect(QUALITY_TIERS.f.mult).toBeLessThan(0);
    expect(qualityMult('c')).toBe(1);
    expect(qualityAtLeast('b', 'c')).toBe(true);
    expect(qualityAtLeast('d', 'c')).toBe(false);
  });

  it('a consumable that restores or grants names a real pool and a real status', () => {
    // The schema checks both: `resource` is an enum of the pools and `grants`
    // is a list of status applications. This case pins one record.
    expect(MATERIALS.herb_rubbed_meat.consumable).toMatchObject({
      food: true,
      restore: [{ resource: 'hp', ofMax: 0.15 }],
      grants: [{ id: 'well_fed', intensity: 1 }],
    });
  });
});

describe('graded stock', () => {
  it('a plain material is one count; a graded one is a count per quality', () => {
    const kernel = makeGame();
    expect(ask(kernel, grantMaterial, { id: 'slime_gel', qty: 3 })).toEqual({});
    expect(countOf(stock(kernel), 'slime_gel')).toBe(3);

    ask(kernel, grantGraded, { id: 'common_herb', quality: 'e', qty: 5 });
    ask(kernel, grantGraded, { id: 'common_herb', quality: 'c', qty: 3 });
    expect(stockOf(stock(kernel), 'common_herb', 'e')).toBe(5);
    expect(gradesHeld(stock(kernel), 'common_herb')).toEqual([
      { quality: 'c', qty: 3 },
      { quality: 'e', qty: 5 },
    ]);
    expect(heldOf(stock(kernel), 'common_herb')).toBe(8);
  });

  it('a granted graded material rolls a grade per unit, and names it only for one unit', () => {
    const kernel = makeGame();
    const one = ask(kernel, grantMaterial, { id: 'warm_slime_gel' });
    expect(QUALITY_ORDER).toContain(one.quality);
    expect(stockOf(stock(kernel), 'warm_slime_gel', one.quality!)).toBe(1);

    const many = ask(kernel, grantMaterial, { id: 'warm_slime_gel', qty: 40 });
    expect(many.quality).toBeUndefined();
    expect(heldOf(stock(kernel), 'warm_slime_gel')).toBe(41);
    // Forty separate rolls land on more than one grade.
    expect(gradesHeld(stock(kernel), 'warm_slime_gel').length).toBeGreaterThan(1);
  });

  it('takes a grade whole or not at all, and removes an emptied bucket', () => {
    const kernel = makeGame();
    ask(kernel, grantGraded, { id: 'raw_meat', quality: 'd', qty: 4 });
    expect(ask(kernel, takeGraded, { id: 'raw_meat', quality: 'd', qty: 5 })).toBe(false);
    expect(stockOf(stock(kernel), 'raw_meat', 'd')).toBe(4);
    expect(ask(kernel, takeGraded, { id: 'raw_meat', quality: 'd', qty: 4 })).toBe(true);
    expect(stock(kernel).stock['raw_meat']).toBeUndefined();
  });

  it('takes up to what a stack holds, plain or graded', () => {
    const kernel = makeGame();
    ask(kernel, grantMaterial, { id: 'hardwood', qty: 4 });
    expect(ask(kernel, takeStack, { id: 'hardwood', quality: 'c', qty: 3 })).toBe(3);
    expect(countOf(stock(kernel), 'hardwood')).toBe(1);
    expect(ask(kernel, takeStack, { id: 'hardwood', quality: 'c', qty: 9 })).toBe(1);
    expect(stock(kernel).counts['hardwood']).toBeUndefined();
    expect(ask(kernel, takeStack, { id: 'hardwood', quality: 'c', qty: 1 })).toBe(0);
  });
});

describe('rolling a grade', () => {
  const sample = (luck: number, n = 40_000) => {
    const cell = { value: 99 };
    const rng = createRng({ get: () => cell.value, set: (v) => (cell.value = v) });
    const counts = Object.fromEntries(QUALITY_ORDER.map((q) => [q, 0])) as Record<QualityTier, number>;
    for (let i = 0; i < n; i++) counts[rollQuality(rng, luck)]++;
    return counts;
  };

  it('at luck 1 each grade turns up at its weight', () => {
    const counts = sample(1);
    const total = Object.values(GRADE_WEIGHTS).reduce((a, b) => a + b, 0);
    for (const q of QUALITY_ORDER) expect(counts[q] / 40_000, q).toBeCloseTo(GRADE_WEIGHTS[q] / total, 1);
  });

  it('luck weights the better grades up and the worse ones down', () => {
    const plain = sample(1);
    const lucky = sample(4);
    expect(lucky.s).toBeGreaterThan(plain.s);
    expect(lucky.a).toBeGreaterThan(plain.a);
    expect(lucky.f).toBeLessThan(plain.f);
  });
});

describe('selling and dumping graded stackables', () => {
  it.todo('prices a grade above the base and reduces its stock (selling: port 7)');

  it('dumps a grade for nothing', () => {
    const kernel = makeGame();
    ask(kernel, grantGraded, { id: 'hearty_stew', quality: 'c', qty: 2 });
    // Asking for more than held.
    expect(kernel.dispatch(discardStackable({ id: 'hearty_stew', quality: 'c', qty: 5 })).ok).toBe(true);
    expect(slice<{ gold: number }>(kernel, 'gold').gold).toBe(0);
    expect(stock(kernel).stock['hearty_stew']).toBeUndefined();
    expect(logLines(kernel).at(-1)).toMatchObject({ msg: 'Discarded 🍲 Fair Hearty Stew ×2.', kind: 'info' });
  });

  it('handles plain (ungraded) materials too', () => {
    const kernel = makeGame();
    patch(kernel, (slices) => ((slices.materials as MaterialsState).counts['hardwood'] = 4));
    kernel.dispatch(discardStackable({ id: 'hardwood', quality: 'c', qty: 3 }));
    expect(stock(kernel).counts['hardwood']).toBe(1);
  });

  it('a discard of a stack that is not held is skipped with a reason', () => {
    const kernel = makeGame();
    expect(kernel.dispatch(discardStackable({ id: 'hardwood', quality: 'c', qty: 1 }))).toEqual({
      ok: false,
      reason: 'no Hardwood is held',
    });
  });
});

describe('pouch housekeeping (batch)', () => {
  function stocked() {
    const kernel = makeGame();
    ask(kernel, grantGraded, { id: 'common_herb', quality: 'e', qty: 5 }); // Poor
    ask(kernel, grantGraded, { id: 'common_herb', quality: 'c', qty: 3 }); // Fair
    ask(kernel, grantGraded, { id: 'raw_meat', quality: 'd', qty: 4 }); // Common
    ask(kernel, grantGraded, { id: 'warm_slime_gel', quality: 'a', qty: 2 }); // Superb
    return kernel;
  }

  it.todo('sells every listed stack whole, in one summed log line (selling: port 7)');

  it('dumps listed stacks for nothing, in one line', () => {
    const kernel = stocked();
    kernel.dispatch(
      discardStackablesBatch({
        refs: [
          { id: 'common_herb', quality: 'e' },
          { id: 'common_herb', quality: 'c' },
        ],
        noun: 'ingredient',
      }),
    );
    expect(slice<{ gold: number }>(kernel, 'gold').gold).toBe(0);
    expect(stock(kernel).stock['common_herb']).toBeUndefined();
    // The untouched stacks stay.
    expect(stockOf(stock(kernel), 'raw_meat', 'd')).toBe(4);
    const lines = logLines(kernel).filter((l) => l.msg.startsWith('Discarded'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'Discarded 8 ingredients.', kind: 'info' });
  });

  it('does nothing (and logs nothing) for an empty batch', () => {
    const kernel = stocked();
    expect(kernel.dispatch(discardStackablesBatch({ refs: [] }))).toEqual({
      ok: false,
      reason: 'none of the listed stacks is held',
    });
    expect(logLines(kernel).filter((l) => /Sold|Discarded/.test(l.msg))).toHaveLength(0);
  });
});

// "selling and dumping runes": ported with runecarving, in tests/runecarving.test.ts.

describe('the materials view', () => {
  it('lists held materials in registry order with their grades, best first', () => {
    const kernel = makeGame();
    ask(kernel, grantGraded, { id: 'common_herb', quality: 'e', qty: 5 });
    ask(kernel, grantGraded, { id: 'common_herb', quality: 'b', qty: 1 });
    ask(kernel, grantMaterial, { id: 'slime_gel', qty: 2 });
    const view = kernel.view().systems.materials as MaterialsView;
    expect(view.held.map((m) => m.id)).toEqual(['slime_gel', 'common_herb']);
    expect(view.held[1]).toMatchObject({
      qty: 6,
      grades: [
        { quality: 'b', name: 'Fine', qty: 1 },
        { quality: 'e', name: 'Poor', qty: 5 },
      ],
    });
  });

  it('the slice survives a save and a load', () => {
    const kernel = makeGame();
    ask(kernel, grantGraded, { id: 'common_herb', quality: 'e', qty: 5 });
    ask(kernel, grantMaterial, { id: 'slime_gel', qty: 2 });
    const other = makeGame();
    expect(other.load(JSON.parse(JSON.stringify(kernel.save(0)))).ok).toBe(true);
    expect(stock(other)).toEqual(stock(kernel));
  });
});
