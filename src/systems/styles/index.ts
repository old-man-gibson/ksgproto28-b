/**
 * Stances and schools: the style the player fights in. Port of the old
 * `systems/styles.ts`, `data/styles.data.ts`, the style part of
 * `collectModifiers` (`systems/derived.ts`), and `setStyle` and
 * `checkStyleSwap` of `game.ts`. Step 3, the martial port; design in
 * `src/systems/martial/README.md`.
 *
 * The player picks a stance. A school whose skill is held and whose weapon is
 * worn takes over that stance's slot with no input (`schoolForStance`). The
 * effective style is read live; the tick states it to combat when it changes.
 */
import {
  answer,
  defineCommand,
  defineRequest,
  defineSystem,
  handle,
  OK,
  PLAYER,
  registry,
  s,
  skipped,
  type Ctx,
  type DeepReadonly,
  type SystemDef,
} from '../../kernel';
import combat, { MOMENTUM_SOURCE, playerMomentum, setStyle, type StyleExertion } from '../combat';
import { conditionsMet, conditionSchema, type Condition, type ConditionReader, type ConditionRecord } from '../counters';
import items, { itemDefOf, WORN_SOURCE } from '../items';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import resources, { exerting, LOCKS_SOURCE, type ResourceId } from '../resources';
import skills, { skillLevel } from '../skills';
import { contentMod, modifierSchema, styleFact, type ContentMod, type StatMod } from '../stats';
import statuses, { HELD_SOURCE, heldOf, statusForcedStyle } from '../statuses';
import stylesData from './content/styles.json';
import textData from './content/styles_text.json';
import { migrations } from './migrations';

// ---- content ----

const hitSchema = s.object({
  damage: s.optional(s.number()),
  penetration: s.optional(s.number()),
  splash: s.optional(s.number()),
  extraHits: s.optional(s.number()),
  dodge: s.optional(s.number()),
  armor: s.optional(s.number()),
  parry: s.optional(s.number()),
});

const styles = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    art: s.optional(s.string({ help: 'Icon name. The file is not in the repository.' })),
    desc: s.optional(s.string()),
    mods: s.array(modifierSchema),
    exertion: s.optional(
      s.object({
        on: s.enum(['attack', 'defend']),
        cost: s.number({ help: 'Share of the pool maximum spent per event.' }),
        pool: s.optional(s.enum(['stamina', 'mana'])),
        drain: s.optional(s.boolean()),
        note: s.optional(s.string()),
        hit: s.optional(hitSchema),
        mods: s.optional(s.array(modifierSchema, { help: 'Held while exerting.' })),
        ramp: s.optional(s.object({ stat: s.string(), per: s.number(), cap: s.number() })),
      }),
    ),
    unlock: s.optional(s.array(conditionSchema)),
    replaces: s.optional(s.ref('styles', { help: 'The stance whose slot this school takes.' })),
    skill: s.optional(s.ref('skills', { help: 'The school skill whose level scales `perLevel`.' })),
  }),
  stylesData,
  'Styles',
);

export interface StyleDef {
  id: string;
  name: string;
  icon: string;
  art?: string;
  desc?: string;
  mods: ContentMod[];
  exertion?: StyleExertion & {
    note?: string;
    mods?: ContentMod[];
    ramp?: { stat: string; per: number; cap: number };
  };
  unlock?: ConditionRecord[];
  replaces?: string;
  skill?: string;
}

export const STYLE_LIST: readonly StyleDef[] = stylesData as unknown as StyleDef[];
export const STYLES: Record<string, StyleDef> = Object.fromEntries(STYLE_LIST.map((d) => [d.id, d]));
export const DEFAULT_STYLE = 'balanced';

const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const stylesText = registry(textSchema, textData, 'Styles text');

// ---- the slice ----

export interface StylesState {
  /** The stance picked. Always a stance, never a school. The old `state.style`. */
  style: string;
  /** The style last stated to combat. The old `Game.lastEffectiveStyle`, which was not saved. */
  effective: string;
}

/** The modifier source of the style fought in: its fact, its mods, the exertion mods, the momentum line. */
export const STYLE_SOURCE = 'styles/style';

// ---- reads ----

