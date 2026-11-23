/**
 * Items: the pack, the worn gear, the rune pile and the stronghold stash.
 * Port of the old `systems/equipment.ts` (equip, unequip, `canEquip`,
 * `wearIfFree`, `nextUid`), `systems/wield.ts`, `systems/inventory.ts`, the
 * item half of `systems/stash.ts`, `createItem` and `grantRune` of
 * `systems/runes.ts`, the equipment loop of `collectBaseMods` and
 * `equippedTags` of `systems/attributes.ts`, and the size penalties of
 * `systems/derived.ts`. See README.md in this folder.
 */
import {
  answer,
  cloneJson,
  defineCommand,
  defineEvent,
  defineRequest,
  defineSystem,
  handle,
  OK,
  PLAYER,
  registry,
  skipped,
  type CommandResult,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type SystemDef,
} from '../../kernel';
import counters, { conditionsMet, hasFlag } from '../counters';
import { addGold } from '../gold';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import skills, { conditionReader, SKILL_LIST, skillLevel } from '../skills';
import { armedFact, contentMod, factValue, statMod, statOf, wieldTagFact, type ModOrigin, type StatMod } from '../stats';
import { compareToWorn, type DeltaLine } from './compare';
import itemsTextData from './content/items_text.json';
import {
  affixOfId,
  affixRegistry,
  forgedExemplarOf,
  itemDefOf,
  itemName,
  itemRegistry,
  itemValue,
  resolveRune,
  runeContextFor,
  runeEffectAt,
  runeRegistry,
  RUNE_LIST,
  RUNES,
  AFFIX_LIST,
  SIZE_LADDER,
  SLOT_IDS,
  SLOT_NAMES,
  sizeRank,
  type CarvedRune,
  type ForgedSpec,
  type ItemDef,
  type ItemInstance,
  type RuneRef,
  type SizeTag,
  type SlotId,
} from './defs';
import { condsText, describeMod, fmt } from './format';
import { itemCategory, itemRarity, type RarityId } from './inventory';
import { migrations } from './migrations';
import { rollRuneSlots } from './runeslots';
import {
  allowedSlots,
  armCost,
  armsFrom,
  armsUsed,
  BASE_ARMS,
  HAND_SLOTS,
  handTakenBy,
  OVERSIZE_SPEED_PER_STEP,
  oversizeForgiveness,
  oversizeSteps,
  sizeFit,
  UNDERSIZE_DAMAGE_PER_STEP,
  undersizeSteps,
  WIELD_NAMES,
  wieldNote,
  wieldOf,
  wieldScale,
  type Equipment,
} from './wield';

export * from './compare';
export * from './defs';
export * from './format';
export * from './inventory';
export * from './runeslots';
export * from './wield';

// ---- slice ----

export interface Bearer {
  /** Capability grants of the body: `arms:+N`, `onehand:<tag>`, `onehand:*`, `telekinetic:N`. */
  grants: string[];
  /** How big the body is. */
  size: SizeTag;
}

export interface ItemsState {
  /** The last uid handed out. */
  uidCounter: number;
  /** The pack. */
  inventory: ItemInstance[];
  /** Worn and held gear by slot. An empty slot is absent. */
  equipment: Equipment;
  /** Catalogue runes owned: id to count. Nothing uses them until runecarving. */
  runes: Record<string, number>;
  /** The stronghold stash: keep-marked items a prestige keeps. */
  stash: ItemInstance[];
  /** The body that wears the gear. The system that owns the body states it (`items/set-bearer`). */
  bearer: Bearer;
}

type State = DeepReadonly<ItemsState>;
type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

// ---- text ----

const itemsText = registry(textSchema, itemsTextData, 'Item text');
const TEXT = Object.fromEntries((itemsTextData as TextRecord[]).map((r) => [r.id, r.text]));

// ---- reads ----

/** The counter flag that opens runecarving. While it is shut, rune slots are hidden and a rune drop pays nothing. */
export const RUNECARVING_FLAG = 'unlock_runecarving';

/** The named fact a festival attempt states while its door holds the gear. The stash is shut then. */
export const FESTIVAL_HOLDS_FACT = 'festivalHolds';

/**
 * The named fact a festival attempt states for each item it lends (the issued
 * weapon; the royale's finds): `festivalLent:<uid>`. A lent item is not sold.
 */
export const festivalLentFact = (uid: number): string => `festivalLent:${uid}`;

export function grantsOf(state: State): ReadonlySet<string> {
  return new Set(state.bearer.grants);
}

/** The size rank of the body that wears the gear. */
export function wielderRank(state: State): number {
  return sizeRank(state.bearer.size);
}

/** An item by uid, in the pack or worn. */
export function findItem(state: State, uid: number): DeepReadonly<ItemInstance> | null {
  return (
    state.inventory.find((i) => i.uid === uid) ??
    Object.values(state.equipment).find((i) => i?.uid === uid) ??
    null
  );
}

/** The definition of the item in the weapon slot, if any. */
export function weaponDef(state: State): ItemDef | undefined {
  const weapon = state.equipment.weapon;
  return weapon ? itemDefOf(weapon) : undefined;
}

