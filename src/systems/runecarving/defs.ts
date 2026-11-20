/**
 * Runecarving content and rules. Port of `RUNE_PATTERNS`, `RUNE_ADORNMENTS`
 * and `NAMED_RUNES` of the old `data/runes.data.ts`; the composition half of
 * the old `systems/runes.ts` (`carvedKey`, `namedRuneFor`,
 * `adornmentEffectAt`, `patternEffectAt`, `composeCarved`, `RESONANCE`,
 * `clearCarvedCache`); and the pure half of the old
 * `systems/runecarving.ts` (`countPatterns`, `REPEAT_MIN_QUALITY`,
 * `failureChance`, `previewCarve`). No state.
 */
import { registry, s, type DeepReadonly, type RecordOf } from '../../kernel';
import { checkCraft, DISCIPLINES, openSlots, slotPicks, type BenchReads, type GradedStack, type Placement } from '../benches';
import {
  RUNE_CONTEXTS,
  runeRiders,
  type CarvedRune,
  type RuneContext,
  type RuneDef,
  type RuneEffect,
  type RuneRider,
  describeMod,
  fmt,
  pct,
} from '../items';
import { fillText, textSchema, type TextRecord } from '../log';
import { MATERIALS, QUALITY_ORDER, QUALITY_TIERS, qualityAtLeast, qualityMult, type QualityTier } from '../materials';
import { DAMAGE_TYPES, modifierSchema, type ContentMod, type DamageType } from '../stats';
import adornmentsData from './content/rune_adornments.json';
import namedData from './content/named_runes.json';
import patternsData from './content/rune_patterns.json';
import textData from './content/runecarving_text.json';

// ---- content ----

const riderSchema = s.object({ type: s.enum(DAMAGE_TYPES), value: s.number() });

const effectSchema = s.object({
  context: s.enum(RUNE_CONTEXTS),
  mods: s.optional(s.array(modifierSchema)),
  bonusDamage: s.optional(riderSchema),
  bonusDamagePct: s.optional(riderSchema),
});

export const runePatterns = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    desc: s.optional(s.string()),
    minLevel: s.optional(s.number({ help: 'Runecarving level before the pattern may be cut.' })),
    effects: s.array(effectSchema, { help: 'Stated at Fair (C) strength: the slab grade scales them.' }),
  }),
  patternsData,
  'Rune patterns',
);

export const runeAdornments = registry(
  s.object({
    id: s.ref('materials', { help: 'The material worked into the slab.' }),
    effects: s.array(effectSchema, { help: 'At Fair (C) strength: the adornment grade scales them.' }),
  }),
  adornmentsData,
  'Rune adornments',
);

export const namedRunes = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    desc: s.optional(s.string()),
    patterns: s.array(s.string(), { help: 'The exact multiset of cuts.' }),
    adornments: s.array(s.string(), { help: 'The exact multiset of adornments, by material id.' }),
    minQuality: s.optional(s.enum(QUALITY_ORDER)),
    bonus: s.array(effectSchema),
  }),
  namedData,
  'Named runes',
);

export const runecarvingText = registry(textSchema, textData, 'Runecarving text');

export const TEXT: Record<string, string> = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
export const say = (id: string, params?: Record<string, unknown>): string => fillText(TEXT[id], params);

/** A pattern as composition reads it. The effect may carry technique surgery (tests add such patterns). */
export type RunePatternDef = Omit<RecordOf<typeof runePatterns>, 'effects'> & { effects: RuneEffect[] };
export type RuneAdornmentDef = Omit<RecordOf<typeof runeAdornments>, 'effects'> & { effects: RuneEffect[] };
export type NamedRuneDef = Omit<RecordOf<typeof namedRunes>, 'bonus'> & { bonus: RuneEffect[] };

/** Mutable on purpose: the old tests register patterns of their own. */
export const RUNE_PATTERNS: Record<string, RunePatternDef> = Object.fromEntries(
  (patternsData as unknown as RunePatternDef[]).map((p) => [p.id, p]),
);
export const RUNE_ADORNMENTS: Record<string, RuneAdornmentDef> = Object.fromEntries(
  (adornmentsData as unknown as RuneAdornmentDef[]).map((a) => [a.id, a]),
);
export const NAMED_RUNES = namedData as unknown as NamedRuneDef[];

export const RUNECARVING = DISCIPLINES.runecarving;

// ---- composition (old `runes.ts`) ----

