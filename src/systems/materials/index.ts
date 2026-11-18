/**
 * Materials: the stackable things a character holds. Plain ones are a count;
 * graded ones are a count per quality. Port of `data/materials.data.ts`,
 * `data/quality.data.ts`, the graded-stock half of the old
 * `systems/disciplines.ts` and the discard half of the stackable code in
 * `systems/equipment.ts`. See README.md in this folder.
 */
import {
  answer,
  defineCommand,
  defineRequest,
  defineSystem,
  handle,
  OK,
  registry,
  s,
  skipped,
  type DeepReadonly,
  type RecordOf,
  type Rng,
} from '../../kernel';
import { addGold } from '../gold';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { RESOURCE_IDS } from '../resources';
import { modifierSchema, statOf } from '../stats';
import { applicationSchema } from '../statuses';
import materialsData from './content/materials.json';
import materialsTextData from './content/materials_text.json';
import qualityTiersData from './content/quality_tiers.json';
import { migrations } from './migrations';

// ---- quality ----

export const QUALITY_ORDER = ['f', 'e', 'd', 'c', 'b', 'a', 's'] as const;
export type QualityTier = (typeof QUALITY_ORDER)[number];

const qualityTiers = registry(
  s.object({
    id: s.enum(QUALITY_ORDER),
    name: s.string(),
    mult: s.number({ help: 'What a grade multiplies. Refuse is negative.' }),
    color: s.string({ help: 'The grade colour of the old build, as data. No panel here reads it.' }),
  }),
  qualityTiersData,
  'Quality tiers',
);
export type QualityTierDef = RecordOf<typeof qualityTiers>;

/** Worst to best. The order of the file is checked against `QUALITY_ORDER` by a test. */
export const QUALITY_TIER_LIST = qualityTiersData as QualityTierDef[];
export const QUALITY_TIERS = Object.fromEntries(QUALITY_TIER_LIST.map((t) => [t.id, t])) as Record<
  QualityTier,
  QualityTierDef
>;

export function qualityRank(q: QualityTier): number {
  return QUALITY_ORDER.indexOf(q);
}

/** True when `q` is at least as good as `min`. */
export function qualityAtLeast(q: QualityTier, min: QualityTier): boolean {
  return qualityRank(q) >= qualityRank(min);
}

export function qualityMult(q: QualityTier): number {
  return QUALITY_TIERS[q].mult;
}

// ---- content ----

const materials = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    value: s.number({ help: 'Sell value of one unit before the seller\'s gold gain.' }),
    desc: s.optional(s.string()),
    craftTags: s.optional(s.array(s.string(), { help: 'Tags a discipline slot accepts by.' })),
    graded: s.optional(s.boolean({ help: 'Held per quality instead of as one count.' })),
    /** How the anvil reads the material. Read by modular smithing, which is not ported. */
    smith: s.optional(
      s.object({
        rho: s.number(),
        hard: s.number(),
        tough: s.number(),
        springy: s.optional(s.boolean()),
        unitCells: s.number(),
        label: s.string(),
        mods: s.optional(s.array(modifierSchema)),
      }),
    ),
    /** What using the material does. Read by the consumables system, which is not ported. */
    consumable: s.optional(
      s.object({
        food: s.optional(s.boolean()),
        useVerb: s.optional(s.string()),
        restore: s.optional(
          s.array(
            s.object({
              resource: s.enum(RESOURCE_IDS),
              flat: s.optional(s.number()),
              ofMax: s.optional(s.number()),
            }),
          ),
        ),
        grants: s.optional(s.array(applicationSchema)),
        signature: s.optional(s.array(applicationSchema)),
        cures: s.optional(s.array(s.string(), { help: 'Cure tags fired on the user. No record carries one yet.' })),
        cooldown: s.optional(s.number({ help: 'Ticks.' })),
        votive: s.optional(s.boolean()),
        teaches: s.optional(s.string({ help: 'Dish id. A plain string until the cooking registry exists.' })),
        unlocksWord: s.optional(s.string({ help: 'Word id. A plain string until the arcane registry exists.' })),
        teachesTechnique: s.optional(
          s.string({ help: 'Technique id. A plain string until the martial registry exists.' }),
        ),
        stamps: s.optional(s.string({ help: 'Counter key set to 1.' })),
      }),
    ),
  }),
  materialsData,
  'Materials',
);
export type MaterialDef = RecordOf<typeof materials>;

