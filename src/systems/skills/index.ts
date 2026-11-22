/**
 * Skills: discovery, XP, levels, caps, novelty, and the skill tree. Port of
 * the old `systems/skills.ts` and `data/skills.data.ts`. See README.md in
 * this folder.
 */
import {
  answer,
  defineEvent,
  defineRequest,
  defineSystem,
  on,
  PLAYER,
  registry,
  s,
  type Ctx,
  type DeepReadonly,
  type DerivedReads,
  type RecordOf,
  type SystemDef,
} from '../../kernel';
import counters, {
  bumpCounter,
  conditionSchema,
  conditionsMet,
  conditionsProgress,
  counterValue,
  type Condition,
  type ConditionReader,
} from '../counters';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { bandedXpNeeded, bandSchema, DEFAULT_PROGRESSION, settleLevels, type ProgressionBand } from '../progression';
import {
  attrValue,
  contentMod,
  factValue,
  hasWieldTag,
  modifierSchema,
  statOf,
  type AttributeId,
  type ModOrigin,
  type StatMod,
} from '../stats';
import skillCategoriesData from './content/skill_categories.json';
import skillsData from './content/skills.json';
import skillsTextData from './content/skills_text.json';
import { migrations } from './migrations';

// ---- slice ----

export interface SkillState {
  level: number;
  xp: number;
  /** Cap raises this run earned (quests, events). */
  capRaised?: number;
}

export interface SkillsState {
  /** Held skills by id. A skill not in this map is locked. */
  skills: Record<string, SkillState>;
  /** XP banked toward a locked skill's first level. */
  latent: Record<string, number>;
  /** Skill id to input key to times seen, for skills that learn from novelty. */
  novelty: Record<string, Record<string, number>>;
}

// ---- content ----

export const SKILL_CATEGORY_IDS = ['combat', 'magic', 'resistance', 'craft', 'general', 'environmental'] as const;
export type SkillCategory = (typeof SKILL_CATEGORY_IDS)[number];

export const NOVELTY_DOMAINS = [
  'bestiary',
  'library',
  'dialogue',
  'arcana',
  'geneshaping',
  'weather',
  'cookery',
] as const;
export type NoveltyDomain = (typeof NOVELTY_DOMAINS)[number];

const skillCategories = registry(
  s.object({ id: s.enum(SKILL_CATEGORY_IDS), name: s.string({ minLength: 1 }), icon: s.string() }),
  skillCategoriesData,
  'Skill categories',
);

const skills = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Art key.' })),
    desc: s.string(),
    kind: s.enum(['passive', 'active']),
    category: s.ref('skill_categories'),
    tags: s.array(s.string(), { help: 'An action trains the skill when it carries one of the tags the skill adds to its parent.' }),
    parent: s.optional(s.ref('skills')),
    unlock: s.array(conditionSchema, { help: 'All must hold for the skill to manifest during an action that trains it.' }),
    effects: s.optional(s.array(modifierSchema, { help: 'Passive effects, scaled by skill level through perLevel.' })),
    tierNames: s.optional(
      s.array(s.object({ level: s.number({ min: 1, integer: true }), name: s.string({ minLength: 1 }) })),
    ),
    progression: s.optional(s.array(bandSchema, { help: 'XP curve. Absent: the "simple" curve.' })),
    maxLevel: s.optional(s.number({ min: 1, integer: true, help: 'Base level cap. At the cap XP is discarded.' })),
    novelty: s.optional(
      s.object({
        domain: s.enum(NOVELTY_DOMAINS),
        k: s.number({ min: 0 }),
        c: s.number({ min: 0 }),
        discovery: s.number({ min: 0 }),
      }),
    ),
    milestones: s.optional(
      s.array(s.object({ level: s.number({ min: 1, integer: true }), bonus: s.array(modifierSchema) }), {
        help: 'Sorted by level. Cumulative, not scaled by level.',
      }),
    ),
  }),
  skillsData,
  'Skills',
);

const skillsText = registry(textSchema, skillsTextData, 'Skill text');
const TEXT = Object.fromEntries((skillsTextData as TextRecord[]).map((r) => [r.id, r.text]));

export type SkillCategoryDef = RecordOf<typeof skillCategories>;
export type NoveltySpec = { domain: NoveltyDomain; k: number; c: number; discovery: number };
export type SkillDef = Omit<RecordOf<typeof skills>, 'unlock' | 'progression'> & {
  unlock: Condition[];
  progression?: ProgressionBand[];
};

