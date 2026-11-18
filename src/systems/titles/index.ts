/**
 * Titles: earned once by unlock conditions, passive modifiers from every
 * earned title, more from the one worn. Port of old `systems/titles.ts`,
 * `data/titles.data.ts` and its text, the title half of `collectBaseMods`
 * (old `systems/attributes.ts`), the title half of the player's immunity
 * (old `systems/statuses.ts`) and `dogmaDefied` (old `systems/spellcraft.ts`).
 * See README.md in this folder.
 */
import {
  defineCommand,
  defineEvent,
  defineSystem,
  handle,
  OK,
  on,
  PLAYER,
  registry,
  s,
  skipped,
  type DeepReadonly,
  type RecordOf,
} from '../../kernel';
import { attrLevelUp } from '../attributes';
import { enemyKilled } from '../combat';
import { conditionSchema, conditionsMet, type Condition } from '../counters';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { questCompleted } from '../quests';
import { conditionReader, skillLevelUp } from '../skills';
import { contentMod, modifierSchema, namedFact, type ModOrigin, type StatMod } from '../stats';
import { arrived } from '../world';
import textData from './content/titles_text.json';
import titlesData from './content/titles.json';
import { migrations } from './migrations';

const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));
const titlesText = registry(textSchema, textData, 'Titles text');

export const titles = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    desc: s.string(),
    unlock: s.array(conditionSchema, { help: 'All must hold. Checked on the events listed in README.md; the title latches.' }),
    passive: s.optional(s.array(modifierSchema, { help: 'Applies from the moment it is earned.' })),
    equipped: s.optional(s.array(modifierSchema, { help: 'Applies while worn.' })),
    immune: s.optional(
      s.object({
        ids: s.optional(s.array(s.ref('statuses'), { help: 'Conditions that no longer land on the holder.' })),
        elements: s.optional(s.array(s.string(), { help: 'Damage types whose conditions no longer land.' })),
      }),
    ),
    secret: s.optional(s.boolean({ help: 'Hidden from the list until earned.' })),
    defiesDogma: s.optional(s.boolean({ help: 'While worn, miracles of hostile deities may be prepared together.' })),
  }),
  titlesData,
  'Titles',
);

export type TitleDef = RecordOf<typeof titles>;

export const TITLE_LIST: readonly TitleDef[] = titlesData as TitleDef[];
export const TITLES: Record<string, TitleDef> = Object.fromEntries(TITLE_LIST.map((t) => [t.id, t]));

export interface TitlesState {
  /** Earned titles, in the order earned. */
  earned: string[];
  /** The worn title, or null. */
  worn: string | null;
}

/** The fact a worn dogma-defying title states. `spellcraft` reads it at preparation. */
export const DEFIES_DOGMA_FACT = 'defiesDogma';

const HELD_SOURCE = 'titles/held';
const TITLE: ModOrigin = { kind: 'title' };

export function hasTitle(state: DeepReadonly<TitlesState>, id: string): boolean {
  return state.earned.includes(id);
}

export function equippedTitle(state: DeepReadonly<TitlesState>): TitleDef | null {
  return state.worn ? (TITLES[state.worn] ?? null) : null;
}

/** The modifiers the titles give the player. */
export function titleMods(state: DeepReadonly<TitlesState>): StatMod[] {
  const mods: StatMod[] = [];
  for (const id of state.earned) {
    const def = TITLES[id];
    if (!def) continue;
    for (const m of def.passive ?? []) mods.push(contentMod(m, `Title: ${def.name}`, TITLE));
  }
  const worn = equippedTitle(state);
  if (worn) {
    for (const m of worn.equipped ?? []) mods.push(contentMod(m, `Title: ${worn.name} (worn)`, TITLE));
    if (worn.defiesDogma) mods.push(namedFact(DEFIES_DOGMA_FACT, 1));
  }
  // An earned title refuses a condition as the condition's own immunity does.
  for (const id of state.earned) {
    const immune = TITLES[id]?.immune;
    for (const status of immune?.ids ?? []) mods.push(namedFact(`statusImmune:${status}`, 1));
    for (const element of immune?.elements ?? []) mods.push(namedFact(`statusImmuneElement:${element}`, 1));
  }
  return mods;
}

