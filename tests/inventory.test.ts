import { describe, expect, it } from 'vitest';
import {
  AFFIX_LIST,
  AFFIXES,
  affixOfId,
  arrangeInventory,
  categoriesPresent,
  groupItems,
  isMaxRarity,
  itemCategory,
  itemRarity,
  ITEMS,
  itemValue,
  maxRuneSlots,
  rarityAtMost,
  RUNE_SLOT_VALUE_MULT,
  sortStacks,
  stackKey,
  type Affix,
  type ItemInstance,
} from '../src/systems/items';

/**
 * Port of the old tests/inventory.test.ts, of the category and rarity cases
 * of tests/inventory-actions.test.ts and of "the stack key carries size" in
 * tests/gearcompare.test.ts.
 *
 * Changed: the import paths. The cases are the old ones, under the old names.
 */

const SWIFT: Affix = affixOfId('swift');
const SHARP: Affix = affixOfId('sharp');

let uid = 0;
function item(defId: string, opts: Partial<ItemInstance> = {}): ItemInstance {
  return { uid: ++uid, defId, slots: 0, runes: [], ...opts };
}

/** Two item defs with different values, for value-sort checks. */
const CHEAP = 'rusty_sword';
const DEAR = 'iron_sword';

describe('affixes', () => {
  it('the registry holds the five of the old list, in the order the drop code indexes', () => {
    expect(AFFIX_LIST.map((a) => a.name)).toEqual(['Sharp', 'Sturdy', 'Swift', 'Lucky', 'Warded']);
    expect(AFFIXES.sharp.mods).toEqual([{ stat: 'damage', op: 'mult', value: 0.1 }]);
  });
});

describe('item rarity', () => {
  it('scales with affix and rune slots', () => {
    expect(itemRarity(item(CHEAP))).toBe('common');
    expect(itemRarity(item(CHEAP, { slots: 1 }))).toBe('uncommon');
    expect(itemRarity(item(CHEAP, { affix: SWIFT }))).toBe('uncommon');
    expect(itemRarity(item(CHEAP, { affix: SWIFT, slots: 1 }))).toBe('rare');
    expect(itemRarity(item(CHEAP, { affix: SWIFT, slots: 3 }))).toBe('epic');
    expect(itemRarity(item(CHEAP, { slots: 4 }))).toBe('rare');
  });
});

describe('item value', () => {
  it('grows with each rolled rune slot', () => {
    const base = ITEMS[CHEAP].value;
    expect(itemValue(item(CHEAP))).toBe(base);
    expect(itemValue(item(CHEAP, { slots: 2 }))).toBeCloseTo(base * (1 + 2 * RUNE_SLOT_VALUE_MULT));
    expect(itemValue(item(CHEAP, { slots: 4 }))).toBeGreaterThan(itemValue(item(CHEAP, { slots: 3 })));
  });

  it('stacks the affix and rune-slot premiums', () => {
    const plain = itemValue(item(CHEAP));
    expect(itemValue(item(CHEAP, { affix: SWIFT, slots: 2 }))).toBeGreaterThan(itemValue(item(CHEAP, { affix: SWIFT })));
    expect(itemValue(item(CHEAP, { affix: SWIFT }))).toBeGreaterThan(plain);
  });

  it('ignores socketed runes — selling pries them out and keeps them', () => {
    expect(itemValue(item(CHEAP, { slots: 2, runes: ['minor_rune_might', 'x'] }))).toBe(
      itemValue(item(CHEAP, { slots: 2 })),
    );
  });

  it('sorts by value using the same premiums', () => {
    const bare = item(CHEAP);
    const socketed = item(CHEAP, { slots: 4 });
    expect(arrangeInventory([bare, socketed], 'value')[0].item.uid).toBe(socketed.uid);
  });
});

describe('max rarity', () => {
  // Rune-slot ceilings differ by size class: daggers and rings are small (3),
  // greatswords and chest pieces are large (4).
  it('needs both an affix and every slot the item class can roll', () => {
    expect(isMaxRarity(item('iron_dagger', { affix: SWIFT, slots: 3 }))).toBe(true);
    expect(isMaxRarity(item('iron_dagger', { affix: SWIFT, slots: 2 }))).toBe(false);
    expect(isMaxRarity(item('iron_dagger', { slots: 3 }))).toBe(false);
  });

  it('measures the ceiling per class, not against the global cap', () => {
    expect(maxRuneSlots(ITEMS['iron_dagger'])).toBeLessThan(maxRuneSlots(ITEMS['steel_greatsword']));
    expect(isMaxRarity(item('steel_greatsword', { affix: SHARP, slots: 3 }))).toBe(false);
    expect(isMaxRarity(item('steel_greatsword', { affix: SHARP, slots: 4 }))).toBe(true);
  });
});

