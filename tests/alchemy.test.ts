/**
 * Port of old `tests/alchemy.test.ts`. Changed only where the call shape
 * changed: the game is a kernel (`makeGame`), state is set with `patch`,
 * the bench is the request `alchemy/brew` and the flask is the command
 * `alchemy/use-flask`. The old `previewBrew(state, placement)` is
 * `checkBrew(reads, placement)`. The old test advanced `totalTicks` past the
 * flask clock; here the clock is the slice field `flaskReady`. The old
 * novelty test compared the stove (an unordered bench, cooking); here it
 * compares an unordered copy of the Alembic, as cooking is not ported.
 */
import { describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import {
  activeCoating,
  ALCHEMY,
  benchReadsOf,
  BREW_MAX_DURATION,
  brewRequest,
  canUseFlask,
  checkBrew,
  composeBrew,
  formOf,
  formulaFor,
  REAGENTS,
  resolveBrew,
  spendCoatingRequest,
  TEXT,
  useFlask,
  type AlchemyState,
} from '../src/systems/alchemy';
import { noveltyKeys, type GradedStack, type Placement } from '../src/systems/benches';
import { MIRACLES } from '../src/systems/divine';
import type { ItemsState } from '../src/systems/items';
import type { QualityTier } from '../src/systems/materials';
import { applyStatus, fireStatusEvent, heldOf, isHarmful, STATUSES, type StatusApplication, type StatusesState } from '../src/systems/statuses';
import { combatOf, feedOf, hpOf, huntingGame, keepHunting, setPool } from './combatHelpers';
import { ask, equip, giveItem, makeGame, patch, reads, slice } from './helpers';

const fresh = (seed = 1) => makeGame({ seed });
const at = (id: string, quality: QualityTier = 'c'): GradedStack => ({ id, quality });
const alch = (g: Kernel) => slice<AlchemyState>(g, 'alchemy');

/** Stock the whole shelf and open every step, so sequence is the only variable. */
function shelf(g: Kernel, level = 40) {
  patch(g, (slices) => {
    for (const id of Object.keys(REAGENTS)) {
      slices.materials.stock[id] ??= {};
      for (const q of ['f', 'c', 'a', 's'] as QualityTier[]) slices.materials.stock[id][q] = (slices.materials.stock[id][q] ?? 0) + 10;
    }
    slices.skills.skills.alchemy = { level, xp: 0 };
  });
}

/** Lay a sequence out across the alembic's numbered steps. */
const lay = (...ids: (string | GradedStack)[]): Placement => {
  const out: Placement = {};
  ids.forEach((v, i) => {
    out[`step${i + 1}`] = typeof v === 'string' ? at(v) : v;
  });
  return out;
};

const seq = (...ids: string[]) => composeBrew(ids.map((id) => at(id)));
const brew = (g: Kernel, placement: Placement) => ask(g, brewRequest, { placement });
const use = (g: Kernel, index: number) => g.dispatch(useFlask({ index }));
const preview = (g: Kernel, placement: Placement) => checkBrew(benchReadsOf(reads(g)), placement);
const canUse = (g: Kernel, index: number) => canUseFlask({ ...reads(g), tick: g.tickCount }, alch(g), index);
const stock = (g: Kernel, id: string, q: QualityTier) => slice<{ stock: Record<string, Record<string, number>> }>(g, 'materials').stock[id]?.[q] ?? 0;
const hasStatus = (g: Kernel, id: string) => heldOf(slice<StatusesState>(g, 'statuses'), PLAYER).some((s) => s.id === id);
const give = (g: Kernel, app: StatusApplication) => ask(g, applyStatus, { entity: PLAYER, app, source: 'test' });
const weaponUid = (g: Kernel) => slice<ItemsState>(g, 'items').equipment.weapon?.uid;
const coatingOf = (g: Kernel) => alch(g).coating;
const spend = (g: Kernel) => ask(g, spendCoatingRequest, undefined);
const setWeapon = (g: Kernel, uid: number | null) =>
  patch(g, (slices) => {
    if (uid === null) delete slices.items.equipment.weapon;
    else slices.items.equipment.weapon = { uid, defId: 'rusty_sword', slots: 0, runes: [] };
  });
const clearClock = (g: Kernel) => patch(g, (slices) => (slices.alchemy.flaskReady = 0));

describe('the sequence is the recipe', () => {
  it('reverses into a different brew — the whole premise', () => {
    const early = seq('spring_water', 'gloomcap', 'mendroot');
    const late = seq('spring_water', 'mendroot', 'gloomcap');
    expect(early.potency).toBeCloseTo(late.potency, 5);
    expect(early.essences[0].spec.id).toBe('mending');
    expect(late.essences[0].spec.id).toBe('gloom');
  });

  it('law 1: steeping trades character for strength', () => {
    const last = seq('spring_water', 'emberbloom');
    const buried = seq('spring_water', 'emberbloom', 'fixing_salt', 'bone_ash');
    expect(last.essences[0].weight).toBeGreaterThan(buried.essences[0]?.weight ?? 0);
    expect(buried.potency).toBeGreaterThan(last.potency);
  });

  it('law 1: an essence added last keeps all of itself', () => {
    const s = seq('spring_water', 'quicksilver', 'emberbloom');
    expect(s.essences[0].weight).toBeCloseTo(REAGENTS.emberbloom.essence!.power, 5);
  });

  it('law 2: an operator finds only what came before it', () => {
    const saltFirst = seq('fixing_salt', 'grain_spirit', 'quicksilver', 'emberbloom');
    const saltLast = seq('grain_spirit', 'quicksilver', 'emberbloom', 'fixing_salt');
    expect(saltFirst.volatility).toBeGreaterThan(saltLast.volatility);
    expect(saltLast.duration).toBeGreaterThan(saltFirst.duration);
  });

  it('law 2: brimstone catches only in a brew already running', () => {
    const roused = seq('grain_spirit', 'quicksilver', 'emberbloom', 'brimstone');
    const cold = seq('spring_water', 'emberbloom', 'brimstone');
    expect(roused.notes[3]).toContain('so it ignites');
    expect(cold.notes[2]).toContain('so it fails');
  });

  it('law 2: ash takes the weakest substance out, and only when there is one', () => {
    const purified = seq('spring_water', 'frostmoss', 'emberbloom', 'bone_ash');
    expect(purified.essences).toHaveLength(1);
    const useless = seq('bone_ash', 'spring_water', 'emberbloom');
    expect(useless.notes[0]).toContain('No essence before it');
  });
});

describe('the reading', () => {
  it('has exactly one line per step, in order, each naming its reagent', () => {
    const ids = ['grain_spirit', 'quicksilver', 'emberbloom', 'brimstone', 'fixing_salt'];
    const s = seq(...ids);
    expect(s.notes).toHaveLength(ids.length);
    ids.forEach((id, i) => expect(s.notes[i]).toContain(REAGENTS[id].name));
  });

  it('opens the summary with the form and the dial that decided it', () => {
    expect(seq('grain_spirit', 'quicksilver', 'emberbloom').summary[0]).toBe(
      'Form: spirit base, volatility 1.8 (1.0 or more) → Flask.',
    );
    expect(seq('emberbloom', 'quicksilver').summary[0]).toBe('Form: no base → Residue.');
  });

  it('names what a form leaves unused instead of dropping it silently', () => {
    expect(seq('pressed_oil', 'quicksilver', 'thunderbloom').summary.join(' ')).toContain(
      'Not used by an Oil: Storm (buffs, Mana restore)',
    );
    expect(seq('spring_water', 'emberbloom').summary.join(' ')).toContain('Ember (heat damage, afflictions)');
    expect(seq('grain_spirit', 'quicksilver', 'emberbloom').summary.join(' ')).not.toContain('Not used');
  });

  it('quotes the numbers the fold actually used', () => {
    const s = seq('grain_spirit', 'quicksilver', 'emberbloom', 'brimstone');
    expect(s.notes[3]).toContain('Potency ×1.55 → 5.83');
    expect(s.summary.join(' ')).toContain('35% of the excess stays → 5.29');
    expect(s.potency).toBeCloseTo(5.29, 2);
  });
});

describe('the outcome table', () => {
  it('is solvent across, volatility down', () => {
    expect(formOf('water', 0)).toBe('elixir');
    expect(formOf('water', 2)).toBe('draught');
    expect(formOf('spirit', 0)).toBe('fume');
    expect(formOf('spirit', 2)).toBe('bomb');
    expect(formOf('oil', 0)).toBe('salve');
    expect(formOf('oil', 2)).toBe('oil');
    expect(formOf('none', 5)).toBe('residue');
  });

  it('reads volatility on every solvent — no cell ignores it', () => {
    for (const medium of ['water', 'oil', 'spirit'] as const) {
      expect(formOf(medium, 0)).not.toBe(formOf(medium, 2));
    }
  });

  it('raises nothing without a solvent', () => {
    const s = seq('emberbloom', 'quicksilver', 'brimstone');
    expect(s.form).toBe('residue');
    expect(s.medium).toBe('none');
  });

  it('makes a bomb out of spirit, agitation and a lit substance', () => {
    const s = seq('grain_spirit', 'quicksilver', 'emberbloom', 'brimstone');
    expect(s.form).toBe('bomb');
    expect(s.strikes.length).toBeGreaterThan(0);
    expect(s.strikes.some((k) => k.type === 'heat')).toBe(true);
  });

  it('makes an elixir out of still water, and it grants rather than restores', () => {
    const s = seq('spring_water', 'mendroot', 'gloomcap');
    expect(s.form).toBe('elixir');
    expect(s.grants.some((g) => g.id === 'concealed')).toBe(true);
    expect(s.restore).toHaveLength(0);
  });

  it('makes a draught out of roused water, and it restores rather than grants', () => {
    const s = seq('spring_water', 'quicksilver', 'mendroot');
    expect(s.form).toBe('draught');
    expect(s.restore.some((r) => r.resource === 'hp' && r.amount > 0)).toBe(true);
    expect(s.grants).toHaveLength(0);
  });

  it('makes a salve out of settled oil, and only a salve cures', () => {
    const s = seq('pressed_oil', 'mendroot');
    expect(s.form).toBe('salve');
    expect(s.cures).toContain('poison');
  });

  it('makes a weapon oil out of roused oil — per-blow bite and riders', () => {
    const s = seq('pressed_oil', 'quicksilver', 'emberbloom');
    expect(s.form).toBe('oil');
    expect(s.blows).toBeGreaterThan(1);
    expect(s.strikes.some((k) => k.type === 'heat')).toBe(true);
    expect(s.inflicts.some((i) => i.id === 'on_fire')).toBe(true);
    const flask = seq('grain_spirit', 'quicksilver', 'emberbloom');
    expect(s.strikes[0].power).toBeLessThan(flask.strikes[0].power / 2);
    expect(s.cures).toHaveLength(0);
    expect(s.restore).toHaveLength(0);
  });

  it('makes a fume when spirit never catches — afflictions, no blow', () => {
    const s = seq('grain_spirit', 'nightcap', 'fixing_salt');
    expect(s.form).toBe('fume');
    expect(s.strikes).toHaveLength(0);
    expect(s.inflicts.some((i) => i.id === 'poison')).toBe(true);
  });
});

describe('solvents', () => {
  it('caps what a brew can hold, and spills the rest', () => {
    const s = seq('grain_spirit', 'emberbloom', 'nightcap', 'thunderbloom', 'frostmoss');
    expect(s.summary.some((n) => n.startsWith('Over the limit'))).toBe(true);
  });

  it('a second solvent thins what is already there', () => {
    const neat = seq('grain_spirit', 'quicksilver', 'emberbloom');
    const cut = seq('grain_spirit', 'quicksilver', 'spring_water', 'emberbloom');
    expect(cut.volatility).toBeLessThan(neat.volatility);
    expect(cut.medium).toBe('spirit');
  });
});

describe('grades', () => {
  it('scale a brew without deciding it', () => {
    const poor = composeBrew([at('spring_water', 'e'), at('mendroot', 'e')]);
    const fine = composeBrew([at('spring_water', 'a'), at('mendroot', 'a')]);
    expect(fine.potency).toBeGreaterThan(poor.potency);
    expect(fine.form).toBe(poor.form);
  });
});

describe('the bench', () => {
  it('refuses a sequence too short to be one', () => {
    const g = fresh();
    shelf(g);
    expect(preview(g, lay('spring_water')).ok).toBe(false);
  });

  it('refuses reagents the alchemist has not reached', () => {
    const g = fresh();
    shelf(g, 0);
    const check = preview(g, lay('spring_water', 'gloomcap'));
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Alchemy');
  });

  it('spends the sequence and shelves a flask that remembers it', () => {
    const g = fresh();
    shelf(g);
    const before = stock(g, 'mendroot', 'c');
    const expected = preview(g, lay('spring_water', 'mendroot')).spec!;
    expect(brew(g, lay('spring_water', 'mendroot'))).toBe(true);
    expect(stock(g, 'mendroot', 'c')).toBe(before - 1);
    expect(alch(g).flasks).toHaveLength(1);
    expect(alch(g).flasks[0].steps.map((s) => s.id)).toEqual(['spring_water', 'mendroot']);
    expect(resolveBrew(alch(g).flasks[0]).name).toBe(expected.name);
  });

  it('a reagent laid twice at one grade needs two in stock', () => {
    const g = fresh();
    patch(g, (slices) => {
      slices.skills.skills.alchemy = { level: 0, xp: 0 };
      slices.materials.stock.spring_water = { b: 1 };
    });
    const twice = lay(at('spring_water', 'b'), at('spring_water', 'b'));
    const check = preview(g, twice);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/1 Spring Water of that grade; this layout uses 2/);
    expect(brew(g, twice)).toBe(false);
    expect(stock(g, 'spring_water', 'b')).toBe(1);
  });

  it('closes gaps: an empty step in the middle is not a step', () => {
    const g = fresh();
    shelf(g);
    const gappy: Placement = { step1: at('spring_water'), step4: at('mendroot') };
    const check = preview(g, gappy);
    expect(check.ok).toBe(true);
    expect(check.sequence!.map((s) => s.id)).toEqual(['spring_water', 'mendroot']);
  });

  it('recognises a written formula, exactly and in order', () => {
    expect(formulaFor(['grain_spirit', 'quicksilver', 'emberbloom', 'brimstone'])?.id).toBe('smoulder_flask');
    expect(formulaFor(['grain_spirit', 'emberbloom', 'quicksilver', 'brimstone'])).toBeUndefined();
  });

  it('keys novelty on the ORDER, so a permutation is a fresh discovery', () => {
    const a = noveltyKeys(ALCHEMY, lay('spring_water', 'mendroot', 'gloomcap'));
    const b = noveltyKeys(ALCHEMY, lay('spring_water', 'gloomcap', 'mendroot'));
    expect(a[0]).not.toBe(b[0]);
    // ...while an unordered bench still treats them as one craft.
    const unordered = { ...ALCHEMY, ordered: false };
    const one = noveltyKeys(unordered, { step1: at('raw_meat'), step2: at('wild_onion') });
    const other = noveltyKeys(unordered, { step1: at('wild_onion'), step2: at('raw_meat') });
    expect(one[0]).toBe(other[0]);
  });
});

