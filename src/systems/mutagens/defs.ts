/**
 * Mutagen content and types: the chromosome layouts, the genera and their
 * main genes, the mutations, the element lines that generate the edge, brand
 * and ward blocks, the nucleases and the fused mutagens. Port of old
 * `data/mutagens.data.ts`, `text/mutagens.text.ts` and the mutagen types of
 * `types.ts`. See README.md.
 */
import { registry, s, type RecordOf } from '../../kernel';
import { SIZE_LADDER } from '../items';
import { textSchema, type TextRecord } from '../log';
import type { QualityTier } from '../materials';
import { ATTRIBUTE_IDS, DAMAGE_TYPES, modifierSchema, RES_STAT_BY_TYPE, STAT_KEYS, type ContentMod, type DamageType, type StatKey } from '../stats';
import { applicationSchema, STATUSES, type ContentApplication } from '../statuses';
import elementLinesData from './content/element_lines.json';
import generaData from './content/genera.json';
import genesData from './content/main_genes.json';
import layoutsData from './content/chromosome_layouts.json';
import mutationsData from './content/mutations.json';
import textData from './content/mutagens_text.json';
import nucleasesData from './content/nucleases.json';

export const TEXT: Record<string, string> = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
export const mutagensText = registry(textSchema, textData, 'Mutagen text');

// ---- tuning (old `data/mutagens.data.ts`) ----

/** The edge length that reads as x1 intensity. Everything is a ratio to this. */
export const BASELINE_EDGE = 3;

/**
 * How close to its tier's ceiling each grade gets. Not `qualityMult`: F here
 * is weak and never harmful (docs of the old build, MUTAGENS.md section 9).
 */
export const QUALITY_APPROACH: Record<QualityTier, number> = { f: 0.5, e: 0.583, d: 0.667, c: 0.75, b: 0.833, a: 0.917, s: 1 };

/** What a grade does to what a gene costs. C is the neutral anchor. */
export const QUALITY_COST: Record<QualityTier, number> = { f: 0.8, e: 0.88, d: 0.94, c: 1, b: 1.07, a: 1.15, s: 1.25 };

/** Capacity a bottom-tier gene costs at C. Everything scales off this. */
export const MAIN_BASE_COST = 10;
/** Cost grows faster than power as a genus climbs. */
export const TIER_COST_EXPONENT = 1.35;
/** Capacity one placed mutation reserves, before its grade adjusts it. */
export const MUTATION_COST = 2;
/** The nth cut costs `CUT_BASE * CUT_GROWTH^(n-1)`. */
export const CUT_BASE = 1.5;
export const CUT_GROWTH = 1.6;

/** What one Edge adds on arrival, on top of the type it carries. */
export const EDGE_DAMAGE = 0.05;
/** What one generated Ward is worth. */
export const WARD_RESISTANCE = 0.06;

/** The centromere's node id in a layout's edges. */
export const CENTROMERE = '@';

export const MUTAGEN_ARMS = ['attacks', 'defenses', 'active', 'special'] as const;
export type MutagenArm = (typeof MUTAGEN_ARMS)[number];

export const NUCLEASE_KINDS = ['vulnerability', 'resistance', 'attribute', 'skill', 'offensive', 'elemental'] as const;
export type NucleaseKind = (typeof NUCLEASE_KINDS)[number];

/** Display name of a damage type (old `DAMAGE_TYPE_NAMES`). */
export function damageTypeName(type: DamageType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// ---- layouts ----

const point = () => s.object({ x: s.number(), y: s.number() });

export const layouts = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    centre: point(),
    sockets: s.array(s.object({ id: s.string({ minLength: 1 }), x: s.number(), y: s.number() })),
    edges: s.array(
      s.object({
        a: s.string({ minLength: 1 }),
        b: s.string({ minLength: 1 }),
        length: s.number({ min: 0, help: 'Micrometres. Sets intensity, never routing.' }),
        arm: s.optional(s.enum(MUTAGEN_ARMS, { help: 'Only on an edge into the centromere: the arm an effect arriving on it lands in.' })),
      }),
    ),
  }),
  layoutsData,
  'Chromosome layouts',
);

export type ChromosomeLayout = RecordOf<typeof layouts>;
export type ChromosomeEdge = ChromosomeLayout['edges'][number];

