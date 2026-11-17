/**
 * Port of the old `tests/forced.test.ts`: forced fights that cannot be left.
 *
 * The old chain was: a spot or the road into it declares the ambush,
 * arriving starts the fight, every door out is refused, winning frees the
 * character, losing calls the retreat. Each case has two halves under the
 * same name: the half of combat, on the request the world makes on arrival
 * (`combat/start-forced`) and on the commands the doors send, and the
 * half of the world (arrival, roads, travel, the pathfinder), on a pocket
 * world mounted into the spot registries for this file:
 *
 *   ff_camp (haven, waypoint) <-> ff_gate <-> ff_den (forced, waypoint) <-> ff_beyond
 *                                    \-> ff_arena (by a forced road)
 *
 * The old file wrote the mirrored roads by hand. Here `buildAdjacency` makes
 * them, so the rule that a mirror is never forced is the one the registry runs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import { hunt, playerDefeated, startForced, stopHunt, TEXT, type EncounterSite } from '../src/systems/combat';
import type { GoldState } from '../src/systems/gold';
import type { ResourcesState } from '../src/systems/resources';
import { edgesFrom, fastTravel, findPath, selectActivity, travelTo, type SpotDef } from '../src/systems/world';
import { combatOf, logOf } from './combatHelpers';
import { ask, makeGame, patch, reads, slice } from './helpers';
import { hop, mountSpots, patchWorld, sent, worldOf } from './worldHelpers';

const den: EncounterSite = {
  id: 'ff_den',
  name: 'Test Den',
  encounters: [{ monsterId: 'forest_rat', weight: 100, level: [1, 1] }],
};
const arena: EncounterSite = { ...den, id: 'ff_arena', name: 'Test Arena' };

const rat = den.encounters;

const ARENA: Record<string, SpotDef> = {
  ff_camp: {
    id: 'ff_camp', name: 'Test Camp', icon: '🏕️', areaId: 'ascent_f0_area', desc: '', waypoint: true,
    activities: [{ id: 'rest', kind: 'rest', name: 'Camp', icon: '🏕️' }],
    connections: [{ to: 'ff_gate', ticks: 5 }],
  },
  ff_gate: {
    id: 'ff_gate', name: 'Test Gate', icon: '🚪', areaId: 'ascent_f0_area', desc: '',
    activities: [],
    connections: [
      { to: 'ff_den', ticks: 5 },
      { to: 'ff_arena', ticks: 5, forced: true },
    ],
  },
  ff_den: {
    id: 'ff_den', name: 'Test Den', icon: '🕳️', areaId: 'ascent_f0_area', desc: '', waypoint: true, forced: true,
    activities: [
      { id: 'hunt', kind: 'hunt', name: 'Hunt', icon: '🏹' },
      // Also a haven: an ambushed arrival must not record the ambush site as
      // the place its own loss returns to.
      { id: 'rest', kind: 'rest', name: 'Cold Fire Pit', icon: '🔥' },
    ],
    encounters: rat,
    connections: [{ to: 'ff_beyond', ticks: 5 }],
  },
  ff_arena: {
    id: 'ff_arena', name: 'Test Arena', icon: '⚔️', areaId: 'ascent_f0_area', desc: '',
    activities: [],
    encounters: rat,
    connections: [],
  },
  ff_beyond: {
    id: 'ff_beyond', name: 'Test Beyond', icon: '🌫️', areaId: 'ascent_f0_area', desc: '',
    activities: [],
    connections: [],
  },
};

let unmount = () => {};
beforeAll(() => {
  unmount = mountSpots(ARENA);
});
afterAll(() => unmount());

/** A game standing at `spot` with the whole pocket world on the map. */
function arenaGame(seed: number, spot: string): Kernel {
  const g = makeGame({ seed });
  patchWorld(g, (w) => {
    w.spot = spot;
    w.discovered.push(...Object.keys(ARENA));
    w.safeSpots = { nearest: 'ff_camp', unconditional: 'ff_camp' };
  });
  return g;
}

/** Walk one declared road and tick until the travel resolves. */
function walkTo(g: Kernel, to: string): void {
  expect(hop(g, to), `travel to ${to} should start`).toBe(true);
  for (let i = 0; i < 200 && worldOf(g).travel; i++) g.tick();
}

