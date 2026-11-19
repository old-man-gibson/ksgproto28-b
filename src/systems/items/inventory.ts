/**
 * Inventory presentation: categories, rarity, grouping of duplicates and
 * ordering. Port of the old `systems/inventory.ts`. Pure: no state.
 */
import {
  forgeKeyOf,
  itemDefOf,
  itemName,
  itemValue,
  runeRefKey,
  SIZE_LADDER,
  sizeRank,
  SLOT_IDS,
  SLOT_NAMES,
  type ForgedSpec,
  type ItemInstance,
  type SlotId,
} from './defs';
import type { DeepReadonly } from '../../kernel';
import { maxRuneSlots } from './runeslots';

/** An item as these functions read it. A view row satisfies it. */
type Item = Readonly<Pick<ItemInstance, 'uid' | 'defId' | 'slots' | 'size'>> & {
  readonly affix?: { readonly name: string };
  readonly runes?: readonly string[];
  readonly forged?: DeepReadonly<ForgedSpec>;
};

// ---- categories ----

export const RARITY_IDS = ['common', 'uncommon', 'rare', 'epic'] as const;
export type RarityId = (typeof RARITY_IDS)[number];

/** Worst to best, so "X or lower" is one comparison. */
export const RARITY_RANK: Record<RarityId, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
};

export function rarityAtMost(item: Item, max: RarityId): boolean {
  return RARITY_RANK[itemRarity(item)] <= RARITY_RANK[max];
}

export interface ItemCategory {
  key: string;
  label: string;
}

/**
 * The category of a weapon is the broad tag it carries, so a katana and a
 * rapier are both "Swords". Armour is grouped by its slot. The order here is
 * the order of the selection chips.
 */
const CATEGORY_TAGS: ItemCategory[] = [
  { key: 'sword', label: 'Swords' },
  { key: 'greatsword', label: 'Greatswords' },
  { key: 'dagger', label: 'Daggers' },
  { key: 'spear', label: 'Spears' },
  { key: 'blunt', label: 'Blunt' },
  { key: 'bow', label: 'Bows' },
  { key: 'staff', label: 'Staves' },
  { key: 'shield', label: 'Shields' },
];

const SLOT_ORDER: readonly SlotId[] = SLOT_IDS;

export function itemCategory(item: Item): ItemCategory {
  const def = itemDefOf(item);
  if (def) {
    for (const cat of CATEGORY_TAGS) if (def.tags.includes(cat.key)) return cat;
    return { key: `slot:${def.slot}`, label: SLOT_NAMES[def.slot] };
  }
  return { key: 'other', label: 'Other' };
}

/** The distinct categories in a bag: weapon categories first, then armour slots in slot order. */
export function categoriesPresent(items: readonly Item[]): ItemCategory[] {
  const seen = new Map<string, ItemCategory>();
  for (const item of items) {
    const cat = itemCategory(item);
    if (!seen.has(cat.key)) seen.set(cat.key, cat);
  }
  const order = (c: ItemCategory) => {
    const w = CATEGORY_TAGS.findIndex((t) => t.key === c.key);
    if (w >= 0) return w;
    const slot = c.key.slice(5) as SlotId;
    const at = SLOT_ORDER.indexOf(slot);
    return CATEGORY_TAGS.length + (at < 0 ? SLOT_ORDER.length : at);
  };
  return [...seen.values()].sort((a, b) => order(a) - order(b));
}

// ---- rarity ----

/** An item has no declared rarity. An affix counts as two rune slots. */
export function rarityScore(item: Item): number {
  return (item.affix ? 2 : 0) + (item.slots ?? 0);
}

export function itemRarity(item: Item): RarityId {
  const score = rarityScore(item);
  if (score >= 5) return 'epic';
  if (score >= 3) return 'rare';
  if (score >= 1) return 'uncommon';
  return 'common';
}

