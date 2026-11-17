/**
 * Character level. Port of the old `systems/levels.ts` and
 * `data/levels.data.ts`. One general-strength track next to the per-skill
 * and per-attribute XP. See README.md in this folder.
 *
 * - Paid by: kills, quest turn-ins, a floor's first clear in the run.
 * - Pays: +LEVEL_ATTR_BONUS to all six attributes per level above 1.
 */
import { defineEvent, defineSystem, on, PLAYER, registry, type DeepReadonly } from '../../kernel';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import { ATTRIBUTE_IDS, statMod, type ModOrigin } from '../stats';
import levelsTextData from './content/levels_text.json';
import { migrations } from './migrations';

// ---- numbers ----

/** Added to every attribute per level above 1. */
export const LEVEL_ATTR_BONUS = 1;
/** XP from level L to L + 1 is LEVEL_XP_BASE x L^LEVEL_XP_EXP, rounded. */
export const LEVEL_XP_BASE = 110;
export const LEVEL_XP_EXP = 1.5;
/** Kill XP = the spawned monster's XP x this. */
export const KILL_LEVEL_XP_RATE = 1;
/** A kill never earns less than this. */
export const MIN_KILL_XP = 1;
/** A quest turn-in with no level XP of its own pays this. */
export const DEFAULT_QUEST_LEVEL_XP = 50;

// ---- slice ----

export interface LevelsState {
  /** Starts at 1. */
  level: number;
  /** XP banked toward the next level. Fractional. */
  levelXp: number;
}

// ---- text ----

const levelsText = registry(textSchema, levelsTextData, 'Level text');
const TEXT = Object.fromEntries((levelsTextData as TextRecord[]).map((r) => [r.id, r.text]));

/** A line of this system's text, filled. Ids: `up`, `floor`, `floor_lapsed`, `band`. */
export function levelsLine(id: 'up' | 'floor' | 'floor_lapsed' | 'band', params?: Record<string, unknown>): string {
  return fillText(TEXT[id], params);
}

// ---- the curve ----

/** XP to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return Math.round(LEVEL_XP_BASE * Math.pow(Math.max(1, level), LEVEL_XP_EXP));
}

/** XP from level 1 to the start of `level`. */
export function xpToReach(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpToNext(l);
  return total;
}

/** Level and leftover XP for a lifetime total, counting up from `from`. */
export function levelFromXp(xp: number, from = 1): { level: number; xp: number } {
  let level = from;
  let rest = xp;
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, xp: rest };
}

/**
 * The share of a kill's XP a fighter earns by level gap: all of it against a
 * monster at or above the fighter's level, and 1/N when the fighter is N
 * levels above.
 */
export function levelGapXpMult(playerLevel: number, monsterLevel: number): number {
  const gap = playerLevel - monsterLevel;
  return gap <= 0 ? 1 : 1 / gap;
}

/** What of a monster the reward rules read. */
export interface RewardSubject {
  xp: number;
  level: number;
  /** Levels the band's dynamic-level rule added. Rewards do not read them. */
  levelBonus?: number;
}

/** The level a monster's rewards read: its level without the dynamic levels. */
export function rewardLevel(monster: Pick<RewardSubject, 'level' | 'levelBonus'>): number {
  return monster.level - (monster.levelBonus ?? 0);
}

/** The XP a kill earns: the monster's XP times the level-gap share, never under MIN_KILL_XP. */
export function killXp(playerLevel: number, monster: RewardSubject): number {
  return Math.max(MIN_KILL_XP, monster.xp * levelGapXpMult(playerLevel, rewardLevel(monster)));
}

/** An encounter line's `levelRise` rule. */
export interface LevelRise {
  /** The counter the rise reads. */
  stat: string;
  share: number;
  ceiling: number;
}

/**
 * The level an encounter line spawns at, from the level its range rolled.
 * With k the counter named by the rise and P the character level:
 *
 *   min(ceiling, rolled + max(k, round(k x share x P)))
 *
 * A line without a rise keeps the roll.
 */
export function encounterLevel(rise: LevelRise | undefined, counter: number, playerLevel: number, rolled: number): number {
  if (!rise) return rolled;
  const k = counter;
  return Math.min(rise.ceiling, rolled + Math.max(k, Math.round(k * rise.share * playerLevel)));
}

/** The flat bonus every attribute gets from a level. */
export function levelAttrBonus(level: number): number {
  return Math.max(0, level - 1) * LEVEL_ATTR_BONUS;
}

/** Level XP a quest pays on turn-in. */
export function questLevelXp(ownLevelXp: number | undefined): number {
  return ownLevelXp ?? DEFAULT_QUEST_LEVEL_XP;
}

/** Once-per-run stamp for a floor's clear XP. A counter key. */
export function floorXpKey(floorId: string): string {
  return `level:floor:${floorId}`;
}

export function levelOf(state: DeepReadonly<LevelsState>): number {
  return state.level;
}

// ---- events ----

/** Request: add level XP and take every level it pays for. */
export const grantLevelXp = defineEvent<{ xp: number }>('levels/grant-xp');
/** Request: raise the level to `level` when it is higher, with no banked XP. Never lowers. */
export const raiseStartingLevel = defineEvent<{ level: number }>('levels/raise-start');
/** The level rose to `level`. One event per level. */
export const levelUp = defineEvent<{ level: number }>('levels/up');

// ---- modifier source ----

const ATTRS_SOURCE = 'levels/attrs';
const LEVEL: ModOrigin = { kind: 'level' };

export interface LevelsView {
  level: number;
  levelXp: number;
  xpToNext: number;
  attrBonus: number;
}

export default defineSystem<LevelsState, LevelsView>({
  id: 'levels',
  version: 1,
  migrations,
  initial: () => ({ level: 1, levelXp: 0 }),
  content: { levels_text: levelsText },

  modifiers: [
    {
      id: ATTRS_SOURCE,
      // A flat add to all six. Not a trained level, so no rank or milestone reads it.
      collect: ({ state, entity }) => {
        const fromLevel = levelAttrBonus(state.level);
        if (entity !== PLAYER || fromLevel <= 0) return [];
        return ATTRIBUTE_IDS.map((id) => statMod(id, 'add', fromLevel, `Level ${state.level}`, LEVEL));
      },
    },
  ],

  events: [
    on(grantLevelXp, (ctx, event) => {
      const { xp } = event.payload;
      if (!(xp > 0)) return ctx.skip('levels/grant-xp', `amount ${xp} is not above 0`);
      const state = ctx.state;
      state.levelXp += xp;
      while (state.levelXp >= xpToNext(state.level)) {
        state.levelXp -= xpToNext(state.level);
        state.level += 1;
        ctx.touch(ATTRS_SOURCE);
        ctx.emit(levelUp, { level: state.level });
        ctx.emit(logLine, { msg: levelsLine('up', { level: state.level, bonus: LEVEL_ATTR_BONUS }), kind: 'info' });
      }
    }),
    on(raiseStartingLevel, (ctx, event) => {
      // Not a skip: a start level at or under the level reached is the normal case.
      if (ctx.state.level >= event.payload.level) return;
      ctx.state.level = event.payload.level;
      ctx.state.levelXp = 0;
      ctx.touch(ATTRS_SOURCE);
    }),
  ],

  view: ({ state }) => ({
    level: state.level,
    levelXp: state.levelXp,
    xpToNext: xpToNext(state.level),
    attrBonus: levelAttrBonus(state.level),
  }),
});
