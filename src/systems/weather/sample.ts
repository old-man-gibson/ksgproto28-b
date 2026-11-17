/**
 * Weather is sampled, not simulated: a pure function of (seed, region, tick).
 * Port of the old `systems/weather.ts`. Two parts per variable:
 *
 * - a climate baseline from the atlas pin of the region (latitude), its
 *   terrain profile and the calendar;
 * - an anomaly from a seeded noise field over (atlas x, y, time). The base
 *   octave spans two or three region spacings, so neighbours agree.
 *
 * A region with `sky` set draws fronts (a weighted draw every `FRONT_HOURS`)
 * and one calm spell per `CALM_PERIOD_DAYS` in place of the noise.
 */
import { clockOf, HOURS_PER_DAY, MINUTES_PER_HOUR, TICKS_PER_GAME_MINUTE, type SeasonId, type WorldClock } from '../clock';
import type { RegionDef } from '../world';
import {
  ANOMALY_OCTAVES,
  ANOMALY_SCALE,
  CALM_HOURS,
  CALM_PERIOD_DAYS,
  FRONT_HOURS,
  SKY_TABLES,
  SKY_THRESHOLDS,
  TERRAIN_PROFILES,
  WORLD_CLIMATE,
  type FrontDef,
  type SkyTable,
  type WeatherKind,
} from './defs';

/** What the sample reads of a region. A `RegionDef` of the world system fits. */
export type SkyRegion = Pick<RegionDef, 'id' | 'world' | 'terrain' | 'sky' | 'sheltered'>;

// ---- seeded noise ----

/**
 * A 32-bit mix of a number into a weather seed. The old build fed it the
 * save's `createdAt`. Here the seed is a draw of the kernel generator (see
 * README.md); this function is kept for the tests.
 */
export function worldSeedOf(createdAt: number): number {
  let h = (createdAt ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^= h >>> 16) >>> 0;
}

/** Lattice hash to [0, 1). */
function hash3(seed: number, cx: number, cy: number, ct: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ Math.imul(cx | 0, 0x9e3779b1), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15) ^ Math.imul(cy | 0, 0xc2b2ae35), 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 13) ^ Math.imul(ct | 0, 0x165667b1), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(u: number): number {
  return u * u * (3 - 2 * u);
}

/** Trilinear value noise on the lattice of one octave, centred on zero. */
function valueNoise(seed: number, x: number, y: number, t: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const t0 = Math.floor(t);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const ft = smooth(t - t0);

  let sum = 0;
  for (let dx = 0; dx <= 1; dx++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dt = 0; dt <= 1; dt++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dt ? ft : 1 - ft);
        sum += w * (hash3(seed, x0 + dx, y0 + dy, t0 + dt) - 0.5);
      }
    }
  }
  return sum;
}

/** Puts the summed octaves at unit variance. `tests/weather.test.ts` checks it. */
const NOISE_NORM = 4.67;

export type AnomalyChannel = 'temp' | 'precip' | 'wind';
const CHANNEL_SALT: Record<AnomalyChannel, number> = { temp: 0x51ab, precip: 0xa11ce, wind: 0x3a57 };

/**
 * The anomaly field: about standard normal, smooth in space and time. `x` and
 * `y` in atlas units, `hours` in game hours since the epoch.
 */
export function anomalyAt(seed: number, channel: AnomalyChannel, x: number, y: number, hours: number): number {
  let sum = 0;
  for (let i = 0; i < ANOMALY_OCTAVES.length; i++) {
    const o = ANOMALY_OCTAVES[i];
    const octaveSeed = (seed ^ CHANNEL_SALT[channel] ^ Math.imul(i + 1, 0x9e3779b1)) | 0;
    sum += o.amp * valueNoise(octaveSeed, x / o.space, y / o.space, hours / o.hours);
  }
  return sum * NOISE_NORM;
}

// ---- climate baseline ----

