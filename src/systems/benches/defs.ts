/**
 * The discipline registry and the pure rules of a bench: slots, placements,
 * the layout check, the outcome match, the parts a craft spends and the
 * novelty keys it credits. Port of old `systems/disciplines.ts` as far as
 * the Alembic reads it (no heat windows, no timeline). See README.md.
 */
import { registry, s, type DeepReadonly, type RecordOf } from '../../kernel';
import { textSchema, type TextRecord } from '../log';
import {
  craftTagsOf,
  MATERIALS,
  qualityAtLeast,
  qualityMult,
  qualityRank,
  stockOf,
  QUALITY_ORDER,
  type MaterialsState,
  type QualityTier,
} from '../materials';
import disciplinesData from './content/disciplines.json';
import textData from './content/benches_text.json';

export const TEXT: Record<string, string> = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
export const benchesText = registry(textSchema, textData, 'Bench text');

const slotSchema = s.object({
  id: s.id(),
  name: s.string({ minLength: 1 }),
  role: s.enum(['base', 'component', 'seasoning', 'tool', 'design']),
  accepts: s.array(s.string(), { help: 'Craft tags; a material with any of them may go in.' }),
  optional: s.optional(s.boolean({ help: 'May stay empty. On an ordered bench a gap closes.' })),
  unlockLevel: s.optional(s.number({ help: 'Skill level that opens the slot.' })),
  station: s.optional(s.string({ help: 'Where the panel draws the slot.' })),
  picks: s.optional(s.enum(['material', 'design', 'tool'])),
  consumed: s.optional(s.boolean({ help: 'Spent by a craft. Default: true for a material slot.' })),
});

const outcomeSchema = s.object({
  id: s.id(),
  name: s.string({ minLength: 1 }),
  icon: s.string(),
  requires: s.array(s.object({ tag: s.string(), count: s.optional(s.number()) })),
  result: s.object({
    kind: s.string({ help: 'What the owner of the bench makes of a match: brewed (alchemy).' }),
    id: s.optional(s.string()),
  }),
  minLevel: s.optional(s.number()),
  recipe: s.optional(s.string({ help: 'A recipe the player must know (counter recipe:<id>).' })),
  minQuality: s.optional(s.enum(QUALITY_ORDER)),
  maxQuality: s.optional(s.enum(QUALITY_ORDER)),
  priority: s.optional(s.number()),
});

export const disciplines = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    benchName: s.optional(s.string()),
    icon: s.string(),
    verb: s.optional(s.string()),
    skill: s.string({ help: 'The skill that gates and scales the bench.' }),
    tag: s.string({ help: 'The action tag a craft trains and discovers by.' }),
    ordered: s.optional(s.boolean({ help: 'Slots are a sequence: gaps close and order is part of the craft.' })),
    work: s.optional(
      s.object({
        skillScaled: s.optional(s.boolean({ help: 'False: craft speed does not change the clock.' })),
        per: s.optional(s.enum(['ingredient'])),
      }),
    ),
    ticks: s.number({ help: 'Ticks one craft takes before craft speed.' }),
    xp: s.number({ help: 'Skill XP of one craft before the owner scales it.' }),
    slots: s.array(slotSchema),
    outcomes: s.array(outcomeSchema),
  }),
  disciplinesData,
  'Disciplines',
);

export type DisciplineDef = RecordOf<typeof disciplines>;
export type SlotDef = DisciplineDef['slots'][number];
export type OutcomeDef = DisciplineDef['outcomes'][number];

export const DISCIPLINE_LIST = disciplinesData as unknown as DisciplineDef[];
export const DISCIPLINES: Record<string, DisciplineDef> = Object.fromEntries(DISCIPLINE_LIST.map((d) => [d.id, d]));

/** One stack laid on a bench: a material at a grade. */
export interface GradedStack {
  id: string;
  quality: QualityTier;
}

