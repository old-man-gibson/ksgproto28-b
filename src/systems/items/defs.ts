/**
 * Item content and the types of an item. Port of the item types of the old
 * `types.ts`, of `data/items.data.ts` and of the catalogue of
 * `data/runes.data.ts`.
 */
import { registry, s, type DeepReadonly, type RecordOf } from '../../kernel';
import { conditionSchema, type Condition } from '../counters';
import type { QualityTier } from '../materials';
import { DAMAGE_TYPES, modifierSchema, type ContentMod, type DamageType } from '../stats';
import affixesData from './content/affixes.json';
import itemsData from './content/items.json';
import runesData from './content/runes.json';

// ---- slots ----

export const SLOT_IDS = [
  'weapon',
  'offhand',
  // Arms past the usual two, for a body that grew some (`arms:+N`). They
  // behave like the off hand and are absent on an ordinary body.
  'hand3',
  'hand4',
  'hand5',
  'hand6',
  'head',
  'chest',
  'hands',
  'legs',
  'feet',
  'back',
  'accessory',
] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export const SLOT_NAMES: Record<SlotId, string> = {
  weapon: 'Weapon',
  offhand: 'Offhand',
  hand3: 'Third Hand',
  hand4: 'Fourth Hand',
  hand5: 'Fifth Hand',
  hand6: 'Sixth Hand',
  head: 'Head',
  chest: 'Chest',
  hands: 'Hands',
  legs: 'Legs',
  feet: 'Feet',
  back: 'Back',
  accessory: 'Accessory',
};

// ---- size ----

/** The size ladder, smallest first. An index into it is a size; the gap between two is the steps apart. */
export const SIZE_LADDER = [
  'diminutive',
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
  'colossal',
] as const;
export type SizeTag = (typeof SIZE_LADDER)[number];

/** Where a size sits on the ladder. Anything not on it reads as medium. */
export function sizeRank(size: string | undefined): number {
  const i = SIZE_LADDER.indexOf(size as SizeTag);
  return i === -1 ? SIZE_LADDER.indexOf('medium') : i;
}

// ---- wield classes ----

/**
 * How a held item occupies the hands.
 * - `light`: either hand, no penalty.
 * - `one_handed`: made for the main hand; reduced effect in an off hand.
 * - `two_handed`: fills both hands.
 * - `offhand`: shields, focuses, parrying blades. Reduced effect in the main
 *   hand unless the item declares a `mainHand` bonus.
 */
export const WIELD_CLASSES = ['light', 'one_handed', 'two_handed', 'offhand'] as const;
export type WieldClass = (typeof WIELD_CLASSES)[number];

// ---- runes ----

export const RUNE_SIZE_CLASSES = ['small', 'medium', 'large'] as const;
export type RuneSizeClass = (typeof RUNE_SIZE_CLASSES)[number];

export const RUNE_CONTEXTS = ['weapon', 'armor', 'accessory'] as const;
export type RuneContext = (typeof RUNE_CONTEXTS)[number];

/** Which rune-effect context an equipment slot gives. The off hand counts as armor. */
export function runeContextFor(slot: SlotId): RuneContext {
  if (slot === 'weapon') return 'weapon';
  if (slot === 'accessory') return 'accessory';
  return 'armor';
}

/** A material at a grade, as a carving stores it. `quality` is a quality tier. */
export interface CarvedPart {
  id: string;
  quality: QualityTier;
}

/**
 * A rune the player carved: its combination, never its results. The old
 * `CarvedRune`. Composed into a `RuneDef` by the hooks `runecarving`
 * registers (step 3, runecarving).
 */
export interface CarvedRune {
  patterns: string[];
  stone: CarvedPart;
  adornments: CarvedPart[];
}

/** A socketed rune: a catalogue id or a carving. */
export type RuneRef = string | CarvedRune;

/** What the Rune Table hands the item rules. Registered by `runecarving` at module load. */
export interface CarvingHooks {
  /** The rune a carving composes to (old `composeCarved`). */
  compose(rune: DeepReadonly<CarvedRune>): RuneDef;
  /** The canonical string of a carving (old `carvedKey`). */
  key(rune: DeepReadonly<CarvedRune>): string;
}

