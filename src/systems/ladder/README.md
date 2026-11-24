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
| `ladder/check` | heard | Check the clears. `world` sends it on every arrival. The old turn-in did not check the clears, and quests here do not send it |
| `ladder/floor-cleared` `{ floor }` | emitted | A floor paid its clear this run |

A clear, once per run and floor: the counter `level:floor:<id>` is set, the
line of `levels` is written, `levels/grant-xp` pays `clearXp`, and the top
rung also writes the end notice. A band whose every floor is cleared sets
`cleared:band:<id>`. For an `any` band the counters `band:pos:<floor>` are
brought up to date.

## Skip reasons

None: this system has no command and no request.

## Left behind

- Spine port 7: `prestige` registers the band pass read
  (`registerBandPass`). `floorReached` also counts a floor an earlier run
  reached: the counter `legacy:floor_seen:<floor>` (`floorSeenKey`), which
  prestige sets at the start of every run from its `floorsSeen` list.
- The festival verdicts of the old ride gate (`shut`, `closed`, `forfeit`,
  `royale`) and `festivalLocked`: step 4.
- Bands 5 to 7 and floors 12 to 20: step 4. `SPINE_EXEMPT` names floor
  14 and arrives with it (port C3).
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

## Step 4 port C1

- Band 3 `ascent_upper` (The City, `order: 'any'`, hub `castle_court`,
  gate boon `city_key`, `levelSteps` [0, 2, 5, 9]) and floors 7 to 10.
  The `any` reads (`floorsBelow`, `rungIndex`, positions) were ported in
  spine port 6; this port adds the content.
- `clearLapsed(r, floor)`: the `wards` system registers the read
  (`registerLapse`). A lapsed clear writes the `floor_lapsed` line of
  `levels`, pays no clear XP and no top-rung notice; `prestige` counts no
  harvest floor for it.
- Command `ladder/debug-skip-wall { floor }` (CONTENT.md Q5): raises the
  floor's gate and clear counters, stamps its clear XP as paid, checks the
  clears. Used by the John driver only. Skip reasons: refused in a
  production build (`import.meta.env.PROD`), unknown floor.
- View: `RungView.hub` on a band's first rung (name, status, band gate).
  Term words: a stamp clear reads "Win <spot>" with the spots that can
  write it now (old `stampTerm`); `band:pos:` keys read "N+ other floors of
  The City cleared" and "at most N ..." (old `condText`); a boon gate names
  the boon.


## Step 4 port C2

- Band 4 `ascent_harbor` (The Harbor, `clearsToAdvance` 4) and floor 11
  `ascent_f11` (The Stronghold Road), old records. Floor 11's clear is the
  harbor's (`sea:crates:won` 8 and `fights:f11_roadstead` 1): nothing in
  this port can meet it. A first climb ends on floor 11 by the stronghold's
  automatic prestige (`prestige`). Floors 12 to 14 and the roadstead are
  port C3; until then `tests/worldContent.test.ts` names floor 11 and band 4
  in `HARBOR_PENDING`.
- `OFF_LADDER_DOORS` and `offLadderDoor(from, to)` (old `towers.data.ts`
  466-483): the two doors between the gatehouse and the hold, the only
  authored edges allowed across a banded floor's boundary.
- `SPINE_EXEMPT` (floor 14) came with port C3.

## Step 4 port C3

- Floors 12 to 14 (`ascent_f12` The Crossings, `ascent_f13` The
  Blockade, `ascent_f14` The Final Mission), old records. Band 4 holds its
  four floors; `HARBOR_PENDING` of `tests/worldContent.test.ts` is gone.
- `SPINE_EXEMPT` (old `towers.data.ts` 485-496): floor 14, whose clear is
  the stamp `flag:sea:14:done` and names no spot.
- `registerTermText(key, text)`: a system names a counter for the ladder
  card. `sea` names `sea:crates:won` ("8 crates won") and
  `flag:sea:14:done` ("Your side's mission boss slain"). The old card
  printed both keys raw. The roadstead's fight count reads "1 wins at The
  Roadstead" now that the spot is here.

## Step 4 port C4

- Band 5 (`ascent_festival`, The Vermin Festival, two clears to advance)
  and floor 15 (`ascent_f15`, The Dark Room: clear `boss:f15_dark_room`,
  800 XP), old records. Floor 16 is port C5: the band size lint names the
  band as holding floor 15 only until then.
- `registerFloorShut(read)`: a floor shut whatever else holds (old
  `festivalLocked` in `floorUnlocked`). The `festival` system registers
  `festival:shut` >= 1 for the floors of band 5. A shut floor is not
  unlocked; the floors above keep their state. The view's rung carries
  `shut`: the ladder card reads "Shut", with the reason, and offers no ride
  there (old `ladderView` mark `locked`).
- The festival's verdicts on a ride (`shut`, `closed`, `forfeit`,
  `royale`) are the world's to act on (`FloorRule`); `stopOpen` keeps the
  ladder's own terms.

## Step 4 port C6

- Band 6 (`ascent_aberrant`, The Malgeri Mountains, one clear to advance,
  no gate, no hub, no dynamic levels) and floor 17 (`ascent_f17`, The
  Malgeri Crossing: landing `f17_landing`, clear `boss:f17_keeper`, 900 XP),
  old records. 6 bands, 18 floors. Floor 17 is the top rung until port C7:
  its clear writes the end notice; the ladder card names floor 18 as not in
  this build.
- The clear is the regent's boss latch, not a fight count, so a fight of
  legionaries alone (weight 6 against 100) clears nothing (old rule). The
  ladder card reads it "1 keeper of The Hamlet Gates slain".
- The peak gate (`boss:f17_peak` on the road down the west face) is a road
  condition (`world`), not a ladder gate. The floor rules (spine, no skip,
  wing depth, wing loop, clear table) and the explore rule pass on floor 17
  (`tests/malgeri.test.ts`, `tests/worldContent.test.ts`).
