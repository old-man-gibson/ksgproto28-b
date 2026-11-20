/**
 * Port of the runecarving cases of the old tests: `tests/disciplines.test.ts`
 * (the Rune Table cases), `tests/runeorder.test.ts`, the socketing cases of
 * `tests/runes.test.ts`, "selling and dumping runes" of
 * `tests/inventory-actions.test.ts`, and "runecarving content" of
 * `tests/content.test.ts`. The cases keep their old names.
 *
 * Call shape changes:
 * - `new Game(createInitialState(seed))` is `makeGame({ seed })`; skills,
 *   stock, the carved pile and gear are written through `patch`.
 * - `carveRune(state, bus, placement)` is the command `runecarving/carve`;
 *   what came out is read from the carved pile and the log. `previewCarve`,
 *   `failureChance` and `checkCraft` take the bench reads (`benchReadsOf`)
 *   or the level instead of the state.
 * - `socketRune`, `unsocketRune`, `sellRune`, `discardRune`,
 *   `sellRunesBatch`, `discardRunesBatch` are commands; a refusal is a skip
 *   reason instead of `false` or 0.
 * - A rune's `effects` is a list with a `context` field: `effects.weapon` is
 *   `effectIn(rune, 'weapon')`; "no effects" is an empty list.
 * - `weaponTechniqueMods(state, id)` is `runeModsOf(ctx, id)` of `martial`;
 *   `techniqueExit`, `techniqueDisplayName`, `resolvedMove` and `forkOptions`
 *   take the technique, its ledger entry and those mods.
 *
 * Not ported:
 * - The slot roll and `createItem` (ported by `items`, `tests/items.test.ts`).
 * - The save migration v7 to v8: the save here starts at version 1.
 * - The damage stat tooltip lines (`statTipLines`): UI step, `it.todo` below.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { checkCraft, nextSlot, noveltyKeys, openSlots, type Placement } from '../src/systems/benches';
import type { GoldState } from '../src/systems/gold';
import {
  ITEMS,
  RUNES,
  resolveRune,
  runeRefKey,
  runeRiders,
  sellItems,
  stackKey,
  groupItems,
  type CarvedRune,
  type ItemInstance,
  type ItemsState,
  type RuneContext,
  type RuneDef,
  type RuneRef,
} from '../src/systems/items';
import type { LogState } from '../src/systems/log';
import { exitOf, displayName, forkOptions, moveOf, runeModsOf, TECHNIQUES, type MartialState } from '../src/systems/martial';
import { MATERIALS, QUALITY_ORDER, type MaterialsState, type QualityTier } from '../src/systems/materials';
import {
  adornmentEffectAt,
  benchReadsOf,
  carvedKey,
  carveRune,
  clearCarvedCache,
  describeRuneEffect,
  discardRune,
  discardRunesBatch,
  failureChance,
  NAMED_RUNES,
  namedRuneFor,
  patternEffectAt,
  previewCarve,
  RUNE_ADORNMENTS,
  RUNE_PATTERNS,
  RUNECARVING,
  runeSellPrice,
  sellRune,
  sellRunesBatch,
  socketRune,
  unsocketRune,
  weaponRuneBonuses,
  type RunecarvingState,
  type RunecarvingView,
} from '../src/systems/runecarving';
import { statOf } from '../src/systems/stats';
import { feedOf, hardenFoes, learn, stage } from './combatHelpers';
import { equip, makeGame, patch, reads, run, slice } from './helpers';

const RC = RUNECARVING;
const at = (id: string, quality: QualityTier) => ({ id, quality });
const slabOf = (quality: QualityTier) => at('runestone_blank', quality);

/** A minimal legal bench: a slab and one cut. */
const bench = (stone: QualityTier, pattern = 'pattern_might', extra: Placement = {}): Placement => ({
  slab: slabOf(stone),
  rune1: at(pattern, 'c'),
  ...extra,
});

const effectIn = (rune: RuneDef, ctx: RuneContext) => rune.effects.find((e) => e.context === ctx);

function setLevel(g: Kernel, level: number): void {
  patch(g, (s) => {
    s.skills.skills.runecarving = { level, xp: 0 };
  });
}

function grantGraded(g: Kernel, id: string, quality: QualityTier, qty: number): void {
  patch(g, (s) => {
    const stock = (s.materials as MaterialsState).stock;
    stock[id] = { ...(stock[id] ?? {}), [quality]: (stock[id]?.[quality] ?? 0) + qty };
  });
}

const stockOf = (g: Kernel, id: string, quality: QualityTier): number =>
  slice<MaterialsState>(g, 'materials').stock[id]?.[quality] ?? 0;
const carvedOf = (g: Kernel): CarvedRune[] => slice<RunecarvingState>(g, 'runecarving').carved;
const pileOf = (g: Kernel): Record<string, number> => slice<ItemsState>(g, 'items').runes;
const goldOf = (g: Kernel): number => slice<GoldState>(g, 'gold').gold;
const logLines = (g: Kernel): string[] => slice<LogState>(g, 'log').log.map((l) => l.msg);
const benchReads = (g: Kernel) => benchReadsOf(reads(g));
const level = (g: Kernel): number => benchReads(g).level;
const preview = (g: Kernel, p: Placement) => previewCarve(benchReads(g), p);

/** Carve once; the carving made, `failed` on a split, null when refused. The old `carveRune` result. */
function carve(g: Kernel, p: Placement): { carved?: CarvedRune; failed?: boolean } | null {
  const before = carvedOf(g).length;
  const result = g.dispatch(carveRune({ placement: p }));
  if (!result.ok) return null;
  const after = carvedOf(g);
  return after.length > before ? { carved: after[after.length - 1] } : { failed: true };
}

const fresh = (seed = 1): Kernel => makeGame({ seed });

/** Stock a bench, and make the carver good enough that the slab does not split. */
function supply(g: Kernel, stone: QualityTier = 'c', adornments: [string, QualityTier][] = []): void {
  grantGraded(g, 'runestone_blank', stone, 5);
  for (const [id, q] of adornments) grantGraded(g, id, q, 5);
  setLevel(g, 30);
}

/** A carver good enough that the slab never splits. */
function carver(seed = 1): Kernel {
  const g = fresh(seed);
  setLevel(g, 30);
  return g;
}

function swordWith(runes: RuneRef[], uid = 700): ItemInstance {
  return { uid, defId: 'iron_sword', slots: runes.length, runes };
}

function wieldingIn(g: Kernel, item: ItemInstance): Kernel {
  patch(g, (s) => {
    s.items.equipment.weapon = item;
  });
  return g;
}

// ---------- old tests/disciplines.test.ts ----------