type Reads = { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

/** Tags of everything worn, with `unarmed` for an empty weapon hand. The old `equippedTags`. */
function wornTags(r: Reads): Set<string> {
  const worn = r.read(items).equipment;
  const tags = new Set<string>();
  for (const item of Object.values(worn)) {
    if (!item) continue;
    for (const t of itemDefOf(item)?.tags ?? []) tags.add(t);
  }
  if (!worn.weapon) tags.add('unarmed');
  return tags;
}

/**
 * A condition reader from slices, for the style gates (skill and weapon tag).
 * A source may not read derived values, so the tags come from the worn items
 * as the old `equippedTags` read them.
 */
function sliceReader(r: Reads): ConditionReader {
  const held = r.read(skills);
  let tags: Set<string> | undefined;
  return {
    skillLevel: (id) => skillLevel(held, id),
    attr: () => 0,
    counter: () => 0,
    hasTag: (tag) => (tags ??= wornTags(r)).has(tag),
    questDone: () => false,
    boonRank: () => 0,
  };
}

/** Whether a style's gate holds. The old `styleUnlocked`. */
export function styleUnlocked(r: Reads, def: StyleDef): boolean {
  return !def.unlock || conditionsMet(sliceReader(r), def.unlock as Condition[]);
}

/** The stances, in registry order: the fixed slots. The old `stances`. */
export function stances(): StyleDef[] {
  return STYLE_LIST.filter((d) => !d.replaces);
}

/** The stance a style id belongs to. A school gives the stance it replaces; an unknown id gives `balanced`. The old `stanceIdFor`. */
export function stanceIdFor(id: string): string {
  const def = STYLES[id];
  if (!def) return DEFAULT_STYLE;
  return def.replaces ?? def.id;
}

/** Number of unlock conditions, then the school's level. The old `claimScore`. */
function claimScore(r: Reads, def: StyleDef): number {
  const level = def.skill ? skillLevel(r.read(skills), def.skill) : 0;
  return (def.unlock?.length ?? 0) * 1e6 + level;
}

/** The school filling a stance's slot now, or undefined. Ties go to the lower id. The old `schoolForStance`. */
export function schoolForStance(r: Reads, stanceId: string): StyleDef | undefined {
  let best: StyleDef | undefined;
  let bestScore = -1;
  for (const def of STYLE_LIST) {
    if (def.replaces !== stanceId || !styleUnlocked(r, def)) continue;
    const score = claimScore(r, def);
    if (score > bestScore || (score === bestScore && best && def.id < best.id)) {
      best = def;
      bestScore = score;
    }
  }
  return best;
}

/** The style that applies: a forced style of a held condition, else the stance, then its school. The old `effectiveStyleId`. */
export function effectiveStyleId(r: Reads): string {
  const forced = statusForcedStyle(heldOf(r.read(statuses)));
  const stance = stanceIdFor(forced ?? r.read(system).style);
  return schoolForStance(r, stance)?.id ?? stance;
}

export function effectiveStyleDef(r: Reads): StyleDef {
  return STYLES[effectiveStyleId(r)];
}

/** One slot of the roster: the stance and what fights in it now. The old `StyleSlot`. */
export interface StyleSlot {
  stance: StyleDef;
  active: StyleDef;
}

/** The roster: one entry per stance, always in the same order. The old `styleSlots`. */
export function styleSlots(r: Reads): StyleSlot[] {
  return stances().map((stance) => ({ stance, active: schoolForStance(r, stance.id) ?? stance }));
}

/** What combat holds: the id and the exertion, without the content-only fields. */
function stated(def: StyleDef): { id: string; exertion?: StyleExertion } {
  if (!def.exertion) return { id: def.id };
  const { note: _note, mods: _mods, ...exertion } = def.exertion;
  return { id: def.id, exertion: exertion as StyleExertion };
}

/** The modifiers of the style fought in. The style half of the old `collectModifiers`. */
function styleMods(r: Reads): StatMod[] {
  const style = effectiveStyleDef(r);
  const level = style.skill ? skillLevel(r.read(skills), style.skill) : 0;
  const out: StatMod[] = [styleFact(style.id)];
  for (const m of style.mods) out.push(contentMod(m, `Stance: ${style.name}`, { kind: 'style' }, level));
  const exertion = style.exertion;
  if (exertion?.mods && exerting(r.read(resources), (exertion.pool ?? 'stamina') as ResourceId)) {
    for (const m of exertion.mods) out.push(contentMod(m, `${style.name}: exertion`, { kind: 'style' }, level));
  }
  const momentum = playerMomentum(r.read(combat));
  if (exertion?.ramp && momentum) {
    out.push(
      contentMod(
        { stat: exertion.ramp.stat, op: 'mult', value: Math.min(exertion.ramp.cap, momentum) },
        `${style.name}: momentum`,
        { kind: 'style' },
      ),
    );
  }
  return out;
}

// ---- commands ----

/** Pick a stance. A school id folds to the stance it replaces. The old `setStyle`. */
export const pickStyle = defineCommand<{ style: string }>('styles/set');
/** Request: pick a stance now (the floor 0 card). Answers the reason it was not set, or null. */
export const pickStyleNow = defineRequest<{ style: string }, string | null>('styles/set-now');

type SCtx = Ctx<StylesState>;

/** Set the stance; a string is why not. */
function setStance(ctx: SCtx, styleId: string): string | null {
  const stanceId = stanceIdFor(styleId);
  const def = STYLES[stanceId];
  if (!def) return `no style has the id "${styleId}"`;
  if (ctx.state.style === stanceId) return `the stance is already ${def.name}`;
  if (!styleUnlocked(ctx, def)) return `${def.name} is locked`;
  ctx.state.style = stanceId;
  ctx.touch(STYLE_SOURCE);
  syncEffective(ctx, false);
  ctx.emit(logLine, { msg: fillText(TEXT.style_changed, { name: STYLES[ctx.state.effective].name }), kind: 'combat' });
  return null;
}

/**
 * State the effective style to combat when it changed. With `announce`, log
 * the school taking or releasing the slot (old `checkStyleSwap`).
 */
function syncEffective(ctx: SCtx, announce: boolean): void {
  const id = effectiveStyleId(ctx);
  if (id === ctx.state.effective) return;
  const was = STYLES[ctx.state.effective] ?? STYLES[DEFAULT_STYLE];
  ctx.state.effective = id;
  ctx.touch(STYLE_SOURCE);
  ctx.emit(setStyle, stated(STYLES[id]));
  if (!announce) return;
  const now = STYLES[id];
  const msg = now.replaces
    ? fillText(TEXT.school_engaged, { icon: now.icon, was: was.name, now: now.name })
    : fillText(TEXT.school_released, { was: was.name, now: now.name });
  ctx.emit(logLine, { msg, kind: 'combat' });
}

// ---- the view ----

export interface StylesView {
  stance: string;
  effective: { id: string; name: string; icon: string; note: string; desc: string };
  slots: { stance: string; name: string; icon: string; active: string; activeName: string; activeIcon: string; desc: string; unlocked: boolean }[];
}

// ---- the declaration ----

const system: SystemDef<StylesState, StylesView> = defineSystem<StylesState, StylesView>({
  id: 'styles',
  version: 1,
  migrations,
  initial: () => ({ style: DEFAULT_STYLE, effective: DEFAULT_STYLE }),
  content: { styles, styles_text: stylesText },

  modifiers: [
    {
      id: STYLE_SOURCE,
      // The effective style reads the worn tags, the school levels and the
      // held conditions; the exertion mods read the exerting flag and the
      // pool lock; the momentum line reads the fight.
      dependsOn: [WORN_SOURCE, 'skills/effects', HELD_SOURCE, LOCKS_SOURCE, MOMENTUM_SOURCE],
      collect: (ctx) => (ctx.entity === PLAYER ? styleMods(ctx) : []),
    },
  ],

  // The old game checked the swap once per tick, after the systems ran.
  tick: (ctx) => syncEffective(ctx, true),

  commands: [
    handle(pickStyle, (ctx, { style }) => {
      const why = setStance(ctx, style);
      return why ? skipped(why) : OK;
    }),
  ],

  requests: [
    answer(pickStyleNow, (ctx, { style }) => {
      const why = setStance(ctx, style);
      // Already in it is not a refusal here: the card stamps the step either way.
      return why && !why.startsWith('the stance is already') ? why : null;
    }),
  ],

  view: (ctx) => {
    const eff = effectiveStyleDef(ctx);
    return {
      stance: ctx.state.style,
      effective: { id: eff.id, name: eff.name, icon: eff.icon, note: eff.exertion?.note ?? '', desc: eff.desc ?? '' },
      slots: styleSlots(ctx).map(({ stance, active }) => ({
        stance: stance.id,
        name: stance.name,
        icon: stance.icon,
        active: active.id,
        activeName: active.name,
        activeIcon: active.icon,
        desc: active.desc ?? '',
        unlocked: styleUnlocked(ctx, stance),
      })),
    };
  },
});

export default system;
