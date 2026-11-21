# prestige

The harvest re-climb. Port of the old `systems/prestige.ts`,
`systems/legacy.ts` and `data/prestige.data.ts`. Spine port 7; design in
`docs/SPINE.md` section 8.

Imports: `attributes`, `counters`, `gold`, `ladder`, `levels`, `log`,
`skills`, `stats`, `world`. Panel "Prestige" (the harvest preview, the
button, the boons); overlay: the review after a prestige (`overlay.ts`, a
modal that closes only through `prestige/leave-review`).

## Slice

Version 1: the legacy block. `count`, `points`, `purchases`, `peakLevels`,
`peakAttrs`, `floorsSeen`, `lastHarvest`, `review`, `spentThisReview`.

## Content

`prestige_sources` (6), `prestige_boons` (15), `prestige_text`. Whole.

## The run

- Opens on `slain:f6_great_hall:goblin_warchief` (`PRESTIGE_UNLOCK`).
- `prestige/now`: the harvest (the same function as the preview), peaks,
  `floorsSeen`, auto boons (talent, endowment), count and points, then
  `ctx.endRun()` (kernel decision 30). Every slice starts new.
- `newRun`: copies the legacy block, sets `prestige:count`,
  `flag:tutorial_done`, every `flag:unlock_*` the old run held, and
  `legacy:floor_seen:<floor>` per floor seen; stands the player at the Foot
  with only it discovered (`world/place` with `newRun`); pays starting gold
  (not earned) and the starting level (`levels/raise-start`).
- Carried by other systems' own `newRun`: the stash (`items`), the world seed
  and the first-calm flag (`weather`).

## Commands

| Command | Old function | Skip reasons |
|---|---|---|
| `prestige/now` | `prestigeNow` | the warchief is not dead |
| `prestige/buy-boon { boon }` | `buyBoon` | unknown, highest rank, points short |
| `prestige/leave-review` | `leaveReview` | no review is open |

## Facts and registrations

Source `prestige/legacy`: `boon:<id>` rank, `foresight`, `scale:talent:<skill>`
(talent), `endowment:<attr>`, `skillCap:<skill>`. `registerBandPass` of
`ladder` reads the pass boons through the boon facts.

## Left behind

- Readers of grimoire pages (step 3, arcane), the city key's gate
  (band 3, step 4), Cook's Notes (cooking, step 3), Foresight in the skill
  view, Wayfinding go links (UI step; `wayfinding` is in the view).
- The stronghold and its automatic prestige, festival legacy (step 4).

## Step 4 port L

The two harvest sources that paid 0 now pay: `bestiary` reads the counter
`bestiary:entries` (bumped by the `bestiary` system on each new entry) and
`achievements` reads `totalTiers` of the `achievements` slice. The harvest
case of `tests/prestige.test.ts` is the old one again (16 points).

## Old data ported as it is

- Boons are sold whose readers are not here (see above): buying one spends
  points and has no effect until its reader is ported.

`legacyTechniqueSlots` is read by martial's `techniqueSlots` since step 3
(the `technique_slot` boon: +1 slot per rank).
