/**
 * The status registry: schema, record types and the id map. Port of the
 * `StatusDef` family in the old `types.ts` and of `data/statuses.data.ts`.
 *
 * Three fields differ from the old literals, because the schema has no null,
 * no union and no map (scripts/convert-content.mjs, job `statuses`):
 * - `duration` absent means no timer (the old `duration: null`);
 * - `overrideRes` is a list of `{ type, to, bonusIfMet }` in the old key order;
 * - an application in content writes `permanent: true` for the old
 *   `duration: 'permanent'`.
 */
import { registry, s, type RecordOf } from '../../kernel';
import { RESOURCE_IDS, type ResourceId } from '../resources';
import { ATTRIBUTE_IDS, DAMAGE_TYPES, MOD_ORIGIN_KINDS, modifierSchema, type ContentMod, type DamageType } from '../stats';
import statusesData from './content/statuses.json';

export const STATUS_STACK_MODES = ['highest', 'absorb', 'sum', 'count', 'extend'] as const;
export type StatusStackMode = (typeof STATUS_STACK_MODES)[number];

/** Things that can end a condition, beyond its timer running out. */
export const STATUS_EVENTS = ['heal', 'damageTaken', 'damageDealt', 'barFill', 'barDeplete', 'combatEnd', 'cure'] as const;
export type StatusEvent = (typeof STATUS_EVENTS)[number];

export const STATUS_REMOVAL_EFFECTS = ['remove', 'deescalate', 'reduce', 'unstack'] as const;
export const BLOCKABLE_ACTIONS = ['spell', 'attack', 'swing'] as const;
export type BlockableAction = (typeof BLOCKABLE_ACTIONS)[number];

const damageType = () => s.enum(DAMAGE_TYPES);
const resource = () => s.enum(RESOURCE_IDS);

export const removalSchema = s.object({
  on: s.enum(STATUS_EVENTS),
  healKinds: s.optional(s.array(s.string(), { help: 'For heal: only these kinds count.' })),
  tag: s.optional(s.string({ help: 'For cure: the cure tag that matches.' })),
  damageTypes: s.optional(s.array(damageType(), { help: 'For the damage events: only blows of these types count.' })),
  after: s.optional(s.number({ help: 'How many matching events it takes.' })),
  afterDamage: s.optional(s.number({ help: 'How much matching damage it takes, as a total.' })),
  effect: s.optional(s.enum(STATUS_REMOVAL_EFFECTS)),
  amount: s.optional(s.number({ help: 'For reduce: the share of intensity taken off.' })),
  becomes: s.optional(s.ref('statuses', { help: 'For remove: what takes its place.' })),
});

/** One way a condition can end. A source may declare its own rules. */
export interface StatusRemoval {
  on: StatusEvent;
  healKinds?: string[];
  tag?: string;
  damageTypes?: DamageType[];
  after?: number;
  afterDamage?: number;
  effect?: (typeof STATUS_REMOVAL_EFFECTS)[number];
  amount?: number;
  becomes?: string;
}

/** An application as content writes it. */
export const applicationSchema = s.object({
  id: s.ref('statuses'),
  intensity: s.optional(s.number({ help: 'Default 1.' })),
  duration: s.optional(s.number({ help: 'Ticks. Overrides the lifetime of the status.' })),
  permanent: s.optional(s.boolean({ help: 'No timer: only a removal rule ends it.' })),
  removal: s.optional(s.array(removalSchema, { help: 'Replaces the removal rules of the status.' })),
  chance: s.optional(s.number({ min: 0, max: 1, help: 'Probability it lands. Default 1.' })),
});

export interface ContentApplication {
  id: string;
  intensity?: number;
  duration?: number;
  permanent?: boolean;
  removal?: StatusRemoval[];
  chance?: number;
}

/**
 * What a source (a bite, a rune, a spell) declares it inflicts. Everything
 * but the id is optional: absent, the defaults of the status apply.
 */
export interface StatusApplication {
  id: string;
  /** Default 1. */
  intensity?: number;
  /** Overrides the lifetime; 'permanent' means only a removal rule ends it. */
  duration?: number | 'permanent';
  /** Replaces the removal rules for this application. */
  removal?: StatusRemoval[];
  /** Probability the application lands. Default 1. */
  chance?: number;
}

/** A content application as the engine takes it. */
export function toApplication(app: ContentApplication): StatusApplication {
  const { permanent, duration, ...rest } = app;
  return { ...rest, ...(permanent ? { duration: 'permanent' as const } : duration !== undefined ? { duration } : {}) };
}

