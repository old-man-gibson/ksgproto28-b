/**
 * Modular smithing, the resolver half. Port of old `systems/assembly.ts`,
 * line for line; the changes are the module paths, the clause encoding of
 * `ClassMatch` (defs.ts) and the text lines.
 *
 * The anvil takes a part kind and a material per slot. The proportions of
 * the parts name the product (a 2x3 blade on a handle is a dagger, a 2x6
 * blade a sword) and one kernel turns materials, shapes and quality into
 * numbers. A class carries no numbers: it is a rule (`item_classes.json`)
 * and the stats come from the cells.
 *
 * Pure: it reads the registries and nothing else, never a slice.
 *
 * Every read of an item's definition goes through `itemDefOf` of `items`,
 * which calls `forgedDef` here for a forged item. A site that read
 * `ITEMS[item.defId]` would see the empty class stub: no mods, value 1, no
 * requirements. `tests/assembly.test.ts` scans the source for that spelling.
 */
import type { ItemDef } from '../items';
import { fillText } from '../log';
import { MATERIALS, QUALITY_TIERS, qualityMult, type MaterialDef, type QualityTier } from '../materials';
import type { ContentMod } from '../stats';
import {
  classIdOfForged,
  FORGE_SLOTS,
  forgedIdOf,
  ITEM_CLASSES,
  PART_KINDS,
  placementCells,
  runeClassForCells,
  TEXT,
  type ClassMatch,
  type ForgedPart,
  type ForgedSpec,
  type ForgeSlot,
  type ItemClassDef,
  type PartKindDef,
  type PartShape,
  type PlacedPart,
  type Placement,
} from './defs';

/** A material's smith profile: how the anvil reads it. */
export type SmithProfile = NonNullable<MaterialDef['smith']>;

/** A stored spec as read off a save: any shape. */
export interface LooseSpec {
  readonly parts?: unknown;
  readonly q: string;
}

const text = (id: string, params?: Record<string, unknown>): string => fillText(TEXT[id], params);

// ---------- Tuning ----------

/** Weight of the reference sword (long blade on a short handle, iron and hardwood). */
export const REFERENCE_WEIGHT = 13.2;
/** Damage per hardness-weighted cell of striking head. */
export const DAMAGE_PER_CELL = 0.58;
/** Share of the striking weight a non-striking head (plate, ring, a bent limb that cannot spring) still lends a weapon. */
export const BLUNT_HEAD_SHARE = 0.3;
/** Share a springy bent head (a bow limb) lends. */
export const SPRING_HEAD_SHARE = 0.7;
/** Share a haft lends when there is no striking head at all (a club, a quarterstaff). */
export const HAFT_STRIKE_SHARE = 0.8;
/** Haft leverage per cell past a short grip, for a head mounted across the haft or a point or mass. */
export const LEVER_HEAVY = 0.9;
/** Haft leverage per cell past a long grip, for everything else. */
export const LEVER_LIGHT = 0.5;
/** Attack speed gained per share of weight below the reference. */
export const SPEED_PER_LIGHTER = 0.18;
/** Attack speed lost per share of weight above the reference. */
export const SPEED_PER_HEAVIER = 0.2358;
/** Crit chance at length-to-width ratio 3 (a dagger or sword blade). */
export const BASE_CRIT = 0.02;
/** Crit damage gained per share of weight past 25% heavier than the reference. */
export const CRIT_DAMAGE_PER_HEAVIER = 0.259;
/** Armour per toughness-weighted cell, before coverage. */
export const ARMOUR_PER_CELL = 0.875;
/** Armour weight at which wearing it begins to slow the wearer. */
export const ARMOUR_FREE_WEIGHT = 12;
/** Attack speed lost per unit of armour weight past that. */
export const ARMOUR_SLOWDOWN = 0.01;
/** Weight below which a piece asks nothing of the wearer's STR; above it, STR = weight minus this. */
export const STR_FREE_WEIGHT = 10;
/** The smallest STR requirement that is printed at all. */
export const STR_MIN_REQUIREMENT = 4;
/** What a degenerate class keeps of the kernel's damage and armour. */
export const DEGENERATE_SCALE = 0.6;
/** Sale value as a multiple of the gold value of the inputs, at Fair quality. Under the shops' 2x markup, so forging never prints gold. */
export const VALUE_PER_INPUT = 1.8;
/** Ticks to forge before any cells. */
export const FORGE_BASE_TICKS = 100;
/** Ticks per cell. */
export const FORGE_TICKS_PER_CELL = 15;

