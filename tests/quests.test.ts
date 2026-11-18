/**
 * Port of the old `tests/quests.test.ts`: accept, progress, turn-in, chains,
 * gates. The cases keep their old names.
 *
 * The old file stood on the shelved countryside quests (`first_posting`,
 * `head_of_the_problem`, `word_from_the_west`, `eight_legs_too_many`) and
 * their givers (`captain_bren` at `town_gates`, `elder_maren` at
 * `village_square`). Only `the_first_ascent` is in this build. The four
 * shelved quests and their two givers are mounted here as test-only records,
 * pushed into the exported `QUESTS` and `NPCS` maps for the duration of the
 * file and removed after, with the old objectives and rewards. The givers
 * stand on spots of this build: `captain_bren` at `ironyard_gate`,
 * `elder_maren` at `long_gallery`; the reach target is `the_sand`, the
 * away spot is `ascent_foot`.
 *
 * Call shape changes:
 * - `g.acceptQuest` / `g.turnInQuest` are the commands `quests/accept` and
 *   `quests/turn-in`; the old pure `acceptQuest(state, bus, id)` returned a
 *   boolean, here the command result's `ok`.
 * - The old kill event (`bus.emit({ type: 'kill' })`) is `combat/kill`; the
 *   old `arrive` is `world/arrived`.
 * - `availableQuests` takes the person's id, `objectiveProgress`,
 *   `questComplete` and `canTurnIn` take a read context and the quests slice.
 * - `state.spot`, `state.skills`, `state.materials` and `state.quests` are
 *   written through `patch`.
 *
 * `it.todo`:
 * - craft objectives: crafting is step 3.
 * - the questmaster achievement: achievements are step 3.
 * - the v3 to v4 save migration: there is no importer of the old save; the
 *   save starts at version 1.
 *
 * New cases: `npcs/talk` (the met counter and its skip reasons), the
 * `quest:<id>` fact after a turn-in, the rewards of `the_first_ascent`, and
 * its divine favour (step 3, divine).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { enemyKilled } from '../src/systems/combat';
import { conditionsMet } from '../src/systems/counters';
import type { DivineState } from '../src/systems/divine';
import type { GoldState } from '../src/systems/gold';
import { xpToReach, type LevelsState } from '../src/systems/levels';
import type { LogState } from '../src/systems/log';
import { grantGraded, stockOf, type MaterialsState } from '../src/systems/materials';
import { metKey, NPCS, talkTo, type NpcDef } from '../src/systems/npcs';
import {
  acceptQuest,
  availableQuests,
  canTurnIn,
  objectiveProgress,
  questComplete,
  QUESTS,
  turnInQuest,
  type QuestDef,
  type QuestsState,
} from '../src/systems/quests';
import { conditionReader, type SkillsState } from '../src/systems/skills';
import { arrived, type WorldState } from '../src/systems/world';
import type { ItemsState } from '../src/systems/items';
import { ask, emit, makeGame, patch, reads, slice } from './helpers';
import { counterOf, patchWorld, setCounters } from './worldHelpers';

// ---- the shelved quests, mounted for this file ----

const TEST_NPCS: Record<string, NpcDef> = {
  captain_bren: {
    id: 'captain_bren',
    name: 'Captain Bren',
    icon: 'x',
    spotId: 'ironyard_gate',
    quests: ['first_posting', 'head_of_the_problem'],
    desc: 'Test record.',
    dialogue: [],
  },
  elder_maren: {
    id: 'elder_maren',
    name: 'Elder Maren',
    icon: 'x',
    spotId: 'long_gallery',
    quests: ['word_from_the_west', 'eight_legs_too_many'],
    desc: 'Test record.',
    dialogue: [],
  },
};

const TEST_QUESTS: Record<string, QuestDef> = {
  first_posting: {
    id: 'first_posting',
    name: 'First Posting',
    desc: 'Test record.',
    giver: 'captain_bren',
    objectives: [{ type: 'kill', monsterId: 'goblin', count: 10, desc: 'Slay Goblins' }],
    rewards: { gold: 100, skillXp: [{ id: 'fighting', xp: 30 }] },
  },
  head_of_the_problem: {
    id: 'head_of_the_problem',
    name: 'Head of the Problem',
    desc: 'Test record.',
    giver: 'captain_bren',
    requirements: [{ type: 'quest', id: 'first_posting' }],
    objectives: [{ type: 'kill', monsterId: 'goblin_boss', count: 1, desc: 'Defeat the Boss Goblin' }],
    rewards: { gold: 300, items: ['wolf_cloak'] },
  },
  word_from_the_west: {
    id: 'word_from_the_west',
    name: 'Word from the West',
    desc: 'Test record.',
    giver: 'elder_maren',
    objectives: [{ type: 'reach', spotId: 'the_sand', desc: 'Reach the Sand' }],
    rewards: { gold: 50, skillXp: [{ id: 'scouting', xp: 25 }] },
  },
  eight_legs_too_many: {
    id: 'eight_legs_too_many',
    name: 'Eight Legs Too Many',
    desc: 'Test record.',
    giver: 'elder_maren',
    requirements: [{ type: 'quest', id: 'word_from_the_west' }],
    objectives: [
      { type: 'kill', monsterId: 'cave_spider', count: 15, desc: 'Slay Cave Spiders' },
      { type: 'collect', materialId: 'common_herb', qty: 8, desc: 'Bring Common Herbs' },
    ],
    rewards: { gold: 200, items: ['herbal_charm'] },
  },
};

beforeAll(() => {
  Object.assign(NPCS, TEST_NPCS);
  Object.assign(QUESTS, TEST_QUESTS);
});

afterAll(() => {
  for (const id of Object.keys(TEST_NPCS)) delete NPCS[id];
  for (const id of Object.keys(TEST_QUESTS)) delete QUESTS[id];
});

// ---- helpers ----

const questsOf = (k: Kernel): QuestsState => slice<QuestsState>(k, 'quests');
const goldOf = (k: Kernel): number => slice<GoldState>(k, 'gold').gold;
const ctxOf = (k: Kernel) => reads(k);

function at(k: Kernel, spot: string): void {
  patchWorld(k, (w: WorldState) => {
    w.spot = spot;
    if (!w.discovered.includes(spot)) w.discovered.push(spot);
  });
}

function gameAtSpot(seed: number, spot: string): Kernel {
  const k = makeGame({ seed });
  at(k, spot);
  return k;
}

/** The old `killEvent`: the kill a fight sends. */
function killEvent(k: Kernel, defId: string): void {
  emit(k, enemyKilled, {
    entity: 'monster:test',
    defId,
    name: defId,
    level: 5,
    rewardLevel: 5,
    xp: 1,
    tags: [],
    lastHit: null,
    site: 'test',
    boss: false,
    once: false,
  });
}

