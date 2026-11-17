# weather

Port of the old `systems/weather.ts` (whole), `systems/exposure.ts` (whole,
without the Weathersense and bestiary calls) and the weather tables of
`data/climate.data.ts`. The calendar half of that file is in `clock`.

## What it does

- Samples the sky over a region: a pure function of (seed, region, tick).
  A region with no sky table reads a climate baseline plus a seeded noise
  field. A region with a sky table draws fronts every 6 game hours and one
  calm spell of 8 hours per 12 days.
- Once per game minute, where the character stands (while travelling: the
  place left):
  - resist XP per element of the weather kind and of the temperature;
  - darkvision XP by the darkness of the place;
  - resist XP per element tag of region, area and spot;
  - in a region with a sky table and under an open sky: the conditions of
    the sky rule of the kind, on every minute its `every` divides.
- Per completed activity cycle (`world/cycle`): resist XP per element tag of
  the activity, times the base ticks of the cycle.
- States `combat/darkness` for the player.
- Answers the `sky` encounter lines of combat (`registerSiteSky`).

No panel.

## Files

| File | Holds |
|---|---|
| `index.ts` | The system, the exposure rules, darkness, moonlight, sunlight, the reads over a context |
| `sample.ts` | The noise field, the baseline, `classify`, fronts, calm, `weatherAt` |
| `defs.ts` | The registries, their lookups, the constants of the climate |
| `content/terrains.json` | 8 terrain profiles |
| `content/sky_tables.json` | 1 sky table, `malgeri` |
| `content/sky_rules.json` | 5 sky rules, id = weather kind |
| `content/weather_text.json` | 1 line, `calm_first` |

The three data files are written by `scripts/convert-world.mjs`.

## Slice (version 1)

| Field | Meaning |
|---|---|
| `seed` | Number or null. The seed of every sample. Null until the first game minute under an open sky that has an atlas pin. |
| `darkness` | 0 to 1. The darkness of the place, before darkvision and `eyeless`. Written each game minute and on `world/arrived`. |
| `eyeless` | Whether the player held `eyeless` at the last tick. Bookkeeping for the touch of `weather/darkness`. |

With `seed` null every read that needs a sample behaves as "no sample":
`skyKindAt` is null, the view is null, moonlight reads no clouds, sunlight
reads a clear sky.

## Reads

| Function | Returns |
|---|---|
| `skyKindAt(ctx, spotId)` | The weather kind over a spot. Null under a roof (sheltered region or area, `indoor` tag), with no pin, with no seed. |
| `moonlightOn(ctx)` | `{ lit, kind }` under the open night sky, else null. |
| `darknessFactor(ctx)` | The old factor, computed now from place, clock and sky. |
| `sunlight(ctx)` | 0 to 1. No system reads it yet. |

## Modifier source

`weather/darkness`: one `add` modifier on `combat/darkness` for the player,
`state.darkness * (1 - min(darkvision level, 50) / 50)`, 0 while the player
holds `eyeless`. No modifier when the value is 0.

- `dependsOn`: `skills/effects` (touched on every skill level-up) and
  `statuses/held`.
- `statuses/held` is not touched when `eyeless` lands or goes: the status
  system leaves conditions without modifiers out of its signature. The tick
  of this system compares the held state with `state.eyeless` on every tick
  and touches the source on a change.
- The source is touched when `state.darkness` changes. Under an open night
  sky with moonlight the value changes every game minute, so the stat table
  of the player is rebuilt every 10 ticks there.

## Events heard

| Event | Effect |
|---|---|
| `world/arrived` | `state.darkness` is recomputed for the new spot. |
| `world/cycle` | Work exposure (the old `grantActivityExposure`). |

## Events emitted

| Event | When |
|---|---|
| `skills/check-discovery`, `skills/grant-xp` | Tags `resist:<element>` and `darkness`. |
| `counters/raise` | `flag:malgeri_calm_seen` to 1, at the first calm minute under an open sky. |
| `log/line` | The first calm line, with the same condition. |

## Requests made

| Request | When |
|---|---|
| `statuses/apply-all` on the player, `resist: true`, source `Weather: <kind>` | The `self` doses of a sky rule. One request per rule, so the doses read one stat table. |
| `statuses/apply-all` on each enemy of the open fight, same source | The `foes` doses of a sky rule. |

