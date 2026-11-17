/**
 * The arcane lexicon. Port of `ARCANE_WORDS` of the old
 * `data/spellcraft.data.ts` and of the word types of the old `types.ts`.
 */
import { registry, s } from '../../kernel';
import { SPELL_TARGETS, type SpellTarget } from '../spellcraft';
import { DAMAGE_TYPES, type DamageType } from '../stats';
import { applicationSchema, toApplication, type ContentApplication, type StatusApplication } from '../statuses';
import wordsData from './content/arcane_words.json';

export const WORD_KINDS = ['noun', 'verb', 'adverb', 'target', 'conjunction'] as const;
export type ArcaneWordKind = (typeof WORD_KINDS)[number];

const side = s.object({ dur: s.number(), rate: s.number() });
const critSide = s.object({ chance: s.optional(s.number()), damage: s.optional(s.number()) });

export const arcaneWords = registry(
  s.object({
    id: s.id(),
    word: s.string({ minLength: 1, help: 'The word as spoken, lower case.' }),
    stacked: s.optional(s.array(s.string(), { help: 'What the word becomes spoken twice and three times in a row.' })),
    kind: s.enum(WORD_KINDS),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Icon name of the old build. The file is not in this repository.' })),
    desc: s.optional(s.string()),
    minLevel: s.optional(s.number({ help: 'Arcana level before the word can be used (step 3).' })),
    mana: s.optional(s.number({ help: 'What speaking it adds to the mana cost.' })),
    element: s.optional(s.enum(DAMAGE_TYPES)),
    untyped: s.optional(s.boolean({ help: 'Nouns: the strike ignores resistance and weakness.' })),
    power: s.optional(s.number({ help: 'Nouns: base damage in multiples of spell power.' })),
    inflicts: s.optional(s.array(applicationSchema)),
    verb: s.optional(
      s.object({
        statusRate: s.optional(s.number()),
        bareType: s.optional(s.enum(DAMAGE_TYPES)),
        bareInflicts: s.optional(s.array(applicationSchema)),
        powerMult: s.optional(s.number()),
        barePower: s.optional(s.number()),
        penetration: s.optional(s.number()),
        gripMult: s.optional(s.number()),
        cooldownMult: s.optional(s.number()),
        splash: s.optional(s.number()),
        restore: s.optional(s.number()),
        ward: s.optional(s.object({ amount: s.number(), duration: s.number() })),
        undo: s.optional(s.object({ burn: s.number() })),
      }),
    ),
    adverb: s.optional(
      s.object({
        crit: s.optional(s.object({ lead: s.optional(critSide), trail: s.optional(critSide) })),
        intensity: s.optional(s.number()),
        powerMult: s.optional(s.number()),
        cooldownMult: s.optional(s.number()),
        manaMult: s.optional(s.number()),
        hits: s.optional(s.number()),
        clock: s.optional(s.object({ lead: side, trail: side })),
      }),
    ),
    target: s.optional(s.enum(SPELL_TARGETS)),
    conjunction: s.optional(
      s.object({
        inheritPenetration: s.optional(s.boolean()),
        followThrough: s.optional(s.number()),
        fuse: s.optional(s.number()),
        transmute: s.optional(s.boolean()),
        alternate: s.optional(s.number()),
        condition: s.optional(s.boolean()),
        accompany: s.optional(s.number()),
      }),
    ),
  }),
  wordsData,
  'Arcane words',
);

/** What a conjunction does to the boundary it sits on. */
export interface ArcaneConjunctionSpec {
  inheritPenetration?: boolean;
  followThrough?: number;
  fuse?: number;
  transmute?: boolean;
  alternate?: number;
  condition?: boolean;
  accompany?: number;
}

/** What a verb does to its clause. */
export interface ArcaneVerbSpec {
  statusRate?: number;
  bareType?: DamageType;
  bareInflicts?: StatusApplication[];
  powerMult?: number;
  barePower?: number;
  penetration?: number;
  gripMult?: number;
  cooldownMult?: number;
  splash?: number;
  restore?: number;
  ward?: { amount: number; duration: number };
  undo?: { burn: number };
}

/** What an adverb does to the clause it sits in. */
export interface ArcaneAdverbSpec {
  crit?: { lead?: { chance?: number; damage?: number }; trail?: { chance?: number; damage?: number } };
  intensity?: number;
  powerMult?: number;
  cooldownMult?: number;
  manaMult?: number;
  hits?: number;
  clock?: { lead: { dur: number; rate: number }; trail: { dur: number; rate: number } };
}

/** One word of the lexicon. Exactly one of the kind-specific fields is present. */
export interface ArcaneWordDef {
  id: string;
  word: string;
  stacked?: string[];
  kind: ArcaneWordKind;
  icon: string;
  art?: string;
  desc?: string;
  minLevel?: number;
  mana?: number;
  element?: DamageType;
  untyped?: boolean;
  power?: number;
  inflicts?: StatusApplication[];
  verb?: ArcaneVerbSpec;
  adverb?: ArcaneAdverbSpec;
  target?: SpellTarget;
  conjunction?: ArcaneConjunctionSpec;
}

interface RawWord extends Omit<ArcaneWordDef, 'inflicts' | 'verb'> {
  inflicts?: ContentApplication[];
  verb?: Omit<ArcaneVerbSpec, 'bareInflicts'> & { bareInflicts?: ContentApplication[] };
}

function wordOf(raw: RawWord): ArcaneWordDef {
  const { inflicts, verb, ...rest } = raw;
  return {
    ...rest,
    ...(inflicts ? { inflicts: inflicts.map(toApplication) } : {}),
    ...(verb
      ? { verb: { ...verb, bareInflicts: verb.bareInflicts?.map(toApplication) } as ArcaneVerbSpec }
      : {}),
  };
}

export const ARCANE_WORD_LIST: readonly ArcaneWordDef[] = (wordsData as unknown as RawWord[]).map(wordOf);
export const ARCANE_WORDS: Record<string, ArcaneWordDef> = Object.fromEntries(ARCANE_WORD_LIST.map((w) => [w.id, w]));