/** Whether the requirements of an item hold. An item with no definition cannot be equipped. */
export function canEquip(ctx: ReadCtx, item: Pick<ItemInstance, 'defId'>): boolean {
  const def = itemDefOf(item);
  return !!def && (!def.requirements || conditionsMet(conditionReader(ctx), def.requirements));
}

/** Only keep-marked items may enter the stash. */
export function keepMarked(item: Pick<ItemInstance, 'defId'>): boolean {
  return !!itemDefOf(item)?.keep;
}

/**
 * The stash items the next run starts with: what the stash held, plus every
 * keep-marked item in the pack and worn. `elsewhere` is for items another
 * system holds (a sheath, a fight, a festival door). Copies.
 */
export function carriedStash(state: State, elsewhere: readonly DeepReadonly<ItemInstance>[] = []): ItemInstance[] {
  const items: DeepReadonly<ItemInstance>[] = [];
  const find = (item: DeepReadonly<ItemInstance> | null | undefined) => {
    if (item && keepMarked(item) && !items.includes(item)) items.push(item);
  };
  for (const item of state.stash) find(item);
  for (const item of state.inventory) find(item);
  for (const item of Object.values(state.equipment)) find(item);
  for (const item of elsewhere) find(item);
  return cloneJson(items) as ItemInstance[];
}

// ---- the weapon skill of a tag ----

let familySkills: Map<string, string> | null = null;

/**
 * The skill that governs a weapon family: the first combat skill that
 * carries the tag. Weapon skills are not named to a pattern, so the id
 * cannot be derived from the tag.
 */
export function familySkillFor(tag: string): string | undefined {
  if (!familySkills) {
    familySkills = new Map();
    for (const skill of SKILL_LIST) {
      if (skill.category !== 'combat') continue;
      for (const t of skill.tags ?? []) {
        if (t !== 'combat' && !familySkills.has(t)) familySkills.set(t, skill.id);
      }
    }
  }
  return familySkills.get(tag);
}

// ---- the modifier source ----

/** The source of everything worn gear gives. Reads skill levels for the oversize forgiveness. */
export const WORN_SOURCE = 'items/worn';

/** Size steps the held weapon is too big, after what the wielder's skill forgives. */
function oversizeOf(state: State, levels: (skillId: string) => number): number {
  return oversizeSteps(
    state.equipment,
    wielderRank(state),
    oversizeForgiveness(state.equipment, familySkillFor, levels),
  );
}

function wornMods(state: State, levels: (skillId: string) => number): StatMod[] {
  const out: StatMod[] = [];
  const worn = state.equipment;
  const rank = wielderRank(state);

  // Facts first: the tags of everything worn, and whether the weapon slot is filled.
  const tags = new Set<string>();
  for (const item of Object.values(worn)) {
    if (!item) continue;
    for (const t of itemDefOf(item)?.tags ?? []) tags.add(t);
  }
  for (const tag of tags) out.push(wieldTagFact(tag));
  if (worn.weapon) out.push(armedFact());

  /** What the other hand carries: a hand bonus asks about the pairing. */
  const tagsIn = (slot: SlotId): readonly string[] => {
    const held = worn[slot];
    return held ? (itemDefOf(held)?.tags ?? []) : [];
  };

  for (const [slot, item] of Object.entries(worn) as [SlotId, DeepReadonly<ItemInstance>][]) {
    if (!item) continue;
    const def = itemDefOf(item);
    if (!def) continue;
    const label = itemName(item);
    // A piece held where it was not made for gives part of itself, and so
    // does armour built for a body of another size.
    const fit = wieldScale(def, slot) * sizeFit(item, slot, rank);
    const origin = (kind: ModOrigin['kind']): ModOrigin => ({ kind, slot });
    for (const m of def.mods) out.push(contentMod(m, label, origin('item'), 0, fit));
    for (const m of item.affix?.mods ?? []) out.push(contentMod(m, label, origin('affix'), 0, fit));
    // A socketed rune gives the effect of the context of this item.
    const context = runeContextFor(def.slot);
    for (const ref of item.runes ?? []) {
      const rune = resolveRune(ref);
      for (const m of runeEffectAt(ref, context)?.mods ?? []) {
        out.push(contentMod(m, `${rune.name} (${def.name})`, origin('rune'), 0, fit));
      }
    }
    // Hand bonuses: full strength, and only for the hand they name.
    const bonus = slot === 'weapon' ? def.mainHand : slot === 'offhand' ? def.offHand : undefined;
    const paired = !bonus?.pairedWith || tagsIn(slot === 'weapon' ? 'offhand' : 'weapon').includes(bonus.pairedWith);
    if (bonus && paired) {
      const hand = slot === 'weapon' ? 'main hand' : 'off hand';
      for (const m of bonus.mods) out.push(contentMod(m, `${label} (${hand})`, origin('handBonus')));
    }
  }

  // A weapon too big for the hands holding it is slow. An ordinary
  // attackSpeed modifier, so it converges with every other speed source.
  const oversize = oversizeOf(state, levels);
  if (oversize > 0) {
    out.push(
      statMod(
        'attackSpeed',
        'mult',
        -OVERSIZE_SPEED_PER_STEP * oversize,
        `Oversized by ${oversize} step${oversize === 1 ? '' : 's'}`,
      ),
    );
  }
  // One too small is weak.
  const undersize = undersizeSteps(worn, rank);
  if (undersize > 0) {
    out.push(
      statMod(
        'damage',
        'mult',
        -Math.min(0.9, UNDERSIZE_DAMAGE_PER_STEP * undersize),
        `Undersized by ${undersize} step${undersize === 1 ? '' : 's'}`,
      ),
    );
  }
  return out;
}