/** Code-unit string order: the order `Array.prototype.sort()` gives, with no locale in it. */
function byCode(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const adornmentKey = (a: DeepReadonly<GradedStack>): string => `${a.id}.${a.quality}`;

function canonicalAdornments(adornments: readonly DeepReadonly<GradedStack>[]): DeepReadonly<GradedStack>[] {
  return [...adornments].sort((a, b) => byCode(adornmentKey(a), adornmentKey(b)));
}

/** A carving's identity and its shareable form. Patterns and adornments are multisets, so both are sorted. */
export function carvedKey(rune: DeepReadonly<CarvedRune>): string {
  const cuts = [...rune.patterns].sort().join(',');
  const adorn = canonicalAdornments(rune.adornments).map(adornmentKey).join('+');
  return `${cuts}@${rune.stone.id}.${rune.stone.quality}${adorn ? `/${adorn}` : ''}`;
}

/** A grade's multiplier, floored at 0: a Refuse grade reads as nothing, never as a penalty. */
function gradeMult(quality: QualityTier): number {
  return Math.max(0, qualityMult(quality));
}

const effectIn = (effects: readonly RuneEffect[] | undefined, ctx: RuneContext): RuneEffect | undefined =>
  effects?.find((e) => e.context === ctx);

/** One rider per damage type, in damage-type order. Undefined when nothing is left. */
function foldRiders(...lists: (RuneRider | RuneRider[] | undefined)[]): RuneRider[] | undefined {
  const sums = new Map<DamageType, number>();
  for (const list of lists) {
    for (const r of runeRiders(list)) sums.set(r.type, (sums.get(r.type) ?? 0) + r.value);
  }
  const folded = [...sums]
    .filter(([, value]) => value !== 0)
    .sort(([a], [b]) => byCode(a, b))
    .map(([type, value]) => ({ type, value }));
  return folded.length ? folded : undefined;
}

/** Scale the magnitudes of an effect. A multiplier of 0 or less grants nothing. Technique surgery passes unscaled. */
function scaleEffect(effect: RuneEffect | undefined, mult: number, ctx: RuneContext): RuneEffect | undefined {
  if (!effect || !(mult > 0)) return undefined;
  const out: RuneEffect = { context: ctx };
  if (effect.mods) out.mods = effect.mods.map((m) => ({ ...m, value: m.value * mult }));
  const flat = runeRiders(effect.bonusDamage).map((r) => ({ ...r, value: r.value * mult }));
  if (flat.length) out.bonusDamage = flat;
  const pct = runeRiders(effect.bonusDamagePct).map((r) => ({ ...r, value: r.value * mult }));
  if (pct.length) out.bonusDamagePct = pct;
  if (effect.techniqueMods) out.techniqueMods = effect.techniqueMods.map((m) => ({ ...m }));
  return out;
}

/** Fold `add` into `into`: mods and surgery concatenate, riders sum per type. Always a fresh effect. */
function mergeEffect(into: RuneEffect | undefined, add: RuneEffect | undefined, ctx: RuneContext): RuneEffect | undefined {
  if (!add) return into;
  const out: RuneEffect = { context: ctx };
  const mods = [...(into?.mods ?? []), ...(add.mods ?? [])];
  if (mods.length) out.mods = mods;
  const flat = foldRiders(into?.bonusDamage, add.bonusDamage);
  if (flat) out.bonusDamage = flat;
  const pct = foldRiders(into?.bonusDamagePct, add.bonusDamagePct);
  if (pct) out.bonusDamagePct = pct;
  const surgery = [...(into?.techniqueMods ?? []), ...(add.techniqueMods ?? [])];
  if (surgery.length) out.techniqueMods = surgery;
  return out;
}

/** The named work this exact combination is, if any. The old `namedRuneFor`. */
export function namedRuneFor(rune: DeepReadonly<CarvedRune>): NamedRuneDef | undefined {
  const cuts = [...rune.patterns].sort().join(',');
  const have = rune.adornments.map((a) => a.id).sort().join(',');
  return NAMED_RUNES.find(
    (n) =>
      [...n.patterns].sort().join(',') === cuts &&
      [...n.adornments].sort().join(',') === have &&
      (!n.minQuality || qualityAtLeast(rune.stone.quality, n.minQuality)),
  );
}

/**
 * How much extra each repeat of a pattern is worth beyond simply adding.
 * The old `RESONANCE`.
 */
export const RESONANCE = 0.25;

/** What one adornment gives at a grade. The old `adornmentEffectAt`. */
export function adornmentEffectAt(id: string, quality: QualityTier, ctx: RuneContext): RuneEffect | undefined {
  return scaleEffect(effectIn(RUNE_ADORNMENTS[id]?.effects, ctx), gradeMult(quality), ctx);
}

/** What one pattern gives, cut `copies` times into a slab of `quality`. The old `patternEffectAt`. */
export function patternEffectAt(id: string, quality: QualityTier, ctx: RuneContext, copies = 1): RuneEffect | undefined {
  const stacked = copies + (copies - 1) * RESONANCE;
  return scaleEffect(effectIn(RUNE_PATTERNS[id]?.effects, ctx), gradeMult(quality) * stacked, ctx);
}

/** Composed carvings, keyed by combination. A carving never changes once made. */
const CARVED_CACHE = new Map<string, RuneDef>();

/** Test hook: empty the memo. Nothing in the game calls it. The old `clearCarvedCache`. */
export function clearCarvedCache(): void {
  CARVED_CACHE.clear();
}

/** Distinct patterns in canonical order: most copies first, then pattern id. */
function patternGroups(patterns: readonly string[]): { id: string; copies: number }[] {
  const counts = new Map<string, number>();
  for (const id of patterns) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, copies]) => ({ id, copies })).sort((a, b) => b.copies - a.copies || byCode(a.id, b.id));
}