let carving: CarvingHooks | null = null;

/** Called once by `runecarving` at module load. */
export function registerCarving(hooks: CarvingHooks): void {
  carving = hooks;
}

/** Whether a reference is a carving rather than a catalogue id. The old `isCarved`. */
export function isCarved(ref: RuneRef | DeepReadonly<RuneRef>): ref is CarvedRune {
  return typeof ref !== 'string';
}

/**
 * A rune reference as one canonical string: a catalogue id as written, a
 * carving through its key. The old `runeRefKey`.
 */
export function runeRefKey(ref: RuneRef | DeepReadonly<RuneRef>): string {
  if (typeof ref === 'string') return ref;
  return carving ? carving.key(ref) : 'carved';
}

/** One typed on-hit damage rider. */
export interface RuneRider {
  type: DamageType;
  value: number;
}

/** A rider field read as a list: one authored rider, a composed list, or none. The old `runeRiders`. */
export function runeRiders(x: RuneRider | readonly RuneRider[] | DeepReadonly<RuneRider | RuneRider[]> | undefined): RuneRider[] {
  if (!x) return [];
  return (Array.isArray(x) ? x : [x]) as RuneRider[];
}

const bonusDamageSchema = s.object({ type: s.enum(DAMAGE_TYPES), value: s.number() });

const runes = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Icon name. The file is not in the repository.' })),
    desc: s.optional(s.string()),
    value: s.number({ help: 'Sell value of one rune.' }),
    /** One entry per context the rune does something in. Read by runecarving, which is not ported. */
    effects: s.array(
      s.object({
        context: s.enum(RUNE_CONTEXTS),
        mods: s.optional(s.array(modifierSchema)),
        bonusDamage: s.optional(bonusDamageSchema),
        bonusDamagePct: s.optional(bonusDamageSchema),
        techniqueMods: s.optional(
          s.array(
            s.object({
              technique: s.string({ help: 'Technique id. A plain string until the martial registry exists.' }),
              rename: s.optional(s.string()),
              cooldownMult: s.optional(s.number()),
              damageMult: s.optional(s.number()),
              exitTo: s.optional(s.string({ help: 'Position id. A plain string until the martial registry exists.' })),
              grantsFork: s.optional(s.string({ help: 'Technique id.' })),
            }),
          ),
        ),
      }),
    ),
  }),
  runesData,
  'Runes',
);
export { runes as runeRegistry };
type AuthoredRuneEffect = RecordOf<typeof runes>['effects'][number];
/** A rune's effect in one context. A composed carving may carry several riders of different types. */
export type RuneEffect = Omit<AuthoredRuneEffect, 'bonusDamage' | 'bonusDamagePct'> & {
  bonusDamage?: RuneRider | RuneRider[];
  bonusDamagePct?: RuneRider | RuneRider[];
};
export type RuneDef = Omit<RecordOf<typeof runes>, 'effects'> & { effects: RuneEffect[] };

export const RUNE_LIST = runesData as unknown as RuneDef[];
export const RUNES: Record<string, RuneDef> = Object.fromEntries(RUNE_LIST.map((r) => [r.id, r]));

/** What a reference that resolves to nothing reads as. */
const INERT_RUNE: RuneDef = { id: 'unknown', name: 'Worn Rune', icon: '🔘', value: 1, effects: [] };

/**
 * The one door every reader of a rune goes through. A catalogue rune is a
 * lookup; a carving is composed from its combination by the hooks of
 * `runecarving` (memoised there). Without the hooks a carving is inert.
 */
export function resolveRune(ref: RuneRef | DeepReadonly<RuneRef> | undefined): RuneDef {
  if (!ref) return INERT_RUNE;
  if (typeof ref !== 'string') return carving ? carving.compose(ref) : INERT_RUNE;
  return RUNES[ref] ?? INERT_RUNE;
}

