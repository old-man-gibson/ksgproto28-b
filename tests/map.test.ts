/**
 * Port of the old `tests/map.test.ts`.
 *
 * The old file tested the map library of the UI (`ui/lib/map.ts`,
 * `ui/lib/mapPlan.ts`): the nodes of a region, the frame, the label placer and
 * the drawn plan. That library is not ported; SPINE.md section 7.7 leaves the
 * surveyed plan to the UI step. Those cases are `it.todo`.
 *
 * Ported: the first case, whose rule is in the world system (the ride down,
 * the roads of the Foot, a mapped region). Where the old case read
 * `mapNodes(state, 'threshold')` it reads the map of the published view. And
 * the count of maps, on the registries, with the numbers of the content in
 * scope (the old numbers were 23 maps, 20 of them floors of the Ascent).
 */
import { describe, expect, it } from 'vitest';
import { FLOOR_BY_AREA } from '../src/systems/ladder';
import world, { AREAS, climb, REGIONS, SPOTS, visibleEdges, type WorldView } from '../src/systems/world';
import { reads } from './helpers';
import { discover, gameAt, sent, setCounters, worldOf } from './worldHelpers';

describe('region map after tower travel', () => {
  it('shows Threshold districts after descending from the cleared first floor', () => {
    const k = gameAt(1, 'f1_toll_hall');
    setCounters(k, { 'boss:f1_toll_hall': 1 });
    discover(k, 'ascent_foot', 'lectory_steps');
    expect(sent(k, climb({ floor: null }))).toBe(true);
    for (let i = 0; i < 1000 && worldOf(k).travel; i++) k.tick();
    expect(worldOf(k).spot).toBe('ascent_foot');

    const map = (k.view().systems[world.id] as WorldView).map;
    expect(map.region).toBe(REGIONS.threshold.name);
    const nodes = map.areas.flatMap((area) => area.spots);
    expect(nodes.find((n) => n.id === 'lectory_steps')?.known).toBe(true);
    const districtDoors = visibleEdges(reads(k), worldOf(k), 'ascent_foot').filter((e) => AREAS[SPOTS[e.to].areaId].regionId === 'threshold');
    expect(districtDoors).toHaveLength(8);
    for (const door of districtDoors) expect(nodes.some((n) => n.id === door.to)).toBe(true);
    // Threshold is mapped (`RegionDef.mapped`): standing in it puts all of it on the map.
    expect(nodes.every((n) => n.known)).toBe(true);
    expect(nodes).toHaveLength(Object.values(SPOTS).filter((s) => AREAS[s.areaId].regionId === 'threshold').length);
  });

  it.todo('keeps other tower floors off the current floor map (UI step: the surveyed plan)');
  it.todo('draws the floor a tab picks instead of the one underfoot (UI step: the surveyed plan)');
  it.todo('allows browsing Threshold from inside the tower (UI step: the surveyed plan)');
});

describe('map labels', () => {
  it.todo('places every Threshold name clear of the pins and names, inside the frame, at the 818 px column (UI step: the surveyed plan)');
  it.todo('keeps Threshold pins from touching each other at the column widths the layout gives (UI step: the surveyed plan)');
  it.todo('keeps a name under its pin when nothing is in the way (UI step: the surveyed plan)');
  it.todo('moves a name off the chips standing above its pin (UI step: the surveyed plan)');
});

describe('names at the widths the layout gives', () => {
  /** Every region, and every floor of a tower, as a diagram. */
  const MAPS: { name: string; region: string; area: string | null; spot: string }[] = [];
  for (const region of Object.values(REGIONS)) {
    const areas = Object.values(AREAS).filter((a) => a.regionId === region.id);
    const floors = areas.filter((a) => FLOOR_BY_AREA.has(a.id));
    for (const area of floors.length ? floors : [null]) {
      const spot = Object.values(SPOTS).find((s) => s.map && AREAS[s.areaId].regionId === region.id && (!area || s.areaId === area.id));
      if (spot) MAPS.push({ name: area?.id ?? region.id, region: region.id, area: area?.id ?? null, spot: spot.id });
    }
  }

  it('covers every region and every floor', () => {
    // In scope: Threshold, floor 0 (the Holding Level), floors 1 to 6,
    // since step 4 port C1 floors 7 to 10 (the castle is not a floor), and
    // since port C2 floor 11 and the hold.
    expect(MAPS.length).toBe(14);
    expect(MAPS.some((m) => m.region === 'threshold')).toBe(true);
    expect(MAPS.some((m) => m.region === 'the_hold')).toBe(true);
    expect(MAPS.filter((m) => m.region === 'the_ascent').length).toBe(11);
  });

  it.todo('touch nothing: no name on another name, a pin or a chip, and none outside the frame (UI step: the surveyed plan)');
  it.todo('holds Threshold to zero at the four widths the browser measured (UI step: the surveyed plan)');
});

describe('map frames', () => {
  it.todo('stretches a diagram at most 8.1 px per unit across and 5.6 down, and centres it (UI step: the surveyed plan)');
  it.todo('fits a tall spread inside the frame (UI step: the surveyed plan)');
  it.todo('keeps a tiled picture at its own proportions on one scale (UI step: the surveyed plan)');
});