/** Shapes whose cells strike: they carry the damage. */
const STRIKING: ReadonlySet<PartShape> = new Set<PartShape>(['edge', 'point', 'mass']);
/** Mods smaller than this are rounding noise and are not printed. */
const MOD_EPSILON = 0.0005;

/** The quality factor on damage, armour and value: Fair is 1, the ends are bounded. */
export function qualityFactor(q: QualityTier | string): number {
  // An unknown grade (a hand-edited or corrupt save) reads as Fair rather than throwing in every stat read.
  const mult = Object.prototype.hasOwnProperty.call(QUALITY_TIERS, q) ? qualityMult(q as QualityTier) : 1;
  return Math.max(0.7, 1 + 0.2 * (mult - 1));
}

// ---------- Placements and their stored form ----------

/** A part with its kind resolved, ready for the kernel. */
interface Part {
  slot: ForgeSlot;
  kind: PartKindDef;
  mat: string;
  qty: number;
  /** Cells of ONE copy. */
  cells: number;
}

/** A placement read once: the parts that exist, in slot order, with `head2` promoted when `head` is empty. */
interface Rig {
  heads: Part[];
  haft?: Part;
  guard?: Part;
  bind?: Part;
  /** Every part, heads first. */
  all: Part[];
}

function partOf(slot: ForgeSlot, placed: PlacedPart | undefined, kinds: Record<string, PartKindDef>): Part | undefined {
  // Own keys only: a stored kind of '__proto__' or 'constructor' must not resolve to an Object.prototype member.
  const kind = placed && Object.prototype.hasOwnProperty.call(kinds, placed.kind) ? kinds[placed.kind] : undefined;
  if (!placed || !kind) return undefined;
  // Clamped rather than refused: a stale or hand-edited quantity must still
  // resolve (the resolver is total). `placementProblem` is what refuses it.
  const qty = Math.max(1, Math.min(kind.qtyMax ?? 1, Math.floor(placed.qty ?? 1) || 1));
  return { slot, kind, mat: placed.mat, qty, cells: kind.w * kind.l };
}

function rigOf(placement: Placement, reg: SmithRegistries = {}): Rig {
  const kinds = reg.parts ?? PART_KINDS;
  const heads = [partOf('head', placement.head, kinds), partOf('head2', placement.head2, kinds)].filter(
    (p): p is Part => !!p,
  );
  const haft = partOf('haft', placement.haft, kinds);
  const guard = partOf('guard', placement.guard, kinds);
  const bind = partOf('bind', placement.bind, kinds);
  const all = [...heads];
  for (const p of [haft, guard, bind]) if (p) all.push(p);
  return { heads, haft, guard, bind, all };
}

/** The parts of a placement as stored on an item, in canonical slot order. */
export function partsOf(placement: Placement): ForgedPart[] {
  const parts: ForgedPart[] = [];
  for (const slot of FORGE_SLOTS) {
    const p = placement[slot];
    if (!p) continue;
    parts.push({ slot, kind: p.kind, mat: p.mat, ...((p.qty ?? 1) > 1 ? { qty: p.qty } : {}) });
  }
  return parts;
}

/**
 * The inverse of `partsOf`. Later entries for the same slot win.
 *
 * The argument is `unknown` on purpose: it is read off a save, and a stored
 * spec that is not a list (`{}`, `5`, `[null]`) must read as an empty anvil.
 * It is called for every equipped piece on every stat read, so a throw here
 * would make the save unbootable. Entries that are not objects with a known
 * slot and string kind and mat are skipped.
 */
export function placementOf(parts: unknown): Placement {
  const placement: Placement = {};
  if (!Array.isArray(parts)) return placement;
  for (const entry of parts as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const { slot, kind, mat, qty } = entry as Partial<Record<keyof ForgedPart, unknown>>;
    if (typeof slot !== 'string' || !(FORGE_SLOTS as readonly string[]).includes(slot)) continue;
    if (typeof kind !== 'string' || typeof mat !== 'string') continue;
    placement[slot as ForgeSlot] = { kind, mat, ...(typeof qty === 'number' ? { qty } : {}) };
  }
  return placement;
}