export const SKILL_CATEGORIES = skillCategoriesData as SkillCategoryDef[];
export const SKILL_LIST = skillsData as unknown as SkillDef[];
export const SKILLS: Record<string, SkillDef> = Object.fromEntries(SKILL_LIST.map((def) => [def.id, def]));

// ---- curves and names ----

/** The curve a skill levels on: its own bands, or the default shape. */
export function skillProgression(skillId: string): ProgressionBand[] {
  return SKILLS[skillId]?.progression ?? DEFAULT_PROGRESSION;
}

/** XP to take `skillId` from `level` to the next. */
export function skillXpNeeded(skillId: string, level: number): number {
  return bandedXpNeeded(skillProgression(skillId), level);
}

export function isUnlocked(state: DeepReadonly<SkillsState>, skillId: string): boolean {
  return skillId in state.skills;
}

export function skillLevel(state: DeepReadonly<SkillsState>, skillId: string): number {
  return state.skills[skillId]?.level ?? 0;
}

/** Mastery-tier name for a skill at the given level, if it has one. */
export function skillTierName(skillId: string, level: number): string | null {
  const tiers = SKILLS[skillId]?.tierNames;
  if (!tiers?.length) return null;
  let name: string | null = null;
  for (const t of tiers) {
    if (level >= t.level) name = t.name;
  }
  return name;
}

// ---- training ----

const OWN_TAGS = new Map<string, readonly string[]>();

/** A skill's own tags: the ones its parent does not already carry. */
function ownTags(def: SkillDef): readonly string[] {
  let own = OWN_TAGS.get(def.id);
  if (!own) {
    const parent = def.parent ? SKILLS[def.parent] : undefined;
    own = parent ? def.tags.filter((t) => !parent.tags.includes(t)) : def.tags;
    OWN_TAGS.set(def.id, own);
  }
  return own;
}

/**
 * Whether an action trains a skill. Practice flows up the tree, never
 * sideways: the action must match the skill's own tags and everything its
 * parent chain needs. A skill that adds no tag of its own trains whenever its
 * parent does.
 */
export function skillTrainedBy(def: SkillDef, tags: readonly string[]): boolean {
  const own = ownTags(def);
  if (own.length > 0 && !own.some((t) => tags.includes(t))) return false;
  const parent = def.parent ? SKILLS[def.parent] : undefined;
  if (parent) return skillTrainedBy(parent, tags);
  return own.length > 0;
}

interface Trained {
  skills: readonly SkillDef[];
  /** The ids of `skills`. */
  ids: ReadonlySet<string>;
}

const TRAINED_BY = new Map<string, Trained & { tags: readonly string[] }>();
/**
 * Lists of one and of two tags, by tag: the most frequent lists (the hunt
 * activity asks for `combat` and `hunt` on every tick, a hit for one
 * resistance), found with no key built.
 */
const TRAINED_BY_ONE = new Map<string, Trained>();
const TRAINED_BY_TWO = new Map<string, Map<string, Trained>>();

function trainedOf(tags: readonly string[]): Trained {
  const skills = SKILL_LIST.filter((def) => skillTrainedBy(def, tags));
  return { skills, ids: new Set(skills.map((def) => def.id)) };
}

/**
 * The skills an action carrying `tags` trains. The answer depends on the
 * skill registry alone, which is fixed once loaded, so it is kept per tag
 * list: the handlers below run on every tick of an activity.
 */
function trainedBy(tags: readonly string[]): Trained {
  if (tags.length === 1) {
    let found = TRAINED_BY_ONE.get(tags[0]);
    if (!found) TRAINED_BY_ONE.set(tags[0], (found = trainedOf(tags)));
    return found;
  }
  if (tags.length === 2) {
    let inner = TRAINED_BY_TWO.get(tags[0]);
    if (!inner) TRAINED_BY_TWO.set(tags[0], (inner = new Map()));
    let found = inner.get(tags[1]);
    if (!found) inner.set(tags[1], (found = trainedOf(tags)));
    return found;
  }
  const key = tags.join('|');
  const known = TRAINED_BY.get(key);
  if (known) {
    // A tag holding the separator could share a key with another list:
    // the stored list must equal this one.
    if (known.tags.length === tags.length && known.tags.every((t, i) => t === tags[i])) return known;
    return trainedOf(tags);
  }
  const found = trainedOf(tags);
  TRAINED_BY.set(key, { ...found, tags: [...tags] });
  return found;
}

