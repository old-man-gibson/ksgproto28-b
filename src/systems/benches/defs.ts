/**
 * The discipline registry and the pure rules of a bench: slots, placements,
 * the layout check, the outcome match, the parts a craft spends and the
 * novelty keys it credits, the heat windows and the timeline clock. Port of
 * old `systems/disciplines.ts` as far as the Alembic and the kitchen read it.
 * See README.md.
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
  role: s.enum(['base', 'component', 'seasoning', 'adornment', 'tool', 'design']),
  accepts: s.array(s.string(), { help: 'Craft tags; a material with any of them may go in.' }),
  optional: s.optional(s.boolean({ help: 'May stay empty. On an ordered bench a gap closes.' })),
  unlockLevel: s.optional(s.number({ help: 'Skill level that opens the slot.' })),
  station: s.optional(s.string({ help: 'Where the panel draws the slot.' })),
  picks: s.optional(s.enum(['material', 'design', 'tool'])),
  consumed: s.optional(s.boolean({ help: 'Spent by a craft. Default: true for a material slot.' })),
  at: s.optional(s.number({ min: 0, max: 1, help: 'Timed bench: the point of the cook this slot enters, 0 to 1.' })),
});

const outcomeSchema = s.object({
  id: s.id(),
  name: s.string({ minLength: 1 }),
  icon: s.string(),
  requires: s.array(s.object({ tag: s.string(), count: s.optional(s.number()) })),
  result: s.object({
    kind: s.string({ help: 'What the owner of the bench makes of a match: brewed (alchemy), material or prepped (cooking).' }),
    id: s.optional(s.string()),
    qty: s.optional(s.number({ help: 'Units made per craft. Default 1.' })),
  }),
  minLevel: s.optional(s.number()),
  recipe: s.optional(s.string({ help: 'A recipe the player must know (counter recipe:<id>).' })),
  minQuality: s.optional(s.enum(QUALITY_ORDER)),
  maxQuality: s.optional(s.enum(QUALITY_ORDER)),
  priority: s.optional(s.number()),
  heat: s.optional(
    s.array(
      s.object({
        tag: s.string(),
        from: s.optional(s.number({ help: 'Mean exposure at or above this.' })),
        to: s.optional(s.number({ help: 'Mean exposure below this.' })),
      }),
      { help: 'Heat windows: matches only when the mean exposure of the tagged parts falls inside.' },
    ),
  ),
  desc: s.optional(s.string()),
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
    assembles: s.optional(
      s.boolean({ help: 'An assembling bench (the anvil): each slot takes a part kind and a material; the owner computes the clock.' }),
    ),
    work: s.optional(
      s.object({
        skillScaled: s.optional(s.boolean({ help: 'False: craft speed does not change the clock.' })),
        per: s.optional(s.enum(['ingredient'])),
      }),
    ),
    ticks: s.number({ help: 'Ticks one craft takes before craft speed.' }),
    xp: s.number({ help: 'Skill XP of one craft before the owner scales it.' }),
    favoredPrep: s.optional(s.string({ help: 'The cut this bench rewards (a prep tag).' })),
    timeline: s.optional(
      s.object({
        options: s.array(s.object({ units: s.number({ min: 1 }), name: s.string() })),
        default: s.number({ min: 1 }),
      }),
    ),
    slots: s.array(slotSchema),
    outcomes: s.array(outcomeSchema),
    desc: s.optional(s.string()),
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

// ---- heat windows (old `disciplines.ts`) ----

export type HeatWindow = NonNullable<OutcomeDef['heat']>[number];

/** The duration a timed bench cooks for: the chosen one, or its default. */
export function timelineUnits(disc: DisciplineDef, duration?: number): number | undefined {
  return disc.timeline ? (duration ?? disc.timeline.default) : undefined;
}

/**
 * The mean exposure, in timeline units, of the placed parts carrying `tag`:
 * duration x (1 - slot.at) per part, over timed slots only. Null when the
 * bench has no timeline or no timed part carries the tag.
 */
export function meanExposure(disc: DisciplineDef, placement: Placement, tag: string, duration?: number): number | null {
  const units = timelineUnits(disc, duration);
  if (units === undefined) return null;
  let sum = 0;
  let n = 0;
  for (const [slotId, part] of Object.entries(placement)) {
    if (!part) continue;
    const at = disc.slots.find((s) => s.id === slotId)?.at;
    if (at == null || !craftTagsOf(part.id).includes(tag)) continue;
    sum += units * (1 - at);
    n++;
  }
  return n > 0 ? sum / n : null;
}

/** Whether a mean exposure lies in the half-open window [from, to). */
export function inHeatWindow(mean: number, window: { from?: number; to?: number }): boolean {
  return (window.from === undefined || mean >= window.from) && (window.to === undefined || mean < window.to);
}

/** A stated mean exposure for one tag, for read-only what-ifs. */
export interface HeatOverride {
  tag: string;
  mean: number;
}

function heatMatches(
  o: OutcomeDef,
  disc: DisciplineDef,
  placement: Placement,
  duration?: number,
  override?: HeatOverride,
): boolean {
  return (o.heat ?? []).every((w) => {
    const mean = override?.tag === w.tag ? override.mean : meanExposure(disc, placement, w.tag, duration);
    return mean !== null && inHeatWindow(mean, w);
  });
}

/** A window in the words the bench uses: "under 6", "14 or more", "8 to 14". */
export function describeHeatWindow(window: { from?: number; to?: number }): string {
  const { from, to } = window;
  if (from !== undefined && to !== undefined) return `${from} to ${to}`;
  if (to !== undefined) return `under ${to}`;
  return `${from ?? 0} or more`;
}