/** A plain copy, safe to store: keeps no reference to the original. */
export function clonePlacement(placement: Placement): Placement {
  const out: Placement = {};
  for (const slot of FORGE_SLOTS) {
    const p = placement[slot];
    if (p) out[slot] = { kind: p.kind, mat: p.mat, ...(p.qty !== undefined ? { qty: p.qty } : {}) };
  }
  return out;
}

/**
 * The canonical string of a placement: slots in fixed order, an empty `head`
 * filled from `head2`, quantity 1 left unwritten. Two placements with the same
 * key are the same combination however they were laid out.
 */
export function placementKey(placement: Placement): string {
  const rig = rigOf(placement);
  const bit = (p: Part) => `${p.kind.id}.${p.mat}${p.qty > 1 ? `x${p.qty}` : ''}`;
  const out: string[] = [];
  if (rig.heads[0]) out.push(`head:${bit(rig.heads[0])}`);
  if (rig.heads[1]) out.push(`head2:${bit(rig.heads[1])}`);
  if (rig.guard) out.push(`guard:${bit(rig.guard)}`);
  if (rig.haft) out.push(`haft:${bit(rig.haft)}`);
  if (rig.bind) out.push(`bind:${bit(rig.bind)}`);
  return out.join('|');
}

/**
 * Identity of a forged item: its parts and its quality, as one canonical
 * string. The memo key of the derived definition and part of `stackKey` (two
 * different swords never stack).
 */
export function forgeKey(spec: LooseSpec): string {
  return `${placementKey(placementOf(spec.parts))}@${spec.q}`;
}

// ---------- Features and classification ----------

/** Everything a class rule can ask about a placement. Fill order is never one of them. */
export interface Features {
  /** The FIRST head: the `head` slot, else `head2`. Null when there is none. */
  head: {
    shape: PartShape;
    l: number;
    w: number;
    area: number;
    cross: boolean;
    curved: boolean;
    /** Craft tags of the head's material. */
    matTags: string[];
  } | null;
  /** Head parts in total: quantities summed over both head slots. */
  headCount: number;
  /** The shape of every head present. */
  headShapes: PartShape[];
  haft: { l: number; w: number } | null;
  guard: boolean;
  bind: boolean;
}

/**
 * The registries a resolution reads. Defaults to the live ones; the lint
 * passes its own copies so a half-edited table is checked as it stands.
 */
export interface SmithRegistries {
  classes?: Record<string, ItemClassDef>;
  parts?: Record<string, PartKindDef>;
  materials?: Record<string, MaterialDef>;
}

export function featuresOf(placement: Placement, reg: SmithRegistries = {}): Features {
  const materials = reg.materials ?? MATERIALS;
  const rig = rigOf(placement, reg);
  const first = rig.heads[0];
  return {
    head: first
      ? {
          shape: first.kind.shape,
          l: first.kind.l,
          w: first.kind.w,
          area: first.cells,
          cross: !!first.kind.cross,
          curved: !!first.kind.curved,
          matTags: materials[first.mat]?.craftTags ?? [],
        }
      : null,
    headCount: rig.heads.reduce((n, h) => n + h.qty, 0),
    headShapes: rig.heads.map((h) => h.kind.shape),
    haft: rig.haft ? { l: rig.haft.kind.l, w: rig.haft.kind.w } : null,
    guard: !!rig.guard,
    bind: !!rig.bind,
  };
}

function inRange(value: number, range: readonly number[] | undefined): boolean {
  return !range || (value >= range[0] && value <= range[1]);
}