/** What is laid out on a bench, slot id to what is in it. */
export type Placement = Record<string, GradedStack | undefined>;

/** What a bench rule reads: the bench's skill level, the stock and the counters. */
export interface BenchReads {
  level: number;
  materials: DeepReadonly<MaterialsState>;
  /** Whether the player knows a recipe (counter `recipe:<id>`). */
  knowsRecipe(id: string): boolean;
}

/** The counter a learned recipe stamps. */
export const recipeKey = (id: string): string => `recipe:${id}`;

// ---- slots ----

/** The slots open at this level. The old `openSlots`. */
export function openSlots(disc: DisciplineDef, level: number): SlotDef[] {
  return disc.slots.filter((s) => (s.unlockLevel ?? 0) <= level);
}

/** The next slot the skill opens, and at what level. The old `nextSlot`. */
export function nextSlot(disc: DisciplineDef, level: number): { slot: SlotDef; level: number } | undefined {
  const locked = disc.slots
    .filter((s) => (s.unlockLevel ?? 0) > level)
    .sort((a, b) => (a.unlockLevel ?? 0) - (b.unlockLevel ?? 0));
  return locked.length ? { slot: locked[0], level: locked[0].unlockLevel! } : undefined;
}

export function slotAccepts(slot: SlotDef, materialId: string): boolean {
  const tags = craftTagsOf(materialId);
  return slot.accepts.some((t) => tags.includes(t));
}

export function slotPicks(slot: SlotDef): 'material' | 'design' | 'tool' {
  return slot.picks ?? 'material';
}

/** Whether working the bench spends what is in this slot. Tools survive. */
export function slotConsumes(slot: SlotDef): boolean {
  return slot.consumed ?? slotPicks(slot) === 'material';
}

// ---- matching ----

export function placed(placement: Placement): GradedStack[] {
  return Object.values(placement).filter((v): v is GradedStack => !!v);
}

/** The mean grade multiplier of what went in. The old `combinedQuality`. */
export function combinedQuality(placement: Placement): number {
  const parts = placed(placement);
  if (!parts.length) return 0;
  return parts.reduce((sum, p) => sum + qualityMult(p.quality), 0) / parts.length;
}

/** The best single grade on the bench. The old `bestQuality`. */
export function bestQuality(placement: Placement): QualityTier | undefined {
  const parts = placed(placement);
  if (!parts.length) return undefined;
  return parts.reduce((best, p) => (qualityRank(p.quality) > qualityRank(best) ? p.quality : best), 'f' as QualityTier);
}

function tagCounts(placement: Placement): Map<string, number> {
  const counts = new Map<string, number>();
  for (const part of placed(placement)) {
    for (const tag of craftTagsOf(part.id)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/**
 * What this combination makes: the most specific match wins, ties broken by
 * how much the outcome demanded. The old `matchOutcome` without heat windows
 * (cooking's timeline is not ported).
 */
export function matchOutcome(reads: BenchReads, disc: DisciplineDef, placement: Placement): OutcomeDef | undefined {
  const counts = tagCounts(placement);
  const best = bestQuality(placement);
  const matches = disc.outcomes.filter((o) => {
    if ((o.minLevel ?? 0) > reads.level) return false;
    if (o.recipe && !reads.knowsRecipe(o.recipe)) return false;
    if (o.minQuality && (!best || !qualityAtLeast(best, o.minQuality))) return false;
    if (o.maxQuality && best && qualityRank(best) > qualityRank(o.maxQuality)) return false;
    return o.requires.every((r) => (counts.get(r.tag) ?? 0) >= (r.count ?? 1));
  });
  return matches.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.requires.length - a.requires.length)[0];
}

export interface CraftCheck {
  ok: boolean;
  reason?: string;
  outcome?: OutcomeDef;
}

const fill = (id: string, params: Record<string, unknown>): string =>
  TEXT[id].replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : String(params[name])));

