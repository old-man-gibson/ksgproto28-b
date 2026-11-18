/**
 * The dish rules, pure over a bench reads context: what each part puts into
 * the dish (exposure, uniformity), the cook's judgement, the bench fit, the
 * ledger, the grade range and the preview. Port of old `systems/cooking.ts`
 * up to `previewCook`; working the bench is in `index.ts`.
 */
import type { Rng } from '../../kernel';
import {
  checkCraft,
  matchOutcome,
  meanExposure,
  slotPicks,
  DISCIPLINES,
  type BenchReads,
  type DisciplineDef,
  type GradedStack,
  type OutcomeDef,
  type Placement,
  type SlotDef,
} from '../benches';
import { craftTagsOf, MATERIALS, QUALITY_ORDER, QUALITY_TIERS, qualityMult, type QualityTier } from '../materials';
import { EXPOSURE, EXPOSURE_FLOOR, JUDGEMENT_CAP, PREPS, preppedIdOf, TEXT, UNIFORMITY } from './defs';

export const COOKING: DisciplineDef = DISCIPLINES.cooking;

const fill = (id: string, params: Record<string, unknown> = {}): string =>
  TEXT[id].replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : String(params[name])));

// ---- exposure ----

function exposureProfile(materialId: string) {
  const tags = craftTagsOf(materialId);
  for (const key of Object.keys(EXPOSURE)) {
    if (key !== 'whole' && tags.includes(key)) return EXPOSURE[key];
  }
  return EXPOSURE.whole;
}

function fitOf(exposure: number, profile: { band: [number, number]; peak: number }): number {
  const [lo, hi] = profile.band;
  if (exposure >= lo && exposure <= hi) return profile.peak;
  if (exposure < lo) return EXPOSURE_FLOOR + (profile.peak - EXPOSURE_FLOOR) * (exposure / lo);
  const over = (exposure - hi) / (hi - lo);
  return Math.max(EXPOSURE_FLOOR, profile.peak - over * (profile.peak - EXPOSURE_FLOOR));
}

/** The chosen duration, or the bench's default; 0 on untimed benches. */
function durationOf(disc: DisciplineDef, duration?: number): number {
  return disc.timeline ? (duration ?? disc.timeline.default) : 0;
}

function exposureFit(disc: DisciplineDef, slot: SlotDef | undefined, materialId: string, duration: number): number {
  if (!disc.timeline || slot?.at == null) return 1;
  return fitOf(duration * (1 - slot.at), exposureProfile(materialId));
}

/** What `exposureInfo` says about one piece in one slot at one duration. */
export interface ExposureInfo {
  exposure: number;
  fit: number;
  verdict: 'in its element' | 'undercooked' | 'overcooked';
  band: [number, number];
  peak: number;
  /** The entry points, in units from the start, at which this piece lands in its band; clamped to [0, duration]. */
  window: [number, number];
}

/** How a piece would fare in a slot, at a duration. The old `exposureInfo`. */
export function exposureInfo(disc: DisciplineDef, slot: SlotDef, materialId: string, duration?: number): ExposureInfo | null {
  if (!disc.timeline || slot.at == null) return null;
  const units = durationOf(disc, duration);
  const exposure = units * (1 - slot.at);
  const profile = exposureProfile(materialId);
  const fit = fitOf(exposure, profile);
  const verdict = exposure < profile.band[0] ? 'undercooked' : exposure > profile.band[1] ? 'overcooked' : 'in its element';
  const [lo, hi] = profile.band;
  const clamp = (x: number) => Math.max(0, Math.min(units, x));
  return { exposure, fit, verdict, band: [lo, hi], peak: profile.peak, window: [clamp(units - hi), clamp(units - lo)] };
}

// ---- contribution ----

export function isPrepped(materialId: string): boolean {
  return craftTagsOf(materialId).includes('prepped');
}

function contributionBand(disc: DisciplineDef, slot: SlotDef | undefined, part: GradedStack, duration: number): [number, number] {
  const scaled = qualityMult(part.quality) * exposureFit(disc, slot, part.id, duration);
  if (!isPrepped(part.id)) return [scaled, scaled];
  const [lo, hi] = UNIFORMITY[part.quality];
  return scaled >= 0 ? [scaled * lo, scaled * hi] : [scaled * hi, scaled * lo];
}

