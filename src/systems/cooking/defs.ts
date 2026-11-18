/**
 * Cooking content and constants: the knife techniques, the uniformity of a
 * cut, what heat exposure each cut wants, the judgement cap and the Cook's
 * Book thresholds. Port of old `data/preps.data.ts` and the constants of
 * `systems/cooking.ts` and `systems/cookbook.ts`, unchanged.
 */
import { registry, s, type RecordOf } from '../../kernel';
import { DISCIPLINE_LIST, type DisciplineDef } from '../benches';
import { textSchema, type TextRecord } from '../log';
import type { QualityTier } from '../materials';
import prepsData from './content/preps.json';
import textData from './content/cooking_text.json';

export const TEXT: Record<string, string> = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
export const cookingText = registry(textSchema, textData, 'Cooking text');

export const preps = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    prefix: s.string(),
    icon: s.string(),
    tag: s.string({ help: 'The craft tag the cut carries.' }),
    minLevel: s.optional(s.number({ help: 'Cooking level the technique needs.' })),
    desc: s.optional(s.string()),
  }),
  prepsData,
  'Knife techniques',
);

export type PrepDef = RecordOf<typeof preps>;
export const PREP_LIST = prepsData as PrepDef[];
export const PREPS: Record<string, PrepDef> = Object.fromEntries(PREP_LIST.map((p) => [p.id, p]));

/** The id a prepped variant of a material is registered under. */
export function preppedIdOf(baseId: string, prepId: string): string {
  return `${baseId}_${prepId}`;
}

/**
 * What a cut grade means when the dish is made: the fraction of the
 * ingredient's contribution that arrives, rolled uniformly within the band.
 */
export const UNIFORMITY: Record<QualityTier, [number, number]> = {
  f: [0.1, 0.2],
  e: [0.25, 0.4],
  d: [0.4, 0.6],
  c: [0.55, 0.8],
  b: [0.72, 0.9],
  a: [0.9, 1],
  s: [1, 1],
};

/**
 * The heat exposure each kind of cut wants, in timeline units: its band, and
 * the reward for landing inside it. `whole` is the fallback for unprepped food.
 */
export const EXPOSURE: Record<string, { band: [number, number]; peak: number }> = {
  julienned: { band: [2, 5], peak: 1.15 },
  sliced: { band: [3, 8], peak: 1.08 },
  diced: { band: [6, 16], peak: 1.12 },
  whole: { band: [3, 16], peak: 1 },
};

export const EXPOSURE_FLOOR = 0.5;

/** The most a cook's judgement is ever worth, in grades. */
export const JUDGEMENT_CAP = 2;

/** Cooks of one dish before the Book shows its cook time. */
export const COOK_TIME_COOKS = 25;
/** Cooks of one dish before it grants its Signature when eaten. */
export const SIGNATURE_COOKS = 100;

/** Every bench that runs on the cooking skill, in registry order. The old `cookingBenches`. */
export const COOKING_BENCHES: DisciplineDef[] = DISCIPLINE_LIST.filter((d) => d.skill === 'cooking');
export const COOKING_BENCH_IDS = COOKING_BENCHES.map((d) => d.id);
