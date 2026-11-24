# weather

Port of the old `systems/weather.ts` (whole), `systems/exposure.ts` (whole,
without the bestiary call) and the weather tables of `data/climate.data.ts`.
The calendar half of that file is in `clock`. Since step 4 port W also the
old `systems/weathersense.ts` (but `noteTravelSkies`, in `world`), the
trainer of `systems/chronosense.ts` (its readers are in `clock`), and
`systems/skyValidation.ts`.

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
- Trains the two senses with no action of their own (step 4 port W):
  - Weathersense, on every game minute under an open sky with a sample;
  - Chronosense, on every game minute once held, and on every tick from one
    full day lived until it manifests.
- Publishes the forecast Weathersense reads (`view.forecast`).

No panel of its own. `SkyPanel.svelte` is mounted in the Location panel.

## Files

| File | Holds |
|---|---|
| `index.ts` | The system, the exposure rules, darkness, moonlight, sunlight, the forecast's sky and view, the reads over a context |
| `sample.ts` | The noise field, the baseline, `classify`, fronts, calm, `weatherAt` |
| `senses.ts` | Weathersense (severity, the trainer, the forecast rows) and the trainer of Chronosense |
| `validation.ts` | `skyContentIssues`, the sky lint (old `skyValidation.ts`) |
| `SkyReadout.svelte`, `SkyPanel.svelte` | The Sky readout of the Location panel |
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
| `forecastSky(seed, spotId, totalTicks)` | The region and sample the forecast reads (old shell `headerSky`): under an `indoor` tag in an open area the region is read as sheltered (`still`). Null with no seed or no pin. |
| `forecastView(ctx)` | The forecast at the player's spot: the level, the region's name, the sky now, the prognosis flag, the rows. Null below Weathersense 1. |

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
| `skills/check-discovery`, `skills/grant-xp` | Tags `resist:<element>` and `darkness`; `weather` (Weathersense) and `time` (Chronosense), step 4 port W. |
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

- The bestiary entries the calm flag opens (`openLiftedEntries`): with the
  bestiary.
- `world.sunlight` as a quantity of Facet: `sunlight(ctx)` is exported and
  nothing reads it.
- The header weather chip. The view carries `{ kind, icon, band, temp,
  darkness }`; kind, icon, band and temp are null under a roof, where the old
  chip showed `still`. The forecast's "now" line reads the chip's sky
  (`forecastSky`), `still` under a roof, and shows only with Weathersense.
- The offline summary line of the first calm: the log keeps lines during
  catch-up here, so the line is in the log; the summary dialog is the UI
  step. Spine port 7: `newRun` carries the seed and the first-calm flag
  across a prestige (old `prestigeNow`).

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

## Step 4 port W: Weathersense, Chronosense, the sky lint

### Weathersense (`senses.ts`)

- In the exposure minute, after the weather's resist XP, with the sample of
  an open sky (old `tickExposure` calling `tickWeathersense`): severe weather
  (a storm, blizzard, sandstorm or gale, or 37 degrees and above, or -10 and
  below) checks discovery for the tag `weather` and pays 0.3 XP keyed
  `wx:<kind>`, `wx:scorch` or `wx:brutal_cold`; any other sky pays 0.01 with
  no key (the novelty floor). The skill manifests in the first severe minute
  and that minute pays.
- An arrival by travel pays 1.5 XP keyed `skies:<region>`: `noteTravelSkies`
  in `world` (the weather system imports `world`, so the call is there).
- The forecast: rows at 2, 6 and 12 hours and 1 to 7 days, opening at levels
  1, 2, 3, 5, 9, 13, 17, 21, 25 and 29; each row rough when it opens, fair 2
  levels later, precise 5 levels later. A rough read says "plain skies",
  "wild wind" or "wet weather" and a warmth word, never "calm"; fair names
  the kind and the band; precise the kind and the temperature.
- `view.forecast`, read by `SkyReadout.svelte` in the Location panel: "Now:"
  the sky (`forecastSky`), from level 5 "Prognosis: <region>", then one line
  per row ("In 2 hours: plain skies, mild (rough)").

### Chronosense's trainer (`senses.ts`, in this system's tick)