describe('stacking', () => {
  it('bundles identical items and splits on slots, affix, or socketed runes', () => {
    const items = [
      item(CHEAP, { slots: 2 }),
      item(CHEAP, { slots: 2 }),
      item(CHEAP, { slots: 3 }),
      item(CHEAP, { affix: SWIFT, slots: 2 }),
      item(CHEAP, { affix: SHARP, slots: 2 }),
      item(CHEAP, { slots: 2, runes: ['x'] }),
    ];
    const stacks = groupItems(items);
    expect(stacks.map((s) => s.items.length)).toEqual([2, 1, 1, 1, 1]);
  });

  it('ignores socket order when keying a stack', () => {
    expect(stackKey(item(CHEAP, { slots: 2, runes: ['a', 'b'] }))).toBe(
      stackKey(item(CHEAP, { slots: 2, runes: ['b', 'a'] })),
    );
  });

  it('leaves every item on its own when grouping is off', () => {
    const items = [item(CHEAP), item(CHEAP), item(CHEAP)];
    expect(groupItems(items, false)).toHaveLength(3);
  });

  it('gives each stack a distinct key so keyed each blocks stay stable', () => {
    const stacks = groupItems([item(CHEAP), item(CHEAP, { slots: 1 })]);
    expect(new Set(stacks.map((s) => s.key)).size).toBe(2);
  });
});

describe('the stack key carries size', () => {
  it('a medium item keys as it always did, with the size absent or named', () => {
    const base: ItemInstance = { uid: 1, defId: 'iron_sword', slots: 2, runes: [] };
    expect(stackKey(base)).toBe('iron_sword||2|');
    expect(stackKey({ ...base, size: 'medium' })).toBe(stackKey(base));
  });

  it('a larger item is its own stack', () => {
    const vest = (opts: Partial<ItemInstance> = {}) => item('leather_vest', opts);
    const medium = vest({ affix: SHARP });
    const large = vest({ affix: SHARP, size: 'large' });
    const huge = vest({ affix: SHARP, size: 'huge' });
    expect(new Set([stackKey(medium), stackKey(large), stackKey(huge)]).size).toBe(3);
    expect(groupItems([medium, large, vest({ affix: SHARP, size: 'large' })]).map((s) => s.items.length)).toEqual([1, 2]);
  });
});

describe('sorting', () => {
  it('orders by value, rune slots, rarity, and bonus', () => {
    const plain = item(CHEAP);
    const pricey = item(DEAR);
    const socketed = item(CHEAP, { slots: 3 });
    const swift = item(CHEAP, { affix: SWIFT });

    expect(ITEMS[DEAR].value).toBeGreaterThan(ITEMS[CHEAP].value);

    const stacks = groupItems([plain, pricey, socketed, swift]);
    const first = (mode: Parameters<typeof sortStacks>[1]) => sortStacks(stacks, mode)[0].item.uid;

    expect(first('value')).toBe(pricey.uid);
    expect(first('runes')).toBe(socketed.uid);
    expect(first('rarity')).toBe(socketed.uid);
    expect(first('affix')).toBe(swift.uid);
  });

  it('sinks unaffixed gear below affixed gear', () => {
    const stacks = sortStacks(groupItems([item(CHEAP), item(CHEAP, { affix: SHARP })]), 'affix');
    expect(stacks[0].item.affix?.name).toBe('Sharp');
    expect(stacks[1].item.affix).toBeUndefined();
  });

  it('arranges in one call and keeps the stack count', () => {
    const stacks = arrangeInventory([item(DEAR), item(CHEAP), item(CHEAP)], 'value');
    expect(stacks).toHaveLength(2);
    expect(stacks[0].item.defId).toBe(DEAR);
    expect(stacks[1].items).toHaveLength(2);
  });
});

describe('item categories', () => {
  it('groups weapons by their broad type, incl. katanas as swords', () => {
    expect(itemCategory(item('iron_sword')).key).toBe('sword');
    expect(itemCategory(item('katana')).key).toBe('sword');
    expect(itemCategory(item('steel_greatsword')).key).toBe('greatsword');
    expect(itemCategory(item('iron_dagger')).key).toBe('dagger');
  });

  it('falls back to the slot for armour', () => {
    expect(itemCategory(item('leather_jerkin')).key).toBe('slot:chest');
    expect(itemCategory(item('leather_boots')).key).toBe('slot:feet');
  });

  it('lists distinct categories, weapons before armour', () => {
    const cats = categoriesPresent([
      item('leather_boots'),
      item('iron_sword'),
      item('iron_dagger'),
      item('iron_sword'),
    ]);
    expect(cats.map((c) => c.key)).toEqual(['sword', 'dagger', 'slot:feet']);
  });
});

describe('rarity threshold', () => {
  it('matches items at or below a ceiling', () => {
    expect(rarityAtMost(item('iron_sword'), 'common')).toBe(true); // plain = common
    expect(rarityAtMost(item('iron_sword', { affix: SWIFT }), 'common')).toBe(false); // uncommon
    expect(rarityAtMost(item('iron_sword', { affix: SWIFT }), 'uncommon')).toBe(true);
  });
});
