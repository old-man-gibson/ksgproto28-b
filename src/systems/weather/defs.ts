/**
 * The weather registries and the constants of the noise field. Port of the
 * weather half of the old `data/climate.data.ts`.
 */
import { registry, s, type RecordOf } from '../../kernel';
import { SEASONS, type SeasonId } from '../clock';
import skyRulesData from './content/sky_rules.json';
import skyTablesData from './content/sky_tables.json';
import terrainsData from './content/terrains.json';

// ---- sky kinds ----

/**
 * Every sky a region can show. The first ten come from `classify` over the
 * noise field. `heatwave` and `calm` come only from a sky table.
 */
export const WEATHER_KINDS = [
  'still',
  'clear',
  'overcast',
  'mist',
  'rain',
  'storm',
  'snow',
  'blizzard',
  'gale',
  'sandstorm',
  'heatwave',
  'calm',
] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

// ---- registries ----

export const terrains = registry(
  s.object({
    id: s.id(),
    temp: s.number({ help: 'Degrees Celsius added to the baseline.' }),
    precipMult: s.number({ min: 0 }),
    windMult: s.number({ min: 0 }),
    swingMult: s.number({ min: 0, help: 'Scales the seasonal and the day and night temperature swing.' }),
  }),
  terrainsData,
  'Terrains',
);

const frontValues = {
  temp: s.number({ help: 'Degrees Celsius. Absolute, not an offset from the baseline.' }),
  precip: s.number({ min: 0, max: 1 }),
  wind: s.number({ min: 0, max: 1 }),
};

export const skyTables = registry(
  s.object({
    id: s.id(),
    fronts: s.array(s.object({ kind: s.enum(WEATHER_KINDS), weight: s.number({ min: 0 }), ...frontValues })),
    calm: s.object(frontValues),
    excluded: s.array(s.object({ season: s.enum(SEASONS), kind: s.enum(WEATHER_KINDS) }), {
      help: 'The one front kind each season never draws.',
    }),
  }),
  skyTablesData,
  'Sky tables',
);

const dose = s.object({
  id: s.ref('statuses'),
  intensity: s.number({ min: 0 }),
  chance: s.optional(s.number({ min: 0, max: 1 })),
});

export const skyRules = registry(
  s.object({
    id: s.enum(WEATHER_KINDS),
    every: s.number({ min: 1, integer: true, help: 'Game minutes between doses.' }),
    self: s.array(dose),
    foes: s.optional(s.array(dose)),
  }),
  skyRulesData,
  'Sky rules',
);

// ---- types and lookups ----

export type TerrainId = 'plains' | 'forest' | 'hills' | 'mountains' | 'coast' | 'desert' | 'volcanic' | 'caves';
export type TerrainProfile = Omit<RecordOf<typeof terrains>, 'id'>;

/** One front: the values `classify` reads, and the weight it is drawn with. */
export interface FrontDef {
  kind: WeatherKind;
  weight: number;
  temp: number;
  precip: number;
  wind: number;
}

export interface SkyTable {
  fronts: FrontDef[];
  /** The one front kind each season never draws. */
  excluded: Partial<Record<SeasonId, WeatherKind>>;
  /** The values calm carries. Calm is never drawn as a front. */
  calm: { temp: number; precip: number; wind: number };
}

export interface SkyDose {
  id: string;
  intensity: number;
  chance?: number;
}

export interface SkyRule {
  every: number;
  self: SkyDose[];
  foes?: SkyDose[];
}

export const TERRAIN_PROFILES: Record<string, TerrainProfile> = Object.fromEntries(
  (terrainsData as RecordOf<typeof terrains>[]).map(({ id, ...profile }) => [id, profile]),
);

export const SKY_TABLES: Record<string, SkyTable> = Object.fromEntries(
  (skyTablesData as RecordOf<typeof skyTables>[]).map((t) => [
    t.id,
    {
      fronts: t.fronts as FrontDef[],
      calm: t.calm,
      excluded: Object.fromEntries(t.excluded.map((e) => [e.season, e.kind])) as Partial<Record<SeasonId, WeatherKind>>,
    },
  ]),
);

export const SKY_RULES: Partial<Record<WeatherKind, SkyRule>> = Object.fromEntries(
  (skyRulesData as unknown as ({ id: WeatherKind } & SkyRule)[]).map(({ id, ...rule }) => [id, rule]),
);

// ---- the climate ----

/**
 * The temperature geography, in atlas coordinates (y grows south). The pole
 * and the equator may lie off the drawn map.
 */
export const WORLD_CLIMATE = {
  /** Atlas y of the equator and of the pole. */
  equatorY: 90,
  polarY: -30,
  /** Annual mean surface temperature at each, degrees Celsius. */
  equatorTemp: 32,
  polarTemp: -18,
  /** Seasonal swing amplitude at the pole. Scales toward 0 at the equator. */
  seasonalSwing: 14,
  /** Day and night swing amplitude, warmest at 14:00. */
  diurnalSwing: 6,
  /** Baseline precipitation and wind (0 to 1) before the terrain. */
  precipBase: 0.45,
  windBase: 0.3,
} as const;

/** What one standard deviation of the anomaly field adds to each variable. */
export const ANOMALY_SCALE = { temp: 5, precip: 0.35, wind: 0.25 } as const;

/**
 * The octaves of the anomaly field: spatial wavelength in atlas units,
 * temporal wavelength in game hours, relative amplitude.
 */
export const ANOMALY_OCTAVES: { space: number; hours: number; amp: number }[] = [
  { space: 8, hours: 144, amp: 1 },
  { space: 4, hours: 48, amp: 0.5 },
  { space: 2, hours: 18, amp: 0.3 },
];

// ---- sky tables: fronts and calm ----

/** Game hours one front lasts. Cells start at tick 0, so four fit a day. */
export const FRONT_HOURS = 6;
/** One calm spell in every window of this many game days. */
export const CALM_PERIOD_DAYS = 12;
/** Game hours one calm spell lasts. */
export const CALM_HOURS = 8;

/**
 * The counter set to 1 the first time the character stands under a calm sky.
 * The log line `exposure.calm_first` is the one text that names calm before
 * then.
 */
export const CALM_SEEN_KEY = 'flag:malgeri_calm_seen';

/**
 * Thresholds `classify` applies only to the values of a sky table: a dry sky
 * at or above `heatwaveTemp` is a heatwave, a dry sky with wind at or below
 * `calmWind` is calm.
 */
export const SKY_THRESHOLDS = { heatwaveTemp: 35, calmWind: 0.05, dryPrecip: 0.18 } as const;

/**
 * The source of a condition the sky rules apply is this prefix and the sky
 * kind ("Weather: storm"). The status system owns the constant and reads the
 * prefix: a condition held under a weather source never makes the bearer
 * drop the weapon.
 */
export { WEATHER_SOURCE_PREFIX } from '../statuses';
