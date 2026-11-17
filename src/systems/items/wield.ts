/**
 * How held gear occupies the hands, and what it costs to hold something
 * where it does not belong or at the wrong size. Port of the old
 * `systems/wield.ts`. Pure: the functions take the equipment map, the grant
 * set and the skill levels they read.
 *
 * Capabilities come as grant strings and nothing here knows who granted
 * them: `arms:+N` (more grips), `onehand:<tag>` and `onehand:*` (a
 * two-hander costs one arm), `telekinetic:N` (N grips are held by the mind).
 */
import type { DeepReadonly } from '../../kernel';
import { itemDefOf, sizeRank, type ItemDef, type ItemInstance, type SlotId, type WieldClass } from './defs';

export type Equipment = Partial<Record<SlotId, ItemInstance>>;
type Worn = DeepReadonly<Equipment>;
type Def = DeepReadonly<ItemDef>;
export type Grants = ReadonlySet<string>;

/** Attack speed lost per size step a held weapon is too big for its wielder. */
export const OVERSIZE_SPEED_PER_STEP = 0.18;

/** Damage lost per size step a held weapon is too small for its wielder. */
export const UNDERSIZE_DAMAGE_PER_STEP = 0.22;

/**
 * Share of itself a piece of armour loses per size step off the wearer, in
 * either direction. Two steps off gives nothing.
 */
export const ARMOR_SIZE_FIT_PER_STEP = 0.65;

/** The most of the oversize penalty that skill can forgive, by wield class. */
export const OVERSIZE_FORGIVENESS_CAP: Record<WieldClass, number> = {
  light: 0.9,
  one_handed: 0.9,
  two_handed: 0.5,
  offhand: 0.5,
};

/** What one milestone of the governing weapon skill forgives, and how many levels apart they are. */
export const OVERSIZE_FORGIVENESS_PER_MILESTONE = 0.05;
export const OVERSIZE_MILESTONE_LEVELS = 10;

/** Effect lost by holding a main-hand weapon in an off hand. */
export const OFF_HAND_PENALTY = 0.4;
/** Effect lost by forcing an off-hand item into the main hand. */
export const MAIN_HAND_PENALTY = 0.25;

export const WIELD_NAMES: Record<WieldClass, string> = {
  light: 'Light',
  one_handed: 'One-handed',
  two_handed: 'Two-handed',
  offhand: 'Off-hand',
};

/**
 * Every hand a body could have, in order. Index 0 is the main hand and the
 * rest are off hands. A body has `armsFrom(grants)` of these.
 */
export const HAND_SLOTS: SlotId[] = ['weapon', 'offhand', 'hand3', 'hand4', 'hand5', 'hand6'];

/** Hands an ordinary body has. */
export const BASE_ARMS = 2;

/** How an item is wielded: its `wield`, or inferred from its slot. */
export function wieldOf(def: Def): WieldClass {
  return def.wield ?? (def.slot === 'offhand' ? 'offhand' : 'one_handed');
}

/**
 * How well an item works in a slot: 1 where it belongs, a fraction where it
 * is usable at a cost, 0 where it cannot go. Everything the piece gives (its
 * mods, its affix, its runes) is scaled by this.
 */
export function wieldScale(def: Def, slot: SlotId): number {
  if (!HAND_SLOTS.includes(slot)) return def.slot === slot ? 1 : 0;
  // Only hand gear may occupy a hand.
  if (!HAND_SLOTS.includes(def.slot)) return 0;
  const wield = wieldOf(def);
  if (slot === 'weapon') {
    // An off-hand piece with a main-hand bonus pays nothing there.
    return wield === 'offhand' && !def.mainHand ? 1 - MAIN_HAND_PENALTY : 1;
  }
  if (wield === 'two_handed') return 0;
  return wield === 'one_handed' ? 1 - OFF_HAND_PENALTY : 1;
}

/** Slots an item may be placed in, best fit first, within the hands a body of `arms` arms has. */
export function allowedSlots(def: Def, arms: number = BASE_ARMS): SlotId[] {
  if (!HAND_SLOTS.includes(def.slot)) return [def.slot];
  return HAND_SLOTS.slice(0, Math.max(BASE_ARMS, arms))
    .filter((s) => wieldScale(def, s) > 0)
    .sort((a, b) => wieldScale(def, b) - wieldScale(def, a));
}

/** How many arms a body has: two, plus every `arms:+N` grant. */
export function armsFrom(grants: Grants): number {
  let arms = BASE_ARMS;
  for (const g of grants) {
    if (g.startsWith('arms:+')) arms += Number(g.slice(6)) || 0;
  }
  return arms;
}

/** Grips held by the mind: the sum of every `telekinetic:N` grant. */
export function telekineticFrom(grants: Grants): number {
  let n = 0;
  for (const g of grants) {
    if (g.startsWith('telekinetic:')) n += Number(g.slice(12)) || 0;
  }
  return n;
}

/** Grips that are hands. Never negative. */
export function handsFrom(grants: Grants): number {
  return Math.max(0, armsFrom(grants) - telekineticFrom(grants));
}

/** Whether the mind holds this grip. The floating grips are the last ones a body has. */
export function isTelekinetic(grants: Grants, slot: SlotId): boolean {
  const i = HAND_SLOTS.indexOf(slot);
  return i >= 0 && i >= handsFrom(grants) && i < armsFrom(grants);
}

/** Occupied floating grips, in slot order. */
export function floatingSlots(worn: Worn, grants: Grants): SlotId[] {
  return HAND_SLOTS.filter((s) => worn[s] && isTelekinetic(grants, s));
}