export const MATERIAL_LIST = materialsData as unknown as MaterialDef[];
export const MATERIALS: Record<string, MaterialDef> = Object.fromEntries(MATERIAL_LIST.map((m) => [m.id, m]));

const materialsText = registry(textSchema, materialsTextData, 'Material text');
const TEXT = Object.fromEntries((materialsTextData as TextRecord[]).map((r) => [r.id, r.text]));

/** A material's line in the hunt tally: icon, name and, for one graded unit, its grade. */
export function huntMaterialLabel(id: string, quality?: QualityTier): string {
  const mat = MATERIALS[id];
  const grade = quality ? ` (${QUALITY_TIERS[quality].name})` : '';
  return fillText(TEXT.hunt_material, { icon: mat?.icon ?? '', name: mat?.name ?? id, grade }).trim();
}

// ---- slice ----

export interface MaterialsState {
  /** Plain materials: id to count. A material not held is absent. */
  counts: Record<string, number>;
  /** Graded materials: id to quality to count. An empty bucket is removed. */
  stock: Record<string, Partial<Record<QualityTier, number>>>;
}

// ---- reads ----

export function isGraded(materialId: string): boolean {
  return MATERIALS[materialId]?.graded === true;
}

export function craftTagsOf(materialId: string): string[] {
  return MATERIALS[materialId]?.craftTags ?? [];
}

/** How many of a graded material at one grade are held. */
export function stockOf(state: DeepReadonly<MaterialsState>, id: string, quality: QualityTier): number {
  return state.stock[id]?.[quality] ?? 0;
}

/** How many of a plain material are held. */
export function countOf(state: DeepReadonly<MaterialsState>, id: string): number {
  return state.counts[id] ?? 0;
}

/** Every grade held of a material, best first. */
export function gradesHeld(state: DeepReadonly<MaterialsState>, id: string): { quality: QualityTier; qty: number }[] {
  const held = state.stock[id] ?? {};
  return QUALITY_ORDER.map((q) => ({ quality: q, qty: held[q] ?? 0 }))
    .filter((e) => e.qty > 0)
    .reverse();
}

/** Units held of a material over every grade, or its plain count. */
export function heldOf(state: DeepReadonly<MaterialsState>, id: string): number {
  if (!isGraded(id)) return countOf(state, id);
  return gradesHeld(state, id).reduce((sum, g) => sum + g.qty, 0);
}

// ---- grading ----

/** How often each grade turns up. */
export const GRADE_WEIGHTS: Record<QualityTier, number> = {
  f: 10,
  e: 20,
  d: 32,
  c: 24,
  b: 10,
  a: 3.4,
  s: 0.6,
};

/** Weighted pick from a list of `{ weight }` entries. One draw. */
export function weightedPick<T extends { weight: number }>(rng: Rng, entries: readonly T[]): T {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng.next() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}

/**
 * Roll the grade of a found thing. `luck` is the finder's loot multiplier: it
 * weights the better grades up and the worse ones down.
 */
export function rollQuality(rng: Rng, luck = 1): QualityTier {
  const entries = QUALITY_ORDER.map((q) => ({
    q,
    weight: GRADE_WEIGHTS[q] * Math.pow(Math.max(0.1, luck), (qualityRank(q) - 2) / 2),
  }));
  return weightedPick(rng, entries).q;
}

// ---- changes ----

function addGraded(state: MaterialsState, id: string, quality: QualityTier, qty: number): void {
  const bucket = (state.stock[id] ??= {});
  bucket[quality] = (bucket[quality] ?? 0) + qty;
}

function removeGraded(state: MaterialsState, id: string, quality: QualityTier, qty: number): boolean {
  const have = stockOf(state, id, quality);
  if (have < qty) return false;
  const bucket = state.stock[id]!;
  if (have - qty > 0) bucket[quality] = have - qty;
  else delete bucket[quality];
  if (Object.keys(bucket).length === 0) delete state.stock[id];
  return true;
}

