/**
 * Modifiers as the stat pipeline reads them, and the builders other systems
 * use to make them. Port of the modifier foundations in the old
 * `systems/attributes.ts` (`resolveModValue`, `LEVEL_CURVES`, the `push`
 * closure of `collectBaseMods`).
 *
 * Every target of this pipeline is `stats/<target>`:
 * - `<stat key>`: a derived stat. `add` adds; `mult` multiplies by (1 + value).
 * - `<attribute id>`: an attribute. Same two layers.
 * - `<stat key>:<tag>`: scoped. Applies only to work that carries the tag.
 * - `@...`: a fact. Not a number to add: an input another system hands to the
 *   pipeline. The fact builders below list them.
 */
import { s, type Infer, type Modifier } from '../../kernel';
import { ATTRIBUTE_IDS, STAT_KEYS, type AttributeId, type DamageType, type StatKey } from './keys';

export const STATS_PREFIX = 'stats/';

export const MOD_ORIGIN_KINDS = [
  'item',
  'affix',
  'rune',
  'handBonus',
  'achievement',
  'skill',
  'training',
  'title',
  'buff',
  'status',
  'style',
  'level',
  'legacy',
] as const;
export type ModOriginKind = (typeof MOD_ORIGIN_KINDS)[number];

/** Machine-readable origin of a modifier. Damping selects modifiers by it. */
export interface ModOrigin {
  kind: ModOriginKind;
  /** Equipment slot, for the item kinds. */
  slot?: string;
}

/** A modifier of the stat pipeline. The kernel carries the extra fields untouched. */
export interface StatMod extends Modifier {
  /** Label for breakdowns ("Iron Sword", "Fighting Lv 12"). */
  source?: string;
  origin?: ModOrigin;
  /** Exempt from condition damping. */
  undampened?: boolean;
  /** The value is scaled by the final value of this stat, in a last pass. */
  fromStat?: StatKey;
  /** Applies only while a worn or wielded item carries this tag. */
  requiresTag?: string;
  /** Applies only in this combat style. */
  requiresStyle?: string;
  /** Applies only against a target carrying this tag. Absent from the plain block. */
  requiresMonsterTag?: string;
  /** The value is multiplied by (1 + the `@scale:<name>` fact). */
  scaleBy?: string;
  /** Payload of a fact. */
  data?: unknown;
}

// ---- content modifiers ----

export const LEVEL_CURVE_IDS = ['resistTiered'] as const;
export type LevelCurveId = (typeof LEVEL_CURVE_IDS)[number];

/** Schema of one modifier in a content file. */
export const modifierSchema = s.object({
  stat: s.string({ help: 'A stat key, an attribute id, or a scoped target such as craftSpeed:leatherwork.' }),
  op: s.enum(['add', 'mult']),
  value: s.number(),
  perLevel: s.optional(s.number({ help: 'Added per level of the source.' })),
  levelCurve: s.optional(s.enum(LEVEL_CURVE_IDS)),
  requiresTag: s.optional(s.string()),
  requiresStyle: s.optional(s.string()),
  requiresMonsterTag: s.optional(s.string()),
  fromStat: s.optional(s.enum(STAT_KEYS)),
  undampened: s.optional(s.boolean()),
});

export type ContentMod = Infer<typeof modifierSchema>;

/** Why a content modifier's target is not one the pipeline knows, or null. */
export function targetIssue(target: string): string | null {
  const [head, ...rest] = target.split(':');
  if (rest.length === 0) {
    if ((STAT_KEYS as string[]).includes(head) || (ATTRIBUTE_IDS as readonly string[]).includes(head)) return null;
    return `"${target}" is not a stat key or an attribute id`;
  }
  if (!(STAT_KEYS as string[]).includes(head)) return `"${head}" in "${target}" is not a stat key`;
  if (rest.join(':') === '') return `"${target}" has an empty scope`;
  return null;
}

// Memo of the resistTiered curve: index = level, value = total fraction
// blocked. Grown on demand; levels have no ceiling.
const resistBlocked: number[] = [0];

function resistTiered(level: number): number {
  const lv = Math.max(0, Math.floor(level));
  for (let i = resistBlocked.length; i <= lv; i++) {
    const step = i % 25 === 0 ? 0.1 : i % 10 === 0 ? 0.05 : i % 5 === 0 ? 0.03 : 0.01;
    resistBlocked[i] = 1 - (1 - resistBlocked[i - 1]) * (1 - step);
  }
  return resistBlocked[lv];
}

export const LEVEL_CURVES: Record<LevelCurveId, (level: number) => number> = { resistTiered };

/** A content modifier's value at the level of its source (a skill level and so on). */
export function resolveModValue(
  mod: { value: number; perLevel?: number; levelCurve?: LevelCurveId },
  level = 0,
): number {
  const linear = mod.value + (mod.perLevel ?? 0) * level;
  return mod.levelCurve ? linear + LEVEL_CURVES[mod.levelCurve](level) : linear;
}

