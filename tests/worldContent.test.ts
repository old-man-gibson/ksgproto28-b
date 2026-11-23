/**
 * The location, tower and floor lints of the old `tests/content.test.ts`
 * ("world graph", "towers, bands & floors", the activity drops, the region
 * skies, the band 3 wards), under their old names, on the registries here: 4
 * regions, 28 areas, 159 spots, 1 tower, 5 bands, 17 floors (step 4 port C1
 * added band 3, the City; port C2 floor 11's stronghold, band 4 and the
 * hold; port C3 the harbor, floors 11 to 14, and the sea lint; port C4 the
 * festival's band 5, floor 15 and the festival lint, without the royale's;
 * port C5 floor 16 and the royale's lint).
 *
 * Changed: imports; a find's gold is `{ min, max }`; an activity's `attrXp` is
 * a list. The old cases stood on the shelved countryside where they named a
 * spot; those run on a fixture or on spots here, each marked. A lint on
 * content that is not here is an `it.todo` with its step.
 *
 * The kernel schema already refuses an unknown reference (area, region, spot,
 * monster, material, item, key item, rune, tower, band). The old assertions
 * are kept on the loaded records.
 */
import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_LIST } from '../src/systems/attributes';
import { RECIPES } from '../src/systems/crafting';
import type { Condition } from '../src/systems/counters';
import { ITEMS, RUNES } from '../src/systems/items';
import { BANDS, exploreIssues, FLOORS, floorStructureIssues, offLadderDoor, SPINE_EXEMPT, TOWERS, type FloorRule } from '../src/systems/ladder';
import { MATERIALS } from '../src/systems/materials';
import { MONSTERS, monsterTagsOf } from '../src/systems/monsters';
import { NPCS } from '../src/systems/npcs';
import { QUESTS } from '../src/systems/quests';
import {
  DARK_ROOM_WAVES,
  DEFAULT_ROYALE_PLAN,
  FESTIVAL_DOOR_KEY,
  FESTIVAL_SWIFT_KEY,
  festivalContentIssues,
  ROYALE_CACHES,
  ROYALE_DENS,
  ROYALE_SECTIONS,
  ROYALE_STRATEGIES,
  SURVIVOR_CHAMPION,
  SURVIVOR_SPECIES,
} from '../src/systems/festival';
import { CONVOY_LIST, CONVOYS, SEA_CRATES_OFFLINE, SEA_CRATES_WON, SEA_MISSION_DONE, SEA_SIDE_LIST, seaContentIssues } from '../src/systems/sea';
import { SKILLS } from '../src/systems/skills';
import { STAT_NAMES } from '../src/systems/stats';
import { SUPERATTR_LIST } from '../src/systems/superattrs';
import { WARD_WINDOWS, wardContentIssues, wardStatKeys } from '../src/systems/wards';
import { ELEMENT_TAGS, PLACE_TAGS, SKY_TABLES, TERRAIN_PROFILES, WEATHER_KINDS } from '../src/systems/weather';
import {
  ADJACENCY,
  AREAS,
  attrXpWeights,
  buildAdjacency,
  KEY_ITEMS,
  REGIONS,
  SPOTS,
  STARTING_SPOT,
  type ActivityFactor,
  type FindPayload,
  type SpotDef,
} from '../src/systems/world';

const VALID_ATTRS = new Set<string>(ATTRIBUTE_LIST.map((a) => a.id));

const VALID_STATS = new Set<string>(Object.keys(STAT_NAMES));

/** Every `flag:*` key a find or a search reward writes: what conditions may read. Cards that stamp a flag are step 3. */
function contentFlags(): Set<string> {
  const keys = new Set<string>();
  for (const spot of Object.values(SPOTS)) {
    for (const f of spot.finds ?? []) if (f.stat?.key.startsWith('flag:')) keys.add(f.stat.key);
    for (const act of spot.activities) {
      if (act.kind !== 'search') continue;
      for (const r of act.rewards ?? []) if (r.stat?.key.startsWith('flag:')) keys.add(r.stat.key);
    }
  }
  return keys;
}

/** The ward machinery's run counters, read once. */
let wardKeys: Set<string> | undefined;

/**
 * Counters some system here bumps. The old `statCounterValid` without the
 * keys of systems that are not ported (crafts, quests, shops, prestige,
 * weapon families, miracles, the bestiary).
 */
function statCounterValid(key: string): boolean {
  // `legacy:stronghold`: the prestige's `newRun`, once the stronghold is held.
  const staticKeys = new Set([
    'kills',
    'defeats',
    'gold:earned',
    'skill:levels',
    'legacy:stronghold',
    SEA_CRATES_WON, // sea, crates won on a water while present
    SEA_CRATES_OFFLINE, // sea, crates credited while catching up
    SEA_MISSION_DONE, // sea, the run's side killed its floor 14 mission boss
    FESTIVAL_DOOR_KEY, // festival: 1 while this attempt's dark room door is open
    FESTIVAL_SWIFT_KEY, // festival: royales won after entering early, the hidden title's
  ]);
  if (staticKeys.has(key)) return true;
  // Per-vendor tallies: `shops` bumps shop:buys:<npc> on every purchase.
  if (key.startsWith('shop:buys:')) return key.slice(10) in NPCS;
  // A quest's accept stamp (`quests` acceptQuest): real for every quest.
  const accepted = /^flag:quest:(.+):accepted$/.exec(key);
  if (accepted) return accepted[1] in QUESTS;
  // Band 3's ward machinery (wards/validation.ts): an any-order floor's
  // position, a spot's clear stamp, and a ward window's keys and flags.
  wardKeys ??= wardStatKeys(WARD_WINDOWS, { bands: BANDS, floors: FLOORS, spots: SPOTS });
  if (wardKeys.has(key)) return true;
  const COMBAT_COUNTERS = new Set(['attacks', 'crits', 'dodges', 'parries', 'hitsTaken']);
  if (key.startsWith('combat:')) return COMBAT_COUNTERS.has(key.slice(7));
  if (key.startsWith('kills:tag:')) {
    const tag = key.slice(10);
    return Object.values(MONSTERS).some((m) => monsterTagsOf(m).includes(tag));
  }
  if (key.startsWith('boss:')) return !!SPOTS[key.slice(5)]?.encounters?.some((e) => e.boss);
  // A water (`sea` CONVOYS) counts its won fights with no limit.
  if (key.startsWith('fights:')) return (SPOTS[key.slice(7)]?.fightLimit ?? 0) > 0 || key.slice(7) in CONVOYS;
  if (key.startsWith('slain:')) {
    const [, spotId, monsterId] = key.split(':');
    return !!SPOTS[spotId]?.encounters?.some((e) => e.once && e.monsterId === monsterId);
  }
  if (key.startsWith('kills:')) return key.slice(6) in MONSTERS;
  if (key.startsWith('gather:')) return key.slice(7) in MATERIALS;
  if (key.startsWith('attr:')) return VALID_ATTRS.has(key.slice(5));
  if (key.startsWith('flag:')) return contentFlags().has(key);
  return false;
}