/** Every skill an action carrying `tags` trains, in `SKILL_LIST` order. Shared: do not change it. */
export function skillsTrainedBy(tags: readonly string[]): readonly SkillDef[] {
  return trainedBy(tags).skills;
}

/**
 * A skill gated only by attribute thresholds also manifests by use: XP it
 * would earn while locked is banked, and once the bank holds its first
 * level's cost it manifests. A skill gated on another skill, a wielded weapon
 * or a counter keeps its gates.
 */
export function manifestsByXp(def: SkillDef): boolean {
  return def.unlock.length > 0 && def.unlock.every((c) => c.type === 'attr');
}

/** XP banked toward a locked skill's first level. */
export function latentXp(state: DeepReadonly<SkillsState>, skillId: string): number {
  return state.latent[skillId] ?? 0;
}

// ---- novelty ----

/**
 * What one more of the same input is worth, as a multiple of the ordinary
 * payout: `(k + n) / (c + n)`. Opens at `k / c` and decays towards 1.
 */
export function noveltyYield(spec: NoveltySpec, n: number): number {
  return (spec.k + n) / (spec.c + n);
}

/**
 * The yield for this input, counting it as seen. An input with no key pays 1.
 * Several keys at once pay their mean.
 */
function consumeNovelty(state: SkillsState, def: SkillDef, key: string | string[] | undefined): number {
  if (!def.novelty) return 1;
  if (!key) return 1;
  const counts = (state.novelty[def.id] ??= {});
  const keys = typeof key === 'string' ? [key] : key;
  if (keys.length === 0) return 1;
  let total = 0;
  for (const k of keys) {
    const seen = counts[k] ?? 0;
    counts[k] = seen + 1;
    total += noveltyYield(def.novelty, seen);
  }
  return total / keys.length;
}

/** How novel `key` still is to a skill, without consuming it. */
export function noveltyRemaining(state: DeepReadonly<SkillsState>, skillId: string, key: string): number {
  const spec = SKILLS[skillId]?.novelty;
  if (!spec) return 1;
  return noveltyYield(spec, state.novelty[skillId]?.[key] ?? 0);
}

// ---- conditions ----

type ReadCtx = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

/**
 * The condition reader of the player: skills from this slice, attributes and
 * wielded tags from the stat block, counters from the counters slice. Quests
 * and boons are read as the named facts `quest:<id>` and `boon:<id>`; the
 * systems that own them state those facts from a modifier source.
 */
export function conditionReader(ctx: ReadCtx): ConditionReader {
  const state = ctx.read(system);
  const counts = ctx.read(counters);
  return {
    skillLevel: (id) => skillLevel(state, id),
    attr: (id) => attrValue(ctx, id as AttributeId),
    counter: (key) => counterValue(counts, key),
    hasTag: (tag) => hasWieldTag(ctx, tag),
    questDone: (id) => factValue(ctx, `quest:${id}`) > 0,
    boonRank: (id) => factValue(ctx, `boon:${id}`),
  };
}

// ---- caps ----

/**
 * The level a skill may reach: its `maxLevel`, plus the raises this run
 * earned, plus the raises the legacy holds (the named fact `skillCap:<id>`).
 * Infinity for a skill with no `maxLevel`.
 */
export function skillCap(ctx: ReadCtx, id: string): number {
  const def = SKILLS[id];
  if (!def?.maxLevel) return Infinity;
  return def.maxLevel + (ctx.read(system).skills[id]?.capRaised ?? 0) + factValue(ctx, `skillCap:${id}`);
}

// ---- the tree ----

/** How close every threshold of a locked skill must be before it is shown at all. */
export const REVEAL_FRACTION = 0.9;

/** Whether the Foresight boon is held: the named fact `foresight`. */
function hasForesight(ctx: ReadCtx): boolean {
  return factValue(ctx, 'foresight') > 0;
}

/** Whether a locked skill may be shown: parent known, and close enough or Foresight. */
export function skillRevealed(ctx: ReadCtx, def: SkillDef): boolean {
  const state = ctx.read(system);
  if (!def.parent || !isUnlocked(state, def.parent)) return false;
  return hasForesight(ctx) || conditionsProgress(conditionReader(ctx), def.unlock) >= REVEAL_FRACTION;
}

