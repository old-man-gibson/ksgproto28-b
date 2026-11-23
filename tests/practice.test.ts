/**
 * Port of the old `tests/practice.test.ts` (docs/PRACTICE.md of the old
 * repository: XP from training equipment).
 *
 * Call shape changes:
 * - The old `practiceXp(state, key, level, amount)` inside `practising(state,
 *   ...)` read and stamped `state.combat.practiceAt` at `state.totalTicks`.
 *   Here the shaping is `shapePracticeXp(clock, now, key, level, amount)` on
 *   a clock object, which is what the request `practice/xp` runs inside the
 *   scope; outside it the request answers the amount.
 * - `grantAttrXp(state, bus, ...)` is the event `attributes/grant-xp`, sent
 *   from a command (outside the tick).
 * - `state.combat.practiceAt` is the `practice` slice's `at`.
 * - The old count of `tick:action` is `combat/bar-filled` for the player.
 *
 * New here: the order of the scope's closing tick, the clock emptied by a new
 * fight, and the scope still open when the fight closed on the killing blow.
 */
import { describe, expect, it } from 'vitest';
import { orderSystems, PLAYER, type Kernel } from '../src/kernel';
import { systems } from '../src/systems';
import { attrXpNeeded, grantAttrXp, type AttributesState } from '../src/systems/attributes';
import { barFilled, enemyKilled, isPracticeFight, type CombatState, type Enemy, type Fight } from '../src/systems/combat';
import type { CountersState } from '../src/systems/counters';
import type { LevelsState } from '../src/systems/levels';
import { MONSTERS } from '../src/systems/monsters';
import {
  practiceShare,
  practiceXp,
  PRACTICE_FLOOR_GAP,
  PRACTICE_XP_CUT,
  PRACTICE_XP_FALLOFF,
  PRACTICE_XP_FLOOR,
  shapePracticeXp,
  type PracticeState,
} from '../src/systems/practice';
import { skillXpNeeded, type SkillsState } from '../src/systems/skills';
import type { AttributeId } from '../src/systems/stats';
import { selectActivity, SPOTS } from '../src/systems/world';
import { ask, emit, makeGame, patch, slice } from './helpers';

const combatOf = (g: Kernel) => slice<CombatState>(g, 'combat');
const clockOf = (g: Kernel) => slice<PracticeState>(g, 'practice').at;

/** A fight against `defIds`, built by hand, not run. */
function fightOf(...defIds: string[]): Fight {
  return {
    enemies: defIds.map((defId) => ({ defId, hp: 100 }) as Enemy),
    playerBar: 0,
    momentum: 0,
    position: 'neutral',
    cooldowns: {},
    buffs: [],
    events: {},
  };
}

/** Lifetime XP a skill holds: every level climbed plus what is banked. */
function skillTotal(g: Kernel, id: string): number {
  const s = slice<SkillsState>(g, 'skills').skills[id];
  if (!s) return 0;
  let total = s.xp;
  for (let l = 1; l < s.level; l++) total += skillXpNeeded(id, l);
  return total;
}
function attrTotal(g: Kernel, attr: AttributeId): number {
  const a = slice<AttributesState>(g, 'attributes').attrs[attr];
  let total = a.xp;
  for (let l = 1; l < a.level; l++) total += attrXpNeeded(l);
  return total;
}

/** A fresh save hunting at `spot` (The Sand by default), the respawn delay spent. */
function hunting(seed = 7, spot = 'the_sand'): Kernel {
  const g = makeGame({ seed });
  patch(g, (slices) => {
    slices.world.spot = spot;
    if (!slices.world.discovered.includes(spot)) slices.world.discovered.push(spot);
  });
  expect(g.dispatch(selectActivity({ activity: 'hunt' }))).toEqual({ ok: true });
  patch(g, (slices) => {
    slices.combat.respawnTimer = 0;
  });
  return g;
}
const onThePost = (seed = 7) => hunting(seed, 'the_sand');

function untilFight(g: Kernel): void {
  for (let i = 0; i < 300 && !combatOf(g).fight; i++) g.tick();
  expect(combatOf(g).fight).not.toBeNull();
}

describe('the share', () => {
  it('is the cut at level 1 and falls as F / (F + L − 1)', () => {
    expect(practiceShare(1)).toBeCloseTo(PRACTICE_XP_CUT, 9);
    expect(practiceShare(1 + PRACTICE_XP_FALLOFF)).toBeCloseTo(PRACTICE_XP_CUT / 2, 9);
    expect(practiceShare(1 + 2 * PRACTICE_XP_FALLOFF)).toBeCloseTo(PRACTICE_XP_CUT / 3, 9);
    for (let l = 1; l < 100; l++) expect(practiceShare(l + 1)).toBeLessThan(practiceShare(l));
  });
});

