/**
 * Smithing content and types: the part kinds the anvil places, the item
 * classes a placement resolves to, and the log lines. Port of old
 * `data/parts.data.ts`, `data/itemclasses.data.ts`, `text/itemclasses.text.ts`
 * and the smithing types of `types.ts`. See README.md.
 */
import { registry, s, type RecordOf } from '../../kernel';
import { SLOT_IDS, WIELD_CLASSES, type ForgedPart as StoredPart, type RuneSizeClass, type SlotId, type WieldClass } from '../items';
import { textSchema, type TextRecord } from '../log';
import type { QualityTier } from '../materials';
import { DAMAGE_TYPES, type DamageType } from '../stats';
import classesData from './content/item_classes.json';
import partsData from './content/parts.json';
import textData from './content/smithing_text.json';

export const TEXT: Record<string, string> = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
export const smithingText = registry(textSchema, textData, 'Smithing text');

// ---- parts ----

export const PART_SHAPES = ['edge', 'point', 'mass', 'plate', 'bent', 'ring', 'bar', 'guard', 'cord'] as const;
export type PartShape = (typeof PART_SHAPES)[number];

export const PART_ROLES = ['head', 'haft', 'guard', 'bind'] as const;
export type PartRole = (typeof PART_ROLES)[number];

export const parts = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    role: s.enum(PART_ROLES),
    shape: s.enum(PART_SHAPES),
    w: s.number({ help: 'Cells across the item axis.' }),
    l: s.number({ help: 'Cells along the item axis.' }),
    qtyMax: s.optional(s.number({ help: 'Copies one slot may hold. Default 1.' })),
    cross: s.optional(s.boolean({ help: 'Mounted across the haft (an axe head, a maul head).' })),
    curved: s.optional(s.boolean()),
    accepts: s.array(s.string(), { help: 'Material craft tags the part may be made of, in order of preference.' }),
  }),
  partsData,
  'Anvil parts',
);

export type PartKindDef = Omit<RecordOf<typeof parts>, 'role' | 'shape'> & { role: PartRole; shape: PartShape };

export const PART_LIST = partsData as unknown as PartKindDef[];
export const PART_KINDS: Record<string, PartKindDef> = Object.fromEntries(PART_LIST.map((p) => [p.id, p]));

/** The five anvil slots in their canonical order. */
export const FORGE_SLOTS = ['head', 'head2', 'guard', 'haft', 'bind'] as const;
export type ForgeSlot = (typeof FORGE_SLOTS)[number];

/** A part on the anvil: a kind, a material, and how many (default 1). */
export interface PlacedPart {
  kind: string;
  mat: string;
  qty?: number;
}

/** What is on the anvil, slot by slot. */
export type Placement = Partial<Record<ForgeSlot, PlacedPart>>;

/** A placed part as a forged item stores it: its slot is explicit. */
export interface ForgedPart extends PlacedPart {
  slot: ForgeSlot;
}

/** The stored form of a forged item (`ItemInstance.forged`). */
export interface ForgedSpec {
  parts: ForgedPart[];
  q: QualityTier;
}

// A forged spec is what `items` stores; the narrower types here must fit it.
const _fits: StoredPart = {} as ForgedPart;
void _fits;

/**
 * Cells in a placement: every part's `w x l`, times its quantity. The old
 * `placementCells`.
 */
export function placementCells(placement: Placement): number {
  let cells = 0;
  for (const slot of FORGE_SLOTS) {
    const part = placement[slot];
    const kind = part ? PART_KINDS[part.kind] : undefined;
    if (part && kind) cells += kind.w * kind.l * (part.qty ?? 1);
  }
  return cells;
}

/** Rune-slot size class of a forged item, from its total cells: 9 or less small, 10 to 17 medium, 18 or more large. */
export function runeClassForCells(cells: number): RuneSizeClass {
  if (cells <= 9) return 'small';
  return cells <= 17 ? 'medium' : 'large';
}

// ---- item classes ----

const range = (help: string) => s.optional(s.array(s.number(), { help: `${help} [min, max], inclusive; 99 for no upper bound.` }));
const placedSchema = s.optional(
  s.object({ kind: s.string(), mat: s.string(), qty: s.optional(s.number()) }),
);