// ---- events and commands ----

/**
 * Run the unlock check. Emitted by this system after each event that can
 * complete a condition, so it runs after the counter bumps that event's
 * handler queued. Later ports (achievements, crafting, consumables, the
 * festival) emit it where the old code called `checkTitleUnlocks`.
 */
export const checkTitles = defineEvent<void>('titles/check');
/** A title was earned. The old `title:unlock`. */
export const titleEarned = defineEvent<{ title: string }>('titles/earned');

/** Wear an earned title, or none (null). The old `setTitle`. */
export const wearTitle = defineCommand<{ title: string | null }>('titles/wear');

export interface TitleRow {
  id: string;
  name: string;
  icon: string;
  desc: string;
  earned: boolean;
  worn: boolean;
}

export interface TitlesView {
  worn: string | null;
  /** Earned titles first, then the unearned that are not secret. */
  rows: TitleRow[];
}

const system = defineSystem<TitlesState, TitlesView>({
  id: 'titles',
  version: 1,
  migrations,
  initial: () => ({ earned: [], worn: null }),
  content: { titles, titles_text: titlesText },

  modifiers: [
    {
      id: HELD_SOURCE,
      collect: ({ state, entity }) => (entity === PLAYER ? titleMods(state) : []),
    },
  ],

  commands: [
    handle(wearTitle, (ctx, { title }) => {
      if (title !== null) {
        if (!TITLES[title]) return skipped(`No such title: ${title}`);
        if (!hasTitle(ctx.state, title)) return skipped(`${TITLES[title].name} is not earned`);
      }
      if (ctx.state.worn === title) return skipped(title ? `${TITLES[title].name} is already worn` : 'No title is worn');
      ctx.state.worn = title;
      ctx.touch(HELD_SOURCE);
      if (title) ctx.emit(logLine, { msg: fillText(TEXT.worn, { name: TITLES[title].name }), kind: 'achievement' });
      return OK;
    }),
  ],

  events: [
    on(attrLevelUp, (ctx) => ctx.emit(checkTitles, undefined)),
    on(skillLevelUp, (ctx) => ctx.emit(checkTitles, undefined)),
    on(enemyKilled, (ctx) => ctx.emit(checkTitles, undefined)),
    on(questCompleted, (ctx) => ctx.emit(checkTitles, undefined)),
    on(arrived, (ctx) => ctx.emit(checkTitles, undefined)),
    // Titles latch: a restraint (`statMax`) broken later never revokes one.
    // The old `checkTitleUnlocks`.
    on(checkTitles, (ctx) => {
      let reader: ReturnType<typeof conditionReader> | null = null;
      for (const def of TITLE_LIST) {
        if (hasTitle(ctx.state, def.id)) continue;
        reader ??= conditionReader(ctx);
        if (!conditionsMet(reader, def.unlock as Condition[])) continue;
        ctx.state.earned.push(def.id);
        ctx.touch(HELD_SOURCE);
        ctx.emit(titleEarned, { title: def.id });
        ctx.emit(logLine, { msg: fillText(TEXT.earned, { icon: def.icon, name: def.name }), kind: 'achievement' });
      }
    }),
  ],

  view: (ctx): TitlesView => {
    const state = ctx.state;
    const rows = TITLE_LIST.filter((t) => hasTitle(state, t.id) || !t.secret)
      .map((t) => ({
        id: t.id,
        name: t.name,
        icon: t.icon,
        desc: t.desc,
        earned: hasTitle(state, t.id),
        worn: state.worn === t.id,
      }))
      .sort((a, b) => Number(b.earned) - Number(a.earned));
    return { worn: state.worn, rows };
  },
});

export default system;
