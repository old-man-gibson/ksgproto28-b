/**
 * The world clock: the game calendar and the three moons, as a pure function
 * of a tick count. Port of the old `systems/clock.ts` and of the calendar
 * part of `data/climate.data.ts`. See README.md in this folder.
 */
import { defineSystem, registry, s, type DeepReadonly, type RecordOf } from '../../kernel';
import holyDaysData from './content/holy_days.json';
import monthsData from './content/months.json';
import moonPhasesData from './content/moon_phases.json';
import moonsData from './content/moons.json';
import weekdaysData from './content/weekdays.json';
import { migrations } from './migrations';

// ---- calendar constants ----

export const TICKS_PER_GAME_MINUTE = 10;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 28;
export const MONTHS_PER_YEAR = 13;
export const DAYS_PER_QUARTER = 91;
export const MONTH_DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 364
export const DAYS_PER_YEAR = MONTH_DAYS_PER_YEAR + 4; // 368

const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
export const TICKS_PER_DAY = TICKS_PER_GAME_MINUTE * MINUTES_PER_DAY;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

/** A new game opens at 09:00 on the first day. Tick 0 is midnight. */
export const START_TICKS = 9 * 60 * 10;

export const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
export type SeasonId = (typeof SEASONS)[number];

export const MOON_SIZES = ['small', 'medium', 'large'] as const;
export type MoonSize = (typeof MOON_SIZES)[number];

/** Share of full moonlight each moon gives, by size. Sums to 1. */
export const MOONLIGHT_WEIGHT: Record<MoonSize, number> = { large: 0.5, medium: 0.3, small: 0.2 };

export const MOON_PHASE_IDS = [
  'new',
  'waxing_crescent',
  'first_quarter',
  'waxing_gibbous',
  'full',
  'waning_gibbous',
  'last_quarter',
  'waning_crescent',
] as const;
export type MoonPhaseId = (typeof MOON_PHASE_IDS)[number];

// ---- content ----

const months = registry(s.object({ id: s.id(), name: s.string({ minLength: 1 }) }), monthsData, 'Months');
const weekdays = registry(s.object({ id: s.id(), name: s.string({ minLength: 1 }) }), weekdaysData, 'Weekdays');
const holyDays = registry(
  s.object({ id: s.id(), name: s.string({ minLength: 1 }), season: s.enum(SEASONS) }),
  holyDaysData,
  'Holy days',
);
const moons = registry(
  s.object({
    id: s.id(),
    name: s.string({ minLength: 1 }),
    cycleDays: s.number({ min: 1, integer: true, help: 'Month-days per cycle.' }),
    size: s.enum(MOON_SIZES),
  }),
  moonsData,
  'Moons',
);
const moonPhases = registry(
  s.object({ id: s.enum(MOON_PHASE_IDS), name: s.string({ minLength: 1 }) }),
  moonPhasesData,
  'Moon phases',
);

export type MonthDef = RecordOf<typeof months>;
export type HolyDayDef = RecordOf<typeof holyDays>;
export type MoonDef = RecordOf<typeof moons>;
export type MoonPhaseDef = RecordOf<typeof moonPhases>;

export const MONTHS = monthsData as MonthDef[];
export const WEEKDAYS: string[] = (weekdaysData as { name: string }[]).map((day) => day.name);
export const HOLY_DAYS = holyDaysData as HolyDayDef[];
export const MOONS = moonsData as MoonDef[];
export const MOON_PHASES = moonPhasesData as MoonPhaseDef[];

/**
 * 0-based day-of-year positions of the four holy days. Quarter q's holy day
 * falls after (q + 1) x 91 month-days plus the q holy days already passed.
 */
export const HOLY_DAY_INDICES = HOLY_DAYS.map((_, q) => (q + 1) * DAYS_PER_QUARTER + q);

// ---- the reading ----

export interface MoonState extends MoonDef {
  /** 0 to 1 through the cycle: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
  phase: number;
  /** Whole month-days into the cycle, 0 to cycleDays - 1. */
  age: number;
  /** Lit fraction of the disc, 0 at new, 1 at full. */
  illumination: number;
  phaseId: MoonPhaseId;
  phaseName: string;
}

export interface WorldClock {
  /** Whole in-game minutes since the epoch. */
  totalMinutes: number;
  minute: number;
  hour: number;
  /** 0-based absolute day since the epoch. */
  dayIndex: number;
  /** 0-based day inside the year (0 to 367). */
  dayOfYear: number;
  /** 1-based, for display. */
  year: number;
  /** null on a holy day: those days belong to no month. */
  monthIndex: number | null;
  /** 1-based day inside the month; null on a holy day. */
  dayOfMonth: number | null;
  /** 0-based weekday; null on a holy day. */
  weekday: number | null;
  holyDay: HolyDayDef | null;
  season: SeasonId;
  /** +1 at the Summer Solstice, -1 at the Winter Solstice, 0 at both equinoxes. */
  seasonPhase: number;
  /** Every moon, in MOONS order. */
  moons: MoonState[];
}