/** Whether one clause accepts these features. Every field it states must hold. */
export function matchesClause(m: ClassMatch, f: Features): boolean {
  if (m.head?.none) {
    if (f.head) return false;
  } else if (m.head) {
    const h = f.head;
    const c = m.head;
    if (!h) return false;
    if (c.shape && !c.shape.includes(h.shape)) return false;
    if (!inRange(h.l, c.l) || !inRange(h.w, c.w) || !inRange(h.area, c.area)) return false;
    if (c.cross !== undefined && h.cross !== c.cross) return false;
    if (c.curved !== undefined && h.curved !== c.curved) return false;
    if (c.mat && !c.mat.some((tag) => h.matTags.includes(tag))) return false;
    if (!inRange(f.headCount, c.count)) return false;
  }
  if (m.anyHead && !m.anyHead.some((shape) => f.headShapes.includes(shape))) return false;
  if (m.haft?.none) {
    if (f.haft) return false;
  } else if (m.haft) {
    // A haft object with no range is the old `haft: 'any'`.
    if (!f.haft || !inRange(f.haft.l, m.haft.l) || !inRange(f.haft.w, m.haft.w)) return false;
  }
  if (m.guard !== undefined && f.guard !== m.guard) return false;
  if (m.bind !== undefined && f.bind !== m.bind) return false;
  return true;
}

/** Whether a class accepts these features: any one of its clauses. */
export function matchesClass(def: ItemClassDef, f: Features): boolean {
  return def.match.some((c) => matchesClause(c, f));
}

let SORTED_DEFAULT: ItemClassDef[] | null = null;

/** Classes in the order they are tried: highest priority first, ties in declaration order. */
export function classesByPriority(classes: Record<string, ItemClassDef> = ITEM_CLASSES): ItemClassDef[] {
  const sort = () => Object.values(classes).sort((a, b) => b.priority - a.priority);
  if (classes !== ITEM_CLASSES) return sort();
  if (!SORTED_DEFAULT) SORTED_DEFAULT = sort();
  return SORTED_DEFAULT;
}

/** The first class that accepts the placement, or undefined if the table has a hole (the content test fails then). */
export function matchingClass(placement: Placement, reg: SmithRegistries = {}): ItemClassDef | undefined {
  const f = featuresOf(placement, reg);
  return classesByPriority(reg.classes).find((c) => matchesClass(c, f));
}

/**
 * What a placement is. Total: the last class accepts everything, so this
 * always names something. Should an edited table ever lose that class, the
 * lowest-priority one answers instead of nothing.
 */
export function classifyPlacement(placement: Placement, reg: SmithRegistries = {}): ItemClassDef {
  const ordered = classesByPriority(reg.classes);
  const f = featuresOf(placement, reg);
  return ordered.find((c) => matchesClass(c, f)) ?? ordered[ordered.length - 1];
}

// ---------- The kernel ----------

const NO_PROFILE: SmithProfile = { rho: 0, hard: 0, tough: 0, unitCells: 1, label: '' };

function profileOf(matId: string, materials: Record<string, MaterialDef> = MATERIALS): SmithProfile {
  return materials[matId]?.smith ?? NO_PROFILE;
}

/** The numbers a placement works out to. Everything is finite for every placement. */
export interface ForgeStats {
  cls: ItemClassDef;
  /** Cells in all, quantities counted. */
  cells: number;
  /** Sum of cells x density. */
  weight: number;
  /** The quality factor applied to damage, armour and value. */
  g: number;
  /** Weapon classes only. */
  damage?: number;
  /** Attack speed multiplier (+ faster); weapons and armour. 0 when negligible. */
  attackSpeed: number;
  /** Edge and point weapons only. */
  crit?: number;
  critDamage: number;
  /** Classes with a `cover` only. */
  armour?: number;
  /** STR needed to equip; 0 when none. */
  str: number;
  /** Gold, parts only: no slot, affix or finish multiplies it. */
  value: number;
  /** Bench ticks before skill. */
  ticks: number;
}