describe('slots widen with the skill', () => {
  it('opens one cut to begin with, and more as the carver steadies', () => {
    const g = fresh();
    const ids = () => openSlots(RC, level(g)).map((s) => s.id);
    expect(ids()).toContain('rune1');
    expect(ids()).not.toContain('rune2');
    setLevel(g, 10);
    expect(ids()).toContain('rune2');
    setLevel(g, 25);
    expect(ids()).toContain('rune3');
  });

  it('the stations around the slab are open from the start', () => {
    const g = fresh();
    const ids = openSlots(RC, level(g)).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['slab', 'inlay', 'color', 'gem1', 'gem2', 'tool']));
  });

  it('names the next slot so the bench can tease it', () => {
    const g = fresh();
    expect(nextSlot(RC, level(g))).toMatchObject({ level: 10 });
    setLevel(g, 30);
    expect(nextSlot(RC, level(g))).toBeUndefined();
  });

  it('refuses to work a slot that is not open yet', () => {
    const g = fresh();
    grantGraded(g, 'runestone_blank', 'c', 1);
    // rune3 needs Runecarving 25.
    const placement: Placement = { slab: at('runestone_blank', 'c'), rune3: at('pattern_might', 'c') };
    expect(checkCraft(benchReads(g), RC, placement).ok).toBe(false);
  });
});

describe('the bench validates what is laid on it', () => {
  it('rejects an empty slab, the wrong material, and stock you do not have', () => {
    const g = fresh();
    expect(checkCraft(benchReads(g), RC, {}).reason).toMatch(/Rune Slab is empty/);
    supply(g);
    // Gold leaf is an inlay, not a slab.
    grantGraded(g, 'gold_leaf', 'c', 1);
    expect(checkCraft(benchReads(g), RC, { slab: at('gold_leaf', 'c') }).reason).toMatch(/does not belong/);
    // A grade the player holds none of.
    expect(checkCraft(benchReads(g), RC, { slab: at('runestone_blank', 's') }).reason).toMatch(/no /i);
  });

  it('accepts a slab and one cut — every station around it is optional', () => {
    const g = fresh();
    supply(g);
    expect(checkCraft(benchReads(g), RC, bench('c')).ok).toBe(true);
    expect(checkCraft(benchReads(g), RC, { slab: at('runestone_blank', 'c') }).reason).toMatch(/First Rune is empty/);
  });

  it('needs at least one cut, however well stocked the bench is', () => {
    const g = fresh();
    supply(g, 'a', [['gold_leaf', 'a']]);
    const noCut: Placement = { slab: at('runestone_blank', 'a'), inlay: at('gold_leaf', 'a') };
    expect(preview(g, noCut).reason).toMatch(/No rune chosen/);
  });

  it('a plain slab cannot hold the same cut twice', () => {
    const g = fresh();
    supply(g);
    const twice = bench('c', 'pattern_might', { rune2: at('pattern_might', 'c') });
    expect(preview(g, twice).reason).toMatch(/Fine slab or better/);
  });

  it('a fine slab can, and a superb one takes three', () => {
    const g = fresh();
    supply(g, 'b');
    grantGraded(g, 'runestone_blank', 'a', 2);
    const twice = (q: QualityTier) => bench(q, 'pattern_might', { rune2: at('pattern_might', 'c') });
    expect(preview(g, twice('b')).ok).toBe(true);
    const thrice = { ...bench('b', 'pattern_might'), rune2: at('pattern_might', 'c'), rune3: at('pattern_might', 'c') };
    expect(preview(g, thrice).reason).toMatch(/Superb slab or better/);
    expect(preview(g, { ...thrice, slab: at('runestone_blank', 'a') }).ok).toBe(true);
  });
});

describe('carving', () => {
  it('produces a rune whose strength tracks the slab', () => {
    const poor = fresh();
    const fine = fresh();
    supply(poor, 'e');
    supply(fine, 'a');
    const a = carve(poor, bench('e'))!.carved!;
    const b = carve(fine, bench('a'))!.carved!;
    const dmgOf = (c: CarvedRune) => effectIn(resolveRune(c), 'weapon')!.mods!.find((m) => m.stat === 'damage')!.value;
    expect(dmgOf(b)).toBeGreaterThan(dmgOf(a));
  });

  it('spends exactly what was on the bench', () => {
    const g = fresh();
    supply(g, 'c', [['gold_leaf', 'c']]);
    const before = stockOf(g, 'runestone_blank', 'c');
    carve(g, bench('c', 'pattern_might', { inlay: at('gold_leaf', 'c') }));
    expect(stockOf(g, 'runestone_blank', 'c')).toBe(before - 1);
    expect(stockOf(g, 'gold_leaf', 'c')).toBe(4);
    expect(carvedOf(g)).toHaveLength(1);
  });

  it('a tool is worked WITH, not spent', () => {
    const g = fresh();
    supply(g);
    grantGraded(g, 'steel_burin', 'b', 1);
    carve(g, bench('c', 'pattern_might', { tool: at('steel_burin', 'b') }));
    expect(stockOf(g, 'steel_burin', 'b')).toBe(1);
  });

  it('refuses a pattern the carver has not grown into, and spends nothing', () => {
    const g = fresh();
    grantGraded(g, 'runestone_blank', 'c', 5); // deliberately unskilled
    const before = stockOf(g, 'runestone_blank', 'c');
    // pattern_edge needs Runecarving 12.
    expect(carve(g, bench('c', 'pattern_edge'))).toBeNull();
    expect(stockOf(g, 'runestone_blank', 'c')).toBe(before);
    expect(carvedOf(g)).toHaveLength(0);
    expect(logLines(g)).toContain('🔒 Rune of the Edge needs Runecarving 12');
  });

  it('adornments add their own effects on top of the pattern', () => {
    const g = fresh();
    supply(g, 'c', [['warm_slime_gel', 'c']]);
    const plain = preview(g, bench('c'));
    const inlaid = preview(g, bench('c', 'pattern_might', { inlay: at('warm_slime_gel', 'c') }));
    expect(runeRiders(effectIn(resolveRune(plain.preview!), 'weapon')?.bonusDamage)).toEqual([]);
    expect(runeRiders(effectIn(resolveRune(inlaid.preview!), 'weapon')?.bonusDamage).map((r) => r.type)).toEqual(['heat']);
  });

  it('a second cut adds a new capability, but at a diminished share', () => {
    const g = fresh();
    supply(g, 'c');
    const armorOf = (c: CarvedRune) => effectIn(resolveRune(c), 'armor')?.mods?.find((m) => m.stat === 'armor')?.value ?? 0;
    const alone = preview(g, bench('c', 'pattern_warding')).preview!;
    const second = preview(g, bench('c', 'pattern_might', { rune2: at('pattern_warding', 'c') })).preview!;
    expect(armorOf(second)).toBeGreaterThan(0);
    expect(armorOf(second)).toBeLessThan(armorOf(alone));
    expect(effectIn(resolveRune(second), 'weapon')?.mods?.some((m) => m.stat === 'damage')).toBe(true);
  });
});

