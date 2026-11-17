# levels

Character level: one general-strength track next to skill and attribute XP.

Port of: old `systems/levels.ts` and `data/levels.data.ts`.

## Rules

- XP from level L to L + 1 is `round(110 x L^1.5)`.
- Each level above 1 adds `LEVEL_ATTR_BONUS` (1) to all six attributes. It is
  not a trained level: no rank or milestone reads it.
- A kill pays the monster's XP times the level-gap share: all of it against a
  monster at or above the fighter, 1/N when the fighter is N levels above,
  never under `MIN_KILL_XP` (1). Rewards read the monster's level without the
  dynamic levels (`rewardLevel`).
- `encounterLevel(rise, counter, level, rolled)` is the level an encounter
  line with a `levelRise` spawns at.

## Slice

`{ level, levelXp }`. Starts at level 1 with no XP.

## Requests

| Event | Effect |
|---|---|
| `levels/grant-xp` `{ xp }` | Adds XP and takes every level it pays for. One `levels/up` event and one log line per level. |
| `levels/raise-start` `{ level }` | Raises the level when the given one is higher, with no banked XP. Never lowers. For the Head Start boon. |

## Modifier source

`levels/attrs`: the level bonus on each attribute, with origin `level`.

## Content

`levels_text`: the four log templates of the old `levels.*` keys. `up` is
used here; `floor` and `band` are written by `ladder` (spine port 6);
`floor_lapsed` waits for the ward windows (step 4).

## Skip reasons

- `levels/grant-xp`: the amount is not above 0.

## Left behind

- `dynamicLevelBonus`: ported in `combat` (`spawn.ts`, spine port 4). It
  reads the band's rule from the encounter site; `world` puts it there.
- `checkFloorClears`, `syncBandPositions`: ported in `ladder` (spine port 6).
- What pays level XP: kills (`combat` emits `levels/grant-xp`, spine port
  4), floor clears (`ladder`, spine port 6), quest turn-ins (port 7).
- `applyStartingLevel`: the prestige port emits `levels/raise-start`.