/** Round to four places so float dust never prints as a mod. */
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/** The one kernel. Material x shape x quality; no per-class numbers, only the class's `degenerate` and `cover` flags. */
export function forgeStats(placement: Placement, q: QualityTier | string, cls: ItemClassDef = classifyPlacement(placement)): ForgeStats {
  const rig = rigOf(placement);
  const g = qualityFactor(q);
  const scale = cls.degenerate ? DEGENERATE_SCALE : 1;
  const cells = rig.all.reduce((n, p) => n + p.cells * p.qty, 0);
  const weight = rig.all.reduce((n, p) => n + p.cells * p.qty * profileOf(p.mat).rho, 0);
  const heavier = (weight - REFERENCE_WEIGHT) / REFERENCE_WEIGHT;
  const out: ForgeStats = {
    cls,
    cells,
    weight,
    g,
    attackSpeed: 0,
    critDamage: 0,
    str: 0,
    value: 0,
    ticks: forgeTicks(placement),
  };

  if (cls.slot === 'weapon') {
    let strike = 0;
    let striker = false;
    for (const h of rig.heads) {
      const p = profileOf(h.mat);
      const raw = h.cells * h.qty * p.hard;
      if (STRIKING.has(h.kind.shape)) {
        strike += raw;
        striker = true;
      } else if (h.kind.shape === 'bent' && p.springy) strike += SPRING_HEAD_SHARE * raw;
      else strike += BLUNT_HEAD_SHARE * raw;
    }
    // Nothing on the head end strikes, so the haft itself is the weapon.
    if (!striker && rig.haft) strike += HAFT_STRIKE_SHARE * rig.haft.cells * profileOf(rig.haft.mat).hard;
    const first = rig.heads[0];
    const haftL = rig.haft?.kind.l ?? 0;
    const heavyHead = !!first && (first.kind.cross || first.kind.shape === 'point' || first.kind.shape === 'mass');
    const lever = heavyHead ? LEVER_HEAVY * Math.max(0, haftL - 2) : LEVER_LIGHT * Math.max(0, haftL - 4);
    out.damage = Math.max(1, Math.round((DAMAGE_PER_CELL * strike + lever) * g * scale));
    out.attackSpeed = r4(heavier < 0 ? SPEED_PER_LIGHTER * -heavier : -SPEED_PER_HEAVIER * heavier);
    if (first && (first.kind.shape === 'edge' || first.kind.shape === 'point')) {
      out.crit = r4(BASE_CRIT * Math.sqrt(first.kind.l / first.kind.w / 3));
    }
    out.critDamage = r4(CRIT_DAMAGE_PER_HEAVIER * Math.max(0, heavier - 0.25));
  } else if (cls.cover !== undefined) {
    const tough = rig.heads.reduce((n, h) => n + h.cells * h.qty * profileOf(h.mat).tough, 0);
    out.armour = Math.round(ARMOUR_PER_CELL * tough * cls.cover * g * scale);
    out.attackSpeed = r4(-ARMOUR_SLOWDOWN * Math.max(0, weight - ARMOUR_FREE_WEIGHT));
  }

  const str = Math.round(weight - STR_FREE_WEIGHT);
  out.str = str >= STR_MIN_REQUIREMENT ? str : 0;
  out.value = Math.max(1, Math.round(VALUE_PER_INPUT * inputValue(placement) * g));
  return out;
}

// ---------- Cost ----------

/** Cells per material, in the order the materials first appear in the slots. */
function cellsByMaterial(placement: Placement, reg: SmithRegistries): Map<string, number> {
  const byMat = new Map<string, number>();
  for (const p of rigOf(placement, reg).all) byMat.set(p.mat, (byMat.get(p.mat) ?? 0) + p.cells * p.qty);
  return byMat;
}

/**
 * What a placement costs: each material's cells, rounded UP to whole units
 * (an ingot is 6 cells, a hardwood 4, a leather 3).
 */
export function placementCost(placement: Placement, reg: SmithRegistries = {}): { id: string; qty: number }[] {
  return [...cellsByMaterial(placement, reg)].map(([id, cells]) => ({
    id,
    qty: Math.ceil(cells / Math.max(1, profileOf(id, reg.materials).unitCells)),
  }));
}

/** Gold value of the inputs, whole units at their material value. */
function inputValue(placement: Placement): number {
  return placementCost(placement).reduce((sum, c) => sum + c.qty * (MATERIALS[c.id]?.value ?? 0), 0);
}

/** Bench ticks for a placement, before the smith's speed: more cells, longer. */
export function forgeTicks(placement: Placement): number {
  const cells = rigOf(placement).all.reduce((n, p) => n + p.cells * p.qty, 0);
  return FORGE_BASE_TICKS + FORGE_TICKS_PER_CELL * cells;
}

// ---------- The derived definition ----------

const DERIVED = new Map<string, ItemDef>();
/** Distinct forged items a session can hold before the memo is dropped and rebuilt. */
const DERIVED_LIMIT = 4096;

