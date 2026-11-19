/**
 * Psionic content and tuning. Port of `PSIONIC`, `PSI_AXES`,
 * `PSI_STARTING_AXES`, `PSI_QUANTITIES` and `PSI_RECOGNITIONS` of the old
 * `data/spellcraft.data.ts`, and of the psionic types of the old `types.ts`.
 */
import { registry, s } from '../../kernel';
import { textSchema } from '../log';
import axesData from './content/psi_axes.json';
import quantitiesData from './content/psi_quantities.json';
import recognitionsData from './content/psi_recognitions.json';
import textData from './content/psionic_text.json';

export const PSI_AXIS_IDS = ['force', 'reach', 'grip', 'speed', 'clairvoyance', 'space', 'mass', 'vitality'] as const;
export type PsiAxisId = (typeof PSI_AXIS_IDS)[number];

export const PSI_QUANTITY_IDS = [
  'pressure',
  'momentum',
  'inertia',
  'acuity',
  'awareness',
  'coherence',
  'purchase',
  'inward',
] as const;
export type PsiQuantityId = (typeof PSI_QUANTITY_IDS)[number];

/** Points on each axis. The old `PsionicShape`. */
export type PsionicShape = Partial<Record<PsiAxisId, number>>;

/** A shape read as the quantities it computes to. The old `PsiDerived`. */
export type PsiDerived = Record<PsiQuantityId, number>;

/** What the shaper wears, as multipliers on the reading. No `inward`. The old `PsiBias`. */
export type PsiBias = Partial<Record<Exclude<PsiQuantityId, 'inward'>, number>>;

/** A band of a region: a derived quantity or, rarely, a raw axis. */
export interface PsiBand {
  min?: number;
  max?: number;
}

export interface PsionicAxisDef {
  id: PsiAxisId;
  name: string;
  icon: string;
  color: string;
  desc: string;
}

export interface PsiQuantityDef {
  id: PsiQuantityId;
  name: string;
  icon: string;
  formula: string;
  decimals: number;
  desc: string;
}

/** A name for a region of the derived space. The old `PsionicRecognitionDef`. */
export interface PsionicRecognitionDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  region: Partial<Record<PsiQuantityId | PsiAxisId, PsiBand>>;
  /** Teacher tier needed to inscribe a shape that lands here. Default 0. */
  tier?: number;
  /** Beats nesting when two regions both fit. Default 0. */
  priority?: number;
}

export const psiAxes = registry(
  s.object({
    id: s.enum(PSI_AXIS_IDS),
    name: s.string(),
    icon: s.string(),
    color: s.string({ help: 'Hex colour of the wedge.' }),
    desc: s.string(),
  }),
  axesData,
  'Psionic axes',
);

export const psiQuantities = registry(
  s.object({
    id: s.enum(PSI_QUANTITY_IDS),
    name: s.string(),
    icon: s.string(),
    formula: s.string({ help: 'The arithmetic of deriveShape, as printed on the wheel.' }),
    decimals: s.number({ min: 0 }),
    desc: s.string(),
  }),
  quantitiesData,
  'Psionic quantities',
);

export const psiRecognitions = registry(
  s.object({
    id: s.id(),
    name: s.string(),
    icon: s.string(),
    desc: s.string(),
    region: s.array(
      s.object({
        key: s.enum([...PSI_QUANTITY_IDS, ...PSI_AXIS_IDS]),
        min: s.optional(s.number()),
        max: s.optional(s.number()),
      }),
      { help: 'Bands over derived quantities (or a raw axis). Every band must hold.' },
    ),
    tier: s.optional(s.number({ min: 0, help: 'Teacher tier needed to inscribe it.' })),
    priority: s.optional(s.number({ help: 'Beats nesting when two regions both fit.' })),
  }),
  recognitionsData,
  'Psionic recognitions',
);

export const psionicText = registry(textSchema, textData, 'Psionic text');

export const PSI_AXES = Object.fromEntries(
  (axesData as PsionicAxisDef[]).map((a) => [a.id, a]),
) as Record<PsiAxisId, PsionicAxisDef>;
export const PSI_AXIS_LIST: PsionicAxisDef[] = Object.values(PSI_AXES);

