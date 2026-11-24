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
  (`f15_workshop`): floors and content not ported. (The workshop came with
  step 4 port C4, Kystel's Anvil with port C6: see the end of this file.)
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

## Changed while building (step 3)

- `match` of a class is always a list of clauses, and the old union fields
  are objects: `head: 'none'` is `head: { none: true }`, `haft: 'none'` is
  `haft: { none: true }`, `haft: 'any'` is `haft: {}` (the old code already
  read a haft object with no range as any haft). The schema has no union
  type. The paperweight's match is `[{}]`.
- `previewForge(reads, placement)` takes `{ level, counts }` (Smithing and
  the plain stock), not the state; `forgeSlotLocks(level)` takes the level;
  `formKnown(counters, id)` takes the counters slice.
- `forgedClassOf` answers only for an own key of the class table, so an id
  `forged:constructor` is no class. The old lookup would have returned an
  `Object.prototype` member and thrown when minted.
- The bench run keeps the anvil placement as given; the craft and the
  clock read it through the same guard a stored spec gets (`placementOf`
  over the five slots), where the old job stored `clonePlacement(forge)`.
- The working layout of the panel resets when the run changes, keyed on
  the prestige count (`runKey` in the view). The old key was `createdAt`
  and the prestige count; this build has no `createdAt`, no hard reset and
  no import, and a reload starts the layout over anyway. (The sky's seed
  was tried and dropped: it is null until the first minute under an open
  sky, so the key changed once mid-run and reset the layout.)
- The old cache fingerprint entry for a forged piece (`forgeKey` in
  `modFingerprint`) has no counterpart: no command edits a worn piece, and
  a load touches every source. `tests/derivedcache.test.ts` changes the
  parts through a save and a load and checks that nothing is stale.

## Old rules ported as they are

- A forged piece never has rune slots (`slots: 0`), whatever its size class.
- The grade is rolled with `1 + Smithing / 20` as luck and nothing caps it
  (old comment: there is no smithing tool yet).
- A ring or an amulet (an accessory class with no `cover`) has no stats at
  all: only a value.
- The STR requirement counts the weight of every part, the haft and the
  strap included.
- `items/grant` of a `forged:<class>` id ignores the `size` and
  `affixChance` fields (old `createItem` of a stub).
- `benches/start` does not check that the spot has an anvil (old
  `startBenchWork` did not); the panel offers the anvil only where a spot
  lists `forging`.

## Panel as built

`AnvilPanel.svelte` (with `FormChart.svelte`, `Silhouette.svelte`),
`anvilView.ts`, `drawing.ts`, `layout.svelte.ts`. Differences from the old
panel:

- A row of the comparison table previews on click (the old one on hover);
  a second click ends the preview; "Put on the anvil" applies it, "End
  preview" beside it, in a box of fixed height.
- The old `Tip` hovers: the column hints are a click-open "Columns" list,
  the head-count hint is inline text, the chart cells' tooltip text is their
  `aria-label`.
- Material colours are tokens of `tokens.css` (none of the old `--mat-*`
  tokens exist): steel `--color-text`, bronze `--color-warn`, iron, unknown
  metal and the fallback `--color-text-dim`, wood `--color-ok`, leather
  `--color-danger`. They follow the theme; the old ones did not.
- "Requires STR (not met)" reads attribute conditions only, from the
  attributes view; a forged piece has no other requirement.
- Three columns of 40rem only when the panel is at least 52rem wide, else
  one column (the old breakpoint was narrower; at 1024 px of window the
  middle column clipped its numbers). Run bar, reason line and apply box
  have fixed heights.
- Left out: the Shadow Clone row, pixel icons (the emoji is used), the
  progress-bar transition.
- Ported as is: Forge ×N and "Until out of stock" show only when two or
  more pieces are affordable.

Away from an anvil the panel is one line: `Anvil: at The Forges`.

## Left behind (as built)

- Everything under "Left behind" in the design.
- `tests/anvilview.test.ts`: the hard reset and the import cases are
  `it.todo` (this build has neither).
- `tests/items.test.ts`: "a forged item is never compared" stays `it.todo`
  (spare marks, UI step).

## Step 4 port C6: Kystel's Anvil

The hamlet forge of floor 17 (`f17_hamlet_forge`, `world`) lists `forging`
in `benches`, so the Anvil panel works there as at The Forges, and the
panel's away line names both anvils once the spot is discovered. No code
changed here: the anvil was already read from the spot's `benches`. The
spot's eight recipes are `crafting`'s (seven came with this port). Checked
in a browser at 1024 px and 375 px.