/** Skills the factor system may reference before they are built. */
const PLANNED_SKILLS = new Set(['mining', 'hunting', 'trapmaking']);

function checkFactors(owner: string, factors: ActivityFactor[] | undefined): void {
  for (const f of factors ?? []) {
    const keys = [f.attr, f.stat, f.skill].filter((v) => v !== undefined);
    expect(keys.length, `${owner}: factor needs exactly one of attr/stat/skill`).toBe(1);
    if (f.attr !== undefined) expect(VALID_ATTRS.has(f.attr), `${owner}: factor attr ${f.attr}`).toBe(true);
    if (f.stat !== undefined) expect(VALID_STATS.has(f.stat), `${owner}: factor stat ${f.stat}`).toBe(true);
    if (f.skill !== undefined)
      expect(
        SKILLS[f.skill] !== undefined || PLANNED_SKILLS.has(f.skill),
        `${owner}: factor skill '${f.skill}' is neither a known nor a planned skill`,
      ).toBe(true);
  }
}

/** The old `checkConditions`. */
function checkConditions(owner: string, conds: Condition[] | undefined): void {
  for (const c of conds ?? []) {
    if (c.type === 'skill') expect(SKILLS[c.id], `${owner}: unlock skill ${c.id}`).toBeDefined();
    if (c.type === 'quest') expect(QUESTS[c.id], `${owner}: unlock quest ${c.id}`).toBeDefined();
    if (c.type === 'attr') expect(VALID_ATTRS.has(c.attr), `${owner}: unlock attr ${c.attr}`).toBe(true);
    if (c.type === 'stat') expect(statCounterValid(c.key), `${owner}: stat counter '${c.key}' is never bumped`).toBe(true);
  }
}

/**
 * The old `searchContentIssues` (`systems/searchValidation.ts`), which is not
 * ported as a function: the rules of a search activity and of what a find or
 * a reward hands over.
 */
function searchContentIssues(spot: SpotDef): string[] {
  const issues: string[] = [];
  const payload = (r: FindPayload, owner: string) => {
    for (const [field, reg] of [['keyItem', KEY_ITEMS], ['item', ITEMS], ['rune', RUNES]] as const) {
      if (r[field] && !(reg as Record<string, unknown>)[r[field]!]) issues.push(`${owner}: unknown ${field} '${r[field]}'`);
    }
    if (r.material && (!MATERIALS[r.material.id] || !Number.isFinite(r.material.qty ?? 1) || (r.material.qty ?? 1) <= 0)) issues.push(`${owner}: invalid material reward`);
    if (r.gold && ([r.gold.min, r.gold.max].some((n) => !Number.isInteger(n) || n < 0) || r.gold.min > r.gold.max)) issues.push(`${owner}: invalid gold range`);
    if (r.skillXp && (!r.skillXp.tags.length || !Number.isFinite(r.skillXp.xp) || r.skillXp.xp <= 0)) issues.push(`${owner}: invalid skill XP`);
    if (r.stat && !r.stat.key.startsWith('flag:') && !(r.stat.set !== undefined && /^(slain|fights):/.test(r.stat.key))) issues.push(`${owner}: invalid stat namespace`);
    if (r.stat && ((r.stat.set !== undefined && r.stat.amount !== undefined) || !Number.isFinite(r.stat.set ?? r.stat.amount ?? 1))) issues.push(`${owner}: invalid stat reward`);
  };
  for (const f of spot.finds ?? []) if (f.keyItem && !KEY_ITEMS[f.keyItem]) issues.push(`${f.id}: unknown key item '${f.keyItem}'`);
  for (const act of spot.activities) {
    if (act.kind !== 'search') continue;
    if (!Number.isFinite(act.ticksPer) || act.ticksPer! <= 0) issues.push(`${act.id}: search duration must be positive`);
    if (!act.rewards?.length) issues.push(`${act.id}: search needs a reward table`);
    const ids = new Set<string>();
    for (const r of act.rewards ?? []) {
      const owner = `${act.id}/${r.id}`;
      if (!r.id || ids.has(r.id)) issues.push(`${owner}: missing or duplicate reward id`);
      ids.add(r.id);
      if (!Number.isFinite(r.weight) || r.weight <= 0) issues.push(`${owner}: weight must be positive`);
      for (const field of ['limit', 'guaranteedBy'] as const) {
        if (r[field] !== undefined && (!Number.isInteger(r[field]) || r[field]! <= 0)) issues.push(`${owner}: ${field} must be a positive integer`);
      }
      payload(r, owner);
    }
  }
  return issues;
}

