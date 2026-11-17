# ladder

Towers, bands and floors: which rung is cleared, open, gated or sealed, and
what a clear pays. Spine port 6.

Port of the old `systems/ladder.ts`, the stop and gate half of
`systems/towers.ts`, `systems/floorRules.ts`, and `checkFloorClears` and
`syncBandPositions` of `systems/levels.ts`, with `data/towers.data.ts`.

This system moves nobody. `world` rides the ladder (`world/climb`).

## Files

| File | Holds |
|---|---|
| `index.ts` | Registries, the reads, the stops, the clear, the view |
| `floorRules.ts` | The structure rules of a floor: spine, no skip, wing depth, wing loop, clear table. Pure. |
| `content/towers.json`, `bands.json`, `floors.json` | 1 tower, 2 bands, 7 floors (floor 0 and floors 1 to 6) |
| `content/ladder_text.json` | The line for a tower whose top rung is cleared |

## Slice

None. Every reading is derived from counters, as in the old build:
`slain:<spot>:<monster>`, `fights:<spot>`, `boss:<spot>`, `gold:earned`,
`kills:tag:<tag>`.

## Reads

All take a condition reader (`ladderReader(ctx)`).

- `clearMet`, `floorCleared`, `floorUnlocked`, `rungStatus`, `floorReached`,
  `floorsBelow`, `ladderFloors`, `topRung`, `ladderEnded`, `endNotice`.
- `bandOpen`, `bandCleared`, `bandKnown`, `hubStatus`, `bandHubAt`,
  `bandBaseIndex`, `rungIndex`.
- `bandLevelStep(reader, areaId)` and `bandDynamicLevel(areaId)`: what
  `world` puts on the encounter site of a spot.
- Stops: `towerAtSpot(spotId, areaId)`, `spotIndex`, `rideStops`, `hubStop`,
  `bandStop`, `floorStop`, `stopOpen`, `rideTicks`, `climbVerb`.

A rung is `sealed` while a rung below is not cleared, `gated` while its own
gate or the gate of its band is not met, `open` after that, `cleared` once
its clear holds. A floor with no band is off the ladder: never unlocked, and
the ladder does not answer on it (floor 0).

## Events

| Event | Direction | Does |
|---|---|---|
| `combat/kill`, `combat/fight-won` | heard | Check the clears |
| `ladder/check` | heard | Check the clears. `world` sends it on every arrival; quests (port 7) send it on a turn-in |
| `ladder/floor-cleared` `{ floor }` | emitted | A floor paid its clear this run |

A clear, once per run and floor: the counter `level:floor:<id>` is set, the
line of `levels` is written, `levels/grant-xp` pays `clearXp`, and the top
rung also writes the end notice. A band whose every floor is cleared sets
`cleared:band:<id>`. For an `any` band the counters `band:pos:<floor>` are
brought up to date.

## Skip reasons

None: this system has no command and no request.

## Left behind

- `bandPassed`: no band is passed until prestige registers its read with
  `registerBandPass` (port 7).
- `floorReached` does not count floors a prestiged run has seen
  (`prestige.floorsSeen`, port 7).
- The festival verdicts of the old ride gate (`shut`, `closed`, `forfeit`,
  `royale`) and `festivalLocked`: step 4.
- `clearLapsed` (ward windows): step 4.
- Bands 3 to 7 and floors 7 to 20: step 4. `OFF_LADDER_DOORS` and
  `SPINE_EXEMPT` name floors 11 and 14 and arrive with them.
- The floor rules are not called by the forge validator yet.

## Old rules ported as they are

- `clearsToAdvance` is 2 on both bands, with 3 floors each. The field is not
  read: the ascent is sequential.
- The description of `ascent_lower` names "the Old Toll Level, the Flooded
  Stair and the Silk Gallery". The floors are named The Flooded Offices, The
  Long Hall and The Descent.
- A floor with no `clear` reads never cleared, not trivially cleared.
- A floor and its band are stamped in the same check, because both read the
  clear conditions and not each other's stamps.