// ---- changes ----

function nextUid(state: ItemsState): number {
  state.uidCounter += 1;
  return state.uidCounter;
}

/**
 * Place an item in a slot when the slot is empty, the requirements hold, the
 * body has the hand and the arms budget has room. The old `wearIfFree`. The
 * caller touches the worn source.
 */
function wearHeld(ctx: Ctx<ItemsState>, slot: SlotId, item: ItemInstance): boolean {
  const state = ctx.state;
  const def = itemDefOf(item);
  if (!def || state.equipment[slot] || !canEquip(ctx, item) || wieldScale(def, slot) <= 0) return false;
  const hand = HAND_SLOTS.indexOf(slot);
  if (hand >= 0) {
    const grants = grantsOf(state);
    const arms = armsFrom(grants);
    if (hand >= Math.max(BASE_ARMS, arms)) return false;
    if (armsUsed(state.equipment, grants) + armCost(grants, def, slot) > arms) return false;
  }
  state.equipment[slot] = item;
  return true;
}

function logOf(ctx: Ctx<ItemsState>, id: string, params: Record<string, unknown>, kind: string): void {
  ctx.emit(logLine, { msg: fillText(TEXT[id], params), kind });
}

// ---- commands ----

/**
 * Equip an item from the pack, into its usual slot or a named one. What is
 * turned out goes back to the pack: the piece in the target slot, and held
 * pieces until the arms budget fits the newcomer.
 */
export const equipItem = defineCommand<{ uid: number; slot?: SlotId }>('items/equip');

/** Take the piece in a slot off, into the pack. */
export const unequipSlot = defineCommand<{ slot: SlotId }>('items/unequip');

/** Take a kept item out of the stronghold stash into the pack, under a new uid. */
export const takeFromStash = defineCommand<{ index: number }>('items/take-from-stash');

/**
 * Sell items from the pack as one transaction: one log line for the lot,
 * `gold:earned` bumped by the take. Socketed runes go back to the pile. A
 * uid no longer held is passed over. The old `sellItems`.
 */
export const sellItems = defineCommand<{ uids: number[] }>('items/sell');

// ---- selling ----

/**
 * Charisma-aware sell price of one item: its worth times the seller's gold
 * gain, rounded, at least 1. The old `sellPrice`. Callers rendering many rows
 * pass the gold gain they already hold.
 */
export function sellPrice(item: DeepReadonly<Pick<ItemInstance, 'defId' | 'affix' | 'slots'>>, goldGain: number): number {
  return Math.max(1, Math.round(itemValue(item as ItemInstance) * goldGain));
}

/** The old `saleMessage`: one line for the lot, naming a uniform stack. */
function saleMessage(sold: readonly DeepReadonly<ItemInstance>[], total: number): string {
  const first = sold[0];
  if (sold.length === 1) return fillText(TEXT.sold_one, { item: itemName(first), total });
  const uniform = sold.every((i) => itemName(i) === itemName(first));
  return uniform
    ? fillText(TEXT.sold_uniform, { item: itemName(first), count: sold.length, total })
    : fillText(TEXT.sold_mixed, { count: sold.length, total });
}

/**
 * Equip from the pack. The body of the command `items/equip` and of the
 * request `items/equip-now`.
 */
function equipFromPack(ctx: Ctx<ItemsState>, uid: number, slot: SlotId | undefined): CommandResult {
  const state = ctx.state;
  const idx = state.inventory.findIndex((i) => i.uid === uid);
  if (idx < 0) return skipped(`item ${uid} is not in the pack`);
  const item = state.inventory[idx];
  const def = itemDefOf(item);
  if (!def) return skipped(`item "${item.defId}" has no definition`);
  if (!canEquip(ctx, item)) {
    logOf(ctx, 'requirements_unmet', { icon: def.icon, item: itemName(item) }, 'danger');
    return skipped(`requirements not met for ${itemName(item)}: ${condsText(def.requirements)}`);
  }
  const target = slot ?? def.slot;
  if (wieldScale(def, target) <= 0) {
    logOf(ctx, 'wrong_slot', { icon: def.icon, item: itemName(item) }, 'danger');
    return skipped(`${itemName(item)} cannot go in the slot "${target}"`);
  }

  state.inventory.splice(idx, 1);
  const displaced: ItemInstance[] = [];
  const takeOff = (s: SlotId) => {
    const worn = state.equipment[s];
    if (worn) {
      displaced.push(worn);
      delete state.equipment[s];
    }
  };
  takeOff(target);
  // Hands are a budget. What is held gives way, in hand order, until the
  // newcomer fits: the same code for two arms or six, and for a grip
  // that costs one arm or two.
  if (HAND_SLOTS.includes(target)) {
    const grants = grantsOf(state);
    const available = armsFrom(grants);
    const incoming = armCost(grants, def, target);
    for (const other of HAND_SLOTS) {
      if (other === target) continue;
      if (armsUsed(state.equipment, grants) + incoming <= available) break;
      takeOff(other);
    }
  }
  state.equipment[target] = item;
  state.inventory.push(...displaced);
  ctx.touch(WORN_SOURCE);

  const note = wieldNote(def, target);
  logOf(
    ctx,
    'equipped',
    { icon: def.icon, item: itemName(item), note: note ? fillText(TEXT.equip_note, { note }) : '' },
    'item',
  );
  return OK;
}