A dose with `chance` is rolled by the status system, as the old
`applyStatus` rolled it. The draw order is the order of the doses.

## Skip reasons

| Action | Reason |
|---|---|
| `weather/exposure` | `no spot or no region for "<id>"`: the spot of the world slice is in no registry. |

A game minute with no weather, no darkness and no tag is not a skip.

## Tick order

20, after `combat` (10): the old loop ran `tickExposure` and `tickSky` after
the pools, the activity and the fight.

## Left behind

- Weathersense (`tickWeathersense`, `noteTravelSkies`, the forecast): step 4.
- The bestiary entries the calm flag opens (`openLiftedEntries`): with the
  bestiary.
- `world.sunlight` as a quantity of Facet: `sunlight(ctx)` is exported and
  nothing reads it.
- The content linter for sky lines (`skyValidation.ts`).
- The header weather chip. The view carries `{ kind, icon, band, temp,
  darkness }`; kind, icon, band and temp are null under a roof, where the old
  chip showed `still`.
- The offline summary line of the first calm: port 7.

## Differences from the old build

- **The seed.** The old seed was `worldSeedOf(state.createdAt)`. System code
  cannot read a wall clock. The seed is one draw of the kernel generator
  (`floor(rng.next() * 2^32)`), taken in the tick at the first game minute
  the character stands under an open sky with an atlas pin, the moment the
  old `tickExposure` first called `weatherAt`. A character that never leaves
  a roof draws nothing. `worldSeedOf` is kept for tests.
- **Before the seed.** Between a new game and that minute there is no
  sample. An arrival under an open night sky before the first minute stores
  the darkness with no clouds; the next minute corrects it. `sky` encounter
  lines do not roll until the seed is drawn.
- **Darkness is sampled.** The old `darknessFactor` was computed at each
  use. Here the place darkness is stored once per game minute and on
  arrival. A noise-field weather kind that changes inside a game minute, and
  the hour boundary, reach `combat/darkness` up to 9 ticks late.
- **`eyeless` is seen at the tick of this system.** A blow of combat in the
  tick `eyeless` lands or goes still reads the value of the tick before.
  The old check was at each use. Only mutagens give `eyeless` to the player,
  and they are not ported.
- **One stat table per rule.** The `self` doses of a rule go in one request.
  The old loop passed one stat block to every dose; the result is the same.
- **Events are queued.** The skill XP, the calm flag and the calm line are
  events. They are applied after the tick of this system returns, in emit
  order. The calm flag is read once per game minute, so the line still logs
  once.
- **`terrain` is a string.** `classify` takes any terrain id; the registry
  `terrains` holds the valid ones.
- **`excluded` of a sky table** is a list of `{ season, kind }` in the data
  and a record by season in `SKY_TABLES`.

## Old rules ported as they are

- `MOONLIGHT_THROUGH.still` and `SUN_SHARE.still` are 1: a sheltered region
  reads as a clear sky. Neither is reached, because a roof returns 0 first.
- A gale lets half of the moonlight through and 0.8 of the sun; mist lets
  half of each.
- `SUN_SHARE` values are marked as placeholders in the old source.
- The blizzard trains wind by its kind and cold only by the temperature
  rule. A blizzard above -5 degrees trains no cold.
- A heatwave pays heat once: by its kind, not again by its temperature.
- Glare (`light`) needs a clear sky between 07:00 and 17:59 that is 6
  degrees above the baseline. No light is simulated.
- The first calm flag is named after the Malgeri table
  (`flag:malgeri_calm_seen`) and is shared by every sky table.
- Sky rules apply only in a region with a sky table. Rain in any other
  region applies no condition.
- A sky rule applies on game minutes divisible by `every`, counted from the
  epoch, not from the start of the front.
- While travelling the character is exposed to the place left, for the whole
  journey.
- A place with a `dark` tag is at darkness 1 under a roof, in a settlement
  and at noon. Moonlight never reaches it.
- Twilight (hours 5 and 19) is half dark.
- The calm spell is drawn per window of 12 days from tick 0. Two spells can
  be up to 24 days less 8 hours apart, or back to back across a window
  boundary.
- `NOISE_NORM` (4.67) is a measured constant, not derived.
- No region in the content of this port has a sky table. The table `malgeri`
  and the five rules are data with no reader until floor 17 (step 4).