describe('repeating a cut concentrates the rune', () => {
  it('two of one figure beat two different ones, and beat a single', () => {
    const g = fresh();
    supply(g, 'b');
    const dmg = (p: Placement) => {
      const c = preview(g, p).preview!;
      return effectIn(resolveRune(c), 'weapon')?.mods?.find((m) => m.stat === 'damage')?.value ?? 0;
    };
    const single = dmg(bench('b'));
    const doubled = dmg(bench('b', 'pattern_might', { rune2: at('pattern_might', 'c') }));
    const broad = dmg(bench('b', 'pattern_might', { rune2: at('pattern_warding', 'c') }));
    expect(doubled).toBeGreaterThan(broad);
    expect(doubled).toBeGreaterThan(single * 2);
  });

  it('a concentrated rune says so in its name', () => {
    const g = fresh();
    supply(g, 'b');
    const c = preview(g, bench('b', 'pattern_might', { rune2: at('pattern_might', 'c') })).preview!;
    expect(resolveRune(c).name).toContain('×2');
  });

  it('a doubled cut is not the same work as a single one', () => {
    const one: CarvedRune = { patterns: ['pattern_warding'], stone: at('runestone_blank', 'b'), adornments: [at('warm_slime_gel', 'c')] };
    const two: CarvedRune = { ...one, patterns: ['pattern_warding', 'pattern_warding'] };
    expect(namedRuneFor(one)?.id).toBe('hearthward');
    expect(namedRuneFor(two)).toBeUndefined();
    expect(carvedKey(one)).not.toBe(carvedKey(two));
  });
});

describe('the tool and the risk of splitting', () => {
  it('bare-handed work on a fresh carver is a real gamble', () => {
    const g = fresh();
    expect(failureChance(level(g), bench('c'))).toBeGreaterThan(0.25);
  });

  it('a good tool takes most of the risk out of it', () => {
    const g = fresh();
    const bare = failureChance(level(g), bench('c'));
    const armed = failureChance(level(g), bench('c', 'pattern_might', { tool: at('steel_burin', 'a') }));
    expect(armed).toBeLessThan(bare);
  });

  it('an F-grade tool counts as no tool, never worse', () => {
    const g = fresh();
    const bare = failureChance(level(g), bench('c'));
    expect(failureChance(level(g), bench('c', 'pattern_might', { tool: at('steel_burin', 'f') }))).toBe(bare);
    expect(failureChance(level(g), bench('c', 'pattern_might', { tool: at('steel_burin', 'e') }))).toBeLessThan(bare);
  });

  it('every extra cut is another thing that can go wrong', () => {
    const g = fresh();
    setLevel(g, 25);
    const one = failureChance(level(g), bench('c'));
    const three = failureChance(level(g), { ...bench('c'), rune2: at('pattern_warding', 'c'), rune3: at('pattern_swiftness', 'c') });
    expect(three).toBeGreaterThan(one);
  });

  it('mastery and a fine tool can finish the job outright', () => {
    const g = fresh();
    setLevel(g, 30);
    expect(failureChance(level(g), bench('c', 'pattern_might', { tool: at('steel_burin', 's') }))).toBe(0);
  });

  it('a split slab is still a spent slab', () => {
    const g = fresh(3);
    grantGraded(g, 'runestone_blank', 'c', 20);
    setLevel(g, 1);
    let failures = 0;
    for (let i = 0; i < 20; i++) {
      const before = stockOf(g, 'runestone_blank', 'c');
      const result = carve(g, bench('c'));
      if (result?.failed) failures++;
      expect(stockOf(g, 'runestone_blank', 'c')).toBe(before - 1);
    }
    expect(failures).toBeGreaterThan(0);
    expect(logLines(g)).toContain('💥 Slab split. The slab and materials are used up.');
  });
});

describe('a carving is its own recipe', () => {
  it('encodes the whole combination, so it can be read back', () => {
    const rune: CarvedRune = {
      patterns: ['pattern_edge'],
      stone: at('runestone_blank', 'a'),
      adornments: [at('gold_leaf', 'b'), at('charged_slime_gel', 'c')],
    };
    const key = carvedKey(rune);
    expect(key).toContain('pattern_edge');
    expect(key).toContain('runestone_blank.a');
    expect(key).toContain('gold_leaf.b');
    const shuffled: CarvedRune = { ...rune, adornments: [...rune.adornments].reverse() };
    expect(carvedKey(shuffled)).toBe(key);
  });

  it('the same combination always composes to the same rune', () => {
    const rune: CarvedRune = { patterns: ['pattern_might'], stone: at('runestone_blank', 'b'), adornments: [at('gold_leaf', 'c')] };
    const copy: CarvedRune = JSON.parse(JSON.stringify(rune));
    expect(resolveRune(copy)).toEqual(resolveRune(rune));
  });

  it('an exact recipe is a named work, and a near miss is not', () => {
    const stormbrand: CarvedRune = {
      patterns: ['pattern_edge'],
      stone: at('runestone_blank', 'a'),
      adornments: [at('charged_slime_gel', 'b'), at('raw_sapphire', 'b')],
    };
    expect(namedRuneFor(stormbrand)?.id).toBe('stormbrand');
    expect(resolveRune(stormbrand).name).toBe('Stormbrand');
    expect(namedRuneFor({ ...stormbrand, stone: at('runestone_blank', 'e') })).toBeUndefined();
    expect(namedRuneFor({ ...stormbrand, adornments: [...stormbrand.adornments, at('cut_garnet', 'c')] })).toBeUndefined();
    expect(namedRuneFor({ ...stormbrand, patterns: ['pattern_might'] })).toBeUndefined();
  });

  it('a named work grants more than its parts alone', () => {
    const named: CarvedRune = {
      patterns: ['pattern_edge'],
      stone: at('runestone_blank', 'a'),
      adornments: [at('charged_slime_gel', 'b'), at('raw_sapphire', 'b')],
    };
    const unnamed: CarvedRune = { ...named, patterns: ['pattern_might'] };
    const critOf = (c: CarvedRune) => effectIn(resolveRune(c), 'weapon')?.mods?.find((m) => m.stat === 'critDamage')?.value ?? 0;
    expect(critOf(named)).toBeGreaterThan(critOf(unnamed));
  });
});

describe('carvings behave like any other rune', () => {
  it('sockets, contributes its modifiers, and comes back out', () => {
    const g = fresh();
    supply(g, 'a');
    carve(g, bench('a'));

    // The rusty sword of a new character, given one slot.
    const sword = slice<ItemsState>(g, 'items').inventory[0];
    patch(g, (s) => {
      s.items.inventory[0].slots = 1;
    });
    expect(g.dispatch(socketRune({ uid: sword.uid, ref: 'carved:0' })).ok).toBe(true);
    expect(carvedOf(g)).toHaveLength(0);
    const socketed = slice<ItemsState>(g, 'items').inventory[0];
    expect(socketed.runes).toHaveLength(1);

    const bare = statOf(reads(g), 'damage');
    patch(g, (s) => {
      s.items.inventory[0].runes = [];
    });
    const without = statOf(reads(g), 'damage');
    expect(bare).toBe(without); // in the pack it gives nothing
    patch(g, (s) => {
      s.items.inventory[0].runes = socketed.runes;
    });
    expect(equip(g, sword.uid).ok).toBe(true);
    // The rune's damage is in the block, sourced by its own name.
    const named = resolveRune(socketed.runes![0]).name;
    expect(named).toBe('Superb Rune of Might');
    const labels = g.modifiers().map((m) => (m as { source?: string }).source ?? '');
    expect(labels.some((l) => l.startsWith(named))).toBe(true);
    expect(g.staleStats()).toEqual([]);

    expect(g.dispatch(unsocketRune({ uid: sword.uid, index: 0 })).ok).toBe(true);
    expect(carvedOf(g)).toHaveLength(1); // one of a kind: it goes back to the pile
    expect(g.staleStats()).toEqual([]);
  });
});