// ---- requests ----

/**
 * Mint an item into the pack: a new uid and rolled rune slots. `size` is the
 * size of what carried it (left absent at medium). `affixChance` rolls an
 * affix. Draws: one for the slots, one for the affix chance when given, one
 * for the affix when it lands. `plain`: the rolled slots are dropped (the
 * festival's issued weapon). `stash`: minted into the stronghold stash, a
 * keep-marked piece only. `wear`: put on in that slot at once when the slot
 * is free and the piece fits (the rules of `wearIfFree`), else into the
 * pack (a royale cache's lent piece, old `wearIfFree` in `takeCache`).
 * Answers a copy of the instance.
 */
export const grantItem = defineRequest<
  { defId: string; size?: SizeTag; affixChance?: number; plain?: boolean; stash?: boolean; wear?: SlotId },
  ItemInstance
>(
  'items/grant',
);

/** What a festival door holds of the items: the worn gear and the pack. */
export interface HeldItems {
  equipment: Equipment;
  inventory: ItemInstance[];
}

/**
 * Take everything worn and carried off the player (the festival's door, old
 * `holdGear`). Answers copies of what was taken; the pack and the slots are
 * left empty.
 */
export const holdItems = defineRequest<void, HeldItems>('items/hold');

/**
 * Give a held set back (old `returnGear`, ruling 2026-10-30). The `lent`
 * uids are taken back wherever they are. Each held piece goes back into its
 * slot when the slot is empty and the piece fits (`wearIfFree`), otherwise
 * into the pack. The pack becomes the held pack, then the pieces that found
 * no slot, then `extra` (a held sheathed blade with its sheath taken), then
 * what the attempt put in it. Answers how many held pieces went to the pack
 * for want of a slot (with `extra`) and the uid of the weapon in hand after.
 */
export const returnItems = defineRequest<
  { held: HeldItems; lent: number[]; extra: ItemInstance[] },
  { bumped: number; weaponUid: number | null }
>('items/return');

/**
 * Put a forged piece in the pack: a new uid, the class stub as `defId`, no
 * rune slots, medium. The anvil's half of old `forgeOnce`. Answers a copy.
 * Step 3 (smithing).
 */
export const grantForged = defineRequest<{ defId: string; spec: ForgedSpec }, ItemInstance>('items/grant-forged');

/**
 * Put an item on without turning anything out: only into an empty slot,
 * only when its requirements hold, and in a hand only when the body has that
 * hand and the arms budget has room. The item is placed as given, not taken
 * from the pack. False, and nothing placed, when it does not fit.
 */
export const wearIfFree = defineRequest<{ slot: SlotId; item: ItemInstance }, boolean>('items/wear-if-free');

/** Add catalogue runes to the pile. Logs unless `silent`. */
export const grantRune = defineRequest<{ id: string; qty?: number; silent?: boolean }, void>('items/grant-rune');

/** Put a keep-marked item in the stash. False for any other item. */
export const stashItem = defineRequest<{ item: ItemInstance }, boolean>('items/stash');

/** State the body that wears the gear: its capability grants and its size. */
export const setBearer = defineRequest<Bearer, void>('items/set-bearer');

/**
 * Take a worn item off into the pack, for a caller that needs the outcome in
 * its own handler (a jolt in a fight makes the bearer drop the weapon). The
 * old `unequipSlot` called from `applyBarDamage`. Answers the name of the
 * item's definition, or null when the slot was empty.
 */
export const dropWorn = defineRequest<{ slot: SlotId }, string | null>('items/drop-worn');

/**
 * Equip an item from the pack, for a caller that needs the outcome in its own
 * handler (the weapon rack of floor 0). The same rules and log line as the
 * command `items/equip`. Answers whether it was equipped.
 */
/** Take the wielded weapon out of the hand (a technique grounds, impales or sheathes it). Answers the instance, or null with an empty hand. */
export const takeWeapon = defineRequest<void, ItemInstance | null>('items/take-weapon');
/** Hand back a weapon a technique took: to the weapon hand when it is empty, else to the pack. The old `reclaim`. Answers where it went. */
export const giveBack = defineRequest<{ item: ItemInstance }, 'hand' | 'pack'>('items/give-back');
export const equipNow = defineRequest<{ uid: number; slot?: SlotId }, boolean>('items/equip-now');