describe('using what came out', () => {
  it('drinks an elixir and wears what it grants', () => {
    const g = fresh();
    shelf(g);
    brew(g, lay('spring_water', 'mendroot', 'gloomcap'));
    expect(use(g, 0).ok).toBe(true);
    expect(hasStatus(g, 'concealed')).toBe(true);
    expect(alch(g).flasks).toHaveLength(0);
  });

  it('will not throw a flask with nothing to throw it at', () => {
    const g = fresh();
    shelf(g);
    brew(g, lay('grain_spirit', 'quicksilver', 'emberbloom', 'brimstone'));
    const check = canUse(g, 0);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(TEXT.reason_no_target);
  });

  it('puts every flask on one clock, so a satchel is not an action bar', () => {
    const g = fresh();
    shelf(g);
    brew(g, lay('spring_water', 'mendroot'));
    brew(g, lay('spring_water', 'mendroot'));
    use(g, 0);
    expect(canUse(g, 0).ok).toBe(false);
  });

  it('works an oil into the blade, and spends it a blow at a time', () => {
    const g = fresh();
    shelf(g);
    setWeapon(g, 99);
    brew(g, lay('pressed_oil', 'quicksilver', 'emberbloom'));
    const spec = resolveBrew(alch(g).flasks[0]);
    expect(use(g, 0).ok).toBe(true);
    expect(coatingOf(g)).not.toBeNull();
    expect(coatingOf(g)!.blowsLeft).toBe(spec.blows);

    const bite = spend(g)!;
    expect(bite.typed.some((t) => t.type === 'heat')).toBe(true);
    expect(coatingOf(g)!.blowsLeft).toBe(spec.blows! - 1);

    while (coatingOf(g)) spend(g);
    expect(spend(g)).toBeNull();
  });

  it('will not coat a hand with nothing in it', () => {
    const g = fresh();
    shelf(g);
    setWeapon(g, null);
    brew(g, lay('pressed_oil', 'quicksilver', 'emberbloom'));
    const check = canUse(g, 0);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(TEXT.reason_no_weapon);
  });

  it('leaves the oil on the blade it was worked into, not on the next one', () => {
    const g = fresh();
    shelf(g);
    setWeapon(g, 99);
    brew(g, lay('pressed_oil', 'quicksilver', 'emberbloom'));
    use(g, 0);
    setWeapon(g, 100);
    expect(activeCoating(alch(g), weaponUid(g))).toBeNull();
    expect(spend(g)).toBeNull();
    setWeapon(g, 99);
    expect(activeCoating(alch(g), weaponUid(g))).not.toBeNull();
  });

  it('a half-spent coating survives a save', () => {
    const g = fresh();
    shelf(g);
    setWeapon(g, 99);
    brew(g, lay('pressed_oil', 'quicksilver', 'emberbloom'));
    use(g, 0);
    spend(g);
    const before = coatingOf(g)!;
    expect(before.blowsLeft).toBeGreaterThan(0);

    const other = fresh();
    expect(other.load(g.save(0)).ok).toBe(true);
    const after = alch(other).coating!;
    expect(after).not.toBeNull();
    expect(after.blowsLeft).toBe(before.blowsLeft);
    expect(after.weaponUid).toBe(99);
    expect(resolveBrew(after.brew).form).toBe('oil');
  });

  it('refuses residue, and keeps it', () => {
    const g = fresh();
    shelf(g);
    brew(g, lay('emberbloom', 'quicksilver'));
    expect(use(g, 0).ok).toBe(false);
    expect(alch(g).flasks).toHaveLength(1);
  });
});

