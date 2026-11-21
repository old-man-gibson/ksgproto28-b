/**
 * Exposure, darkness, moonlight, sunlight, sky tables and sky rules. Port of
 * the old `tests/exposure.test.ts` and `tests/sky.test.ts`, of the cases of
 * `tests/openSky.test.ts` on floors 0 to 10 and the castle, of the gale case of
 * `tests/derivedcache.test.ts`, and of single cases of `content.test.ts`,
 * `facet.test.ts` and `mutagens.test.ts`.
 *
 * What changed in the call shape:
 * - a state at a spot and a tick is a kernel with `world.spot`,
 *   `clock.totalTicks` and `weather.seed` patched (`gameAt`);
 * - one call of the old `tickExposure` or `tickSky` is one kernel tick that
 *   lands on that game minute (`minuteAt`);
 * - the spots of the shelved countryside are replaced by spots of this port:
 *   `ascent_foot` (settlement), `f0_cell` (indoor), `f4_deep_woods` (open
 *   sky), `f5_hollows` (dark), `the_forges` (heat);
 * - the only sky-table region, `malgeri_range`, is step 4. The file mounts a
 *   region of that id with the old record, and the three spots of the old
 *   `tests/fixtures/malgeri.ts`, for its duration.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLAYER, type Kernel } from '../src/kernel';
import type { AttributesState } from '../src/systems/attributes';
import { clockOf, moonlight, MOONLIGHT_WEIGHT, SEASONS, type SeasonId } from '../src/systems/clock';
import { eligibleEncounters, hook, hunt, type CombatState, type EncounterSite } from '../src/systems/combat';
import type { CountersState } from '../src/systems/counters';
import type { ItemsState } from '../src/systems/items';
import type { LogState } from '../src/systems/log';
import type { SkillsState } from '../src/systems/skills';
import { statBlockOf, statMod, statOf } from '../src/systems/stats';
import {
  applyStatus,
  clearStatuses,
  findStatus,
  hasStatus,
  heldOf,
  statusBarDamage,
  statusCeiling,
  STATUSES,
  statusIntensity,
  type StatusesState,
} from '../src/systems/statuses';
import {
  ACTIVITY_XP_PER_TICK,
  CALM_HOURS,
  CALM_PERIOD_DAYS,
  CALM_SEEN_KEY,
  calmSpell,
  classify,
  COLD_TRAINS_AT,
  DARKNESS_SOURCE,
  darknessFactor,
  ELEMENT_TAGS,
  firstCalmLine,
  FRONT_HOURS,
  FRONT_TICKS,
  frontOfCell,
  HEAT_TRAINS_AT,
  isCalmAt,
  MOONLIGHT_MAX,
  MOONLIGHT_THROUGH,
  moonlightOn,
  moonlightThrough,
  naturalDarkness,
  PLACE_TAGS,
  placeDarkness,
  SKY_RULES,
  SKY_TABLES,
  skyDarkness,
  skyKindAt,
  sunlight,
  WEATHER_ICONS,
  WEATHER_KINDS,
  WEATHER_SOURCE_PREFIX,
  weatherAt,
  weatherExposure,
  worldSeedOf,
  type WeatherKind,
  type WeatherSample,
  type WeatherState,
  type WeatherView,
} from '../src/systems/weather';
import { AREAS, arrived as arrivedEvent, cycleDone, REGIONS, selectActivity, skyRegionOf, SPOTS, type RegionDef, type SpotDef } from '../src/systems/world';
import { spawn, stage } from './combatHelpers';
import { ask, emit, equip, listFiles, makeGame, patch, readJson, reads, setMods, slice } from './helpers';

const CREATED = 1_754_000_000_000;
const SEED = worldSeedOf(CREATED);
/** The seed of the old cases that set `createdAt` to 20260804. */
const SEED_B = worldSeedOf(20260804);

const TICKS_PER_MINUTE = 10;
const MINUTES_PER_DAY = 1440;
const at = (d: number, h = 0) => (d * 1440 + h * 60) * 10;

// ---- the mounted mountain ----

/** The old record of `malgeri_range` (`data/locations.data.ts`). */
const MOUNTAIN: RegionDef = { id: 'malgeri_range', name: 'Malgeri Range', terrain: 'mountains', sky: 'malgeri', world: { x: 16, y: 29 } };
const TABLE = SKY_TABLES.malgeri;

/** Open sky: weather reaches it. */
const RIDGE = 'test_malgeri_ridge';
/** A roof inside the same region: the `indoor` tag. */
const HUT = 'test_malgeri_hut';
/** An area that overrides the region to sheltered. */
const CAVE = 'test_malgeri_cave';

const PLAIN = 'goblin';
const WINDY = 'hobgoblin';
const STILL = 'slime_king';

const table = (): NonNullable<SpotDef['encounters']> => [
  { monsterId: PLAIN, weight: 10, level: [1, 1] },
  { monsterId: WINDY, weight: 10, level: [1, 1], sky: ['gale', 'storm'] },
  { monsterId: STILL, weight: 10, level: [1, 1], sky: ['calm'] },
];

const testSpot = (id: string, areaId: string, tags?: string[]): SpotDef => ({
  id,
  name: id,
  icon: '⛰️',
  areaId,
  desc: 'A test spot.',
  activities: [],
  encounters: table(),
  connections: [],
  ...(tags ? { tags } : {}),
});

const siteOf = (spotId: string): EncounterSite => ({ id: spotId, name: spotId, encounters: SPOTS[spotId].encounters ?? [] });

beforeAll(() => {
  REGIONS.malgeri_range = MOUNTAIN;
  AREAS.test_malgeri_area = { id: 'test_malgeri_area', name: 'Test Malgeri', regionId: 'malgeri_range' };
  AREAS.test_malgeri_cave_area = { id: 'test_malgeri_cave_area', name: 'Test Malgeri Cave', regionId: 'malgeri_range', sheltered: true };
  SPOTS[RIDGE] = testSpot(RIDGE, 'test_malgeri_area');
  SPOTS[HUT] = testSpot(HUT, 'test_malgeri_area', ['indoor']);
  SPOTS[CAVE] = testSpot(CAVE, 'test_malgeri_cave_area');
});

afterAll(() => {
  delete REGIONS.malgeri_range;
  delete AREAS.test_malgeri_area;
  delete AREAS.test_malgeri_cave_area;
  delete SPOTS[RIDGE];
  delete SPOTS[HUT];
  delete SPOTS[CAVE];
});

// ---- helpers ----

type Slices = Record<string, any>;

/** A new game standing at `spot` with the clock at `tick` and the weather seed set. */
function gameAt(spot: string, tick: number, change?: (slices: Slices) => void, seed: number | null = SEED): Kernel {
  const kernel = makeGame();
  patch(kernel, (slices) => {
    slices.world.spot = spot;
    if (!slices.world.discovered.includes(spot)) slices.world.discovered.push(spot);
    slices.clock.totalTicks = tick;
    slices.weather.seed = seed;
    change?.(slices);
  });
  return kernel;
}

/** A game that has just run the tick of the game minute at `tick`: one old `tickExposure` and `tickSky`. */
function minuteAt(spot: string, tick: number, change?: (slices: Slices) => void, seed: number | null = SEED): Kernel {
  const kernel = gameAt(spot, tick - 1, change, seed);
  kernel.tick();
  return kernel;
}

/** Set the clock and run the tick that lands on `tick`. */
function runMinute(kernel: Kernel, tick: number): void {
  patch(kernel, (slices) => (slices.clock.totalTicks = tick - 1));
  kernel.tick();
}

const held = (kernel: Kernel, entity: string = PLAYER) => heldOf(slice<StatusesState>(kernel, 'statuses'), entity);
const skillsOf = (kernel: Kernel) => slice<SkillsState>(kernel, 'skills').skills;
const weatherOf = (kernel: Kernel) => slice<WeatherState>(kernel, 'weather');
const counter = (kernel: Kernel, key: string): number | undefined => slice<CountersState>(kernel, 'counters').counts[key];
const logOf = (kernel: Kernel): string[] => slice<LogState>(kernel, 'log').log.map((entry) => entry.msg);
const setSkill = (kernel: Kernel, id: string, level: number) => patch(kernel, (slices) => (slices.skills.skills[id] = { level, xp: 0 }));
const sound = (kernel: Kernel) => expect(kernel.staleStats()).toEqual([]);

/** The first tick on a rule boundary (a multiple of 3 game minutes) at which the mountain shows `kind`. */
function tickShowing(kind: WeatherKind, window = 3): number {
  if (kind === 'calm') {
    const [start] = calmSpell(SEED, MOUNTAIN.id, window);
    return Math.ceil(start / 3) * 3 * TICKS_PER_MINUTE;
  }
  // A front cell starts on a multiple of 3600 ticks, which is a multiple of 30.
  // From cell 1: the tick before the minute must not be before the epoch.
  for (let cell = 1; ; cell++) {
    const tick = cell * FRONT_TICKS;
    if (weatherAt(SEED, MOUNTAIN, tick)!.kind === kind) return tick;
  }
}

function sample(over: Partial<WeatherSample>): WeatherSample {
  return { temp: 15, precip: 0.2, wind: 0.3, kind: 'clear', band: 'mild', ...over };
}

// ---------- exposure.test.ts ----------