describe('practiceXp', () => {
  it('is the identity outside a practice tick', () => {
    const g = onThePost();
    untilFight(g);
    expect(ask(g, practiceXp, { key: 'skill:fighting', level: 1, amount: 4.5 })).toBe(4.5);
    expect(clockOf(g)['skill:fighting']).toBeUndefined();
  });

  it('pays the larger of the cut payout and the floor for the gap', () => {
    const clock: Record<string, number> = {};
    let now = 100;
    // First payout of the fight: one second of floor.
    expect(shapePracticeXp(clock, now, 'skill:fighting', 1, 4.5)).toBeCloseTo(PRACTICE_XP_FLOOR, 9);
    // Same tick again: no time has passed, so only the cut payout.
    expect(shapePracticeXp(clock, now, 'skill:fighting', 1, 4.5)).toBeCloseTo(4.5 * PRACTICE_XP_CUT, 9);
    // Two seconds later: two seconds of floor.
    now += 20;
    expect(shapePracticeXp(clock, now, 'skill:fighting', 1, 4.5)).toBeCloseTo(2 * PRACTICE_XP_FLOOR, 9);
    // A payout big enough beats the floor.
    now += 10;
    expect(shapePracticeXp(clock, now, 'skill:fighting', 1, 100)).toBeCloseTo(100 * PRACTICE_XP_CUT, 9);
  });

  it('credits at most PRACTICE_FLOOR_GAP seconds for a long pause', () => {
    const clock: Record<string, number> = {};
    shapePracticeXp(clock, 100, 'attr:int', 1, 3);
    // A minute without a cast. 30 cut to 3 is under five seconds of floor; sixty are not credited.
    expect(shapePracticeXp(clock, 700, 'attr:int', 1, 30)).toBeCloseTo(PRACTICE_FLOOR_GAP * PRACTICE_XP_FLOOR, 9);
  });

  it('never pays more than the uncut amount', () => {
    const clock: Record<string, number> = {};
    shapePracticeXp(clock, 100, 'attr:dex', 1, 1);
    // Three seconds of floor, but the blow paid 1.
    expect(shapePracticeXp(clock, 130, 'attr:dex', 1, 1)).toBe(1);
  });

  it('keeps one clock per skill and per attribute', () => {
    const clock: Record<string, number> = {};
    shapePracticeXp(clock, 100, 'attr:str', 1, 2);
    // DEX was never paid in this fight, so it gets the first-payout second.
    expect(shapePracticeXp(clock, 120, 'attr:dex', 1, 2)).toBeCloseTo(PRACTICE_XP_FLOOR, 9);
    expect(shapePracticeXp(clock, 120, 'attr:str', 1, 2)).toBeCloseTo(2 * PRACTICE_XP_FLOOR, 9);
  });

  it('a payout made outside the tick is not shaped, even mid-fight', () => {
    const g = onThePost();
    untilFight(g);
    expect(isPracticeFight(combatOf(g).fight)).toBe(true);
    const before = attrTotal(g, 'str');
    emit(g, grantAttrXp, { attr: 'str', amount: 7 });
    expect(attrTotal(g, 'str') - before).toBe(7);
  });
});

describe('what counts as practice', () => {
  it('every standing enemy must be training equipment', () => {
    expect(isPracticeFight(fightOf('benchmark_dummy'))).toBe(true);
    expect(isPracticeFight(fightOf('training_dummy', 'training_dummy'))).toBe(true);
    expect(isPracticeFight(fightOf('training_dummy', 'forest_rat'))).toBe(false);
    expect(isPracticeFight(fightOf('forest_rat'))).toBe(false);
    expect(isPracticeFight(null)).toBe(false);
  });

  it('a real fight never touches the practice clock', () => {
    const g = hunting(3, 'the_cages');
    untilFight(g);
    for (let i = 0; i < 100 && combatOf(g).fight; i++) {
      g.tick();
      expect(clockOf(g)).toEqual({});
    }
  });
});