/**
 * Turn a content modifier into a pipeline modifier. The gates travel with it;
 * the pipeline applies them, because only it knows what is wielded, which
 * style is fought in and what the target is.
 */
export function contentMod(
  mod: ContentMod,
  source: string,
  origin: ModOrigin | undefined,
  level = 0,
  scale = 1,
): StatMod {
  return {
    stat: STATS_PREFIX + mod.stat,
    kind: mod.op,
    value: resolveModValue(mod, level) * scale,
    source,
    ...(origin ? { origin } : {}),
    ...(mod.undampened ? { undampened: true } : {}),
    ...(mod.fromStat ? { fromStat: mod.fromStat } : {}),
    ...(mod.requiresTag ? { requiresTag: mod.requiresTag } : {}),
    ...(mod.requiresStyle ? { requiresStyle: mod.requiresStyle } : {}),
    ...(mod.requiresMonsterTag ? { requiresMonsterTag: mod.requiresMonsterTag } : {}),
  };
}

/** A plain modifier on a stat key or an attribute id. */
export function statMod(
  target: StatKey | AttributeId | `${StatKey}:${string}`,
  kind: 'add' | 'mult',
  value: number,
  source?: string,
  origin?: ModOrigin,
): StatMod {
  return { stat: STATS_PREFIX + target, kind, value, ...(source ? { source } : {}), ...(origin ? { origin } : {}) };
}

// ---- facts ----

const fact = (name: string, value = 1, data?: unknown): StatMod => ({
  stat: `${STATS_PREFIX}@${name}`,
  kind: 'add',
  value,
  ...(data !== undefined ? { data } : {}),
});

/** The trained base level of an attribute. Facts of one attribute add up. */
export const baseAttrFact = (attr: AttributeId, level: number): StatMod => fact(`base:${attr}`, level);

/** A tag carried by a worn or wielded item. */
export const wieldTagFact = (tag: string): StatMod => fact(`tag:${tag}`);

/** The weapon slot is filled. Without this fact the entity wields the pseudo-tag `unarmed`. */
export const armedFact = (): StatMod => fact('armed');

/** The combat style fought in. Without this fact every `requiresStyle` modifier lapses. */
export const styleFact = (styleId: string): StatMod => fact(`style:${styleId}`);

/**
 * A named number other systems read from the stat table as
 * `stats/fact:<name>`. Facts of one name add up. `quest:<id>` (1 when turned
 * in) and `boon:<id>` (the rank) are read by the condition language.
 */
export const namedFact = (name: string, value: number): StatMod => fact(`fact:${name}`, value);

/** A ceiling on every attribute as the stat formulas read it. The lowest one holds. */
export const attrCeilingFact = (ceiling: number): StatMod => fact('attrCeiling', ceiling);

/** Two attributes are fused: each reads as the sum of both effective values. */
export const fuseFact = (a: AttributeId, b: AttributeId): StatMod => fact('fuse', 1, { a, b });

/** A last multiplier on an attribute, (1 + value), after every other modifier. */
export const endowmentFact = (attr: AttributeId, value: number): StatMod => fact(`endowment:${attr}`, value);

/** The number a `scaleBy: <name>` modifier is scaled by. Facts of one name add up. */
export const scaleFact = (name: string, value: number): StatMod => fact(`scale:${name}`, value);

export interface DampSpec {
  /** Origin kinds dulled. Absent: every kind. */
  kinds?: ModOriginKind[];
  /** Targets dulled. Absent: every target. */
  stats?: string[];
  /** Only modifiers from this slot. */
  slot?: string;
}

/** Dull a class of modifiers: each keeps (1 - share) of its value. */
export const dampFact = (share: number, spec: DampSpec): StatMod => fact('damp', share, spec);

/**
 * Dictate a resistance. With `bonusIfMet`, a value already at or past `to`
 * gains the bonus instead. Applied in modifier order.
 */
export const resOverrideFact = (type: DamageType, to: number, bonusIfMet?: number): StatMod =>
  fact(`resOverride:${type}`, to, bonusIfMet === undefined ? {} : { bonusIfMet });

/** The deepest a floor-carrying condition may push a resistance. The lowest one holds. */
export const resFloorFact = (floor: number): StatMod => fact('resFloor', floor);

/** What the floor-carrying conditions took off one resistance (negative). Adds up. */
export const resFloorTakenFact = (stat: StatKey, taken: number): StatMod => fact(`resFloorTaken:${stat}`, taken);

/** The variant key of the block against a target carrying `tags`. `''` for none. */
export function vsVariant(tags: Iterable<string>): string {
  const sorted = [...new Set(tags)].sort();
  return sorted.length === 0 ? '' : `vs:${sorted.join(',')}`;
}
