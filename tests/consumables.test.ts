/**
 * Using held consumables: port of the consumable cases of old
 * `tests/rarefinds.test.ts` ("what each find does", and the spent card that
 * is never rolled again), the study-card case of old `tests/martial.test.ts`,
 * and the healing salve. `useConsumable(state, bus, id)` is the command
 * `consumables/use`; `canUse(state, id, q)` is `canUse(reads, slice, id, q)`.
 *
 * Changed: the old drop case rolled `rollActivityDrops` by hand until the
 * slip came (up to 6,000 cycles). Here the drop roll is inside the world
 * tick, so the case states the rule it guards: once the slip is spent the
 * mercy ledger never sees its key, on a fresh life it does.
 *
 * Not ported here: Chancery (the seal's price is tested in
 * `tests/shops.test.ts`; the stamp is checked below), Wrights (the bronze
 * recipes are smithing), Granaries (the pot is cooking).
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import { wordUnlocked } from '../src/systems/arcane';
import { canUse, cardSpent, consumableSpec, useConsumable, VOTIVE_KEY, type ConsumablesState } from '../src/systems/consumables';
import type { CountersState } from '../src/systems/counters';
import { assignFavor, deityKnown, favorWith, floatingFavor, meetDeity, type DivineState } from '../src/systems/divine';
import { techniqueForm, type MartialState } from '../src/systems/martial';
import { isGraded, MATERIALS, type MaterialsState, type QualityTier } from '../src/systems/materials';
import type { MercyState } from '../src/systems/mercy';
import { heldOf, type StatusesState } from '../src/systems/statuses';
import { hasTitle, type TitlesState } from '../src/systems/titles';
import { selectActivity } from '../src/systems/world';
import { hpOf, logOf, setPool } from './combatHelpers';
import { ask, makeGame, patch, reads, slice } from './helpers';
import { gameAt } from './worldHelpers';

const fresh = (seed = 5) => makeGame({ seed });
const counter = (g: Kernel, key: string) => slice<CountersState>(g, 'counters').counts[key] ?? 0;
const state = (g: Kernel) => slice<ConsumablesState>(g, 'consumables');
const can = (g: Kernel, id: string, q: QualityTier = 'c') => canUse({ ...reads(g), tick: g.tickCount }, state(g), id, q);

/** Hold one of a material and use it. */
function use(g: Kernel, id: string, quality: QualityTier = 'c') {
  patch(g, (slices) => {
    const m = slices.materials as MaterialsState;
    if (isGraded(id)) {
      m.stock[id] ??= {};
      m.stock[id][quality] = (m.stock[id][quality] ?? 0) + 1;
    } else m.counts[id] = (m.counts[id] ?? 0) + 1;
  });
  return g.dispatch(useConsumable({ id, quality }));
}

describe('what each find does', () => {
  it('Scholars: the word slip lifts "stone", once', () => {
    const g = fresh();
    expect(wordUnlocked(reads(g), 'stone')).toBe(false);
    expect(use(g, 'word_slip_stone').ok).toBe(true);
    expect(wordUnlocked(reads(g), 'stone')).toBe(true);
    patch(g, (slices) => (slices.materials.counts.word_slip_stone = 1));
    expect(can(g, 'word_slip_stone').ok).toBe(false);
    expect(can(g, 'word_slip_stone').reason).toBe('Already done');
  });

  it('Temple: the first token is +2 with every god now and later; later ones are floating favor', () => {
    const g = fresh();
    const div = () => slice<DivineState>(g, 'divine');
    const before = favorWith(div(), 'denjalle');
    expect(use(g, 'votive_token').ok).toBe(true);
    expect(favorWith(div(), 'denjalle')).toBe(before + 2);
    expect(favorWith(div(), 'usvylgr')).toBe(before + 2);
    expect(floatingFavor(reads(g))).toBe(0);
    use(g, 'votive_token');
    use(g, 'votive_token');
    expect(counter(g, VOTIVE_KEY)).toBe(3);
    expect(favorWith(div(), 'denjalle')).toBe(before + 2);
    expect(floatingFavor(reads(g))).toBe(2);
    expect(g.dispatch(assignFavor({ deity: 'usvylgr' })).ok).toBe(true);
    expect(favorWith(div(), 'usvylgr')).toBe(before + 3);
    expect(floatingFavor(reads(g))).toBe(1);
    // An unknown god cannot take it.
    expect(g.dispatch(assignFavor({ deity: 'ikthelthe' })).ok).toBe(false);
    // A god met later starts at the first token's +2.
    expect(deityKnown(reads(g), 'ikthelthe')).toBe(false);
    expect(ask(g, meetDeity, { deity: 'ikthelthe' })).toBe(true);
    expect(favorWith(div(), 'ikthelthe')).toBe(2);
  });

  it('Ironyard: the manual teaches Riposte in canonical form, or perfects a rough one', () => {
    const g = fresh();
    patch(g, (slices) => ((slices.martial as MartialState).techniques = { riposte: { executions: 3, form: 'rough' } }));
    expect(use(g, 'drill_manual_riposte').ok).toBe(true);
    const m = slice<MartialState>(g, 'martial');
    expect(techniqueForm(m, 'riposte')).toBe('canonical');
    expect(m.techniques.riposte.executions).toBe(3);
  });

  it('Chancery: the seal stamps its flag (the price it takes off is tested with the shops)', () => {
    const g = fresh();
    expect(use(g, 'chancery_price_seal').ok).toBe(true);
    expect(counter(g, 'flag:chancery_seal')).toBe(1);
    const seal = MATERIALS.chancery_price_seal;
    expect(logOf(g)).toContain(`${seal.icon} Register: ${seal.name}.`);
  });

  it('Assize: the case file earns the hidden title Friend of the Court', () => {
    const g = fresh();
    expect(hasTitle(slice<TitlesState>(g, 'titles'), 'friend_of_the_court')).toBe(false);
    expect(use(g, 'unclaimed_case_file').ok).toBe(true);
    expect(hasTitle(slice<TitlesState>(g, 'titles'), 'friend_of_the_court')).toBe(true);
  });

  it('a recipe card stamps recipe:<id>, and a second copy is refused as known', () => {
    const g = fresh();
    expect(use(g, 'recipe_herb_rubbed_meat').ok).toBe(true);
    expect(counter(g, 'recipe:herb_rubbed_meat')).toBe(1);
    patch(g, (slices) => (slices.materials.counts.recipe_herb_rubbed_meat = 1));
    expect(can(g, 'recipe_herb_rubbed_meat').reason).toBe('Recipe already known');
  });
});