describe('the post on The Sand', () => {
  it('The Sand offers it, and it is a lone practice target', () => {
    const sand = SPOTS.the_sand;
    expect(sand.activities.some((a) => a.kind === 'hunt')).toBe(true);
    expect(sand.encounters?.map((e) => e.monsterId)).toEqual(['benchmark_dummy']);
    // What makes it training equipment here: the `passive` flag of the species.
    expect(MONSTERS.benchmark_dummy.passive).toBe(true);
    const g = onThePost();
    for (let i = 0; i < 50 && !combatOf(g).fight; i++) g.tick();
    const fight = combatOf(g).fight;
    expect(fight?.enemies.filter(Boolean).map((e) => e!.defId)).toEqual(['benchmark_dummy']);
    expect(isPracticeFight(fight)).toBe(true);
  });

  it('pays each combat skill about the floor per second, and Hunting nothing', () => {
    const g = onThePost();
    untilFight(g);
    const seconds = 300;
    const before = { fighting: skillTotal(g, 'fighting'), str: attrTotal(g, 'str') };
    g.tick(seconds * 10);
    expect(combatOf(g).fight).not.toBeNull(); // the post is still standing
    // A swing lands about every two seconds and pays Fighting 4.5 uncut, so
    // every payout is floored: the earned total tracks the clock. It runs a
    // little under it: a run of misses can leave a gap over the cap, and the
    // seconds after the last swing are not paid yet.
    const fighting = skillTotal(g, 'fighting') - before.fighting;
    expect(fighting).toBeGreaterThan(seconds * PRACTICE_XP_FLOOR * 0.95);
    expect(fighting).toBeLessThan(seconds * PRACTICE_XP_FLOOR + 5);
    // STR is paid 2 a swing, so the floor is trimmed to it on slower swings.
    const str = attrTotal(g, 'str') - before.str;
    expect(str).toBeGreaterThan(seconds * 0.5);
    expect(str).toBeLessThan(seconds * PRACTICE_XP_FLOOR + 5);
    expect(skillTotal(g, 'hunting')).toBe(0);
    const lv = slice<LevelsState>(g, 'levels');
    expect(lv.level).toBe(1);
    expect(lv.levelXp).toBe(0);
  });

  it('pays far less than the same fight would without the rule', () => {
    // The uncut figure: Fighting is paid 4.5 a swing. A post that cut nothing
    // would pay about that per swing; the floor holds it to the clock.
    const g = onThePost();
    let swings = 0;
    g.onEvent((event) => {
      if (event.type === barFilled.type && (event.payload as { entity: string }).entity === PLAYER) swings++;
    });
    g.tick(3000);
    expect(swings).toBeGreaterThan(50);
    expect(skillTotal(g, 'fighting')).toBeLessThan(swings * 4.5 * 0.6);
  });
});

describe('the Training Area dummies', () => {
  it('die and respawn but pay no character-level XP', () => {
    const g = hunting(5, 'base_training_area');
    const kills = () => slice<CountersState>(g, 'counters').counts.kills ?? 0;
    for (let t = 0; t < 20000 && kills() < 1; t++) g.tick();
    expect(kills()).toBeGreaterThan(0);
    const lv = slice<LevelsState>(g, 'levels');
    expect(lv.level).toBe(1);
    expect(lv.levelXp).toBe(0);
  });
});

// ---------- New here: the scope and the clock in the kernel ----------

describe('the scope and the clock (new)', () => {
  it('the scope closes in the tick hook right after combat, before any other system ticks', () => {
    const ticking = orderSystems(systems).filter((s) => s.tick);
    const at = ticking.findIndex((s) => s.id === 'combat');
    expect(ticking[at + 1]?.id).toBe('practice');
  });

  it('the payouts of the killing blow are shaped, though the fight closed before they were delivered', () => {
    const g = hunting(5, 'base_training_area');
    let killTick = -1;
    g.onEvent((event) => {
      if (event.type === enemyKilled.type && killTick < 0) killTick = event.tick;
    });
    for (let t = 0; t < 20000 && killTick < 0; t++) g.tick();
    expect(killTick).toBeGreaterThan(0);
    expect(combatOf(g).fight).toBeNull();
    // Stamped on the tick of the kill: the scope was open when they landed.
    expect(Object.values(clockOf(g))).toContain(killTick);
  });

  it('a new fight starts with an empty clock', () => {
    const g = onThePost();
    patch(g, (slices) => {
      slices.practice.at = { 'skill:fighting': 0, 'attr:str': 0 };
    });
    untilFight(g);
    expect(clockOf(g)).toEqual({});
    g.tick(40);
    expect(Object.keys(clockOf(g)).length).toBeGreaterThan(0);
  });
});
