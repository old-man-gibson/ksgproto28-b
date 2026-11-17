/**
 * The divine school: miracles and the deities they come from. Port of
 * `MIRACLES`, `DEITIES` and `DEITY_TAGS` of the old data, `miracleSpec` of
 * the old `systems/divine.ts` and `deityRelation` of the old
 * `systems/deities.ts`. See README.md in this folder for the cut: favour,
 * receiving a miracle and the pantheon shelf are step 3.
 *
 * The school registers itself with `spellcraft` at module load. This system
 * holds no state.
 */
import { defineSystem, registry, s } from '../../kernel';
import {
  registerSchool,
  spellSpecSchema,
  statedSpec,
  type DeityRelation,
  type RawSpellSpec,
  type SpellSpec,
} from '../spellcraft';
import deitiesData from './content/deities.json';
import deityTagsData from './content/deity_tags.json';
import miraclesData from './content/miracles.json';
import { migrations } from './migrations';

// ---- registries ----

const relationRule = s.object({
  anyOf: s.array(s.string(), { help: 'Applies to a deity carrying one of these tags.' }),
  unless: s.optional(s.array(s.string(), { help: 'Not when it also carries one of these.' })),
  waiver: s.optional(s.array(s.string(), { help: 'The exception is waived by one of these.' })),
});

export const DEITY_TAG_CATEGORIES = ['scope', 'nature', 'membership', 'alignment', 'temperament', 'domain'] as const;

export const deityTags = registry(
  s.object({
    id: s.id(),
    tag: s.string({ minLength: 1, help: 'The tag as deities and relation rules name it. Three hold a space.' }),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    category: s.enum(DEITY_TAG_CATEGORIES),
    desc: s.optional(s.string()),
  }),
  deityTagsData,
  'Deity tags',
);

export const deities = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    epithet: s.string(),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Portrait file name. The file is not in this repository.' })),
    desc: s.string(),
    tags: s.array(s.string(), { help: 'Its aspects: `tag` values of the deity tag registry.' }),
    pantheon: s.optional(s.string()),
    synergies: s.optional(s.array(relationRule)),
    hostilities: s.optional(s.array(relationRule)),
  }),
  deitiesData,
  'Deities',
);

export const miracles = registry(
  s.object({
    id: s.id(),
    deity: s.ref('deities'),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    desc: s.optional(s.string()),
    favorCost: s.number({ min: 0, help: 'Favour spent once to receive it (step 3).' }),
    minLevel: s.optional(s.number({ help: 'Devotion level required (step 3).' })),
    spec: spellSpecSchema,
  }),
  miraclesData,
  'Miracles',
);

// ---- record types ----

/** One clause of a deity's disposition toward other deities. */
export interface DeityRelationRule {
  anyOf: string[];
  unless?: string[];
  waiver?: string[];
}

export interface DeityDef {
  id: string;
  name: string;
  epithet: string;
  icon: string;
  art?: string;
  desc: string;
  tags: string[];
  pantheon?: string;
  synergies?: DeityRelationRule[];
  hostilities?: DeityRelationRule[];
}

export interface DeityTagDef {
  id: string;
  tag: string;
  name: string;
  icon: string;
  category: (typeof DEITY_TAG_CATEGORIES)[number];
  desc?: string;
}

/** A miracle: a divine working, stated whole. */
export interface MiracleDef {
  id: string;
  deity: string;
  name: string;
  icon: string;
  desc?: string;
  favorCost: number;
  minLevel?: number;
  spec: Omit<SpellSpec, 'school'>;
}

export const DEITY_LIST: readonly DeityDef[] = deitiesData as DeityDef[];
export const DEITIES: Record<string, DeityDef> = Object.fromEntries(DEITY_LIST.map((d) => [d.id, d]));
export const DEITY_TAGS: Record<string, DeityTagDef> = Object.fromEntries(
  (deityTagsData as DeityTagDef[]).map((t) => [t.tag, t]),
);
export const MIRACLE_LIST: readonly MiracleDef[] = (
  miraclesData as unknown as (Omit<MiracleDef, 'spec'> & { spec: RawSpellSpec })[]
).map((m) => ({ ...m, spec: statedSpec(m.spec) }));
export const MIRACLES: Record<string, MiracleDef> = Object.fromEntries(MIRACLE_LIST.map((m) => [m.id, m]));

/** The miracles of one deity, in registry order. */
export function miraclesOf(deityId: string): MiracleDef[] {
  return MIRACLE_LIST.filter((m) => m.deity === deityId);
}

// ---- how the pantheon regards itself ----

/** Does `rule` apply to a deity carrying `tags`? */
function ruleMatches(rule: DeityRelationRule, tags: readonly string[]): boolean {
  if (!rule.anyOf.some((t) => tags.includes(t))) return false;
  if (rule.unless?.some((t) => tags.includes(t))) {
    // The exception can itself be waived.
    return rule.waiver?.some((t) => tags.includes(t)) ?? false;
  }
  return true;
}

function declares(rules: DeityRelationRule[] | undefined, other: DeityDef): boolean {
  return (rules ?? []).some((rule) => ruleMatches(rule, other.tags));
}

/**
 * The standing between two deities. Order does not matter. Rules are declared
 * per deity; a pair is resolved from both sides, and hostility on either
 * side wins. A deity is in synergy with itself. The old `deityRelation`.
 */
export function deityRelation(aId: string, bId: string): DeityRelation {
  if (aId === bId) return 'synergy';
  const a = DEITIES[aId];
  const b = DEITIES[bId];
  if (!a || !b) return 'neutral';
  if (declares(a.hostilities, b) || declares(b.hostilities, a)) return 'hostile';
  if (declares(a.synergies, b) || declares(b.synergies, a)) return 'synergy';
  return 'neutral';
}

// ---- the school ----

/** Resolve a miracle to its spell, or null for an unknown id. The old `miracleSpec`. */
export function miracleSpec(id: string): SpellSpec | null {
  const miracle = MIRACLES[id];
  if (!miracle) return null;
  return { ...miracle.spec, school: 'divine', deity: miracle.deity };
}

registerSchool('divine', {
  key: (source) => source.litany,
  spec: (source) => miracleSpec(source.litany),
  relation: deityRelation,
});

export default defineSystem<Record<string, never>>({
  id: 'divine',
  version: 1,
  migrations,
  initial: () => ({}),
  content: { miracles, deities, deity_tags: deityTags },
});
