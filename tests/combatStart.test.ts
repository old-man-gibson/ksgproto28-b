/**
 * Port of the old `tests/combatStart.test.ts`.
 *
 * `soleCombatActivity` reads a spot's activity list, which arrives with the
 * world port: its four cases are `it.todo`. The two cases of "starting it"
 * are ported on the commands the hunt activity will send: `combat/hunt` and
 * `combat/stop`.
 */
import { describe, expect, it } from 'vitest';
import { hunt, startForced, stopHunt } from '../src/systems/combat';
import { combatOf, SITES } from './combatHelpers';
import { ask, makeGame } from './helpers';

describe('soleCombatActivity', () => {
  it.todo('no hunt: null, even beside a combat-tagged train activity (port 6: activities)');
  it.todo('exactly one hunt: that hunt; a combat-tagged train activity does not count (port 6: activities)');
  it.todo('several hunts: null (port 6: activities)');
  it.todo('live spots: the Sand offers Beat the Post, the Training Area its dummies (port 6: activities)');
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
