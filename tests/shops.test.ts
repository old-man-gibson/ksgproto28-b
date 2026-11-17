/**
 * Port of the old `tests/shops.test.ts`: buying at a counter, the stranger
 * markup, gated lines, and the no-arbitrage law. The cases keep their old
 * names.
 *
 * Call shape changes:
 * - `g.buy(npc, index, qty)` returned the count bought. Here it is the
 *   command `shops/buy { npc, index, qty }`; the count is read off the purse
 *   and the pouch, and a refusal is a skipped command.
 * - `g.talkTo(npc)` is the command `npcs/talk`.
 * - `buyPrice(state, npc, line, goldGain?)` is `buyPrice(counts, npc, line,
 *   goldGain)`, with the counters slice; `resaleCeiling(state, line,
 *   goldGain)` is `resaleCeiling(line, goldGain)`; `visibleLines(state, npc)`
 *   is `visibleLines(ctx, npc)`. Where the old call left the gold gain out,
 *   it is read from the stat block.
 * - `sellPrice(state, item, goldGain)`, `materialSellPrice(state, id,
 *   goldGain)` and `gradedUnitPrice(state, id, q, goldGain)` drop the state.
 * - `state.gold`, `state.spot`, `state.stats` and `state.attrs` are written
 *   through `patch` and the counter event.
 * - `g.sellStackable` is the command `materials/sell`.
 *
 * No case is `it.todo`.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import type { CountersState } from '../src/systems/counters';
import type { GoldState } from '../src/systems/gold';
import { ITEMS, sellPrice, type ItemsState } from '../src/systems/items';
import {
  gradedUnitPrice,
  heldOf,
  materialSellPrice,
  MATERIALS,
  sellStackable,
  stockOf,
  type MaterialsState,
  type QualityTier,
} from '../src/systems/materials';
import { NPCS, talkTo, type ShopLine } from '../src/systems/npcs';
import { askingPrice, buy, BUY_MARKUP, buyPrice, resaleCeiling, STRANGER_MARKUP, visibleLines } from '../src/systems/shops';
import { statOf } from '../src/systems/stats';
import type { WorldState } from '../src/systems/world';
import { makeGame, patch, reads, slice } from './helpers';
import { counterOf, setCounters } from './worldHelpers';

const goldOf = (g: Kernel): number => slice<GoldState>(g, 'gold').gold;
const countsOf = (g: Kernel): CountersState => slice<CountersState>(g, 'counters');
const matsOf = (g: Kernel): MaterialsState => slice<MaterialsState>(g, 'materials');
const itemsOf = (g: Kernel): ItemsState => slice<ItemsState>(g, 'items');
const goldGainOf = (g: Kernel): number => statOf(reads(g), 'goldGain');
const shelfOf = (g: Kernel, npcId: string): ShopLine[] => visibleLines(reads(g), NPCS[npcId]);
const priceOf = (g: Kernel, npcId: string, line: ShopLine): number => buyPrice(countsOf(g), npcId, line, goldGainOf(g));

function setGold(g: Kernel, gold: number): void {
  patch(g, (s) => {
    (s.gold as GoldState).gold = gold;
  });
}

/** A game standing at a vendor, with gold and (optionally) the acquaintance made. */
function atVendor(npcId: string, gold = 1000, met = false): Kernel {
  const g = makeGame({ seed: 7 });
  const npc = NPCS[npcId];
  patch(g, (s) => {
    const w = s.world as WorldState;
    w.spot = npc.spotId;
    if (!w.discovered.includes(npc.spotId)) w.discovered.push(npc.spotId);
    (s.gold as GoldState).gold = gold;
  });
  if (met) expect(g.dispatch(talkTo({ npc: npcId })).ok).toBe(true);
  return g;
}