export const LAYOUT_LIST = layoutsData as unknown as ChromosomeLayout[];
export const LAYOUTS: Record<string, ChromosomeLayout> = Object.fromEntries(LAYOUT_LIST.map((l) => [l.id, l]));
export const BASELINE_LAYOUT = LAYOUTS.baseline;

/** Canonical key for a connection, so `a-b` and `b-a` are the same edge. */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * What the quest hands over: the centromere, one upper arm and one lower.
 * `g` carries attacks and `i` carries defenses.
 */
export function startingKit(lowerArm: 'g' | 'i' = 'g'): string[] {
  return [edgeKey('d', CENTROMERE), edgeKey(lowerArm, CENTROMERE)];
}

// ---- main genes ----

const range = (help: string) => s.array(s.number(), { help: `[worst, best], walked by grade. ${help}` });

const armBlock = s.object({
  attacks: s.optional(s.array(modifierSchema)),
  defenses: s.optional(s.array(modifierSchema)),
  active: s.optional(s.array(modifierSchema)),
  special: s.optional(s.array(modifierSchema)),
});

const specSchema = s.object({
  type: s.enum(['gene', 'buff']),
  cooldown: s.number({ min: 0 }),
  flat: s.optional(s.number({ help: "The species' own term, before any multiplier." })),
  power: s.optional(s.number({ help: 'Per point of fromStat or fromAttr.' })),
  fromStat: s.optional(s.enum(STAT_KEYS)),
  fromAttr: s.optional(s.enum(ATTRIBUTE_IDS)),
  scalesWithSpeed: s.optional(s.boolean({ help: 'x speed / BASE_SPEED.' })),
  amplifiedBy: s.optional(s.enum(STAT_KEYS, { help: 'x (1 + stat), floored at 0: for a bounded stat.' })),
  damageType: s.optional(s.enum(DAMAGE_TYPES)),
  stun: s.optional(s.number({ help: "Ticks off the target's bar." })),
  selfDelay: s.optional(s.number({ help: "Ticks off the player's own bar." })),
  splash: s.optional(s.number()),
  splashAll: s.optional(s.boolean()),
  riders: s.optional(s.array(s.object({ type: s.enum(DAMAGE_TYPES), value: s.number() }))),
  sizeDouble: s.optional(s.number({ help: 'Doubles per this many size steps down.' })),
  execute: s.optional(s.number({ help: 'Kills a target left at or under this share of the blow.' })),
  inflicts: s.optional(s.array(applicationSchema)),
  perTargetStacks: s.optional(
    s.object({
      status: s.ref('statuses'),
      power: s.number(),
      inflictRoot: s.optional(range('Root of the stack count the inflicts land at.')),
      inflictCap: s.optional(s.number()),
    }),
  ),
  mods: s.optional(s.array(modifierSchema, { help: 'A buff ability: what it raises while it lasts.' })),
  duration: s.optional(s.number()),
  clearsField: s.optional(s.boolean()),
  volley: s.optional(s.object({ hits: range('Hits.'), ticks: s.number() })),
  incant: s.optional(s.object({ ticks: range('Wind-up ticks.'), fillMult: s.number(), critBonus: s.number() })),
  grants: s.optional(s.array(applicationSchema, { help: 'Conditions the user puts on itself.' })),
  grantDuration: s.optional(range('Ticks of the self grants.')),
});

export const mainGenes = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    genus: s.string({ help: 'A genus id, or bare.' }),
    tier: s.number({ min: 0 }),
    flatBase: s.number({ min: 0 }),
    ceiling: s.number({ min: 0 }),
    writesAttributes: s.optional(s.boolean()),
    gradeless: s.optional(s.boolean({ help: 'Held at C, never shown a grade (bare).' })),
    from: s.optional(s.string({ help: 'The monster id that drops it. A species not written yet leaves the gene undroppable.' })),
    size: s.optional(s.enum(SIZE_LADDER)),
    base: s.optional(armBlock),
    ability: s.optional(s.object({ name: s.string({ minLength: 1 }), icon: s.string(), spec: specSchema })),
    grants: s.optional(s.array(s.string(), { help: 'Capabilities: arms:+N, onehand:<tag>, telekinetic:N.' })),
    confers: s.optional(s.array(applicationSchema, { help: 'Conditions the body wears (left behind: not applied).' })),
    onCrit: s.optional(s.array(applicationSchema, { help: 'Left behind: not applied.' })),
    tongues: s.optional(
      s.object({ words: s.array(s.string()), everyTicks: range('Ticks between words.'), power: range('Power.') }),
    ),
    fasts: s.optional(
      s.object({
        regenRoot: range('Root of the attack arm regeneration.'),
        regenMult: s.number(),
        armorPerLogHunger: s.number(),
        wardPerLogHunger: s.number(),
        wardMax: s.number(),
      }),
    ),
    refutes: s.optional(s.object({ negate: range('Negate chance.'), lockout: range('Seal chance.'), perCast: s.number() })),
    desc: s.optional(s.string()),
  }),
  genesData,
  'Main genes',
);

