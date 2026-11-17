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

## Left behind

- Weather, climate tables and the sky (the rest of `data/climate.data.ts`):
  ported in `weather` (spine port 6).
- Pause, the keeper's dare and bonus time, which stop or double the clock:
  the ports of those systems. Nothing holds the clock yet.
- Chronosense, which decides how much of the clock the player may read.