/** An affix and every rune slot the size class of the item allows. */
export function isMaxRarity(item: Item): boolean {
  const def = itemDefOf(item);
  if (!def || !item.affix) return false;
  return (item.slots ?? 0) >= maxRuneSlots(def);
}

// ---- grouping ----

/**
 * Identity for stacking: base item, affix, rune-slot count, socketed runes
 * (order ignored) and size. A medium item adds nothing for its size. Keys are
 * not saved.
 *
 * A forged item adds its forge key (parts and grade), so two different
 * forged swords do not stack (step 3, smithing).
 */
export function stackKey(item: Item): string {
  const runes = (item.runes ?? []).map(runeRefKey).sort().join(';');
  const rank = sizeRank(item.size);
  const sized = rank === sizeRank('medium') ? '' : `|@${SIZE_LADDER[rank]}`;
  const forged = item.forged ? `|${forgeKeyOf(item)}` : '';
  return `${item.defId}|${item.affix?.name ?? ''}|${item.slots ?? 0}|${runes}${sized}${forged}`;
}

export interface ItemStack<T extends Item = Item> {
  key: string;
  /** The instance shown and acted on: the first of the stack. */
  item: T;
  items: T[];
}

/** Bundle identical items. With `group` off every item is its own stack. */
export function groupItems<T extends Item>(items: readonly T[], group = true): ItemStack<T>[] {
  const stacks: ItemStack<T>[] = [];
  const byKey = new Map<string, ItemStack<T>>();
  for (const item of items) {
    const key = stackKey(item);
    const existing = group ? byKey.get(key) : undefined;
    if (existing) {
      existing.items.push(item);
      continue;
    }
    const stack: ItemStack<T> = { key: `${key}#${item.uid}`, item, items: [item] };
    if (group) byKey.set(key, stack);
    stacks.push(stack);
  }
  return stacks;
}

// ---- sorting ----

export const SORT_MODES = ['newest', 'value', 'runes', 'rarity', 'affix', 'name'] as const;
export type SortMode = (typeof SORT_MODES)[number];

export const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Newest',
  value: 'Value',
  runes: 'Rune Slots',
  rarity: 'Rarity',
  affix: 'Bonus',
  name: 'Name',
};

function slotRank(item: Item): number {
  const def = itemDefOf(item);
  const idx = def ? SLOT_ORDER.indexOf(def.slot) : -1;
  return idx < 0 ? SLOT_ORDER.length : idx;
}

function compare(a: Item, b: Item, mode: SortMode): number {
  switch (mode) {
    case 'value':
      // The gold gain of the seller scales every price by one factor, so the
      // worth before it orders the same.
      return itemValue(b) - itemValue(a);
    case 'runes':
      // Most slots first; among equals the one with more runes socketed.
      return (b.slots ?? 0) - (a.slots ?? 0) || (b.runes?.length ?? 0) - (a.runes?.length ?? 0);
    case 'rarity':
      return rarityScore(b) - rarityScore(a);
    case 'affix':
      // Affixed gear first, by affix name; plain gear last.
      if (!!a.affix !== !!b.affix) return a.affix ? -1 : 1;
      return (a.affix?.name ?? '').localeCompare(b.affix?.name ?? '');
    case 'name':
      return slotRank(a) - slotRank(b) || itemName(a).localeCompare(itemName(b));
    case 'newest':
      return b.uid - a.uid;
  }
}

/** Order stacks by a mode, then by name, then by uid. */
export function sortStacks<T extends Item>(stacks: readonly ItemStack<T>[], mode: SortMode): ItemStack<T>[] {
  return [...stacks].sort((x, y) => {
    const a = x.item;
    const b = y.item;
    return compare(a, b, mode) || (mode === 'name' ? 0 : compare(a, b, 'name')) || a.uid - b.uid;
  });
}

/** Group, then sort. */
export function arrangeInventory<T extends Item>(items: readonly T[], mode: SortMode, group = true): ItemStack<T>[] {
  return sortStacks(groupItems(items, group), mode);
}