/** The effect a rune gives in a context. Undefined: it does nothing there. */
export function runeEffectAt(ref: RuneRef | DeepReadonly<RuneRef> | undefined, context: RuneContext): RuneEffect | undefined {
  return resolveRune(ref).effects.find((e) => e.context === context);
}

// ---- affixes ----

const affixes = registry(
  s.object({
    id: s.id(),
    name: s.string({ help: 'Prefix of the item name: "Sharp" in "Sharp Iron Sword".' }),
    mods: s.array(modifierSchema),
  }),
  affixesData,
  'Affixes',
);
export { affixes as affixRegistry };
export type AffixDef = RecordOf<typeof affixes>;

/** Affixes a drop may roll, in the order the drop code indexes. */
export const AFFIX_LIST = affixesData as unknown as AffixDef[];
export const AFFIXES: Record<string, AffixDef> = Object.fromEntries(AFFIX_LIST.map((a) => [a.id, a]));

/**
 * An affix as an item instance carries it: a copy of the name and the
 * modifiers, as in the old build. A later change to the registry does not
 * change an item that already dropped.
 */
export interface Affix {
  name: string;
  mods: ContentMod[];
}

/** The copy of a registry affix an instance carries. */
export function affixOfId(id: string): Affix {
  const def = AFFIXES[id];
  return { name: def.name, mods: def.mods.map((m) => ({ ...m })) };
}

// ---- items ----

/**
 * A bonus an item gives only in one hand, and with `pairedWith` only while
 * the other hand carries an item with that tag. Never scaled down.
 */
const handBonusSchema = s.object({
  pairedWith: s.optional(s.string({ help: 'Tag the item in the other hand must carry.' })),
  desc: s.string({ help: 'Tooltip line.' }),
  mods: s.array(modifierSchema),
});

const items = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string({ help: 'Emoji. Shown when the icon file is absent.' }),
    art: s.optional(s.string({ help: 'Icon name. The file is not in the repository.' })),
    slot: s.enum(SLOT_IDS),
    wield: s.optional(
      s.enum(WIELD_CLASSES, { help: 'Hand items only. Default: one-handed in the weapon slot, off-hand in the off hand.' }),
    ),
    mainHand: s.optional(handBonusSchema),
    offHand: s.optional(handBonusSchema),
    tags: s.array(s.string()),
    mods: s.array(modifierSchema),
    value: s.number(),
    desc: s.optional(s.string()),
    requirements: s.optional(s.array(conditionSchema, { help: 'Conditions to equip.' })),
    bonusDamage: s.optional(bonusDamageSchema),
    damageType: s.optional(s.enum(DAMAGE_TYPES, { help: 'Overrides the damage type the family tag implies.' })),
    runeClass: s.optional(s.enum(RUNE_SIZE_CLASSES, { help: 'Rune-slot size class. Inferred when absent.' })),
    keep: s.optional(s.boolean({ help: 'Kept through prestige in the stronghold stash.' })),
  }),
  itemsData,
  'Items',
);
export { items as itemRegistry };

type RawItem = RecordOf<typeof items>;

export interface HandBonus {
  pairedWith?: string;
  desc: string;
  mods: ContentMod[];
}

/** One item record. The fields the schema types loosely are narrowed here. */
export type ItemDef = Omit<RawItem, 'requirements' | 'bonusDamage' | 'damageType'> & {
  requirements?: Condition[];
  bonusDamage?: { type: DamageType; value: number };
  damageType?: DamageType;
};

export const ITEM_LIST = itemsData as unknown as ItemDef[];
export const ITEMS: Record<string, ItemDef> = Object.fromEntries(ITEM_LIST.map((def) => [def.id, def]));

// ---- instances ----

export interface ItemInstance {
  uid: number;
  defId: string;
  affix?: Affix;
  /** Rune slots rolled at generation, 0 to 4. Absent reads as 0. */
  slots?: number;
  /** Socketed runes, at most `slots` long. */
  runes?: RuneRef[];
  /** How big this one is. Absent reads as medium. A property of the specimen, not of the design. */
  size?: SizeTag;
  /**
   * Set on an item built at the anvil: the parts and the grade. Everything
   * else about it (class, mods, value, requirements) is derived from this on
   * read (`itemDefOf`), and `defId` is only the class stub `forged:<class>`.
   * Step 3 (smithing).
   */
  forged?: ForgedSpec;
}