/** Ids of the locked skills worth hinting at. */
export function hintedSkills(ctx: ReadCtx): string[] {
  const state = ctx.read(system);
  return SKILL_LIST.filter((def) => !isUnlocked(state, def.id) && skillRevealed(ctx, def)).map((d) => d.id);
}

export interface SkillTreeNode {
  def: SkillDef;
  state: 'unlocked' | 'hinted';
  children: SkillTreeNode[];
}

function heldWithin(node: SkillTreeNode): boolean {
  return node.state === 'unlocked' || node.children.some(heldWithin);
}

function buildNode(ctx: ReadCtx, def: SkillDef): SkillTreeNode | null {
  const state = ctx.read(system);
  const childrenOf = () =>
    SKILL_LIST.filter((d) => d.parent === def.id)
      .map((d) => buildNode(ctx, d))
      .filter((n): n is SkillTreeNode => n !== null);
  if (isUnlocked(state, def.id)) return { def, state: 'unlocked', children: childrenOf() };
  // A held skill is always shown. A skill can be held under a locked one: the
  // locked one then shows as hinted with the held branch beneath it.
  const held = childrenOf().filter(heldWithin);
  if (held.length > 0) return { def, state: 'hinted', children: held };
  // Otherwise a locked skill is hinted only when revealed; its own subtree stays hidden.
  if (skillRevealed(ctx, def)) return { def, state: 'hinted', children: [] };
  return null;
}

/**
 * The skill forest, grouped by category in display order. An undiscovered
 * root is absent unless a skill under it is held; empty categories are left
 * out.
 */
export function skillTreeByCategory(ctx: ReadCtx): { category: SkillCategoryDef; nodes: SkillTreeNode[] }[] {
  return SKILL_CATEGORIES.map((category) => ({
    category,
    nodes: SKILL_LIST.filter((d) => !d.parent && d.category === category.id)
      .map((d) => buildNode(ctx, d))
      .filter((n): n is SkillTreeNode => n !== null),
  })).filter((section) => section.nodes.length > 0);
}

// ---- events ----

/**
 * Request: grant XP to every held skill the action trains, and bank it for
 * every locked one that manifests by XP. `sourceKey` names the input behind
 * the payout (a monster id, a book id), for skills that learn from novelty.
 * `scale` multiplies every grant (default 1).
 */
export const grantSkillXp = defineEvent<{
  tags: string[];
  amount: number;
  sourceKey?: string | string[];
  scale?: number;
}>('skills/grant-xp');
/** Request: grant XP to one skill (quest rewards). A locked skill that manifests by XP banks it. */
export const grantSkillXpDirect = defineEvent<{ skillId: string; amount: number; scale?: number }>(
  'skills/grant-xp-direct',
);
/** Request: bonus XP for every skill that learns from `domain`, when that domain records something new. */
export const grantDiscoveryXp = defineEvent<{ domain: NoveltyDomain; weight?: number; scale?: number }>(
  'skills/grant-discovery-xp',
);
/** Request: manifest every locked skill the action trains whose unlock conditions hold. */
export const checkDiscovery = defineEvent<{ tags: string[] }>('skills/check-discovery');
/** Request: raise a capped, held skill's ceiling. */
export const raiseSkillCap = defineEvent<{ id: string; by?: number }>('skills/raise-cap');
/**
 * Request: enter a skill at level 1, xp 0, with no condition checked (a school
 * lesson, old `teachSchool`). Answers false when the skill is unknown or held.
 */
export const enterSkill = defineRequest<{ id: string }, boolean>('skills/enter');

/** A skill manifested. */
export const skillUnlocked = defineEvent<{ id: string }>('skills/unlock');
/** A skill's level rose to `level`. One event per level. */
export const skillLevelUp = defineEvent<{ id: string; level: number }>('skills/levelup');

// ---- modifier source ----

const EFFECTS_SOURCE = 'skills/effects';
const SKILL: ModOrigin = { kind: 'skill' };

