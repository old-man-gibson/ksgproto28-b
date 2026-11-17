/**
 * Port of the old `tests/finds.test.ts`: exploration finds and gated
 * exploration.
 *
 * The old file stood on the shelved countryside. The same structures here:
 *
 * - `f4_woods_edge` (240 ticks): `f4_edge_herbs` at 0.25 (4 graded herbs),
 *   `f4_edge_berries` at 0.6, `f4_edge_purse` at 1 (30 to 60 gold).
 * - `f5_hollows`: three finds, for the backfill order.
 * - `f4_ravine_rim` (240 ticks): `f4_rim_camp` at 0.75 marks
 *   `f4_ravine_floor`.
 *
 * No spot in scope has a `path` find, a hidden road or a find that pays a
 * rune. Those cases stand on test spots copied from the old `deep_woods` and
 * `ravine_floor`, mounted for this file:
 *
 *   tf_square, tf_woods (80), tf_deep (100), the chute to tf_floor (40, hidden, one-way)
 *   tf_square, tf_rim (150), tf_floor (250)
 *
 * The second half of the old save case (a version 30 save migrates with
 * nothing claimed) has no counterpart: the save starts at version 1 here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import type { GoldState } from '../src/systems/gold';
import type { ItemsState } from '../src/systems/items';
import type { LogState } from '../src/systems/log';
import { heldOf, type MaterialsState } from '../src/systems/materials';
import type { SkillsState } from '../src/systems/skills';
import {
  blockingGate,
  claimedFinds,
  exploreProgress,
  findPath,
  pendingFinds,
  selectActivity,
  SPOTS,
  visibleEdges,
  type SpotDef,
} from '../src/systems/world';
import { makeGame, patch, reads, slice } from './helpers';
import { discover, gameAt, mountSpots, patchWorld, worldOf } from './worldHelpers';

const explore = { id: 'explore', kind: 'explore' as const, name: 'Explore', icon: '🧭' };

const POCKET: Record<string, SpotDef> = {
  tf_square: {
    id: 'tf_square', name: 'Test Square', icon: '⛲', areaId: 'ascent_f0_area', desc: '',
    activities: [],
    connections: [
      { to: 'tf_woods', ticks: 80 },
      { to: 'tf_rim', ticks: 150, label: 'Old Road' },
    ],
  },
  tf_woods: {
    id: 'tf_woods', name: 'Test Woods', icon: '🌳', areaId: 'ascent_f0_area', desc: '',
    activities: [],
    connections: [{ to: 'tf_deep', ticks: 100 }],
  },
  tf_deep: {
    id: 'tf_deep', name: 'Test Deep Woods', icon: '🌲', areaId: 'ascent_f0_area', desc: '',
    activities: [explore],
    exploreTicks: 200,
    finds: [{ id: 'mossy_chute', at: 0.55, desc: 'The moss gives under your boot.', path: 'tf_floor' }],
    connections: [{ to: 'tf_floor', ticks: 40, oneWay: true, hidden: true, label: 'Slide down the mossy chute' }],
  },
  tf_rim: {
    id: 'tf_rim', name: 'Test Rim', icon: '🪨', areaId: 'ascent_f0_area', desc: '',
    activities: [],
    connections: [{ to: 'tf_floor', ticks: 250, label: 'Steep Descent', returnLabel: 'Steep Climb' }],
  },
  tf_floor: {
    id: 'tf_floor', name: 'Test Ravine Floor', icon: '🕳️', areaId: 'ascent_f0_area', desc: '',
    activities: [explore],
    exploreTicks: 250,
    finds: [
      { id: 'salt_seam', at: 0.2, desc: 'A seam of rock salt.', material: { id: 'rock_salt', qty: 3 } },
      { id: 'web_cache', at: 0.5, desc: 'Something wrapped in the webs.', gold: { min: 30, max: 70 } },
      { id: 'carved_stone', at: 0.9, desc: 'A carved slab.', rune: 'earthbind_rune', skillXp: { tags: ['runecarving'], xp: 60 } },
    ],
    connections: [],
  },
};

let unmount = () => {};
beforeAll(() => {
  unmount = mountSpots(POCKET);
});
afterAll(() => unmount());

/** Park the player at a spot with it discovered, ready to explore. */
const at = (seed: number, spot: string): Kernel => gameAt(seed, spot);

/** Explore for n ticks (the activity id is 'explore' at every spot used here). */
function exploreFor(g: Kernel, ticks: number): void {
  g.dispatch(selectActivity({ activity: 'explore' }));
  for (let i = 0; i < ticks; i++) g.tick();
}

function setExplored(g: Kernel, spot: string, ticks: number): void {
  patchWorld(g, (w) => {
    w.explored[spot] = ticks;
  });
}