type GeneRecord = RecordOf<typeof mainGenes>;
/** An ability's spec: `gene` is a blow, `buff` fires off the buff slot. */
export type AbilitySpec = NonNullable<GeneRecord['ability']>['spec'];
/** The blow half, named once so the pricing can be typed (old `GeneSpec`). */
export type GeneSpec = AbilitySpec;
export type GeneAbility = { name: string; icon: string; spec: AbilitySpec };

/** A main gene. The ranges are pairs. */
export type MainGeneDef = Omit<GeneRecord, 'base' | 'ability'> & {
  base?: Partial<Record<MutagenArm, ContentMod[]>>;
  ability?: GeneAbility;
};

export const MAIN_GENE_LIST = genesData as unknown as MainGeneDef[];
export const MAIN_GENES: Record<string, MainGeneDef> = Object.fromEntries(MAIN_GENE_LIST.map((g) => [g.id, g]));

// ---- genera ----

export const genera = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    gradesPerStep: s.number({ min: 1, help: 'Quality grades one tier step is worth.' }),
    tiers: s.array(s.ref('main_genes')),
  }),
  generaData,
  'Genera',
);

export type GenusDef = RecordOf<typeof genera>;
export const GENERA: Record<string, GenusDef> = Object.fromEntries((generaData as unknown as GenusDef[]).map((g) => [g.id, g]));

// ---- mutations ----

const effectSchema = s.object({
  type: s.optional(s.enum(DAMAGE_TYPES)),
  mods: s.optional(s.array(modifierSchema)),
  grants: s.optional(s.array(s.string())),
});

export const mutations = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    native: s.enum(MUTAGEN_ARMS),
    from: s.optional(s.ref('monster_tags', { help: 'A tag some monster carries, or the mutation never drops.' })),
    effect: s.optional(effectSchema),
    transform: s.optional(
      s.object({
        retype: s.optional(s.enum(DAMAGE_TYPES)),
        grants: s.optional(s.array(s.string())),
        mult: s.optional(s.number({ help: 'A conduit: multiplies what passes through.' })),
      }),
    ),
    amplify: s.optional(s.number({ help: 'A catalyst: multiplies what its own route runs into.' })),
  }),
  mutationsData,
  'Mutations',
);

export interface MutagenEffect {
  type?: DamageType;
  mods?: ContentMod[];
  grants?: string[];
}

export interface MutationTransform {
  retype?: DamageType;
  grants?: string[];
  mult?: number;
}

export interface MutagenDef {
  id: string;
  name: string;
  icon: string;
  native: MutagenArm;
  from?: string;
  effect?: MutagenEffect;
  transform?: MutationTransform;
  amplify?: number;
  /** A fused mutagen: rewrites a key, never a magnitude. */
  rekey?: { kind: NucleaseKind; to: DamageType };
}

// ---- element lines ----

const block = () => s.object({ id: s.id(), name: s.string({ minLength: 1 }), icon: s.string() });

export const elementLines = registry(
  s.object({
    id: s.id(),
    tag: s.ref('monster_tags', { help: 'The monster tag that drops the blocks.' }),
    type: s.enum(DAMAGE_TYPES),
    res: s.enum(STAT_KEYS),
    condition: s.ref('statuses', { help: 'The base form the Brand leaves.' }),
    edge: block(),
    brand: block(),
    ward: s.optional(block()),
  }),
  elementLinesData,
  'Element lines',
);

export type ElementLine = RecordOf<typeof elementLines>;

