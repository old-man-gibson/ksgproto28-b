/**
 * The six attributes: trained level and XP, training ranks and milestones.
 * Port of the training half of the old `systems/attributes.ts` and of
 * `data/attributes.data.ts`. The effective-attribute layer is in the stats
 * system. See README.md in this folder.
 */
import { defineEvent, defineSystem, on, PLAYER, registry, s, type DeepReadonly, type RecordOf } from '../../kernel';
import { raiseCounter } from '../counters';
import { ATTRIBUTE_PROGRESSION, bandedXpNeeded, settleLevels } from '../progression';
import {
  ATTRIBUTE_IDS,
  attrValue,
  baseAttrFact,
  contentMod,
  modifierSchema,
  type AttributeId,
  type ModOrigin,
  type StatMod,
} from '../stats';
import attributeTrainingData from './content/attribute_training.json';
import attributesData from './content/attributes.json';
import { migrations } from './migrations';

// ---- slice ----

export interface AttrState {
  /** Trained level. Bonuses never raise it. */
  level: number;
  xp: number;
}

export interface AttributesState {
  attrs: Record<AttributeId, AttrState>;
}

// ---- content ----

const attributes = registry(
  s.object({
    id: s.enum(ATTRIBUTE_IDS),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Art key.' })),
  }),
  attributesData,
  'Attributes',
);

const milestoneSchema = s.object({
  level: s.number({ min: 1, integer: true }),
  bonus: s.array(modifierSchema),
});

const attributeTraining = registry(
  s.object({
    id: s.ref('attributes'),
    name: s.string({ minLength: 1 }),
    desc: s.string(),
    tierNames: s.array(
      s.object({
        level: s.number({ min: 1, integer: true }),
        name: s.string({ minLength: 1 }),
        bonus: s.optional(s.array(modifierSchema)),
      }),
      { help: 'Ranks, sorted by level. A rank gives its bonus while the trained level is at or above it.' },
    ),
    milestones: s.optional(s.array(milestoneSchema, { help: 'Sorted by level. Cumulative.' })),
  }),
  attributeTrainingData,
  'Attribute training',
);

export type AttributeDef = RecordOf<typeof attributes>;
export type AttributeTrainingDef = RecordOf<typeof attributeTraining>;

export const ATTRIBUTE_LIST = attributesData as AttributeDef[];
export const ATTRIBUTE_TRAINING = Object.fromEntries(
  (attributeTrainingData as AttributeTrainingDef[]).map((def) => [def.id, def]),
) as Record<AttributeId, AttributeTrainingDef>;

/** An attribute's display name. */
export function attrName(id: AttributeId): string {
  return ATTRIBUTE_LIST.find((a) => a.id === id)?.name ?? id;
}

/** XP to take an attribute from `level` to the next. */
export function attrXpNeeded(level: number): number {
  return bandedXpNeeded(ATTRIBUTE_PROGRESSION, level);
}

/** The name of the training rank held at a trained level. */
export function trainingRankName(attr: AttributeId, trained: number): string {
  let name = ATTRIBUTE_TRAINING[attr].name;
  for (const rank of ATTRIBUTE_TRAINING[attr].tierNames) {
    if (trained >= rank.level) name = rank.name;
  }
  return name;
}

// ---- events ----

/** Request: add XP to an attribute's trained level. */
export const grantAttrXp = defineEvent<{ attr: AttributeId; amount: number }>('attributes/grant-xp');
/**
 * Request: spread one payout across attributes, e.g. `{ cha: 0.5, str: 0.25 }`.
 * Weights scale `amount` independently; nothing is normalised.
 */
export const grantAttrXpSplit = defineEvent<{ weights: Partial<Record<AttributeId, number>>; amount: number }>(
  'attributes/grant-xp-split',
);
/** An attribute's trained level rose to `level`. One event per level. */
export const attrLevelUp = defineEvent<{ attr: AttributeId; level: number }>('attributes/levelup');

// ---- modifier sources ----

const TRAINED_SOURCE = 'attributes/trained';
const TRAINING_SOURCE = 'attributes/training';
const TRAINING: ModOrigin = { kind: 'training' };