function partsLine(placement: Placement): string {
  const rig = rigOf(placement);
  return rig.all.map((p) => `${p.kind.name}${p.qty > 1 ? ` ×${p.qty}` : ''} (${profileOf(p.mat).label || p.mat})`).join(', ');
}

/** The name a forged item wears: the first head's material, else the first part's, then the class. */
function nameOf(rig: Rig, cls: ItemClassDef): string {
  const lead = rig.heads[0] ?? rig.all[0];
  const label = lead ? profileOf(lead.mat).label : '';
  return label ? `${label} ${cls.name}` : cls.name;
}

/**
 * The full definition of a forged item, derived from its parts. Memoised by
 * `forgeKey`; a fresh object only when the combination is new.
 */
export function forgedDef(spec: LooseSpec): ItemDef {
  const key = forgeKey(spec);
  const hit = DERIVED.get(key);
  if (hit) return hit;

  const placement = placementOf(spec.parts);
  const rig = rigOf(placement);
  const cls = classifyPlacement(placement);
  const k = forgeStats(placement, spec.q, cls);

  const mods: ContentMod[] = [];
  if (k.damage !== undefined) mods.push({ stat: 'damage', op: 'add', value: k.damage });
  if (Math.abs(k.attackSpeed) >= MOD_EPSILON) mods.push({ stat: 'attackSpeed', op: 'mult', value: k.attackSpeed });
  if (k.crit !== undefined && k.crit >= MOD_EPSILON) mods.push({ stat: 'crit', op: 'add', value: k.crit });
  if (k.critDamage >= MOD_EPSILON) mods.push({ stat: 'critDamage', op: 'mult', value: k.critDamage });
  if (k.armour !== undefined && k.armour > 0) mods.push({ stat: 'armor', op: 'add', value: k.armour });

  // A material's own character rides along once per material that makes up a
  // head, whatever the size of the head: bronze carries its will, a bronze
  // guard on an iron blade does not.
  //
  // Tags follow the same rule: the class tags plus the craft tags of the head
  // materials, so a sword on a hardwood handle is not a wooden weapon. A piece
  // with no head at all (club, quarterstaff, stick) is its haft, and takes the
  // haft material's tags instead.
  const tags = [...cls.tags];
  const addTags = (matId: string) => {
    for (const t of MATERIALS[matId]?.craftTags ?? []) if (!tags.includes(t)) tags.push(t);
  };
  const seen = new Set<string>();
  for (const h of rig.heads) {
    if (seen.has(h.mat)) continue;
    seen.add(h.mat);
    for (const m of MATERIALS[h.mat]?.smith?.mods ?? []) mods.push({ ...m } as ContentMod);
    addTags(h.mat);
  }
  if (!rig.heads.length && rig.haft) addTags(rig.haft.mat);

  const def: ItemDef = {
    id: forgedIdOf(cls.id),
    name: nameOf(rig, cls),
    icon: cls.icon,
    ...(cls.art ? { art: cls.art } : {}),
    slot: cls.slot,
    ...(cls.wield ? { wield: cls.wield } : {}),
    tags,
    mods,
    value: k.value,
    desc: `Parts: ${partsLine(placement)}.${cls.desc ? ` ${cls.desc}` : ''}`,
    ...(k.str > 0 ? { requirements: [{ type: 'attr' as const, attr: 'str' as const, level: k.str }] } : {}),
    ...(cls.damageType ? { damageType: cls.damageType } : {}),
    runeClass: runeClassForCells(k.cells),
  } as ItemDef;
  if (DERIVED.size >= DERIVED_LIMIT) DERIVED.clear();
  DERIVED.set(key, def);
  return def;
}

/** The class a `forged:<classId>` item id stubs, or undefined for any other id. */
export function forgedClassOf(defId: string): ItemClassDef | undefined {
  const id = classIdOfForged(defId);
  return id !== undefined && Object.prototype.hasOwnProperty.call(ITEM_CLASSES, id) ? ITEM_CLASSES[id] : undefined;
}

/** A class's exemplar as a stored spec, at the given quality. */
export function exemplarSpec(cls: ItemClassDef, q: QualityTier = 'c'): ForgedSpec {
  return { parts: partsOf(cls.exemplar), q };
}

