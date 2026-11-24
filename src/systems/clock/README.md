# clock

The game calendar and the three moons.

Port of: old `systems/clock.ts` and the calendar part of
`data/climate.data.ts`.

## What it does

- `clockOf(totalTicks)` is a pure function: minute, hour, day, year, month,
  weekday, holy day, season, season phase, and the state of each moon. Nothing
  about the date or the moons is stored.
- 10 ticks are one game minute. A day is 14,400 ticks. A year is 13 months of
  28 days plus 4 holy days, 368 days. A holy day belongs to no month and no
  week, and the moons hold still on it.
- `formatDate`, `formatTime`, `formatMoon`, `moonlight`, `MOON_ICONS`.

## Slice

`{ totalTicks }`. Starts at `START_TICKS` (5,400: 09:00 on the first day) and
grows by one per kernel tick. The system has `order: -100`, so every other
system sees the tick count already advanced, as in the old loop.

The slice is a counter of its own, not the kernel tick: the old build did not
advance `totalTicks` while paused or while a question held the world.

## Content

`months`, `weekdays`, `holy_days`, `moons`, `moon_phases`. The numbers of the
calendar (`DAYS_PER_MONTH` and so on) are constants in `index.ts`.

## Chronosense (step 4 port W)

The readers of the old `systems/chronosense.ts`: how much of the clock the
player can read.

| Export | Meaning |
|---|---|
| `CHRONOSENSE_ID`, `CHRONOSENSE_MANIFEST_TICKS` (one day), `CHRONOSENSE_XP_PER_MINUTE` (0.05) | The skill and its trainer's numbers |
| `SENSE_LEVELS` | daypart 1, season 4, bell 8, weekday 12, date 16, minute 25 (past the base cap of 20) |
| `describeTimeSense(clock, level)` | Null below 1; "Morning", "Morning · winter", "about 09:00 · winter", "Sixthday · about 09:00 · winter", "Sixthday, 13th of First Month, Year 1 · about 09:00", then the minute. A holy day reads "a holy day" until the date level names it. |
| `describeMoons(clock, level)` | One line per moon from the season level; the day of the cycle from the date level |
| `timePenaltyMult(level)` | x0.99 per level from 21, x0.97 on a decade, a further x0.95 at 50, 75 and 100. Read by nothing, as in the old build. |

The trainer runs in the tick of `weather` (this system imports no other
system, and `skills` imports `log`, which imports this one). The view
`timeSense` of `skills` carries the reading; the Character panel shows it
(`skills/TimeSenseReadout.svelte`) in place of the date and time this
panel showed before the sense was ported. The old build never showed the
calendar except through the sense.

## Left behind

- Weather, climate tables and the sky (the rest of `data/climate.data.ts`):
  ported in `weather` (spine port 6).
- Pause, the keeper's dare and bonus time, which stop or double the clock:
  the ports of those systems. Nothing holds the clock yet.
- The header clock chip and its short form (old `shortClock`, the 7.1em slot
  of `tests/skySlots.test.ts`): the UI step.