export interface WeatherValues {
  /** Degrees Celsius. */
  temp: number;
  /** 0 to 1. */
  precip: number;
  /** 0 to 1. */
  wind: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** The sky before the anomaly: pin latitude, terrain, calendar. Null with no pin. */
export function climateBaseline(region: SkyRegion, clock: WorldClock): WeatherValues | null {
  if (!region.world) return null;
  const c = WORLD_CLIMATE;
  const profile = TERRAIN_PROFILES[region.terrain ?? 'plains'];
  const shelter = region.sheltered ? 0.3 : 1;

  /** 0 at the equator, 1 at the pole. */
  const lat = clamp01((c.equatorY - region.world.y) / (c.equatorY - c.polarY));
  const mean = c.equatorTemp + (c.polarTemp - c.equatorTemp) * lat;
  const seasonal = c.seasonalSwing * lat * profile.swingMult * shelter * clock.seasonPhase;
  const hourFrac = clock.hour + clock.minute / MINUTES_PER_HOUR;
  const diurnal = c.diurnalSwing * profile.swingMult * shelter * Math.cos((2 * Math.PI * (hourFrac - 14)) / HOURS_PER_DAY);

  return {
    temp: mean + profile.temp + seasonal + diurnal,
    precip: region.sheltered ? 0 : clamp01(c.precipBase * profile.precipMult),
    wind: region.sheltered ? 0 : clamp01(c.windBase * profile.windMult),
  };
}

// ---- the sample ----

export type TempBand = 'freezing' | 'cold' | 'mild' | 'warm' | 'hot';

/** One glyph per sky. */
export const WEATHER_ICONS: Record<WeatherKind, string> = {
  still: '🕳️',
  clear: '☀️',
  overcast: '☁️',
  mist: '🌫️',
  rain: '🌧️',
  storm: '⛈️',
  snow: '🌨️',
  blizzard: '❄️',
  gale: '💨',
  sandstorm: '🌪️',
  heatwave: '🌡️',
  calm: '🕊️',
};

export interface WeatherSample extends WeatherValues {
  kind: WeatherKind;
  band: TempBand;
}

export function tempBand(temp: number): TempBand {
  if (temp <= 0) return 'freezing';
  if (temp <= 8) return 'cold';
  if (temp <= 19) return 'mild';
  if (temp <= 28) return 'warm';
  return 'hot';
}

/**
 * The kind of a sky, from its three values. `extended` is true only for the
 * values of a sky table: it adds `heatwave` and `calm`, which the noise path
 * never produces.
 */
export function classify(
  values: WeatherValues,
  terrain: string | undefined,
  sheltered: boolean | undefined,
  extended = false,
): WeatherKind {
  if (sheltered || terrain === 'caves') return 'still';
  if (extended && values.precip < SKY_THRESHOLDS.dryPrecip) {
    if (values.temp >= SKY_THRESHOLDS.heatwaveTemp) return 'heatwave';
    if (values.wind <= SKY_THRESHOLDS.calmWind) return 'calm';
  }
  const freezing = values.temp <= 0;
  if (values.precip > 0.62) {
    if (freezing) return values.wind > 0.6 ? 'blizzard' : 'snow';
    return values.wind > 0.6 ? 'storm' : 'rain';
  }
  if (terrain === 'desert' && values.wind > 0.65 && values.precip < 0.2) return 'sandstorm';
  if (values.wind > 0.72) return 'gale';
  if (values.precip > 0.45) return freezing ? 'snow' : 'overcast';
  if (values.precip > 0.35 && values.wind < 0.15) return 'mist';
  if (values.precip < 0.18) return 'clear';
  return 'overcast';
}

// ---- sky tables: fronts and calm ----

/** FNV-1a over a string, for folding a region id into the sky draws. */
function idHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** 32-bit avalanche finalizer (murmur3 fmix32). */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const SALT_FRONT = 0x1f407;
const SALT_CALM = 0xca17;

/** One draw in [0, 1) for (seed, region id, cell index), per purpose. */
function skyDraw(seed: number, regionId: string, index: number, salt: number): number {
  let h = fmix((seed ^ salt) + Math.imul(idHash(regionId), 0x9e3779b1));
  h = fmix(h ^ Math.imul(index | 0, 0x85ebca6b));
  return h / 4294967296;
}

const TICKS_PER_HOUR = TICKS_PER_GAME_MINUTE * MINUTES_PER_HOUR;
/** Ticks in one front. */
export const FRONT_TICKS = FRONT_HOURS * TICKS_PER_HOUR;
const CALM_WINDOW_MINUTES = CALM_PERIOD_DAYS * HOURS_PER_DAY * MINUTES_PER_HOUR;
const CALM_MINUTES = CALM_HOURS * MINUTES_PER_HOUR;

/**
 * The front a table draws for one cell (cell = floor(game hours /
 * FRONT_HOURS)) in a season: weighted over the fronts of the table without
 * the kind the season excludes.
 */
export function frontOfCell(table: SkyTable, season: SeasonId, seed: number, regionId: string, cell: number): FrontDef {
  const drawn = table.fronts.filter((f) => f.kind !== table.excluded[season]);
  const total = drawn.reduce((sum, f) => sum + f.weight, 0);
  let left = skyDraw(seed, regionId, cell, SALT_FRONT) * total;
  for (const f of drawn) {
    left -= f.weight;
    if (left < 0) return f;
  }
  return drawn[drawn.length - 1];
}

/**
 * The calm spell of one `CALM_PERIOD_DAYS` window, as [start, end) in game
 * minutes. The start leaves room for the whole spell, so a spell never
 * straddles two windows and every window holds one.
 */
export function calmSpell(seed: number, regionId: string, window: number): [number, number] {
  const slack = CALM_WINDOW_MINUTES - CALM_MINUTES;
  const start = window * CALM_WINDOW_MINUTES + Math.floor(skyDraw(seed, regionId, window, SALT_CALM) * (slack + 1));
  return [start, start + CALM_MINUTES];
}

/** Whether the calm spell of a region covers this tick. */
export function isCalmAt(seed: number, regionId: string, totalTicks: number): boolean {
  const minute = Math.floor(totalTicks / TICKS_PER_GAME_MINUTE);
  const [start, end] = calmSpell(seed, regionId, Math.floor(minute / CALM_WINDOW_MINUTES));
  return minute >= start && minute < end;
}

/**
 * Samples of sky-table regions, one per game minute. A front changes on a
 * cell boundary (whole hours) and a calm spell on a whole minute, so inside
 * one game minute the sample cannot change. The noise path is not cached: its
 * anomaly moves every tick. The key holds every input, so the cache is not
 * state. Samples are frozen because they are shared.
 */
const SKY_MEMO = new Map<string, WeatherSample>();
const SKY_MEMO_MAX = 4096;

function skySampleAt(seed: number, region: SkyRegion, table: SkyTable, totalTicks: number): WeatherSample {
  const minute = Math.floor(totalTicks / TICKS_PER_GAME_MINUTE);
  const key = `${seed}|${region.id}|${region.sky}|${region.terrain ?? ''}|${minute}`;
  const memo = SKY_MEMO.get(key);
  if (memo) return memo;

  let values: WeatherValues;
  if (isCalmAt(seed, region.id, totalTicks)) {
    values = table.calm;
  } else {
    const cell = Math.floor(totalTicks / FRONT_TICKS);
    values = frontOfCell(table, clockOf(cell * FRONT_TICKS).season, seed, region.id, cell);
  }
  const sample: WeatherSample = Object.freeze({
    temp: values.temp,
    precip: values.precip,
    wind: values.wind,
    kind: classify(values, region.terrain, region.sheltered, true),
    band: tempBand(values.temp),
  });
  if (SKY_MEMO.size >= SKY_MEMO_MAX) SKY_MEMO.clear();
  SKY_MEMO.set(key, sample);
  return sample;
}

/**
 * The sky over one region at one tick. Null for a region with no atlas pin.
 * A region with a sky table draws fronts and calm in place of the noise
 * field, unless it is sheltered, which stays `still`.
 */
export function weatherAt(seed: number, region: SkyRegion, totalTicks: number): WeatherSample | null {
  const table = region.sky ? SKY_TABLES[region.sky] : undefined;
  if (table && region.world && !region.sheltered) return skySampleAt(seed, region, table, totalTicks);
  const clock = clockOf(totalTicks);
  const base = climateBaseline(region, clock);
  if (!base || !region.world) return null;

  const hours = totalTicks / (TICKS_PER_GAME_MINUTE * MINUTES_PER_HOUR);
  const { x, y } = region.world;
  const shelter = region.sheltered ? 0.3 : 1;

  const values: WeatherValues = {
    temp: base.temp + anomalyAt(seed, 'temp', x, y, hours) * ANOMALY_SCALE.temp * shelter,
    precip: region.sheltered ? 0 : clamp01(base.precip + anomalyAt(seed, 'precip', x, y, hours) * ANOMALY_SCALE.precip),
    wind: region.sheltered ? 0 : clamp01(base.wind + anomalyAt(seed, 'wind', x, y, hours) * ANOMALY_SCALE.wind),
  };
  return { ...values, kind: classify(values, region.terrain, region.sheltered), band: tempBand(values.temp) };
}
