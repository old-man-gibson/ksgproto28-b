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
used here; `floor`, `floor_lapsed` and `band` are for the world port.

## Skip reasons

- `levels/grant-xp`: the amount is not above 0.

## Left behind

- `dynamicLevelBonus`: needs monsters and bands (combat, world).
- `checkFloorClears`, `syncBandPositions`: need floors, bands and the ladder
  (world).
- What pays level XP: kills, quest turn-ins, floor clears. The combat, quests
  and world ports emit `levels/grant-xp`.
- `applyStartingLevel`: the prestige port emits `levels/raise-start`.