function laidOut(disc: DisciplineDef, placement: Placement): { slot: SlotDef | undefined; part: GradedStack }[] {
  return Object.entries(placement)
    .filter((e): e is [string, GradedStack] => !!e[1])
    .map(([slotId, part]) => ({ slot: disc.slots.find((s) => s.id === slotId), part }));
}

function prepFitBonus(disc: DisciplineDef, parts: GradedStack[]): number {
  if (!disc.favoredPrep || !parts.length) return 0;
  const matched = parts.filter((p) => craftTagsOf(p.id).includes(disc.favoredPrep!)).length;
  return 0.6 * (matched / parts.length);
}

/** The tier whose own multiplier a combined value has earned, from below. */
export function tierFor(value: number): QualityTier {
  let best: QualityTier = 'f';
  for (const tier of QUALITY_ORDER) {
    if (QUALITY_TIERS[tier].mult <= value + 1e-9) best = tier;
  }
  return best;
}

/** What the cook's hand adds, in grades: +1 at Cooking 15, +2 at 60, flat after. */
export function cookJudgement(level: number): number {
  const l = Math.max(0, level);
  return Math.min(JUDGEMENT_CAP, Math.min(l, 15) / 15 + Math.max(0, l - 15) / 45);
}

// ---- the ledger ----

export interface LedgerRow {
  slotId: string;
  id: string;
  quality: QualityTier;
  fit: number;
  lo: number;
  hi: number;
  tool: boolean;
}

export interface CookLedger {
  rows: LedgerRow[];
  mean: [number, number];
  judgement: number;
  benchFit: number;
  score: [number, number];
  next?: { tier: QualityTier; at: number; shortBest: number; shortWorst: number };
}

/** Every number that makes up a dish's grade, part by part. The old `cookLedger`. */
export function cookLedger(reads: BenchReads, placement: Placement, disc: DisciplineDef = COOKING, duration?: number): CookLedger {
  const units = durationOf(disc, duration);
  const order = (id: string) => {
    const i = disc.slots.findIndex((s) => s.id === id);
    return i < 0 ? disc.slots.length : i;
  };
  const rows: LedgerRow[] = Object.entries(placement)
    .filter((e): e is [string, GradedStack] => !!e[1])
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([slotId, part]) => {
      const slot = disc.slots.find((s) => s.id === slotId);
      const [lo, hi] = contributionBand(disc, slot, part, units);
      return {
        slotId,
        id: part.id,
        quality: part.quality,
        fit: exposureFit(disc, slot, part.id, units),
        lo,
        hi,
        tool: !!slot && slotPicks(slot) === 'tool',
      };
    });
  const judgement = cookJudgement(reads.level);
  if (!rows.length) return { rows, mean: [0, 0], judgement, benchFit: 0, score: [0, 0] };
  const benchFit = prepFitBonus(disc, rows.map(({ id, quality }) => ({ id, quality })));
  const mean: [number, number] = [
    rows.reduce((sum, r) => sum + r.lo, 0) / rows.length,
    rows.reduce((sum, r) => sum + r.hi, 0) / rows.length,
  ];
  const nudge = judgement + benchFit;
  const score: [number, number] = [mean[0] + nudge, mean[1] + nudge];
  const above = QUALITY_ORDER[QUALITY_ORDER.indexOf(tierFor(score[0])) + 1];
  const next = above
    ? {
        tier: above,
        at: QUALITY_TIERS[above].mult,
        shortBest: Math.max(0, QUALITY_TIERS[above].mult - score[1]),
        shortWorst: QUALITY_TIERS[above].mult - score[0],
      }
    : undefined;
  return { rows, mean, judgement, benchFit, score, ...(next ? { next } : {}) };
}

/** What the basket can come out as: floor and ceiling of the uniformity rolls. */
export function dishQualityRange(
  reads: BenchReads,
  placement: Placement,
  disc: DisciplineDef = COOKING,
  duration?: number,
): { min: QualityTier; max: QualityTier } {
  const ledger = cookLedger(reads, placement, disc, duration);
  if (!ledger.rows.length) return { min: 'f', max: 'f' };
  return { min: tierFor(ledger.score[0]), max: tierFor(ledger.score[1]) };
}