/**
 * Socket a rune into a free slot of an item in the pack or worn (step 3,
 * runecarving; the item half of the old `socketRune`). A catalogue id is
 * taken from the pile; a carving is placed as given and the caller removes
 * it from its own pile. Answers the item's icon and name, or a reason.
 */
export const socketRune = defineRequest<{ uid: number; ref: RuneRef }, { ok: boolean; reason?: string; icon?: string; item?: string }>(
  'items/socket',
);
/**
 * Pry the rune at `index` out of an item (the item half of the old
 * `unsocketRune`). A catalogue rune goes back on the pile, silently; a
 * carving is answered to the caller. Null when there is no such rune.
 */
export const unsocketRune = defineRequest<{ uid: number; index: number }, { ref: RuneRef } | null>('items/unsocket');
/** Take catalogue runes off the pile for a sale or a discard: one, or the whole pile with `all`. Answers how many were taken. */
export const takeRune = defineRequest<{ id: string; all?: boolean }, number>('items/take-rune');
/** The carvings a sale pried out of sold items. `runecarving` puts them back on its pile (old `sellItems`). */
export const carvingsFreed = defineEvent<{ carvings: CarvedRune[] }>('items/carvings-freed');

// ---- view ----

export interface ItemFact {
  /** Empty for a line with no label. */
  label: string;
  fact: string;
}

export interface EquipOption {
  slot: SlotId;
  slotName: string;
  /** Why the item is at less than full effect there. Empty at full effect. */
  note: string;
  /** Against the piece worn in that slot. Null when the slot is empty. */
  compare: { wornName: string; lines: DeltaLine[]; conditional: boolean } | null;
}

export interface ItemRow {
  uid: number;
  defId: string;
  name: string;
  /** Emoji. The fallback when the icon file named by `art` is absent. */
  icon: string;
  art: string | null;
  slot: SlotId | null;
  slotName: string;
  affix?: { name: string };
  slots: number;
  runes: RuneRef[];
  size?: SizeTag;
  /** A forged piece's parts and grade (step 3, smithing): read by `itemDefOf` and `stackKey` on the row. */
  forged?: ForgedSpec;
  rarity: RarityId;
  /** Worth before the seller's gold gain. */
  value: number;
  /** What `items/sell` pays for it now. */
  sell: number;
  category: string;
  facts: ItemFact[];
  canEquip: boolean;
  /** The requirements in words. Empty when there are none. */
  requires: string;
  /** Slots it may go in, best fit first. Empty for a worn row. */
  options: EquipOption[];
}

export interface SlotRow {
  slot: SlotId;
  name: string;
  item: ItemRow | null;
  /** Name of the two-handed weapon that leaves this hand no arm. */
  takenBy: string | null;
  /** Why the worn piece is at less than full effect here. */
  note: string;
}

export interface ItemsView {
  /** Every slot the body has, in slot order, filled or not. */
  slots: SlotRow[];
  /** The pack, in the order items arrived. */
  inventory: ItemRow[];
  /** Whether runecarving is open: rune slots show only then. */
  runesOpen: boolean;
  runes: { id: string; name: string; icon: string; qty: number }[];
  stash: ItemRow[];
  arms: number;
}

/** "+3 Damage" as label "Damage", fact "+3". */
function modFact(text: string, suffix = ''): ItemFact {
  const parts = /^([+−]\S+) (.+)$/.exec(text);
  return parts ? { label: parts[2], fact: parts[1] + suffix } : { label: '', fact: text + suffix };
}

function factsOf(item: DeepReadonly<ItemInstance>, def: ItemDef, runesOpen: boolean): ItemFact[] {
  const facts: ItemFact[] = [{ label: 'Slot', fact: SLOT_NAMES[def.slot] }];
  if (HAND_SLOTS.includes(def.slot)) facts.push({ label: 'Wield', fact: WIELD_NAMES[wieldOf(def)] });
  if (sizeRank(item.size) !== sizeRank('medium')) facts.push({ label: 'Size', fact: SIZE_LADDER[sizeRank(item.size)] });
  for (const mod of def.mods) facts.push(modFact(describeMod(mod)));
  for (const mod of item.affix?.mods ?? []) facts.push(modFact(describeMod(mod), ` (${item.affix!.name})`));
  if (def.mainHand) facts.push({ label: 'Main hand', fact: def.mainHand.desc });
  if (def.offHand) facts.push({ label: 'Off hand', fact: def.offHand.desc });
  if (def.bonusDamage) facts.push({ label: 'Bonus damage', fact: `${def.bonusDamage.value} ${def.bonusDamage.type}` });
  if (def.damageType) facts.push({ label: 'Damage type', fact: def.damageType });
  if (def.requirements?.length) facts.push({ label: 'Requires', fact: condsText(def.requirements) });
  if (runesOpen) {
    facts.push({ label: 'Rune slots', fact: String(item.slots ?? 0) });
    for (const ref of item.runes ?? []) facts.push({ label: 'Rune', fact: resolveRune(ref).name });
  }
  if (def.keep) facts.push({ label: 'Kept', fact: 'through prestige, in the stronghold stash' });
  // Through the display formatter: an affix multiplies the value by 1.5 and a
  // product such as 8.8 x 1.5 is not a short decimal as a float.
  facts.push({ label: 'Value', fact: fmt(itemValue(item)) });
  if (def.desc) facts.push({ label: '', fact: def.desc });
  return facts;
}

