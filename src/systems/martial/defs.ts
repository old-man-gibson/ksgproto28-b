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
import teachersData from './content/teachers.json';

// ---- tuning ----

export const NEUTRAL_POSITION = 'neutral';
/** The position a readied spell is held in. Leaving it drops the spell (step 3). */
export const SPELL_READY_POSITION = 'spell_ready';
/** Ticks before a monster repeats a technique. Combat applies it to a shape with no cooldown of its own. */
export const WATCH_KEY_PREFIX = 'seen:technique:';
/** Drill slots: techniques whose practice counts at once. */
export const MAX_DRILLED = 3;
/** Technique slots beyond the drill slots. The rotation holds MAX_DRILLED + BASE_TECHNIQUE_SLOTS + extras. */
export const BASE_TECHNIQUE_SLOTS = 3;
export const MASTERY_LADDER = [10, 100, 1000, 10000] as const;
export const MASTERY_NAMES = ['Practiced', 'Drilled', 'Honed', 'Perfected'] as const;
/** Damage multiplier per rung, 1 to 4. */
export const MASTERY_POWER = [1.05, 1.12, 1.2, 1.3] as const;
/** Cooldown multiplier per rung, 1 to 4. */
export const MASTERY_COOLDOWN = [1, 0.92, 0.85, 0.75] as const;
/** Highest rung: 10^15 reps. */
export const MAX_MASTERY_TIER = 15;
/** Each rung past Perfected multiplies power by this. */
export const BEYOND_POWER = 2;
/** Each rung past Perfected multiplies the cooldown by this, floor 10 ticks. */
export const BEYOND_COOLDOWN = 0.9;
/** Stamina surcharge of a rough form below Perfected. */
export const ROUGH_STAMINA_MULT = 1.25;
/** A rough form's reps count double on the ladder. */
export const ROUGH_REP_MULT = 2;
/** Sightings that teach a watchable technique. */
export const TECHNIQUE_WATCH_COUNT = 50;
/** The rung at which a forked technique offers its choice (Honed). */
export const FORK_TIER = 3;

/** The weapon families the planner filters by. A grouping label only. The old `WEAPON_FAMILIES`. */
export const WEAPON_FAMILIES: readonly { id: string; name: string; icon: string }[] = [
  { id: 'unarmed', name: 'Unarmed', icon: '🥊' },
  { id: 'sword', name: 'Sword', icon: '⚔️' },
  { id: 'katana', name: 'Katana', icon: '🗡️' },
  { id: 'dagger', name: 'Dagger', icon: '🔪' },
  { id: 'blunt', name: 'Blunt', icon: '🔨' },
  { id: 'spear', name: 'Spear', icon: '🔱' },
  { id: 'bow', name: 'Bow', icon: '🏹' },
  { id: 'greatsword', name: 'Greatsword', icon: '🪓' },
  { id: 'staff', name: 'Staff', icon: '🪄' },
  { id: 'shield', name: 'Shield', icon: '🛡️' },
  { id: 'buckler', name: 'Buckler', icon: '🔰' },
];

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

/** Lessons, keyed by the id of the person who gives them. The old `NpcDef.teaches`. */
export const teachers = registry(
  s.object({
    id: s.id({ help: 'The id of the person who teaches (npcs registry).' }),
    lessons: s.array(
      s.object({
        technique: s.optional(s.ref('techniques')),
        school: s.optional(s.ref('skills', { help: 'A school: the lesson manifests its skill at level 1.' })),
        requires: s.optional(s.array(conditionSchema)),
      }),
    ),
  }),
  teachersData,
  'Teachers',
);

// ---- record types ----

/** A Honed fork. The old `ForkArchetypeDef`. */
export interface ForkArchetypeDef {
  id: string;
  name: string;
  icon: string;
  desc?: string;
  kind: 'strike' | 'buff';
  damageMult?: number;
  hits?: number;
  cooldownMult?: number;
  splashAdd?: number;
  staminaMult?: number;
  durationMult?: number;
  dodgeMult?: number;
  exitTo?: string;
}

/** One lesson: a technique (canonical form) or a school. The old `Lesson`. */
export interface Lesson {
  technique?: string;
  school?: string;
  requires?: ConditionRecord[];
}

export interface TeacherDef {
  id: string;
  lessons: Lesson[];
}


export interface PositionDef {
  id: string;
  name: string;
  icon: string;
  desc?: string;
  color: string;
  effects?: { incomingMult?: number; dodgeMult?: number };
  /** Hides the position even when a known technique reaches it. */
  unlock?: ConditionRecord[];
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

export const FORK_ARCHETYPE_LIST: readonly ForkArchetypeDef[] = forksData as ForkArchetypeDef[];
export const FORK_ARCHETYPES: Record<string, ForkArchetypeDef> = Object.fromEntries(FORK_ARCHETYPE_LIST.map((f) => [f.id, f]));
export const TEACHER_LIST: readonly TeacherDef[] = teachersData as TeacherDef[];
export const TEACHERS: Record<string, TeacherDef> = Object.fromEntries(TEACHER_LIST.map((t) => [t.id, t]));
