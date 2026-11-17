/**
 * Weather and exposure. Port of the old `systems/weather.ts` (in `sample.ts`),
 * `systems/exposure.ts` (this file) and the weather tables of
 * `data/climate.data.ts` (in `defs.ts`). See README.md in this folder.
 *
 * Exposure: the place trains the body that stands in it.
 * - Weather, per game minute, from the sampled sky over the region.
 * - Places, per game minute: an element tag on the region, area or spot.
 * - Work, per completed cycle: an element tag on the activity.
 * - Darkness, per game minute, trains `darkvision`, and darkvision lowers
 *   the darkness penalties of combat.
 */
import { defineSystem, on, PLAYER, registry, type Ctx, type DeepReadonly, type SystemDef } from '../../kernel';
import clock, { clockOf, moonlight, TICKS_PER_GAME_MINUTE, totalTicksOf, type MoonState } from '../clock';
import combat, { hook, naturalDarkness, registerSiteSky } from '../combat';
import counters, { counterValue, raiseCounter } from '../counters';
import { fillText, logLine, textSchema, type TextRecord } from '../log';
import skills, { checkDiscovery, grantSkillXp, skillLevel } from '../skills';
import statuses, { applyStatuses, hasStatus, heldOf, HELD_SOURCE } from '../statuses';
import world, { arrived, cycleDone, placeTags, skyRegionOf, SPOTS, type RegionDef } from '../world';
import weatherTextData from './content/weather_text.json';
import {
  CALM_SEEN_KEY,
  SKY_RULES,
  skyRules,
  skyTables,
  terrains,
  WEATHER_SOURCE_PREFIX,
  type WeatherKind,
} from './defs';
import { migrations } from './migrations';
import { climateBaseline, tempBand, weatherAt, WEATHER_ICONS, type TempBand, type WeatherSample } from './sample';

export * from './defs';
export * from './sample';
export { naturalDarkness };
export { DARK_DODGE_PENALTY, DARK_MISS_CHANCE } from '../combat';

// ---- slice ----

export interface WeatherState {
  /**
   * The seed of the noise field and of the sky tables. Null until the first
   * game minute under an open sky that has an atlas pin; then one draw of
   * the kernel generator, never changed.
   */
  seed: number | null;
  /** The darkness of the place, 0 to 1, before darkvision and `eyeless`. Sampled each game minute and on arrival. */
  darkness: number;
  /** Whether the player held `eyeless` at the last tick. Bookkeeping for the touch of `weather/darkness`. */
  eyeless: boolean;
}

