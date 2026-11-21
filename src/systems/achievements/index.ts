/**
 * Achievements: tiers claimed when a counter reaches a threshold. Each tier
 * claimed gives its bonus for the rest of the run. Port of the tier half of
 * old `systems/achievements.ts` (`checkAchievements`, `tierNumeral`), of
 * `data/achievements.data.ts`, and of the achievement half of
 * `collectBaseMods` (old `systems/attributes.ts`). The counters are the
 * `counters` system. See README.md in this folder.
 */
import { defineEvent, defineSystem, on, PLAYER, registry, s, type DeepReadonly, type RecordOf } from '../../kernel';
import counters, { counterChanged, counterValue } from '../counters';
import { describeMod, fmt } from '../items';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { MONSTER_TAGS } from '../monsters';
import { contentMod, modifierSchema, type ModOrigin, type StatMod } from '../stats';
import achievementsData from './content/achievements.json';
import textData from './content/achievements_text.json';
import { migrations } from './migrations';

// ---- content ----

const achievements = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    icon: s.string(),
    statKey: s.string({ help: 'The counter the tiers read.' }),
    desc: s.string({ help: 'Goal text; {n} is the next threshold.' }),
    tiers: s.array(
      s.object({
        threshold: s.number({ min: 0 }),
        bonus: s.array(modifierSchema, { help: 'Applies from the moment the tier is claimed.' }),
      }),
    ),
  }),
  achievementsData,
  'Achievements',
);
const achievementsText = registry(textSchema, textData, 'Achievements text');
const TEXT = Object.fromEntries((textData as TextRecord[]).map((r) => [r.id, r.text]));

export type AchievementDef = RecordOf<typeof achievements>;
export const ACHIEVEMENT_LIST: readonly AchievementDef[] = achievementsData as AchievementDef[];
export const ACHIEVEMENTS: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENT_LIST.map((a) => [a.id, a]));

/** Achievements by the counter they read. */
const BY_KEY = new Map<string, AchievementDef[]>();
for (const def of ACHIEVEMENT_LIST) {
  const list = BY_KEY.get(def.statKey);
  if (list) list.push(def);
  else BY_KEY.set(def.statKey, [def]);
}

// ---- slice ----

export interface AchievementsState {
  /** Achievement id to tiers claimed. Absent: none. */
  claimed: Record<string, number>;
}

type State = DeepReadonly<AchievementsState>;

const HELD_SOURCE = 'achievements/held';
const ACHIEVEMENT: ModOrigin = { kind: 'achievement' };

/** "I" to "V"; a higher tier as its number. The old `tierNumeral`. */
export function tierNumeral(tier: number): string {
  return ['I', 'II', 'III', 'IV', 'V'][tier - 1] ?? `${tier}`;
}

export function tiersClaimed(state: State, id: string): number {
  return state.claimed[id] ?? 0;
}

/** Every tier claimed across all achievements. The harvest source `achievements`. */
export function totalTiers(state: State): number {
  return Object.values(state.claimed).reduce((n, t) => n + t, 0);
}

/** The modifiers the claimed tiers give the player. */
export function achievementMods(state: State): StatMod[] {
  const mods: StatMod[] = [];
  for (const [id, claimed] of Object.entries(state.claimed)) {
    const def = ACHIEVEMENTS[id];
    if (!def) continue;
    for (let i = 0; i < claimed && i < def.tiers.length; i++) {
      for (const m of def.tiers[i].bonus) mods.push(contentMod(m, `${def.name} ${tierNumeral(i + 1)}`, ACHIEVEMENT));
    }
  }
  return mods;
}

/** A tier bonus in words, with the target tag by name. */
export function bonusText(mod: AchievementDef['tiers'][number]['bonus'][number]): string {
  if (!mod.requiresMonsterTag) return describeMod(mod);
  const { requiresMonsterTag: tag, ...plain } = mod;
  return `${describeMod(plain)} vs ${MONSTER_TAGS[tag]?.name ?? tag}`;
}

// ---- events ----

/** A tier was claimed. The old `achievement` bus event; `titles` runs its check on it. */
export const tierClaimed = defineEvent<{ achievement: string; tier: number }>('achievements/claimed');

// ---- view ----

export interface AchievementRow {
  id: string;
  name: string;
  icon: string;
  claimed: number;
  tiers: number;
  /** The counter now. */
  value: number;
  /** The next threshold, or null when every tier is claimed. */
  next: number | null;
  /** Goal text for the next tier, or null. */
  goal: string | null;
  /** One line per tier: its threshold and bonus. */
  tierLines: { threshold: number; bonus: string; claimed: boolean }[];
}

export interface AchievementsView {
  claimed: number;
  total: number;
  rows: AchievementRow[];
}

const system = defineSystem<AchievementsState, AchievementsView>({
  id: 'achievements',
  version: 1,
  migrations,
  initial: () => ({ claimed: {} }),
  content: { achievements, achievements_text: achievementsText },

  modifiers: [
    {
      id: HELD_SOURCE,
      collect: ({ state, entity }) => (entity === PLAYER ? achievementMods(state) : []),
    },
  ],

  events: [
    // The old `checkAchievements`, which every counter write called. A reset
    // to a lower value claims nothing and takes nothing back.
    on(counterChanged, (ctx, { payload }) => {
      const defs = BY_KEY.get(payload.key);
      if (!defs) return;
      for (const def of defs) {
        let claimed = ctx.state.claimed[def.id] ?? 0;
        while (claimed < def.tiers.length && payload.value >= def.tiers[claimed].threshold) {
          claimed += 1;
          ctx.state.claimed[def.id] = claimed;
          ctx.touch(HELD_SOURCE);
          ctx.emit(tierClaimed, { achievement: def.id, tier: claimed });
          ctx.emit(logLine, {
            msg: fillText(TEXT.claimed, { icon: def.icon, name: def.name, tier: tierNumeral(claimed) }),
            kind: 'achievement',
          });
        }
      }
    }),
  ],

  view: (ctx): AchievementsView => {
    const state = ctx.state;
    const counts = ctx.read(counters);
    const rows = ACHIEVEMENT_LIST.map((def): AchievementRow => {
      const claimed = tiersClaimed(state, def.id);
      const next = def.tiers[claimed]?.threshold ?? null;
      return {
        id: def.id,
        name: def.name,
        icon: def.icon,
        claimed,
        tiers: def.tiers.length,
        value: counterValue(counts, def.statKey),
        next,
        goal: next === null ? null : def.desc.replace('{n}', fmt(next)),
        tierLines: def.tiers.map((t, i) => ({
          threshold: t.threshold,
          bonus: t.bonus.map(bonusText).join(', '),
          claimed: i < claimed,
        })),
      };
    });
    return {
      claimed: totalTiers(state),
      total: ACHIEVEMENT_LIST.reduce((n, d) => n + d.tiers.length, 0),
      rows,
    };
  },
});

export default system;