/**
 * The `forged:<class>` stub of every class, as the old item registry
 * generated them: the class's slot, hands and family tags, no numbers. The
 * rune class is the exemplar's cells read through the same thresholds.
 */
export function classStubs(): ItemDef[] {
  return Object.values(ITEM_CLASSES).map(
    (cls) =>
      ({
        id: forgedIdOf(cls.id),
        name: cls.name,
        icon: cls.icon,
        ...(cls.art ? { art: cls.art } : {}),
        slot: cls.slot,
        ...(cls.wield ? { wield: cls.wield } : {}),
        tags: [...cls.tags],
        mods: [],
        value: 1,
        ...(cls.desc ? { desc: cls.desc } : {}),
        runeClass: runeClassForCells(placementCells(cls.exemplar)),
      }) as ItemDef,
  );
}

// ---------- Validity ----------

/**
 * Why a placement cannot be forged, as a player-readable line; null when it
 * can. Structure only (known kinds, the right slot, an accepted material, a
 * quantity in range): skill gates and stock are `previewForge`'s. A placement
 * that passes resolves to a class and has finite numbers.
 */
export function placementProblem(placement: Placement, reg: SmithRegistries = {}): string | null {
  const kinds = reg.parts ?? PART_KINDS;
  const materials = reg.materials ?? MATERIALS;
  let any = false;
  for (const slot of FORGE_SLOTS) {
    const p = placement[slot];
    if (!p) continue;
    any = true;
    const kind = kinds[p.kind];
    if (!kind) return text('reason_unknown_part', { part: p.kind });
    const wantRole = slot === 'head2' ? 'head' : slot;
    if (kind.role !== wantRole) return text('reason_wrong_slot', { part: kind.name, slot });
    const mat = materials[p.mat];
    if (!mat?.smith || !kind.accepts.some((t) => mat.craftTags?.includes(t))) {
      return text('reason_material', { material: mat?.name ?? p.mat, part: kind.name });
    }
    if (mat.graded) return text('reason_graded', { material: mat.name });
    const qty = p.qty ?? 1;
    const max = kind.qtyMax ?? 1;
    if (!Number.isInteger(qty) || qty < 1 || qty > max) {
      return text('reason_qty', { part: kind.name, max });
    }
  }
  return any ? null : text('reason_empty');
}

// ---------- Neighbours ----------

export interface ForgeNeighbour {
  /** How it differs from the current placement. */
  change: 'swap' | 'add' | 'remove' | 'qty';
  slot: ForgeSlot;
  /** The part now in the slot; absent when the change removes it. */
  part?: PlacedPart;
  /** What the placement becomes. */
  to: ItemClassDef;
  placement: Placement;
}

/**
 * A material for a part kind: one of `prefer` in order if it fits, else the
 * first material carrying the part's first accepted tag, then its second. The
 * order of `accepts` is therefore a statement of preference: a haft lists
 * 'wood' before 'metal', a plate the other way round.
 */
function materialFor(kind: PartKindDef, prefer: (string | undefined)[]): string | undefined {
  const forgeable = Object.values(MATERIALS).filter((m) => m.smith && !m.graded);
  const fits = (m: MaterialDef) => kind.accepts.some((t) => m.craftTags?.includes(t));
  for (const id of prefer) {
    const m = id ? MATERIALS[id] : undefined;
    if (m && forgeable.includes(m) && fits(m)) return m.id;
  }
  for (const tag of kind.accepts) {
    const m = forgeable.find((f) => f.craftTags?.includes(tag));
    if (m) return m.id;
  }
  return undefined;
}

/**
 * Every placement one edit away from this one that changes what it IS: a part
 * kind swapped for another of the same role, a slot filled or emptied, a
 * quantity stepped by one. The anvil shows these as "make it a different
 * thing": a longer blade is a sword, one more ring is chain mail.
 *
 * A swapped part keeps its material when the new kind accepts it, else takes
 * the first material that does; a filled slot takes the first material that
 * fits. Results are grouped by neither slot nor class: the caller decides.
 */
