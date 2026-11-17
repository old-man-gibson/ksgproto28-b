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
  defineRequest,
  defineSystem,
  handle,
  OK,
  PLAYER,
  registry,
  skipped,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type SystemDef,
} from '../../kernel';
import counters, { conditionsMet, hasFlag } from '../counters';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import skills, { conditionReader, SKILL_LIST, skillLevel } from '../skills';
import { armedFact, contentMod, factValue, statMod, wieldTagFact, type ModOrigin, type StatMod } from '../stats';
import { compareToWorn, type DeltaLine } from './compare';
import itemsTextData from './content/items_text.json';
import {
  affixOfId,
  affixRegistry,
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
  type ItemDef,
  type ItemInstance,
  type SizeTag,
  type SlotId,
} from './defs';
import { condsText, describeMod } from './format';
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

// ---- requests ----

/**
 * Mint an item into the pack: a new uid and rolled rune slots. `size` is the
 * size of what carried it (left absent at medium). `affixChance` rolls an
 * affix. Draws: one for the slots, one for the affix chance when given, one
 * for the affix when it lands. Answers a copy of the instance.
 */
export const grantItem = defineRequest<{ defId: string; size?: SizeTag; affixChance?: number }, ItemInstance>(
  'items/grant',
);

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
  runes: string[];
  size?: SizeTag;
  rarity: RarityId;
  /** Worth before the seller's gold gain. */
  value: number;
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
  facts.push({ label: 'Value', fact: String(itemValue(item)) });
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
    runes: [...(item.runes ?? [])],
    ...(item.size ? { size: item.size } : {}),
    rarity: itemRarity(item),
    value: itemValue(item),
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
    handle(equipItem, (ctx, { uid, slot }) => {
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
    }),

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
  ],

  requests: [
    answer(grantItem, (ctx, { defId, size, affixChance }) => {
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
      ctx.state.inventory.push(item);
      return cloneJson(item) as ItemInstance;
    }),

    answer(wearIfFree, (ctx, { slot, item }) => {
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
      state.equipment[slot] = cloneJson(item) as ItemInstance;
      ctx.touch(WORN_SOURCE);
      return true;
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
  ],

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
