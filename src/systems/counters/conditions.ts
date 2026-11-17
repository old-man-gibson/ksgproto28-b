/**
 * The condition language. Port of the old `systems/conditions.ts`.
 *
 * A condition is data. It is evaluated against a `ConditionReader`, which the
 * calling system builds from what it can read. This file imports no system,
 * so skills, quests, gates and prestige can all use it.
 */
import { s, type Infer } from '../../kernel';

export type Condition =
  | { type: 'skill'; id: string; level: number }
  | { type: 'attr'; attr: string; level: number }
  /** Counter at or above `value`. */
  | { type: 'stat'; key: string; value: number }
  /** Counter at or below `value`. */
  | { type: 'statMax'; key: string; value: number }
  | { type: 'equippedTag'; tag: string }
  /** Met once the named quest has been turned in. */
  | { type: 'quest'; id: string }
  /** Met while a prestige boon is owned (rank 1 or more). */
  | { type: 'boon'; id: string };

export const CONDITION_TYPES = ['skill', 'attr', 'stat', 'statMax', 'equippedTag', 'quest', 'boon'] as const;

/**
 * Schema of one condition in a content file. The kernel schema has no union,
 * so every field but `type` is optional here; `conditionIssues` checks that a
 * record carries the fields its type needs.
 */
export const conditionSchema = s.object({
  type: s.enum(CONDITION_TYPES),
  id: s.optional(s.string()),
  attr: s.optional(s.string()),
  level: s.optional(s.number()),
  key: s.optional(s.string()),
  value: s.optional(s.number()),
  tag: s.optional(s.string()),
});

export type ConditionRecord = Infer<typeof conditionSchema>;

const REQUIRED: Record<Condition['type'], readonly string[]> = {
  skill: ['id', 'level'],
  attr: ['attr', 'level'],
  stat: ['key', 'value'],
  statMax: ['key', 'value'],
  equippedTag: ['tag'],
  quest: ['id'],
  boon: ['id'],
};

/** The fields a condition record lacks or carries in excess, as messages. Empty when sound. */
export function conditionIssues(record: ConditionRecord): string[] {
  const needed = REQUIRED[record.type];
  const issues: string[] = [];
  for (const field of needed) {
    if ((record as Record<string, unknown>)[field] === undefined) issues.push(`${record.type} condition lacks "${field}"`);
  }
  for (const field of Object.keys(record)) {
    if (field !== 'type' && !needed.includes(field)) issues.push(`${record.type} condition has unused field "${field}"`);
  }
  return issues;
}

/** What a condition is evaluated against. */
export interface ConditionReader {
  /** Level of a held skill, 0 when not held. */
  skillLevel(id: string): number;
  /** The attribute value all checks read: effective, fused components summed. */
  attr(id: string): number;
  /** A counter, 0 when never written. */
  counter(key: string): number;
  /** Whether a worn or wielded item carries the tag. Bare hands carry `unarmed`. */
  hasTag(tag: string): boolean;
  questDone(id: string): boolean;
  boonRank(id: string): number;
}

export function conditionMet(reader: ConditionReader, cond: Condition): boolean {
  switch (cond.type) {
    case 'skill':
      return reader.skillLevel(cond.id) >= cond.level;
    case 'attr':
      return reader.attr(cond.attr) >= cond.level;
    case 'stat':
      return reader.counter(cond.key) >= cond.value;
    case 'statMax':
      return reader.counter(cond.key) <= cond.value;
    case 'equippedTag':
      return reader.hasTag(cond.tag);
    case 'quest':
      return reader.questDone(cond.id);
    case 'boon':
      return reader.boonRank(cond.id) > 0;
  }
}

/**
 * How far along a threshold condition is, 0 to 1. A condition that is not a
 * threshold (a quest, a tag, a counter kept low, a boon) reads as 1.
 */
export function conditionProgress(reader: ConditionReader, cond: Condition): number {
  switch (cond.type) {
    case 'skill':
      return cond.level <= 0 ? 1 : Math.min(1, reader.skillLevel(cond.id) / cond.level);
    case 'attr':
      return cond.level <= 0 ? 1 : Math.min(1, reader.attr(cond.attr) / cond.level);
    case 'stat':
      return cond.value <= 0 ? 1 : Math.min(1, reader.counter(cond.key) / cond.value);
    case 'statMax':
    case 'equippedTag':
    case 'quest':
    case 'boon':
      return 1;
  }
}

/** The least-advanced threshold in a set, 0 to 1. An empty set reads as 1. */
export function conditionsProgress(reader: ConditionReader, conds: readonly Condition[]): number {
  let least = 1;
  for (const c of conds) least = Math.min(least, conditionProgress(reader, c));
  return least;
}

export function conditionsMet(reader: ConditionReader, conds: readonly Condition[]): boolean {
  return conds.every((c) => conditionMet(reader, c));
}