function effectMods(state: DeepReadonly<SkillsState>): StatMod[] {
  const out: StatMod[] = [];
  for (const [id, held] of Object.entries(state.skills)) {
    const def = SKILLS[id];
    if (!def) continue;
    const label = `${def.name} Lv ${held.level}`;
    // Talent (a prestige boon) scales a skill's effects. The legacy states it
    // as the scale fact `talent:<id>`; the pipeline applies it.
    for (const m of def.effects ?? [])
      out.push({ ...contentMod(m, label, SKILL, held.level), scaleBy: `talent:${id}` });
    // Milestones are not scaled and are cumulative; the list is sorted, so
    // the first level not reached ends the run.
    for (const milestone of def.milestones ?? []) {
      if (held.level < milestone.level) break;
      for (const m of milestone.bonus) out.push(contentMod(m, `${def.name} milestones`, SKILL));
    }
  }
  return out;
}

// ---- grants ----

type SkillsCtx = Ctx<SkillsState>;

function announceLevels(ctx: SkillsCtx, id: string, gained: number): void {
  if (gained <= 0) return;
  ctx.touch(EFFECTS_SOURCE);
  const level = ctx.state.skills[id].level;
  for (let i = gained; i > 0; i--) {
    ctx.emit(skillLevelUp, { id, level: level - i + 1 });
    ctx.emit(bumpCounter, { key: 'skill:levels' });
  }
}

/**
 * Enter a skill at level 1. XP banked while it was locked pays for that first
 * level; anything past the level's cost carries into it.
 */
function manifest(ctx: SkillsCtx, def: SkillDef): void {
  const state = ctx.state;
  const banked = state.latent[def.id] ?? 0;
  if (def.id in state.latent) delete state.latent[def.id];
  state.skills[def.id] = { level: 1, xp: Math.max(0, banked - skillXpNeeded(def.id, 1)) };
  ctx.touch(EFFECTS_SOURCE);
  ctx.emit(skillUnlocked, { id: def.id });
  ctx.emit(logLine, { msg: fillText(TEXT.manifested, { icon: def.icon, name: def.name }), kind: 'skill' });
  announceLevels(ctx, def.id, settleLevels(state.skills[def.id], skillProgression(def.id)));
}

function bankLatentXp(ctx: SkillsCtx, def: SkillDef, amount: number): void {
  const state = ctx.state;
  state.latent[def.id] = latentXp(state, def.id) + amount;
  if (state.latent[def.id] >= skillXpNeeded(def.id, 1)) manifest(ctx, def);
}

function addSkillXp(ctx: SkillsCtx, id: string, amount: number): void {
  const held = ctx.state.skills[id];
  if (!held) return;
  const cap = skillCap(ctx, id);
  // At the ceiling XP is discarded, not banked.
  if (held.level >= cap) {
    held.xp = 0;
    return;
  }
  held.xp += amount;
  let gained = settleLevels(held, skillProgression(id));
  if (held.level >= cap) {
    gained -= held.level - cap;
    held.level = cap;
    held.xp = 0;
  }
  announceLevels(ctx, id, gained);
}

// ---- view ----

export interface SkillNodeView {
  id: string;
  name: string;
  icon: string;
  state: 'unlocked' | 'hinted';
  level: number;
  xp: number;
  xpNeeded: number;
  /** null when the skill has no cap. */
  cap: number | null;
  tier: string | null;
  children: SkillNodeView[];
}

export interface SkillsView {
  categories: { id: string; name: string; icon: string; nodes: SkillNodeView[] }[];
  /** Number of held skills. */
  held: number;
}

function nodeView(ctx: ReadCtx, node: SkillTreeNode): SkillNodeView {
  const held = ctx.read(system).skills[node.def.id];
  const level = held?.level ?? 0;
  const cap = skillCap(ctx, node.def.id);
  return {
    id: node.def.id,
    name: node.def.name,
    icon: node.def.icon,
    state: node.state,
    level,
    xp: held?.xp ?? 0,
    xpNeeded: skillXpNeeded(node.def.id, Math.max(1, level)),
    cap: Number.isFinite(cap) ? cap : null,
    tier: held ? skillTierName(node.def.id, level) : null,
    children: node.children.map((child) => nodeView(ctx, child)),
  };
}

// ---- the declaration ----

