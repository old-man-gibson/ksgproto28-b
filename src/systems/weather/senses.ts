/**
 * The two senses that train with no action of their own. Port of the old
 * `systems/weathersense.ts` (all but `noteTravelSkies`, which is in `world`)
 * and of `tickChronosense` of `systems/chronosense.ts` (its readers are in
 * `clock`). The tick of this system calls both trainers: the old loop ran
 * `tickChronosense` right before `tickExposure`, and Weathersense trained
 * inside `tickExposure`.
 *
 * Weather is a pure function of (seed, region, tick), so a forecast is the
 * future sampled. Weathersense decides how far ahead the player may look and
 * how sharply: each row opens at a level and sharpens with the levels after
 * it (rough, fair, precise).
 */
import type { Ctx, DeepReadonly, DerivedReads, SystemDef } from '../../kernel';
import { CHRONOSENSE_MANIFEST_TICKS, CHRONOSENSE_XP_PER_MINUTE, TICKS_PER_GAME_MINUTE } from '../clock';
import { checkDiscovery, grantSkillXp, skillCap, SKILLS, type SkillState } from '../skills';
import { WEATHER_ICONS, weatherAt, type SkyRegion, type WeatherSample } from './sample';

type Emitter = Pick<Ctx<unknown>, 'emit'>;
type CapReads = DerivedReads & { read<T>(system: SystemDef<T, any>): DeepReadonly<T> };

/** Where a sense stands for its trainer. */
export type SenseState = 'locked' | 'training' | 'capped';

/**
 * A held sense at its ceiling with 0 XP: a grant with no novelty key changes
 * nothing then (at the ceiling the skills system discards XP and sets XP to
 * 0), so the trainer does not send it. A keyed grant still counts its input
 * there and is sent. The level test comes first: below the base cap no
 * derived read is made.
 */
export function senseState(ctx: CapReads, id: string, held: DeepReadonly<SkillState> | undefined): SenseState {
  if (!held) return 'locked';
  const max = SKILLS[id]?.maxLevel;
  if (max === undefined || held.level < max || held.xp !== 0) return 'training';
  return held.level >= skillCap(ctx, id) ? 'capped' : 'training';
}

// ---- Weathersense ----

export const WEATHERSENSE_ID = 'weathersense';

/** The daily prognosis (the heading and the rows from a day out) opens at this level. */
export const PROGNOSIS_TOOLTIP_AT = 5;

/** XP per game minute under an ordinary open sky. */
export const WATCH_XP_PER_MINUTE = 0.01;
/** XP per game minute in severe weather, before the novelty multiple. */
export const SEVERE_XP_PER_MINUTE = 0.3;

/** Severe by kind. */
const SEVERE_KINDS = new Set(['storm', 'blizzard', 'sandstorm', 'gale']);
/** Severe by temperature alone, degrees Celsius. Exposure trains heat and cold at lower thresholds. */
export const SEVERE_HOT = 37;
export const SEVERE_COLD = -10;

export function isSevere(sample: WeatherSample): boolean {
  return SEVERE_KINDS.has(sample.kind) || sample.temp >= SEVERE_HOT || sample.temp <= SEVERE_COLD;
}

/**
 * One game minute under an open sky with a sample (the old
 * `tickWeathersense`). Severe weather checks discovery (the sense manifests
 * in the first severe minute and that minute pays) and pays by its novelty
 * key; an ordinary sky pays the watch rate with no key, the novelty floor.
 * A grant with no key changes nothing to a sense not held (it does not
 * manifest by XP) or capped (`senseState`), so it is not sent then.
 */
export function trainWeathersense(ctx: Emitter, sample: WeatherSample, sense: SenseState): void {
  if (isSevere(sample)) {
    if (sense === 'locked') ctx.emit(checkDiscovery, { tags: ['weather'] });
    const key = sample.temp >= SEVERE_HOT ? 'wx:scorch' : sample.temp <= SEVERE_COLD ? 'wx:brutal_cold' : `wx:${sample.kind}`;
    ctx.emit(grantSkillXp, { tags: ['weather'], amount: SEVERE_XP_PER_MINUTE, sourceKey: key });
    return;
  }
  if (sense === 'training') ctx.emit(grantSkillXp, { tags: ['weather'], amount: WATCH_XP_PER_MINUTE });
}