/** Whether the bench as laid out could be worked. The old `checkCraft`. */
export function checkCraft(reads: BenchReads, disc: DisciplineDef, placement: Placement): CraftCheck {
  const open = openSlots(disc, reads.level);
  // Slots that spend the same material at the same grade draw on one stack.
  const demand = new Map<string, number>();
  for (const slot of open) {
    const put = placement[slot.id];
    if (!put) {
      if (slot.optional) continue;
      return { ok: false, reason: fill('slot_empty', { slot: slot.name }) };
    }
    if (slotPicks(slot) !== 'material') continue;
    const name = MATERIALS[put.id]?.name ?? put.id;
    if (!slotAccepts(slot, put.id)) return { ok: false, reason: fill('wrong_slot', { name, slot: slot.name }) };
    // The old check read graded stock only (`stockOf`); a plain material held
    // reads as none. Every reagent is graded.
    const held = stockOf(reads.materials, put.id, put.quality);
    if (held < 1) return { ok: false, reason: fill('no_stock_at_grade', { name }) };
    if (!slotConsumes(slot)) continue;
    const key = `${put.id}:${put.quality}`;
    const need = (demand.get(key) ?? 0) + 1;
    demand.set(key, need);
    if (held < need) return { ok: false, reason: fill('short_at_grade', { name, held, need }) };
  }
  for (const id of Object.keys(placement)) {
    if (placement[id] && !open.some((s) => s.id === id)) return { ok: false, reason: TEXT.slot_locked };
  }
  const outcome = matchOutcome(reads, disc, placement);
  if (!outcome) return { ok: false, reason: TEXT.no_outcome };
  return { ok: true, outcome };
}

/** Only what is spent into the result. The old `consumedParts`. */
export function consumedParts(disc: DisciplineDef, placement: Placement): GradedStack[] {
  const spend = new Set(disc.slots.filter((s) => slotConsumes(s)).map((s) => s.id));
  return Object.entries(placement)
    .filter(([id, v]) => v && spend.has(id))
    .map(([, v]) => v!);
}

/**
 * The novelty keys a craft credits: the combination, and each part. On an
 * ordered bench the combination keeps its order. The old `noveltyKeys`.
 */
export function noveltyKeys(disc: DisciplineDef, placement: Placement): string[] {
  const parts = disc.ordered
    ? disc.slots.map((s) => placement[s.id]).filter((p): p is GradedStack => !!p)
    : placed(placement);
  const ids = parts.map((p) => p.id);
  const combo = (disc.ordered ? ids : [...ids].sort()).join(disc.ordered ? '>' : '+');
  return [`${disc.id}:${combo}`, ...parts.map((p) => `${disc.id}:part:${p.id}`)];
}

// ---- the clock ----

/** No single craft under one second, however fast the hands. */
export const BENCH_FLOOR_TICKS = 10;

/** Ticks per completion and crafts per completion, from craft speed. The old `benchPace`. */
export function benchPace(craftSpeed: number, baseTicks: number): { ticksPer: number; batch: number } {
  const effective = baseTicks / Math.max(0.1, craftSpeed);
  if (effective >= BENCH_FLOOR_TICKS) return { ticksPer: Math.round(effective), batch: 1 };
  return { ticksPer: BENCH_FLOOR_TICKS, batch: Math.max(1, Math.floor(BENCH_FLOOR_TICKS / effective)) };
}

/** How long one craft takes as laid out. The old `benchJobTicks` without the timeline and the anvil. */
export function benchJobTicks(
  disc: DisciplineDef,
  placement: Placement,
  craftSpeed: number,
): { ticksPer: number; batch: number } {
  let base = disc.ticks;
  if (disc.work?.per === 'ingredient') base *= Math.max(1, placed(placement).length);
  if (disc.work?.skillScaled === false) return { ticksPer: base, batch: 1 };
  return benchPace(craftSpeed, base);
}
