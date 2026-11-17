/**
 * What a spell is once resolved, and what it is made from. Port of
 * `SpellSpec`, `SpellStrike`, `SpellCounter`, `SpellSource` and
 * `CraftedSpell` of the old `types.ts`.
 */
import { s } from '../../kernel';
import type { MonsterCast } from '../monsters';
import { DAMAGE_TYPES, modifierSchema, type ContentMod, type DamageType } from '../stats';
import { applicationSchema, toApplication, type ContentApplication, type StatusApplication } from '../statuses';

export type SpellSchool = 'arcane' | 'divine' | 'psionic';
export type SpellTarget = 'one' | 'others' | 'self';
export const SPELL_TARGETS = ['one', 'others', 'self'] as const;

/** One damage clause of a resolved spell. Power is in multiples of spell power. */
export interface SpellStrike {
  type: DamageType;
  /** A second nature: the strike lands as whichever of the two the target resists less. */
  orType?: DamageType;
  power: number;
  /** Share of the target's resistance ignored (0 to 0.95). */
  penetration?: number;
  /** Landings per cast. Default 1. */
  hits?: number;
  /** Added to the caster's crit chance for this strike. May be negative. */
  critBonus?: number;
  /** Added to the caster's crit damage for this strike. The total is floored at 1. */
  critDamageBonus?: number;
  /** "then": power multiplied by this when the strike before it dealt damage to this target. */
  followUp?: number;
  /** No resistance and no weakness: the raw number lands. */
  untyped?: boolean;
  /** "or": strikes of one group are alternatives; one is rolled per cast. */
  altGroup?: number;
  /** "if": the strike fires only while the target bears one of these conditions. */
  onlyIf?: string[];
  /** Conditions for whatever the strike lands on. */
  inflicts?: StatusApplication[];
}

/** An undoing as the grammar composed it. Efficiency is read when the trap springs. */
export interface SpellCounter {
  /** Undo tiers spoken across the sentence. */
  tiers: number;
  /** Element to units spoken. */
  tuning: Partial<Record<DamageType, number>>;
  /** Manaburn laid on the caster at 100% efficiency, in multiples of spell power. */
  burn: number;
  /** Separate applications of that burn. Default 1. */
  burns?: number;
}

/** The resolved form every school composes into: what a spell does. */
export interface SpellSpec {
  name: string;
  icon: string;
  desc?: string;
  school: SpellSchool;
  target: SpellTarget;
  strikes: SpellStrike[];
  /** Healing in multiples of spell power. The caster's, unless `healsEnemy`. */
  heal?: number;
  /** The healing lands on the target: forced life (overgrowth). */
  healsEnemy?: boolean;
  /** Share of the strikes carried into a random flanker. */
  splash?: number;
  /** A buff on the caster. The player's only: a monster does not read it. */
  buff?: { name: string; mods: ContentMod[]; duration: number };
  /** Conditions granted to the caster. */
  grants?: StatusApplication[];
  /** Conditions laid on the target, whether or not anything was struck. */
  afflicts?: StatusApplication[];
  /** Strikes and healing multiplied while any combatant bears one of these. */
  empowered?: { statuses: string[]; mult: number };
  /** Matching conditions are stripped from the caster and inflicted on the target at intensity x mult. */
  transfers?: { statuses: string[]; mult: number };
  /** Matching conditions on the target are intensified x mult and their clocks rewound. */
  amplify?: { statuses: string[]; mult: number };
  /** The deity whose miracle this is. */
  deity?: string;
  /** Cannot be evaded. */
  sure?: boolean;
  /** A counterspell: held like a trap and sprung inside another casting. */
  counter?: SpellCounter;
  /** What the working is made of, for a counterspell to match: element to units. */
  signature?: Partial<Record<DamageType, number>>;
  /** Mana per cast, before efficiency. */
  manaCost: number;
  staminaCost?: number;
  focusCost?: number;
  /** Ticks between casts. */
  cooldown: number;
}

/** What a spell is made from. The same type a monster's rotation holds. */
export type SpellSource = MonsterCast;

/** One spell in the book. The old `CraftedSpell`. */
export interface CraftedSpell {
  uid: number;
  source: SpellSource;
  /** The player's name for it. */
  name?: string;
  /** Carried into fights. */
  prepared?: boolean;
}

// ---- a stated spell in content ----

const groupSchema = s.object({ statuses: s.array(s.ref('statuses')), mult: s.number() });

/** A spell stated whole in a content file (a miracle). `school` is the registry's. */
export const spellSpecSchema = s.object({
  // Eight miracles of the old data are stated with an empty name and a cooldown of 0.
  name: s.string(),
  icon: s.string(),
  desc: s.optional(s.string()),
  target: s.enum(SPELL_TARGETS),
  strikes: s.array(
    s.object({
      type: s.enum(DAMAGE_TYPES),
      orType: s.optional(s.enum(DAMAGE_TYPES)),
      power: s.number({ help: 'Multiples of spell power.' }),
      penetration: s.optional(s.number({ min: 0, max: 0.95 })),
      hits: s.optional(s.number({ min: 1, integer: true })),
      critBonus: s.optional(s.number()),
      critDamageBonus: s.optional(s.number()),
      followUp: s.optional(s.number()),
      untyped: s.optional(s.boolean()),
      altGroup: s.optional(s.number()),
      onlyIf: s.optional(s.array(s.ref('statuses'))),
      inflicts: s.optional(s.array(applicationSchema)),
    }),
  ),
  heal: s.optional(s.number({ help: 'Multiples of spell power.' })),
  healsEnemy: s.optional(s.boolean()),
  splash: s.optional(s.number()),
  buff: s.optional(s.object({ name: s.string(), mods: s.array(modifierSchema), duration: s.number() })),
  grants: s.optional(s.array(applicationSchema)),
  afflicts: s.optional(s.array(applicationSchema)),
  empowered: s.optional(groupSchema),
  transfers: s.optional(groupSchema),
  amplify: s.optional(groupSchema),
  sure: s.optional(s.boolean()),
  manaCost: s.number({ min: 0 }),
  staminaCost: s.optional(s.number()),
  focusCost: s.optional(s.number()),
  cooldown: s.number({ min: 0 }),
});

/** A stated spell as the JSON holds it. */
export interface RawSpellSpec extends Omit<SpellSpec, 'school' | 'strikes' | 'grants' | 'afflicts' | 'deity' | 'counter' | 'signature'> {
  strikes: (Omit<SpellStrike, 'inflicts'> & { inflicts?: ContentApplication[] })[];
  grants?: ContentApplication[];
  afflicts?: ContentApplication[];
}

/** A stated spell with its applications in the runtime form. */
export function statedSpec(raw: RawSpellSpec): Omit<SpellSpec, 'school'> {
  const { strikes, grants, afflicts, ...rest } = raw;
  return {
    ...rest,
    strikes: strikes.map(({ inflicts, ...strike }) => ({
      ...strike,
      ...(inflicts ? { inflicts: inflicts.map(toApplication) } : {}),
    })),
    ...(grants ? { grants: grants.map(toApplication) } : {}),
    ...(afflicts ? { afflicts: afflicts.map(toApplication) } : {}),
  };
}