// ---- the forecast ----

export interface ForecastRow {
  /** How far ahead the row looks. */
  hours: number;
  /** The level at which the row opens; it sharpens with the levels after it. */
  req: number;
  label: string;
}

/** 2 hours at level 1, tomorrow at 5, out to 7 days at 29 (the cap is 30). */
export const FORECAST_ROWS: readonly ForecastRow[] = [
  { hours: 2, req: 1, label: 'in 2 hours' },
  { hours: 6, req: 2, label: 'in 6 hours' },
  { hours: 12, req: 3, label: 'in 12 hours' },
  { hours: 24, req: 5, label: 'tomorrow' },
  { hours: 48, req: 9, label: 'in 2 days' },
  { hours: 72, req: 13, label: 'in 3 days' },
  { hours: 96, req: 17, label: 'in 4 days' },
  { hours: 120, req: 21, label: 'in 5 days' },
  { hours: 144, req: 25, label: 'in 6 days' },
  { hours: 168, req: 29, label: 'in 7 days' },
];

export type ForecastQuality = 'rough' | 'fair' | 'precise';

/** Rough when a row opens, fair two levels later, precise five levels later. */
export function rowQuality(level: number, req: number): ForecastQuality {
  const past = level - req;
  if (past >= 5) return 'precise';
  if (past >= 2) return 'fair';
  return 'rough';
}

/**
 * The words of a rough read. It never says "calm": that word is a weather
 * kind, named by the fair and precise reads. A calm sky, a heatwave and every
 * dry sky read as "plain skies".
 */
function roughWords(sample: WeatherSample): string {
  const sky =
    sample.kind === 'clear' ||
    sample.kind === 'overcast' ||
    sample.kind === 'mist' ||
    sample.kind === 'still' ||
    sample.kind === 'calm' ||
    sample.kind === 'heatwave'
      ? 'plain skies'
      : sample.kind === 'gale' || sample.kind === 'sandstorm'
        ? 'wild wind'
        : 'wet weather';
  const warmth = sample.temp <= 0 ? 'freezing' : sample.temp <= 12 ? 'chilly' : sample.temp <= 24 ? 'mild' : 'hot';
  return `${sky}, ${warmth}`;
}

export interface ForecastEntry {
  label: string;
  quality: ForecastQuality;
  text: string;
}

/** The rows a level may read, each at the precision it has earned. Stops at the first row with no sample. */
export function forecastFor(level: number, region: SkyRegion, seed: number, nowTicks: number): ForecastEntry[] {
  const out: ForecastEntry[] = [];
  for (const row of FORECAST_ROWS) {
    if (level < row.req) break;
    const sample = weatherAt(seed, region, nowTicks + row.hours * 600);
    if (!sample) break;
    const quality = rowQuality(level, row.req);
    const text =
      quality === 'rough'
        ? roughWords(sample)
        : quality === 'fair'
          ? `${WEATHER_ICONS[sample.kind]} ${sample.kind}, ${sample.band}`
          : `${WEATHER_ICONS[sample.kind]} ${sample.kind} · ${Math.round(sample.temp)}°`;
    out.push({ label: row.label, quality, text });
  }
  return out;
}

// ---- Chronosense ----

/**
 * The old `tickChronosense`, for one tick. Before the sense is held it checks
 * discovery on every tick from one full day lived (no action carries the tag
 * `time`, so this is the only door); once held, every game minute pays every
 * skill the tag `time` trains. The grant has no key: at the ceiling
 * (`senseState` 'capped') it changes nothing and is not sent.
 */
export function trainChronosense(ctx: Emitter, totalTicks: number, sense: SenseState): void {
  if (sense === 'locked') {
    if (totalTicks >= CHRONOSENSE_MANIFEST_TICKS) ctx.emit(checkDiscovery, { tags: ['time'] });
    return;
  }
  if (sense === 'training' && totalTicks % TICKS_PER_GAME_MINUTE === 0) {
    ctx.emit(grantSkillXp, { tags: ['time'], amount: CHRONOSENSE_XP_PER_MINUTE });
  }
}
