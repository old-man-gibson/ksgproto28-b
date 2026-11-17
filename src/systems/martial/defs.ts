/**
 * The martial registries: positions, techniques, fork archetypes. Port of
 * `POSITIONS`, `TECHNIQUES`, `FORK_ARCHETYPES` and the tuning constants of
 * the old `data/martial.data.ts`, with the types of the old `types.ts`.
 */
import { registry, s, type Infer } from '../../kernel';
import type { SkillTrigger } from '../combat';
import { conditionSchema, type ConditionRecord } from '../counters';
import { DAMAGE_TYPES, modifierSchema, type ContentMod, type DamageType } from '../stats';
import { applicationSchema, toApplication, type ContentApplication, type StatusApplication } from '../statuses';
import positionsData from './content/positions.json';
import forksData from './content/fork_archetypes.json';
import techniquesData from './content/techniques.json';

// ---- tuning ----

export const NEUTRAL_POSITION = 'neutral';
/** The position a readied spell is held in. Leaving it drops the spell (step 3). */
export const SPELL_READY_POSITION = 'spell_ready';
/** Ticks before a monster repeats a technique. Combat applies it to a shape with no cooldown of its own. */
export const WATCH_KEY_PREFIX = 'seen:technique:';

// ---- schemas ----

/** A trigger as content writes it. A condition's value is a string; a number subject compares it as a number. */
export const triggerSchema = s.object({
  enabled: s.optional(s.boolean()),
  conditions: s.optional(
    s.array(
      s.object({
        subject: s.string(),
        op: s.enum(['>=', '<=', '>', '<', '==', 'is', 'isNot']),
        value: s.string(),
      }),
    ),
  ),
  event: s.optional(s.string({ help: 'An event stamped on the fight: onHit, onCrit, onParry, onDodge, onGraze, onEncounterStart, onEnemyCast.' })),
  window: s.optional(s.number({ help: 'Ticks the event stays fresh. Default 2.' })),
});

export const positions = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    desc: s.optional(s.string()),
    color: s.string({ help: 'Identity colour of the position.' }),
    effects: s.optional(
      s.object({
        incomingMult: s.optional(s.number({ help: 'Multiplier on incoming enemy damage while here.' })),
        dodgeMult: s.optional(s.number({ help: 'Multiplier on dodge while here. 0 is a real value.' })),
      }),
    ),
    unlock: s.optional(s.array(conditionSchema, { help: 'Gate on the position being shown (step 3).' })),
  }),
  positionsData,
  'Positions',
);

export const forkArchetypes = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    desc: s.optional(s.string()),
    kind: s.enum(['strike', 'buff']),
    damageMult: s.optional(s.number()),
    hits: s.optional(s.number()),
    cooldownMult: s.optional(s.number()),
    splashAdd: s.optional(s.number()),
    staminaMult: s.optional(s.number()),
    durationMult: s.optional(s.number()),
    dodgeMult: s.optional(s.number()),
    exitTo: s.optional(s.ref('positions')),
  }),
  forksData,
  'Fork archetypes',
);

const moveSchema = s.object({
  damageMult: s.optional(s.number({ help: 'Weapon damage multiplier. Absent: no strike.' })),
  preventedMult: s.optional(s.number({ help: 'Share of the damage the last block or parry stopped, added to the blow.' })),
  damageType: s.optional(s.enum(DAMAGE_TYPES, { help: 'Type of the returned share of a counter.' })),
  counter: s.optional(
    s.object({
      reduce: s.number({ min: 0, max: 1 }),
      pool: s.optional(s.string({ help: 'Resource pool the interception is paid from.' })),
      cost: s.optional(s.number({ help: 'Share of that pool.' })),
    }),
  ),
  hits: s.optional(s.number()),
  penetration: s.optional(s.number()),
  splash: s.optional(s.number()),
  inflicts: s.optional(s.array(applicationSchema)),
  buff: s.optional(s.object({ mods: s.array(modifierSchema), duration: s.number() })),
  staminaCost: s.optional(s.number({ help: 'Share of max stamina, on top of the swing.' })),
  momentum: s.optional(s.number()),
  equipment: s.optional(s.enum(['ground', 'recover', 'draw', 'impale', 'wrench'], { help: 'Weapon-state effect (step 3).' })),
  crit: s.optional(s.object({ always: s.boolean(), damageMult: s.optional(s.number()), floor: s.optional(s.number()) })),
  readiesSpell: s.optional(s.boolean()),
  deliversSpell: s.optional(s.boolean()),
  cooldown: s.number(),
});