export function neighbours(placement: Placement): ForgeNeighbour[] {
  const here = classifyPlacement(placement);
  const out: ForgeNeighbour[] = [];
  const consider = (change: ForgeNeighbour['change'], slot: ForgeSlot, part: PlacedPart | undefined) => {
    const next: Placement = clonePlacement(placement);
    if (part) next[slot] = part;
    else delete next[slot];
    if (placementProblem(next) !== null) return;
    const to = classifyPlacement(next);
    if (to.id !== here.id) out.push({ change, slot, ...(part ? { part } : {}), to, placement: next });
  };

  for (const slot of FORGE_SLOTS) {
    const current = placement[slot];
    const role = slot === 'head2' ? 'head' : slot;
    for (const kind of Object.values(PART_KINDS)) {
      if (kind.role !== role || kind.id === current?.kind) continue;
      // The slot's own material first; a head also follows the other head.
      const mat = materialFor(kind, role === 'head' ? [current?.mat, placement.head?.mat, placement.head2?.mat] : [current?.mat]);
      if (!mat) continue;
      consider(current ? 'swap' : 'add', slot, { kind: kind.id, mat });
    }
    if (current) {
      consider('remove', slot, undefined);
      const kind = PART_KINDS[current.kind];
      const qty = current.qty ?? 1;
      if (kind && qty < (kind.qtyMax ?? 1)) consider('qty', slot, { ...current, qty: qty + 1 });
      if (kind && qty > 1) consider('qty', slot, { ...current, qty: qty - 1 });
    }
  }
  return out;
}

// ---------- Enumeration (for the lints) ----------

export interface EnumerateOptions {
  /**
   * 'all': every material each part accepts. 'tags': one material per
   * accepted tag, which is every distinct classification and a fraction of the
   * placements.
   */
  materials?: 'all' | 'tags';
  parts?: Record<string, PartKindDef>;
  materialDefs?: Record<string, MaterialDef>;
}

/** Every legal (kind, material, quantity) for the parts of one role. */
function optionsFor(
  role: PartKindDef['role'],
  parts: Record<string, PartKindDef>,
  materials: Record<string, MaterialDef>,
  mode: 'all' | 'tags',
): PlacedPart[] {
  const forgeable = Object.values(materials).filter((m) => m.smith && !m.graded);
  const out: PlacedPart[] = [];
  for (const kind of Object.values(parts)) {
    if (kind.role !== role) continue;
    let mats = forgeable.filter((m) => kind.accepts.some((t) => m.craftTags?.includes(t)));
    if (mode === 'tags') {
      const firstOf = new Set(kind.accepts.map((t) => mats.find((m) => m.craftTags?.includes(t))?.id));
      mats = mats.filter((m) => firstOf.has(m.id));
    }
    for (const m of mats) {
      for (let qty = 1; qty <= (kind.qtyMax ?? 1); qty++) {
        out.push({ kind: kind.id, mat: m.id, ...(qty > 1 ? { qty } : {}) });
      }
    }
  }
  return out;
}

/**
 * Every placement the catalogue allows: each head option in the head slot and
 * (with a head) in the second, every haft, guard and binding, and each of them
 * absent. An empty `head` with a filled `head2` is the same placement as the
 * head moved up, and is not repeated.
 */
export function* enumeratePlacements(opts: EnumerateOptions = {}): Generator<Placement> {
  const parts = opts.parts ?? PART_KINDS;
  const mats = opts.materialDefs ?? MATERIALS;
  const mode = opts.materials ?? 'all';
  const heads = optionsFor('head', parts, mats, mode);
  const hafts = optionsFor('haft', parts, mats, mode);
  const guards = optionsFor('guard', parts, mats, mode);
  const binds = optionsFor('bind', parts, mats, mode);
  const withNone = <T>(list: T[]): (T | undefined)[] => [undefined, ...list];

  for (const head of withNone(heads)) {
    for (const head2 of head ? withNone(heads) : [undefined]) {
      for (const haft of withNone(hafts)) {
        for (const guard of withNone(guards)) {
          for (const bind of withNone(binds)) {
            const placement: Placement = {};
            if (head) placement.head = head;
            if (head2) placement.head2 = head2;
            if (haft) placement.haft = haft;
            if (guard) placement.guard = guard;
            if (bind) placement.bind = bind;
            yield placement;
          }
        }
      }
    }
  }
}