describe('a spent card is never rolled again', () => {
  const KEY = 'drop:train_int_chalk:word_slip_stone';
  const rolled = (g: Kernel) => JSON.stringify(slice<MercyState>(g, 'mercy').ledger).includes(KEY);

  it('a fresh life rolls the slip on every training cycle at the Chalk Yard', () => {
    const g = gameAt(21, 'chalk_yard');
    expect(g.dispatch(selectActivity({ activity: 'train_int_chalk' })).ok).toBe(true);
    g.tick(100);
    expect(rolled(g)).toBe(true);
  });

  it('once the word is lifted the roll never happens', () => {
    const g = gameAt(21, 'chalk_yard');
    patch(g, (slices) => (slices.counters.counts['flag:word:stone'] = 1));
    expect(cardSpent(reads(g), consumableSpec('word_slip_stone'))).toBe(true);
    expect(g.dispatch(selectActivity({ activity: 'train_int_chalk' })).ok).toBe(true);
    g.tick(100);
    expect(rolled(g)).toBe(false);
  });
});

describe('a study card for a technique', () => {
  it('a study card for an unreachable technique is held back, not spent', () => {
    // Port of the old martial case, which minted a test material after the
    // registry loaded, as this one does.
    const g = fresh(39);
    const id = 'test_drill_manual_lunge';
    MATERIALS[id] = { ...MATERIALS.drill_manual_riposte, id, consumable: { useVerb: 'Study', teachesTechnique: 'lunge' } };
    try {
      patch(g, (slices) => (slices.materials.counts[id] = 1));
      const refused = can(g, id);
      expect(refused.ok).toBe(false);
      expect(refused.reason).toContain('Lunge');
      expect(g.dispatch(useConsumable({ id })).ok).toBe(false);
      expect(slice<MaterialsState>(g, 'materials').counts[id]).toBe(1);
      patch(g, (slices) => ((slices.martial as MartialState).techniques.gather = { executions: 0, form: 'canonical' }));
      expect(can(g, id).ok).toBe(true);
    } finally {
      delete MATERIALS[id];
    }
    // Riposte starts from any position, so its own manual is never held back.
    patch(g, (slices) => (slices.materials.counts.drill_manual_riposte = 1));
    expect(can(g, 'drill_manual_riposte').ok).toBe(true);
  });
});

describe('the healing salve', () => {
  it('heals as a salve, scaled by grade, then waits out its cooldown', () => {
    const g = fresh();
    setPool(g, 'hp', 1);
    expect(use(g, 'healing_salve').ok).toBe(true);
    expect(hpOf(g)).toBeGreaterThan(1);
    expect(logOf(g)).toContain(`${MATERIALS.healing_salve.icon} Applied Fair Healing Salve.`);
    const again = use(g, 'healing_salve');
    expect(again.ok).toBe(false);
    expect(again.ok ? '' : again.reason).toMatch(/^Ready in 10\.0s$/);
    g.tick(100);
    expect(use(g, 'healing_salve').ok).toBe(true);
  });

  it('a refuse-grade salve takes health and makes you ill', () => {
    const g = fresh();
    const hp = hpOf(g);
    expect(use(g, 'healing_salve', 'f').ok).toBe(true);
    expect(hpOf(g)).toBeLessThan(hp);
    expect(heldOf(slice<StatusesState>(g, 'statuses'), PLAYER).some((s) => s.id === 'queasy')).toBe(true);
  });

  it('none held is refused and nothing changes', () => {
    const g = fresh();
    const result = g.dispatch(useConsumable({ id: 'healing_salve', quality: 'c' }));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toBe('None held');
  });
});

describe('food waits for the cooking port', () => {
  it('a dish is refused with a reason and kept', () => {
    const g = fresh();
    const result = use(g, 'mushroom_broth');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toMatch(/^Food: /);
    expect(slice<MaterialsState>(g, 'materials').stock.mushroom_broth?.c).toBe(1);
  });
});

describe('the view', () => {
  it('lists held consumables with a use verb and the reason one is refused', () => {
    const g = fresh();
    patch(g, (slices) => {
      slices.materials.stock.healing_salve = { b: 2 };
      slices.materials.counts.votive_token = 1;
    });
    const rows = (g.view().systems.consumables as { rows: { id: string; verb: string; blocked: string | null; qty: number }[] }).rows;
    expect(rows.find((r) => r.id === 'healing_salve')).toMatchObject({ verb: 'Applied', blocked: null, qty: 2 });
    expect(rows.find((r) => r.id === 'votive_token')).toMatchObject({ verb: 'Offer', blocked: null });
  });
});