/** One moon at `monthDays` month-days (fractional) since the epoch. */
function moonOf(moon: MoonDef, monthDays: number): MoonState {
  const days = monthDays % moon.cycleDays;
  const quarter = moon.cycleDays / 4;
  const q = Math.floor(days / quarter);
  // A principal phase names the one day that starts at its exact moment.
  const { id, name } = MOON_PHASES[q * 2 + (days - q * quarter < 1 ? 0 : 1)];
  return {
    ...moon,
    phase: days / moon.cycleDays,
    age: Math.floor(days),
    illumination: (1 - Math.cos((2 * Math.PI * days) / moon.cycleDays)) / 2,
    phaseId: id,
    phaseName: name,
  };
}

/** The moons' combined light above the clouds, 0 (all new) to 1 (all full). */
export function moonlight(moonStates: readonly MoonState[]): number {
  return moonStates.reduce((sum, m) => sum + m.illumination * MOONLIGHT_WEIGHT[m.size], 0);
}

export function clockOf(totalTicks: number): WorldClock {
  const totalMinutes = Math.floor(totalTicks / TICKS_PER_GAME_MINUTE);
  const minuteOfDay = totalMinutes % MINUTES_PER_DAY;
  const dayIndex = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const dayOfYear = dayIndex % DAYS_PER_YEAR;
  const year = Math.floor(dayIndex / DAYS_PER_YEAR) + 1;

  const holy = HOLY_DAY_INDICES.indexOf(dayOfYear);
  // Month-days count 0 to 363, skipping the holy days already passed this year.
  const passed = HOLY_DAY_INDICES.filter((d) => d < dayOfYear).length;
  const monthDay = dayOfYear - passed;

  // The Summer Solstice (dayOfYear 183) sits on the peak: its centre is 184
  // days after the Winter Solstice's, and 184 is half of 368.
  const seasonPhase = Math.cos((2 * Math.PI * (dayOfYear - HOLY_DAY_INDICES[1])) / DAYS_PER_YEAR);
  // Seasons are centred on their holy days.
  const season = SEASONS[Math.floor(((dayOfYear + 46) % DAYS_PER_YEAR) / (DAYS_PER_YEAR / 4))];

  // The moons count month-days only, so on a holy day they hold where the day
  // before left them.
  const monthDays =
    (year - 1) * MONTH_DAYS_PER_YEAR + monthDay + (holy >= 0 ? 0 : minuteOfDay / MINUTES_PER_DAY);

  return {
    totalMinutes,
    minute: minuteOfDay % MINUTES_PER_HOUR,
    hour: Math.floor(minuteOfDay / MINUTES_PER_HOUR),
    dayIndex,
    dayOfYear,
    year,
    monthIndex: holy >= 0 ? null : Math.floor(monthDay / DAYS_PER_MONTH),
    dayOfMonth: holy >= 0 ? null : (monthDay % DAYS_PER_MONTH) + 1,
    weekday: holy >= 0 ? null : monthDay % DAYS_PER_WEEK,
    holyDay: holy >= 0 ? HOLY_DAYS[holy] : null,
    season,
    seasonPhase,
    moons: MOONS.map((m) => moonOf(m, monthDays)),
  };
}

// ---- display ----

const ORDINAL_RULES = new Intl.PluralRules('en', { type: 'ordinal' });
const ORDINAL_SUFFIX: Record<string, string> = { one: 'st', two: 'nd', few: 'rd', other: 'th' };

function ordinal(n: number): string {
  return `${n}${ORDINAL_SUFFIX[ORDINAL_RULES.select(n)]}`;
}

/** "Thirdday, 5th of First Month, Year 2", or "Summer Solstice, Year 2". */
export function formatDate(clock: WorldClock): string {
  if (clock.holyDay) return `${clock.holyDay.name}, Year ${clock.year}`;
  const month = MONTHS[clock.monthIndex!];
  return `${WEEKDAYS[clock.weekday!]}, ${ordinal(clock.dayOfMonth!)} of ${month.name}, Year ${clock.year}`;
}

