/**
 * Region exits on the map (`view.map.exits`). The old map drew a visible road
 * from a known spot into another region as a "→ {region}" label that walks on
 * click (`src/ui/lib/mapPlan.ts` exitList, `src/ui/MapPlan.svelte`). The
 * rebuild lists the same roads in the world view; the Location panel draws
 * them as buttons that send `world/travel`.
 */
import { describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import { AREAS, edgesFrom, REGIONS, SPOTS, travelTo, type WorldView } from '../src/systems/world';
import { makeGame } from './helpers';
import { discover, gameAt, worldOf } from './worldHelpers';

const exitsOf = (g: Kernel) => (g.view().systems.world as WorldView).map.exits;

const regionOf = (spot: string) => AREAS[SPOTS[spot].areaId].regionId;

describe('region exits on the map', () => {
  it('a game at the Gate lists the road into Threshold, and its action reaches the Foot', () => {
    const g = gameAt(1, 'f0_gate');
    const exits = exitsOf(g);
    expect(exits).toEqual([{ from: 'f0_gate', fromName: SPOTS.f0_gate.name, to: 'ascent_foot', region: REGIONS.threshold.name }]);
    // The exit is not a spot of the floor 0 map.
    const areas = (g.view().systems.world as WorldView).map.areas;
    expect(areas.flatMap((a) => a.spots.map((s) => s.id))).not.toContain('ascent_foot');

    expect(g.dispatch(travelTo({ to: exits[0].to })).ok).toBe(true);
    for (let i = 0; i < 2000 && worldOf(g).spot !== 'ascent_foot'; i++) g.tick();
    expect(worldOf(g).spot).toBe('ascent_foot');
    expect(worldOf(g).travel).toBeNull();
  });

  it('a fresh game lists no exit until the Gate is discovered', () => {
    const g = makeGame({ seed: 1 });
    expect(worldOf(g).discovered).not.toContain('f0_gate');
    expect(exitsOf(g)).toEqual([]);
  });

  it('the exit shows from anywhere on the region once the Gate is known, and walks the whole route', () => {
    const g = makeGame({ seed: 2 });
    discover(g, 'f0_cellblock', 'f0_field', 'f0_gate');
    expect(exitsOf(g).map((e) => e.to)).toEqual(['ascent_foot']);
    expect(worldOf(g).spot).toBe('f0_cell');
    expect(g.dispatch(travelTo({ to: 'ascent_foot' })).ok).toBe(true);
    for (let i = 0; i < 5000 && worldOf(g).spot !== 'ascent_foot'; i++) g.tick();
    expect(worldOf(g).spot).toBe('ascent_foot');
  });

  it('the road is one-way: the Foot lists no exit back to floor 0', () => {
    const g = gameAt(1, 'ascent_foot');
    discover(g, 'f0_gate');
    expect(exitsOf(g)).toEqual([]);
  });

  it('every exit listed is a visible road out of the current region, and every such road from a known spot is listed', () => {
    // Every cross-region road in the content, each from a game that stands at its source.
    const roads = Object.values(SPOTS).flatMap((s) =>
      edgesFrom(s.id)
        .filter((e) => regionOf(e.to) !== regionOf(s.id))
        .map((e) => ({ from: s.id, to: e.to, hidden: !!e.hidden || !!e.revealWhen?.length })),
    );
    expect(roads.length).toBeGreaterThan(0);
    for (const road of roads) {
      const g = gameAt(1, road.from);
      const listed = exitsOf(g).filter((e) => e.from === road.from && e.to === road.to);
      if (!road.hidden) expect(listed, `${road.from} -> ${road.to}`).toHaveLength(1);
      for (const e of exitsOf(g)) expect(regionOf(e.to)).not.toBe(regionOf(road.from));
    }
  });
});