const progress = (k: Kernel, id: string, i: number) => objectiveProgress(ctxOf(k), questsOf(k), QUESTS[id], i);
const complete = (k: Kernel, id: string) => questComplete(ctxOf(k), questsOf(k), QUESTS[id]);
const turnable = (k: Kernel, id: string) => canTurnIn(ctxOf(k), questsOf(k), QUESTS[id]);
const offered = (k: Kernel, npc: string) => availableQuests(ctxOf(k), questsOf(k), npc).map((q) => q.id);

describe('quest lifecycle', () => {
  it('accept → kill progress → turn-in gated by location → rewards', () => {
    const g = gameAtSpot(1, 'ironyard_gate');

    expect(g.dispatch(acceptQuest({ quest: 'first_posting' })).ok).toBe(true);
    expect(questsOf(g).quests.first_posting?.status).toBe('active');

    for (let i = 0; i < 9; i++) killEvent(g, 'goblin');
    killEvent(g, 'forest_rat'); // wrong monster: must not count
    expect(progress(g, 'first_posting', 0)).toEqual({ current: 9, target: 10 });
    expect(complete(g, 'first_posting')).toBe(false);

    killEvent(g, 'goblin');
    expect(complete(g, 'first_posting')).toBe(true);

    // Away from the giver: cannot turn in.
    at(g, 'ascent_foot');
    expect(turnable(g, 'first_posting')).toBe(false);
    expect(g.dispatch(turnInQuest({ quest: 'first_posting' })).ok).toBe(false);
    expect(questsOf(g).quests.first_posting.status).toBe('active');

    // Back at the giver: rewards flow.
    at(g, 'ironyard_gate');
    patch(g, (s) => {
      (s.skills as SkillsState).skills.fighting = { level: 1, xp: 0 };
    });
    const goldBefore = goldOf(g);
    expect(g.dispatch(turnInQuest({ quest: 'first_posting' })).ok).toBe(true);
    expect(questsOf(g).quests.first_posting.status).toBe('done');
    expect(goldOf(g)).toBe(goldBefore + 100);
    const fighting = slice<SkillsState>(g, 'skills').skills.fighting;
    expect(fighting.xp > 0 || fighting.level > 1).toBe(true);
    expect(counterOf(g, 'quests:completed')).toBe(1);
  });

  it('progress does not advance past the target or on inactive quests', () => {
    const g = gameAtSpot(2, 'ironyard_gate');
    g.dispatch(acceptQuest({ quest: 'first_posting' }));
    for (let i = 0; i < 25; i++) killEvent(g, 'goblin');
    expect(progress(g, 'first_posting', 0).current).toBe(10);
    expect(questsOf(g).quests.first_posting.progress).toEqual([10]);
    // head_of_the_problem never accepted: no ghost progress
    expect(questsOf(g).quests.head_of_the_problem).toBeUndefined();
  });
});