function rowOf(
  ctx: ReadCtx,
  state: State,
  item: DeepReadonly<ItemInstance>,
  runesOpen: boolean,
  withOptions: boolean,
): ItemRow {
  const def = itemDefOf(item);
  const rank = wielderRank(state);
  const options: EquipOption[] = [];
  if (def && withOptions) {
    for (const slot of allowedSlots(def, armsFrom(grantsOf(state)))) {
      const cmp = compareToWorn(state.equipment, item, slot, runesOpen, rank);
      options.push({
        slot,
        slotName: SLOT_NAMES[slot],
        note: wieldNote(def, slot),
        compare: cmp && { wornName: itemName(cmp.worn), lines: cmp.lines, conditional: cmp.conditional },
      });
    }
  }
  return {
    uid: item.uid,
    defId: item.defId,
    name: itemName(item),
    icon: def?.icon ?? '',
    art: def?.art ?? null,
    slot: def?.slot ?? null,
    slotName: def ? SLOT_NAMES[def.slot] : '',
    ...(item.affix ? { affix: { name: item.affix.name } } : {}),
    slots: item.slots ?? 0,
    runes: (item.runes ?? []).map((ref) => cloneJson(ref) as RuneRef),
    ...(item.size ? { size: item.size } : {}),
    ...(item.forged ? { forged: cloneJson(item.forged) as ForgedSpec } : {}),
    rarity: itemRarity(item),
    value: itemValue(item),
    sell: sellPrice(item, statOf(ctx, 'goldGain')),
    category: itemCategory(item).label,
    facts: def ? factsOf(item, def, runesOpen) : [],
    canEquip: canEquip(ctx, item),
    requires: condsText(def?.requirements),
    options,
  };
}

// ---- the declaration ----

