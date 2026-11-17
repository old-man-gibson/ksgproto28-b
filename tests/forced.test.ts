/**
 * Port of the old `tests/forced.test.ts`: forced fights that cannot be left.
 *
 * The old chain was: a spot or the road into it declares the ambush,
 * arriving starts the fight, every door out is refused, winning frees the
 * character, losing calls the retreat. Arrival, roads, travel, the retreat
 * and the pathfinder are the world port's. What is ported here is combat's
 * half of each case, on the request the world port will make on arrival
 * (`combat/start-forced`) and on the commands the doors send. The other
 * half of each case is an `it.todo` under the same name.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import { hunt, playerDefeated, startForced, stopHunt, TEXT, type EncounterSite } from '../src/systems/combat';
import type { ResourcesState } from '../src/systems/resources';
import { combatOf, logOf } from './combatHelpers';
import { ask, makeGame, patch } from './helpers';

const den: EncounterSite = {
  id: 'ff_den',
  name: 'Test Den',
  encounters: [{ monsterId: 'forest_rat', weight: 100, level: [1, 1] }],
};
const arena: EncounterSite = { ...den, id: 'ff_arena', name: 'Test Arena' };

/** Arrive at a forced site: what the world port does when a journey ends on one. */
function arrive(seed: number, site: EncounterSite): Kernel {
  const g = makeGame({ seed });
  expect(ask(g, startForced, { site })).toBe(true);
  return g;
}

describe('forced fights', () => {
  it('arriving at a forced spot starts a fight that was never asked for', () => {
    const g = arrive(1, den);
    expect(combatOf(g).hunting).toBe(false); // nothing was selected...
    expect(combatOf(g).fight?.forced).toBe(true); // ...and the fight is on anyway
    expect(logOf(g)).toContain(TEXT.ambushed);
  });
  it.todo('arriving at a forced spot starts a fight that was never asked for: the walk (port 6: travel)');

  it('a forced EDGE ambushes too, and the road back out does not', () => {
    const g = arrive(2, arena);
    expect(combatOf(g).fight?.forced).toBe(true);
    // The fight is scaffolding, so it must not be decided by a die: give
    // this character a body that settles it.
    patch(g, (slices) => {
      (slices.attributes as AttributesState).attrs.con = { level: 8, xp: 0 };
      (slices.resources as ResourcesState).values.hp = 999; // clamped to the new max on the next tick
    });
    for (let i = 0; i < 3000 && combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).lastFight?.outcome).toBe('won');
    expect(combatOf(g).fight).toBeNull();
  });
  it.todo('a forced EDGE ambushes too, and the road back out does not: the edge and its mirror (port 6: roads)');

  it('every door out is refused while the fight is live', () => {
    const g = arrive(3, den);
    expect(g.dispatch(stopHunt())).toEqual({ ok: false, reason: 'the fight cannot be left' });
    expect(g.dispatch(hunt({ site: arena }))).toEqual({ ok: false, reason: 'the fight cannot be left' });
    expect(combatOf(g).hunting).toBe(false);
    expect(combatOf(g).site?.id).toBe('ff_den');
    expect(combatOf(g).fight?.forced).toBe(true);
  });
  it.todo('every door out is refused while the fight is live: travel, the plan, fast travel (port 6)');

  it('the fight resolves on its own, with no activity driving it', () => {
    const g = arrive(4, den);
    for (let i = 0; i < 3000 && combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).lastFight?.outcome).toBe('won');
    // The hunt loop was never on, so no second fight is rolled.
    g.tick(100);
    expect(combatOf(g).fight).toBeNull();
    // Freedom returns with the win: the doors work again.
    expect(g.dispatch(hunt({ site: den }))).toEqual({ ok: true });
  });

  it('losing throws you to the haven instead of leaving you in the den', () => {
    // The den holds something a new character cannot survive.
    const deadly: EncounterSite = { ...den, encounters: [{ monsterId: 'wolf', weight: 100, level: [35, 40] }] };
    const g = arrive(5, deadly);
    let defeat: { forced: boolean } | null = null;
    g.onEvent((event) => {
      if (event.type === playerDefeated.type) defeat = event.payload as { forced: boolean };
    });
    expect(combatOf(g).fight?.forced).toBe(true);
    for (let i = 0; i < 5000 && combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).lastFight?.outcome).toBe('knocked_out');
    expect(combatOf(g).fight).toBeNull();
    // What the retreat needs: the defeat says the fight was forced.
    expect(defeat).toMatchObject({ forced: true, site: 'ff_den' });
    expect(logOf(g).some((line) => line.includes('knocks you out.'))).toBe(true);
  });
  it.todo('losing throws you to the haven instead of leaving you in the den: the retreat and recovery (port 6)');

  it.todo('the pathfinder walks around a forced spot, but will end a journey on one (port 6: the pathfinder)');

  // New here: the refusals of the request.
  it('does not start on an empty table or over an open fight', () => {
    const g = makeGame({ seed: 6 });
    expect(ask(g, startForced, { site: { ...den, encounters: [] } })).toBe(false);
    expect(ask(g, startForced, { site: den })).toBe(true);
    expect(ask(g, startForced, { site: arena })).toBe(false);
    expect(combatOf(g).site?.id).toBe('ff_den');
  });
});