const statuses = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Art key.' })),
    desc: s.string({ help: 'Shown to the player. Facts only.' }),
    element: s.optional(s.enum(DAMAGE_TYPES, { help: 'The damage type whose resistance answers the dose.' })),
    unresistable: s.optional(s.string({ minLength: 1, help: 'The reason no resistance answers it.' })),
    contest: s.optional(s.enum(ATTRIBUTE_IDS, { help: 'A bearer with more of this attribute than the player takes a smaller dose.' })),
    statue: s.optional(
      s.object({
        rocks: s.number(),
        burst: s.number(),
        chunks: s.number(),
        xp: s.number(),
        stands: s.optional(s.boolean()),
      }),
    ),
    attrCeiling: s.optional(s.boolean()),
    routeExcess: s.optional(s.boolean()),
    repMult: s.optional(s.boolean()),
    drillsAll: s.optional(s.boolean()),
    parryContest: s.optional(s.object({ per: s.number(), answer: s.number() })),
    blowCut: s.optional(s.object({ rattle: s.number() })),
    pureBlows: s.optional(s.boolean()),
    unarmedRider: s.optional(damageType()),
    cloneYield: s.optional(s.number()),
    cloneXp: s.optional(s.number()),
    escalatesTo: s.optional(s.ref('statuses')),
    baseForm: s.optional(s.ref('statuses')),
    expiresTo: s.optional(s.ref('statuses')),
    expireDamage: s.optional(
      s.object({ type: damageType(), flat: s.optional(s.number()), maxHp: s.optional(s.number()) }),
    ),
    blockedBy: s.optional(s.array(s.ref('statuses'))),
    immune: s.optional(
      s.object({ elements: s.optional(s.array(damageType())), ids: s.optional(s.array(s.ref('statuses'))) }),
    ),
    stacking: s.object({
      mode: s.enum(STATUS_STACK_MODES),
      refreshDuration: s.optional(s.boolean()),
      absorb: s.optional(s.number()),
      cap: s.optional(s.number()),
      onCap: s.optional(s.enum(['escalate', 'clamp'])),
      escalateMult: s.optional(s.number()),
      escalateFrom: s.optional(s.number()),
    }),
    duration: s.optional(s.number({ min: 0, help: 'Lifetime in ticks. Absent: no timer, only a removal rule ends it.' })),
    removal: s.optional(s.array(removalSchema)),
    mods: s.optional(s.array(modifierSchema, { help: 'Values scale with intensity.' })),
    ceilings: s.optional(
      s.array(s.object({ resource: resource(), per: s.number(), max: s.optional(s.number()) })),
    ),
    restores: s.optional(
      s.array(s.object({ resource: resource(), flat: s.optional(s.number()), ofMax: s.optional(s.number()) })),
    ),
    ceilingFromSpend: s.optional(s.object({ resource: resource(), share: s.number(), max: s.optional(s.number()) })),
    ceilingDecay: s.optional(s.number()),
    dot: s.optional(
      s.object({
        type: damageType(),
        flat: s.optional(s.number()),
        currentHp: s.optional(s.number()),
        maxHp: s.optional(s.number()),
        fromPeak: s.optional(s.array(s.enum(['flat', 'currentHp', 'maxHp']))),
        outOfCombat: s.optional(s.number()),
        pierce: s.optional(s.number()),
      }),
    ),
    damp: s.optional(
      s.object({
        kinds: s.optional(s.array(s.enum(MOD_ORIGIN_KINDS))),
        stats: s.optional(s.array(s.string())),
        slot: s.optional(s.string({ help: 'Equipment slot id.' })),
        per: s.number(),
        max: s.optional(s.number()),
      }),
    ),
    healCap: s.optional(s.number()),
    hidden: s.optional(s.boolean()),
    color: s.optional(s.string({ help: 'A colour of the old interface. Not read here.' })),
    decayWithDuration: s.optional(s.boolean()),
    overrideRes: s.optional(
      s.array(s.object({ type: damageType(), to: s.number(), bonusIfMet: s.optional(s.number()) })),
    ),
    resFloor: s.optional(s.object({ base: s.number(), perStack: s.number() })),
    amplifies: s.optional(s.array(s.object({ id: s.ref('statuses'), mult: s.number() }))),
    capOverrides: s.optional(s.array(s.object({ id: s.ref('statuses'), cap: s.number() }))),
    converts: s.optional(
      s.array(s.object({ from: s.ref('statuses'), to: s.ref('statuses'), ratio: s.number() })),
    ),
    disadvantage: s.optional(s.boolean()),
    negativeHeadroom: s.optional(s.object({ resource: resource(), base: s.number(), perStack: s.number() })),
    detonate: s.optional(s.object({ type: damageType(), ofDebt: s.number(), bypassRes: s.optional(s.number()) })),
    drains: s.optional(s.object({ resource: resource(), flat: s.optional(s.number()), ofMax: s.optional(s.number()) })),
    fatalOnEmpty: s.optional(s.object({ resource: resource(), retains: s.number() })),
    blocks: s.optional(s.array(s.enum(BLOCKABLE_ACTIONS))),
    blocksRegen: s.optional(s.array(resource())),
    missChance: s.optional(s.number()),
    incomingBite: s.optional(s.number()),
    opensTempo: s.optional(s.boolean()),
    forceStyle: s.optional(
      s.string({ help: 'A combat style id. Becomes a reference when the styles registry is ported.' }),
    ),
    costMult: s.optional(s.object({ resource: resource(), per: s.number(), max: s.optional(s.number()) })),
    ceilingPerTick: s.optional(s.object({ resource: resource(), per: s.number(), max: s.number() })),
    bar: s.optional(
      s.object({
        onFill: s.optional(s.object({ type: damageType(), flat: s.number() })),
        onDeplete: s.optional(s.object({ type: damageType(), flat: s.number() })),
        reverse: s.optional(s.boolean()),
        skip: s.optional(s.number()),
      }),
    ),
    surplus: s.optional(
      s.object({
        escalateAt: s.optional(s.number()),
        detonateAt: s.optional(s.number()),
        detonateType: s.optional(damageType()),
        detonateShare: s.optional(s.number()),
        decayShare: s.optional(s.number()),
      }),
    ),
    invertsDots: s.optional(s.array(s.ref('statuses'))),
    pacifiesFlankers: s.optional(s.boolean()),
    incomingMissChance: s.optional(s.number()),
    blocksRanged: s.optional(s.object({ except: s.optional(s.array(damageType())) })),
    magnetism: s.optional(
      s.object({
        dodgeIgnore: s.optional(s.number()),
        nullifyDodge: s.optional(s.boolean()),
        alwaysHit: s.optional(s.array(damageType())),
        critChancePer: s.optional(s.number()),
        critTypes: s.optional(s.array(damageType())),
        critDamagePerStack: s.optional(s.number()),
      }),
    ),
    displaces: s.optional(
      s.object({
        to: s.string({ help: 'A martial position id. Becomes a reference when positions are ported.' }),
        chancePer: s.optional(s.number()),
        always: s.optional(s.boolean()),
      }),
    ),
    tends: s.optional(
      s.object({
        growPerSecond: s.number(),
        prunePerHit: s.optional(s.number()),
        prunedBy: s.optional(s.array(damageType())),
        fedBy: s.optional(s.array(damageType())),
        feedPerHit: s.optional(s.number()),
      }),
    ),
    grafts: s.optional(
      s.object({
        except: s.optional(s.array(s.ref('statuses'))),
        cap: s.optional(s.number()),
        spreadShare: s.optional(s.number()),
        spreadEvery: s.optional(s.number()),
        harvest: s.optional(s.object({ on: s.array(damageType()), type: damageType(), perIntensity: s.number() })),
      }),
    ),
    retaliate: s.optional(
      s.object({
        type: damageType(),
        flat: s.number(),
        onAttack: s.optional(s.boolean()),
        onContact: s.optional(s.boolean()),
        hits: s.optional(s.enum(['bearer', 'attacker'])),
        inflicts: s.optional(s.array(applicationSchema)),
      }),
    ),
    dropWeaponBelow: s.optional(s.number()),
  }),
  statusesData,
  'Statuses',
);