describe('what each sky trains', () => {
  const shares = (s: WeatherSample, base = 15, hour = 12) => Object.fromEntries(weatherExposure(s, base, hour));

  it('rain is water, a storm is 65:30:5 wind, water, lightning', () => {
    expect(shares(sample({ kind: 'rain' }))).toEqual({ water: 1 });
    expect(shares(sample({ kind: 'storm' }))).toEqual({ wind: 0.65, water: 0.3, lightning: 0.05 });
  });

  it('a sandstorm is 80:20 wind and earth; a gale and a blizzard are wind', () => {
    expect(shares(sample({ kind: 'sandstorm' }))).toEqual({ wind: 0.8, earth: 0.2 });
    expect(shares(sample({ kind: 'gale' }))).toEqual({ wind: 1 });
    expect(shares(sample({ kind: 'blizzard', temp: -8 }))).toEqual({ wind: 1, cold: 1 });
  });

  it('heat and cold train only past their thresholds', () => {
    expect(shares(sample({ temp: HEAT_TRAINS_AT }))).toHaveProperty('heat');
    expect(shares(sample({ temp: HEAT_TRAINS_AT - 1 }))).not.toHaveProperty('heat');
    expect(shares(sample({ temp: COLD_TRAINS_AT }))).toHaveProperty('cold');
    expect(shares(sample({ temp: COLD_TRAINS_AT + 1 }))).not.toHaveProperty('cold');
  });

  it('glare is a clear daytime sky well above its baseline', () => {
    expect(shares(sample({ kind: 'clear', temp: 22 }), 15, 12)).toEqual({ light: 1 });
    expect(shares(sample({ kind: 'clear', temp: 22 }), 15, 22)).toEqual({}); // night
    expect(shares(sample({ kind: 'clear', temp: 19 }), 15, 12)).toEqual({}); // under the margin
    expect(shares(sample({ kind: 'overcast', temp: 22 }), 15, 12)).toEqual({}); // clouds
  });

  it('a heatwave pays heat once', () => {
    expect(shares(sample({ kind: 'heatwave', temp: 38 }))).toEqual({ heat: 1 });
  });
});

describe('the dark', () => {
  it('night is dark, twilight is half, day is not', () => {
    expect(naturalDarkness(23)).toBe(1);
    expect(naturalDarkness(2)).toBe(1);
    expect(naturalDarkness(19)).toBe(0.5);
    expect(naturalDarkness(5)).toBe(0.5);
    expect(naturalDarkness(12)).toBe(0);
  });

  it('lamplight, a roof and daylight cancel it; darkvision lowers it', () => {
    const night = at(3, 23);
    expect(darknessFactor(reads(gameAt('ascent_foot', night)))).toBe(0); // settlement
    expect(darknessFactor(reads(gameAt('f0_cell', night)))).toBe(0); // indoor
    expect(darknessFactor(reads(gameAt('f4_deep_woods', at(3, 12))))).toBe(0); // daylight

    // Tick 0 is midnight with all three moons new: no moonlight under any sky.
    const wild = gameAt('f4_deep_woods', 0);
    expect(darknessFactor(reads(wild))).toBe(1);
    setSkill(wild, 'darkvision', 25);
    expect(darknessFactor(reads(wild))).toBe(0.5);
    setSkill(wild, 'darkvision', 50);
    expect(darknessFactor(reads(wild))).toBe(0);
  });

  it('the open night grows darkvision; a settlement does not', () => {
    expect(skillsOf(minuteAt('f4_deep_woods', at(3, 23))).darkvision).toBeDefined();
    expect(skillsOf(minuteAt('ascent_foot', at(3, 23))).darkvision).toBeUndefined();
  });

  it('a `dark` place is dark at noon', () => {
    // The old case stood in a region tagged `dark` (step 4). Here the tag is on the spot.
    const cave = gameAt('f5_hollows', at(3, 12));
    expect(darknessFactor(reads(cave))).toBe(1);
    setSkill(cave, 'darkvision', 50);
    expect(darknessFactor(reads(cave))).toBe(0);
  });

  it('a `dark` tag on the region reaches every spot of it', () => {
    REGIONS.malgeri_range = { ...MOUNTAIN, tags: ['dark'] };
    try {
      expect(darknessFactor(reads(gameAt(RIDGE, at(3, 12))))).toBe(1);
      expect(darknessFactor(reads(gameAt(CAVE, at(3, 12))))).toBe(1);
    } finally {
      REGIONS.malgeri_range = MOUNTAIN;
    }
  });

  it('a dark cave trains darkvision and dark resistance while idle', () => {
    const skills = skillsOf(minuteAt('f5_hollows', at(3, 12)));
    expect(skills.darkvision).toBeDefined();
    expect(skills.dark_resistance).toBeDefined();
  });
});