/** Arrive at a forced site: what the world does when a journey ends on one. */
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
  it('arriving at a forced spot starts a fight that was never asked for: the walk', () => {
    const g = arenaGame(1, 'ff_gate');
    walkTo(g, 'ff_den');
    expect(worldOf(g).spot).toBe('ff_den');
    expect(worldOf(g).activity).toBeNull(); // nothing was selected...
    expect(combatOf(g).hunting).toBe(false);
    expect(combatOf(g).fight?.forced).toBe(true); // ...and the fight is on anyway
    expect(logOf(g)).toContain(TEXT.ambushed);
  });

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
  it('a forced EDGE ambushes too, and the road back out does not: the edge and its mirror', () => {
    // The mirror of the forced road is an ordinary road.
    expect(edgesFrom('ff_gate').find((e) => e.to === 'ff_arena')?.forced).toBe(true);
    expect(edgesFrom('ff_arena').find((e) => e.to === 'ff_gate')?.forced).toBeUndefined();

    const g = arenaGame(2, 'ff_gate');
    walkTo(g, 'ff_arena');
    expect(worldOf(g).spot).toBe('ff_arena');
    expect(combatOf(g).fight?.forced).toBe(true);

    // Win it, then walk home. The fight is scaffolding for the road, so it
    // must not be decided by a die: give this character a body that settles it.
    patch(g, (slices) => {
      (slices.attributes as AttributesState).attrs.con = { level: 8, xp: 0 };
      (slices.resources as ResourcesState).values.hp = 999; // clamped to the new max on the next tick
    });
    for (let i = 0; i < 3000 && combatOf(g).fight; i++) g.tick();
    expect(combatOf(g).lastFight?.outcome).toBe('won');
    walkTo(g, 'ff_gate');
    expect(worldOf(g).spot).toBe('ff_gate');
    expect(combatOf(g).fight).toBeNull();
  });

  it('every door out is refused while the fight is live', () => {
    const g = arrive(3, den);
    expect(g.dispatch(stopHunt())).toEqual({ ok: false, reason: 'the fight cannot be left' });
    expect(g.dispatch(hunt({ site: arena }))).toEqual({ ok: false, reason: 'the fight cannot be left' });
    expect(combatOf(g).hunting).toBe(false);
    expect(combatOf(g).site?.id).toBe('ff_den');
    expect(combatOf(g).fight?.forced).toBe(true);
  });
  it('every door out is refused while the fight is live: travel, the plan, fast travel', () => {
    const g = arenaGame(3, 'ff_gate');
    patch(g, (slices) => {
      (slices.gold as GoldState).gold = 5000;
    });
    walkTo(g, 'ff_den');
    expect(combatOf(g).fight?.forced).toBe(true);

    expect(hop(g, 'ff_gate')).toBe(false);
    expect(g.dispatch(travelTo({ to: 'ff_camp' }))).toEqual({ ok: false, reason: 'the fight cannot be left' });
    expect(sent(g, fastTravel({ to: 'ff_camp' }))).toBe(false); // den and camp are both waypoints
    expect(g.dispatch(selectActivity({ activity: 'hunt' }))).toEqual({ ok: false, reason: 'the fight cannot be left' });
    expect(worldOf(g).activity).toBeNull();
    expect(slice<GoldState>(g, 'gold').gold).toBe(5000); // the caravan refusal cost nothing
    expect(worldOf(g).spot).toBe('ff_den');
    expect(worldOf(g).travel).toBeNull();
    expect(combatOf(g).fight?.forced).toBe(true);
  });

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
  it('losing throws you to the haven instead of leaving you in the den: the retreat and recovery', () => {
    const g = arenaGame(5, 'ff_gate');
    // Repopulate the den with something a new character cannot survive.
    ARENA.ff_den.encounters = [{ monsterId: 'wolf', weight: 100, level: [35, 40] }];
    try {
      walkTo(g, 'ff_den');
      expect(combatOf(g).fight?.forced).toBe(true);
      // The den offers a rest, but an ambushed arrival is not a peaceful
      // visit: it must not have been recorded as the nearest haven.
      expect(worldOf(g).safeSpots.nearest).toBe('ff_camp');
      for (let i = 0; i < 5000 && combatOf(g).fight; i++) g.tick();
      expect(combatOf(g).lastFight?.outcome).toBe('knocked_out');
      expect(worldOf(g).spot).toBe('ff_camp'); // the retreat, not a recovery in place
      expect(worldOf(g).recovering).toBe(true);
      expect(combatOf(g).fight).toBeNull();
    } finally {
      ARENA.ff_den.encounters = rat;
    }
  });

  it('the pathfinder walks around a forced spot, but will end a journey on one', () => {
    const g = arenaGame(6, 'ff_camp');
    const path = (to: string) => findPath(reads(g), worldOf(g), 'ff_camp', to);
    // ff_beyond is only reachable through the den: no route may be offered.
    expect(path('ff_beyond')).toBeNull();
    // The den itself is a legal destination: clicking it is the choice.
    expect(path('ff_den')).toEqual(['ff_gate', 'ff_den']);
    // The arena sits behind a forced road: the same rule, as a destination only.
    expect(path('ff_arena')).toEqual(['ff_gate', 'ff_arena']);
  });

  // New here: the refusals of the request.
  it('does not start on an empty table or over an open fight', () => {
    const g = makeGame({ seed: 6 });
    expect(ask(g, startForced, { site: { ...den, encounters: [] } })).toBe(false);
    expect(ask(g, startForced, { site: den })).toBe(true);
    expect(ask(g, startForced, { site: arena })).toBe(false);
    expect(combatOf(g).site?.id).toBe('ff_den');
  });
});
