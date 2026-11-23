/**
 * Super-attribute fusion: two attributes fuse into one once its unlock
 * conditions hold, and each then reads as the sum of both. Port of the old
 * `systems/superattrs.ts`, `data/superattrs.data.ts`, `text/superattrs.text.ts`
 * and the `state.fused` read of old `systems/attributes.ts` (`isFused`,
 * `superFor`). The sum itself is the `stats` pipeline's (`fuseFact`). See
 * README.md in this folder.
 */
import { defineEvent, defineSystem, on, PLAYER, registry, s, type Ctx, type DeepReadonly, type RecordOf } from '../../kernel';
import { ATTRIBUTE_LIST, attrLevelUp } from '../attributes';
import { enemyKilled } from '../combat';
import { conditionSchema, conditionsMet, raiseCounter, type Condition } from '../counters';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { conditionReader, skillLevelUp, skillUnlocked } from '../skills';
import { attrValue, effectiveAttr, formulaAttr, fuseFact, type AttributeId, type StatMod } from '../stats';
import { checkTitles } from '../titles';
import superattrsData from './content/superattrs.json';
import textData from './content/superattrs_text.json';
import { migrations } from './migrations';

const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const superattrsText = registry(textSchema, textData, 'Super-attributes text');

export const superattrs = registry(
  s.object({
    id: s.id(),
    art: s.optional(s.string({ help: 'Art key.' })),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    components: s.array(s.ref('attributes'), {
      help: 'The two attributes fused. Once fused, each reads as the sum of both effective values.',
    }),
    unlock: s.array(conditionSchema, {
      help: 'All must hold. Checked on the events listed in README.md; a fusion holds until the run ends.',
    }),
    desc: s.string(),
  }),
  superattrsData,
  'Super-attributes',
);

export type SuperAttributeDef = RecordOf<typeof superattrs>;

export const SUPERATTR_LIST: readonly SuperAttributeDef[] = superattrsData as SuperAttributeDef[];
export const SUPERATTRS: Record<string, SuperAttributeDef> = Object.fromEntries(SUPERATTR_LIST.map((d) => [d.id, d]));

const ATTR_NAME = Object.fromEntries(ATTRIBUTE_LIST.map((a) => [a.id, a.name])) as Record<AttributeId, string>;
const ATTR_ICON = Object.fromEntries(ATTRIBUTE_LIST.map((a) => [a.id, a.icon])) as Record<AttributeId, string>;

export interface SuperattrsState {
  /** Fused super-attributes, in the order fused. The old `state.fused`. */
  fused: string[];
}

type S = Ctx<SuperattrsState>;

const HELD_SOURCE = 'superattrs/held';

/** The two components of a super-attribute. */
export function componentsOf(def: SuperAttributeDef): [AttributeId, AttributeId] {
  return [def.components[0] as AttributeId, def.components[1] as AttributeId];
}

/** The super-attribute an attribute is a component of. The old `superFor`. */
export function superFor(attr: AttributeId): SuperAttributeDef | undefined {
  return SUPERATTR_LIST.find((d) => d.components.includes(attr));
}

/** The old `isFused`. */
export function isFused(state: DeepReadonly<SuperattrsState>, id: string): boolean {
  return state.fused.includes(id);
}

/** The facts the fused super-attributes state for the player. */
export function fusedMods(state: DeepReadonly<SuperattrsState>): StatMod[] {
  const mods: StatMod[] = [];
  for (const id of state.fused) {
    const def = SUPERATTRS[id];
    if (def) mods.push(fuseFact(...componentsOf(def)));
  }
  return mods;
}

// ---- events ----

/**
 * Run the fusion check. Emitted by this system after each event that can
 * complete a condition, so it runs after the counter bumps that event's
 * handler queued (combat bumps `kills` after it emits the kill).
 */
export const checkFusion = defineEvent<void>('superattrs/check');
/** A super-attribute fused. The old `superattr:unlock`. */
export const fusionUnlocked = defineEvent<{ id: string }>('superattrs/unlocked');

/** Ask for the check, unless every super-attribute is already fused. */
function askCheck(ctx: S): void {
  if (ctx.state.fused.length < SUPERATTR_LIST.length) ctx.emit(checkFusion, undefined);
}

/**
 * The old `checkSuperUnlocks`: fuse every super-attribute whose conditions
 * now hold. Conditions on an attribute read its value with fusion (`attrValue`).
 */
function checkSuperUnlocks(ctx: S): void {
  let reader: ReturnType<typeof conditionReader> | null = null;
  for (const def of SUPERATTR_LIST) {
    if (isFused(ctx.state, def.id)) continue;
    reader ??= conditionReader(ctx);
    if (!conditionsMet(reader, def.unlock as Condition[])) continue;

    ctx.state.fused.push(def.id);
    ctx.touch(HELD_SOURCE);
    ctx.emit(fusionUnlocked, { id: def.id });
    // The old titles listener on `superattr:unlock`.
    ctx.emit(checkTitles, undefined);
    const [a, b] = componentsOf(def);
    ctx.emit(logLine, {
      msg: fillText(TEXT.fusion, { icon: def.icon, a: ATTR_NAME[a], b: ATTR_NAME[b], name: def.name.toUpperCase(), value: attrValue(ctx, a) }),
      kind: 'fusion',
    });
    // Attribute-threshold achievements see the fused value at once.
    ctx.emit(raiseCounter, { key: `attr:${a}`, value: attrValue(ctx, a) });
    ctx.emit(raiseCounter, { key: `attr:${b}`, value: attrValue(ctx, b) });
  }
}

// ---- view ----

export interface FusedComponentView {
  id: AttributeId;
  name: string;
  icon: string;
  /** The component's own effective value, before fusion. */
  effective: number;
}

export interface FusedView {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** The fused value: both components' effective values summed. */
  value: number;
  /** The value the stat formulas read: the fused value held to the attribute ceiling. */
  formula: number;
  components: FusedComponentView[];
}

export interface SuperattrsView {
  /** Fused super-attributes, in registry order. */
  fused: FusedView[];
}

const system = defineSystem<SuperattrsState, SuperattrsView>({
  id: 'superattrs',
  version: 1,
  migrations,
  initial: () => ({ fused: [] }),
  content: { superattrs, superattrs_text: superattrsText },

  modifiers: [
    {
      id: HELD_SOURCE,
      collect: ({ state, entity }) => (entity === PLAYER ? fusedMods(state) : []),
    },
  ],

  // The old listeners (`registerSuperAttrListeners`). No check on a tick, on
  // gold earned or on load: the old build had none.
  events: [
    on(attrLevelUp, askCheck),
    on(skillLevelUp, askCheck),
    on(skillUnlocked, askCheck),
    on(enemyKilled, askCheck),
    on(checkFusion, checkSuperUnlocks),
  ],

  view: (ctx): SuperattrsView => ({
    fused: SUPERATTR_LIST.filter((def) => isFused(ctx.state, def.id)).map((def) => {
      const [a] = componentsOf(def);
      return {
        id: def.id,
        name: def.name,
        icon: def.icon,
        desc: def.desc,
        value: attrValue(ctx, a),
        formula: formulaAttr(ctx, a),
        components: componentsOf(def).map((id) => ({ id, name: ATTR_NAME[id], icon: ATTR_ICON[id], effective: effectiveAttr(ctx, id) })),
      };
    }),
  }),
});

export default system;
