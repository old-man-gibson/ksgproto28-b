# runecarving

The Rune Table (carving a rune from a slab, patterns and adornments), the
carved pile, socketing runes into gear, and the sale and discard of loose
runes. Step 3, port 9.

## Inventory of old `main` (7c1267b)

Source of truth: old `main` only. The branch `docs/runecarving-review`
(glyph design) is not an ancestor of old `main` and is not ported.

| Kind | Old file | Lines | What |
|---|---|---|---|
| System | `src/core/systems/runecarving.ts` | 231 | `countPatterns`, `REPEAT_MIN_QUALITY`, `availablePatterns`, `patternSlots`, `BASE_FAILURE`, `FAILURE_PER_EXTRA_PATTERN`, `FAILURE_PER_LEVEL`, `failureChance`, `previewCarve`, `carveRune` |
| System | `src/core/systems/runes.ts` | 677 | Slot roll and `createItem` (ported by `items` in spine port 3); `carvedKey`, `runeRefKey`, `namedRuneFor`, `adornmentEffectAt`, `patternEffectAt`, `composeCarved` and its memo, `RESONANCE`, `resolveRune`, `isCarved`, `runeEffectIn`, `findItem`, `socketRune`, `unsocketRune`, `runeSellPrice`, `sellRune`, `discardRune`, `sellRunesBatch`, `discardRunesBatch`, `grantRune` (ported by `items`), `weaponTechniqueMods` (ported by `martial`), `weaponRuneBonuses` |
| Data | `src/core/data/runes.data.ts` | 401 | `RUNES` (11, ported by `items`), `RUNE_PATTERNS` (4), `RUNE_ADORNMENTS` (10), `NAMED_RUNES` (4) |
| Data | `src/core/data/disciplines.data.ts` | `runecarving` record | The Rune Table: slab, three pattern cuts (second at Runecarving 10, third at 25), inlay, colour, two gems, a tool that is not spent; `ticks` 60, `xp` 12; one outcome `carve` |
| Data | `src/core/data/materials.data.ts` | runecarving stock | `runestone_blank`, `gold_leaf`, `cut_garnet`, pigments, `bone_dust`, `raw_sapphire`, `bronze_chisel`, `steel_burin` (ported by `materials`) |
| Data | `src/core/data/locations.data.ts` | 2 spots | `the_long_bench` (Wrights' Ward, Threshold) and `base_workshop` (player base) hold the Rune Table |
| Text | `src/core/text/runes.text.ts`, `log.text.ts` (`runecarving.*`, `runes.*`), `disciplines.text.ts` | | Pattern and named-work descriptions, log and reason lines |
| Shutter | `src/core/systems/unlocks.ts` | | `flag:unlock_runecarving`. Shut on a new save. Nothing in old content lifts it. While shut: rune drops pay nothing (ported by `loot`), the Equipment tab shows no runes, slots or pips, the Rune Table is not listed in its room (`visibleBenches`) |
| Engine | `src/core/game.ts` | | `carveRune`, `socketRune`, `unsocketRune`, `sellRune`, `discardRune`, `sellRunesBatch`, `discardRunesBatch` |
| Engine | `equipment.ts` `sellItems` | | A sold item's carvings go back to the carved pile |
| Engine | `derived.ts` `modFingerprint` | | Socketed refs are spelled out in the stat cache key |
| Engine | `combat.ts` | | Weapon rune riders per hit (`weaponRuneBonuses`) |
| UI | `src/ui/panels/BenchPanel.svelte` | 1477 (shared) | The carving layout: slab in the centre, cuts, four stations, the context switch, per-option effect lines, the preview (name, effect per context, split chance), Carve, the carved pile |
| UI | `src/ui/panels/EquipmentPanel.svelte` | | Rune pips, the socket editor (Remove; a select per empty slot), runes in the collection list with sale and discard |
| UI | `src/ui/lib/format.ts` | | `describeRuneEffect` |
| Tests | `tests/runes.test.ts` | 139 | Slot roll (ported by `items`), socketing, context effects, thunder riders, sale of a socketed item, migration v7 to v8 |
| Tests | `tests/runeorder.test.ts` | 535 | Order independence of a carving, adornment riders, stack keys, the tool, F grades, technique surgery, socket order |
| Tests | `tests/disciplines.test.ts` | runecarving cases | Slots by level, bench validation, repeats, carving, the split, named works, socketing a carving, novelty keys |
| Tests | `tests/inventory-actions.test.ts` | "selling and dumping runes" | Six cases of rune sale and discard |
| Tests | `tests/content.test.ts` | "runecarving content" | Four content checks |
| Docs | `docs/CONTENT_GUIDE.md` ("A carving is a multiset"), `docs/ENGINEERING.md`, `docs/PITFALLS.md` | | Background; no rule beyond the code |

Carving is not a bench run in the old build. `BenchPanel` calls
`game.carveRune` once per click; `benchwork.ts` has no runecarving branch.
The discipline's `ticks: 60` is read by nothing.

## Reach through floor 6

No player carves through floor 6 on a new save, as in the old build:

- `flag:unlock_runecarving` is shut and nothing lifts it.
- No shop, monster or find through floor 6 pays `runestone_blank`. Bone
  dust and gold leaf drop; patterns and tools need no source to be placed,
  a slab does.
- Catalogue rune drops pay nothing while the shutter is shut.

The Rune Table at The Long Bench (Threshold) is in the ported world. The
port runs on a save with the flag set and stock granted (tests, the forge).

## Step 3 design

Written before the code.

### Folders

One new system, `runecarving`, and plug points in `items`, `combat` and
`benches`:

- `items/defs.ts`: `RuneRef` becomes `string | CarvedRune`. `registerCarving(hooks)`
  (as `registerForging`): `resolveRune` and `runeRefKey` hand a carving to
  the hooks; without them a carving reads as the inert Worn Rune. The rune
  effect type widens its riders to one or a list (`RuneRider`,
  `runeRiders`), as old `runeRiders`. `CarvedRune` is declared here so
  `items` can hold it without importing `runecarving`.
- `items/index.ts`: requests `items/socket { uid, ref }` (catalogue ref:
  taken from the pile; carving: placed as given) and `items/unsocket { uid,
  index }` (catalogue ref back to the pile, a carving returned to the
  caller), `items/take-rune { id, all }` (the pile for a sale or a
  discard). `items/sell` sends a sold item's carvings out in a new event
  `items/carvings-freed`. Each touches `items/worn` when a worn piece
  changes.
- `combat/engine.ts`: the weapon rune riders read `runeRiders`, so a
  carving's several riders each land; the rider source name reads
  `resolveRune`.
- `benches/content/disciplines.json`: the `runecarving` record, old
  numbers and text. The outcome's `pattern: ''` is dropped (no field, read
  by nothing). No owner is registered: carving is a command, not a run.