const system: SystemDef<SkillsState, SkillsView> = defineSystem<SkillsState, SkillsView>({
  id: 'skills',
  version: 1,
  migrations,
  initial: () => ({ skills: {}, latent: {}, novelty: {} }),
  content: { skills, skill_categories: skillCategories, skills_text: skillsText },

  modifiers: [
    {
      id: EFFECTS_SOURCE,
      collect: ({ state, entity }) => (entity === PLAYER ? effectMods(state) : []),
    },
  ],

  requests: [
    answer(enterSkill, (ctx, { id }) => {
      if (!SKILLS[id] || ctx.state.skills[id]) return false;
      ctx.state.skills[id] = { level: 1, xp: 0 };
      ctx.touch(EFFECTS_SOURCE);
      ctx.emit(skillUnlocked, { id });
      return true;
    }),
  ],

  events: [
    on(checkDiscovery, (ctx, event) => {
      const { tags } = event.payload;
      for (const def of skillsTrainedBy(tags)) {
        if (isUnlocked(ctx.state, def.id)) continue;
        if (!conditionsMet(conditionReader(ctx), def.unlock)) continue;
        manifest(ctx, def);
      }
    }),

    on(grantSkillXp, (ctx, event) => {
      const { tags, amount, sourceKey, scale = 1 } = event.payload;
      if (amount <= 0) return ctx.skip('skills/grant-xp', `amount ${amount} is not above 0`);
      const mult = statOf(ctx, 'skillXp');
      // The ids `skillTrainedBy` answers true for, kept per tag list.
      const trained = trainedBy(tags).ids;
      for (const id of Object.keys(ctx.state.skills)) {
        const def = SKILLS[id];
        if (!def || !trained.has(id)) continue;
        addSkillXp(ctx, id, amount * mult * consumeNovelty(ctx.state, def, sourceKey) * scale);
      }
      // After the held skills, so one that manifests here is not paid twice.
      for (const def of skillsTrainedBy(tags)) {
        if (isUnlocked(ctx.state, def.id) || !manifestsByXp(def)) continue;
        bankLatentXp(ctx, def, amount * mult * consumeNovelty(ctx.state, def, sourceKey));
      }
    }),

    on(grantSkillXpDirect, (ctx, event) => {
      const { skillId, amount, scale = 1 } = event.payload;
      if (amount <= 0) return ctx.skip('skills/grant-xp-direct', `amount ${amount} is not above 0`);
      const def = SKILLS[skillId];
      const mult = statOf(ctx, 'skillXp');
      if (def && !ctx.state.skills[skillId] && manifestsByXp(def)) {
        bankLatentXp(ctx, def, amount * mult);
        return;
      }
      if (!ctx.state.skills[skillId])
        return ctx.skip('skills/grant-xp-direct', `skill "${skillId}" is locked and does not manifest by XP`);
      addSkillXp(ctx, skillId, amount * mult * scale);
    }),

    on(grantDiscoveryXp, (ctx, event) => {
      const { domain, weight = 1, scale = 1 } = event.payload;
      const mult = statOf(ctx, 'skillXp');
      for (const id of Object.keys(ctx.state.skills)) {
        const spec = SKILLS[id]?.novelty;
        if (spec?.domain !== domain) continue;
        addSkillXp(ctx, id, spec.discovery * weight * mult * scale);
      }
      for (const def of SKILL_LIST) {
        if (def.novelty?.domain !== domain || isUnlocked(ctx.state, def.id) || !manifestsByXp(def)) continue;
        bankLatentXp(ctx, def, def.novelty.discovery * weight * mult);
      }
    }),

    on(raiseSkillCap, (ctx, event) => {
      const { id, by = 1 } = event.payload;
      const def = SKILLS[id];
      const held = ctx.state.skills[id];
      if (!def?.maxLevel) return ctx.skip('skills/raise-cap', `skill "${id}" has no cap`);
      if (!held) return ctx.skip('skills/raise-cap', `skill "${id}" is not held`);
      if (by <= 0) return ctx.skip('skills/raise-cap', `raise ${by} is not above 0`);
      held.capRaised = (held.capRaised ?? 0) + by;
      ctx.emit(logLine, {
        msg: fillText(TEXT.cap_raised, { icon: def.icon, name: def.name, cap: skillCap(ctx, id) }),
        kind: 'skill',
      });
    }),
  ],

  view: (ctx) => ({
    categories: skillTreeByCategory(ctx).map(({ category, nodes }) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      nodes: nodes.map((node) => nodeView(ctx, node)),
    })),
    held: Object.keys(ctx.state.skills).length,
  }),
});

export default system;