describe('objective types', () => {
  it.todo('craft objectives advance via the craft event (step 3: crafting)');

  it('reach objectives fire on arrival; collect objectives read and consume materials', () => {
    const g = gameAtSpot(4, 'long_gallery');
    expect(g.dispatch(acceptQuest({ quest: 'word_from_the_west' })).ok).toBe(true);
    at(g, 'the_sand');
    // `at` writes the spot; the arrival is the event the world sends.
    emit(g, arrived, { spot: 'the_sand', from: 'long_gallery', ambushed: false });
    expect(complete(g, 'word_from_the_west')).toBe(true);
    // Turn-in is at the GIVER, not the destination.
    expect(turnable(g, 'word_from_the_west')).toBe(false);
    at(g, 'long_gallery');
    expect(g.dispatch(turnInQuest({ quest: 'word_from_the_west' })).ok).toBe(true);
    expect(questsOf(g).quests.word_from_the_west.status).toBe('done');

    // Chain unlocks; collect objective is possession-based and consumed.
    expect(offered(g, 'elder_maren')).toContain('eight_legs_too_many');
    expect(g.dispatch(acceptQuest({ quest: 'eight_legs_too_many' })).ok).toBe(true);
    for (let i = 0; i < 15; i++) killEvent(g, 'cave_spider');
    expect(complete(g, 'eight_legs_too_many')).toBe(false); // no herbs yet
    // Common herb is graded here: the old plain count is stock at grade c.
    ask(g, grantGraded, { id: 'common_herb', quality: 'c', qty: 10 });
    expect(complete(g, 'eight_legs_too_many')).toBe(true);
    expect(g.dispatch(turnInQuest({ quest: 'eight_legs_too_many' })).ok).toBe(true);
    expect(stockOf(slice<MaterialsState>(g, 'materials'), 'common_herb', 'c')).toBe(2); // 8 handed over
    expect(slice<ItemsState>(g, 'items').inventory.some((i) => i.defId === 'herbal_charm')).toBe(true);
  });
});

describe('chains & gating', () => {
  it('follow-ups are hidden until the predecessor is done', () => {
    const g = gameAtSpot(5, 'ironyard_gate');
    expect(offered(g, 'captain_bren')).toEqual(['first_posting']);

    patch(g, (s) => {
      (s.quests as QuestsState).quests.first_posting = { status: 'done', progress: [10] };
    });
    expect(offered(g, 'captain_bren')).toEqual(['head_of_the_problem']);
  });

  it('accepting requires standing at the giver spot and passing requirements', () => {
    const g = gameAtSpot(6, 'long_gallery'); // not Bren's spot
    expect(g.dispatch(acceptQuest({ quest: 'first_posting' })).ok).toBe(false);
    at(g, 'ironyard_gate');
    expect(g.dispatch(acceptQuest({ quest: 'head_of_the_problem' })).ok).toBe(false); // chain locked
    expect(g.dispatch(acceptQuest({ quest: 'first_posting' })).ok).toBe(true);
  });

  it.todo('questmaster achievement tiers on completions (step 3: achievements)');
});

describe('migration', () => {
  it.todo('v3 saves migrate to v4 with an empty quest log (no importer of the old save; the save starts at version 1)');
});