const system: SystemDef<ItemsState, ItemsView> = defineSystem<ItemsState, ItemsView>({
  id: 'items',
  version: 1,
  migrations,
  // The rusty sword starts in the pack, not equipped: the weapon rack of
  // floor 0 equips it or one of the three beside it.
  initial: () => ({
    uidCounter: 1,
    inventory: [{ uid: 1, defId: 'rusty_sword', slots: 1, runes: [] }],
    equipment: {},
    runes: {},
    stash: [],
    bearer: { grants: [], size: 'medium' },
  }),
  content: { items: itemRegistry, affixes: affixRegistry, runes: runeRegistry, items_text: itemsText },

  modifiers: [
    {
      id: WORN_SOURCE,
      dependsOn: ['skills/effects'],
      collect: (ctx) => {
        if (ctx.entity !== PLAYER) return [];
        const held = ctx.read(skills);
        return wornMods(ctx.state, (id) => skillLevel(held, id));
      },
    },
  ],

  commands: [
    handle(equipItem, (ctx, { uid, slot }) => equipFromPack(ctx, uid, slot)),

    handle(unequipSlot, (ctx, { slot }) => {
      const item = ctx.state.equipment[slot];
      if (!item) return skipped(`nothing is worn in the slot "${slot}"`);
      delete ctx.state.equipment[slot];
      ctx.state.inventory.push(item);
      ctx.touch(WORN_SOURCE);
      return OK;
    }),

    handle(takeFromStash, (ctx, { index }) => {
      const item = ctx.state.stash[index];
      if (!item) return skipped(`the stash holds no item at index ${index}`);
      if (factValue(ctx, FESTIVAL_HOLDS_FACT) > 0) return skipped('the stash is shut during a festival attempt');
      ctx.state.stash.splice(index, 1);
      // Uids restart with every run, so the one it was stored under may be taken.
      const taken: ItemInstance = { ...item, uid: nextUid(ctx.state) };
      ctx.state.inventory.push(taken);
      const def = itemDefOf(taken);
      logOf(ctx, 'stash_taken', { icon: def?.icon ?? '', name: def?.name ?? taken.defId }, 'item');
      return OK;
    }),

    handle(sellItems, (ctx, { uids }) => {
      const state = ctx.state;
      const goldGain = statOf(ctx, 'goldGain');
      const sold: ItemInstance[] = [];
      const freed: CarvedRune[] = [];
      let total = 0;
      let lent = 0;
      for (const uid of uids) {
        // The Vermin Festival lends its weapon, and the royale's finds, for the
        // attempt and takes them back.
        if (factValue(ctx, festivalLentFact(uid)) > 0) {
          lent += 1;
          logOf(ctx, 'issued_unsold', {}, 'danger');
          continue;
        }
        const idx = state.inventory.findIndex((i) => i.uid === uid);
        if (idx < 0) continue;
        const item = state.inventory[idx];
        total += sellPrice(item, goldGain);
        state.inventory.splice(idx, 1);
        // Socketed runes are pried out and kept: selling never destroys them.
        // A carving is one of a kind, so it goes back to the carved pile.
        for (const ref of item.runes ?? []) {
          if (typeof ref === 'string') state.runes[ref] = (state.runes[ref] ?? 0) + 1;
          else freed.push(ref);
        }
        sold.push(item);
      }
      if (sold.length === 0) {
        return skipped(lent > 0 ? 'the festival lends those items for the attempt: they cannot be sold' : 'none of the listed items is in the pack');
      }
      if (freed.length) ctx.emit(carvingsFreed, { carvings: freed });
      ctx.request(addGold, { amount: total, earned: true });
      ctx.emit(logLine, { msg: saleMessage(sold, total), kind: 'item' });
      return OK;
    }),
  ],

  requests: [
    answer(grantItem, (ctx, { defId, size, affixChance, plain = false, stash = false, wear }) => {
      // A `forged:<class>` id is a class stub with no numbers of its own:
      // minted, it becomes the class's exemplar at Fair grade, with no rune
      // slots (old `createItem`).
      const exemplar = forgedExemplarOf(defId);
      if (exemplar) {
        const minted: ItemInstance = { uid: nextUid(ctx.state), defId, slots: 0, runes: [], size: 'medium', forged: exemplar };
        ctx.state.inventory.push(minted);
        return cloneJson(minted) as ItemInstance;
      }
      const def = itemDefOf({ defId });
      const item: ItemInstance = {
        uid: nextUid(ctx.state),
        defId,
        slots: def ? rollRuneSlots(ctx.rng, def) : 0,
        runes: [],
      };
      if (size !== undefined && sizeRank(size) !== sizeRank('medium')) item.size = size;
      if (affixChance !== undefined && ctx.rng.chance(affixChance)) {
        item.affix = affixOfId(AFFIX_LIST[ctx.rng.int(AFFIX_LIST.length)].id);
      }
      // A plain issue (the festival's weapon): the slots are rolled as for any
      // grant, then dropped, as the old `{ ...createItem(), slots: 0, runes: [] }`.
      if (plain) item.slots = 0;
      // Minted into the stronghold stash (a festival token's regalia, old
      // `stashItem(createItem())`): a keep-marked piece only.
      if (stash) {
        if (keepMarked(item)) ctx.state.stash.push(item);
      } else if (wear !== undefined && wearHeld(ctx, wear, item)) {
        ctx.touch(WORN_SOURCE);
      } else {
        ctx.state.inventory.push(item);
      }
      return cloneJson(item) as ItemInstance;
    }),

    answer(holdItems, (ctx) => {
      const state = ctx.state;
      const held: HeldItems = { equipment: cloneJson(state.equipment) as Equipment, inventory: cloneJson(state.inventory) as ItemInstance[] };
      state.equipment = {};
      state.inventory = [];
      ctx.touch(WORN_SOURCE);
      return held;
    }),

    answer(returnItems, (ctx, { held, lent, extra }) => {
      const state = ctx.state;
      const lentSet = new Set(lent);
      for (const [slot, item] of Object.entries(state.equipment) as [SlotId, ItemInstance | undefined][]) {
        if (item && lentSet.has(item.uid)) delete state.equipment[slot];
      }
      const gained = state.inventory.filter((i) => !lentSet.has(i.uid));
      const back = cloneJson(held) as HeldItems;
      const bumped: ItemInstance[] = [];
      for (const [slot, item] of Object.entries(back.equipment) as [SlotId, ItemInstance | undefined][]) {
        if (item && !wearHeld(ctx, slot, item)) bumped.push(item);
      }
      state.inventory = [...back.inventory, ...bumped, ...(cloneJson(extra) as ItemInstance[]), ...gained];
      ctx.touch(WORN_SOURCE);
      return { bumped: bumped.length + extra.length, weaponUid: state.equipment.weapon?.uid ?? null };
    }),

    answer(grantForged, (ctx, { defId, spec }) => {
      const item: ItemInstance = {
        uid: nextUid(ctx.state),
        defId,
        slots: 0,
        runes: [],
        size: 'medium',
        forged: cloneJson(spec) as ForgedSpec,
      };
      ctx.state.inventory.push(item);
      return cloneJson(item) as ItemInstance;
    }),

    answer(wearIfFree, (ctx, { slot, item }) => {
      if (!wearHeld(ctx, slot, cloneJson(item) as ItemInstance)) return false;
      ctx.touch(WORN_SOURCE);
      return true;
    }),

    answer(socketRune, (ctx, { uid, ref }) => {
      const state = ctx.state;
      const item =
        state.inventory.find((i) => i.uid === uid) ?? Object.values(state.equipment).find((i) => i?.uid === uid) ?? null;
      if (!item) return { ok: false, reason: `no item has the uid ${uid}` };
      const runes = (item.runes ??= []);
      if (runes.length >= (item.slots ?? 0)) return { ok: false, reason: `${itemName(item)} has no free rune slot` };
      if (typeof ref === 'string') {
        if (!RUNES[ref] || (state.runes[ref] ?? 0) <= 0) return { ok: false, reason: `no rune "${ref}" is held` };
        state.runes[ref] -= 1;
        if (state.runes[ref] <= 0) delete state.runes[ref];
        runes.push(ref);
      } else {
        runes.push(cloneJson(ref) as CarvedRune);
      }
      if (Object.values(state.equipment).includes(item)) ctx.touch(WORN_SOURCE);
      const def = itemDefOf(item);
      return { ok: true, icon: def?.icon ?? '', item: def?.name ?? item.defId };
    }),

    answer(unsocketRune, (ctx, { uid, index }) => {
      const state = ctx.state;
      const item =
        state.inventory.find((i) => i.uid === uid) ?? Object.values(state.equipment).find((i) => i?.uid === uid) ?? null;
      const ref = item?.runes?.[index];
      if (!item || !ref) return null;
      item.runes!.splice(index, 1);
      if (Object.values(state.equipment).includes(item)) ctx.touch(WORN_SOURCE);
      // A catalogue rune goes back to the pile, as the old silent `grantRune`.
      if (typeof ref === 'string') state.runes[ref] = (state.runes[ref] ?? 0) + 1;
      return { ref: cloneJson(ref) as RuneRef };
    }),

    answer(takeRune, (ctx, { id, all = false }) => {
      const held = ctx.state.runes[id] ?? 0;
      if (held <= 0) return 0;
      const take = all ? held : 1;
      ctx.state.runes[id] = held - take;
      if (ctx.state.runes[id] <= 0) delete ctx.state.runes[id];
      return take;
    }),

    answer(grantRune, (ctx, { id, qty = 1, silent = false }) => {
      ctx.state.runes[id] = (ctx.state.runes[id] ?? 0) + qty;
      if (silent) return;
      const rune = RUNES[id];
      logOf(
        ctx,
        'rune_found',
        { icon: rune?.icon ?? '🔮', name: rune?.name ?? id, qty: qty > 1 ? fillText(TEXT.times, { qty }) : '' },
        'loot',
      );
    }),

    answer(stashItem, (ctx, { item }) => {
      if (!keepMarked(item)) return false;
      ctx.state.stash.push(cloneJson(item) as ItemInstance);
      return true;
    }),

    answer(dropWorn, (ctx, { slot }) => {
      const item = ctx.state.equipment[slot];
      if (!item) return null;
      delete ctx.state.equipment[slot];
      ctx.state.inventory.push(item);
      ctx.touch(WORN_SOURCE);
      return itemDefOf(item)?.name ?? null;
    }),
    answer(setBearer, (ctx, { grants, size }) => {
      ctx.state.bearer = { grants: [...grants], size };
      ctx.touch(WORN_SOURCE);
    }),
    answer(equipNow, (ctx, { uid, slot }) => equipFromPack(ctx, uid, slot).ok),
    answer(takeWeapon, (ctx) => {
      const item = ctx.state.equipment.weapon;
      if (!item) return null;
      delete ctx.state.equipment.weapon;
      ctx.touch(WORN_SOURCE);
      return cloneJson(item) as ItemInstance;
    }),
    answer(giveBack, (ctx, { item }) => {
      // No requirement check: the old `reclaim` put the blade back as it was.
      if (!ctx.state.equipment.weapon) {
        ctx.state.equipment.weapon = cloneJson(item) as ItemInstance;
        ctx.touch(WORN_SOURCE);
        return 'hand';
      }
      ctx.state.inventory.push(cloneJson(item) as ItemInstance);
      return 'pack';
    }),
  ],

  // A prestige keeps the stronghold stash: keep-marked items come back to it
  // from the pack and the worn gear (old `prestigeNow` with `carriedStash`).
  newRun: (ctx, previous) => {
    ctx.state.stash = carriedStash(previous(system));
  },

  view: (ctx) => {
    const state = ctx.state;
    const runesOpen = hasFlag(ctx.read(counters), RUNECARVING_FLAG);
    const grants = grantsOf(state);
    const arms = armsFrom(grants);
    // The hands the body has, any further hand that holds something, then the armour slots.
    const shown = SLOT_IDS.filter((slot) => {
      const hand = HAND_SLOTS.indexOf(slot);
      return hand < 0 || hand < Math.max(BASE_ARMS, arms) || !!state.equipment[slot];
    });
    return {
      slots: shown.map((slot) => {
        const item = state.equipment[slot];
        const def = item ? itemDefOf(item) : undefined;
        const taken = handTakenBy(state.equipment, grants, slot);
        return {
          slot,
          name: SLOT_NAMES[slot],
          item: item ? rowOf(ctx, state, item, runesOpen, false) : null,
          takenBy: taken ? itemName(taken) : null,
          note: def ? wieldNote(def, slot) : '',
        };
      }),
      inventory: state.inventory.map((item) => rowOf(ctx, state, item, runesOpen, true)),
      runesOpen,
      runes: RUNE_LIST.filter((r) => (state.runes[r.id] ?? 0) > 0).map((r) => ({
        id: r.id,
        name: r.name,
        icon: r.icon,
        qty: state.runes[r.id],
      })),
      stash: state.stash.map((item) => rowOf(ctx, state, item, runesOpen, false)),
      arms,
    };
  },
});

export default system;
