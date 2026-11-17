/**
 * Banded XP curves. Port of the old `systems/progression.ts` and
 * `data/progression.data.ts`. Attributes and skills level on these curves.
 * The system holds no state. See README.md in this folder.
 *
 * The cost of level L is the band's base cost carried forward by every growth
 * rate the curve has passed through:
 *
 *     cost(L) = scale x base(band of L) x product of rate(band of i), i = 1..L-1
 *
 * Inside a band the curve is `base x rate^n`. A band with a costlier base
 * multiplies the whole curve by the ratio between the bases.
 */
import { defineSystem, registry, s, type RecordOf } from '../../kernel';
import progressionsData from './content/progressions.json';
import xpBasesData from './content/xp_bases.json';
import xpRatesData from './content/xp_rates.json';
import { migrations } from './migrations';

export const XP_BASE_TIERS = ['beginner', 'novice', 'adept', 'proficient', 'expert', 'master', 'legendary'] as const;
export type XpBaseTier = (typeof XP_BASE_TIERS)[number];

export const XP_GROWTH_RATES = ['fast', 'normal', 'slow', 'glacial'] as const;
export type XpGrowthRate = (typeof XP_GROWTH_RATES)[number];

/** Schema of one band, for any registry that carries a curve. */
export const bandSchema = s.object({
  from: s.number({ min: 1, integer: true, help: 'First level of the band.' }),
  base: s.enum(XP_BASE_TIERS),
  rate: s.enum(XP_GROWTH_RATES),
});

export interface ProgressionBand {
  from: number;
  base: XpBaseTier;
  rate: XpGrowthRate;
}

// ---- content ----

const xpBases = registry(
  s.object({ id: s.enum(XP_BASE_TIERS), cost: s.number({ min: 1, help: 'Base cost of a level in this tier.' }) }),
  xpBasesData,
  'XP base tiers',
);
const xpRates = registry(
  s.object({ id: s.enum(XP_GROWTH_RATES), rate: s.number({ min: 1, help: 'Cost multiplier per level.' }) }),
  xpRatesData,
  'XP growth rates',
);
const progressions = registry(
  s.object({ id: s.id(), bands: s.array(bandSchema) }),
  progressionsData,
  'XP curves',
);

export type ProgressionDef = RecordOf<typeof progressions>;

/** Base cost per tier. */
export const XP_BASE = Object.fromEntries(
  (xpBasesData as { id: XpBaseTier; cost: number }[]).map((r) => [r.id, r.cost]),
) as Record<XpBaseTier, number>;

/** Cost multiplier per level, per rate. `fast` is the smallest. */
export const XP_RATE = Object.fromEntries(
  (xpRatesData as { id: XpGrowthRate; rate: number }[]).map((r) => [r.id, r.rate]),
) as Record<XpGrowthRate, number>;

/** Applied to every skill and attribute cost. */
export const XP_SCALE = 1;

/** Named curve shapes, by id. */
export const PROGRESSIONS = Object.fromEntries(
  (progressionsData as ProgressionDef[]).map((r) => [r.id, r.bands]),
) as Record<string, ProgressionBand[]>;

/** Curve of any skill that does not carry one. */
export const DEFAULT_PROGRESSION: ProgressionBand[] = PROGRESSIONS.simple;

/** Curve of attribute training. Bands start at the training ranks (1, 21, 41, 61, 81). */
export const ATTRIBUTE_PROGRESSION: ProgressionBand[] = PROGRESSIONS.attribute;

// ---- arithmetic ----

/** The curve an empty band list falls back on, so a content slip cannot stop the game. */
const FALLBACK_BAND: ProgressionBand = { from: 1, base: 'beginner', rate: 'normal' };

/** The band in force at `level`: the last one that has started. */
function bandAt(bands: readonly ProgressionBand[], level: number): ProgressionBand {
  let current = bands[0] ?? FALLBACK_BAND;
  for (const band of bands) {
    if (level >= band.from) current = band;
  }
  return current;
}

/** Product of rate(i) over every level already climbed (1 to level - 1), evaluated per band. */
function growthFactor(bands: readonly ProgressionBand[], level: number): number {
  let factor = 1;
  for (let i = 0; i < bands.length; i++) {
    const start = Math.max(bands[i].from, 1);
    const end = Math.min(bands[i + 1]?.from ?? Infinity, level); // exclusive
    if (end > start) factor *= Math.pow(XP_RATE[bands[i].rate], end - start);
  }
  return factor;
}

/** XP to advance from `level` to the next one. Never below 1. */
export function bandedXpNeeded(bands: readonly ProgressionBand[], level: number): number {
  const base = XP_BASE[bandAt(bands, level).base];
  return Math.max(1, Math.floor(XP_SCALE * base * growthFactor(bands, level)));
}

/** Most levels one grant may give. Leftover XP stays banked and settles on the next grant. */
const MAX_LEVELS_PER_GRANT = 1000;

/**
 * Drain banked XP into levels until the remainder is under the current cost.
 * Returns the levels gained. A cost that is not a finite positive number
 * stops the loop and leaves the XP banked.
 */
export function settleLevels(progress: { level: number; xp: number }, bands: readonly ProgressionBand[]): number {
  let gained = 0;
  while (gained < MAX_LEVELS_PER_GRANT) {
    const need = bandedXpNeeded(bands, progress.level);
    if (!Number.isFinite(need) || need <= 0) break;
    if (progress.xp < need) break;
    progress.xp -= need;
    progress.level += 1;
    gained += 1;
  }
  return gained;
}

export default defineSystem<Record<string, never>>({
  id: 'progression',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { xp_bases: xpBases, xp_rates: xpRates, progressions },
});