// ---- new cases ----

describe('npcs/talk', () => {
  it('a first greeting stamps the met counter', () => {
    const g = gameAtSpot(20, 'ascent_foot');
    expect(counterOf(g, metKey('warden_of_the_foot'))).toBe(0);
    expect(g.dispatch(talkTo({ npc: 'warden_of_the_foot' })).ok).toBe(true);
    expect(counterOf(g, metKey('warden_of_the_foot'))).toBe(1);
  });

  it('skips with a reason when the person stands elsewhere', () => {
    const g = gameAtSpot(21, 'ironyard_gate');
    const result = g.dispatch(talkTo({ npc: 'warden_of_the_foot' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/is not here/);
    expect(counterOf(g, metKey('warden_of_the_foot'))).toBe(0);
  });

  it('skips with a reason when the person is already met', () => {
    const g = gameAtSpot(22, 'ascent_foot');
    g.dispatch(talkTo({ npc: 'warden_of_the_foot' }));
    const result = g.dispatch(talkTo({ npc: 'warden_of_the_foot' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already met/);
    expect(counterOf(g, metKey('warden_of_the_foot'))).toBe(1);
  });
});

describe('the_first_ascent', () => {
  /** Accepted at the Foot, the toll collector down. */
  function finished(seed: number): Kernel {
    const g = gameAtSpot(seed, 'ascent_foot');
    expect(g.dispatch(acceptQuest({ quest: 'the_first_ascent' })).ok).toBe(true);
    setCounters(g, { 'boss:f1_toll_hall': 1 });
    expect(complete(g, 'the_first_ascent')).toBe(true);
    return g;
  }

  it('a stat objective reads the counter live, even one set before the accept', () => {
    const g = gameAtSpot(30, 'ascent_foot');
    setCounters(g, { 'boss:f1_toll_hall': 1 });
    g.dispatch(acceptQuest({ quest: 'the_first_ascent' }));
    expect(progress(g, 'the_first_ascent', 0)).toEqual({ current: 1, target: 1 });
    expect(complete(g, 'the_first_ascent')).toBe(true);
  });

  it('states the fact quest:<id> after the turn-in', () => {
    const g = finished(31);
    const cond = [{ type: 'quest' as const, id: 'the_first_ascent' }];
    expect(conditionsMet(conditionReader(reads(g)), cond)).toBe(false);
    expect(g.dispatch(turnInQuest({ quest: 'the_first_ascent' })).ok).toBe(true);
    expect(conditionsMet(conditionReader(reads(g)), cond)).toBe(true);
  });

  it('pays 350 gold (earned), counts the completion and grants 100 level XP', () => {
    const g = finished(32);
    const goldBefore = goldOf(g);
    const earnedBefore = counterOf(g, 'gold:earned');
    const lv = slice<LevelsState>(g, 'levels');
    const xpBefore = xpToReach(lv.level) + lv.levelXp;
    expect(g.dispatch(turnInQuest({ quest: 'the_first_ascent' })).ok).toBe(true);
    expect(goldOf(g)).toBe(goldBefore + 350);
    expect(counterOf(g, 'gold:earned')).toBe(earnedBefore + 350);
    expect(counterOf(g, 'quests:completed')).toBe(1);
    const after = slice<LevelsState>(g, 'levels');
    expect(xpToReach(after.level) + after.levelXp).toBeCloseTo(xpBefore + 100, 6);
  });

  // The old turn-in's `grantFavorAll(1 + rewards.favor)`: known gods only,
  // logged before the completed line.
  it('pays 1 favour plus its own 1 with every known god, and none with the rest', () => {
    const g = finished(33);
    expect(g.dispatch(turnInQuest({ quest: 'the_first_ascent' })).ok).toBe(true);
    const favor = slice<DivineState>(g, 'divine').favor;
    expect(favor).toEqual({ denjalle: 2, usvylgr: 2 });
    const log = slice<LogState>(g, 'log').log.map((l) => l.msg);
    const gained = log.findIndex((m) => m === '🕊️ +2 favor with every god you know.');
    const done = log.findIndex((m) => m.startsWith('🎉 Quest complete: The First Ascent'));
    expect(gained).toBeGreaterThanOrEqual(0);
    expect(done).toBeGreaterThan(gained);
  });
});