/** "07:05". 24-hour. */
export function formatTime(clock: WorldClock): string {
  return `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
}

/** One glyph per phase. */
export const MOON_ICONS: Record<MoonPhaseId, string> = {
  new: '🌑',
  waxing_crescent: '🌒',
  first_quarter: '🌓',
  waxing_gibbous: '🌔',
  full: '🌕',
  waning_gibbous: '🌖',
  last_quarter: '🌗',
  waning_crescent: '🌘',
};

/** "Large Moon: waxing gibbous", or with the day, "... (day 12 of 79)". */
export function formatMoon(moon: MoonState, withDay = false): string {
  const day = withDay ? ` (day ${moon.age + 1} of ${moon.cycleDays})` : '';
  return `${moon.name}: ${moon.phaseName}${day}`;
}

// ---- Chronosense: the clock as the player can read it ----
//
// Port of the old `systems/chronosense.ts` but for `tickChronosense`. The
// skill manifests from lived time alone and trains on every game minute; the
// trainer runs in the tick of `weather`, which reads this clock on every tick
// already (this system imports no other, so it cannot send skill XP).

export const CHRONOSENSE_ID = 'chronosense';

/** One full day lived, and the sense manifests. */
export const CHRONOSENSE_MANIFEST_TICKS = TICKS_PER_DAY;

/** XP per game minute, to every skill the tag `time` trains. */
export const CHRONOSENSE_XP_PER_MINUTE = 0.05;

/**
 * The level at which each precision arrives. The skill's `tierNames` list the
 * same levels. `minute` is past the base cap of 20: it needs a raised cap.
 */
export const SENSE_LEVELS = {
  daypart: 1,
  season: 4,
  bell: 8,
  weekday: 12,
  date: 16,
  minute: 25,
} as const;

/**
 * Time resistance, for the levels past the base cap of 20: x0.99 per level
 * from 21, x0.97 on a decade level (30, 40, ...), and a further x0.95 at 50,
 * 75 and 100. Level 100 leaves x0.326 of a time penalty. No system reads it:
 * no time penalty exists in the old build either.
 */
export function timePenaltyMult(level: number): number {
  let mult = 1;
  for (let l = 21; l <= level; l++) {
    mult *= l >= 30 && l % 10 === 0 ? 0.97 : 0.99;
    if (l === 50 || l === 75 || l === 100) mult *= 0.95;
  }
  return mult;
}

const DAYPARTS: { until: number; name: string }[] = [
  { until: 4, name: 'Deep night' },
  { until: 6, name: 'Dawn' },
  { until: 11, name: 'Morning' },
  { until: 13, name: 'Midday' },
  { until: 17, name: 'Afternoon' },
  { until: 19, name: 'Dusk' },
  { until: 23, name: 'Night' },
];

function daypart(hour: number): string {
  return (DAYPARTS.find((d) => hour <= d.until) ?? DAYPARTS[0]).name;
}

const bell = (clock: WorldClock): string => `about ${String(clock.hour).padStart(2, '0')}:00`;

/**
 * The clock as a Chronosense level reads it; null below level 1.
 *
 *   L1  "Morning"
 *   L4  "Morning · winter"          (a holy day reads as "a holy day")
 *   L8  "about 09:00 · winter"
 *   L12 "Fifthday · about 09:00 · winter"
 *   L16 "Fifthday, 12th of Third Month, Year 1 · about 09:00"
 *   L25 "Fifthday, 12th of Third Month, Year 1 · 09:23"
 */
export function describeTimeSense(clock: WorldClock, level: number): string | null {
  if (level < SENSE_LEVELS.daypart) return null;
  if (level >= SENSE_LEVELS.date) {
    return `${formatDate(clock)} · ${level >= SENSE_LEVELS.minute ? formatTime(clock) : bell(clock)}`;
  }
  const parts: string[] = [];
  if (level >= SENSE_LEVELS.weekday && clock.weekday !== null) parts.push(WEEKDAYS[clock.weekday]);
  parts.push(level >= SENSE_LEVELS.bell ? bell(clock) : daypart(clock.hour));
  if (level >= SENSE_LEVELS.season) {
    parts.push(clock.season);
    if (clock.holyDay) parts.push('a holy day');
  }
  return parts.join(' · ');
}

/**
 * The moons as a Chronosense level reads them, one line per moon: none below
 * the season level, the phase from there, the day of the cycle from the date
 * level.
 */
export function describeMoons(clock: WorldClock, level: number): string[] {
  if (level < SENSE_LEVELS.season) return [];
  return clock.moons.map((m) => formatMoon(m, level >= SENSE_LEVELS.date));
}

// ---- the system ----

export interface ClockState {
  /**
   * Game ticks since the epoch. Not the kernel tick: a new game starts at
   * `START_TICKS`, and a later port may hold this clock while the kernel runs.
   */
  totalTicks: number;
}

export function totalTicksOf(state: DeepReadonly<ClockState>): number {
  return state.totalTicks;
}

export interface ClockView {
  totalTicks: number;
  date: string;
  time: string;
  season: SeasonId;
  moons: { id: string; name: string; phaseId: MoonPhaseId; phaseName: string; icon: string }[];
}

export default defineSystem<ClockState, ClockView>({
  id: 'clock',
  version: 1,
  migrations,
  initial: () => ({ totalTicks: START_TICKS }),
  // First in the tick: the old loop advanced the tick count before anything else.
  order: -100,
  tick: (ctx) => {
    ctx.state.totalTicks += 1;
  },
  content: { months, weekdays, holy_days: holyDays, moons, moon_phases: moonPhases },
  view: ({ state }) => {
    const clock = clockOf(state.totalTicks);
    return {
      totalTicks: state.totalTicks,
      date: formatDate(clock),
      time: formatTime(clock),
      season: clock.season,
      moons: clock.moons.map((m) => ({
        id: m.id,
        name: m.name,
        phaseId: m.phaseId,
        phaseName: m.phaseName,
        icon: MOON_ICONS[m.phaseId],
      })),
    };
  },
});
