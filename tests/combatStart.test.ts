/**
 * Port of the old `tests/combatStart.test.ts`.
 *
 * `soleCombatActivity` is the one of `src/systems/world`. The two cases of
 * "starting it" are ported on the commands the hunt activity sends:
 * `combat/hunt` and `combat/stop`.
 */
import { describe, expect, it } from 'vitest';
import { hunt, startForced, stopHunt } from '../src/systems/combat';
import { soleCombatActivity, SPOTS, type ActivityDef, type SpotDef } from '../src/systems/world';
import { combatOf, SITES } from './combatHelpers';
import { ask, makeGame } from './helpers';

const huntOf = (id: string): ActivityDef => ({ id, kind: 'hunt', name: id, icon: '⚔️' });
const spar: ActivityDef = { id: 'spar', kind: 'train', attr: 'str', name: 'Spar', icon: '⚔️', tags: ['combat'] };
const withActivities = (activities: ActivityDef[]): SpotDef => ({ ...SPOTS.the_sand, activities });

describe('soleCombatActivity', () => {
  it('no hunt: null, even beside a combat-tagged train activity', () => {
    expect(soleCombatActivity(withActivities([]))).toBeNull();
    expect(soleCombatActivity(withActivities([spar]))).toBeNull();
  });

  it('exactly one hunt: that hunt; a combat-tagged train activity does not count', () => {
    expect(soleCombatActivity(withActivities([huntOf('a')]))?.id).toBe('a');
    expect(soleCombatActivity(withActivities([spar, huntOf('a')]))?.id).toBe('a');
  });

  it('several hunts: null', () => {
    expect(soleCombatActivity(withActivities([huntOf('a'), huntOf('b')]))).toBeNull();
    expect(soleCombatActivity(withActivities([huntOf('a'), spar, huntOf('b')]))).toBeNull();
  });

  it('live spots: the Sand offers Beat the Post, the Training Area its dummies', () => {
    expect(soleCombatActivity(SPOTS.the_sand)?.name).toBe('Beat the Post');
    // The Training Area (`base_training_area`, "Work the Dummies") is a spot
    // of the hold: step 4.
    for (const spot of Object.values(SPOTS)) {
      const hunts = spot.activities.filter((a) => a.kind === 'hunt');
      expect(soleCombatActivity(spot), spot.id).toBe(hunts.length === 1 ? hunts[0] : null);
    }
  });
});

describe('starting it', () => {
  it('runs a fight, and selecting it again stops the fight', () => {
    const g = makeGame({ seed: 5 });
    expect(g.dispatch(hunt({ site: SITES.the_sand }))).toEqual({ ok: true });
    g.tick();
    expect(combatOf(g).hunting).toBe(true);
    expect(combatOf(g).fight).not.toBeNull();
    expect(g.dispatch(stopHunt())).toEqual({ ok: true });
    expect(combatOf(g).hunting).toBe(false);
    expect(combatOf(g).fight).toBeNull();
  });

  it('a forced fight keeps it locked, as on the Location tab', () => {
    const g = makeGame({ seed: 5 });
    expect(ask(g, startForced, { site: SITES.f3_hearing_room })).toBe(true);
    expect(combatOf(g).fight?.forced).toBe(true);
    expect(g.dispatch(hunt({ site: SITES.the_sand }))).toEqual({ ok: false, reason: 'the fight cannot be left' });
    expect(g.dispatch(stopHunt())).toEqual({ ok: false, reason: 'the fight cannot be left' });
    expect(combatOf(g).hunting).toBe(false);
    expect(combatOf(g).fight?.forced).toBe(true);
  });
});