/**
 * Rank and milestone bonuses, cumulative. Both read the trained level, so a
 * bonus that targets the attribute itself cannot feed its own threshold.
 */
function trainingMods(state: DeepReadonly<AttributesState>): StatMod[] {
  const out: StatMod[] = [];
  for (const a of ATTRIBUTE_LIST) {
    const trained = state.attrs[a.id].level;
    const training = ATTRIBUTE_TRAINING[a.id];
    for (const rank of training.tierNames) {
      if (trained < rank.level) break;
      for (const m of rank.bonus ?? []) out.push(contentMod(m, rank.name, TRAINING));
    }
    for (const milestone of training.milestones ?? []) {
      if (trained < milestone.level) break;
      // One shared label, so a tooltip groups all milestones into one line.
      for (const m of milestone.bonus) out.push(contentMod(m, `${training.name} milestones`, TRAINING));
    }
  }
  return out;
}

// ---- view ----

export interface AttributeView {
  id: AttributeId;
  name: string;
  icon: string;
  /** Trained level. */
  level: number;
  xp: number;
  xpNeeded: number;
  /** The value checks read: trained plus every bonus, fused components summed. */
  value: number;
  rank: string;
}

export interface AttributesView {
  attributes: AttributeView[];
}

function freshAttrs(): Record<AttributeId, AttrState> {
  return {
    str: { level: 1, xp: 0 },
    dex: { level: 1, xp: 0 },
    con: { level: 1, xp: 0 },
    int: { level: 1, xp: 0 },
    wis: { level: 1, xp: 0 },
    cha: { level: 1, xp: 0 },
  };
}

// ---- the declaration ----

const system = defineSystem<AttributesState, AttributesView>({
  id: 'attributes',
  version: 1,
  migrations,
  initial: () => ({ attrs: freshAttrs() }),
  content: { attributes, attribute_training: attributeTraining },

  modifiers: [
    {
      id: TRAINED_SOURCE,
      // The player's trained levels. Another entity's base comes from the system that owns it.
      collect: ({ state, entity }) =>
        entity === PLAYER ? ATTRIBUTE_IDS.map((id) => baseAttrFact(id, state.attrs[id].level)) : [],
    },
    {
      id: TRAINING_SOURCE,
      collect: ({ state, entity }) => (entity === PLAYER ? trainingMods(state) : []),
    },
  ],

  events: [
    on(grantAttrXp, (ctx, event) => {
      const { attr, amount } = event.payload;
      const a = ctx.state.attrs[attr];
      if (!a) return ctx.skip('attributes/grant-xp', `unknown attribute "${attr}"`);
      a.xp += amount;
      const gained = settleLevels(a, ATTRIBUTE_PROGRESSION);
      if (gained === 0) return;
      ctx.touch(TRAINED_SOURCE);
      ctx.touch(TRAINING_SOURCE);
      for (let i = gained; i > 0; i--) ctx.emit(attrLevelUp, { attr, level: a.level - i + 1 });
      // The `attr:<id>` counter holds the highest value reached. It reads the
      // value checks read, so a fused attribute counts as its sum.
      ctx.emit(raiseCounter, { key: `attr:${attr}`, value: attrValue(ctx, attr) });
    }),
    on(grantAttrXpSplit, (ctx, event) => {
      const { weights, amount } = event.payload;
      for (const [attr, weight] of Object.entries(weights) as [AttributeId, number][]) {
        if (weight) ctx.emit(grantAttrXp, { attr, amount: amount * weight });
      }
    }),
  ],

  view: (ctx) => ({
    attributes: ATTRIBUTE_LIST.map((def) => {
      const a = ctx.state.attrs[def.id];
      return {
        id: def.id,
        name: def.name,
        icon: def.icon,
        level: a.level,
        xp: a.xp,
        xpNeeded: attrXpNeeded(a.level),
        value: attrValue(ctx, def.id),
        rank: trainingRankName(def.id, a.level),
      };
    }),
  }),
});

export default system;