### Slice (version 1)

`{ carved: CarvedRune[] }`. A `CarvedRune` is `{ patterns: string[], stone:
{ id, quality }, adornments: { id, quality }[] }`, the old shape. Fixture
`tests/fixtures/runecarving/v1.json`. A prestige starts it empty (old
prestige did not carry `carved`).

### Content

`rune_patterns` (4), `rune_adornments` (10), `named_runes` (4),
`runecarving_text` (log and reason lines). Effects are lists with a
`context` field, as `items`' `runes` registry; a rider is one object in
the data (every authored rider is single).

### Commands

| Command | Old | Effect |
|---|---|---|
| `runecarving/carve { placement }` | `carveRune` | Preview; spend the bench; a split pays 40% XP; else the carving goes on the pile, XP `12 x (1 + 0.25 x parts placed)`. |
| `runecarving/socket { uid, ref }` | `socketRune` | `ref` is a catalogue id or `carved:<index>`. |
| `runecarving/unsocket { uid, index }` | `unsocketRune` | A carving back on the pile, a catalogue rune back on `items`' pile. |
| `runecarving/sell { ref }`, `runecarving/discard { ref }` | `sellRune`, `discardRune` | One loose rune. |
| `runecarving/sell-batch { refs }`, `runecarving/discard-batch { refs }` | `sellRunesBatch`, `discardRunesBatch` | Catalogue piles whole, carvings one each, carvings removed by descending index. |

No command checks the shutter or the spot, as the old engine did not.

### Stats

No new modifier source. A socketed rune's modifiers are collected by
`items/worn` (origin `rune`), the old `collectBaseMods`. The old
`modFingerprint` spelled socketed refs into the cache key; here every
socket and unsocket of a worn piece touches `items/worn`, and the kernel
compares the collected modifiers by value (decision 32). The composition
is a pure function of the carving, memoised by key, so a collection is the
same each time. `staleStats()` is asserted after each socket change in the
tests.

### View and panel

View: `unlocked` (the flag), `atTable`, level, the open slots and the next,
the stock per grade of every material a station accepts, the patterns open
at the level, the carved pile (name, icon, grade, effects per context,
sale price), the catalogue pile, every item with rune slots (worn and in
the pack) with its sockets, gold gain.

Panel "Runes" (one panel, decision 29 style reads of `items`): shut line
while the shutter is shut; the table (stations as rows, a picker in a well
of fixed height, the preview with split chance, Carve) only at a spot with
the table, else a line naming it; the carved pile and the catalogue pile
with Sell and Discard; the socket list (an item opens on click: Remove per
rune, a picker per empty slot). The old socket editor sat in the Equipment
tab; it is here so the port touches one folder's UI.

### Tests

`tests/runecarving.test.ts`: the runecarving cases of old
`disciplines.test.ts`, all of `runeorder.test.ts` but the stat tooltip
line (`statTipLines`, UI step), the socketing cases of `runes.test.ts`
(the slot roll and the save migration are not: `items` ported the first,
the save starts at version 1), the six rune cases of
`inventory-actions.test.ts` (they replace the `it.todo` lines in
`tests/materials.test.ts`), the four "runecarving content" checks.

## Files

