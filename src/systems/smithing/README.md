# smithing

The anvil: part kinds and item classes, the resolver that names a piece
from the proportions of its parts, the forging kernel that turns parts,
materials and grade into numbers, the forged item, and the Anvil panel.
Step 3, port 6.

## Step 3 design

Written and committed before the code.

### What old `main` has for smithing

Surveyed on old `main` at `7c1267b`. The branch `origin/smithing-modular`
has no commit that `main` lacks: its pull request (#21, merge `2de9981`)
was merged, so the anvil on `main` is the "modular smithing slice 1" of
`docs/plans/blueprint-weaponsmithing.md`. The brief calls that branch and
the plan unmerged; the plan is a document on `main`, and slices 2 and 3 of
it (monster finishes, monster weapons, finishing, souls) were never built.
This port takes the code on `main` and nothing from the plan document.

| Kind | Old file | Lines | What |
|---|---|---|---|
| Rules, pure | `src/core/systems/assembly.ts` | 766 | Tuning constants, `partsOf`, `placementOf`, `clonePlacement`, `placementKey`, `forgeKey`, `featuresOf`, `matchesClause`, `matchesClass`, `classesByPriority`, `matchingClass`, `classifyPlacement`, `forgeStats` (the kernel), `placementCost`, `forgeTicks`, `forgedDef` (memo of 4,096), `itemDefOf`, `forgedClassOf`, `exemplarSpec`, `placementProblem`, `neighbours`, `enumeratePlacements` |
| Rules, content lint | `src/core/systems/assemblyValidation.ts` | 260 | `smithingContentIssues`: parts, smith profiles, class rules, exemplars, totality, reachability, the last class |
| Rules, state half | `src/core/systems/forging.ts` | 196 | `FORGING`, `PREVIEW_QUALITY`, `formKnown`, `forgeSlotLocks`, `previewForge`, `forgeOnce` |
| Bench run | `src/core/systems/benchwork.ts` | parts | `assembles` branch of `benchJobTicks`, `benchPreview`, `benchCraft`; `forge` field of the job |
| Data | `src/core/data/parts.data.ts` | 80 | 28 part kinds, `FORGE_SLOTS`, `placementCells`, `runeClassForCells` |
| Data | `src/core/data/itemclasses.data.ts` | 276 | 44 item classes, `forgedIdOf`, `classIdOfForged` |
| Data | `src/core/data/disciplines.data.ts` | record | `forging` (Anvil, `assembles`, 5 slots with unlock levels 0, 15, 5, 0, 3) |
| Data | `src/core/data/materials.data.ts` | fields | `smith` profiles of hardwood, iron ingot, bronze ingot, leather (already in `materials.json` here) |
| Data | `src/core/data/items.data.ts` | generated | `forged:<class>` stubs, one per class, no numbers |
| Data | `src/core/data/recipes.data.ts` | 4 records | Smelting at the Forges: iron, copper, tin, bronze ingot. Ported by `crafting` (see its README) |
| Data | `skills.data.ts`, `npcs.data.ts` | records | `smithing` skill, `master_smith` (Ferra Ostwind) and her shop: already ported by the spine |
| Text | `text/log.text.ts` `forging.*`, `text/itemclasses.text.ts`, `text/disciplines.text.ts` `forging.desc` | | Reason lines, the forged line, nine class descriptions, the Anvil description |
| Types | `types.ts` | | `PartKindDef`, `PartShape`, `PlacedPart`, `Placement`, `ForgeSlot`, `ForgedPart`, `ForgedSpec`, `ClassMatch`, `ItemClassDef`, `SmithProfile`, `ItemInstance.forged` |
| Item seam | `equipment.ts`, `inventory.ts`, `runes.ts`, `derived.ts`, `stash.ts`, `combat.ts` | lines | Forged value, the forge key in `stackKey` and in `modFingerprint`, `createItem` of a stub mints its exemplar, the damage type of a forged class |
| Game | `game.ts` `forge(placement, count)` | | `startBenchWork(..., 'forging', {}, { count, forge })` |
| UI | `src/ui/panels/AnvilPanel.svelte` | 978 | The Anvil: slot accordion, part families, the comparison table, the preview, one change away, the run buttons, Shadow Clone row |
| UI | `src/ui/panels/FormChart.svelte` | 300 | The form chart: head by haft, guard and binding selectors, forms known by counter |
| UI | `src/ui/lib/anvilView.ts` | 590 | Pure view helpers of both panels |
| UI | `src/ui/lib/anvil.svelte.ts` | 94 | The working layout, keyed to one run |
| UI | `src/ui/lib/forgeDrawing.ts`, `ForgeSilhouette.svelte` | 735, 181 | The pattern drawing of a placement |
| UI | `LocationPanel.svelte` | lines | Mounts the Anvil at a spot whose `benches` holds `forging` |
| Tests | `tests/assembly.test.ts` | 655 | The numbers, totality, the seam, prices, the anvil job |
| Tests | `tests/anvilview.test.ts`, `tests/forgedrawing.test.ts` | 729, 134 | The view helpers and the drawing |
| Tests | `tests/content.test.ts` "modular smithing content" | 6 cases | The content lint, the stubs, the bench ids |
| Tests | `tests/derivedcache.test.ts`, `tests/gearcompare.test.ts`, `tests/alphalocks.test.ts` | 1 case each | Cache on a re-forged piece; spare marks skip forged pieces; the Forges show the anvil |
| Docs | `docs/plans/blueprint-weaponsmithing.md`, `docs/CONTENT_GUIDE.md` (smithing lines) | | Not ported (plan document) |

`tests/forge.test.ts` and `tests/forgeProse.test.ts` test the old content
editor (`forge/`), not the anvil; their one smithing case checks that the
editor finds references to `iron_ingot` in class exemplars. Not ported.

### System folders

Two new systems. The old code splits there: `crafting.ts` and the craft
activity of `actions.ts` know nothing of the anvil, and the anvil never
reads a recipe.

| Folder | Holds |
|---|---|
| `smithing` | The anvil (this README). |
| `crafting` | Recipes worked as a spot activity: the smelting line at the Forges (see `src/systems/crafting/README.md`). |

### `smithing`

Slice version 1: `{}`. The old anvil kept nothing in the save but the
bench job (in `benches`) and the `forged:<class>` counters (in
`counters`). The fixture is `tests/fixtures/smithing/v1.json`.

Content (converted from the old literals, numbers unchanged):

- `parts`: 28 records, old `PART_KINDS`.
- `item_classes`: 44 records, old `ITEM_CLASSES`, with the nine `desc`
  lines of `itemclasses.text.ts` folded in. `match` keeps its shape: one
  clause or a list of clauses; ranges `[min, max]`, 99 for no upper bound.
- `smithing_text`: the `forging.*` log and reason lines.

`benches/content/disciplines.json` gains the `forging` record (Anvil, the
five slots and their unlock levels, `assembles: true`, `ticks` 100, `xp` 8,
the `desc` of `disciplines.text.ts`).

Files:

| File | Holds |
|---|---|
| `defs.ts` | Registries, schemas, types (`PartKindDef`, `Placement`, `ForgedSpec`, ...) and `FORGE_SLOTS`, `runeClassForCells`, `forgedIdOf`, `classIdOfForged` |
| `assembly.ts` | Old `assembly.ts`, pure, line for line |
| `validation.ts` | Old `assemblyValidation.ts` |
| `index.ts` | The declaration, `previewForge`, `forgeSlotLocks`, `formKnown`, the craft request, the registrations |
| `anvilView.ts`, `drawing.ts`, `layout.svelte.ts` | Old `anvilView.ts`, `forgeDrawing.ts`, `anvil.svelte.ts` |
| `AnvilPanel.svelte`, `FormChart.svelte`, `Silhouette.svelte`, `panel.ts` | The panel |

The resolver reads the registries through module constants (`PART_KINDS`,
`ITEM_CLASSES`, `MATERIALS`), as the old one read `registry.ts`; the
`SmithRegistries` argument stays for the lint.

Bench: `registerBench('forging', { preview, craft, ticks })`. `benches`
gains, for an assembling bench:

- the job field `forge` (a copy of the anvil placement, old
  `benchWork.forge`) and the `benches/start` payload field `forge`;
- `BenchOwner.ticks(forge)`: the base clock of an assembling bench (old
  `forgeTicks`: 100 + 15 per cell), which `benchJobTicks` paces by
  `craftSpeed` like any skill-scaled bench;
- `preview(ctx, placement, duration, forge)` and the craft request payload
  `{ placement, duration?, forge? }`.

The craft request `smithing/forge` is old `forgeOnce`: `previewForge`;
on refusal the line `🔒 <reason>` and false. Else: spend the bill through a
new `materials/take { id, qty }` request (plain counts; the old code wrote
`state.materials` directly), roll the grade with `rollQuality(rng, 1 +
Smithing / 20)`, mint the piece through a new `items/grant-forged { spec }`
request, bump `forged:<class>` and `crafts`, `skills/check-discovery
['smithing']`, `skills/grant-xp { tags: ['craft', 'smithing'], amount: 8 +
0.2 x ticks, sourceKey: 'forging:<class>' }`, `benches/crafted { discipline:
'forging' }`, and the repeat line `🔨 Forged: <icon> <grade> <name>` under
the group `bench:forging`. Same order as the old code; the generator draws
once (the grade).

### `items` additions

- `ItemInstance.forged?: ForgedSpec` (`{ parts, q }`) and the types
  `ForgedPart`, `ForgedSpec` (the type lives in `items`; `smithing` imports
  it).
- `registerForging({ defOf, stubOf, keyOf, exemplarOf })`, called by
  `smithing` at module load (`items` cannot import `smithing`, which imports
  `items`). The plug points the items README names:
  - `itemDefOf`: `forged` set: the derived definition; else the registry
    record, else the class stub (`forged:<class>`: the class's name, icon,
    art, slot, wield, tags, `mods: []`, `value: 1`, the rune class of its
    exemplar).
  - `itemValue`: a forged item is worth its definition's value, no affix or
    slot multiplier.
  - `stackKey`: `|<forgeKey>` appended for a forged item.
  - `items/grant` of a `forged:<class>` id mints the class exemplar at Fair
    (`slots: 0`, `runes: []`, `size: 'medium'`), as old `createItem`.
- `items/grant-forged { spec }`: a new uid, `defId` the class stub id,
  `slots: 0`, `runes: []`, `size: 'medium'`, `forged` a copy. Answers a
  copy.
- The `items/worn` source needs no change: it reads `itemDefOf`. A forged
  piece never changes in place (no command edits `forged`), so the old
  fingerprint entry (`forgeKey` in `modFingerprint`) has nothing to guard
  here: equip and unequip already touch the source.

### Panel

The Anvil panel (`smithing/panel.ts`), shown at a spot whose `benches`
holds `forging`, else a line naming where the anvil is. Ported from
`AnvilPanel.svelte` and `FormChart.svelte` with the same parts: the anvil
and chart views, the slot list with one picker open at a time, part
families, the comparison table, the preview with the bill and the held
counts, one change away, Forge ×1, ×5, until out, Stop, the run bar. The
working layout is module state keyed to one run (old `anvil.svelte.ts`).
Two changes forced by the rules of this repository: the old hover preview
of a table row is a click (UI rule: click, not hover), and colours are
tokens of `src/ui/tokens.css`.

### Tests

Ported, changed only in how they call the code: `assembly.test.ts`,
`anvilview.test.ts`, `forgedrawing.test.ts`, the smithing block of
`content.test.ts` (as `tests/smithingContent.test.ts`), the forged case of
`derivedcache.test.ts`, the Forges case of `alphalocks.test.ts`. The forged
case of `gearcompare.test.ts` tests spare marks (`beats`, `spareUids`), left
behind by the items port: stays `it.todo` in `tests/items.test.ts` with that
reason. The scan "nothing reads `ITEMS[<instance>.defId]`" runs over `src/`.

### Left behind

- Shadow Clones at the anvil (the old "Send a clone" row, `cloneCraft`).
- Kystel's Anvil (`f17_hamlet_forge`, floor 17) and the festival workshop
  (`f15_workshop`): floors and content not ported.
- The plan's slices 2 and 3 (never built on `main`).
- The forge editor's live smithing validation (`forge/lib/validate.ts`):
  the forge here validates schemas only; `validation.ts` is exported for it.
- Pixel icons (`art` names are kept as data; the files are not in this
  repository).

### John and budgets

John never opens the anvil (old `tests/john.ts` crafts ingots only on floor
11, out of scope). No tick hook: the anvil runs inside the `benches` tick,
which returns at once with no job. Expected: John unchanged; the budget runs
unchanged except one `forged` check per `itemDefOf` and `stackKey` call.
The state hash of every digest changes (two new slices).