describe('what a craft teaches', () => {
  it('credits the combination and every part of it separately', () => {
    const keys = noveltyKeys(RC, { slab: at('runestone_blank', 'c'), inlay: at('gold_leaf', 'c') });
    expect(keys[0]).toBe('runecarving:gold_leaf+runestone_blank');
    expect(keys).toContain('runecarving:part:gold_leaf');
    expect(keys).toContain('runecarving:part:runestone_blank');
  });
});

// ---------- old tests/runes.test.ts: socketing ----------

describe('socketing', () => {
  function gameWith(item: Partial<ItemInstance> & { defId: string }): Kernel {
    const g = fresh(92);
    patch(g, (s) => {
      s.items.inventory.push({ uid: 500, slots: 2, runes: [], ...item });
    });
    return g;
  }
  const setPile = (g: Kernel, pile: Record<string, number>) =>
    patch(g, (s) => {
      s.items.runes = pile;
    });

  it('sockets owned runes into free slots and refuses beyond capacity', () => {
    const g = gameWith({ defId: 'iron_sword' });
    setPile(g, { minor_rune_might: 2 });
    expect(g.dispatch(socketRune({ uid: 500, ref: 'minor_rune_might' })).ok).toBe(true);
    expect(g.dispatch(socketRune({ uid: 500, ref: 'minor_rune_might' })).ok).toBe(true);
    expect(g.dispatch(socketRune({ uid: 500, ref: 'minor_rune_might' })).ok).toBe(false); // slots full
    expect(pileOf(g).minor_rune_might).toBeUndefined(); // pool exhausted
    expect(logLines(g)).toContain('🔺 Socketed Minor Rune of Might into ⚔️ Iron Sword.');
  });

  it('refuses unowned runes; unsocketing returns the rune to the pool', () => {
    const g = gameWith({ defId: 'iron_sword' });
    expect(g.dispatch(socketRune({ uid: 500, ref: 'minor_rune_might' })).ok).toBe(false);
    setPile(g, { rune_swiftness: 1 });
    g.dispatch(socketRune({ uid: 500, ref: 'rune_swiftness' }));
    expect(g.dispatch(unsocketRune({ uid: 500, index: 0 })).ok).toBe(true);
    expect(pileOf(g).rune_swiftness).toBe(1);
    expect(slice<ItemsState>(g, 'items').inventory.find((i) => i.uid === 500)!.runes).toEqual([]);
  });

  it('a worn piece rebuilds the block on socket and unsocket', () => {
    const g = fresh(93);
    wieldingIn(g, { uid: 600, defId: 'iron_sword', slots: 1, runes: [] });
    setPile(g, { minor_rune_might: 1 });
    const before = statOf(reads(g), 'damage');
    expect(g.dispatch(socketRune({ uid: 600, ref: 'minor_rune_might' })).ok).toBe(true);
    expect(g.staleStats()).toEqual([]);
    expect(statOf(reads(g), 'damage')).toBeCloseTo(before + 4, 5);
    expect(g.dispatch(unsocketRune({ uid: 600, index: 0 })).ok).toBe(true);
    expect(g.staleStats()).toEqual([]);
    expect(statOf(reads(g), 'damage')).toBeCloseTo(before, 5);
  });

  it('thunder runes add typed on-hit damage from the weapon', () => {
    const g = wieldingIn(fresh(94), { uid: 602, defId: 'iron_sword', slots: 2, runes: ['minor_rune_thunder', 'greater_rune_thunder'] });
    const bonuses = weaponRuneBonuses(slice<ItemsState>(g, 'items'));
    expect(bonuses.flat).toEqual([{ type: 'lightning', value: 3, source: 'Minor Rune of Thunder' }]);
    expect(bonuses.pct).toEqual([{ type: 'lightning', value: 0.12, source: 'Greater Rune of Thunder' }]);
  });

  it('selling a socketed item returns its runes to the pool', () => {
    const carving: CarvedRune = { patterns: ['pattern_might'], stone: slabOf('c'), adornments: [] };
    const g = gameWith({ defId: 'iron_sword', runes: ['minor_rune_frost', carving] });
    g.dispatch(sellItems({ uids: [500] }));
    expect(pileOf(g).minor_rune_frost).toBe(1);
    // A carving goes back to the carved pile.
    expect(carvedOf(g)).toEqual([carving]);
  });
});

// ---------- old tests/inventory-actions.test.ts: selling and dumping runes ----------

