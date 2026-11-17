# mercy

Drought prevention: the chance of a tracked roll climbs with every miss and
resets on a hit, and the long-run rate stays the authored one.

Port of: old `engine/mercy.ts` and the `mercy` field of the old `GameState`.

## Files

- `engine.ts`: the rules, as functions on a ledger and a generator
  (`mercyCurve`, `mercyRate`, `procRate`, `mercyChance`, `procChance`,
  `mercyPick`). The constants and the measured table are in its header.
- `index.ts`: the slice and the requests.

## Slice

`{ ledger }`: key to consecutive misses. A key is created on a miss and
removed on a hit.

Keys in use: `loot:<source>:<kind>:<id>` (the `loot` system). The combat port
adds `proc:crit` and `proc:crit:<monster id>`.

## Requests

| Request | Answer |
|---|---|
| `mercy/chance` `{ key, rate, mercy? }` | Whether the roll hit. Tracked when the rate is under 15%. |
| `mercy/proc` `{ key, rate }` | Whether the proc fired. Tracked from 15% up, capped at `min(rate x 3, 75%)`. |
| `mercy/pick` `{ weights, keys, mercy? }` | The index picked. `keys[i]` null leaves entry `i` untracked. |

Each request draws once from the seeded generator.

## Skip reasons

None.

## Left behind

- `proc:crit` rolls: the combat port calls `mercy/proc`.
- The old save migration from version 45 (an absent ledger): the save here
  starts at version 1.