describe('a coated blade in a real fight', () => {
  it('carries its bite and its riders onto what it hits, and wears off', { timeout: 30000 }, () => {
    const g = huntingGame(7, 'woods_edge');
    shelf(g);
    brew(g, lay('pressed_oil', 'quicksilver', 'emberbloom'));
    expect(use(g, 0).ok).toBe(true);
    const blows = coatingOf(g)!.blowsLeft;
    expect(blows).toBeGreaterThan(1);

    let sawBite = false;
    let sawFire = false;
    for (let i = 0; i < 4000 && coatingOf(g); i++) {
      g.tick();
      const fight = combatOf(g).fight;
      if (!fight) {
        keepHunting(g, 'woods_edge');
        continue;
      }
      const front = fight.enemies[0];
      if (front && heldOf(slice<StatusesState>(g, 'statuses'), front.entity).some((s) => s.id === 'on_fire')) sawFire = true;
      for (const entry of feedOf(g)) {
        const hit = entry.damage?.slices?.find((s) => s.source === 'Ember Oil');
        if (hit && hit.type === 'heat' && hit.dealt > 0) sawBite = true;
      }
    }
    expect(sawFire, 'a coated blow should set what it hits on fire').toBe(true);
    expect(sawBite, 'the oil should land as its own heat slice of the swing').toBe(true);
    expect(coatingOf(g)).toBeNull();
  });

  it('does nothing at all when the blade is bare', { timeout: 30000 }, () => {
    const g = huntingGame(7, 'woods_edge');
    shelf(g);
    brew(g, lay('pressed_oil', 'quicksilver', 'emberbloom'));
    use(g, 0);
    // Same fight, but the oiled blade is not the one in hand.
    const other = giveItem(g, 'rusty_sword');
    expect(equip(g, other.uid).ok).toBe(true);
    const before = coatingOf(g)!.blowsLeft;
    for (let i = 0; i < 600; i++) {
      g.tick();
      keepHunting(g, 'woods_edge');
    }
    expect(coatingOf(g)!.blowsLeft).toBe(before);
  });
});