export { statuses as statusRegistry };

type Raw = RecordOf<typeof statuses>;

/** One status record. The fields the schema types loosely are narrowed here. */
export type StatusDef = Omit<Raw, 'removal' | 'mods' | 'retaliate' | 'attrCeiling'> & {
  removal?: StatusRemoval[];
  mods?: ContentMod[];
  attrCeiling?: boolean;
  retaliate?: Omit<NonNullable<Raw['retaliate']>, 'inflicts'> & { inflicts?: ContentApplication[] };
};

export const STATUS_LIST = statusesData as unknown as StatusDef[];

/**
 * Every status by id. The tests add and remove records here, as the old tests
 * did on the old `STATUSES`.
 */
export const STATUSES: Record<string, StatusDef> = Object.fromEntries(STATUS_LIST.map((def) => [def.id, def]));

export function statusDef(id: string): StatusDef | undefined {
  return STATUSES[id];
}

/** The lifetime of a status in ticks, or null when it has no timer. */
export function defDuration(def: StatusDef): number | null {
  return def.duration ?? null;
}

/**
 * The most `weight_of_hunger` may slow a bar: -2/3 of speed. The ability
 * that applies it clamps the intensity to this.
 */
export const HUNGER_SLOW_CEILING = 2 / 3;

/** A source label that starts with this marks a condition the weather put there. */
export const WEATHER_SOURCE_PREFIX = 'Weather: ';

/** A condition as an entity holds it. */
export interface StatusInstance {
  id: string;
  /** Combined magnitude. */
  intensity: number;
  /** The strongest single application taken. `dot.fromPeak` parts scale with it. */
  peak: number;
  stacks: number;
  /** Ticks remaining; null waits for a removal rule. */
  ticksLeft: number | null;
  /** The removal rules in force for this instance, from what inflicted it. */
  removal?: StatusRemoval[];
  /** What inflicted it. */
  source?: string;
  /** Bookkeeping: damage dealt, healing allowed, debts, counters. */
  data?: Record<string, number>;
  /** The pool `data.debt` is held down on. Travels with the debt to a successor. */
  debtPool?: ResourceId;
}
