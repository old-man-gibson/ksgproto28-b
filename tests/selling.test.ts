/**
 * Port of the old `tests/selling.test.ts`: selling items from the pack as one
 * lot. The cases keep their old names.
 *
 * Call shape changes:
 * - `g.sellMany(uids)` is the command `items/sell { uids }`.
 * - `state.inventory`, `state.gold` and `state.log` are written through
 *   `patch`; log lines are read from the log slice.
 * - `sellPrice(state, item)` is `sellPrice(item, goldGain)`, with the gold
 *   gain read from the stat block.
 * - "logs nothing when no uid matches": the command returns a skip reason
 *   here. The case checks the reason, no sale line, and gold unchanged.
 *
 * No case is `it.todo`.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { GoldState } from '../src/systems/gold';
import { AFFIXES, affixOfId, sellItems, sellPrice, type ItemInstance, type ItemsState } from '../src/systems/items';
import type { LogState } from '../src/systems/log';
import { statOf } from '../src/systems/stats';
import { makeGame, patch, reads, slice } from './helpers';

const SWIFT_ID = Object.values(AFFIXES).find((a) => a.name === 'Swift')!.id;

function withItems(items: ItemInstance[]): Kernel {
  const g = makeGame({ seed: 1 });
  patch(g, (s) => {
    const it = s.items as ItemsState;
    it.inventory = items.map((i) => ({ ...i }));
    it.uidCounter = Math.max(it.uidCounter, ...items.map((i) => i.uid));
    (s.gold as GoldState).gold = 0;
    (s.log as LogState).log = [];
  });
  return g;
}

let uid = 0;
function item(defId: string, opts: Partial<ItemInstance> = {}): ItemInstance {
  return { uid: ++uid, defId, slots: 0, runes: [], ...opts };
}

const goldGain = (g: Kernel): number => statOf(reads(g), 'goldGain');
const price = (g: Kernel, i: ItemInstance): number => sellPrice(i, goldGain(g));
const goldOf = (g: Kernel): number => slice<GoldState>(g, 'gold').gold;

/** Sale lines only: ignore anything else the systems logged. */
function saleLines(g: Kernel): string[] {
  return slice<LogState>(g, 'log')
    .log.filter((l) => l.msg.startsWith('Sold '))
    .map((l) => l.msg);
}

describe('bulk selling', () => {
  it('logs one line for the whole lot, naming a uniform stack', () => {
    const items = [item('leather_vest'), item('leather_vest'), item('leather_vest')];
    const g = withItems(items);
    const each = price(g, items[0]);

    expect(g.dispatch(sellItems({ uids: items.map((i) => i.uid) })).ok).toBe(true);

    expect(saleLines(g)).toEqual([`Sold Leather Vest ×3 for ${each * 3} gold.`]);
    expect(goldOf(g)).toBe(each * 3);
    expect(slice<ItemsState>(g, 'items').inventory).toHaveLength(0);
  });

  it('falls back to a count when the lot is mixed', () => {
    const items = [item('leather_vest'), item('iron_sword'), item('leather_boots')];
    const g = withItems(items);
    const total = items.reduce((sum, i) => sum + price(g, i), 0);

    g.dispatch(sellItems({ uids: items.map((i) => i.uid) }));

    expect(saleLines(g)).toEqual([`Sold 3 items for ${total} gold.`]);
    expect(goldOf(g)).toBe(total);
  });

  it('treats a differently-affixed copy as a different item', () => {
    const items = [item('leather_vest'), item('leather_vest', { affix: affixOfId(SWIFT_ID) })];
    const g = withItems(items);

    g.dispatch(sellItems({ uids: items.map((i) => i.uid) }));

    expect(saleLines(g)[0]).toMatch(/^Sold 2 items for \d+ gold\.$/);
  });

  it('keeps the single-item wording for a lot of one', () => {
    const one = item('leather_vest');
    const g = withItems([one]);
    g.dispatch(sellItems({ uids: [one.uid] }));
    expect(saleLines(g)).toEqual([`Sold Leather Vest for ${price(g, one)} gold.`]);
  });

  it('returns socketed runes and skips uids that are no longer held', () => {
    const socketed = item('leather_vest', { slots: 2, runes: ['minor_rune_might'] });
    const g = withItems([socketed]);

    g.dispatch(sellItems({ uids: [socketed.uid, 9999] }));

    expect(slice<ItemsState>(g, 'items').runes['minor_rune_might']).toBe(1);
    expect(saleLines(g)).toHaveLength(1);
  });

  it('logs nothing when no uid matches', () => {
    const g = withItems([item('leather_vest')]);
    const result = g.dispatch(sellItems({ uids: [4242] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('none of the listed items is in the pack');
    expect(saleLines(g)).toEqual([]);
    expect(goldOf(g)).toBe(0);
  });
});