/** The grade a basket is guaranteed: the floor of the range. */
export function dishQuality(reads: BenchReads, placement: Placement, disc: DisciplineDef = COOKING, duration?: number): QualityTier {
  return dishQualityRange(reads, placement, disc, duration).min;
}

/** Cook-time resolution: every prepped part rolls inside its own band. The old `rollDishQuality`. */
export function rollDishQuality(
  reads: BenchReads,
  rng: Rng,
  placement: Placement,
  disc: DisciplineDef,
  duration?: number,
): QualityTier {
  const out = laidOut(disc, placement);
  if (!out.length) return 'f';
  const units = durationOf(disc, duration);
  let sum = 0;
  for (const { slot, part } of out) {
    const [a, b] = contributionBand(disc, slot, part, units);
    sum += a === b ? a : a + rng.next() * (b - a);
  }
  return tierFor(sum / out.length + cookJudgement(reads.level) + prepFitBonus(disc, out.map((o) => o.part)));
}

// ---- preview ----

export interface CookCheck {
  ok: boolean;
  reason?: string;
  outcome?: OutcomeDef;
  quality?: QualityTier;
  qualityHigh?: QualityTier;
  label?: string;
  heatExposure?: { tag: string; mean: number; from?: number; to?: number }[];
}

/** The cutting board's placement, picked apart. Null when not that bench. */
export function prepParts(disc: DisciplineDef, placement: Placement) {
  const outcome = disc.outcomes.find((o) => o.result.kind === 'prepped');
  if (!outcome) return null;
  const base = disc.slots.find((s) => s.role === 'base');
  const design = disc.slots.find((s) => s.picks === 'design');
  if (!base || !design) return null;
  return { outcome, ingredient: placement[base.id], technique: placement[design.id] };
}

/** What this bench would produce as laid out, without spending anything. The old `previewCook`. */
export function previewCook(reads: BenchReads, placement: Placement, disc: DisciplineDef = COOKING, duration?: number): CookCheck {
  const check = checkCraft(reads, disc, placement, duration);
  if (!check.ok) return { ok: false, reason: check.reason };
  const outcome = matchOutcome(reads, disc, placement, duration);
  if (!outcome) return { ok: false, reason: fill('reason_no_outcome') };

  if (outcome.result.kind === 'prepped') {
    const parts = prepParts(disc, placement);
    if (!parts?.ingredient || !parts.technique) return { ok: false, reason: fill('reason_board_empty') };
    const prep = PREPS[parts.technique.id];
    if (!prep) return { ok: false, reason: fill('reason_no_such_technique') };
    if ((prep.minLevel ?? 0) > reads.level) return { ok: false, reason: fill('reason_technique_level', { level: prep.minLevel }) };
    const target = MATERIALS[preppedIdOf(parts.ingredient.id, prep.id)];
    if (!target) return { ok: false, reason: fill('reason_not_preppable') };
    const cap = parts.ingredient.quality;
    return { ok: true, outcome, quality: cap, label: `${target.name} — cut up to ${QUALITY_TIERS[cap].name}` };
  }

  const { min, max } = dishQualityRange(reads, placement, disc, duration);
  const dish = outcome.result.kind === 'material' && outcome.result.id ? MATERIALS[outcome.result.id] : undefined;
  const name = dish?.name ?? outcome.name;
  const heatExposure = outcome.heat?.map((w) => ({
    tag: w.tag,
    mean: meanExposure(disc, placement, w.tag, duration) ?? 0,
    ...(w.from !== undefined ? { from: w.from } : {}),
    ...(w.to !== undefined ? { to: w.to } : {}),
  }));
  return {
    ok: true,
    outcome,
    quality: min,
    qualityHigh: min === max ? undefined : max,
    label: min === max ? `${QUALITY_TIERS[min].name} ${name}` : `${QUALITY_TIERS[min].name}–${QUALITY_TIERS[max].name} ${name}`,
    ...(heatExposure ? { heatExposure } : {}),
  };
}
