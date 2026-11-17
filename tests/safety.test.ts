/**
 * Port of the old `tests/safety.test.ts`: where a fight that cannot be fled
 * throws the character. The invariant under test is that it always lands
 * somewhere: a haven gated on gear is no haven on the day the gear is gone,
 * which is why two slots are tracked.
 *
 * Call shape changes:
 * - `noteSafeSpot` is not exported: a haven is recorded by a peaceful
 *   arrival. The cases that called it walk or climb to the spot.
 * - `retreatSpot(state)` is `retreatSpot(reads, worldSlice)`.
 * - `retreatToSafety(state, bus, reason)` is the request `world/retreat`.
 * - The old cases stood on the shelved countryside (`deep_woods`,
 *   `village_square`). Here they stand on floor 4: the Deep Woods and the
 *   Treeline camp.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { setCounter } from '../src/systems/counters';
import { FLOORS } from '../src/systems/ladder';
import {
  ADJACENCY,
  SPOTS,
  STARTING_SPOT,
  buildAdjacency,
  canRestAt,
  climb,
  isUnconditionalHaven,
  retreat,
  retreatSpot,
  travelTo,
  type SpotDef,
  type WorldState,
} from '../src/systems/world';
import { ask, emit, makeGame, patch, reads, slice } from './helpers';

/** Band 1 of the Ascent, bottom to top. */
const BAND_ONE = ['ascent_f1', 'ascent_f2', 'ascent_f3'];

const world = (g: Kernel): WorldState => slice<WorldState>(g, 'world');
const patchWorld = (g: Kernel, change: (w: WorldState) => void) => patch(g, (s) => change(s.world as WorldState));

describe('safe spots', () => {
  const openCamp: SpotDef = {
    id: 'open_camp', name: 'Open Camp', icon: '🏕️', areaId: 'ascent_f4_area', desc: '',
    activities: [{ id: 'rest', kind: 'rest', name: 'Camp', icon: '🏕️' }],
    connections: [{ to: 'gated_camp', ticks: 5 }],
  };
  const gatedCamp: SpotDef = {
    id: 'gated_camp', name: 'Sheltered Cave', icon: '🕳️', areaId: 'ascent_f4_area', desc: '',
    activities: [
      { id: 'rest', kind: 'rest', name: 'Shelter', icon: '🔥', requires: [{ type: 'equippedTag', tag: 'lantern' }] },
    ],
    connections: [],
  };
  /** Where the walk to the two camps starts: a spot with no rest. */
  const road: SpotDef = {
    id: 'camp_road', name: 'Camp Road', icon: '🛤️', areaId: 'ascent_f4_area', desc: '',
    activities: [],
    connections: [{ to: 'open_camp', ticks: 5 }],
  };
  const CAMPS: Record<string, SpotDef> = { camp_road: road, open_camp: openCamp, gated_camp: gatedCamp };

  beforeAll(() => {
    Object.assign(SPOTS, CAMPS);
    for (const [id, edges] of buildAdjacency(Object.values(CAMPS))) ADJACENCY.set(id, edges);
  });
  afterAll(() => {
    for (const id of Object.keys(CAMPS)) {
      delete SPOTS[id];
      ADJACENCY.delete(id);
    }
  });

  /** Walk to an adjacent spot and wait for the arrival. */
  function walk(g: Kernel, to: string): void {
    expect(g.dispatch(travelTo({ to }))).toEqual({ ok: true });
    for (let i = 0; i < 200 && world(g).travel; i++) g.tick();
    expect(world(g).spot).toBe(to);
  }

  it('tells a haven anyone may use from one that asks something', () => {
    const g = makeGame({ seed: 1 });
    expect(isUnconditionalHaven(openCamp)).toBe(true);
    expect(isUnconditionalHaven(gatedCamp)).toBe(false);
    expect(canRestAt(reads(g), openCamp)).toBe(true);
    expect(canRestAt(reads(g), gatedCamp)).toBe(false); // no lantern
  });

  it('records both slots, and the conditional one only when usable', () => {
    const g = makeGame({ seed: 2 });
    patchWorld(g, (w) => {
      w.spot = 'camp_road';
      w.discovered.push(...Object.keys(CAMPS));
    });
    walk(g, 'open_camp');
    expect(world(g).safeSpots).toEqual({ nearest: 'open_camp', unconditional: 'open_camp' });

    // Walking past a shelter the character cannot use changes nothing.
    walk(g, 'gated_camp');
    expect(world(g).safeSpots.nearest).toBe('open_camp');
    expect(world(g).safeSpots.unconditional).toBe('open_camp');
  });

  it('falls back when the nearest haven has closed behind you', () => {
    const g = makeGame({ seed: 3 });
    patchWorld(g, (w) => (w.safeSpots = { nearest: 'gated_camp', unconditional: 'open_camp' }));
    // The lantern is gone, so the shelter is shut: the open camp catches it.
    expect(retreatSpot(reads(g), world(g))).toBe('open_camp');
  });

  it('always lands somewhere, even with nothing recorded — and that somewhere is the start, not data order', () => {
    const g = makeGame({ seed: 4 });
    expect(world(g).safeSpots).toEqual({ nearest: null, unconditional: null });
    const to = retreatSpot(reads(g), world(g));
    expect(SPOTS[to], 'retreat must name a real spot').toBeDefined();
    expect(isUnconditionalHaven(SPOTS[to])).toBe(true);
    expect(to).toBe(STARTING_SPOT);
  });

  it('every tower landing is a camp, so a fall on a floor lands on that floor', () => {
    for (const [i, id] of BAND_ONE.entries()) {
      const landing = FLOORS[id].landing!;
      const g = makeGame({ seed: 6 });
      expect(isUnconditionalHaven(SPOTS[landing]), `${landing} has no camp`).toBe(true);
      // The arrival records the haven: open the floor and climb to its landing.
      for (const below of BAND_ONE.slice(0, i)) {
        for (const c of FLOORS[below].clear ?? []) if (c.type === 'stat') emit(g, setCounter, { key: c.key, value: c.value });
      }
      emit(g, setCounter, { key: 'gold:earned', value: 100_000 });
      patchWorld(g, (w) => {
        w.spot = 'ascent_foot';
        w.discovered.push('ascent_foot');
      });
      expect(g.dispatch(climb({ floor: id }))).toEqual({ ok: true });
      for (let t = 0; t < 2000 && world(g).travel; t++) g.tick();
      expect(world(g).spot).toBe(landing);
      expect(retreatSpot(reads(g), world(g))).toBe(landing);
    }
  });

  it('retreating moves you, clears what you were doing, and marks the spot known', () => {
    const g = makeGame({ seed: 5 });
    patchWorld(g, (w) => {
      w.spot = 'f4_deep_woods';
      w.activity = 'explore';
      w.safeSpots = { nearest: 'f4_treeline', unconditional: 'f4_treeline' };
    });

    const from = ask(g, retreat, { reason: 'The pack drags you down.', knockedOut: false });
    expect(from).toBe('f4_deep_woods');
    expect(world(g).spot).toBe('f4_treeline');
    expect(world(g).activity).toBeNull();
    expect(world(g).discovered).toContain('f4_treeline');
  });

  it.todo('a v37 save standing in an inn wakes up remembering it (no port: the save starts at version 1 here, so no step fills `safeSpots` from the spot of an older save)');

  it.todo('a v37 save standing somewhere wild starts with nothing recorded (no port: the save starts at version 1 here, so no step fills `safeSpots` from the spot of an older save)');
});