/**
 * A carving composed into an ordinary rune: the patterns at the slab's grade,
 * each distinct pattern at a falling share (1 / (1 + 0.6 i)), repeats of one
 * pattern stacked with resonance, each adornment at its own grade, a named
 * work's bonus on top. The old `composeCarved`. Memoised by key.
 */
export function composeCarved(rune: DeepReadonly<CarvedRune>): RuneDef {
  const key = carvedKey(rune);
  const cached = CARVED_CACHE.get(key);
  if (cached) return cached;

  const groups = patternGroups(rune.patterns);
  // Only patterns that still exist take a share; a deleted one is inert.
  const cut = groups.filter((g) => RUNE_PATTERNS[g.id]);
  const adornments = canonicalAdornments(rune.adornments);
  const stone = gradeMult(rune.stone.quality);
  const share = (i: number) => 1 / (1 + i * 0.6);
  const byContext = new Map<RuneContext, RuneEffect>();

  for (const ctx of RUNE_CONTEXTS) {
    let effect: RuneEffect | undefined;
    for (const [i, g] of cut.entries()) {
      const stacked = g.copies + (g.copies - 1) * RESONANCE;
      effect = mergeEffect(effect, scaleEffect(effectIn(RUNE_PATTERNS[g.id].effects, ctx), stone * share(i) * stacked, ctx), ctx);
    }
    for (const a of adornments) {
      effect = mergeEffect(effect, scaleEffect(effectIn(RUNE_ADORNMENTS[a.id]?.effects, ctx), gradeMult(a.quality), ctx), ctx);
    }
    if (effect) byContext.set(ctx, effect);
  }

  const named = namedRuneFor(rune);
  if (named) {
    for (const ctx of RUNE_CONTEXTS) {
      const merged = mergeEffect(byContext.get(ctx), effectIn(named.bonus, ctx), ctx);
      if (merged) byContext.set(ctx, merged);
    }
  }

  // The first canonical group names the rune and lends its icon and description.
  const grade = QUALITY_TIERS[rune.stone.quality];
  const lead = cut[0] ?? groups[0];
  const leadDef = lead ? RUNE_PATTERNS[lead.id] : undefined;
  const leadName = leadDef?.name ?? lead?.id ?? 'Rune';
  const leadCopies = lead?.copies ?? 0;
  const distinct = groups.length;
  const plainName =
    leadCopies > 1 && distinct === 1
      ? `${grade.name} ${leadName} ×${leadCopies}`
      : distinct > 1
        ? `${grade.name} ${leadName} (+${distinct - 1})`
        : `${grade.name} ${leadName}`;
  const desc = named?.desc ?? leadDef?.desc;
  const composed: RuneDef = {
    id: key,
    name: named?.name ?? plainName,
    icon: named?.icon ?? leadDef?.icon ?? '🔷',
    ...(desc !== undefined ? { desc } : {}),
    value: Math.max(1, Math.round(10 * Math.max(0.1, stone) * (1 + rune.adornments.length))),
    effects: RUNE_CONTEXTS.filter((c) => byContext.has(c)).map((c) => byContext.get(c)!),
  };
  CARVED_CACHE.set(key, composed);
  return composed;
}

// ---- the bench (old `runecarving.ts`) ----

/** How many times each pattern appears, in first-appearance order. */
export function countPatterns(patterns: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of patterns) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** How good the slab must be to take the same pattern more than once, by copies. */
export const REPEAT_MIN_QUALITY: Record<number, QualityTier> = { 2: 'b', 3: 'a' };

/** Patterns open at this Runecarving level. The old `availablePatterns`. */
export function availablePatterns(level: number): RunePatternDef[] {
  return Object.values(RUNE_PATTERNS).filter((p) => (p.minLevel ?? 0) <= level);
}

/** The pattern slots open at this level, in bench order. The old `patternSlots`. */
export function patternSlots(level: number) {
  return openSlots(RUNECARVING, level).filter((s) => slotPicks(s) === 'design');
}