export const PSI_QUANTITIES = Object.fromEntries(
  (quantitiesData as PsiQuantityDef[]).map((q) => [q.id, q]),
) as Record<PsiQuantityId, PsiQuantityDef>;
export const PSI_QUANTITY_LIST: PsiQuantityDef[] = Object.values(PSI_QUANTITIES);

interface RecognitionRecord {
  id: string;
  name: string;
  icon: string;
  desc: string;
  region: { key: PsiQuantityId | PsiAxisId; min?: number; max?: number }[];
  tier?: number;
  priority?: number;
}

function toRecognition(r: RecognitionRecord): PsionicRecognitionDef {
  const region: PsionicRecognitionDef['region'] = {};
  for (const band of r.region) {
    const b: PsiBand = {};
    if (band.min !== undefined) b.min = band.min;
    if (band.max !== undefined) b.max = band.max;
    region[band.key] = b;
  }
  const def: PsionicRecognitionDef = { id: r.id, name: r.name, icon: r.icon, desc: r.desc, region };
  if (r.tier !== undefined) def.tier = r.tier;
  if (r.priority !== undefined) def.priority = r.priority;
  return def;
}

/**
 * Recognitions by id, and in declaration order. Writable, as the old
 * records were: a test adds two regions and takes them out again.
 */
export const PSI_RECOGNITIONS: Record<string, PsionicRecognitionDef> = Object.fromEntries(
  (recognitionsData as RecognitionRecord[]).map((r) => [r.id, toRecognition(r)]),
);
export const PSI_RECOGNITION_LIST: PsionicRecognitionDef[] = Object.values(PSI_RECOGNITIONS);

/** The axes a mind starts with. The rest, and the 4/8/12 tiers, are taught. */
export const PSI_STARTING_AXES: PsiAxisId[] = ['force', 'reach'];

/** Shapes a mind holds at once. The old `MAX_PSI_MEMORIZED`. */
export const MAX_PSI_MEMORIZED = 8;

/** Log templates and reasons, by id. */
export const PSIONIC_TEXT: Record<string, string> = Object.fromEntries(
  (textData as { id: string; text: string }[]).map((r) => [r.id, r.text]),
);

/**
 * Psionic tuning. The old `PSIONIC`, numbers unchanged. Durations and the
 * cooldown are in ticks (10 per second).
 */
export const PSIONIC = {
  /** Per-axis cap: 3 + one per eight levels, 10 at most from skill alone. */
  axisCap: (level: number) => Math.min(10, 3 + Math.floor(level / 8)),
  /** Output grows faster than points spent. */
  pointCurve: (points: number) => Math.pow(points, 1.25),
  forcePower: 0.7,
  momentumPower: 0.85,
  gripPower: 0.25,
  /** The share of a strike a perfectly coherent shape withholds. */
  holdCost: 0.4,
  needleAcuity: 2,
  sureAcuity: 2,
  penPerAcuity: 0.09,
  reachSplash: 0.2,
  reachAll: 4,
  awarenessSpread: 0.5,
  gripChance: 0.18,
  concussChance: 0.09,
  speedCooldown: 0.93,
  vitalityHeal: 0.35,
  // Outward faces: the gate on the aimed quantity.
  bulwarkInertia: 3,
  readGate: 0.2,
  compressionGate: 1,
  // Inward faces.
  hasteMomentum: 0.5,
  braceGate: 1,
  rootInertia: 2,
  foresightGate: 0.5,
  wideSightGate: 2,
  /** Declared in the old data; nothing reads it (coherence's inward face is duration). */
  foldCoherence: 1.5,
  /** How long an inward face is worn: structure buys persistence. */
  inwardDuration: (coherence: number) => 200 * (1 + coherence),
  /** How long an affliction holds: purchase keeps it on them. */
  adhesion: (purchase: number) => 100 + 40 * purchase,
  /** What a recognised shape is worth, the same for every recognition. */
  recognitionBonus: 1.12,
  focusBase: 1,
  focusPerPoint: 0.25,
  cooldown: 110,
} as const;
