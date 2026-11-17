/**
 * Rune slots of an item: the size class, the roll at generation and the
 * ceiling. Port of the item-generation half of the old `systems/runes.ts`.
 * Socketing and rune effects are runecarving and are not ported.
 */
import type { DeepReadonly, Rng } from '../../kernel';
import type { ItemDef, RuneSizeClass } from './defs';

type Def = DeepReadonly<ItemDef>;

export const MAX_RUNE_SLOTS = 4;

/** Slot-count weights per size class. The index is the slot count, 0 to 4. */
export const SLOT_WEIGHTS: Record<RuneSizeClass, number[]> = {
  small: [50, 32, 14, 4, 0],
  medium: [25, 35, 25, 12, 3],
  large: [12, 24, 32, 22, 10],
};

/** Size class of an item: its `runeClass`, else inferred from tags and slot. */
export function runeClassOf(def: Def): RuneSizeClass {
  if (def.runeClass) return def.runeClass;
  if (def.tags.includes('dagger')) return 'small';
  if (def.tags.includes('greatsword')) return 'large';
  switch (def.slot) {
    case 'accessory':
      return 'small';
    case 'chest':
    case 'legs':
      return 'large';
    default:
      return 'medium';
  }
}

/** The most slots the size class of an item can roll. */
export function maxRuneSlots(def: Def): number {
  const weights = SLOT_WEIGHTS[runeClassOf(def)];
  for (let slots = weights.length - 1; slots >= 0; slots--) {
    if (weights[slots] > 0) return slots;
  }
  return 0;
}

/** The slots a new item can roll, lowest and highest. */
export function runeSlotRange(def: Def): [number, number] {
  const weights = SLOT_WEIGHTS[runeClassOf(def)];
  const min = weights.findIndex((w) => w > 0);
  return [Math.max(0, min), maxRuneSlots(def)];
}

/** Roll how many rune slots a newly generated item gets. One draw. */
export function rollRuneSlots(rng: Rng, def: Def): number {
  const weights = SLOT_WEIGHTS[runeClassOf(def)];
  const entries = weights.map((weight, slots) => ({ slots, weight })).filter((e) => e.weight > 0);
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng.next() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.slots;
  }
  return entries[entries.length - 1].slots;
}