/** Split chance with no tool, before skill. */
export const BASE_FAILURE = 0.3;
/** Each pattern beyond the first. */
export const FAILURE_PER_EXTRA_PATTERN = 0.12;
/** Each level of Runecarving. */
export const FAILURE_PER_LEVEL = 0.02;

/**
 * The chance the slab splits. A tool removes a share of the risk left (its
 * grade x 0.28, at most 0.85); an F tool counts as none. No floor; held to
 * [0, 0.95]. The old `failureChance`.
 */
export function failureChance(level: number, placement: Placement): number {
  const patterns = patternSlots(level).filter((s) => placement[s.id]).length;
  const tool = placement.tool;
  const toolGrade = tool ? Math.max(0, qualityMult(tool.quality)) : 0;
  let risk = BASE_FAILURE + Math.max(0, patterns - 1) * FAILURE_PER_EXTRA_PATTERN;
  risk -= level * FAILURE_PER_LEVEL;
  risk *= 1 - Math.min(0.85, toolGrade * 0.28);
  return Math.max(0, Math.min(0.95, risk));
}

export interface CarveCheck {
  ok: boolean;
  reason?: string;
  /** What would come out, if the cut went well. */
  preview?: CarvedRune;
  failure?: number;
}

/** Everything worked into the slab (not the slab, not the tool), in slot order. */
function adornmentsOf(level: number, placement: Placement): GradedStack[] {
  return openSlots(RUNECARVING, level)
    .filter((s) => s.role === 'adornment' && slotPicks(s) === 'material')
    .map((s) => placement[s.id])
    .filter((a): a is GradedStack => !!a);
}

/** The carving this layout would make, spending nothing. The old `previewCarve`. */
export function previewCarve(reads: BenchReads, placement: Placement): CarveCheck {
  const level = reads.level;
  const patterns: string[] = [];
  for (const slot of patternSlots(level)) {
    const chosen = placement[slot.id];
    if (!chosen) continue;
    const pattern = RUNE_PATTERNS[chosen.id];
    if (!pattern) return { ok: false, reason: say('reason_no_such_pattern') };
    if ((pattern.minLevel ?? 0) > level) {
      return { ok: false, reason: say('reason_pattern_level', { name: pattern.name, level: pattern.minLevel }) };
    }
    patterns.push(chosen.id);
  }
  if (patterns.length === 0) return { ok: false, reason: say('reason_nothing_chosen') };

  // A Refuse (F) grade multiplies below zero; no new carving is made from one.
  const slab = placement.slab;
  if (slab && qualityMult(slab.quality) < 0) return { ok: false, reason: say('reason_slab_refuse') };
  const adornments = adornmentsOf(level, placement);
  for (const a of adornments) {
    if (qualityMult(a.quality) < 0) {
      return { ok: false, reason: say('reason_adornment_refuse', { name: MATERIALS[a.id]?.name ?? a.id }) };
    }
  }

  for (const [id, copies] of countPatterns(patterns)) {
    if (copies < 2) continue;
    const needed = REPEAT_MIN_QUALITY[copies];
    if (!needed) {
      const max = Math.max(...Object.keys(REPEAT_MIN_QUALITY).map(Number));
      return { ok: false, reason: say('reason_too_many_copies', { max }) };
    }
    if (!slab || !qualityAtLeast(slab.quality, needed)) {
      return {
        ok: false,
        reason: say('reason_slab_grade', { copies, name: RUNE_PATTERNS[id].name, grade: QUALITY_TIERS[needed].name }),
      };
    }
  }

  const check = checkCraft(reads, RUNECARVING, placement);
  if (!check.ok) return { ok: false, reason: check.reason };
  if (!slab) return { ok: false, reason: say('reason_no_slab') };

  return {
    ok: true,
    preview: { patterns, stone: { ...slab }, adornments: adornments.map((a) => ({ ...a })) },
    failure: failureChance(level, placement),
  };
}

// ---- text ----

/** Display name of a damage type (old `DAMAGE_TYPE_NAMES`: the id with a capital). */
export function damageTypeName(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** One effect as a line: mods, then flat riders, then percent riders. The old `describeRuneEffect`. */
export function describeRuneEffect(effect: DeepReadonly<RuneEffect> | undefined): string {
  if (!effect) return 'inert';
  const parts = (effect.mods ?? []).map((m) => describeMod(m as ContentMod));
  for (const r of runeRiders(effect.bonusDamage)) parts.push(`+${fmt(r.value)} ${damageTypeName(r.type)} damage`);
  for (const r of runeRiders(effect.bonusDamagePct)) parts.push(`+${pct(r.value)} damage as ${damageTypeName(r.type)}`);
  return parts.length ? parts.join(', ') : 'inert';
}