describe('exploration finds', () => {
  it('fires at its share of exploreTicks, not before', () => {
    const g = at(1, 'f4_woods_edge');
    const spot = SPOTS.f4_woods_edge;
    // f4_edge_herbs sits at 0.25 of 240 ticks = 60.
    exploreFor(g, 55);
    expect(claimedFinds(worldOf(g), 'f4_woods_edge')).toEqual([]);
    exploreFor(g, 10);
    expect(claimedFinds(worldOf(g), 'f4_woods_edge')).toContain('f4_edge_herbs');
    expect(exploreProgress(worldOf(g), spot)).toBeGreaterThanOrEqual(0.25);
  });

  it('pays its payload once and only once', () => {
    const g = at(2, 'f4_woods_edge');
    exploreFor(g, 70);
    // common_herb is graded, so it lands in stock as rolled quality tiers.
    const herbs = () => heldOf(slice<MaterialsState>(g, 'materials'), 'common_herb');
    expect(herbs()).toBe(4);
    // Keep exploring past the threshold: it must not pay again.
    exploreFor(g, 40);
    expect(herbs()).toBe(4);
    expect(claimedFinds(worldOf(g), 'f4_woods_edge').filter((id) => id === 'f4_edge_herbs')).toHaveLength(1);
  });

  it('hands over at most one find per tick', () => {
    const g = at(3, 'f4_woods_edge');
    // Jump straight to fully explored, as a save that predates the content would.
    setExplored(g, 'f4_woods_edge', 999);
    expect(pendingFinds(reads(g), worldOf(g), SPOTS.f4_woods_edge)).toHaveLength(3);

    exploreFor(g, 1);
    expect(claimedFinds(worldOf(g), 'f4_woods_edge')).toHaveLength(1);
    exploreFor(g, 1);
    expect(claimedFinds(worldOf(g), 'f4_woods_edge')).toHaveLength(2);
    exploreFor(g, 1);
    expect(claimedFinds(worldOf(g), 'f4_woods_edge')).toHaveLength(3);
  });

  it('backfills shallowest-first', () => {
    const g = at(4, 'f5_hollows');
    setExplored(g, 'f5_hollows', 999);
    exploreFor(g, 3);
    expect(claimedFinds(worldOf(g), 'f5_hollows')).toEqual(['f5_hollows_ore', 'f5_hollows_door', 'f5_hollows_scrap']);
  });

  it('a path find opens a hidden connection before the spot is fully explored', () => {
    const g = at(5, 'tf_deep');
    const roads = (from: string) => visibleEdges(reads(g), worldOf(g), from).map((e) => e.to);
    // 0.55 of 200 = 110 ticks, short of the 200 a full search needs.
    expect(roads('tf_deep')).not.toContain('tf_floor');

    exploreFor(g, 115);
    expect(exploreProgress(worldOf(g), SPOTS.tf_deep)).toBeLessThan(1);
    expect(claimedFinds(worldOf(g), 'tf_deep')).toContain('mossy_chute');
    expect(roads('tf_deep')).toContain('tf_floor');

    // And it is still one-way: the chute does not work in reverse.
    expect(roads('tf_floor')).not.toContain('tf_deep');
  });

  it('a found path is usable for routing, not just visible', () => {
    const g = at(6, 'tf_deep');
    discover(g, 'tf_square', 'tf_woods', 'tf_deep', 'tf_rim', 'tf_floor');
    exploreFor(g, 115);
    // square, woods (80), deep (100), chute (40) = 220 beats the rim road (400).
    expect(findPath(reads(g), worldOf(g), 'tf_square', 'tf_floor')).toEqual(['tf_woods', 'tf_deep', 'tf_floor']);
  });

  it('a spot find puts somewhere else on the map without walking there', () => {
    const g = at(7, 'f4_ravine_rim');
    expect(worldOf(g).discovered).not.toContain('f4_ravine_floor');
    // f4_rim_camp sits at 0.75 of 240 = 180 ticks.
    exploreFor(g, 185);
    expect(claimedFinds(worldOf(g), 'f4_ravine_rim')).toContain('f4_rim_camp');
    expect(worldOf(g).discovered).toContain('f4_ravine_floor');
    expect(worldOf(g).spot).toBe('f4_ravine_rim'); // discovered, not travelled to
  });

  it('a find that grants skill XP can manifest the skill', () => {
    const g = at(8, 'tf_floor');
    expect(slice<SkillsState>(g, 'skills').skills.runecarving).toBeUndefined();
    setExplored(g, 'tf_floor', 999);
    exploreFor(g, 3); // salt_seam, web_cache, carved_stone
    expect(slice<ItemsState>(g, 'items').runes.earthbind_rune).toBe(1);
    expect(slice<SkillsState>(g, 'skills').skills.runecarving).toBeDefined();
  });

  it('gold finds roll inside their declared band', () => {
    for (let seed = 20; seed < 30; seed++) {
      const g = at(seed, 'f4_woods_edge');
      setExplored(g, 'f4_woods_edge', 999);
      exploreFor(g, 3);
      // The old case read `state.gold`. An explore tick also rolls the
      // occasional find (0.8% a tick, 1 to 7 gold), which one of these seeds
      // hits, so the purse is read from its own log line.
      const line = slice<LogState>(g, 'log').log.find((entry) => entry.group === 'find:f4_woods_edge:f4_edge_purse');
      const purse = line?.tally?.find((t) => t.label === 'gold')?.qty ?? -1;
      expect(purse).toBeGreaterThanOrEqual(30);
      expect(purse).toBeLessThanOrEqual(60);
      const gold = slice<GoldState>(g, 'gold').gold;
      expect(gold).toBeGreaterThanOrEqual(purse);
      expect(gold).toBeLessThanOrEqual(purse + 3 * 7);
    }
  });

  it('survives a save round trip, and v30 saves migrate with nothing claimed', () => {
    const g = at(9, 'f4_woods_edge');
    exploreFor(g, 70);
    const restored = makeGame({ seed: 99 });
    expect(restored.load(JSON.parse(JSON.stringify(g.save(0)))).ok).toBe(true);
    expect(worldOf(restored).finds.f4_woods_edge).toContain('f4_edge_herbs');
    // The old second half read a version 30 save. The save starts at version 1
    // here: a new slice has nothing claimed.
    expect(worldOf(makeGame({ seed: 10 })).finds).toEqual({});
  });
});