// ---- forged items (step 3, smithing) ----

/** A placed part as a forged item stores it: its slot is explicit. The old `ForgedPart`. */
export interface ForgedPart {
  slot: string;
  kind: string;
  mat: string;
  qty?: number;
}

/** The stored form of a forged item. `q` is a quality tier. The old `ForgedSpec`. */
export interface ForgedSpec {
  parts: ForgedPart[];
  q: string;
}

/** What the anvil hands the item rules. Registered by `smithing` at module load. */
export interface ForgingHooks {
  /** The definition derived from the parts and the grade (old `forgedDef`). */
  defOf(spec: DeepReadonly<ForgedSpec>): ItemDef;
  /** The canonical string of the parts and the grade (old `forgeKey`). */
  keyOf(spec: DeepReadonly<ForgedSpec>): string;
  /** The exemplar at Fair grade of a `forged:<class>` id, else undefined (old `createItem` of a stub). */
  exemplarOf(defId: string): ForgedSpec | undefined;
}

let forging: ForgingHooks | null = null;

/**
 * Register the anvil. `stubs` are the `forged:<class>` records, one per item
 * class, with no numbers: they go into `ITEMS`, as the old registry generated
 * them, so a lookup by id lands on the right slot, hands and tags. `items`
 * cannot import `smithing`, which imports `items`.
 */
export function registerForging(hooks: ForgingHooks, stubs: readonly ItemDef[]): void {
  forging = hooks;
  for (const stub of stubs) ITEMS[stub.id] = stub;
}

/** The forge key of a forged item (parts and grade), or '' for any other. */
export function forgeKeyOf(item: { readonly forged?: DeepReadonly<ForgedSpec> }): string {
  return item.forged && forging ? forging.keyOf(item.forged) : '';
}

/** The forged spec a `forged:<class>` id mints (its exemplar at Fair), or undefined. */
export function forgedExemplarOf(defId: string): ForgedSpec | undefined {
  return forging?.exemplarOf(defId);
}

/** What `itemDefOf` reads of an instance. */
export type ItemRef = Pick<ItemInstance, 'defId'> & { readonly forged?: DeepReadonly<ForgedSpec> };

/**
 * The definition of an item instance. Every read of an item's mods, value,
 * name, requirements, tags, wield or bonus damage goes through here and never
 * through `ITEMS[item.defId]`. A forged item's definition is derived from its
 * parts and grade (old `assembly.ts` `itemDefOf`).
 */
export function itemDefOf(item: ItemRef): ItemDef | undefined {
  return item.forged && forging ? forging.defOf(item.forged) : ITEMS[item.defId];
}

export function itemName(item: ItemRef & { readonly affix?: { readonly name: string } }): string {
  const def = itemDefOf(item);
  const base = def ? def.name : item.defId;
  return item.affix ? `${item.affix.name} ${base}` : base;
}

/** An affix is worth half again the base item. */
export const AFFIX_VALUE_MULT = 1.5;
/** Each rolled rune slot adds this share of the base item's worth. */
export const RUNE_SLOT_VALUE_MULT = 0.3;

/**
 * What an item is worth before the seller's gold gain. Socketed runes add
 * nothing: a sale pries them out. The slots carry the price.
 */
export function itemValue(item: ItemRef & { readonly affix?: unknown; readonly slots?: number }): number {
  const def = itemDefOf(item);
  // A forged item is worth its parts and nothing else: no affix multiplier, no slot multiplier.
  if (item.forged) return def?.value ?? 1;
  const affix = item.affix ? AFFIX_VALUE_MULT : 1;
  return (def?.value ?? 1) * affix * (1 + RUNE_SLOT_VALUE_MULT * (item.slots ?? 0));
}