export const techniques = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    desc: s.optional(s.string()),
    family: s.optional(s.string({ help: 'Weapon-family tag that must be worn.' })),
    skill: s.optional(s.ref('skills')),
    trigger: s.optional(triggerSchema),
    from: s.array(
      s.object({
        any: s.optional(s.boolean({ help: 'From any position.' })),
        at: s.optional(s.array(s.ref('positions'))),
        trigger: s.optional(triggerSchema),
      }),
      { help: 'The ways in. Each is `any` or a list of positions, with an optional trigger of its own.' },
    ),
    to: s.ref('positions'),
    move: moveSchema,
    unlock: s.optional(s.array(conditionSchema, { help: 'Eligibility to learn (step 3).' })),
    learn: s.optional(
      s.object({
        self: s.optional(s.object({ stat: s.string(), count: s.number() })),
        watch: s.optional(s.number()),
      }),
    ),
    mastery: s.optional(
      s.array(
        s.object({
          tier: s.number({ min: 1, integer: true }),
          name: s.optional(s.string()),
          addFrom: s.optional(s.array(s.ref('positions'))),
        }),
      ),
    ),
    forks: s.optional(s.array(s.ref('fork_archetypes'))),
    requiresWielded: s.optional(s.boolean()),
    requiresGrounded: s.optional(s.boolean()),
    requiresImpaled: s.optional(s.boolean()),
    requiresReadiedSpell: s.optional(s.boolean()),
    requiresSheathed: s.optional(s.string({ help: 'Tag of the sheathed weapon.' })),
  }),
  techniquesData,
  'Techniques',
);

// ---- record types ----

export interface PositionDef {
  id: string;
  name: string;
  icon: string;
  desc?: string;
  color: string;
  effects?: { incomingMult?: number; dodgeMult?: number };
}

/** What executing a technique does. The old `TechniqueMove`. */
export interface TechniqueMove {
  damageMult?: number;
  preventedMult?: number;
  damageType?: DamageType;
  counter?: { reduce: number; pool?: string; cost?: number };
  hits?: number;
  penetration?: number;
  splash?: number;
  inflicts?: StatusApplication[];
  buff?: { mods: ContentMod[]; duration: number };
  staminaCost?: number;
  momentum?: number;
  equipment?: 'ground' | 'recover' | 'draw' | 'impale' | 'wrench';
  crit?: { always: boolean; damageMult?: number; floor?: number };
  readiesSpell?: boolean;
  deliversSpell?: boolean;
  cooldown: number;
}

/** One way into a technique. The old `TechniqueEntry`. */
export interface TechniqueEntry {
  at: readonly string[] | 'any';
  trigger?: SkillTrigger;
}

/** A trigger as the JSON holds it. */
type RawTrigger = Infer<typeof triggerSchema>;

/** A technique as the JSON holds it. */
interface RawTechnique extends Omit<TechniqueDef, 'move' | 'from' | 'trigger'> {
  trigger?: RawTrigger;
  from: { any?: boolean; at?: string[]; trigger?: RawTrigger }[];
  move: Omit<TechniqueMove, 'inflicts'> & { inflicts?: ContentApplication[] };
}

/** A technique: a trained reflex. The old `TechniqueDef`. */
export interface TechniqueDef {
  id: string;
  name: string;
  icon: string;
  desc?: string;
  /** Weapon-family tag that must be worn. Absent: usable with anything. */
  family?: string;
  /** The skill it is shown under. */
  skill?: string;
  /** The baked reflex: when the technique answers. Absent: any swing. */
  trigger?: SkillTrigger;
  /** The declared ways in. */
  from: TechniqueEntry[];
  /** The position executing it leaves the fighter in. */
  to: string;
  move: TechniqueMove;
  unlock?: ConditionRecord[];
  learn?: { self?: { stat: string; count: number }; watch?: number };
  mastery?: { tier: number; name?: string; addFrom?: string[] }[];
  forks?: string[];
  requiresWielded?: boolean;
  requiresGrounded?: boolean;
  requiresImpaled?: boolean;
  requiresReadiedSpell?: boolean;
  requiresSheathed?: string;
}

/** One technique in the ledger. The old `TechniqueState`. */
export interface TechniqueState {
  executions: number;
  form: 'rough' | 'canonical' | 'syncretic';
  path?: string;
}

// ---- tables ----

export const POSITIONS: Record<string, PositionDef> = Object.fromEntries(
  (positionsData as PositionDef[]).map((p) => [p.id, p]),
);

function techniqueOf(raw: RawTechnique): TechniqueDef {
  const { move, from, trigger, ...rest } = raw;
  return {
    ...rest,
    ...(trigger ? { trigger: trigger as SkillTrigger } : {}),
    from: from.map((way) => ({
      at: way.any ? ('any' as const) : (way.at ?? []),
      ...(way.trigger ? { trigger: way.trigger as SkillTrigger } : {}),
    })),
    move: { ...move, inflicts: move.inflicts?.map(toApplication) },
  };
}

export const TECHNIQUE_LIST: readonly TechniqueDef[] = (techniquesData as unknown as RawTechnique[]).map(techniqueOf);
export const TECHNIQUES: Record<string, TechniqueDef> = Object.fromEntries(TECHNIQUE_LIST.map((t) => [t.id, t]));