/** Grips holding something, floating or not. */
export function heldGrips(worn: Worn, grants: Grants): number {
  const arms = armsFrom(grants);
  return HAND_SLOTS.filter((s, i) => i < arms && worn[s]).length;
}

/**
 * The share of the weapon damage the hands swing, 0 to 1. Each floating grip
 * lands `1 / heldGrips` of the whole on its own clock. 0 for a body with no
 * hands; 1 bare-handed.
 */
export function handSwingShare(worn: Worn, grants: Grants): number {
  if (handsFrom(grants) === 0) return 0;
  const held = heldGrips(worn, grants);
  if (held === 0) return 1;
  return (held - floatingSlots(worn, grants).length) / held;
}

/**
 * Arms a piece occupies. A two-hander costs two, unless the grip is one the
 * mind holds, or a grant (`onehand:*`, `onehand:<tag of the item>`) makes it
 * cost one.
 */
export function armCost(grants: Grants, def: Def, slot?: SlotId): number {
  if (wieldOf(def) !== 'two_handed') return 1;
  if (slot && isTelekinetic(grants, slot)) return 1;
  if (grants.has('onehand:*')) return 1;
  return (def.tags ?? []).some((t) => grants.has(`onehand:${t}`)) ? 1 : 2;
}

/** Whether a piece leaves a hand free. */
export function canOneHand(grants: Grants, def: Def): boolean {
  return armCost(grants, def) < BASE_ARMS;
}

/** Arms taken by what is held. */
export function armsUsed(worn: Worn, grants: Grants): number {
  let used = 0;
  for (const slot of HAND_SLOTS) {
    const item = worn[slot];
    const def = item ? itemDefOf(item) : undefined;
    if (def) used += armCost(grants, def, slot);
  }
  return used;
}

/**
 * The two-handed weapon that leaves no arm free, if any. The question is how
 * many arms are free, not what the weapon is called: a grant can make a
 * greatsword cost one arm, and a body can have arms to spare.
 */
export function twoHandedWeapon(worn: Worn, grants: Grants): DeepReadonly<ItemInstance> | null {
  const weapon = worn.weapon;
  const def = weapon ? itemDefOf(weapon) : undefined;
  if (!def || wieldOf(def) !== 'two_handed') return null;
  return armsFrom(grants) - armsUsed(worn, grants) >= 1 ? null : weapon!;
}

/**
 * The two-hander that has taken `slot`, when `slot` is a hand it occupies.
 * Null for a slot that is not a hand, for the main hand, and for a free hand.
 */
export function handTakenBy(worn: Worn, grants: Grants, slot: SlotId): DeepReadonly<ItemInstance> | null {
  if (!HAND_SLOTS.includes(slot) || slot === 'weapon') return null;
  return twoHandedWeapon(worn, grants);
}

/** How big a piece is. Absent reads as medium. */
export function itemSizeRank(item: DeepReadonly<ItemInstance> | undefined | null): number {
  return sizeRank(item?.size);
}

/** Skill id to level, for the oversize forgiveness. */
export type SkillLevels = (skillId: string) => number;

/**
 * The share of the oversize penalty the wielder's skill forgives for the
 * weapon in hand: 5% per 10 levels of the best skill that governs one of the
 * weapon's tags, up to the cap of its wield class. `familySkill` maps a tag
 * to the skill that claims it.
 */
export function oversizeForgiveness(
  worn: Worn,
  familySkill: (tag: string) => string | undefined,
  skillLevel: SkillLevels,
): number {
  const weapon = worn.weapon;
  const def = weapon ? itemDefOf(weapon) : undefined;
  if (!def) return 0;
  let level = 0;
  for (const tag of def.tags ?? []) {
    const skill = familySkill(tag);
    if (skill) level = Math.max(level, skillLevel(skill));
  }
  const earned = Math.floor(level / OVERSIZE_MILESTONE_LEVELS) * OVERSIZE_FORGIVENESS_PER_MILESTONE;
  return Math.min(OVERSIZE_FORGIVENESS_CAP[wieldOf(def)], earned);
}

/**
 * Size steps the held weapon is too big for a wielder of `wielderRank`, after
 * what skill forgives. One direction only. Fractional.
 */
export function oversizeSteps(worn: Worn, wielderRank: number, forgiveness: number): number {
  const raw = Math.max(0, itemSizeRank(worn.weapon) - wielderRank);
  return raw * (1 - forgiveness);
}

/** Size steps the held weapon is too small for a wielder of `wielderRank`. */
export function undersizeSteps(worn: Worn, wielderRank: number): number {
  const weapon = worn.weapon;
  return weapon ? Math.max(0, wielderRank - itemSizeRank(weapon)) : 0;
}

/**
 * How much of itself a piece gives at this wielder's size, 0 to 1. The weapon
 * slot always gives 1: a weapon's size costs speed or damage instead.
 */
export function sizeFit(item: DeepReadonly<ItemInstance>, slot: SlotId, wielderRank: number): number {
  if (slot === 'weapon') return 1;
  const gap = Math.abs(itemSizeRank(item) - wielderRank);
  return Math.max(0, 1 - ARMOR_SIZE_FIT_PER_STEP * gap);
}

/** Why an item is at less than full effect where it sits. Empty at full effect. */
export function wieldNote(def: Def, slot: SlotId): string {
  const scale = wieldScale(def, slot);
  if (scale >= 1) return '';
  return `${WIELD_NAMES[wieldOf(def)]} in the ${slot === 'weapon' ? 'main' : 'off'} hand — ${Math.round(scale * 100)}% effect`;
}