function subsetsOf<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  return [...subsetsOf(rest, size - 1).map((tail) => [head, ...tail]), ...subsetsOf(rest, size)];
}

/**
 * Problems with the heat windows on one bench, keyed by outcome id. The old
 * `heatWindowProblems`, shared by the tests and the forge.
 */
export function heatWindowProblems(
  disc: DisciplineDef,
  materials: Record<string, { craftTags?: readonly string[] }>,
): { outcome: string; message: string }[] {
  const problems: { outcome: string; message: string }[] = [];
  const stock = Object.values(materials);
  for (const o of disc.outcomes) {
    const windows = o.heat ?? [];
    if (windows.length === 0) continue;
    const say = (message: string) => problems.push({ outcome: o.id, message });
    if (!disc.timeline) {
      say(`${disc.id}/${o.id} has heat windows, but ${disc.id} has no timeline`);
      continue;
    }
    for (const w of windows) {
      if (w.from !== undefined && w.to !== undefined && w.from >= w.to) {
        say(`${disc.id}/${o.id}: the window on '${w.tag}' is empty (from ${w.from} is not below to ${w.to})`);
      }
    }
    const demand = (tag: string) => o.requires.filter((r) => r.tag === tag).reduce((sum, r) => sum + (r.count ?? 1), 0);
    const fallback = disc.outcomes.find(
      (f) =>
        f !== o &&
        !f.heat?.length &&
        !f.recipe &&
        !f.minLevel &&
        !f.minQuality &&
        !f.maxQuality &&
        (f.priority ?? 0) < (o.priority ?? 0) &&
        f.requires.every((r) => demand(r.tag) >= (r.count ?? 1)),
    );
    if (!fallback) {
      say(
        `${disc.id}/${o.id} has no window-less fallback: needs an outcome of lower priority on this bench, ` +
          `with no recipe, minLevel, minQuality or maxQuality, whose requires its own requires cover`,
      );
    }
    const level = o.minLevel ?? 0;
    const entries = disc.slots.filter((s) => s.at != null && slotPicks(s) === 'material' && (s.unlockLevel ?? 0) <= level);
    const holders = (tag: string) =>
      entries.filter((s) =>
        stock.some((m) => {
          const tags = m.craftTags ?? [];
          return tags.includes(tag) && s.accepts.some((a) => tags.includes(a));
        }),
      );
    const need = (tag: string) => Math.max(1, demand(tag));
    const timeline = disc.timeline;
    const reachable = timeline.options.some((opt) =>
      windows.every((w) =>
        subsetsOf(holders(w.tag), need(w.tag)).some((set) =>
          inHeatWindow(set.reduce((sum, s) => sum + opt.units * (1 - s.at!), 0) / set.length, w),
        ),
      ),
    );
    if (!reachable) {
      const named = windows
        .map((w) => `${need(w.tag) > 1 ? `${need(w.tag)} × ` : ''}'${w.tag}' ${describeHeatWindow(w)}`)
        .join(' and ');
      say(
        `${disc.id}/${o.id}: no timeline option and entry slot open at level ${level} puts a part inside ` +
          `${named} — the dish could never be made`,
      );
    }
  }
  return problems;
}

/**
 * What this combination makes: the most specific match wins, ties broken by
 * how much the outcome demanded. The old `matchOutcome`: `duration` is a
 * timed bench's chosen length (its default when absent); `override` replaces
 * the measured mean of one tag, for read-only what-ifs.
 */
export function matchOutcome(
  reads: BenchReads,
  disc: DisciplineDef,
  placement: Placement,
  duration?: number,
  override?: HeatOverride,
): OutcomeDef | undefined {
  const counts = tagCounts(placement);
  const best = bestQuality(placement);
  const matches = disc.outcomes.filter((o) => {
    if ((o.minLevel ?? 0) > reads.level) return false;
    if (o.recipe && !reads.knowsRecipe(o.recipe)) return false;
    if (o.minQuality && (!best || !qualityAtLeast(best, o.minQuality))) return false;
    if (o.maxQuality && best && qualityRank(best) > qualityRank(o.maxQuality)) return false;
    if (!o.requires.every((r) => (counts.get(r.tag) ?? 0) >= (r.count ?? 1))) return false;
    return heatMatches(o, disc, placement, duration, override);
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
export function checkCraft(reads: BenchReads, disc: DisciplineDef, placement: Placement, duration?: number): CraftCheck {
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
  const outcome = matchOutcome(reads, disc, placement, duration);
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

/** One timeline unit on a timed bench is one second on the clock. */
export const UNIT_TICKS = 10;

/**
 * How long one craft takes as laid out. The old `benchJobTicks`: an
 * assembling bench (the anvil) takes the work its owner states for the
 * parts (`assembledTicks`, old `forgeTicks`); a timed bench runs its chosen
 * duration; `per: 'ingredient'` adds `ticks` per filled slot; a skill-scaled
 * bench divides by craft speed.
 */
export function benchJobTicks(
  disc: DisciplineDef,
  placement: Placement,
  craftSpeed: number,
  duration?: number,
  assembledTicks?: number,
): { ticksPer: number; batch: number } {
  let base: number;
  if (disc.assembles) {
    base = assembledTicks ?? disc.ticks;
  } else if (disc.timeline) {
    base = (duration ?? disc.timeline.default) * UNIT_TICKS;
  } else {
    base = disc.ticks;
    if (disc.work?.per === 'ingredient') base *= Math.max(1, placed(placement).length);
  }
  if (disc.work?.skillScaled === false) return { ticksPer: base, batch: 1 };
  return benchPace(craftSpeed, base);
}