describe('moonlight', () => {
  const newMoons = clockOf(0).moons;
  const fullMoons = newMoons.map((m) => ({ ...m, illumination: 1 }));

  it('is 0 with every moon new and 1 with every moon full', () => {
    expect(moonlight(newMoons)).toBe(0);
    expect(moonlight(fullMoons)).toBeCloseTo(1, 12);
    expect(Object.values(MOONLIGHT_WEIGHT).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('the sky kind sets how much gets through; no sample means no clouds', () => {
    expect(moonlightThrough(fullMoons, 'clear')).toBeCloseTo(1, 12);
    expect(moonlightThrough(fullMoons, 'mist')).toBeCloseTo(0.5, 12);
    expect(moonlightThrough(fullMoons, 'overcast')).toBe(0);
    expect(moonlightThrough(fullMoons, 'snow')).toBe(0);
    expect(moonlightThrough(fullMoons, null)).toBeCloseTo(1, 12);
    for (const through of Object.values(MOONLIGHT_THROUGH)) {
      expect(through).toBeGreaterThanOrEqual(0);
      expect(through).toBeLessThanOrEqual(1);
    }
  });

  it('no moonlight leaves the sky as dark as before; the brightest night is 0.4 dark', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(skyDarkness(hour, 0)).toBe(naturalDarkness(hour));
    }
    expect(skyDarkness(23, 1)).toBeCloseTo(1 - MOONLIGHT_MAX, 12);
    expect(skyDarkness(23, 1)).toBeCloseTo(0.4, 12);
    expect(skyDarkness(19, 1)).toBeCloseTo(0.2, 12);
    expect(skyDarkness(12, 1)).toBe(0);
  });

  it('never reaches a dark place, a roof or lamplight, and is not sampled by day', () => {
    const full = () => 1;
    expect(placeDarkness(undefined, new Set(['dark']), 23, full)).toBe(1);
    expect(placeDarkness(undefined, new Set(['settlement']), 23, full)).toBe(0);
    expect(placeDarkness({ sheltered: true }, new Set(), 23, full)).toBe(0);
    const never = () => {
      throw new Error('sampled the sky');
    };
    expect(placeDarkness(undefined, new Set(), 12, never)).toBe(0);
    expect(placeDarkness(undefined, new Set(['indoor']), 23, never)).toBe(0);
    expect(placeDarkness(undefined, new Set(), 23, full)).toBeCloseTo(0.4, 12);
  });

  /** The first 23:00 in the woods of floor 4 whose sky is `kind`, under a fixed seed. */
  function woodsNightWith(kind: WeatherKind): number {
    const region = skyRegionOf('f4_deep_woods')!;
    for (let d = 1; d < 368; d++) {
      const t = at(d, 23);
      if (weatherAt(SEED_B, region, t)?.kind !== kind) continue;
      if (kind === 'clear' && moonlight(clockOf(t).moons) < 0.2) continue;
      return t;
    }
    throw new Error(`no ${kind} night found`);
  }

  it('a clear moonlit night in the woods is lighter; an overcast one is not', () => {
    const clearTick = woodsNightWith('clear');
    const clear = reads(gameAt('f4_deep_woods', clearTick, undefined, SEED_B));
    const lit = moonlightThrough(clockOf(clearTick).moons, 'clear');
    expect(darknessFactor(clear)).toBeCloseTo(1 - MOONLIGHT_MAX * lit, 12);
    expect(darknessFactor(clear)).toBeLessThan(0.9);
    expect(moonlightOn(clear)).toEqual({ lit, kind: 'clear' });

    const overcast = reads(gameAt('f4_deep_woods', woodsNightWith('overcast'), undefined, SEED_B));
    expect(darknessFactor(overcast)).toBe(1);
    expect(moonlightOn(overcast)).toEqual({ lit: 0, kind: 'overcast' });
  });

  it('the readout is null where moonlight cannot matter', () => {
    expect(moonlightOn(reads(gameAt('ascent_foot', at(3, 23))))).toBeNull(); // lamplight
    expect(moonlightOn(reads(gameAt('f5_hollows', at(3, 23))))).toBeNull(); // dark place
    expect(moonlightOn(reads(gameAt('f4_deep_woods', at(3, 12))))).toBeNull(); // daylight
  });

  it('a moonlit night trains darkvision less than a clouded one', () => {
    const xpAfterOneMinute = (tick: number) => {
      const kernel = minuteAt('f4_deep_woods', tick, (slices) => (slices.skills.skills.darkvision = { level: 1, xp: 0 }), SEED_B);
      return skillsOf(kernel).darkvision.xp;
    };
    const moonlit = xpAfterOneMinute(woodsNightWith('clear'));
    const clouded = xpAfterOneMinute(woodsNightWith('overcast'));
    expect(moonlit).toBeGreaterThan(0);
    expect(moonlit).toBeLessThan(clouded);
  });
});

describe('open sky in the tower', () => {
  const OPEN_F6 = ['f6_warren_mouth', 'f6_pens', 'f6_shrine'];
  const ROOFED_F6 = ['f6_tunnels', 'f6_kitchens', 'f6_great_hall'];

  it('band 1 keeps the roof; floors 4 and 5 and the open spots of floor 6 share the sky over the same pin', () => {
    expect(skyRegionOf('f1_landing')).toBe(REGIONS.the_ascent);
    expect(skyRegionOf('f1_landing')?.sheltered).toBe(true);
    for (const spot of ['f4_treeline', 'f4_ravine_floor', 'f5_bog', 'f5_back_door', ...OPEN_F6]) {
      const sky = skyRegionOf(spot)!;
      expect(sky.sheltered, spot).toBe(false);
      expect(sky.world, spot).toEqual(REGIONS.the_ascent.world);
    }
  });

  it('weather reaches floor 4 and never floor 1', () => {
    const kinds = new Set<WeatherKind>();
    for (let d = 1; d < 90; d++) {
      expect(weatherAt(SEED_B, skyRegionOf('f1_landing')!, at(d, 12))?.kind).toBe('still');
      kinds.add(weatherAt(SEED_B, skyRegionOf('f4_treeline')!, at(d, 12))!.kind);
    }
    expect(kinds.has('still')).toBe(false);
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('a night on floor 4 is dark and moonlit; the same night on floor 1 is not dark', () => {
    const f4 = reads(gameAt('f4_deep_woods', at(3, 23), undefined, SEED_B));
    const moon = moonlightOn(f4);
    expect(moon).not.toBeNull();
    expect(darknessFactor(f4)).toBeCloseTo(skyDarkness(23, moon!.lit), 12);
    expect(darknessFactor(f4)).toBeGreaterThan(0);

    const f1 = reads(gameAt('f1_landing', at(3, 23)));
    expect(darknessFactor(f1)).toBe(0);
    expect(moonlightOn(f1)).toBeNull();
  });

  it('floor 6: the Mouth, the Pens and the Shrine see the night, the roofed warren does not, the caves stay dark', () => {
    for (const spot of OPEN_F6) {
      const r = reads(gameAt(spot, at(3, 23)));
      expect(moonlightOn(r), spot).not.toBeNull();
      expect(darknessFactor(r), spot).toBeGreaterThan(0);
    }
    for (const spot of ROOFED_F6) {
      const r = reads(gameAt(spot, at(3, 23)));
      expect(darknessFactor(r), spot).toBe(0);
      expect(moonlightOn(r), spot).toBeNull();
    }
    for (const spot of ['f5_hollows', 'f6_drop']) {
      expect(darknessFactor(reads(gameAt(spot, at(3, 12)))), spot).toBe(1);
    }
  });

  it('rain on floor 5 trains the bog, never the caves or the roofed warren', () => {
    let rain = -1;
    for (let d = 1; d < 368 && rain < 0; d++) {
      if (weatherAt(SEED_B, skyRegionOf('f5_bog')!, at(d, 12))?.kind === 'rain') rain = at(d, 12);
    }
    expect(rain).toBeGreaterThan(0);
    const wet = (spot: string) => skillsOf(minuteAt(spot, rain, undefined, SEED_B)).water_resistance !== undefined;
    expect(wet('f5_bog')).toBe(true);
    expect(wet('f5_hollows')).toBe(false);
    expect(wet('f6_tunnels')).toBe(false);
    expect(wet('f1_landing')).toBe(false);
  });

  // ---- openSky.test.ts, floors 0 to 10 and the castle ----

  /** Spots inside an open tower area that carry `indoor`, by floor. */
  const INDOOR_SPOTS: Record<string, string[]> = {
    f0: ['f0_cell', 'f0_cellblock'],
    f5: ['f5_hollows'],
    f6: ['f6_tunnels', 'f6_kitchens', 'f6_drop', 'f6_great_hall'],
    f7: ['f7_chiefs_tent'],
    f8: ['f8_lodge'],
    f9: ['f9_ossuary'],
    f10: ['f10_quarry', 'f10_foundry'],
  };
  const LEFT_OPEN = ['f0_gate', 'f5_cave_mouth', 'f5_back_door', 'f6_warren_mouth', 'f7_watchtowers', 'f10_artificers_row'];
  const OPEN_AREAS = [
    'ascent_f0_area',
    'ascent_f4_area',
    'ascent_f5_area',
    'ascent_f6_area',
    'ascent_f7_area',
    'ascent_f8_area',
    'ascent_f9_area',
    'ascent_f10_area',
  ];
  /** One open spot per floor of band 3, for the night checks. */
  const NIGHT_SPOT: Record<number, string> = { 7: 'f7_docks', 8: 'f8_forest_gate', 9: 'f9_cathedral_close', 10: 'f10_artificers_row' };
  const skyAt = (spot: string) => skyKindAt(reads(gameAt(spot, at(40, 12), undefined, SEED_B)), spot);

  it('the areas that set sheltered: false are the open Ascent floors of this port', () => {
    const open = Object.values(AREAS)
      .filter((a) => a.regionId === 'the_ascent' && a.sheltered === false)
      .map((a) => a.id);
    expect(open).toEqual(['ascent_f4_area', 'ascent_f5_area', 'ascent_f6_area', 'ascent_f7_area', 'ascent_f8_area', 'ascent_f9_area', 'ascent_f10_area']);
  });

  it('the castle keeps the roof: its sky is the sheltered Ascent', () => {
    expect(skyRegionOf('castle_court')?.sheltered).toBe(true);
    expect(skyAt('castle_court')).toBeNull();
  });

  it('floors 7 to 10 read the one sky the Ascent pins, so two floors share a kind at one tick', () => {
    const kinds = new Set<string>();
    for (const spot of Object.values(NIGHT_SPOT)) {
      const kind = skyKindAt(reads(gameAt(spot, at(120, 9), undefined, SEED_B)), spot);
      // A null would read as one shared kind through String(): every spot must have a sky.
      expect(kind, spot).not.toBeNull();
      kinds.add(String(kind));
    }
    expect(kinds.size).toBe(1);
  });

  it('the night on floors 7 to 10 is dark and moonlit under the open sky, and teaches Darkvision', () => {
    for (const [floor, spot] of Object.entries(NIGHT_SPOT)) {
      const r = reads(gameAt(spot, at(3, 23), undefined, SEED_B));
      const moon = moonlightOn(r);
      expect(moon, `f${floor} ${spot}: moonlight`).not.toBeNull();
      expect(darknessFactor(r), `f${floor} ${spot}`).toBeCloseTo(skyDarkness(23, moon!.lit), 12);
      expect(darknessFactor(r), `f${floor} ${spot}`).toBeGreaterThan(0);
      const trained = minuteAt(spot, at(3, 23), undefined, SEED_B);
      expect(skillsOf(trained).darkvision?.xp ?? 0, `f${floor} ${spot}: darkvision xp`).toBeGreaterThan(0);
    }
  });

  it('the night on floors 7 to 10 is not dark by day', () => {
    for (const spot of Object.values(NIGHT_SPOT)) {
      expect(darknessFactor(reads(gameAt(spot, at(3, 12), undefined, SEED_B))), spot).toBe(0);
    }
  });

  it('the castle adds no darkness at night', () => {
    const r = reads(gameAt('castle_court', at(3, 23), undefined, SEED_B));
    expect(darknessFactor(r)).toBe(0);
    expect(moonlightOn(r)).toBeNull();
  });

  it('floor 10 lets the sun in by day at an open spot and not at an inside one', () => {
    expect(sunlight(reads(gameAt('f10_artificers_row', at(3, 12), undefined, SEED_B)))).toBeGreaterThan(0);
    expect(sunlight(reads(gameAt('f10_quarry', at(3, 12), undefined, SEED_B)))).toBe(0);
  });

  it('every named inside spot is roofed by its tag and not by its area', () => {
    for (const [floor, ids] of Object.entries(INDOOR_SPOTS)) {
      for (const id of ids) {
        expect(SPOTS[id], id).toBeDefined();
        expect(!!skyRegionOf(id)?.sheltered, `${id} (${floor}): sky open`).toBe(false);
        expect(SPOTS[id].tags, id).toContain('indoor');
        expect(skyAt(id), id).toBeNull();
      }
    }
  });

  it('the spots tagged indoor in the open tower areas are the listed ones', () => {
    const tagged = Object.values(SPOTS)
      .filter((s) => OPEN_AREAS.includes(s.areaId) && s.tags?.includes('indoor'))
      .map((s) => s.id);
    expect(tagged.sort()).toEqual(Object.values(INDOOR_SPOTS).flat().sort());
  });

  it('floor 0: the cell and the cellblock stay roofed, the field is open', () => {
    expect(skyAt('f0_cell')).toBeNull();
    expect(skyAt('f0_cellblock')).toBeNull();
    expect(skyAt('f0_field')).not.toBeNull();
  });

  it('the spots judged open have a sky', () => {
    for (const id of LEFT_OPEN) {
      expect(SPOTS[id], id).toBeDefined();
      expect(SPOTS[id].tags ?? [], id).not.toContain('indoor');
      expect(skyAt(id), id).not.toBeNull();
    }
  });

  it('the night adds no darkness at an inside spot, and none on a roofed floor', () => {
    for (const ids of Object.values(INDOOR_SPOTS)) {
      for (const id of ids) {
        // A cave tagged `dark` is dark at every hour.
        expect(darknessFactor(reads(gameAt(id, at(3, 23)))), id).toBe(darknessFactor(reads(gameAt(id, at(3, 12)))));
        expect(moonlightOn(reads(gameAt(id, at(3, 23)))), id).toBeNull();
      }
    }
  });

  it('sunlight: some under an open sky at noon, none at midnight, none under a roof or in the dark', () => {
    const noon = sunlight(reads(gameAt('f4_woods_edge', at(3, 12))));
    expect(noon).toBeGreaterThan(0);
    expect(noon).toBeLessThanOrEqual(1);
    expect(sunlight(reads(gameAt('f4_woods_edge', at(3, 0))))).toBe(0);
    expect(sunlight(reads(gameAt('f6_tunnels', at(3, 12))))).toBe(0);
    expect(sunlight(reads(gameAt('f1_landing', at(3, 12))))).toBe(0);
    expect(sunlight(reads(gameAt('f5_hollows', at(3, 12))))).toBe(0);
    // Lamplight is not sun: a settlement at midnight reads 0, and at noon it reads the sky.
    expect(sunlight(reads(gameAt('ascent_foot', at(3, 0))))).toBe(0);
    expect(sunlight(reads(gameAt('ascent_foot', at(3, 12))))).toBeGreaterThan(0);
  });

  it('the view is null exactly where there is no open sky', () => {
    for (const spot of Object.values(SPOTS).filter((s) => OPEN_AREAS.includes(s.areaId))) {
      const kernel = gameAt(spot.id, at(40, 12), undefined, SEED_B);
      const view = kernel.view().systems.weather as WeatherView;
      const kind = skyKindAt(reads(kernel), spot.id);
      expect(view.kind, spot.id).toBe(kind);
      expect(view.icon, spot.id).toBe(kind ? WEATHER_ICONS[kind] : null);
      expect(view.band === null, spot.id).toBe(kind === null);
      expect(view.temp === null, spot.id).toBe(kind === null);
    }
  });

  it.todo('floors 11 to 20 and the festival: open and roofed areas, night and sun (step 4: floors above 10)');
  it.todo('the header weather chip shows `still` at a roofed spot (the UI step: `headerSky` of the old shell)');
});

describe('places and work that radiate', () => {
  it('standing at the forges trains heat resistance', () => {
    expect(skillsOf(minuteAt('the_forges', at(3, 12))).heat_resistance).toBeDefined();
  });

  it('work with an element tag pays exposure by cycle length; other work pays none', () => {
    const kernel = gameAt('ascent_foot', 0);
    emit(kernel, cycleDone, { spot: 'ascent_foot', activity: 'job', kind: 'job', tags: ['craft', 'heat'], baseTicks: 100 });
    const heat = skillsOf(kernel).heat_resistance;
    expect(heat).toBeDefined();
    // Level-ups fold XP away. The grant must be material for a 100-tick cycle.
    expect(heat.xp + (heat.level - 1) * 10).toBeGreaterThanOrEqual(ACTIVITY_XP_PER_TICK * 100 * 0.9);

    const dull = gameAt('ascent_foot', 0);
    emit(dull, cycleDone, { spot: 'ascent_foot', activity: 'job', kind: 'job', tags: ['craft', 'woodwork'], baseTicks: 100 });
    expect(skillsOf(dull).heat_resistance).toBeUndefined();
  });

  it('a tick that is not on a game minute does nothing', () => {
    const kernel = gameAt('the_forges', at(3, 12) + 2);
    kernel.tick();
    expect(skillsOf(kernel).heat_resistance).toBeUndefined();
    expect(weatherOf(kernel).seed).toBe(SEED);
  });

  it('place tags come from the exposure vocabulary, at every level', () => {
    for (const defs of [Object.values(REGIONS), Object.values(AREAS), Object.values(SPOTS)]) {
      for (const def of defs as { id: string; tags?: string[] }[]) {
        for (const tag of def.tags ?? []) {
          expect(ELEMENT_TAGS.has(tag) || PLACE_TAGS.has(tag), `${def.id}: tag '${tag}'`).toBe(true);
        }
      }
    }
  });
});

// ---------- sky.test.ts ----------

describe('the Malgeri sky table', () => {
  it.todo('`malgeri_range` names a registered table on a pinned mountain region (step 4: floor 17 and its region)');

  it('holds the five kinds at the ruled weights, calm among none of them', () => {
    expect(TABLE.fronts.map((f) => [f.kind, f.weight])).toEqual([
      ['gale', 24],
      ['snow', 22],
      ['rain', 20],
      ['storm', 18],
      ['heatwave', 14.5],
    ]);
    expect(TABLE.fronts.some((f) => f.kind === 'calm')).toBe(false);
  });

  it('feeds classify values that give back the kind of each front, and calm', () => {
    for (const f of TABLE.fronts) {
      expect(classify(f, MOUNTAIN.terrain, false, true), f.kind).toBe(f.kind);
    }
    expect(classify(TABLE.calm, MOUNTAIN.terrain, false, true)).toBe('calm');
  });

  it('removes one kind per season: summer snow, winter heatwave, spring storm, autumn rain', () => {
    expect(TABLE.excluded).toEqual({ summer: 'snow', winter: 'heatwave', spring: 'storm', autumn: 'rain' });
  });

  it('keeps the thresholds out of the noise path', () => {
    expect(classify({ temp: 38, precip: 0.05, wind: 0.2 }, 'mountains', false)).toBe('clear');
    expect(classify(TABLE.calm, 'mountains', false)).toBe('clear');
  });
});

describe('fronts', () => {
  const CELLS_PER_SEASON = 20_000;

  /** The first `n` cells that start in each season, in order. */
  function cellsBySeason(n: number): Record<SeasonId, number[]> {
    const out: Record<SeasonId, number[]> = { winter: [], spring: [], summer: [], autumn: [] };
    for (let cell = 0; SEASONS.some((s) => out[s].length < n); cell++) {
      const season = clockOf(cell * FRONT_TICKS).season;
      if (out[season].length < n) out[season].push(cell);
    }
    return out;
  }
  const CELLS = cellsBySeason(CELLS_PER_SEASON);

  it('a front is FRONT_HOURS long and four of them make a day', () => {
    expect(FRONT_HOURS).toBe(6);
    expect(FRONT_TICKS).toBe(FRONT_HOURS * 60 * TICKS_PER_MINUTE);
    expect(24 % FRONT_HOURS).toBe(0);
  });

  for (const season of SEASONS) {
    it(`${season}: 20,000 cells land within 1% of the weights, the excluded kind never`, () => {
      const excluded = TABLE.excluded[season]!;
      const kept = TABLE.fronts.filter((f) => f.kind !== excluded);
      const total = kept.reduce((sum, f) => sum + f.weight, 0);
      const count = new Map<string, number>();
      for (const cell of CELLS[season]) {
        const f = frontOfCell(TABLE, season, SEED, MOUNTAIN.id, cell);
        count.set(f.kind, (count.get(f.kind) ?? 0) + 1);
      }
      expect(count.get(excluded) ?? 0, `${excluded} in ${season}`).toBe(0);
      for (const f of kept) {
        const share = (count.get(f.kind) ?? 0) / CELLS_PER_SEASON;
        expect(Math.abs(share - f.weight / total), `${f.kind} in ${season}`).toBeLessThan(0.01);
      }
    });
  }

  it('weatherAt never shows the excluded kind of the season it is read in', () => {
    for (let cell = 0; cell < (2 * 368 * 24) / FRONT_HOURS; cell++) {
      const season = clockOf(cell * FRONT_TICKS).season;
      for (const tick of [cell * FRONT_TICKS, (cell + 1) * FRONT_TICKS - 1]) {
        const kind = weatherAt(SEED, MOUNTAIN, tick)!.kind;
        expect(kind, `cell ${cell} ${season}`).not.toBe(TABLE.excluded[season]);
      }
    }
  });

  it('holds one front for its whole cell', () => {
    // A cell that no calm spell touches. Cells never straddle a calm window.
    const cellMinutes = FRONT_HOURS * 60;
    const touched = (cell: number): boolean => {
      const [start, end] = calmSpell(SEED, MOUNTAIN.id, Math.floor((cell * cellMinutes) / (CALM_PERIOD_DAYS * MINUTES_PER_DAY)));
      return start < (cell + 1) * cellMinutes && end > cell * cellMinutes;
    };
    let cell = 40;
    while (touched(cell)) cell++;
    const first = weatherAt(SEED, MOUNTAIN, cell * FRONT_TICKS)!;
    for (let t = 0; t < FRONT_TICKS; t += 997) {
      expect(weatherAt(SEED, MOUNTAIN, cell * FRONT_TICKS + t)).toEqual(first);
    }
  });

  it('a different seed, or a different region, draws a different run', () => {
    const run = (seed: number, id: string) =>
      Array.from({ length: 200 }, (_, cell) => frontOfCell(TABLE, 'autumn', seed, id, cell).kind).join();
    expect(run(SEED, 'a')).toBe(run(SEED, 'a'));
    expect(run(SEED, 'a')).not.toBe(run(worldSeedOf(42), 'a'));
    expect(run(SEED, 'a')).not.toBe(run(SEED, 'b'));
  });
});

describe('calm', () => {
  const WINDOW_MINUTES = CALM_PERIOD_DAYS * MINUTES_PER_DAY;
  const SPELL_MINUTES = CALM_HOURS * 60;

  it('is the ruled constants', () => {
    expect(CALM_PERIOD_DAYS).toBe(12);
    expect(CALM_HOURS).toBe(8);
  });

  it('puts one spell of CALM_HOURS in every window, inside the window', () => {
    for (let w = 0; w < 30; w++) {
      const [start, end] = calmSpell(SEED, MOUNTAIN.id, w);
      expect(end - start).toBe(SPELL_MINUTES);
      expect(start).toBeGreaterThanOrEqual(w * WINDOW_MINUTES);
      expect(end).toBeLessThanOrEqual((w + 1) * WINDOW_MINUTES);
      let run = 0;
      let runs = 0;
      let was = false;
      for (let m = w * WINDOW_MINUTES; m < (w + 1) * WINDOW_MINUTES; m++) {
        const now = isCalmAt(SEED, MOUNTAIN.id, m * TICKS_PER_MINUTE);
        if (now) run++;
        if (now && !was) runs++;
        was = now;
      }
      expect(run, `window ${w}`).toBe(SPELL_MINUTES);
      expect(runs, `window ${w}`).toBe(1);
    }
  });

  it('starts at a different offset in different windows', () => {
    const starts = new Set<number>();
    for (let w = 0; w < 30; w++) starts.add(calmSpell(SEED, MOUNTAIN.id, w)[0] - w * WINDOW_MINUTES);
    expect(starts.size).toBeGreaterThan(25);
  });

  it('overrides the front for the whole spell and for nothing else', () => {
    for (let w = 0; w < 30; w++) {
      const [start, end] = calmSpell(SEED, MOUNTAIN.id, w);
      const kindAt = (m: number) => weatherAt(SEED, MOUNTAIN, m * TICKS_PER_MINUTE)!.kind;
      expect(kindAt(start)).toBe('calm');
      expect(kindAt(end - 1)).toBe('calm');
      expect(kindAt(Math.floor((start + end) / 2))).toBe('calm');
      expect(kindAt(end)).not.toBe('calm');
      if (start > w * WINDOW_MINUTES) expect(kindAt(start - 1)).not.toBe('calm');
    }
  });

  it('is deterministic: the same inputs give the same sky in any order', () => {
    const ticks = Array.from({ length: 400 }, (_, i) => i * 7919 + 13);
    const forward = ticks.map((t) => weatherAt(SEED, MOUNTAIN, t));
    const backward = [...ticks]
      .reverse()
      .map((t) => weatherAt(SEED, MOUNTAIN, t))
      .reverse();
    expect(backward).toEqual(forward);
    expect(calmSpell(SEED, MOUNTAIN.id, 5)).toEqual(calmSpell(SEED, MOUNTAIN.id, 5));
    expect(calmSpell(SEED, MOUNTAIN.id, 5)).not.toEqual(calmSpell(worldSeedOf(42), MOUNTAIN.id, 5));
  });

  it('is never drawn as a front', () => {
    for (let cell = 0; cell < 20_000; cell++) {
      expect(frontOfCell(TABLE, SEASONS[cell % 4], SEED, MOUNTAIN.id, cell).kind).not.toBe('calm');
    }
  });
});

describe('regions without a sky table', () => {
  // A fixed digest of weatherAt over ten literal regions, two seeds and two
  // years, taken in the old repository on the code before sky tables. Any
  // change to the noise path, the baseline or classify moves it.
  const TERRAINS = ['plains', 'forest', 'hills', 'mountains', 'coast', 'desert', 'volcanic', 'caves'];
  const regions: RegionDef[] = [
    { id: 'the_ascent', name: 'A', terrain: 'plains', sheltered: false, world: { x: 14.3, y: 21.6 } },
    { id: 'the_ascent', name: 'A', terrain: 'plains', sheltered: true, world: { x: 14.3, y: 21.6 } },
    ...TERRAINS.map(
      (terrain, i): RegionDef => ({
        id: `t_${terrain}`,
        name: terrain,
        terrain,
        sheltered: terrain === 'caves',
        world: { x: 10 + i * 9, y: 15 + i * 7 },
      }),
    ),
  ];

  function fnv(h: number, s: string): number {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }

  function digest(created: number): number {
    const seed = worldSeedOf(created);
    let h = 0x811c9dc5;
    for (const r of regions) {
      for (let t = 0; t < 2 * 368 * 14400; t += 997) {
        const w = weatherAt(seed, r, t);
        h = fnv(h, w ? `${w.kind}|${w.band}|${w.temp}|${w.precip}|${w.wind}` : 'null');
      }
    }
    return h;
  }

  it('give weather identical to the old build, by digest', () => {
    expect(digest(1_754_000_000_000)).toBe(392195146);
    expect(digest(20260804)).toBe(438608177);
  });

  it('never show heatwave or calm', () => {
    const kinds = new Set<string>();
    for (const r of regions) {
      for (let t = 0; t < 368 * 14400; t += 1999) kinds.add(weatherAt(SEED, r, t)?.kind ?? 'none');
    }
    expect(kinds.has('heatwave')).toBe(false);
    expect(kinds.has('calm')).toBe(false);
  });

  it('a sheltered region with a sky table stays still', () => {
    expect(weatherAt(SEED, { ...MOUNTAIN, sheltered: true }, 123456)!.kind).toBe('still');
  });

  it('a sky table needs a pin: a region with none has no weather', () => {
    expect(weatherAt(SEED, { ...MOUNTAIN, world: undefined }, 123456)).toBeNull();
  });
});

describe('the sample memo', () => {
  it('holds one sample for a whole game minute', () => {
    const t = 600 * 40;
    expect(weatherAt(SEED, MOUNTAIN, t + 9)).toBe(weatherAt(SEED, MOUNTAIN, t));
    expect(weatherAt(SEED, MOUNTAIN, t + 10)).not.toBe(weatherAt(SEED, MOUNTAIN, t));
  });

  it('is keyed by value, not by object: a copy of the region reads the same entry', () => {
    const t = 600 * 41;
    expect(weatherAt(SEED, { ...MOUNTAIN }, t)).toEqual(weatherAt(SEED, MOUNTAIN, t));
  });

  it('never lets a roofed read and an open read of one region trade answers', () => {
    const t = 600 * 42;
    const open = weatherAt(SEED, MOUNTAIN, t)!.kind;
    expect(weatherAt(SEED, { ...MOUNTAIN, sheltered: true }, t)!.kind).toBe('still');
    expect(weatherAt(SEED, MOUNTAIN, t)!.kind).toBe(open);
    expect(open).not.toBe('still');
  });

  it('stays correct after its bound is passed and it empties', () => {
    const probes = [600 * 5, 600 * 977, 600 * 1500];
    const before = probes.map((t) => weatherAt(SEED, MOUNTAIN, t));
    for (let m = 0; m < 9000; m++) weatherAt(SEED + (m % 3), MOUNTAIN, m * TICKS_PER_MINUTE);
    expect(probes.map((t) => weatherAt(SEED, MOUNTAIN, t))).toEqual(before);
  });

  it('returns a frozen sample', () => {
    expect(Object.isFrozen(weatherAt(SEED, MOUNTAIN, 600 * 43))).toBe(true);
  });
});

// ---------- what the open sky does ----------

describe('SKY_RULES: what the open sky does to the player', () => {
  const DOSES: [WeatherKind, Record<string, number>][] = [
    ['gale', { buffeted: 0.5 }],
    ['rain', { wet: 1 }],
    ['snow', { chilled: 0.15 }],
    ['storm', { wet: 1 }],
    ['heatwave', { sweltering: 0.5 }],
  ];

  it('names only statuses that exist, on whole-minute periods, and nothing for calm', () => {
    for (const [kind, rule] of Object.entries(SKY_RULES)) {
      expect(WEATHER_KINDS, kind).toContain(kind);
      expect(Number.isInteger(rule.every) && rule.every > 0, `${kind}: every`).toBe(true);
      for (const app of [...rule.self, ...(rule.foes ?? [])]) {
        expect(STATUSES[app.id], `${kind}: ${app.id}`).toBeDefined();
      }
    }
    expect(Object.keys(SKY_RULES).sort()).toEqual(['gale', 'heatwave', 'rain', 'snow', 'storm']);
    expect(SKY_RULES.calm).toBeUndefined();
  });

  for (const [kind, want] of DOSES) {
    it(`${kind}: doses ${Object.keys(want).join(' and ')} under an open sky`, () => {
      const tick = tickShowing(kind);
      expect(skyKindAt(reads(gameAt(RIDGE, tick)), RIDGE)).toBe(kind);
      const kernel = minuteAt(RIDGE, tick);
      for (const [id, intensity] of Object.entries(want)) {
        expect(statusIntensity(held(kernel), id), `${kind}: ${id}`).toBeCloseTo(intensity, 5);
      }
      sound(kernel);
    });
  }

  it('storm adds jolted to the rain', () => {
    const kernel = minuteAt(RIDGE, tickShowing('storm'));
    expect(hasStatus(held(kernel), 'wet')).toBe(true);
    expect(statusIntensity(held(kernel), 'jolted')).toBeGreaterThan(0);
  });

  const dropsBelow = (kernel: Kernel) => ask(kernel, statusBarDamage, { entity: PLAYER, when: 'onFill' }).map((h) => h.dropWeaponBelow);

  it('a jolt the storm applied never makes the bearer drop the weapon; the jolt of a creature does', () => {
    const storm = minuteAt(RIDGE, tickShowing('storm'));
    expect(findStatus(held(storm), 'jolted')!.source).toBe(`${WEATHER_SOURCE_PREFIX}storm`);
    expect(dropsBelow(storm)).toEqual([undefined]);

    const slime = gameAt(RIDGE, 0);
    ask(slime, applyStatus, { entity: PLAYER, app: { id: 'jolted', intensity: 0.5 }, source: 'Spark Slime' });
    expect(dropsBelow(slime)).toEqual([0.5]);
  });

  it('the dose of a creature takes the jolt of a storm over, and a storm dose on the jolt of a creature changes nothing', () => {
    const kernel = minuteAt(RIDGE, tickShowing('storm'));
    ask(kernel, applyStatus, { entity: PLAYER, app: { id: 'jolted', intensity: 0.5 }, source: 'Spark Slime' });
    expect(findStatus(held(kernel), 'jolted')!.source).toBe('Spark Slime');
    expect(dropsBelow(kernel)).toEqual([0.5]);
    ask(kernel, applyStatus, { entity: PLAYER, app: { id: 'jolted', intensity: 0.5 }, source: `${WEATHER_SOURCE_PREFIX}storm` });
    expect(findStatus(held(kernel), 'jolted')!.source).toBe('Spark Slime');
    expect(dropsBelow(kernel)).toEqual([0.5]);
  });

  it('a hunt under a storm with health held under half keeps the weapon through every discharge', () => {
    // Level 1 goblins on an open mountain spot: the fight cannot kill the
    // player, so only the jolt could take the weapon out of the hand.
    const site: EncounterSite = { id: 'test_storm_hunt', name: 'Storm hunt', encounters: [{ monsterId: PLAIN, weight: 1, level: [1, 1] }] };
    SPOTS.test_storm_hunt = { ...SPOTS[RIDGE], id: 'test_storm_hunt', encounters: site.encounters as SpotDef['encounters'] };
    try {
      const kernel = gameAt('test_storm_hunt', tickShowing('storm'), (slices) => {
        for (const attr of Object.values((slices.attributes as AttributesState).attrs)) attr.level = 50;
      });
      equip(kernel, 1); // the starting rusty sword
      const weapon = slice<ItemsState>(kernel, 'items').equipment.weapon;
      expect(weapon).toBeTruthy();
      expect(kernel.dispatch(hunt({ site })).ok).toBe(true);
      let jolted = 0;
      for (let i = 0; i < 3000; i++) {
        // Under the drop threshold (0.5) at every swing: a discharge the jolt owned would shed the weapon.
        const maxHp = statBlockOf(reads(kernel)).maxHp;
        if (slice<{ values: { hp: number } }>(kernel, 'resources').values.hp > maxHp * 0.45) {
          patch(kernel, (slices) => (slices.resources.values.hp = maxHp * 0.3));
        }
        kernel.tick();
        if (statusIntensity(held(kernel), 'jolted') > 0) jolted += 1;
      }
      expect(jolted).toBeGreaterThan(100);
      expect(counter(kernel, 'kills') ?? 0).toBeGreaterThan(0);
      expect(slice<ItemsState>(kernel, 'items').equipment.weapon).toEqual(weapon);
      expect(slice<{ spot: string }>(kernel, 'world').spot).toBe('test_storm_hunt');
    } finally {
      delete SPOTS.test_storm_hunt;
    }
  }, 60_000);

  it('applies on every third game minute and not between', () => {
    const tick = tickShowing('gale');
    const kernel = minuteAt(RIDGE, tick);
    expect(findStatus(held(kernel), 'buffeted')!.intensity).toBeCloseTo(0.5, 5);
    kernel.tick(29);
    expect(findStatus(held(kernel), 'buffeted')!.intensity).toBeCloseTo(0.5, 5);
    kernel.tick();
    // The old case called the sky rule alone and read 1. Here the conditions
    // tick too: the first dose has faded for 30 ticks when the second lands.
    const twice = findStatus(held(kernel), 'buffeted')!.intensity;
    expect(twice).toBeGreaterThan(0.95);
    expect(twice).toBeLessThanOrEqual(1);
  });

  it('does nothing under calm', () => {
    const tick = tickShowing('calm');
    expect(skyKindAt(reads(gameAt(RIDGE, tick)), RIDGE)).toBe('calm');
    expect(held(minuteAt(RIDGE, tick))).toEqual([]);
  });

  it('does nothing indoors or in a sheltered area, whatever the sky', () => {
    for (const kind of Object.keys(SKY_RULES) as WeatherKind[]) {
      const tick = tickShowing(kind);
      for (const spot of [HUT, CAVE]) {
        expect(skyKindAt(reads(gameAt(spot, tick)), spot), `${kind} at ${spot}`).toBeNull();
        expect(held(minuteAt(spot, tick)), `${kind} at ${spot}`).toEqual([]);
      }
    }
  });

  it('does nothing in a region with no sky table, whatever the noise field shows', () => {
    const spot = 'ascent_foot';
    const region = skyRegionOf(spot)!;
    expect(region.sky).toBeUndefined();
    let tick = 0;
    while (weatherAt(SEED, region, tick)?.kind !== 'rain') tick += 3600;
    expect(skyKindAt(reads(gameAt(spot, tick)), spot)).toBe('rain');
    expect(held(minuteAt(spot, tick))).toEqual([]);
  });

  it('does nothing while the seed is not drawn, and a roof draws no seed', () => {
    const tick = tickShowing('gale');
    const roofed = minuteAt(HUT, tick, undefined, null);
    expect(weatherOf(roofed).seed).toBeNull();
    expect(skyKindAt(reads(roofed), RIDGE)).toBeNull();
    // The first minute under the open sky draws it.
    const open = minuteAt(RIDGE, tick, undefined, null);
    expect(weatherOf(open).seed).not.toBeNull();
    expect(skyKindAt(reads(open), RIDGE)).not.toBeNull();
  });

  describe('an area drawn in one region and standing under the sky of another', () => {
    const AREA = 'test_malgeri_sky_area';
    const FLOOR_SPOT = 'test_malgeri_sky_spot';
    beforeAll(() => {
      AREAS[AREA] = { id: AREA, name: 'Test Sky Area', regionId: 'the_ascent', skyRegionId: 'malgeri_range' };
      SPOTS[FLOOR_SPOT] = { id: FLOOR_SPOT, name: FLOOR_SPOT, icon: '⛰️', areaId: AREA, desc: 'A test spot.', activities: [], connections: [] };
    });
    afterAll(() => {
      delete AREAS[AREA];
      delete SPOTS[FLOOR_SPOT];
    });

    it('resolves to the sky region while the area keeps its own region', () => {
      expect(AREAS[AREA].regionId).toBe('the_ascent');
      expect(skyRegionOf(FLOOR_SPOT)!.id).toBe('malgeri_range');
    });

    it('shows the weather of the sky region, calm included, and applies its rules', () => {
      const tick = tickShowing('gale');
      expect(skyKindAt(reads(gameAt(FLOOR_SPOT, tick)), FLOOR_SPOT)).toBe('gale');
      expect(statusIntensity(held(minuteAt(FLOOR_SPOT, tick)), 'buffeted')).toBeCloseTo(0.5, 5);
      expect(skyKindAt(reads(gameAt(FLOOR_SPOT, tickShowing('calm'))), FLOOR_SPOT)).toBe('calm');
    });

    it('keeps the sheltered override of the area', () => {
      AREAS[AREA] = { ...AREAS[AREA], sheltered: true };
      try {
        expect(skyKindAt(reads(gameAt(FLOOR_SPOT, tickShowing('gale'))), FLOOR_SPOT)).toBeNull();
      } finally {
        AREAS[AREA] = { id: AREA, name: 'Test Sky Area', regionId: 'the_ascent', skyRegionId: 'malgeri_range' };
      }
    });
  });

  describe('resistance', () => {
    // The old case mounted a test status with +50% wind resistance. Here the probe states the modifier.
    const windward = (kernel: Kernel) => setMods(kernel, [statMod('resWind', 'add', 0.5, 'Windward')]);

    it('thins the dose: 50% wind resistance halves the buffeting of a gale', () => {
      const tick = tickShowing('gale');
      const bare = minuteAt(RIDGE, tick);
      const warded = gameAt(RIDGE, tick - 1);
      windward(warded);
      expect(statOf(reads(warded), 'resWind')).toBeCloseTo(0.5, 5);
      warded.tick();
      expect(statusIntensity(held(bare), 'buffeted')).toBeCloseTo(0.5, 5);
      expect(statusIntensity(held(warded), 'buffeted')).toBeCloseTo(0.25, 5);
    });

    it('leaves the other kinds alone: wind resistance does not thin rain', () => {
      const warded = gameAt(RIDGE, tickShowing('rain') - 1);
      windward(warded);
      warded.tick();
      expect(statusIntensity(held(warded), 'wet')).toBeCloseTo(1, 5);
    });
  });

  describe('sweltering', () => {
    it('lowers the stamina ceiling by 5% per point of intensity, to at most 30%', () => {
      const tick = tickShowing('heatwave');
      const kernel = gameAt(RIDGE, tick - 1);
      expect(statusCeiling(held(kernel), 'stamina')).toBe(1);
      kernel.tick();
      expect(statusCeiling(held(kernel), 'stamina')).toBeCloseTo(1 - 0.05 * 0.5, 5);
      for (let i = 1; i < 30; i++) runMinute(kernel, tick + i * 30);
      // Doses sum to the cap of 6 and stop there.
      expect(findStatus(held(kernel), 'sweltering')!.intensity).toBeCloseTo(6, 5);
      expect(statusCeiling(held(kernel), 'stamina')).toBeCloseTo(0.7, 5);
      sound(kernel);
    });

    it('is a heat condition, so heat resistance thins it', () => {
      expect(STATUSES.sweltering.element).toBe('heat');
      const tick = tickShowing('heatwave');
      const bare = minuteAt(RIDGE, tick);
      const hardened = gameAt(RIDGE, tick - 1, (slices) => (slices.skills.skills.heat_resistance = { level: 30, xp: 0 }));
      const res = statOf(reads(hardened), 'resHeat');
      expect(res).toBeGreaterThan(0);
      hardened.tick();
      expect(statusIntensity(held(bare), 'sweltering')).toBeCloseTo(0.5, 5);
      expect(statusIntensity(held(hardened), 'sweltering')).toBeCloseTo(0.5 * (1 - res), 5);
    });
  });

  it('dazzles on about one heatwave dose in four', () => {
    const tick = tickShowing('heatwave');
    const kernel = gameAt(RIDGE, tick - 1);
    const trials = 1200;
    let landed = 0;
    for (let i = 0; i < trials; i++) {
      patch(kernel, (slices) => {
        slices.clock.totalTicks = tick - 1;
        slices.statuses.held = {};
      });
      kernel.tick();
      if (hasStatus(held(kernel), 'dazzled')) landed++;
    }
    expect(landed / trials).toBeGreaterThan(0.19);
    expect(landed / trials).toBeLessThan(0.31);
  }, 60_000);

  it('puts the foes of a rule on the enemies of the open fight, and only there', () => {
    const rain = SKY_RULES.rain;
    SKY_RULES.rain = { every: 3, self: [], foes: [{ id: 'wet', intensity: 1 }] };
    try {
      const kernel = gameAt(RIDGE, tickShowing('rain') - 1);
      const [foe] = stage(kernel, [{ monsterId: PLAIN, level: 1 }]);
      kernel.tick();
      expect(statusIntensity(held(kernel, foe.entity), 'wet')).toBeCloseTo(1, 5);
      expect(hasStatus(held(kernel), 'wet')).toBe(false);
    } finally {
      SKY_RULES.rain = rain;
    }
  });
});

// ---------- encounter lines with `sky` ----------

describe('encounter lines with `sky`', () => {
  const ids = (spot: string, tick: number) => {
    const kernel = gameAt(spot, tick);
    return eligibleEncounters(reads(kernel) as never, siteOf(spot))
      .map((e) => e.monsterId)
      .sort();
  };

  it('a gale or a storm adds the windy line and not the calm one', () => {
    expect(ids(RIDGE, tickShowing('gale'))).toEqual([PLAIN, WINDY].sort());
    expect(ids(RIDGE, tickShowing('storm'))).toEqual([PLAIN, WINDY].sort());
  });

  it('calm adds the calm line and not the windy one', () => {
    expect(ids(RIDGE, tickShowing('calm'))).toEqual([PLAIN, STILL].sort());
  });

  it('a sky no line waits on leaves the plain line alone', () => {
    expect(ids(RIDGE, tickShowing('rain'))).toEqual([PLAIN]);
    expect(ids(RIDGE, tickShowing('heatwave'))).toEqual([PLAIN]);
  });

  it('a roofed or sheltered spot has no sky, so no sky line rolls there, calm included', () => {
    for (const kind of ['gale', 'storm', 'calm', 'rain'] as WeatherKind[]) {
      for (const spot of [HUT, CAVE]) {
        expect(ids(spot, tickShowing(kind)), `${kind} at ${spot}`).toEqual([PLAIN]);
      }
    }
  });

  /** The monsters 300 draws give at a spot through the whole calm spell of window 3. */
  function drawnThroughCalm(spot: string): Set<string> {
    const [start, end] = calmSpell(SEED, MOUNTAIN.id, 3);
    const kernel = gameAt(spot, 0);
    const drawn = new Set<string>();
    for (let i = 0; i < 300; i++) {
      patch(kernel, (slices) => (slices.clock.totalTicks = (start + Math.floor(((end - start) * i) / 300)) * TICKS_PER_MINUTE));
      drawn.add(spawn(kernel, siteOf(spot)).defId);
    }
    return drawn;
  }

  it('a calm line never comes out of the draw of an indoor spot, in 300 draws through a whole calm', () => {
    expect([...drawnThroughCalm(HUT)]).toEqual([PLAIN]);
  });

  it('under an open calm sky the calm line is drawn, and the windy one never is', () => {
    const drawn = drawnThroughCalm(RIDGE);
    expect(drawn.has(STILL)).toBe(true);
    expect(drawn.has(PLAIN)).toBe(true);
    expect(drawn.has(WINDY)).toBe(false);
  });

  it('is a function of the clock: the same tick draws from the same table', () => {
    const tick = tickShowing('gale');
    expect(ids(RIDGE, tick)).toEqual(ids(RIDGE, tick));
    expect(ids(RIDGE, tick)).not.toEqual(ids(RIDGE, tickShowing('calm')));
  });

  it.todo('the calm lines of the east ridge roll only under a calm open sky (step 4: floor 17)');
});

// ---------- the first calm ----------

describe('the first calm', () => {
  const WINDOW_MINUTES = CALM_PERIOD_DAYS * MINUTES_PER_DAY;
  const WINDOW = 2;
  const calmStart = () => Math.ceil(calmSpell(SEED, MOUNTAIN.id, WINDOW)[0] / 3) * 3;
  const calmLines = (kernel: Kernel) => logOf(kernel).filter((m) => /calm/i.test(m));

  /** Run every game minute in [from, to). */
  function walk(kernel: Kernel, from: number, to: number): void {
    patch(kernel, (slices) => (slices.clock.totalTicks = from * TICKS_PER_MINUTE - 1));
    kernel.tick((to - from) * TICKS_PER_MINUTE);
  }

  it('names nothing before the first calm: a window of every other sky logs no line', () => {
    const kernel = gameAt(RIDGE, 0);
    walk(kernel, WINDOW * WINDOW_MINUTES, calmStart());
    expect(calmLines(kernel)).toEqual([]);
    expect(counter(kernel, CALM_SEEN_KEY)).toBeUndefined();
    expect(slice<{ spot: string }>(kernel, 'world').spot).toBe(RIDGE);
  }, 60_000);

  it('logs one line at the first calm minute, sets the flag, and then never again', () => {
    const [start, end] = calmSpell(SEED, MOUNTAIN.id, WINDOW);
    const kernel = gameAt(RIDGE, 0);
    walk(kernel, calmStart() - 30, end);
    const first = calmLines(kernel);
    expect(first).toHaveLength(1);
    expect(first[0]).toBe(firstCalmLine());
    expect(first[0]).toContain(WEATHER_ICONS.calm);
    expect(counter(kernel, CALM_SEEN_KEY)).toBe(1);
    expect(start).toBeLessThanOrEqual(calmStart());
    // The whole next window with its own spell. The flag is the gate: the log keeps 60 lines.
    patch(kernel, (slices) => (slices.log.log = []));
    walk(kernel, end, (WINDOW + 2) * WINDOW_MINUTES);
    expect(calmLines(kernel)).toEqual([]);
    expect(slice<{ spot: string }>(kernel, 'world').spot).toBe(RIDGE);
  }, 120_000);

  it('says nothing indoors or in a sheltered area, and does not set the flag there', () => {
    const [start, end] = calmSpell(SEED, MOUNTAIN.id, WINDOW);
    for (const spot of [HUT, CAVE]) {
      const kernel = gameAt(spot, 0);
      walk(kernel, start, end);
      expect(calmLines(kernel), spot).toEqual([]);
      expect(counter(kernel, CALM_SEEN_KEY), spot).toBeUndefined();
    }
  });

  it('does not fire again for a save that carries the flag', () => {
    const [start, end] = calmSpell(SEED, MOUNTAIN.id, WINDOW);
    const kernel = gameAt(RIDGE, 0, (slices) => (slices.counters.counts[CALM_SEEN_KEY] = 1));
    walk(kernel, start, end);
    expect(calmLines(kernel)).toEqual([]);
  });

  it('is in the game tick: 40 ticks across the first calm minute log it once', () => {
    const kernel = gameAt(RIDGE, calmStart() * TICKS_PER_MINUTE - 5);
    kernel.tick(40);
    expect(calmLines(kernel)).toHaveLength(1);
    expect(counter(kernel, CALM_SEEN_KEY)).toBe(1);
  });

  it('needs no slice field: the flag is a counter', () => {
    expect(CALM_SEEN_KEY.startsWith('flag:')).toBe(true);
    expect(Object.keys(weatherOf(makeGame())).sort()).toEqual(['darkness', 'eyeless', 'seed']);
  });

  it.todo('the offline summary carries the first calm line when the log is suppressed (port 7: the offline summary)');
  it.todo('the first calm opens the pending bestiary entries (the bestiary is not ported)');
});

describe('what the texts say about calm', () => {
  it('only the first-calm line names calm among the log texts', () => {
    const naming: string[] = [];
    for (const file of listFiles('src/systems').filter((f) => /\/content\/[a-z_]*text\.json$/.test(f))) {
      for (const record of readJson(file) as { id: string; text: string }[]) {
        if (/\bcalm\b/i.test(record.text)) naming.push(`${file}:${record.id}`);
      }
    }
    expect(naming).toEqual(['src/systems/weather/content/weather_text.json:calm_first']);
  });

  it('the line states the weather and never a danger', () => {
    const line = firstCalmLine();
    expect(line).toMatch(/calm/i);
    expect(line).not.toMatch(/danger|monster|beware|threat|ambush|foe|enem|dread/i);
  });

  it('no sky-rule status text mentions calm', () => {
    for (const id of ['buffeted', 'wet', 'chilled', 'jolted', 'sweltering', 'dazzled']) {
      expect(`${id}: ${STATUSES[id].desc}`).not.toMatch(/calm/i);
    }
  });

  it('sweltering carries a Label: fact text', () => {
    expect(STATUSES.sweltering.desc).toMatch(/^Maximum stamina: /);
    expect(STATUSES.sweltering.desc).toMatch(/Source: /);
  });
});

describe('not ported', () => {
  it.todo('the forecast reads a calm sky and a heatwave by the Weathersense level (step 4: Weathersense)');
  it.todo('Weathersense trains under an open sky and on a journey (step 4: Weathersense)');
  it.todo('`skyContentIssues` refuses a sky line where the sky is never open (the content linter `skyValidation.ts` is not ported)');
  it.todo('Solar Charge banks `world.sunlight` each game minute (Facet is not ported)');
});

// ---------- the modifier source ----------

describe('weather/darkness: the darkness combat reads', () => {
  const night = at(3, 23);
  const dark = (kernel: Kernel) => kernel.derived(hook.darkness);
  /** What darkvision leaves of the stored place darkness. The minute at a dark place manifests darkvision at level 1. */
  const left = (kernel: Kernel) => weatherOf(kernel).darkness * (1 - Math.min(skillsOf(kernel).darkvision?.level ?? 0, 50) / 50);

  it('the place darkness is 1 at a dark spot, 0 indoors, 0 in a settlement at night, and the night sky in the open', () => {
    expect(weatherOf(minuteAt('f5_hollows', at(3, 12))).darkness).toBe(1);
    expect(weatherOf(minuteAt('f0_cell', night)).darkness).toBe(0);
    expect(weatherOf(minuteAt('ascent_foot', night)).darkness).toBe(0);
    const open = weatherOf(minuteAt('f4_woods_edge', night)).darkness;
    expect(open).toBeGreaterThanOrEqual(0.4);
    expect(open).toBeLessThanOrEqual(1);
    expect(weatherOf(minuteAt('f4_woods_edge', at(3, 12))).darkness).toBe(0);
  });

  it('`combat/darkness` follows the stored place darkness and equals the old factor on the minute', () => {
    for (const [spot, tick] of [
      ['f5_hollows', at(3, 12)],
      ['f0_cell', night],
      ['ascent_foot', night],
      ['f4_woods_edge', night],
      ['f4_woods_edge', at(3, 12)],
    ] as const) {
      const kernel = minuteAt(spot, tick);
      expect(dark(kernel), spot).toBe(left(kernel));
      expect(dark(kernel), spot).toBe(darknessFactor(reads(kernel)));
      sound(kernel);
    }
  });

  it('halves at darkvision 25 and is 0 at darkvision 50', () => {
    const kernel = minuteAt('f5_hollows', at(3, 12));
    expect(skillsOf(kernel).darkvision.level).toBe(1);
    expect(dark(kernel)).toBe(1 - 1 / 50);
    setSkill(kernel, 'darkvision', 25);
    expect(dark(kernel)).toBe(0.5);
    setSkill(kernel, 'darkvision', 50);
    expect(dark(kernel)).toBe(0);
    setSkill(kernel, 'darkvision', 80);
    expect(dark(kernel)).toBe(0);
    sound(kernel);
  });

  it('a darkvision level gained in play moves the stat in the same tick', () => {
    const kernel = gameAt('f5_hollows', at(3, 12) - 1);
    const levels: number[] = [];
    for (let i = 0; i < 3000; i++) {
      kernel.tick();
      expect(kernel.staleStats(), `tick ${i}`).toEqual([]);
      const level = skillsOf(kernel).darkvision?.level ?? 0;
      expect(dark(kernel), `tick ${i}`).toBeCloseTo(1 - Math.min(level, 50) / 50, 12);
      if (levels[levels.length - 1] !== level) levels.push(level);
    }
    // The spot trains darkvision each game minute: the level rose during the run.
    expect(levels.length).toBeGreaterThan(2);
  }, 60_000);

  it('is 0 while the player holds `eyeless`, from the tick it lands to the tick it goes', () => {
    // The old `mutagens.test.ts` case "pays nothing for the dark, however deep".
    const kernel = minuteAt('f5_hollows', at(3, 12));
    expect(dark(kernel)).toBe(left(kernel));
    expect(dark(kernel)).toBeGreaterThan(0.9);
    ask(kernel, applyStatus, { entity: PLAYER, app: { id: 'eyeless', intensity: 1 } });
    expect(darknessFactor(reads(kernel))).toBe(0);
    kernel.tick();
    expect(dark(kernel)).toBe(0);
    sound(kernel);
    ask(kernel, clearStatuses, { entity: PLAYER });
    kernel.tick();
    expect(dark(kernel)).toBe(left(kernel));
    expect(dark(kernel)).toBeGreaterThan(0.9);
    sound(kernel);
    // A save that holds it is right on load, with no tick.
    patch(kernel, (slices) => (slices.statuses.held[PLAYER] = [{ id: 'eyeless', intensity: 1, peak: 1, stacks: 1, ticksLeft: null }]));
    expect(hasStatus(held(kernel), 'eyeless')).toBe(true);
    expect(dark(kernel)).toBe(0);
    sound(kernel);
  });

  it('follows an arrival at once, without waiting for the game minute', () => {
    const kernel = gameAt('f4_treeline', night + 3);
    patch(kernel, (slices) => {
      slices.world.discovered.push('f5_hollows', 'f1_landing');
    });
    const arrive = (spot: string) => {
      patch(kernel, (slices) => (slices.world.spot = spot));
      emit(kernel, arrivedEvent, { spot, from: 'f4_treeline', ambushed: false });
    };
    arrive('f5_hollows');
    expect(weatherOf(kernel).darkness).toBe(1);
    expect(dark(kernel)).toBe(1);
    sound(kernel);
    arrive('f1_landing');
    expect(weatherOf(kernel).darkness).toBe(0);
    expect(dark(kernel)).toBe(0);
    sound(kernel);
  });

  it('stays sound through a night in the open, and the source is the only one on the stat', () => {
    const kernel = gameAt('f4_woods_edge', at(3, 18));
    let seen = 0;
    for (let i = 0; i < 12 * 600; i++) {
      kernel.tick();
      if (i % 7 === 0) expect(kernel.staleStats(), `tick ${i}`).toEqual([]);
      const mods = kernel.modifiers().filter((m) => m.stat === hook.darkness);
      expect(mods.length, `tick ${i}`).toBe(dark(kernel) > 0 ? 1 : 0);
      if (dark(kernel) > 0) seen++;
    }
    // 19:00 to 05:59, less what darkvision removes: it stays under level 50 in one night.
    expect(seen).toBeGreaterThan(8 * 600);
    expect(DARKNESS_SOURCE).toBe('weather/darkness');
  }, 60_000);
});

// ---------- the gale case of derivedcache.test.ts ----------

describe('under a gale on open ground (the old "under a gale on the open ridge")', () => {
  // Floor 17 and its region are step 4. For the duration of the case the
  // Greenwood of floor 4 stands under the mounted mountain sky.
  const TICKS = 3000;
  const f4 = AREAS.ascent_f4_area;
  beforeAll(() => {
    AREAS.ascent_f4_area = { ...f4, skyRegionId: 'malgeri_range' };
  });
  afterAll(() => {
    AREAS.ascent_f4_area = f4;
  });

  /** A strong hunter at the Woods Edge at the start of the first gale. Health is held so no knockout ends the stay. */
  function galeHunter(): Kernel {
    const kernel = gameAt('f4_woods_edge', tickShowing('gale'), (slices) => {
      for (const attr of Object.values((slices.attributes as AttributesState).attrs)) attr.level = 150;
      slices.levels.level = 60;
    });
    const result = kernel.dispatch(selectActivity({ activity: 'hunt' }));
    if (!result.ok) throw new Error(result.reason);
    return kernel;
  }

  it('serves a block equal to a fresh compute on every tick, and rebuilds on a minority of them', () => {
    expect(skyRegionOf('f4_woods_edge')!.id).toBe('malgeri_range');
    const kernel = galeHunter();
    let last = statBlockOf(reads(kernel));
    let rebuilds = 0;
    let buffeted = 0;
    let fights = 0;
    for (let i = 0; i < TICKS; i++) {
      kernel.tick();
      if (hasStatus(held(kernel), 'buffeted')) buffeted++;
      if (slice<CombatState>(kernel, 'combat').fight) fights++;
      expect(kernel.staleStats(), `tick ${i}`).toEqual([]);
      const cur = statBlockOf(reads(kernel));
      if (cur !== last) {
        rebuilds++;
        last = cur;
      }
    }
    expect(slice<{ spot: string }>(kernel, 'world').spot).toBe('f4_woods_edge');
    expect(slice<{ recovering: boolean }>(kernel, 'world').recovering).toBe(false);
    expect(fights).toBeGreaterThan(0);
    // The gale must be on the character, or the count means nothing.
    expect(buffeted).toBeGreaterThan(TICKS / 2);
    // The old bound: only the dose, the expiry and the fights rebuild the block.
    expect(rebuilds).toBeLessThan(TICKS / 4);
  }, 120_000);
});

// ---------- determinism ----------

describe('determinism', () => {
  /** A character that walks out under the sky of floor 0 and trains there. */
  function scripted(seed: number, split?: number): Kernel {
    let kernel = makeGame({ seed });
    patch(kernel, (slices) => {
      slices.world.spot = 'f0_field';
      slices.world.discovered.push('f0_field');
    });
    const total = 3000;
    const first = split ?? total;
    kernel.tick(first);
    if (split !== undefined) {
      const envelope = JSON.parse(JSON.stringify(kernel.save(0)));
      kernel = makeGame({ seed: 999 });
      const loaded = kernel.load(envelope);
      if (!loaded.ok) throw new Error(loaded.error);
      kernel.tick(total - first);
    }
    return kernel;
  }

  it('the seed is one draw of the kernel generator, at the first game minute under an open sky', () => {
    const roofed = makeGame({ seed: 5 });
    roofed.tick(600);
    expect(weatherOf(roofed).seed).toBeNull();

    const kernel = makeGame({ seed: 5 });
    patch(kernel, (slices) => {
      slices.world.spot = 'f0_field';
      slices.world.discovered.push('f0_field');
    });
    kernel.tick(9);
    expect(weatherOf(kernel).seed).toBeNull();
    kernel.tick();
    const seed = weatherOf(kernel).seed;
    expect(Number.isInteger(seed) && seed! >= 0 && seed! < 4294967296).toBe(true);
    kernel.tick(600);
    expect(weatherOf(kernel).seed).toBe(seed);
  });

  it('the same seed and the same commands give the same weather slice; another seed gives another sky', () => {
    expect(weatherOf(scripted(11))).toEqual(weatherOf(scripted(11)));
    expect(scripted(11).snapshot()).toEqual(scripted(11).snapshot());
    expect(weatherOf(scripted(11)).seed).not.toBe(weatherOf(scripted(12)).seed);
  });

  it('a save and a load in the middle change nothing', () => {
    const whole = scripted(11);
    for (const split of [5, 1234, 2990]) {
      const halves = scripted(11, split);
      expect(weatherOf(halves), `split at ${split}`).toEqual(weatherOf(whole));
      expect(halves.snapshot(), `split at ${split}`).toEqual(whole.snapshot());
      expect(halves.staleStats()).toEqual([]);
    }
  });
});