/** Remove up to `qty` of a stack. Returns how many were removed. */
function removeStack(state: MaterialsState, id: string, quality: QualityTier, qty: number): number {
  if (isGraded(id)) {
    const take = Math.min(stockOf(state, id, quality), qty);
    if (take > 0) removeGraded(state, id, quality, take);
    return take;
  }
  const have = state.counts[id] ?? 0;
  const take = Math.min(have, qty);
  if (take <= 0) return 0;
  if (have - take > 0) state.counts[id] = have - take;
  else delete state.counts[id];
  return take;
}

/** A grade prefix for the log, empty for a plain material. */
function gradeLabel(id: string, quality: QualityTier): string {
  return isGraded(id) ? `${QUALITY_TIERS[quality].name} ` : '';
}

/** One (material, grade) pair. `quality` is ignored for a plain material. */
export interface StackRef {
  id: string;
  quality: QualityTier;
}

// ---- requests ----

/**
 * Put a material into stock, wherever it belongs. A graded material rolls a
 * grade per unit. Every source of materials (loot, gathering, a reward) goes
 * through here. The answer names the grade when exactly one graded unit was
 * granted.
 */
export const grantMaterial = defineRequest<{ id: string; qty?: number; luck?: number }, { quality?: QualityTier }>(
  'materials/grant',
);

/** Add `qty` of a graded material at a stated grade. No roll. */
export const grantGraded = defineRequest<{ id: string; quality: QualityTier; qty?: number }, void>(
  'materials/grant-graded',
);

/** Take exactly `qty` of a graded material at one grade. False, and nothing taken, when fewer are held. */
export const takeGraded = defineRequest<{ id: string; quality: QualityTier; qty?: number }, boolean>(
  'materials/take-graded',
);

/** Take up to `qty` of a stack, plain or graded. Answers how many were taken. */
export const takeStack = defineRequest<{ id: string; quality: QualityTier; qty: number }, number>(
  'materials/take-stack',
);

// ---- commands ----

/** Throw away up to `qty` of a held stack. */
export const discardStackable = defineCommand<{ id: string; quality: QualityTier; qty: number }>('materials/discard');

/** Throw away every listed stack whole, with one log line. `noun` names the units in that line. */
export const discardStackablesBatch = defineCommand<{ refs: StackRef[]; noun?: string }>('materials/discard-batch');

/** Sell up to `qty` of a held stack. The old `sellStackable`. */
export const sellStackable = defineCommand<{ id: string; quality: QualityTier; qty: number }>('materials/sell');

/** Sell every listed stack whole, with one log line. The old `sellStackablesBatch`. */
export const sellStackablesBatch = defineCommand<{ refs: StackRef[]; noun?: string }>('materials/sell-batch');

// ---- prices ----

/**
 * Sell price of one unit of a plain material: its value times the gold gain,
 * rounded, at least 1. The old `materialSellPrice`.
 */
export function materialSellPrice(materialId: string, goldGain: number): number {
  return Math.max(1, Math.round((MATERIALS[materialId]?.value ?? 1) * goldGain));
}

/**
 * Sell price of one unit at a grade. A plain material ignores the grade.
 * Refuse still fetches a token coin. The old `gradedUnitPrice`.
 */
export function gradedUnitPrice(id: string, quality: QualityTier, goldGain: number): number {
  const mult = isGraded(id) ? Math.max(0.1, qualityMult(quality)) : 1;
  return Math.max(1, Math.round((MATERIALS[id]?.value ?? 1) * mult * goldGain));
}

// ---- view ----

export interface MaterialRow {
  id: string;
  name: string;
  icon: string;
  value: number;
  /** Total units held. */
  qty: number;
  /** What `materials/sell` pays for one unit of a plain material now. */
  sell: number;
  /** Grades held, best first, with the price of one unit. Empty for a plain material. */
  grades: { quality: QualityTier; name: string; qty: number; sell: number }[];
}

export interface MaterialsView {
  /** Held materials in registry order. */
  held: MaterialRow[];
}

