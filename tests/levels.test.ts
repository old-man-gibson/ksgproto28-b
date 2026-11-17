import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/kernel';
import {
  encounterLevel,
  grantLevelXp,
  killXp,
  LEVEL_ATTR_BONUS,
  LEVEL_XP_BASE,
  levelFromXp,
  levelGapXpMult,
  levelUp,
  MIN_KILL_XP,
  raiseStartingLevel,
  rewardLevel,
  xpToNext,
  xpToReach,
  type LevelsState,
} from '../src/systems/levels';
import type { LogState } from '../src/systems/log';
import { ATTRIBUTE_IDS, effectiveAttr, statOf } from '../src/systems/stats';
import { emit, makeGame, slice } from './helpers';

/**
 * Port of the old tests/levels.test.ts. Changed: the call shape (events
 * through the kernel instead of functions on the state).
 *
 * Left behind, for the ports of the systems they need:
 * - "is not trained level: the Cages keeper still reads the trained total" (training);
 * - "what pays level XP": kills, floor clears, quest turn-ins (combat, world, quests);
 * - "Head Start (prestige)" (prestige; the request `levels/raise-start` is tested here);
 * - "save v56": the old save migration. The save starts at version 1 here.
 */

const levels = (kernel: ReturnType<typeof makeGame>) => slice<LevelsState>(kernel, 'levels');

describe('the level curve', () => {
  it('level 1 → 2 costs the base; every next level costs more', () => {
    expect(xpToNext(1)).toBe(LEVEL_XP_BASE);
    for (let l = 1; l < 30; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(3)).toBe(xpToNext(1) + xpToNext(2));
  });

  it('levelFromXp inverts xpToReach', () => {
    for (const level of [1, 2, 5, 12]) {
      expect(levelFromXp(xpToReach(level))).toEqual({ level, xp: 0 });
      expect(levelFromXp(xpToReach(level) + 1)).toEqual({ level, xp: 1 });
    }
  });
});

describe('kill XP by level gap (user, 2026-10-22)', () => {
  it('full at or above the fighter, then 1/N when the fighter is N levels above', () => {
    expect(levelGapXpMult(5, 9)).toBe(1); // the monster is higher: no bonus, no cut
    expect(levelGapXpMult(5, 5)).toBe(1);
    expect(levelGapXpMult(5, 4)).toBe(1); // one above: 1/1
    expect(levelGapXpMult(5, 3)).toBe(1 / 2);
    expect(levelGapXpMult(5, 2)).toBe(1 / 3);
    expect(levelGapXpMult(20, 1)).toBe(1 / 19);
  });

  it('a kill earns at least MIN_KILL_XP however wide the gap', () => {
    expect(MIN_KILL_XP).toBe(1);
    expect(killXp(40, { xp: 8, level: 1 })).toBe(1); // 8 / 39 is under one
    expect(killXp(40, { xp: 390, level: 1 })).toBeCloseTo(10, 6); // 390 / 39
    expect(killXp(40, { xp: 8, level: 40 })).toBe(8);
  });

  it('rewards read the level without the dynamic levels', () => {
    // From the old tests/dynamicLevels.test.ts; the rest of that file needs monsters.
    expect(rewardLevel({ level: 12, levelBonus: 4 })).toBe(8);
    expect(rewardLevel({ level: 12 })).toBe(12);
    expect(killXp(10, { xp: 100, level: 12, levelBonus: 4 })).toBe(50); // gap of 2 against level 8
  });
});

describe('the judge’s level (an encounter line’s levelRise)', () => {
  // From the old tests/desert.test.ts; the rest of that file needs the floor's content.
  // The entry's own example: B = 30, r = 0.1, C = 45.
  const EXAMPLE = { stat: 'taken', share: 0.1, ceiling: 45 };
  const judgeAt = (taken: number, level: number): number => encounterLevel(EXAMPLE, taken, level, 30);

  it('matches the example points: six pieces at P 20, 30, 40, 50; three at P 30', () => {
    expect(judgeAt(6, 20)).toBe(42);
    expect(judgeAt(6, 30)).toBe(45);
    expect(judgeAt(6, 40)).toBe(45);
    expect(judgeAt(6, 50)).toBe(45);
    expect(judgeAt(3, 30)).toBe(39);
  });

  it('nothing taken is the base; every piece costs at least one level', () => {
    expect(judgeAt(0, 40)).toBe(30);
    expect(judgeAt(6, 5)).toBe(36); // round(6 × 0.1 × 5) = 3, floored at 6
    expect(judgeAt(1, 1)).toBe(31);
  });

  it('a line without levelRise keeps its roll', () => {
    expect(encounterLevel(undefined, 6, 30, 30)).toBe(30);
  });
});

describe('grantLevelXp', () => {
  it('takes every level the XP pays for, keeps the rest, and says so once per level', () => {
    const kernel = makeGame();
    const ups: number[] = [];
    kernel.onEvent((event: GameEvent) => {
      if (event.type === levelUp.type) ups.push((event.payload as { level: number }).level);
    });
    emit(kernel, grantLevelXp, { xp: xpToReach(4) + 7 });
    expect(levels(kernel).level).toBe(4);
    expect(levels(kernel).levelXp).toBeCloseTo(7, 6);
    expect(ups).toEqual([2, 3, 4]);
    const logs = slice<LogState>(kernel, 'log').log.map((line) => line.msg);
    expect(logs.filter((m) => m.startsWith('⬆️ Level'))).toHaveLength(3);
    expect(logs[0]).toBe('⬆️ Level 2: +1 to every attribute.');
    emit(kernel, grantLevelXp, { xp: 0 });
    emit(kernel, grantLevelXp, { xp: -5 });
    expect(levels(kernel).level).toBe(4);
    // A grant that does nothing says why.
    expect(kernel.skips().map((skip) => skip.reason)).toEqual(['amount 0 is not above 0', 'amount -5 is not above 0']);
  });
});

describe('the level bonus', () => {
  it('adds LEVEL_ATTR_BONUS to all six attributes per level above 1, and the stat block follows', () => {
    const kernel = makeGame();
    const before = Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, effectiveAttr(kernel, id)]));
    const hpBefore = statOf(kernel, 'maxHp');
    emit(kernel, grantLevelXp, { xp: xpToReach(4) });
    for (const id of ATTRIBUTE_IDS) {
      expect(effectiveAttr(kernel, id) - before[id]).toBeCloseTo(3 * LEVEL_ATTR_BONUS, 6);
    }
    // The level's source was touched: the cached block is rebuilt.
    expect(statOf(kernel, 'maxHp')).toBeGreaterThan(hpBefore);
    expect(kernel.staleStats()).toEqual([]);
  });
});

describe('starting level (the request the Head Start boon will send)', () => {
  it('raises the level with no banked XP, and never lowers it', () => {
    const kernel = makeGame();
    emit(kernel, grantLevelXp, { xp: 50 });
    emit(kernel, raiseStartingLevel, { level: 3 });
    expect(levels(kernel)).toEqual({ level: 3, levelXp: 0 });
    expect(effectiveAttr(kernel, 'str')).toBe(3);
    emit(kernel, grantLevelXp, { xp: 20 });
    emit(kernel, raiseStartingLevel, { level: 2 });
    expect(levels(kernel)).toEqual({ level: 3, levelXp: 20 });
    expect(kernel.staleStats()).toEqual([]);
  });
});

describe('a new game', () => {
  it('starts at level 1 with no XP', () => {
    expect(levels(makeGame())).toEqual({ level: 1, levelXp: 0 });
  });
});