/** The Edge, Brand and Ward of every element line. The old `elementalBlocks`. */
export function elementalBlocks(lines: readonly ElementLine[]): Record<string, MutagenDef> {
  const out: Record<string, MutagenDef> = {};
  for (const line of lines) {
    out[line.edge.id] = {
      ...line.edge,
      native: 'attacks',
      from: line.tag,
      effect: { type: line.type, mods: [{ stat: 'damage', op: 'mult', value: EDGE_DAMAGE }] },
      transform: { retype: line.type },
    };
    out[line.brand.id] = {
      ...line.brand,
      native: 'active',
      from: line.tag,
      effect: { grants: [`inflicts_${line.condition}`] },
      transform: { grants: [`inflicts_${line.condition}`] },
    };
    if (line.ward) {
      out[line.ward.id] = {
        ...line.ward,
        native: 'defenses',
        from: line.tag,
        effect: { mods: [{ stat: line.res, op: 'add', value: WARD_RESISTANCE }] },
      };
    }
  }
  return out;
}

// ---- nucleases ----

export const nucleases = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    kind: s.enum(NUCLEASE_KINDS),
    from: s.optional(s.ref('monster_tags')),
    desc: s.string(),
  }),
  nucleasesData,
  'Nucleases',
);

export type NucleaseDef = RecordOf<typeof nucleases>;
export const NUCLEASES: Record<string, NucleaseDef> = Object.fromEntries(
  (nucleasesData as unknown as NucleaseDef[]).map((n) => [n.id, n]),
);

const TYPE_BY_RES_STAT: Record<string, DamageType> = Object.fromEntries(
  Object.entries(RES_STAT_BY_TYPE).map(([type, stat]) => [stat, type as DamageType]),
);

/** The damage type a resistance stat speaks for, if it is one. */
export function typeOfResStat(stat: string): DamageType | undefined {
  return TYPE_BY_RES_STAT[stat];
}

/** The element a mutation speaks for, whichever leg it is. The old `elementOf`. */
export function elementOf(def: MutagenDef): DamageType | undefined {
  if (def.effect?.type) return def.effect.type;
  if (def.transform?.retype) return def.transform.retype;
  for (const mod of def.effect?.mods ?? []) {
    const typed = TYPE_BY_RES_STAT[mod.stat];
    if (typed) return typed;
  }
  for (const grant of def.effect?.grants ?? []) {
    if (!grant.startsWith('inflicts_')) continue;
    const element = STATUSES[grant.slice('inflicts_'.length)]?.element as DamageType | undefined;
    if (element) return element;
  }
  return undefined;
}

/** Which domain each kind of rekey speaks about. Presentation only. */
const NUCLEASE_ARM: Record<NucleaseKind, MutagenArm> = {
  vulnerability: 'defenses',
  resistance: 'defenses',
  attribute: 'special',
  skill: 'special',
  offensive: 'attacks',
  elemental: 'special',
};

/** Every nuclease x every element some mutation supplies. The old `fusedMutagens`. */
export function fusedMutagens(parents: readonly MutagenDef[], nucs: readonly NucleaseDef[]): Record<string, MutagenDef> {
  const elements = new Set<DamageType>();
  for (const parent of parents) {
    const element = elementOf(parent);
    if (element) elements.add(element);
  }
  const out: Record<string, MutagenDef> = {};
  for (const nuclease of nucs) {
    for (const element of elements) {
      const id = `${nuclease.id}_${element}`;
      out[id] = {
        id,
        name: `${damageTypeName(element)} ${nuclease.name.replace(/ Nuclease$/, '')}`,
        icon: nuclease.icon,
        native: NUCLEASE_ARM[nuclease.kind],
        rekey: { kind: nuclease.kind, to: element },
      };
    }
  }
  return out;
}

/** Every mutation: hand-written, then the element blocks, then the fused ones (the old order). */
export const MUTATIONS: Record<string, MutagenDef> = (() => {
  const out: Record<string, MutagenDef> = {};
  for (const m of mutationsData as unknown as MutagenDef[]) out[m.id] = m;
  Object.assign(out, elementalBlocks(elementLinesData as unknown as ElementLine[]));
  Object.assign(out, fusedMutagens(Object.values(out), Object.values(NUCLEASES)));
  return out;
})();

export type { StatKey, ContentApplication };