export default defineSystem<MaterialsState, MaterialsView>({
  id: 'materials',
  version: 1,
  migrations,
  initial: () => ({ counts: {}, stock: {} }),
  content: { materials, quality_tiers: qualityTiers, materials_text: materialsText },

  requests: [
    answer(grantMaterial, (ctx, { id, qty = 1, luck = 1 }) => {
      if (!isGraded(id)) {
        ctx.state.counts[id] = (ctx.state.counts[id] ?? 0) + qty;
        return {};
      }
      // Each unit is found separately, so a stack of five can hold five grades.
      let last: QualityTier = 'c';
      for (let i = 0; i < qty; i++) {
        last = rollQuality(ctx.rng, luck);
        addGraded(ctx.state, id, last, 1);
      }
      return { quality: qty === 1 ? last : undefined };
    }),
    answer(grantGraded, (ctx, { id, quality, qty = 1 }) => addGraded(ctx.state, id, quality, qty)),
    answer(takeGraded, (ctx, { id, quality, qty = 1 }) => removeGraded(ctx.state, id, quality, qty)),
    answer(takeStack, (ctx, { id, quality, qty }) => removeStack(ctx.state, id, quality, qty)),
  ],

  commands: [
    handle(discardStackable, (ctx, { id, quality, qty }) => {
      const removed = removeStack(ctx.state, id, quality, qty);
      if (removed <= 0) return skipped(`no ${gradeLabel(id, quality)}${MATERIALS[id]?.name ?? id} is held`);
      const def = MATERIALS[id];
      ctx.emit(logLine, {
        msg: fillText(TEXT.discarded_stack, {
          icon: def?.icon ?? '',
          grade: gradeLabel(id, quality),
          name: def?.name ?? id,
          qty: removed,
        }),
        kind: 'info',
      });
      return OK;
    }),
    handle(discardStackablesBatch, (ctx, { refs, noun = 'item' }) => {
      let units = 0;
      for (const { id, quality } of refs) {
        const have = isGraded(id) ? stockOf(ctx.state, id, quality) : (ctx.state.counts[id] ?? 0);
        units += removeStack(ctx.state, id, quality, have);
      }
      if (units === 0) return skipped('none of the listed stacks is held');
      ctx.emit(logLine, {
        msg: fillText(TEXT.discarded_units, { units, noun, plural: units === 1 ? '' : 's' }),
        kind: 'info',
      });
      return OK;
    }),
    handle(sellStackable, (ctx, { id, quality, qty }) => {
      const removed = removeStack(ctx.state, id, quality, qty);
      if (removed <= 0) return skipped(`no ${gradeLabel(id, quality)}${MATERIALS[id]?.name ?? id} is held`);
      const price = gradedUnitPrice(id, quality, statOf(ctx, 'goldGain')) * removed;
      ctx.request(addGold, { amount: price, earned: true });
      const def = MATERIALS[id];
      ctx.emit(logLine, {
        msg: fillText(TEXT.sold_stack, {
          icon: def?.icon ?? '',
          grade: gradeLabel(id, quality),
          name: def?.name ?? id,
          qty: removed,
          price,
        }),
        kind: 'item',
      });
      return OK;
    }),
    handle(sellStackablesBatch, (ctx, { refs, noun = 'item' }) => {
      const goldGain = statOf(ctx, 'goldGain');
      let total = 0;
      let units = 0;
      for (const { id, quality } of refs) {
        const have = isGraded(id) ? stockOf(ctx.state, id, quality) : (ctx.state.counts[id] ?? 0);
        const removed = removeStack(ctx.state, id, quality, have);
        if (removed > 0) {
          total += gradedUnitPrice(id, quality, goldGain) * removed;
          units += removed;
        }
      }
      if (units === 0) return skipped('none of the listed stacks is held');
      ctx.request(addGold, { amount: total, earned: true });
      ctx.emit(logLine, {
        msg: fillText(TEXT.sold_units, { units, noun, plural: units === 1 ? '' : 's', total }),
        kind: 'item',
      });
      return OK;
    }),
  ],

  view: (ctx) => {
    const state = ctx.state;
    const goldGain = statOf(ctx, 'goldGain');
    return {
      held: MATERIAL_LIST.filter((m) => heldOf(state, m.id) > 0).map((m) => ({
        id: m.id,
        name: m.name,
        icon: m.icon,
        value: m.value,
        qty: heldOf(state, m.id),
        sell: materialSellPrice(m.id, goldGain),
        grades: m.graded
          ? gradesHeld(state, m.id).map((g) => ({
              ...g,
              name: QUALITY_TIERS[g.quality].name,
              sell: gradedUnitPrice(m.id, g.quality, goldGain),
            }))
          : [],
      })),
    };
  },
});