- Before the exposure, as the old loop ran `tickChronosense` before
  `tickExposure`: while the sense is not held, every tick from
  `CHRONOSENSE_MANIFEST_TICKS` checks discovery for the tag `time` (the
  skill has no gate, so the first check manifests it); once held, every game
  minute pays 0.05 XP to every skill the tag `time` trains. Catch-up runs it
  like any tick, so time away trains it (old rule).
- It is here because `clock` imports no system (`skills` imports `log`,
  which imports `clock`), and this tick reads the clock on every tick
  already. The readers of the sense (`describeTimeSense`, `describeMoons`,
  `SENSE_LEVELS`, `timePenaltyMult`) are in `clock`; the view `timeSense` in
  `skills`.

### Cost

- No tick hook is added. On a tick that is not a game minute the trainer is
  a comparison: before one day lived nothing can be due, and once
  Chronosense is held the memo `chronosenseHeldIn` (the weather slice object
  last seen with the sense held; a load or a new run replaces the object)
  says nothing is due. The skills slice is read on game minutes only, and on
  the ticks between one day lived and the manifest.
- A grant with no novelty key changes nothing to a sense not held (neither
  skill manifests by XP) or to a sense at its ceiling with 0 XP (the skills
  system discards XP there and sets XP to 0). `senseState` tells the
  trainers which (`locked`, `training`, `capped`; the ceiling is read only
  from the base cap up), and they send the watch XP and the minute XP only
  while `training`. A keyed grant (severe weather, an arrival) counts its
  novelty input at the ceiling too, so it is always sent. A long-lived save
  holds both senses at their ceilings, where the old build sent two grants a
  game minute that changed nothing. Every outcome digest and John's climbs
  through floor 16 are equal with and without the skip. Measured in
  docs/CONTENT.md section 13.

### The sky lint (`validation.ts`)

`skyContentIssues(refs)`, the old `skyValidation.ts` unchanged: a region's
`sky` names a table and the region has an atlas pin; an area's
`skyRegionId` names a region; a `sky` encounter line names weather kinds,
`calm` and `heatwave` only under a sky table, and stands under an open sky
with a pin. `tests/worldContent.test.ts` runs it on the live content; the
forge does not call it (as for the ward, sea and festival lints).

### Old rules and bugs ported as they are

- Chronosense manifests when the clock reaches one full day
  (`totalTicks >= TICKS_PER_DAY`), but a run starts at 09:00 of day 1
  (`START_TICKS` 5,400): the sense manifests 15 game hours (9,000 ticks)
  into every run, not after a full day lived. A prestige resets the clock
  and the skills, so this repeats each run.
- Severe by temperature alone (-10 degrees and below) makes many winter
  minutes severe, so whether and where Weathersense manifests depends on the
  drawn seed: John (merchants) gains it in the first game minute at the Foot
  with seed 7, on floor 4 with seed 42, and in no run with seed 1234.
- A severe temperature keys the novelty by temperature, not by kind: a
  blizzard at -10 degrees or below is `wx:brutal_cold`, a storm at 37 or
  above `wx:scorch`.
- `noteTravelSkies` keys on the area's region (`regionId`), not the sky
  region: the roofed and the open floors of the Ascent are one region.
- A rough read calls snow, a blizzard and a storm "wet weather".
- Both senses feed the counter `skill:levels` (the Eternal Student
  achievement's +5% and +8% skill XP at 25 and 100 levels) and the prestige
  harvest's skill levels. The passive XP therefore moves the outcome of long
  runs: the floor 1 budget run claims the 100-level tier at tick 81,035
  instead of 164,820.
- `timePenaltyMult` is read by nothing (old: "Nothing consumes it yet").

### Differences from the old build

- The forecast and the sky now are a block of lines in the Location panel,
  shown with Weathersense 1 and above. The old build showed them in the
  tooltip of the header weather chip, on hover; the shell has no header
  chip (the UI step). The rough marker is "(rough)", not "(?)".
- The old `prognosisTitle` (the tooltip text, read by no UI in the old
  build) put the exact date in the prognosis heading whatever the
  Chronosense level. The heading here is the old header's: the region only.
- Events are queued: a severe minute's discovery and XP apply after this
  system's tick, in emit order, as the old synchronous calls did in the same
  order.