| File | Holds |
|---|---|
| `defs.ts` | Registries and schemas; composition (`carvedKey`, `namedRuneFor`, `patternEffectAt`, `adornmentEffectAt`, `composeCarved`, `clearCarvedCache`, `RESONANCE`); the bench rules (`countPatterns`, `REPEAT_MIN_QUALITY`, `availablePatterns`, `patternSlots`, `failureChance`, `previewCarve`); `describeRuneEffect` |
| `index.ts` | The slice, `registerCarving`, the commands, the subscriber to `items/carvings-freed`, `weaponRuneBonuses`, `runeSellPrice`, the view |
| `RunesPanel.svelte`, `panel.ts` | The Runes panel |
| `content/*.json` | `rune_patterns`, `rune_adornments`, `named_runes`, `runecarving_text` |

## Skip reasons

- `runecarving/carve`: the preview's reason (also logged as `🔒 <reason>`):
  `No such pattern`; `<pattern> needs Runecarving <n>`; `No rune chosen to
  carve`; `An F-grade slab can't be carved: it gives negative stats`;
  `<material> is F-grade and can't be used: it gives negative stats`; `A
  slab holds at most 3 copies of one pattern`; `<n>× <pattern> needs a
  <grade> slab or better`; the bench reasons of `checkCraft` (`benches`);
  `No slab on the bench`. After the preview passed: `the stock of <id> at
  grade <q> ran out` (old: a silent null).
- `runecarving/socket`: `no carving is held at carved:<i>`; `no item has the
  uid <uid>`; `<item> has no free rune slot`; `no rune "<id>" is held`.
- `runecarving/unsocket`: `item <uid> holds no rune at socket <i>`.
- `runecarving/sell`, `runecarving/discard`: `no rune "<ref>" is held`.
- `runecarving/sell-batch`, `runecarving/discard-batch`: `none of the listed
  runes is held`.

## Changed while building (step 3)

- The old functions returned `false`, 0 or null on a refusal; the commands
  return a skip reason. Old log lines kept as they were.
- `previewCarve(reads, placement)` and `failureChance(level, placement)` take
  the bench reads or the level instead of the state, so the panel can
  preview from the view.
- `items` answers the item half of socketing (`items/socket`,
  `items/unsocket`, `items/take-rune`), because the item and the catalogue
  pile are its slice. The rune pile stays in `items` where spine port 3 put
  it; only the carved pile is here.
- The view's damage rider text names the type with a capital
  (`damageTypeName`), as old `DAMAGE_TYPE_NAMES` did for every type.
- The combat rider source for a catalogue id with no definition reads
  "Worn Rune" (`resolveRune`); the old `RUNE_NAME` fallback printed the id.
  Such a rune has no effect, so no rider is ever named by it.

## Old rules ported as they are

- The shutter is a panel shutter only. No command checks it, and nothing
  in content lifts it (old `unlocks.ts`). Through floor 6 no source pays a
  runestone, so no player carves.
- `runecarving/carve` does not check that the player stands at a Rune Table
  (old `carveRune` did not). The panel offers the table only there.
- The tool slot is not checked against stock: `checkCraft` skips non-material
  slots and `previewCarve` does not look at the tool. A carve command may
  name a tool the player does not hold, at any grade, and gets the lower
  split chance. The old panel listed held tools only.
- A pattern's grade in the placement is ignored; only its id counts.
- The discipline's `ticks: 60` is read by nothing: a carve is instant.
- A carve bumps no craft counter and emits no `benches/crafted` (old
  `carveRune` emitted no `craft` event), so no quest hears it.
- The success XP counts every placed part, the tool and the cuts included:
  `12 x (1 + 0.25 x parts)`. A split pays `12 x 0.4`.
- The split chance draws the generator on every carve, also when it is 0.
- A forged piece never has rune slots (smithing port, `slots: 0`).
- The batch sale pays at least 1 gold per rune (`max(count, ...)`).

## Panel as built

`RunesPanel.svelte`, order -8.01 (after the Chromosome panel, before
Equipment). Shut: one line naming the flag. Open: the Rune Table card (away
from a table: the line naming The Long Bench), the effect context switch
(weapon, armor, accessory), one full-width row per open station, the picker
well (14rem, scrolls inside), the preview box (7.5rem: name, three context
lines, split chance, or the reason), Carve. The loose runes (catalogue
first, then carvings, as the old socket list) with Sell and Discard. The
gear with rune slots (worn first, then the pack); a click opens its sockets
in a box of fixed height: Remove per rune, a select per empty slot. Carve
clears the spent stations and keeps the patterns and the tool (old
`clearConsumed`).

## Left behind

- `base_workshop` (the player base) and its Rune Table: not ported.
- Shadow Clones at the table, festival tokens of runes: not ported.
- The glyph design (`docs/runecarving-review` branch): not on old `main`.
- The damage stat tooltip lines per rider (`statTipLines`): UI step
  (`it.todo` in `tests/runecarving.test.ts`).
- Rune pips on the Equipment list, the rune slot range on shop wares, the
  collection list's grade sweep of carvings, Sell spares: UI step.
- The martial technique surgery of catalogue runes is read by `martial`
  (ported); no pattern carries surgery in content.
