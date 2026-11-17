# materials

Stackable materials: a count for a plain one, a count per quality for a
graded one.

Port of: old `data/materials.data.ts`, `data/quality.data.ts`, the graded
stock of `systems/disciplines.ts` (`isGraded`, `stockOf`, `gradesHeld`,
`grantGraded`, `takeGraded`, `rollQuality`, `grantMaterial`, `craftTagsOf`)
and the discard half of the stackable code in `systems/equipment.ts`
(`takeStack`, `discardStackable`, `discardStackablesBatch`).

## Slice

`{ counts: { <id>: n }, stock: { <id>: { <quality>: n } } }`. A material not
held is absent; an emptied bucket is removed.

## Rules

- Quality tiers, worst to best: `f` Refuse (x -0.5), `e` Poor (0.25), `d`
  Common (0.6), `c` Fair (1), `b` Fine (1.6), `a` Superb (2.5), `s` Divine
  (4).
- A granted graded material rolls one grade per unit. Weights: f 10, e 20,
  d 32, c 24, b 10, a 3.4, s 0.6, each multiplied by
  `max(0.1, luck) ^ ((rank - 2) / 2)`. `luck` is the loot multiplier of the
  finder.
- `weightedPick(rng, entries)` is the plain weighted pick of the old
  `engine/rng.ts`. One draw.

## Requests

| Request | Answer |
|---|---|
| `materials/grant` `{ id, qty?, luck? }` | Adds the material. `{ quality }` when exactly one graded unit was granted. |
| `materials/grant-graded` `{ id, quality, qty? }` | Adds at a stated grade. No roll. |
| `materials/take-graded` `{ id, quality, qty? }` | Takes exactly `qty`, or nothing and `false`. |
| `materials/take-stack` `{ id, quality, qty }` | Takes up to `qty`. How many were taken. |

## Commands

| Command | Effect |
|---|---|
| `materials/discard` `{ id, quality, qty }` | Discards up to `qty`. One log line. |
| `materials/discard-batch` `{ refs, noun? }` | Discards every listed stack whole. One log line for the lot. |

## Reads

`MATERIALS`, `isGraded`, `craftTagsOf`, `countOf`, `stockOf`, `gradesHeld`,
`heldOf`, `QUALITY_TIERS`, `qualityMult`, `qualityAtLeast`,
`huntMaterialLabel` (the label of a material in the hunt tally).

## Content

- `materials`: 189 records, the whole old registry.
- `quality_tiers`: 7 records, in scale order. `color` is the grade colour of
  the old build, kept as data; no panel here reads it.
- `materials_text`: the log templates.

Converted with `node scripts/convert-content.mjs materials quality_tiers`.

Two fields are data for systems that are not ported; nothing here reads
them:

- `consumable` (32 records): what using the material does. `restore` names a
  pool and `grants` and `signature` are status applications, all checked by
  the schema. `teaches` (a dish), `unlocksWord` (a word) and
  `teachesTechnique` (a technique) are plain strings until their registries
  exist. `stamps` is a counter key.
- `smith` (4 records): how the anvil reads the material.

## Skip reasons

- `materials/discard`: `no <grade> <name> is held`.
- `materials/discard-batch`: `none of the listed stacks is held`.

## Left behind

- Selling (`sellStackable`, `sellStackablesBatch`, `sellMaterial`,
  `gradedUnitPrice`, `materialSellPrice`): port 7, shops.
- Using a consumable: the consumables and cooking ports.
- Bench slots (`slotAccepts`, `usableIn`, placements): the disciplines port.
- Gathering: port 6.