describe('determinism', () => {
  it('two alchemists with the same sequence get the same flask', () => {
    const a = seq('grain_spirit', 'nightcap', 'quicksilver', 'green_vitriol');
    const b = seq('grain_spirit', 'nightcap', 'quicksilver', 'green_vitriol');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('alchemy carries its own conditions', () => {
  const GRANTED = { frostmoss: 'frosted', gloomcap: 'concealed', bloodwort: 'invigorated' } as const;

  it('Frostmoss, Gloomcap and Bloodwort each grant one of their own, not a deity’s', () => {
    for (const [reagent, id] of Object.entries(GRANTED)) {
      expect(REAGENTS[reagent].essence!.grants?.map((g) => g.id), reagent).toEqual([id]);
      const def = STATUSES[id];
      expect(def, id).toBeTruthy();
      expect(def.element, id).toBeUndefined();
      expect(isHarmful(def), id).toBe(false);
    }
  });

  it('no reagent grants a condition a miracle grants — alchemy borrows no deity’s signature', () => {
    const divine = new Set(
      Object.values(MIRACLES).flatMap((m) => [...(m.spec.grants ?? []), ...(m.spec.afflicts ?? [])].map((a) => a.id)),
    );
    expect(divine.size).toBeGreaterThan(5);
    for (const [id, def] of Object.entries(REAGENTS)) {
      for (const g of def.essence?.grants ?? []) expect(divine.has(g.id), `${id} grants '${g.id}'`).toBe(false);
    }
  });

  it('the divine originals are untouched and still granted by their miracles', () => {
    const granted = Object.values(MIRACLES).flatMap((m) => (m.spec.grants ?? []).map((a) => a.id));
    for (const id of ['ximas_rime', 'veiled', 'blood_communion']) {
      expect(STATUSES[id], id).toBeTruthy();
      expect(granted, id).toContain(id);
    }
  });

  it('is sized for a short flask: each runs the Elixir’s own clock and a modest intensity', () => {
    for (const [reagent, id] of Object.entries(GRANTED)) {
      const spec = seq('spring_water', reagent);
      expect(spec.form, reagent).toBe('elixir');
      const grant = spec.grants.find((g) => g.id === id)!;
      expect(grant, reagent).toBeTruthy();
      expect(grant.duration as number, reagent).toBeLessThanOrEqual(BREW_MAX_DURATION);
      expect(grant.intensity!, reagent).toBeGreaterThan(0.3);
      expect(grant.intensity!, reagent).toBeLessThan(2);
      expect(STATUSES[id].duration, id).toBeLessThanOrEqual(BREW_MAX_DURATION);
    }
  });

  it('drinking each Elixir wears its condition', () => {
    for (const [reagent, id] of Object.entries(GRANTED)) {
      const g = fresh();
      shelf(g);
      brew(g, lay('spring_water', reagent));
      expect(use(g, 0).ok).toBe(true);
      expect(hasStatus(g, id), id).toBe(true);
    }
  });
});

describe('cures that work', () => {
  /** Brew and use a Mendroot Salve (settled oil) on a player carrying `held`. */
  function applySalve(held: StatusApplication[]) {
    const g = fresh();
    shelf(g);
    for (const app of held) give(g, app);
    brew(g, lay('pressed_oil', 'mendroot'));
    expect(alch(g).flasks).toHaveLength(1);
    expect(resolveBrew(alch(g).flasks[0]).form).toBe('salve');
    expect(use(g, 0).ok).toBe(true);
    return g;
  }

  it('the tags Mendroot emits are the ones the conditions listen for', () => {
    expect(REAGENTS.mendroot.essence!.cures).toEqual(['poison', 'bleed']);
    const listens = (id: string, tag: string) => (STATUSES[id].removal ?? []).some((r) => r.on === 'cure' && r.tag === tag);
    expect(listens('poison', 'poison')).toBe(true);
    expect(listens('rotting', 'poison')).toBe(true);
    expect(listens('bleeding', 'bleed')).toBe(true);
    expect(listens('lacerated', 'bleed')).toBe(false);
  });

  it('a brewed salve removes a held poison', () => {
    const g = applySalve([{ id: 'poison', intensity: 2 }]);
    expect(hasStatus(g, 'poison')).toBe(false);
  });

  it('...and a held bleed', () => {
    const g = applySalve([{ id: 'bleeding', intensity: 1 }]);
    expect(hasStatus(g, 'bleeding')).toBe(false);
  });

  it('a rot eases to poison: one rung a flask, and the next flask ends it', () => {
    const rot = applySalve([{ id: 'rotting', intensity: 1 }]);
    expect(hasStatus(rot, 'rotting')).toBe(false);
    expect(hasStatus(rot, 'poison')).toBe(true);

    const again = fresh();
    give(again, { id: 'rotting', intensity: 1 });
    ask(again, fireStatusEvent, { entity: PLAYER, on: 'cure', detail: { tag: 'poison' } });
    expect(hasStatus(again, 'poison')).toBe(true);
    ask(again, fireStatusEvent, { entity: PLAYER, on: 'cure', detail: { tag: 'poison' } });
    expect(hasStatus(again, 'poison')).toBe(false);
  });

  it('a laceration eases to a bleed in ONE flask, not two: the next flask closes it', () => {
    const cut = applySalve([{ id: 'lacerated', intensity: 1 }]);
    expect(hasStatus(cut, 'lacerated')).toBe(false);
    expect(hasStatus(cut, 'bleeding')).toBe(true);

    clearClock(cut);
    brew(cut, lay('pressed_oil', 'mendroot'));
    expect(use(cut, 0).ok).toBe(true);
    expect(hasStatus(cut, 'bleeding')).toBe(false);
  });

  it('the cure alone does nothing to a laceration (it answers treatment)', () => {
    const cut = fresh();
    give(cut, { id: 'lacerated', intensity: 1 });
    ask(cut, fireStatusEvent, { entity: PLAYER, on: 'cure', detail: { tag: 'bleed' } });
    expect(hasStatus(cut, 'lacerated')).toBe(true);
  });

  it('leaves what it does not name alone', () => {
    const g = applySalve([{ id: 'on_fire', intensity: 1 }, { id: 'poison', intensity: 1 }]);
    expect(hasStatus(g, 'poison')).toBe(false);
    expect(hasStatus(g, 'on_fire')).toBe(true);
  });
});

describe('only the Salve treats a wound', () => {
  /** Brew and use this sequence on a player at 1 HP who is bleeding. */
  function bleedingWith(...ids: string[]) {
    const g = fresh();
    shelf(g);
    setPool(g, 'hp', 1);
    give(g, { id: 'bleeding', intensity: 1 });
    brew(g, lay(...ids));
    expect(use(g, 0).ok).toBe(true);
    return g;
  }

  it('a Draught restores health but closes nothing', () => {
    expect(seq('spring_water', 'quicksilver', 'mendroot').form).toBe('draught');
    const g = bleedingWith('spring_water', 'quicksilver', 'mendroot');
    expect(hpOf(g)).toBeGreaterThan(1);
    expect(hasStatus(g, 'bleeding')).toBe(true);
  });

  it('a Salve restores health and closes the wound', () => {
    const g = bleedingWith('pressed_oil', 'mendroot');
    expect(hpOf(g)).toBeGreaterThan(1);
    expect(hasStatus(g, 'bleeding')).toBe(false);
  });

  it('a Draught leaves a laceration as it found it', () => {
    const g = fresh();
    shelf(g);
    setPool(g, 'hp', 1);
    give(g, { id: 'lacerated', intensity: 1 });
    brew(g, lay('spring_water', 'quicksilver', 'mendroot'));
    use(g, 0);
    expect(hasStatus(g, 'lacerated')).toBe(true);
    expect(hasStatus(g, 'bleeding')).toBe(false);
  });
});

describe('thrown flasks (step 3 port: the path through combat)', () => {
  it('a Flask hits the front foe for damage and sets it on fire, then the clock runs', { timeout: 30000 }, () => {
    const g = huntingGame(7, 'woods_edge');
    shelf(g);
    brew(g, lay('grain_spirit', 'quicksilver', 'emberbloom', 'brimstone'));
    let tries = 0;
    while (!combatOf(g).fight && tries++ < 2000) g.tick();
    const front = combatOf(g).fight!.enemies[0]!;
    const hpBefore = front.hp;
    expect(use(g, 0).ok).toBe(true);
    expect(feedOf(g).some((f) => f.text.startsWith("💥 You throw Smoulderer's Flask"))).toBe(true);
    const after = combatOf(g).fight?.enemies.find((e) => e?.entity === front.entity);
    if (after) {
      expect(after.hp).toBeLessThan(hpBefore);
      expect(heldOf(slice<StatusesState>(g, 'statuses'), front.entity).some((s) => s.id === 'on_fire')).toBe(true);
    } else {
      expect(feedOf(g).some((f) => f.text.includes("Smoulderer's Flask hits"))).toBe(true);
    }
    expect(alch(g).flaskReady).toBe(g.tickCount + 60);
    expect(g.staleStats()).toEqual([]);
  });
});