describe('selling and dumping runes', () => {
  const withCarved = (g: Kernel, carved: CarvedRune[]) =>
    patch(g, (s) => {
      s.runecarving.carved = carved;
    });
  const zeroGold = (g: Kernel) =>
    patch(g, (s) => {
      s.gold.gold = 0;
      s.log.log = [];
    });

  it('sells a catalogue rune for its worth and decrements the pile', () => {
    const g = fresh(1);
    zeroGold(g);
    patch(g, (s) => {
      s.items.runes.minor_rune_might = 2;
    });
    const price = runeSellPrice(RUNES.minor_rune_might.value, statOf(reads(g), 'goldGain'));
    expect(g.dispatch(sellRune({ ref: 'minor_rune_might' })).ok).toBe(true);
    expect(goldOf(g)).toBe(price);
    expect(pileOf(g).minor_rune_might).toBe(1);
  });

  it('discards a carved rune, removing it from the carved pile', () => {
    const g = fresh(1);
    withCarved(g, [{ patterns: ['pattern_might'], stone: { id: 'slime_gel', quality: 'c' }, adornments: [] }]);
    expect(g.dispatch(discardRune({ ref: 'carved:0' })).ok).toBe(true);
    expect(carvedOf(g)).toHaveLength(0);
  });

  it('refuses a ref that is not held', () => {
    const g = fresh(1);
    expect(g.dispatch(sellRune({ ref: 'minor_rune_might' })).ok).toBe(false);
    expect(g.dispatch(discardRune({ ref: 'carved:5' })).ok).toBe(false);
  });

  it('sells a batch: catalogue piles whole, carvings one each, one log line', () => {
    const g = fresh(1);
    zeroGold(g);
    patch(g, (s) => {
      s.items.runes.minor_rune_might = 3;
    });
    withCarved(g, [
      { patterns: ['pattern_might'], stone: { id: 'slime_gel', quality: 'c' }, adornments: [] },
      { patterns: ['pattern_warding'], stone: { id: 'slime_gel', quality: 'b' }, adornments: [] },
    ]);
    const before = goldOf(g);
    g.dispatch(sellRunesBatch({ refs: ['minor_rune_might', 'carved:0'] }));
    expect(pileOf(g).minor_rune_might).toBeUndefined(); // whole pile of 3
    expect(carvedOf(g)).toHaveLength(1); // carved:0 gone, carved:1 remains
    expect(goldOf(g)).toBeGreaterThan(before);
    const lines = logLines(g).filter((l) => l.startsWith('Sold'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(`Sold 4 runes for ${goldOf(g)} gold.`);
  });

  it('dumps carved runes by descending index without shifting mishaps', () => {
    const g = fresh(1);
    withCarved(g, [
      { patterns: ['a'], stone: { id: 'slime_gel', quality: 'c' }, adornments: [] },
      { patterns: ['b'], stone: { id: 'slime_gel', quality: 'c' }, adornments: [] },
      { patterns: ['c'], stone: { id: 'slime_gel', quality: 'c' }, adornments: [] },
    ]);
    g.dispatch(discardRunesBatch({ refs: ['carved:0', 'carved:2'] }));
    expect(carvedOf(g)).toHaveLength(1);
    expect(carvedOf(g)[0].patterns).toEqual(['b']);
  });

  it('does nothing for an empty rune batch', () => {
    const g = fresh(1);
    expect(g.dispatch(sellRunesBatch({ refs: [] })).ok).toBe(false);
    expect(g.dispatch(discardRunesBatch({ refs: ['minor_rune_might'] })).ok).toBe(false);
  });
});

// ---------- old tests/runeorder.test.ts ----------

/** Every ordering of `xs` (repeats included). */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

describe('a carving depends on what is in it, never on the order', () => {
  type Parts = Pick<CarvedRune, 'patterns' | 'adornments'>;
  const CARVINGS: [string, Parts][] = [
    ['one cut', { patterns: ['pattern_warding'], adornments: [] }],
    ['two different cuts', { patterns: ['pattern_warding', 'pattern_might'], adornments: [] }],
    ['a repeated cut beside another', { patterns: ['pattern_might', 'pattern_warding', 'pattern_might'], adornments: [] }],
    ['two repeated cuts, tied', { patterns: ['pattern_warding', 'pattern_might', 'pattern_warding', 'pattern_might'], adornments: [] }],
    ['three different cuts', { patterns: ['pattern_might', 'pattern_warding', 'pattern_edge'], adornments: [] }],
    ['two gels of different types', { patterns: ['pattern_might'], adornments: [at('warm_slime_gel', 'c'), at('chilled_slime_gel', 'c')] }],
    ['two gels of one type', { patterns: ['pattern_might'], adornments: [at('warm_slime_gel', 'c'), at('warm_slime_gel', 'b')] }],
    ['a gem', { patterns: ['pattern_edge'], adornments: [at('raw_sapphire', 'b')] }],
    [
      'gels, a gem and a pigment on two cuts',
      {
        patterns: ['pattern_warding', 'pattern_swiftness'],
        adornments: [at('warm_slime_gel', 'b'), at('chilled_slime_gel', 'c'), at('charged_slime_gel', 'a'), at('raw_sapphire', 'b')],
      },
    ],
    ['a named work (Stormbrand)', { patterns: ['pattern_edge'], adornments: [at('charged_slime_gel', 'b'), at('raw_sapphire', 'b')] }],
    ['a named work with two cuts (Twiceforged)', { patterns: ['pattern_warding', 'pattern_might'], adornments: [at('gold_leaf', 'c')] }],
    ['a named work with no minimum grade (Hearthward)', { patterns: ['pattern_warding'], adornments: [at('warm_slime_gel', 'c')] }],
    [
      'luminous gel, bone dust, ochre and verdigris on two cuts',
      {
        patterns: ['pattern_might', 'pattern_edge'],
        adornments: [at('luminous_slime_gel', 'c'), at('bone_dust', 'd'), at('ochre_pigment', 'b'), at('verdigris_pigment', 'e')],
      },
    ],
    ['an F-grade adornment among others', { patterns: ['pattern_might'], adornments: [at('warm_slime_gel', 'f'), at('chilled_slime_gel', 'c')] }],
  ];
  const STONES: QualityTier[] = [...QUALITY_ORDER];

  beforeEach(() => clearCarvedCache());
  afterEach(() => clearCarvedCache());

  it('every ordering of patterns and adornments resolves to the same rune, cold cache or not', () => {
    for (const [label, parts] of CARVINGS) {
      for (const stone of STONES) {
        const canonical: CarvedRune = { ...parts, stone: slabOf(stone), patterns: [...parts.patterns].sort() };
        clearCarvedCache();
        const expected = resolveRune(canonical);
        for (const patterns of permutations(parts.patterns)) {
          for (const adornments of permutations(parts.adornments)) {
            const spelled: CarvedRune = { patterns, stone: slabOf(stone), adornments };
            expect(carvedKey(spelled)).toBe(carvedKey(canonical));
            clearCarvedCache();
            expect(resolveRune(spelled), `${label} @ ${stone}: ${patterns} | ${adornments.map((a) => a.id)}`).toStrictEqual(expected);
          }
        }
      }
    }
  });

  it('is not trivially equal: the carvings read as something', () => {
    for (const [label, parts] of CARVINGS) {
      const rune = resolveRune({ ...parts, stone: slabOf('c') });
      expect(rune.effects.length, label).toBeGreaterThan(0);
    }
  });

  it('the most-repeated cut leads, then the lower pattern id; it names the rune', () => {
    const stone = slabOf('c');
    const mightFirst = resolveRune({ patterns: ['pattern_warding', 'pattern_might'], stone, adornments: [] });
    expect(mightFirst.name).toBe('Fair Rune of Might (+1)');
    const damage = effectIn(mightFirst, 'weapon')!.mods!.find((m) => m.stat === 'damage')!.value;
    expect(damage).toBe(4);
    const armor = effectIn(mightFirst, 'armor')!.mods!.reduce((n, m) => n + (m.stat === 'armor' ? m.value : 0), 0);
    expect(armor).toBeCloseTo(2 + 4 / 1.6, 10);
    clearCarvedCache();
    const wardingTwice = resolveRune({ patterns: ['pattern_might', 'pattern_warding', 'pattern_warding'], stone, adornments: [] });
    expect(wardingTwice.name).toBe('Fair Rune of Warding (+1)');
  });
});

describe('adornment riders are all kept', () => {
  const stone = slabOf('c');
  const warmThenChilled: CarvedRune = {
    patterns: ['pattern_might'],
    stone,
    adornments: [at('warm_slime_gel', 'c'), at('chilled_slime_gel', 'c')],
  };
  const chilledThenWarm: CarvedRune = { ...warmThenChilled, adornments: [...warmThenChilled.adornments].reverse() };

  beforeEach(() => clearCarvedCache());
  afterEach(() => clearCarvedCache());

  it('warm and chilled gel keep both heat and cold, in either order', () => {
    for (const rune of [warmThenChilled, chilledThenWarm]) {
      clearCarvedCache();
      expect(runeRiders(effectIn(resolveRune(rune), 'weapon')!.bonusDamage)).toEqual([
        { type: 'cold', value: 2 },
        { type: 'heat', value: 2 },
      ]);
    }
  });

  it('weaponRuneBonuses returns every rider, each credited to the rune', () => {
    for (const rune of [warmThenChilled, chilledThenWarm]) {
      clearCarvedCache();
      const g = wieldingIn(fresh(11), swordWith([rune]));
      const name = resolveRune(rune).name;
      expect(weaponRuneBonuses(slice<ItemsState>(g, 'items'))).toEqual({
        flat: [
          { type: 'cold', value: 2, source: name },
          { type: 'heat', value: 2, source: name },
        ],
        pct: [],
      });
    }
  });

  it('the readers show every rider', () => {
    const text = describeRuneEffect(effectIn(resolveRune(warmThenChilled), 'weapon'));
    expect(text).toContain('+2 Heat damage');
    expect(text).toContain('+2 Cold damage');
  });
  it.todo('the damage tooltip lists one "on hit:" line per rider (UI step: `statTipLines`)');

  it('riders of one type sum, flat and percent kept apart', () => {
    const twoWarm = resolveRune({ patterns: ['pattern_might'], stone, adornments: [at('warm_slime_gel', 'c'), at('warm_slime_gel', 'b')] });
    const heat = runeRiders(effectIn(twoWarm, 'weapon')!.bonusDamage);
    expect(heat).toHaveLength(1);
    expect(heat[0].value).toBeCloseTo(2 + 2 * 1.6, 10);
    const mixed = resolveRune({ patterns: ['pattern_might'], stone, adornments: [at('warm_slime_gel', 'c'), at('charged_slime_gel', 'c')] });
    expect(runeRiders(effectIn(mixed, 'weapon')!.bonusDamage)).toEqual([{ type: 'heat', value: 2 }]);
    expect(runeRiders(effectIn(mixed, 'weapon')!.bonusDamagePct)).toEqual([{ type: 'lightning', value: 0.06 }]);
  });

  it("a named work's own rider sums into the same type (Winter's Edge)", () => {
    const winters = resolveRune({ patterns: ['pattern_edge'], stone: slabOf('a'), adornments: [at('chilled_slime_gel', 'b'), at('cut_garnet', 'c')] });
    expect(winters.name).toBe("Winter's Edge");
    const cold = runeRiders(effectIn(winters, 'weapon')!.bonusDamage);
    expect(cold).toHaveLength(1);
    expect(cold[0].type).toBe('cold');
    expect(cold[0].value).toBeCloseTo(2 * 1.6 + 6, 10);
  });

  it('authored single riders still read through the same door', () => {
    expect(runeRiders(effectIn(RUNES.minor_rune_thunder, 'weapon')!.bonusDamage)).toEqual([{ type: 'lightning', value: 3 }]);
    expect(runeRiders(undefined)).toEqual([]);
  });

  it('a carving with two riders lands both on a hit in a fight', () => {
    // Not an old case: the combat engine reads every rider of a carving (old `weaponRuneBonuses`).
    const g = wieldingIn(fresh(15), swordWith([warmThenChilled]));
    stage(g, [{ monsterId: 'forest_rat', level: 3 }]);
    hardenFoes(g);
    const name = resolveRune(warmThenChilled).name;
    let found: string[] = [];
    for (let i = 0; i < 400 && found.length === 0; i++) {
      g.tick(1);
      const hit = feedOf(g).find((f) => f.damage && !f.damage.incoming && f.damage.slices.some((s) => s.source === name));
      if (hit) found = hit.damage!.slices.filter((s) => s.source === name).map((s) => s.type);
    }
    expect(found.sort()).toEqual(['cold', 'heat']);
  });
});

describe('items stack by what is carved on them', () => {
  const might: CarvedRune = { patterns: ['pattern_might'], stone: slabOf('c'), adornments: [] };
  const warding: CarvedRune = { patterns: ['pattern_warding'], stone: slabOf('c'), adornments: [] };

  it('different carvings do not share a stack key', () => {
    expect(stackKey(swordWith([might], 1))).not.toBe(stackKey(swordWith([warding], 2)));
    expect(stackKey(swordWith([might], 1))).not.toContain('[object Object]');
    expect(groupItems([swordWith([might], 1), swordWith([warding], 2)])).toHaveLength(2);
  });

  it('the same carvings in another socket order share one', () => {
    expect(stackKey(swordWith([might, warding], 1))).toBe(stackKey(swordWith([warding, might], 2)));
    const stacks = groupItems([swordWith([might, warding], 1), swordWith([warding, might], 2)]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].items).toHaveLength(2);
  });

  it('one carving spelled two ways is one carving', () => {
    const a: CarvedRune = { patterns: ['pattern_might', 'pattern_warding'], stone: slabOf('b'), adornments: [at('warm_slime_gel', 'c'), at('gold_leaf', 'c')] };
    const b: CarvedRune = { patterns: ['pattern_warding', 'pattern_might'], stone: slabOf('b'), adornments: [at('gold_leaf', 'c'), at('warm_slime_gel', 'c')] };
    expect(stackKey(swordWith([a], 1))).toBe(stackKey(swordWith([b], 2)));
  });

  it('catalogue runes still group, and never collide with a carving', () => {
    expect(stackKey(swordWith(['minor_rune_might', 'rune_swiftness'], 1))).toBe(stackKey(swordWith(['rune_swiftness', 'minor_rune_might'], 2)));
    expect(stackKey(swordWith(['minor_rune_might'], 1))).not.toBe(stackKey(swordWith([might], 2)));
    expect(runeRefKey('minor_rune_might')).toBe('minor_rune_might');
    expect(runeRefKey(might)).toBe(carvedKey(might));
  });
});

describe('the tool only lowers the chance the slab splits', () => {
  it('a fine tool never lifts the slab a grade', () => {
    const g = carver(3);
    grantGraded(g, 'runestone_blank', 'c', 30);
    grantGraded(g, 'steel_burin', 's', 1);
    for (let i = 0; i < 30; i++) {
      const result = carve(g, bench('c', 'pattern_might', { tool: at('steel_burin', 's') }));
      expect(result?.carved?.stone.quality).toBe('c');
    }
    expect(carvedOf(g)).toHaveLength(30);
  });

  it('the same bench makes the same rune every time', () => {
    const g = carver(4);
    grantGraded(g, 'runestone_blank', 'b', 2);
    grantGraded(g, 'steel_burin', 'a', 1);
    const placement = bench('b', 'pattern_might', { tool: at('steel_burin', 'a') });
    const first = carve(g, placement)!.carved!;
    const second = carve(g, placement)!.carved!;
    expect(second).toEqual(first);
  });

  it('the preview reports a split chance and no upgrade chance', () => {
    const g = carver(5);
    grantGraded(g, 'runestone_blank', 'c', 1);
    grantGraded(g, 'steel_burin', 'a', 1);
    const check = preview(g, bench('c', 'pattern_might', { tool: at('steel_burin', 'a') }));
    expect(check.ok).toBe(true);
    expect(check.failure).toBeDefined();
    expect(check).not.toHaveProperty('upgrade');
  });
});

describe('an F-grade slab or adornment is refused, and reads as nothing in old saves', () => {
  it('previewCarve refuses an F slab with a reason, and carving spends nothing', () => {
    const g = carver(6);
    grantGraded(g, 'runestone_blank', 'f', 2);
    const check = preview(g, bench('f'));
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("An F-grade slab can't be carved: it gives negative stats");
    expect(carve(g, bench('f'))).toBeNull();
    expect(stockOf(g, 'runestone_blank', 'f')).toBe(2);
    expect(carvedOf(g)).toHaveLength(0);
  });

  it('previewCarve refuses an F adornment in an inlay or a gem seat', () => {
    const g = carver(7);
    grantGraded(g, 'runestone_blank', 'c', 2);
    grantGraded(g, 'warm_slime_gel', 'f', 1);
    grantGraded(g, 'raw_sapphire', 'f', 1);
    const inlay = preview(g, bench('c', 'pattern_might', { inlay: at('warm_slime_gel', 'f') }));
    expect(inlay.ok).toBe(false);
    expect(inlay.reason).toBe("Warm Slime Gel is F-grade and can't be used: it gives negative stats");
    const gem = preview(g, bench('c', 'pattern_might', { gem1: at('raw_sapphire', 'f') }));
    expect(gem.ok).toBe(false);
    expect(gem.reason).toBe("Raw Sapphire is F-grade and can't be used: it gives negative stats");
  });

  it('the grade just above Refuse is still allowed', () => {
    const g = carver(8);
    grantGraded(g, 'runestone_blank', 'e', 1);
    grantGraded(g, 'warm_slime_gel', 'e', 1);
    expect(preview(g, bench('e', 'pattern_might', { inlay: at('warm_slime_gel', 'e') })).ok).toBe(true);
  });

  it('the bench previews of a single F contribution are empty', () => {
    expect(patternEffectAt('pattern_might', 'f', 'weapon')).toBeUndefined();
    expect(adornmentEffectAt('warm_slime_gel', 'f', 'weapon')).toBeUndefined();
  });

  function allValues(rune: RuneDef): number[] {
    const out: number[] = [];
    for (const effect of rune.effects) {
      for (const m of effect.mods ?? []) out.push(m.value);
      for (const r of runeRiders(effect.bonusDamage)) out.push(r.value);
      for (const r of runeRiders(effect.bonusDamagePct)) out.push(r.value);
    }
    return out;
  }

  it('a legacy F carving composes to nothing negative', () => {
    clearCarvedCache();
    const refuse = resolveRune({
      patterns: ['pattern_might', 'pattern_warding'],
      stone: slabOf('f'),
      adornments: [at('warm_slime_gel', 'f'), at('gold_leaf', 'f')],
    });
    expect(refuse.effects).toEqual([]);
    expect(allValues(refuse).every((v) => v >= 0)).toBe(true);
  });

  it('an F adornment on a good slab adds nothing and takes nothing', () => {
    clearCarvedCache();
    const plain = resolveRune({ patterns: ['pattern_might'], stone: slabOf('b'), adornments: [at('chilled_slime_gel', 'c')] });
    const spoiled = resolveRune({
      patterns: ['pattern_might'],
      stone: slabOf('b'),
      adornments: [at('chilled_slime_gel', 'c'), at('warm_slime_gel', 'f')],
    });
    expect(spoiled.effects).toEqual(plain.effects);
    expect(allValues(spoiled).every((v) => v >= 0)).toBe(true);
  });
});

describe("a carved rune keeps its patterns' technique surgery", () => {
  beforeEach(() => {
    RUNE_PATTERNS['test_surgery_a'] = {
      id: 'test_surgery_a',
      name: 'Test Surgery A',
      icon: 'A',
      effects: [
        {
          context: 'weapon',
          mods: [{ stat: 'damage', op: 'add', value: 1 }],
          techniqueMods: [{ technique: 'thrust', rename: 'Alpha Thrust', exitTo: 'coiled' }],
        },
      ],
    };
    RUNE_PATTERNS['test_surgery_b'] = {
      id: 'test_surgery_b',
      name: 'Test Surgery B',
      icon: 'B',
      effects: [
        {
          context: 'weapon',
          techniqueMods: [
            { technique: 'sidestep', cooldownMult: 0.5 },
            { technique: 'riposte', damageMult: 1.1, grantsFork: 'sweep' },
          ],
        },
      ],
    };
    clearCarvedCache();
  });
  afterEach(() => {
    delete RUNE_PATTERNS['test_surgery_a'];
    delete RUNE_PATTERNS['test_surgery_b'];
    clearCarvedCache();
  });

  it("merging two patterns keeps both contributors' mods, unscaled by the stone", () => {
    const both = resolveRune({ patterns: ['test_surgery_b', 'test_surgery_a'], stone: slabOf('a'), adornments: [] });
    expect(effectIn(both, 'weapon')!.techniqueMods).toEqual([
      { technique: 'thrust', rename: 'Alpha Thrust', exitTo: 'coiled' },
      { technique: 'sidestep', cooldownMult: 0.5 },
      { technique: 'riposte', damageMult: 1.1, grantsFork: 'sweep' },
    ]);
    expect(effectIn(both, 'weapon')!.mods![0].value).toBe(2.5);
  });

  it('a single pattern carries its surgery through the scaling too', () => {
    const one = resolveRune({ patterns: ['test_surgery_b'], stone: slabOf('b'), adornments: [] });
    expect(effectIn(one, 'weapon')!.techniqueMods).toHaveLength(2);
    expect(effectIn(one, 'weapon')!.techniqueMods![1].damageMult).toBe(1.1);
  });

  it('the surgery reaches the technique once the carving is socketed', () => {
    const rune: CarvedRune = { patterns: ['test_surgery_a'], stone: slabOf('c'), adornments: [] };
    const g = wieldingIn(fresh(13), swordWith([rune]));
    learn(g, 'thrust');
    const held = slice<MartialState>(g, 'martial').techniques.thrust;
    const mods = run(g, (ctx) => runeModsOf(ctx, 'thrust'));
    expect(exitOf(TECHNIQUES.thrust, held, mods)).toBe('coiled');
    expect(displayName(TECHNIQUES.thrust, held, mods)).toBe('Alpha Thrust');
  });
});

describe('socket order does not decide a technique', () => {
  beforeEach(() => {
    RUNES['test_rune_a'] = {
      id: 'test_rune_a',
      name: 'Test Rune A',
      icon: 'A',
      value: 1,
      effects: [
        { context: 'weapon', techniqueMods: [{ technique: 'thrust', rename: 'Alpha Thrust', exitTo: 'coiled', cooldownMult: 0.2, grantsFork: 'sweep' }] },
      ],
    };
    RUNES['test_rune_b'] = {
      id: 'test_rune_b',
      name: 'Test Rune B',
      icon: 'B',
      value: 1,
      effects: [
        { context: 'weapon', techniqueMods: [{ technique: 'thrust', rename: 'Beta Thrust', exitTo: 'extended', cooldownMult: 1.5, grantsFork: 'split' }] },
      ],
    };
  });
  afterEach(() => {
    delete RUNES['test_rune_a'];
    delete RUNES['test_rune_b'];
    clearCarvedCache();
  });

  function wielding(runes: RuneRef[]): { g: Kernel; held: MartialState['techniques'][string]; mods: ReturnType<typeof runeModsOf> } {
    const g = wieldingIn(fresh(14), swordWith(runes));
    learn(g, 'thrust');
    return { g, held: slice<MartialState>(g, 'martial').techniques.thrust, mods: run(g, (ctx) => runeModsOf(ctx, 'thrust')) };
  }
  const exit = (w: ReturnType<typeof wielding>) => exitOf(TECHNIQUES.thrust, w.held, w.mods);
  const name = (w: ReturnType<typeof wielding>) => displayName(TECHNIQUES.thrust, w.held, w.mods);

  it('the exit and the name are the same in both socket orders', () => {
    const ab = wielding(['test_rune_a', 'test_rune_b']);
    const ba = wielding(['test_rune_b', 'test_rune_a']);
    expect(exit(ab)).toBe(exit(ba));
    expect(name(ab)).toBe(name(ba));
    expect(exit(ab)).toBe('coiled');
    expect(name(ab)).toBe('Alpha Thrust');
  });

  it('the mods come back in one order whichever socket holds which rune', () => {
    const names = (w: ReturnType<typeof wielding>) => w.mods.map((m) => m.rename);
    expect(names(wielding(['test_rune_a', 'test_rune_b']))).toEqual(['Alpha Thrust', 'Beta Thrust']);
    expect(names(wielding(['test_rune_b', 'test_rune_a']))).toEqual(['Alpha Thrust', 'Beta Thrust']);
  });

  it('tempo and the Honed offering do not depend on it either', () => {
    const ab = wielding(['test_rune_a', 'test_rune_b']);
    const ba = wielding(['test_rune_b', 'test_rune_a']);
    expect(moveOf(TECHNIQUES.thrust, ab.held, ab.mods).cooldown).toBe(15);
    expect(moveOf(TECHNIQUES.thrust, ba.held, ba.mods)).toEqual(moveOf(TECHNIQUES.thrust, ab.held, ab.mods));
    const offered = (w: ReturnType<typeof wielding>) => forkOptions(TECHNIQUES.thrust, w.held, w.mods).map((a) => a.id);
    expect(offered(ab)).toEqual(offered(ba));
    expect(offered(ab)).toEqual(expect.arrayContaining(['sweep', 'split']));
  });

  it('carved runes and catalogue runes order the same way', () => {
    RUNE_PATTERNS['aa_test_surgery_c'] = {
      id: 'aa_test_surgery_c',
      name: 'Test Surgery C',
      icon: 'C',
      effects: [{ context: 'weapon', techniqueMods: [{ technique: 'thrust', rename: 'Gamma Thrust', exitTo: 'wide_open' }] }],
    };
    try {
      const carved: CarvedRune = { patterns: ['aa_test_surgery_c'], stone: slabOf('c'), adornments: [] };
      const one = wielding([carved, 'test_rune_a']);
      const two = wielding(['test_rune_a', carved]);
      expect(exit(one)).toBe(exit(two));
      expect(name(one)).toBe(name(two));
      expect(name(one)).toBe('Gamma Thrust');
    } finally {
      delete RUNE_PATTERNS['aa_test_surgery_c'];
      clearCarvedCache();
    }
  });
});

// ---------- old tests/content.test.ts: runecarving content ----------

describe('runecarving content', () => {
  it('every adornment is a real material, tagged as an inlay', () => {
    for (const id of Object.keys(RUNE_ADORNMENTS)) {
      const mat = MATERIALS[id];
      expect(mat, `adornment '${id}' is not a material`).toBeTruthy();
      const usable = ['inlay', 'pigment', 'gem'].some((t) => (mat!.craftTags ?? []).includes(t));
      expect(usable, `${id} sits in no runecarving station`).toBe(true);
      expect(mat!.graded, `${id} must be graded to be adorned with`).toBe(true);
    }
  });

  it('every named work names a real pattern and real adornments', () => {
    for (const named of NAMED_RUNES) {
      for (const pid of named.patterns) expect(RUNE_PATTERNS[pid], `${named.id} -> ${pid}`).toBeTruthy();
      expect(named.patterns.length, `${named.id} names no pattern`).toBeGreaterThan(0);
      for (const a of named.adornments) expect(RUNE_ADORNMENTS[a], `${named.id} adorned with unknown '${a}'`).toBeTruthy();
      expect(named.adornments.length, `${named.id} has no adornments to identify it`).toBeGreaterThan(0);
    }
  });

  it('every named work can actually be laid out on the bench', () => {
    const capacity = new Map<string, number>();
    for (const slot of RC.slots) {
      if ((slot.picks ?? 'material') !== 'material' || slot.role !== 'adornment') continue;
      for (const tag of slot.accepts) capacity.set(tag, (capacity.get(tag) ?? 0) + 1);
    }
    const fits = (ids: string[]): boolean => {
      const left = new Map(capacity);
      const options = ids.map((id) => (MATERIALS[id]?.craftTags ?? []).filter((t) => left.has(t))).sort((a, b) => a.length - b.length);
      for (const opts of options) {
        const pick = opts.find((t) => (left.get(t) ?? 0) > 0);
        if (!pick) return false;
        left.set(pick, left.get(pick)! - 1);
      }
      return true;
    };
    for (const named of NAMED_RUNES) {
      expect(fits(named.adornments), `${named.id} cannot be laid out on the bench`).toBe(true);
      expect(named.patterns.length <= RC.slots.filter((s) => s.picks === 'design').length, `${named.id} needs more cuts than the slab has`).toBe(true);
    }
  });

  it('no two named works claim the same recipe', () => {
    const seen = new Set<string>();
    for (const named of NAMED_RUNES) {
      const key = `${[...named.patterns].sort().join(',')}|${[...named.adornments].sort().join('+')}`;
      expect(seen.has(key), `${named.id} duplicates another recipe`).toBe(false);
      seen.add(key);
    }
  });
});

describe('the shutter and the view', () => {
  it('is shut on a new save, and lists the Rune Table spots', () => {
    // Not an old case: the old `unlocks.ts` shutter, read through the view.
    const g = fresh(1);
    const v = g.view().systems.runecarving as RunecarvingView;
    expect(v.unlocked).toBe(false);
    expect(v.tables).toContain('The Long Bench');
    expect(ITEMS.iron_sword.slot).toBe('weapon');
  });
});