// New here: what the port holds.
describe('the registries in scope', () => {
  it('159 spots (27 in Threshold, 53 on floors 0 to 6, 16 in the City, 10 on floor 11, 20 on floors 12 to 14, 7 on floor 15, 1 on floor 16, 25 in the hold), 28 areas, 4 regions', () => {
    const inRegion = (regionId: string) => Object.values(SPOTS).filter((s) => AREAS[s.areaId]?.regionId === regionId).length;
    const cityAreas = new Set(['ascent_castle_area', ...['ascent_f7', 'ascent_f8', 'ascent_f9', 'ascent_f10'].map((id) => FLOORS[id].areaId)]);
    const inCity = Object.values(SPOTS).filter((s) => cityAreas.has(s.areaId)).length;
    const onFloor11 = Object.values(SPOTS).filter((s) => s.areaId === FLOORS.ascent_f11.areaId).length;
    const harborAreas = new Set(['ascent_f12', 'ascent_f13', 'ascent_f14'].map((id) => FLOORS[id].areaId));
    const onFloors12to14 = Object.values(SPOTS).filter((s) => harborAreas.has(s.areaId)).length;
    const onFloor15 = Object.values(SPOTS).filter((s) => s.areaId === FLOORS.ascent_f15.areaId).length;
    const onFloor16 = Object.values(SPOTS).filter((s) => s.areaId === FLOORS.ascent_f16.areaId).length;
    expect(Object.keys(SPOTS)).toHaveLength(159);
    expect(inRegion('threshold')).toBe(27);
    expect(inCity).toBe(16);
    expect(onFloor11).toBe(10);
    expect(onFloors12to14).toBe(20);
    expect(onFloor15).toBe(7);
    expect(onFloor16).toBe(1);
    expect(inRegion('the_hold')).toBe(25);
    expect(inRegion('holding_level') + inRegion('the_ascent') - inCity - onFloor11 - onFloors12to14 - onFloor15 - onFloor16).toBe(53);
    expect(Object.keys(AREAS)).toHaveLength(28);
    expect(Object.keys(REGIONS).sort()).toEqual(['holding_level', 'the_ascent', 'the_hold', 'threshold']);
  });

  it('1 tower, 5 bands, 17 floors', () => {
    expect(Object.keys(TOWERS)).toEqual(['the_ascent']);
    expect(Object.keys(BANDS)).toEqual(['ascent_lower', 'ascent_middle', 'ascent_upper', 'ascent_harbor', 'ascent_festival']);
    expect(Object.values(FLOORS).map((f) => f.index).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('the starting spot is the cell of floor 0', () => {
    expect(STARTING_SPOT).toBe('f0_cell');
    expect(SPOTS[STARTING_SPOT].areaId).toBe(FLOORS.ascent_f0.areaId);
  });

  it('the areas of floors 4 to 6 are open sky under the roofed Ascent', () => {
    expect(REGIONS.the_ascent.sheltered).toBe(true);
    for (const id of ['ascent_f4', 'ascent_f5', 'ascent_f6']) expect(AREAS[FLOORS[id].areaId].sheltered, id).toBe(false);
    for (const id of ['ascent_f1', 'ascent_f2', 'ascent_f3']) expect(AREAS[FLOORS[id].areaId].sheltered, id).toBeUndefined();
  });
});

describe('world graph', () => {
  it('every area/spot/connection resolves', () => {
    for (const area of Object.values(AREAS)) {
      expect(REGIONS[area.regionId], `${area.id} region`).toBeDefined();
    }
    for (const spot of Object.values(SPOTS)) {
      expect(AREAS[spot.areaId], `${spot.id} area`).toBeDefined();
      for (const c of spot.connections) {
        expect(SPOTS[c.to], `${spot.id} -> ${c.to}`).toBeDefined();
      }
    }
  });

  it('a region\'s terrain names a real climate profile', () => {
    for (const region of Object.values(REGIONS)) {
      if (region.terrain === undefined) continue;
      expect(TERRAIN_PROFILES[region.terrain], `${region.id} terrain '${region.terrain}'`).toBeDefined();
    }
  });

  it('place tags come from the exposure vocabulary, at every level', () => {
    for (const defs of [Object.values(REGIONS), Object.values(AREAS), Object.values(SPOTS)]) {
      for (const def of defs as { id: string; tags?: string[] }[]) {
        for (const tag of def.tags ?? []) {
          expect(
            ELEMENT_TAGS.has(tag) || PLACE_TAGS.has(tag),
            `${def.id}: tag '${tag}' is neither an element nor a place tag`,
          ).toBe(true);
        }
      }
    }
  });

  it('a return label only exists where there is a return trip to label', () => {
    for (const spot of Object.values(SPOTS)) {
      for (const c of spot.connections) {
        if (c.returnLabel === undefined) continue;
        expect(
          c.oneWay,
          `${spot.id} -> ${c.to}: returnLabel on a one-way edge, which has no mirror to wear it`,
        ).not.toBe(true);
        expect(c.label, `${spot.id} -> ${c.to}: returnLabel without an outbound label`).toBeDefined();
      }
    }
  });

  it('a forced fight always has someone to start it', () => {
    for (const spot of Object.values(SPOTS)) {
      if (spot.forced) {
        expect(spot.encounters?.length ?? 0, `${spot.id} is forced but has no encounters`).toBeGreaterThan(0);
      }
      for (const c of spot.connections) {
        if (!c.forced) continue;
        expect(
          SPOTS[c.to]?.encounters?.length ?? 0,
          `${spot.id} -> ${c.to} is forced but '${c.to}' has no encounters`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('the mirror of a forced edge is an ordinary road home', () => {
    for (const [from, edges] of ADJACENCY) {
      for (const e of edges) {
        if (!e.forced) continue;
        const declared = SPOTS[from]?.connections.some((c) => c.to === e.to && c.forced);
        expect(declared, `${from} -> ${e.to}: forced appeared on a mirrored edge`).toBe(true);
      }
    }
    // No road in scope is forced, so the rule is also shown on a fixture.
    const adj = buildAdjacency([
      { id: 'a', connections: [{ to: 'b', ticks: 5, forced: true }] },
      { id: 'b', connections: [] },
    ]);
    expect(adj.get('a')![0].forced).toBe(true);
    expect(adj.get('b')![0].forced).toBeUndefined();
  });

  it('the mirrored edge wears returnLabel, the declared one keeps its own', () => {
    // The old case read two roads of the shelved countryside. No road in scope
    // has a `returnLabel`, so the same two roads are a fixture here.
    const adj = buildAdjacency([
      { id: 'ravine_rim', connections: [{ to: 'ravine_floor', ticks: 60, label: 'Steep Descent', returnLabel: 'Steep Climb' }] },
      { id: 'ravine_floor', connections: [] },
      { id: 'village_square', connections: [{ to: 'ravine_rim', ticks: 60, label: 'Old Road' }] },
    ]);
    const down = adj.get('ravine_rim')!.find((e) => e.to === 'ravine_floor');
    const up = adj.get('ravine_floor')!.find((e) => e.to === 'ravine_rim');
    expect(down?.label).toBe('Steep Descent');
    expect(up?.label).toBe('Steep Climb');

    // A road that reads the same both ways still mirrors its single label.
    const out = adj.get('village_square')!.find((e) => e.to === 'ravine_rim');
    const back = adj.get('ravine_rim')!.find((e) => e.to === 'village_square');
    expect(out?.label).toBe('Old Road');
    expect(back?.label).toBe('Old Road');

    // The same on a road here: a gate of Threshold to the Foot.
    expect(ADJACENCY.get('ironyard_gate')!.find((e) => e.to === 'ascent_foot')?.label).toBe('the Muster Road');
    expect(ADJACENCY.get('ascent_foot')!.find((e) => e.to === 'ironyard_gate')?.label).toBe('the Muster Road');
  });

  it('bidirectional edges are mirrored; one-way edges are not', () => {
    // The old case named roads of the shelved countryside; these are roads here.
    expect(ADJACENCY.get('f2_stairhead')!.map((e) => e.to)).toContain('f2_hall_1');
    expect(ADJACENCY.get('f2_hall_1')!.map((e) => e.to)).toContain('f2_stairhead');
    // f0_gate -> ascent_foot is the one-way road out of the tutorial.
    expect(ADJACENCY.get('f0_gate')!.map((e) => e.to)).toContain('ascent_foot');
    expect(ADJACENCY.get('ascent_foot')!.map((e) => e.to)).not.toContain('f0_gate');
  });

  /**
   * The ladder is a road that owns no edges: a ride moves between a tower's
   * hub and any unlocked floor's landing directly. Both graph walks here ride
   * the same pseudo-edges, or every banded floor would read as unreachable.
   */
  const ladderEdges = (): Map<string, string[]> => {
    const extra = new Map<string, string[]>();
    const add = (from: string, to: string) => extra.set(from, [...(extra.get(from) ?? []), to]);
    for (const tower of Object.values(TOWERS)) {
      for (const floor of Object.values(FLOORS)) {
        if (floor.towerId !== tower.id || floor.bandId === undefined || !floor.landing) continue;
        add(tower.hubSpot, floor.landing);
        add(floor.landing, tower.hubSpot);
      }
      for (const band of Object.values(BANDS)) {
        if (band.towerId !== tower.id || !band.hub) continue;
        add(tower.hubSpot, band.hub);
        add(band.hub, tower.hubSpot);
      }
    }
    return extra;
  };

  it('every spot is reachable from the starting spot', () => {
    const ladder = ladderEdges();
    const seen = new Set<string>([STARTING_SPOT]);
    const queue = [STARTING_SPOT];
    while (queue.length) {
      const at = queue.pop()!;
      const next = [...(ADJACENCY.get(at) ?? []).map((e) => e.to), ...(ladder.get(at) ?? [])];
      for (const to of next) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    for (const id of Object.keys(SPOTS)) expect(seen.has(id), `${id} unreachable`).toBe(true);
  });

  it('every spot can get home — no one-way edge is a trap', () => {
    const waypoints = Object.values(SPOTS)
      .filter((s) => s.waypoint)
      .map((s) => s.id);
    expect(waypoints.length, 'no waypoints, so there is nowhere to get home to').toBeGreaterThan(0);

    const inbound = new Map<string, string[]>();
    const noteInbound = (from: string, to: string) => {
      const list = inbound.get(to);
      if (list) list.push(from);
      else inbound.set(to, [from]);
    };
    for (const [from, edges] of ADJACENCY) {
      for (const edge of edges) noteInbound(from, edge.to);
    }
    // The ladder gets everyone home too: a landing always reaches its hub.
    for (const [from, tos] of ladderEdges()) {
      for (const to of tos) noteInbound(from, to);
    }

    const canGetHome = new Set<string>(waypoints);
    const queue = [...waypoints];
    while (queue.length) {
      for (const from of inbound.get(queue.pop()!) ?? []) {
        if (!canGetHome.has(from)) {
          canGetHome.add(from);
          queue.push(from);
        }
      }
    }

    for (const id of Object.keys(SPOTS)) {
      expect(canGetHome.has(id), `${id}: no route back to any waypoint — whoever walks in stays there`).toBe(true);
    }
  });

  it('every spot has map coordinates inside the canvas', () => {
    for (const spot of Object.values(SPOTS)) {
      expect(spot.map, `${spot.id} missing map coords`).toBeDefined();
      expect(spot.map!.x).toBeGreaterThanOrEqual(0);
      expect(spot.map!.x).toBeLessThanOrEqual(100);
      expect(spot.map!.y).toBeGreaterThanOrEqual(0);
      expect(spot.map!.y).toBeLessThanOrEqual(75);
    }
  });

  // The old case asked for 2 waypoints or more, with the shelved countryside
  // mounted. The content in scope has one: `ascent_foot`.
  it.todo('waypoints exist for fast travel (step 4: the second waypoint is outside floors 0 to 6 and Threshold)');

  it('spot activities and recipe lists resolve', () => {
    // The recipe and bench halves of the old case are the two todos below.
    for (const spot of Object.values(SPOTS)) {
      for (const act of spot.activities) {
        if (act.kind === 'gather') expect(MATERIALS[act.material!], `${spot.id} gathers ${act.material}`).toBeDefined();
        if (act.kind === 'train') {
          if (act.attr) expect(VALID_ATTRS.has(act.attr), `${spot.id} trains ${act.attr}`).toBe(true);
          expect(
            Object.keys(attrXpWeights(act)).length,
            `${spot.id}/${act.id} trains nothing (needs attr or attrXp)`,
          ).toBeGreaterThan(0);
        }
        if (act.kind === 'train' || act.kind === 'gather' || act.kind === 'job') {
          checkFactors(`${spot.id}/${act.id} speed`, act.speedFactors);
          checkFactors(`${spot.id}/${act.id} output`, act.outputFactors);
          for (const { attr } of act.attrXp ?? []) {
            expect(VALID_ATTRS.has(attr), `${spot.id}/${act.id} attrXp ${attr}`).toBe(true);
          }
        }
      }
      for (const e of spot.encounters ?? []) {
        expect(MONSTERS[e.monsterId], `${spot.id} spawns ${e.monsterId}`).toBeDefined();
        expect(e.level[0]).toBeLessThanOrEqual(e.level[1]);
      }
    }
  });
  it('spot activities and recipe lists resolve: the recipe lists', () => {
    let listed = 0;
    for (const spot of Object.values(SPOTS)) {
      for (const rid of spot.recipes ?? []) {
        expect(RECIPES[rid], `${spot.id} recipe ${rid}`).toBeDefined();
        listed++;
      }
    }
    expect(SPOTS.the_forges.recipes).toEqual(['iron_ingot', 'copper_ingot', 'tin_ingot', 'bronze_ingot']);
    expect(SPOTS.f11_quay.recipes).toEqual(['ship_cannon', 'cannonball', 'powder_charge']);
    expect(SPOTS.f15_workshop.recipes).toEqual(['iron_ingot']);
    expect(listed).toBe(8);
  });
  it.todo('spot activities and recipe lists resolve: the bench ids (step 3: the disciplines; 7 spots of Threshold list benches)');

  it('exploration finds resolve, sit inside the search, and pay something', () => {
    for (const spot of Object.values(SPOTS)) {
      expect(searchContentIssues(spot), spot.id).toEqual([]);
      const finds = spot.finds ?? [];
      if (finds.length === 0) continue;
      expect(spot.exploreTicks, `${spot.id} has finds but no exploreTicks`).toBeDefined();
      expect(
        spot.activities.some((a) => a.kind === 'explore'),
        `${spot.id} has finds but nothing to explore with`,
      ).toBe(true);

      const ids = new Set<string>();
      for (const f of finds) {
        const owner = `${spot.id}/${f.id}`;
        expect(ids.has(f.id), `${owner}: duplicate find id`).toBe(false);
        ids.add(f.id);
        expect(f.at, `${owner}: at must be > 0`).toBeGreaterThan(0);
        expect(f.at, `${owner}: at must be <= 1`).toBeLessThanOrEqual(1);

        const pays = f.material || f.item || f.keyItem || f.rune || f.gold || f.spot || f.path || f.skillXp || f.stat || f.desc;
        expect(pays, `${owner}: find yields nothing at all`).toBeTruthy();

        if (f.stat) {
          expect(
            f.stat.amount !== undefined && f.stat.set !== undefined,
            `${owner}: stat has both amount and set — pick one`,
          ).toBe(false);
          const resettable = f.stat.key.startsWith('slain:') || f.stat.key.startsWith('fights:');
          expect(
            f.stat.key.startsWith('flag:') || (f.stat.set !== undefined && resettable),
            `${owner}: stat key '${f.stat.key}' must be flag:* (or slain:*/fights:* with set)`,
          ).toBe(true);
        }

        if (f.material) {
          expect(MATERIALS[f.material.id], `${owner}: material ${f.material.id}`).toBeDefined();
          expect(f.material.qty ?? 1, `${owner}: material qty`).toBeGreaterThan(0);
        }
        if (f.item) expect(ITEMS[f.item], `${owner}: item ${f.item}`).toBeDefined();
        if (f.rune) expect(RUNES[f.rune], `${owner}: rune ${f.rune}`).toBeDefined();
        if (f.gold) {
          expect(f.gold.min, `${owner}: gold min`).toBeGreaterThanOrEqual(0);
          expect(f.gold.min, `${owner}: gold min > max`).toBeLessThanOrEqual(f.gold.max);
        }
        if (f.spot) expect(SPOTS[f.spot], `${owner}: rumored spot ${f.spot}`).toBeDefined();
        if (f.path) {
          const edge = spot.connections.find((c) => c.to === f.path);
          expect(edge, `${owner}: opens a path to ${f.path} that isn't declared here`).toBeDefined();
          expect(edge!.hidden, `${owner}: path to ${f.path} isn't hidden, so nothing opens`).toBe(true);
        }
        if (f.skillXp) {
          expect(f.skillXp.tags.length, `${owner}: skillXp needs at least one tag`).toBeGreaterThan(0);
          expect(f.skillXp.xp, `${owner}: skillXp xp`).toBeGreaterThan(0);
          for (const tag of f.skillXp.tags) {
            expect(
              Object.values(SKILLS).some((s) => s.tags.includes(tag)),
              `${owner}: skill tag '${tag}' is claimed by no skill, so it trains nothing`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('every explore activity pays something — a find, or a hidden road to open', () => {
    expect(exploreIssues(Object.values(SPOTS)).map((i) => `${i.spot}: ${i.message}`)).toEqual([]);
  });

  it('exploration gates sit inside the search and can be met', () => {
    // The old case also checked the conditions of a road's approach: no road
    // in scope has one (step 4).
    for (const spot of Object.values(SPOTS)) {
      for (const gate of spot.exploreGates ?? []) {
        const owner = `${spot.id} gate@${gate.at}`;
        expect(spot.exploreTicks, `${owner}: gates need exploreTicks to measure against`).toBeDefined();
        expect(gate.at, `${owner}: at must be > 0`).toBeGreaterThan(0);
        expect(gate.at, `${owner}: at must be <= 1`).toBeLessThanOrEqual(1);
        expect(gate.requires.length, `${owner}: a gate with no conditions blocks forever`).toBeGreaterThan(0);
        checkConditions(owner, gate.requires);
      }
      for (const f of spot.finds ?? []) {
        checkConditions(`${spot.id}/${f.id} requires`, f.requires);
      }
      for (const e of spot.encounters ?? []) {
        checkConditions(`${spot.id} encounter ${e.monsterId} requires`, e.requires);
      }
      for (const c of spot.connections) {
        checkConditions(`${spot.id} -> ${c.to} reveal`, c.revealWhen);
      }
    }
  });

  it('super-attribute components and unlocks resolve', () => {
    for (const s of SUPERATTR_LIST) {
      for (const comp of s.components) expect(VALID_ATTRS.has(comp), `${s.id} ${comp}`).toBe(true);
      checkConditions(`superattr ${s.id}`, s.unlock as Condition[]);
    }
  });

  it('approaches lay real statuses, and fight budgets have fights to spend', () => {
    // The approach half: no road in scope has an approach (step 4).
    for (const spot of Object.values(SPOTS)) {
      if (spot.fightLimit !== undefined) {
        expect(spot.fightLimit, `${spot.id}: fightLimit must be positive`).toBeGreaterThan(0);
        expect(
          spot.encounters?.length ?? 0,
          `${spot.id}: a fight budget with no fights — fightLimit needs encounters`,
        ).toBeGreaterThan(0);
      }
      if (spot.caged) {
        expect(
          spot.encounters?.length ?? 0,
          `${spot.id}: caged with no encounters — empty cages teach nothing`,
        ).toBeGreaterThan(0);
        expect(spot.fightLimit, `${spot.id}: caged spots must not carry a fightLimit — the cages restock`).toBeUndefined();
      }
      if (spot.healBetweenBouts) {
        expect(spot.healBetweenBouts.maxAttrTotal, `${spot.id}: healBetweenBouts needs a positive cap`).toBeGreaterThan(0);
      }
      if (spot.dare) {
        const d = spot.dare;
        expect(MONSTERS[d.monsterId], `${spot.id}: dares an unknown monster '${d.monsterId}'`).toBeDefined();
        expect(Number.isInteger(d.every) && d.every > 0, `${spot.id}: dare.every must be a positive whole number`).toBe(true);
        expect(d.level, `${spot.id}: dare.level must be at least 1`).toBeGreaterThanOrEqual(1);
        expect(spot.encounters?.length ?? 0, `${spot.id}: a dare with no fights to win toward it`).toBeGreaterThan(0);
        expect(spot.healBetweenBouts, `${spot.id}: a dare is offered only while the keeper tends you`).toBeDefined();
        expect(d.desc, `${spot.id}: the keeper's dare line (<spot>.dare.desc) is missing`).toBeTruthy();
      }
      for (const e of spot.encounters ?? []) {
        if (!e.window) continue;
        expect(e.window.min, `${spot.id}/${e.monsterId}: window.min must be > 0`).toBeGreaterThan(0);
        expect(e.window.max, `${spot.id}/${e.monsterId}: window needs min < max`).toBeGreaterThan(e.window.min);
      }
      for (const e of spot.encounters ?? []) {
        if (!e.levelRise) continue;
        expect(e.levelRise.share, `${spot.id}/${e.monsterId}: levelRise.share must be > 0`).toBeGreaterThan(0);
        expect(
          e.levelRise.ceiling,
          `${spot.id}/${e.monsterId}: levelRise.ceiling must be at least level[1]`,
        ).toBeGreaterThanOrEqual(e.level[1]);
      }
      const bosses = (spot.encounters ?? []).filter((e) => e.boss);
      if (bosses.length) {
        expect(
          bosses.some((e) => !e.window),
          `${spot.id}: every boss hides behind a power window — keep one windowless keeper`,
        ).toBe(true);
      }
    }
  });

  it('every hidden path is reachable — by combing the spot or by a find', () => {
    for (const spot of Object.values(SPOTS)) {
      const hidden = spot.connections.filter((c) => c.hidden);
      if (hidden.length === 0) continue;
      const canComb = spot.activities.some((a) => a.kind === 'explore');
      for (const c of hidden) {
        const opener = (spot.finds ?? []).some((f) => f.path === c.to);
        expect(canComb || opener, `${spot.id} -> ${c.to} is hidden with no way to reveal it`).toBe(true);
      }
    }
  });
});

describe('recipe cards and rare finds', () => {
  it('activity drops name real materials, on kinds that roll them, at sane chances', () => {
    for (const spot of Object.values(SPOTS)) {
      for (const act of spot.activities) {
        const drops = act.drops;
        if (!drops?.length) continue;
        expect(['train', 'gather', 'job'], `${spot.id}/${act.id}: only train/gather/job roll drops`).toContain(act.kind);
        for (const d of drops) {
          expect(MATERIALS[d.material], `${spot.id}/${act.id}: unknown drop '${d.material}'`).toBeDefined();
          expect(d.chance > 0 && d.chance <= 1, `${spot.id}/${act.id}: chance must be in (0, 1]`).toBe(true);
          if (d.quality) expect(MATERIALS[d.material]?.graded, `${spot.id}/${act.id}: quality on an ungraded drop`).toBe(true);
          if (d.rarer !== undefined) expect(d.rarer, `${spot.id}/${act.id}: rarer must be > 1`).toBeGreaterThan(1);
          if (d.qty !== undefined) expect(d.qty, `${spot.id}/${act.id}: qty must be >= 1`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe('towers, bands & floors', () => {
  it('every tower opens on a real spot', () => {
    for (const tower of Object.values(TOWERS)) {
      expect(SPOTS[tower.hubSpot], `${tower.id}: unknown hubSpot ${tower.hubSpot}`).toBeTruthy();
    }
  });

  it('every band belongs to a real tower', () => {
    for (const band of Object.values(BANDS)) {
      expect(TOWERS[band.towerId], `${band.id}: unknown towerId ${band.towerId}`).toBeTruthy();
      expect(band.index, `${band.id}: index is 1-based`).toBeGreaterThan(0);
    }
  });

  it('band indexes are unique and contiguous within a tower', () => {
    for (const tower of Object.values(TOWERS)) {
      const idx = Object.values(BANDS)
        .filter((b) => b.towerId === tower.id)
        .map((b) => b.index)
        .sort((a, b) => a - b);
      if (!idx.length) continue;
      expect(idx, `${tower.id}: band indexes must run 1..n with no gaps`).toEqual(idx.map((_, i) => i + 1));
    }
  });

  it('every floor points at a real tower, band and area', () => {
    for (const floor of Object.values(FLOORS)) {
      expect(TOWERS[floor.towerId], `${floor.id}: unknown towerId ${floor.towerId}`).toBeTruthy();
      expect(AREAS[floor.areaId], `${floor.id}: unknown areaId ${floor.areaId}`).toBeTruthy();
      if (floor.bandId !== undefined) {
        const band = BANDS[floor.bandId];
        expect(band, `${floor.id}: unknown bandId ${floor.bandId}`).toBeTruthy();
        expect(band.towerId, `${floor.id}: band ${floor.bandId} is on another tower`).toBe(floor.towerId);
      }
    }
  });

  it('no two floors claim the same area', () => {
    const byArea = new Map<string, string>();
    for (const floor of Object.values(FLOORS)) {
      const prior = byArea.get(floor.areaId);
      expect(prior, `${floor.id} and ${prior} both claim area ${floor.areaId}`).toBeUndefined();
      byArea.set(floor.areaId, floor.id);
    }
  });

  it('personal floors are off the ladder', () => {
    for (const floor of Object.values(FLOORS)) {
      if (!floor.personal) continue;
      expect(floor.bandId, `${floor.id} is personal, so it may not sit in a band`).toBeUndefined();
    }
  });

  it('no band asks for more clears than it has floors', () => {
    for (const band of Object.values(BANDS)) {
      const floors = Object.values(FLOORS).filter((f) => f.bandId === band.id);
      if (!floors.length) continue;
      expect(band.clearsToAdvance, `${band.id}: clearsToAdvance must be at least 1`).toBeGreaterThan(0);
      expect(
        band.clearsToAdvance,
        `${band.id} wants ${band.clearsToAdvance} clears but holds ${floors.length} floor(s)`,
      ).toBeLessThanOrEqual(floors.length);
    }
  });

  it('band hubs, any-order bands and level steps are well formed', () => {
    const floorAreas = new Set(Object.values(FLOORS).map((f) => f.areaId));
    for (const band of Object.values(BANDS)) {
      const floors = Object.values(FLOORS)
        .filter((f) => f.bandId === band.id)
        .sort((a, b) => a.index - b.index);
      if (band.hub) {
        const spot = SPOTS[band.hub];
        expect(spot, `${band.id}: hub '${band.hub}' does not exist`).toBeTruthy();
        expect(floorAreas.has(spot?.areaId ?? ''), `${band.id}: hub '${band.hub}' sits on a floor`).toBe(false);
        expect(floors.length, `${band.id}: a hub with no floors leads nowhere`).toBeGreaterThan(0);
      }
      for (const f of floors) {
        for (const other of Object.values(FLOORS)) {
          if (other.towerId !== f.towerId || other.bandId === undefined) continue;
          const otherBand = BANDS[other.bandId];
          if (otherBand.index < band.index) {
            expect(other.index, `${other.id} (band ${otherBand.index}) sits above ${f.id} (band ${band.index})`).toBeLessThan(f.index);
          }
        }
      }
      if (band.levelSteps) {
        expect(band.order, `${band.id}: level steps belong to any-order bands`).toBe('any');
        expect(band.levelSteps.length, `${band.id}: one step per floor`).toBe(floors.length);
        expect(band.levelSteps[0], `${band.id}: the first direction starts at the base level`).toBe(0);
        for (let i = 1; i < band.levelSteps.length; i++) {
          expect(band.levelSteps[i], `${band.id}: steps never fall`).toBeGreaterThanOrEqual(band.levelSteps[i - 1]);
        }
      }
      if (band.dynamicLevel) {
        const { factor, capShare } = band.dynamicLevel;
        expect(factor > 0 && factor <= 1, `${band.id}: dynamic level factor is above 0 and at most 1`).toBe(true);
        expect(capShare > 0 && capShare <= 4, `${band.id}: dynamic level cap share is above 0 and at most 4`).toBe(true);
      }
    }
  });

  it('no rung is gated or cleared on a named discipline', () => {
    for (const floor of Object.values(FLOORS)) {
      if (floor.bandId === undefined) continue;
      for (const cond of [...(floor.gate ?? []), ...(floor.clear ?? [])]) {
        expect(
          cond.type,
          `${floor.id}: a skill condition on a mandatory rung makes that discipline mandatory`,
        ).not.toBe('skill');
      }
    }
  });

  it('every banded floor declares a landing in its own area and a non-empty clear', () => {
    for (const floor of Object.values(FLOORS)) {
      if (floor.bandId === undefined) continue;
      expect(floor.landing, `${floor.id}: a rung needs a landing`).toBeTruthy();
      const landing = SPOTS[floor.landing!];
      expect(landing, `${floor.id}: landing '${floor.landing}' does not exist`).toBeTruthy();
      expect(landing?.areaId, `${floor.id}: landing '${floor.landing}' is not on the floor it lands on`).toBe(floor.areaId);
      expect(floor.clear?.length ?? 0, `${floor.id}: a rung needs a clear`).toBeGreaterThan(0);
    }
  });

  it('banded floor indexes are unique and contiguous within a tower', () => {
    for (const tower of Object.values(TOWERS)) {
      const idx = Object.values(FLOORS)
        .filter((f) => f.towerId === tower.id && f.bandId !== undefined)
        .map((f) => f.index)
        .sort((a, b) => a - b);
      if (!idx.length) continue;
      expect(idx, `${tower.id}: banded floor indexes must run 1..n with no gaps`).toEqual(idx.map((_, i) => i + 1));
    }
  });

  it('clear counters point at spawns that can actually pay them', () => {
    for (const floor of Object.values(FLOORS)) {
      for (const cond of floor.clear ?? []) {
        if (cond.type !== 'stat') continue;
        const slain = cond.key.match(/^slain:([^:]+):(.+)$/);
        if (slain) {
          const spot = SPOTS[slain[1]];
          expect(spot, `${floor.id}: clear names unknown spot '${slain[1]}'`).toBeTruthy();
          expect(
            spot?.encounters?.some((e) => e.monsterId === slain[2] && e.once),
            `${floor.id}: clear wants slain:${slain[1]}:${slain[2]} but that spot has no such 'once' spawn`,
          ).toBe(true);
        }
        const fights = cond.key.match(/^fights:(.+)$/);
        if (fights) {
          const spot = SPOTS[fights[1]];
          expect(spot, `${floor.id}: clear names unknown spot '${fights[1]}'`).toBeTruthy();
          // A water counts every won fight and never clears (`sea`), so it
          // has no budget to stop short.
          if (!(fights[1] in CONVOYS)) {
            expect(
              spot?.fightLimit ?? 0,
              `${floor.id}: clear wants ${cond.value} fights at ${fights[1]} but its fightLimit stops short`,
            ).toBeGreaterThanOrEqual(cond.value);
          }
        }
        const boss = cond.key.match(/^boss:(.+)$/);
        if (boss) {
          const spot = SPOTS[boss[1]];
          expect(spot, `${floor.id}: clear names unknown spot '${boss[1]}'`).toBeTruthy();
          expect(
            spot?.encounters?.some((e) => e.boss),
            `${floor.id}: clear wants boss:${boss[1]} but no encounter there is boss-flagged`,
          ).toBe(true);
        }
      }
    }
  });

  it('no authored edge crosses a banded floor boundary', () => {
    // The doors of `OFF_LADDER_DOORS` (the gatehouse of floor 11 and the
    // hold) are exempt, as in the old case.
    const bandedAreas = new Set(
      Object.values(FLOORS)
        .filter((f) => f.bandId !== undefined)
        .map((f) => f.areaId),
    );
    for (const spot of Object.values(SPOTS)) {
      for (const c of spot.connections) {
        const toArea = SPOTS[c.to]?.areaId;
        if (!toArea) continue; // unknown targets fail the referential lint instead
        if (offLadderDoor(spot.id, c.to)) continue;
        if (bandedAreas.has(spot.areaId) || bandedAreas.has(toArea)) {
          expect(
            spot.areaId,
            `${spot.id} -> ${c.to} crosses a banded floor boundary — the ladder is the only door`,
          ).toBe(toArea);
        }
      }
    }
  });

  const reports = () =>
    Object.values(FLOORS)
      .filter((f) => f.bandId !== undefined)
      .map((f) => ({ floor: f, report: floorStructureIssues(f, SPOTS, ADJACENCY) }));
  const issuesOf = (rule: FloorRule) =>
    reports().flatMap(({ report }) => report.issues.filter((i) => i.rule === rule).map((i) => `${i.floor}: ${i.message}`));

  it('every banded floor has a spine: its clear names a spot to measure from', () => {
    // A floor whose clear names no spot (a stamped flag) skips the spine
    // rules below. Each one is listed here and in the ladder's SPINE_EXEMPT,
    // with its reason, so the exemption is a decision and not an accident:
    // - ascent_f14: the harbor's final mission. Its clear is any one of four
    //   side wings, stamped as flag:sea:14:done by the side's boss kill (sea).
    const skipped = reports()
      .filter(({ report }) => report.skipped !== undefined)
      .map(({ floor, report }) => `${floor.id} (${report.skipped})`);
    expect(skipped, 'floors whose spine rules did not run').toEqual(['ascent_f14 (no-clear-spot)']);
    expect(Object.keys(SPINE_EXEMPT), 'the forge stays quiet for exactly these').toEqual(['ascent_f14']);
    expect(reports()).toHaveLength(16);
    expect(issuesOf('spine')).toEqual([]);
  });

  it('no skip: every floor-local gate is necessary', () => {
    expect(issuesOf('no-skip')).toEqual([]);
  });

  it('wing depth: every spot is within 3 hops of the spine', () => {
    expect(issuesOf('wing-depth')).toEqual([]);
  });

  it('wings loop: a wing of 3 or more spots joins the spine twice, or has a oneWay way back', () => {
    expect(issuesOf('wing-loop')).toEqual([]);
  });

  it("a clear spot's encounter table never empties", () => {
    expect(issuesOf('clear-table')).toEqual([]);
  });

  it('the festival’s strategies, plans and staged fighters resolve', () => {
    // The run's part: the dark room's waves and its boss line. The royale's
    // part is the next case.
    const issues = festivalContentIssues(DARK_ROOM_WAVES, { monsters: MONSTERS, spots: SPOTS });
    expect(issues.map((i) => `${i.kind} ${i.id}: ${i.message}`)).toEqual([]);
  });

  it('the festival’s strategies, plans and staged fighters resolve: the royale’s', () => {
    // Strategies name real moves and sane conditions, every plan names real
    // strategies, every survivor species is a monster with a plan, the
    // champion is the arena's boss line (floor 16's clear), every den and
    // cache resolves.
    const issues = festivalContentIssues(
      DARK_ROOM_WAVES,
      { monsters: MONSTERS, spots: SPOTS },
      {
        strategies: ROYALE_STRATEGIES,
        sections: ROYALE_SECTIONS,
        defaultPlan: DEFAULT_ROYALE_PLAN,
        species: SURVIVOR_SPECIES,
        champion: SURVIVOR_CHAMPION,
        dens: ROYALE_DENS,
        caches: ROYALE_CACHES,
      },
    );
    expect(issues.map((i) => `${i.kind} ${i.id}: ${i.message}`)).toEqual([]);
  });
});

/**
 * Band 3's wards: clear stamps, kept wounds and ward windows. One pure
 * function in `src/systems/wards/validation.ts`, run here on the live
 * registries and by the forge validator on the staged copy.
 */
describe('band 3 wards: stamps, kept wounds and windows', () => {
  it('every stamp has a fight budget, every kept wound a share, every window resolves', () => {
    const issues = wardContentIssues(WARD_WINDOWS, { bands: BANDS, floors: FLOORS, spots: SPOTS, monsters: MONSTERS });
    expect(issues.map((i) => `${i.kind} ${i.id}: ${i.message}`)).toEqual([]);
  });
});

/**
 * The harbor band's sides and convoys (`sea`). The checks are one pure
 * function in `sea/validation.ts`, run here on the live registry.
 */
describe('the harbor band: sides and convoys', () => {
  it('every side and convoy resolves, and join quests lock one side per run', () => {
    const issues = seaContentIssues(SEA_SIDE_LIST, CONVOY_LIST, { spots: SPOTS, npcs: NPCS, quests: QUESTS, monsters: MONSTERS, materials: MATERIALS });
    expect(issues.map((i) => `${i.kind} ${i.id}: ${i.message}`)).toEqual([]);
  });
});

describe('region skies and sky-gated encounter lines', () => {
  it('every region sky names a table, and every sky line can roll where it stands', () => {
    // The region and area rules of the old `skyContentIssues`, which is not
    // ported as a function. Its spot rules (a sky line under a roof, a
    // table-only kind with no table) have nothing to read: no line in scope
    // waits on the sky. The last assertion fails when one arrives.
    const kinds = new Set<string>(WEATHER_KINDS);
    for (const region of Object.values(REGIONS)) {
      if (region.sky === undefined) continue;
      expect(SKY_TABLES[region.sky], `${region.id}: sky '${region.sky}' is not in SKY_TABLES`).toBeDefined();
      expect(region.world, `${region.id}: a sky table needs an atlas pin (world)`).toBeDefined();
    }
    for (const area of Object.values(AREAS)) {
      if (area.skyRegionId === undefined) continue;
      expect(REGIONS[area.skyRegionId], `${area.id}: skyRegionId '${area.skyRegionId}' is not a region`).toBeDefined();
    }
    const skyLines = Object.values(SPOTS).flatMap((s) => (s.encounters ?? []).filter((e) => e.sky !== undefined).map((e) => ({ spot: s.id, e })));
    for (const { spot, e } of skyLines) {
      for (const k of e.sky ?? []) expect(kinds.has(k), `${spot} ${e.monsterId}: sky names '${k}'`).toBe(true);
    }
    expect(skyLines.map((l) => l.spot), 'a sky line is in scope: port the spot rules of skyContentIssues').toEqual([]);
  });
});