/**
 * One clause of a class rule. Every field given must hold. The old union
 * fields are objects here (the schema has no union): `head: 'none'` is
 * `head: { none: true }`, `haft: 'none'` is `haft: { none: true }`, and
 * `haft: 'any'` is `haft: {}` (a haft object with no range already meant any
 * haft).
 */
const clauseSchema = s.object({
  head: s.optional(
    s.object({
      none: s.optional(s.boolean({ help: 'True: the placement has no head part at all.' })),
      shape: s.optional(s.array(s.enum(PART_SHAPES))),
      l: range('Length of the first head.'),
      w: range('Width of the first head.'),
      area: range('Cells of the first head, one copy.'),
      cross: s.optional(s.boolean()),
      curved: s.optional(s.boolean()),
      mat: s.optional(s.array(s.string(), { help: "Craft tags: the first head's material carries at least one." })),
      count: range('Head parts in total, both head slots and their quantities.'),
    }),
  ),
  anyHead: s.optional(s.array(s.enum(PART_SHAPES), { help: 'Some head, in either slot, has one of these shapes.' })),
  haft: s.optional(
    s.object({
      none: s.optional(s.boolean({ help: 'True: no haft.' })),
      l: range('Haft length.'),
      w: range('Haft width.'),
    }),
  ),
  guard: s.optional(s.boolean({ help: 'The guard slot is filled (true) or empty (false).' })),
  bind: s.optional(s.boolean({ help: 'The binding slot is filled (true) or empty (false).' })),
});

export const itemClasses = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Icon name. The file is not in the repository.' })),
    slot: s.enum(SLOT_IDS),
    wield: s.optional(s.enum(WIELD_CLASSES)),
    tags: s.array(s.string(), { help: 'Family tag first: it picks the combat skill and the martial family.' }),
    damageType: s.optional(s.enum(DAMAGE_TYPES, { help: "Overrides the family's damage type." })),
    priority: s.number({ help: 'Higher is tried first. Unique.' }),
    match: s.array(clauseSchema, { help: 'Clauses; any one suffices. The last class has one empty clause.' }),
    degenerate: s.optional(s.boolean({ help: 'The kernel scales the piece by 0.6.' })),
    cover: s.optional(s.number({ help: 'Armour only: the share of the body covered.' })),
    exemplar: s.object({ head: placedSchema, head2: placedSchema, guard: placedSchema, haft: placedSchema, bind: placedSchema }),
    desc: s.optional(s.string()),
  }),
  classesData,
  'Item classes',
);

type Range = [number, number];

/** One clause of a class rule. The old `ClassMatch`, with the union fields as objects. */
export interface ClassMatch {
  head?: {
    none?: boolean;
    shape?: PartShape[];
    l?: Range;
    w?: Range;
    area?: Range;
    cross?: boolean;
    curved?: boolean;
    mat?: string[];
    count?: Range;
  };
  anyHead?: PartShape[];
  haft?: { none?: boolean; l?: Range; w?: Range };
  guard?: boolean;
  bind?: boolean;
}

/** A kind of finished item the anvil can make. The old `ItemClassDef`. */
export interface ItemClassDef {
  id: string;
  name: string;
  icon: string;
  art?: string;
  slot: SlotId;
  wield?: WieldClass;
  tags: string[];
  damageType?: DamageType;
  priority: number;
  match: ClassMatch[];
  degenerate?: boolean;
  cover?: number;
  exemplar: Placement;
  desc?: string;
}

export const ITEM_CLASS_LIST = classesData as unknown as ItemClassDef[];
export const ITEM_CLASSES: Record<string, ItemClassDef> = Object.fromEntries(ITEM_CLASS_LIST.map((c) => [c.id, c]));

/** The id prefix of the class stubs, `forged:<classId>`. */
export const FORGED_PREFIX = 'forged:';

/** The item id a class is stubbed under, and the `defId` of a forged item of that class. */
export function forgedIdOf(classId: string): string {
  return `${FORGED_PREFIX}${classId}`;
}

/** The class id behind a `forged:<classId>` item id, or undefined for any other id. */
export function classIdOfForged(defId: string): string | undefined {
  return defId.startsWith(FORGED_PREFIX) ? defId.slice(FORGED_PREFIX.length) : undefined;
}