describe('gated exploration', () => {
  /**
   * Depth of search says when something could be found; conditions say whether
   * the character is equipped to. Both are reads over a spot record, so they
   * are called directly and the spot is not mounted.
   */
  const gatedSpot: SpotDef = {
    id: 'test_cave',
    name: 'Test Cave',
    icon: '🕳️',
    areaId: 'ascent_f0_area',
    desc: '',
    activities: [explore],
    exploreTicks: 100,
    finds: [
      { id: 'open', at: 0.2, desc: 'lying in plain sight' },
      { id: 'sealed', at: 0.2, desc: 'behind a locked door', requires: [{ type: 'skill', id: 'scouting', level: 5 }] },
    ],
    exploreGates: [{ at: 0.5, requires: [{ type: 'attr', attr: 'str', level: 20 }], desc: 'The rubble will not shift.' }],
    connections: [],
  };

  it('a find you are not equipped for waits instead of being skipped', () => {
    const g = makeGame({ seed: 40 });
    setExplored(g, 'test_cave', 50);

    expect(pendingFinds(reads(g), worldOf(g), gatedSpot).map((f) => f.id)).toEqual(['open']);

    // Meeting the condition later reveals it: nothing was consumed meanwhile.
    patch(g, (slices) => {
      (slices.skills as SkillsState).skills.scouting = { level: 5, xp: 0 };
    });
    expect(pendingFinds(reads(g), worldOf(g), gatedSpot).map((f) => f.id)).toEqual(['open', 'sealed']);
  });

  it('a gate blocks at its depth until its conditions hold', () => {
    const g = makeGame({ seed: 41 });

    setExplored(g, 'test_cave', 40); // short of the gate
    expect(blockingGate(reads(g), worldOf(g), gatedSpot)).toBeNull();

    setExplored(g, 'test_cave', 50); // at it, unprepared
    expect(blockingGate(reads(g), worldOf(g), gatedSpot)?.desc).toBe('The rubble will not shift.');

    patch(g, (slices) => {
      (slices.attributes as AttributesState).attrs.str.level = 20;
    });
    expect(blockingGate(reads(g), worldOf(g), gatedSpot)).toBeNull();
  });

  it('the search stops dead at a gate rather than crawling past it', () => {
    const g = at(42, 'f4_woods_edge'); // a real spot, so the activity exists
    setExplored(g, 'f4_woods_edge', 0);

    // f4_woods_edge has no gates: exploring advances normally.
    g.dispatch(selectActivity({ activity: 'explore' }));
    for (let i = 0; i < 10; i++) g.tick();
    expect(worldOf(g).explored.f4_woods_edge).toBe(10);
  });

  it('a spot with no gates behaves exactly as before', () => {
    const g = makeGame({ seed: 43 });
    const plain: SpotDef = { ...gatedSpot, exploreGates: undefined, finds: [{ id: 'x', at: 0.1, desc: 'x' }] };
    setExplored(g, 'test_cave', 100);
    expect(blockingGate(reads(g), worldOf(g), plain)).toBeNull();
    expect(pendingFinds(reads(g), worldOf(g), plain).map((f) => f.id)).toEqual(['x']);
  });
});