/** What a read of this system needs. */
export type Reads = { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

// ---- text ----

const weatherText = registry(textSchema, weatherTextData, 'Weather text');
const TEXT = Object.fromEntries((weatherTextData as TextRecord[]).map((r) => [r.id, r.text]));

/** The one line that names calm before the player has stood under it. */
export const firstCalmLine = (): string => fillText(TEXT.calm_first, { icon: WEATHER_ICONS.calm });

// ---- vocabulary ----

/** Damage types a place or an activity may radiate. Physical types are not weather. */
export const ELEMENT_TAGS = new Set(['heat', 'cold', 'water', 'wind', 'earth', 'lightning', 'poison', 'arcane', 'light', 'dark']);

/** Place tags that are not elements and have a rule. */
export const PLACE_TAGS = new Set(['indoor', 'settlement']);

// ---- tuning ----

/** Resist XP per game minute of standing in weather that qualifies. */
export const WEATHER_XP_PER_MINUTE = 0.1;
/** Resist XP per game minute per element tag on the place. */
export const SPOT_XP_PER_MINUTE = 0.05;
/** Darkvision XP per game minute of full darkness. */
export const DARKNESS_XP_PER_MINUTE = 0.1;
/** Exposure XP per tick of the base cycle time of an element-tagged activity. */
export const ACTIVITY_XP_PER_TICK = 0.02;

/** Degrees Celsius at and above which heat trains, at and below which cold trains. */
export const HEAT_TRAINS_AT = 32;
export const COLD_TRAINS_AT = -5;
/** A clear daytime sky this far above the baseline trains light. */
export const UNSEASONABLY_BRIGHT = 6;

/** The level at which darkvision removes the darkness penalties. */
export const DARKVISION_CEILING = 50;

/** Share of the open night sky's darkness that moonlight 1 removes: the brightest night is 0.4 dark. */
export const MOONLIGHT_MAX = 0.6;
/** How much moonlight each sky lets through. Keyed on the weather kind. */
export const MOONLIGHT_THROUGH: Record<WeatherKind, number> = {
  still: 1,
  clear: 1,
  mist: 0.5,
  gale: 0.5,
  overcast: 0,
  rain: 0,
  storm: 0,
  snow: 0,
  blizzard: 0,
  sandstorm: 0,
  heatwave: 1,
  calm: 1,
};

// ---- weather to elements ----

/** The elements each sky trains, as shares of the base rate. */
const KIND_EXPOSURE: Partial<Record<WeatherKind, [string, number][]>> = {
  rain: [['water', 1]],
  storm: [
    ['wind', 0.65],
    ['water', 0.3],
    ['lightning', 0.05],
  ],
  gale: [['wind', 1]],
  // The cold of a blizzard arrives by the temperature rule.
  blizzard: [['wind', 1]],
  sandstorm: [
    ['wind', 0.8],
    ['earth', 0.2],
  ],
  heatwave: [['heat', 1]],
};

/** The elements a sky trains, with their shares of the base rate. */
export function weatherExposure(sample: WeatherSample, baselineTemp: number, hour: number): [string, number][] {
  const out: [string, number][] = [...(KIND_EXPOSURE[sample.kind] ?? [])];
  // A heatwave pays heat by its kind; its temperature does not pay it twice.
  if (sample.temp >= HEAT_TRAINS_AT && !out.some(([element]) => element === 'heat')) out.push(['heat', 1]);
  if (sample.temp <= COLD_TRAINS_AT) out.push(['cold', 1]);
  // Glare: a clear daytime sky well above what the season gives.
  if (sample.kind === 'clear' && hour >= 7 && hour <= 17 && sample.temp - baselineTemp >= UNSEASONABLY_BRIGHT) {
    out.push(['light', 1]);
  }
  return out;
}

// ---- darkness ----

/** Moonlight reaching the ground, 0 to 1. No sample (no pin, no seed) means no clouds. */
export function moonlightThrough(moons: readonly MoonState[], kind: WeatherKind | null): number {
  return moonlight(moons) * (kind ? MOONLIGHT_THROUGH[kind] : 1);
}

/** The darkness of the open sky at this hour under `lit` moonlight (0 to 1). */
export function skyDarkness(hour: number, lit: number): number {
  return naturalDarkness(hour) * (1 - MOONLIGHT_MAX * lit);
}

/** Where a spot is: the spot, the region of its sky, the tags of region, area and spot. */
function placeAt(spotId: string) {
  return { spot: SPOTS[spotId], region: skyRegionOf(spotId), tags: placeTags(spotId) };
}

function kindOver(seed: number | null, region: RegionDef | undefined, totalTicks: number): WeatherKind | null {
  if (seed === null || !region) return null;
  return weatherAt(seed, region, totalTicks)?.kind ?? null;
}

/**
 * The sky kind over a spot, or null where there is no open sky: a sheltered
 * region or area, an `indoor` place, a region with no atlas pin. Also null
 * while the seed is not drawn. Encounter lines with `sky` and the sky rules
 * both ask this.
 */
export function skyKindAt(ctx: Reads, spotId: string): WeatherKind | null {
  return openSkyKind(ctx.read(weather).seed, spotId, totalTicksOf(ctx.read(clock)));
}

function openSkyKind(seed: number | null, spotId: string, totalTicks: number): WeatherKind | null {
  const { region, tags } = placeAt(spotId);
  if (!region || region.sheltered || tags.has('indoor')) return null;
  return kindOver(seed, region, totalTicks);
}

/**
 * How dark a place is, 0 to 1, before darkvision. A `dark` tag is 1 at every
 * hour. Otherwise it is the darkness of the sky, 0 under a roof and in a
 * settlement, lowered by moonlight. `lit` is called only outdoors at night.
 */
export function placeDarkness(
  region: { sheltered?: boolean } | undefined,
  tags: ReadonlySet<string>,
  hour: number,
  lit: () => number = () => 0,
): number {
  if (tags.has('dark')) return 1;
  if (region?.sheltered || tags.has('indoor') || tags.has('settlement')) return 0;
  if (naturalDarkness(hour) === 0) return 0;
  return skyDarkness(hour, lit());
}

/** The place darkness where the player stands, computed now. While travelling the spot is the place left. */
function placeDarknessNow(seed: number | null, spotId: string, totalTicks: number): number {
  const { region, tags } = placeAt(spotId);
  const now = clockOf(totalTicks);
  return placeDarkness(region, tags, now.hour, () => moonlightThrough(now.moons, kindOver(seed, region, totalTicks)));
}

/**
 * The moonlight on the player now, for a darkness readout: null unless the
 * darkness around them is that of the open night sky.
 */
export function moonlightOn(ctx: Reads): { lit: number; kind: WeatherKind | null } | null {
  const { region, tags } = placeAt(ctx.read(world).spot);
  const totalTicks = totalTicksOf(ctx.read(clock));
  const now = clockOf(totalTicks);
  if (tags.has('dark') || placeDarkness(region, tags, now.hour) === 0) return null;
  const kind = kindOver(ctx.read(weather).seed, region, totalTicks);
  return { lit: moonlightThrough(now.moons, kind), kind };
}

/** What darkvision and `eyeless` leave of a place darkness. */
function factorOf(dark: number, ctx: Reads): number {
  // Darkness taxes through sight. A body with no eyes pays nothing.
  if (hasStatus(heldOf(ctx.read(statuses)), 'eyeless')) return 0;
  if (dark === 0) return 0;
  const level = Math.min(skillLevel(ctx.read(skills), 'darkvision'), DARKVISION_CEILING);
  return dark * (1 - level / DARKVISION_CEILING);
}

/**
 * The share of the darkness penalties the player pays, 0 to 1, computed now
 * from the place, the clock and the sky. The old `darknessFactor`. Combat
 * reads the stat `combat/darkness`, which holds the same formula over the
 * place darkness stored in the slice.
 */
export function darknessFactor(ctx: Reads): number {
  return factorOf(placeDarknessNow(ctx.read(weather).seed, ctx.read(world).spot, totalTicksOf(ctx.read(clock))), ctx);
}

// ---- sunlight ----

/** How much of the sun each sky lets through, 0 to 1. */
export const SUN_SHARE: Record<WeatherKind, number> = {
  clear: 1,
  still: 1,
  gale: 0.8,
  mist: 0.5,
  overcast: 0.4,
  snow: 0.3,
  rain: 0.2,
  sandstorm: 0.2,
  storm: 0.1,
  blizzard: 0.05,
  heatwave: 1,
  calm: 1,
};

/**
 * Sunlight on the player, 0 to 1. 0 under a roof (a sheltered region or an
 * `indoor` tag) and on a `dark` tag. Otherwise the daylight of the hour
 * times the share of the weather kind; no sample reads as clear. A lamplit
 * street at midnight is 0: lamplight is not sun. No system reads it yet.
 */
export function sunlight(ctx: Reads): number {
  const { region, tags } = placeAt(ctx.read(world).spot);
  if (!region || region.sheltered || tags.has('indoor') || tags.has('dark')) return 0;
  const totalTicks = totalTicksOf(ctx.read(clock));
  const day = 1 - naturalDarkness(clockOf(totalTicks).hour);
  if (day === 0) return 0;
  const kind = kindOver(ctx.read(weather).seed, region, totalTicks);
  return day * (kind ? SUN_SHARE[kind] : 1);
}

// ---- the modifier source ----

/** States `combat/darkness` for the player. */
export const DARKNESS_SOURCE = 'weather/darkness';

type W = Ctx<WeatherState>;

function setDarkness(ctx: W, darkness: number): void {
  if (ctx.state.darkness === darkness) return;
  ctx.state.darkness = darkness;
  ctx.touch(DARKNESS_SOURCE, PLAYER);
}

/**
 * `statuses/held` is not touched when `eyeless` lands or goes: the condition
 * has no modifier of its own. This check runs on every tick and touches the
 * source when the answer changed.
 */
function syncEyeless(ctx: W): void {
  const held = hasStatus(heldOf(ctx.read(statuses)), 'eyeless');
  if (held === ctx.state.eyeless) return;
  ctx.state.eyeless = held;
  ctx.touch(DARKNESS_SOURCE, PLAYER);
}

// ---- the tick, once per game minute ----

function grantExposure(ctx: W, element: string, amount: number): void {
  const tags = [`resist:${element}`];
  ctx.emit(checkDiscovery, { tags });
  ctx.emit(grantSkillXp, { tags, amount });
}

/** The old `tickExposure`, without Weathersense. Also stores the place darkness. */
function tickExposure(ctx: W, spotId: string, totalTicks: number): void {
  const { spot, region, tags } = placeAt(spotId);
  const now = clockOf(totalTicks);
  let sample: WeatherSample | null = null;

  // The sky, unless a roof (of the spot or of the whole region) is in the way.
  if (spot && region && !region.sheltered && !tags.has('indoor')) {
    // The first minute under an open sky with a pin draws the seed.
    if (ctx.state.seed === null && region.world) ctx.state.seed = Math.floor(ctx.rng.next() * 4294967296) >>> 0;
    sample = ctx.state.seed === null ? null : weatherAt(ctx.state.seed, region, totalTicks);
    if (sample) {
      const base = climateBaseline(region, now)!;
      for (const [element, share] of weatherExposure(sample, base.temp, now.hour)) {
        grantExposure(ctx, element, WEATHER_XP_PER_MINUTE * share);
      }
    }
  }

  // The night sky away from lamplight, or a place tagged `dark`. Moonlight
  // lowers the XP by the same number that lowers the combat penalties.
  const darkness = placeDarkness(region, tags, now.hour, () => moonlightThrough(now.moons, sample?.kind ?? null));
  setDarkness(ctx, darkness);
  if (!spot || !region) return ctx.skip('weather/exposure', `no spot or no region for "${spotId}"`);
  if (darkness > 0) {
    ctx.emit(checkDiscovery, { tags: ['darkness'] });
    ctx.emit(grantSkillXp, { tags: ['darkness'], amount: DARKNESS_XP_PER_MINUTE * darkness });
  }

  // The ground: every element tag of region, area and spot.
  for (const tag of tags) {
    if (ELEMENT_TAGS.has(tag)) grantExposure(ctx, tag, SPOT_XP_PER_MINUTE);
  }
}

/**
 * The old `tickSky`. Only a region with a sky table has rules: the
 * noise-field weather of every other region applies no condition. Under an
 * open sky it applies the rule of the kind on every minute its `every`
 * divides. The player's doses are resisted; `foes` land on the enemies of
 * the open fight.
 */
function tickSky(ctx: W, spotId: string, totalTicks: number): void {
  if (!skyRegionOf(spotId)?.sky) return;
  const kind = openSkyKind(ctx.state.seed, spotId, totalTicks);
  if (!kind) return;

  if (kind === 'calm' && counterValue(ctx.read(counters), CALM_SEEN_KEY) < 1) {
    ctx.emit(raiseCounter, { key: CALM_SEEN_KEY, value: 1 });
    ctx.emit(logLine, { msg: firstCalmLine(), kind: 'info' });
  }

  const rule = SKY_RULES[kind];
  if (!rule || (totalTicks / TICKS_PER_GAME_MINUTE) % rule.every !== 0) return;
  const source = `${WEATHER_SOURCE_PREFIX}${kind}`;
  // One request for the list: the doses read one stat table, as the old loop
  // passed one stat block. A dose with `chance` is rolled by the status system.
  ctx.request(applyStatuses, { entity: PLAYER, apps: rule.self, source, resist: true });
  if (!rule.foes) return;
  for (const enemy of ctx.read(combat).fight?.enemies ?? []) {
    if (enemy) ctx.request(applyStatuses, { entity: enemy.entity, apps: rule.foes, source });
  }
}

// ---- view ----

export interface WeatherView {
  /** Null under a roof, with no pin, and before the seed is drawn. */
  kind: WeatherKind | null;
  icon: string | null;
  band: TempBand | null;
  /** Degrees Celsius, rounded. */
  temp: number | null;
  /** The place darkness of the slice, 0 to 1. */
  darkness: number;
}

// ---- the system ----

const weather = defineSystem<WeatherState, WeatherView>({
  id: 'weather',
  version: 1,
  migrations,
  // Last: the old loop ran exposure after the pools, the activity and the fight.
  order: 20,
  initial: () => ({ seed: null, darkness: 0, eyeless: false }),
  content: { terrains, sky_tables: skyTables, sky_rules: skyRules, weather_text: weatherText },

  modifiers: [
    {
      id: DARKNESS_SOURCE,
      // `skills/effects` is touched on every level-up. `statuses/held` does
      // not cover `eyeless`; `syncEyeless` does.
      dependsOn: ['skills/effects', HELD_SOURCE],
      collect: (ctx) => {
        if (ctx.entity !== PLAYER) return [];
        const value = factorOf(ctx.state.darkness, ctx);
        return value === 0 ? [] : [{ stat: hook.darkness, kind: 'add', value }];
      },
    },
  ],

  tick: (ctx) => {
    syncEyeless(ctx);
    const totalTicks = totalTicksOf(ctx.read(clock));
    if (totalTicks % TICKS_PER_GAME_MINUTE !== 0) return;
    // While travelling the spot is the place left, as in the old loop.
    const spotId = ctx.read(world).spot;
    tickExposure(ctx, spotId, totalTicks);
    tickSky(ctx, spotId, totalTicks);
  },

  events: [
    // The place changed: the stored darkness follows at once.
    on(arrived, (ctx, { payload }) => {
      setDarkness(ctx, placeDarknessNow(ctx.state.seed, payload.spot, totalTicksOf(ctx.read(clock))));
    }),
    // Work exposure. The old `grantActivityExposure`.
    on(cycleDone, (ctx, { payload }) => {
      for (const tag of payload.tags) {
        if (ELEMENT_TAGS.has(tag)) grantExposure(ctx, tag, ACTIVITY_XP_PER_TICK * payload.baseTicks);
      }
    }),
  ],

  view: (ctx) => {
    const { region, tags } = placeAt(ctx.read(world).spot);
    const seed = ctx.state.seed;
    const open = region && !region.sheltered && !tags.has('indoor');
    const sample = open && seed !== null ? weatherAt(seed, region, totalTicksOf(ctx.read(clock))) : null;
    return {
      kind: sample?.kind ?? null,
      icon: sample ? WEATHER_ICONS[sample.kind] : null,
      band: sample ? tempBand(sample.temp) : null,
      temp: sample ? Math.round(sample.temp) : null,
      darkness: ctx.state.darkness,
    };
  },
});

export default weather;

// `sky` encounter lines of combat read the weather over the site. A site id is a spot id.
registerSiteSky((ctx, siteId) => skyKindAt(ctx, siteId));
