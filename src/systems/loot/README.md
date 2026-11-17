# loot

Drop tables: the format and the roll.

Port of: `DropEntry` and `DropTable` of the old `types.ts`; `dropKey`,
`dropRowsFor` and `rollDropTable` of `systems/combat.ts` (lines 1586 to
1700); the drop-table checks of `tests/content.test.ts`.

This system holds no state. A roll changes `mercy`, `gold`, `materials` and
`items` through their requests.

## The table format

`dropTableSchema`: `{ rolls, entries: [{ kind, id?, weight, qty?, killedBy? }] }`.
`kind` is `item`, `material`, `gold`, `rune` or `nothing`. `qty` is a lowest
and a highest number, default 1 and 1. `killedBy` lists damage types.

The monster and location registries of ports 4 and 6 use `dropTableSchema`
for their `loot` field, and call `dropTableIssues(table)` from a test for
what the schema cannot check: the id exists in the registry of its kind, no
drop is listed twice, a weight is above 0, `qty` is two numbers in order,
`killedBy` is not empty.

## Request

`loot/roll` with:

| Field | Meaning |
|---|---|
| `table` | The drop table. |
| `source` | Id of what was killed. Keys the drought ledger. |
| `tags` | Its tags. Scoped loot (`loot:beast`) reads them. |
| `rewardMult` | The loot multiplier of its rarity times the reward multiplier of its modifier tier. |
| `rarity` | Its rarity: `common`, `uncommon`, `rare`, `epic`. |
| `rewardLevel` | Its level as rewards read it (`rewardLevel` of `levels`). |
| `size` | Its size. Absent reads as medium. |
| `lastHit` | Damage type of the killing blow. |

The answer lists what dropped, in roll order: `{ kind, id?, qty, quality?, item? }`.

## Rules

- Luck = the `loot` stat x scoped loot for the tags x `rewardMult`. It
  divides the weight of every `nothing` entry, by 1 at the least.
- A method row (`killedBy`) the killing blow did not match leaves the table
  before the pick. Its weight rolls as `nothing`, and its drought counter is
  neither read nor written.
- Each roll is one `mercy/pick`. A row is tracked when its authored share
  (weight over the sum of all authored weights) is under 15%. Its key is
  `loot:<source>:<kind>:<id>`.
- Draw order of one roll: the pick; the quantity when the row has `qty`;
  then for a graded material one draw per unit; for an item the rune slots,
  the affix chance, and the affix when it lands.
- Gold: `round(qty x rewardLevel x goldGain)`, added as earned.
- Material: granted with the luck, so a graded one rolls its grade tilted by
  it. One hunt line.
- Rune: pays nothing while the counter `flag:unlock_runecarving` is under 1.
  Open, the rune goes to the pile of `items`.
- Item: minted into the pack at the size of what was killed. Affix chance
  by rarity: 8%, 25%, 50%, 90%. Emits `loot/item` and one log line.

## Events

`loot/item` `{ item, source }`: an item dropped into the pack.

## Content

`loot_text`: the log template of an item drop.

## Skip reasons

None. A roll that comes up `nothing` is an outcome.

## Left behind

- The drop tables inside location data: port 6. The monster tables are in
  `src/systems/monsters` and `combat` makes the call on a kill (spine port
  4), with `rewardMult` the product of the rarity's `lootMult` and the
  modifier tier's `rewardMult`.
- Finds from searching: port 6.

## Old rules ported as they are

- The affix chance is rolled after the rune slots of the item, and a gold
  row logs nothing when it rounds to 0 and is still listed in the answer.
- A row is tracked by its authored share, and escalates around its
  luck-adjusted share.