describe('shops — the counter', () => {
  it('buying a plain material moves gold to the vendor and the ware to the pouch', () => {
    const g = atVendor('master_smith', 500, true);
    const shelf = shelfOf(g, 'master_smith');
    const i = shelf.findIndex((l) => l.id === 'iron_scrap');
    const price = priceOf(g, 'master_smith', shelf[i]);
    const before = matsOf(g).counts.iron_scrap ?? 0;

    expect(g.dispatch(buy({ npc: 'master_smith', index: i, qty: 3 })).ok).toBe(true);
    expect(goldOf(g)).toBe(500 - 3 * price);
    expect(matsOf(g).counts.iron_scrap).toBe(before + 3);
    expect(counterOf(g, 'gold:spent')).toBe(3 * price);
    expect(counterOf(g, 'shop:buys')).toBe(3);
  });

  it('a graded ware lands in stock at the grade on the shelf, not a rolled one', () => {
    const g = atVendor('row_apothecary', 1000, true);
    const shelf = shelfOf(g, 'row_apothecary');
    const i = shelf.findIndex((l) => l.id === 'healing_salve');
    expect(MATERIALS.healing_salve.graded).toBe(true);
    g.dispatch(buy({ npc: 'row_apothecary', index: i, qty: 4 }));
    expect(stockOf(matsOf(g), 'healing_salve', 'c')).toBe(4);
    expect(matsOf(g).counts.healing_salve).toBeUndefined();
  });

  it('an item is minted through the one item factory (uid + rolled slots)', () => {
    const g = atVendor('ward_outfitter', 1000, true);
    const shelf = shelfOf(g, 'ward_outfitter');
    const i = shelf.findIndex((l) => l.id === 'iron_sword');
    const n = itemsOf(g).inventory.length;
    expect(g.dispatch(buy({ npc: 'ward_outfitter', index: i })).ok).toBe(true);
    expect(itemsOf(g).inventory).toHaveLength(n + 1);
    const sword = itemsOf(g).inventory[n];
    expect(sword.defId).toBe('iron_sword');
    expect(sword.uid).toBeGreaterThan(0);
    expect(typeof sword.slots).toBe('number');
  });

  it('refuses from elsewhere, refuses when broke, and buys what the purse covers', () => {
    const g = atVendor('head_chef', 0, true);
    expect(g.dispatch(buy({ npc: 'head_chef', index: 0, qty: 1 })).ok).toBe(false);
    const line = shelfOf(g, 'head_chef')[0];
    const price = priceOf(g, 'head_chef', line);
    setGold(g, price * 2 + 1);
    const held = heldOf(matsOf(g), line.id);
    expect(g.dispatch(buy({ npc: 'head_chef', index: 0, qty: 5 })).ok).toBe(true);
    expect(heldOf(matsOf(g), line.id)).toBe(held + 2); // partial buys are deliberate
    expect(goldOf(g)).toBe(1);

    setGold(g, 1000);
    patch(g, (s) => {
      (s.world as WorldState).spot = 'ascent_foot';
    });
    const result = g.dispatch(buy({ npc: 'head_chef', index: 0, qty: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/is not here/);
    expect(goldOf(g)).toBe(1000);
  });

  it('a stranger pays more; saying hello is the discount', () => {
    const stranger = atVendor('master_smith', 1000, false);
    const known = atVendor('master_smith', 1000, true);
    const line = shelfOf(stranger, 'master_smith')[0];
    const a = priceOf(stranger, 'master_smith', line);
    const b = priceOf(known, 'master_smith', line);
    expect(a).toBeGreaterThan(b);
    expect(askingPrice(line, false)).toBe(Math.ceil(askingPrice(line, true) * STRANGER_MARKUP));
    expect(askingPrice(line, true)).toBe(Math.ceil((MATERIALS[line.id].value ?? 1) * BUY_MARKUP));
  });

  it('gated lines stay off the shelf until the counter they name is stamped', () => {
    const g = atVendor('ward_outfitter', 1000, true);
    const closed = shelfOf(g, 'ward_outfitter').map((l) => l.id);
    expect(closed).not.toContain('iron_breastplate');
    setCounters(g, { 'boss:f1_toll_hall': 1 });
    const open = shelfOf(g, 'ward_outfitter').map((l) => l.id);
    expect(open).toContain('iron_breastplate');
    // Indices shift when a line appears: buying goes by the VISIBLE index.
    const i = open.indexOf('iron_breastplate');
    expect(g.dispatch(buy({ npc: 'ward_outfitter', index: i })).ok).toBe(true);
    expect(itemsOf(g).inventory.at(-1)?.defId).toBe('iron_breastplate');
  });
});

describe('shops — the no-arbitrage law', () => {
  /** Every line every vendor sells, plus a few deliberate bargains. */
  function allLines(): { npcId: string; line: ShopLine }[] {
    const out: { npcId: string; line: ShopLine }[] = [];
    for (const npc of Object.values(NPCS)) {
      for (const line of npc.shop?.lines ?? []) out.push({ npcId: npc.id, line });
    }
    // Authored bargains: a price override never becomes a mint either.
    out.push({ npcId: 'master_smith', line: { kind: 'material', id: 'iron_ingot', price: 1 } });
    out.push({ npcId: 'ward_outfitter', line: { kind: 'item', id: 'steel_greatsword', price: 1 } });
    out.push({ npcId: 'row_apothecary', line: { kind: 'material', id: 'feast_platter', quality: 's', price: 2 } });
    return out;
  }

  it('buying then selling straight back never profits, at any charisma', () => {
    for (const goldGain of [1, 1.5, 2, 3, 10]) {
      const g = atVendor('master_smith', 1e9, true);
      for (const { npcId, line } of allLines()) {
        const paid = buyPrice(countsOf(g), npcId, line, goldGain);
        const back = resaleCeiling(line, goldGain);
        expect(paid, `${npcId} ${line.id} @goldGain ${goldGain}`).toBeGreaterThan(back);
      }
    }
  });

  it('the resale ceiling is what selling actually pays — best rune roll included', () => {
    const g = atVendor('ward_outfitter', 1e6, true);
    const goldGain = goldGainOf(g);
    const shelf = shelfOf(g, 'ward_outfitter');
    const i = shelf.findIndex((l) => l.id === 'iron_sword');
    const paid = buyPrice(countsOf(g), 'ward_outfitter', shelf[i], goldGain);
    g.dispatch(buy({ npc: 'ward_outfitter', index: i }));
    const sword = itemsOf(g).inventory.at(-1)!;
    expect(sellPrice(sword, goldGain)).toBeLessThan(paid);

    const scrap: ShopLine = { kind: 'material', id: 'iron_scrap' };
    expect(resaleCeiling(scrap, goldGain)).toBe(materialSellPrice('iron_scrap', goldGain));
    const salve: ShopLine = { kind: 'material', id: 'healing_salve', quality: 'b' };
    expect(resaleCeiling(salve, goldGain)).toBe(gradedUnitPrice('healing_salve', 'b', goldGain));
  });

  it('a live round trip at high charisma loses gold', () => {
    const g = atVendor('row_alchemist', 10_000, true);
    patch(g, (s) => {
      (s.attributes as AttributesState).attrs.cha.level = 200; // goldGain about 3.4
    });
    expect(goldGainOf(g)).toBeGreaterThan(3);
    const shelf = shelfOf(g, 'row_alchemist');
    const i = shelf.findIndex((l) => l.id === 'grain_spirit');
    const start = goldOf(g);
    expect(g.dispatch(buy({ npc: 'row_alchemist', index: i, qty: 10 })).ok).toBe(true);
    const line = shelf[i];
    const quality = (line.kind === 'material' ? (line.quality ?? 'c') : 'c') as QualityTier;
    const held = MATERIALS.grain_spirit.graded ? stockOf(matsOf(g), 'grain_spirit', quality) : matsOf(g).counts.grain_spirit;
    expect(held).toBe(10);
    expect(g.dispatch(sellStackable({ id: 'grain_spirit', quality, qty: 10 })).ok).toBe(true);
    expect(goldOf(g)).toBeLessThan(start);
  });
});

describe('shops — the counters are real', () => {
  it('every vendor stands somewhere and sells at least one thing that exists', () => {
    const vendors = Object.values(NPCS).filter((n) => n.shop);
    expect(vendors.length).toBeGreaterThanOrEqual(6);
    for (const npc of vendors) {
      for (const line of npc.shop!.lines) {
        expect(line.kind === 'item' ? ITEMS[line.id] : MATERIALS[line.id], `${npc.id} ${line.id}`).toBeDefined();
      }
    }
  });
});
