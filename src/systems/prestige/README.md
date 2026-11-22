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
  and the first-calm flag (`weather`), the festival legacy: tokens, the
  bonus stacks and the techniques bought (`festival`, since step 4 port C4).

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

- Readers of grimoire pages (step 3, arcane), Cook's Notes (cooking, step 3), Foresight in the skill
  view, Wayfinding go links (UI step; `wayfinding` is in the view).
- The stronghold and its automatic prestige: step 4 port C2, below. The
  festival legacy (old `prestige.stash.tokens`, `festivalBonus`,
  `festivalTechniques`) is the `festival` system's slice since port C4, carried
  by its own `newRun`, with its modifier source `festival/player`.

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

## Step 4 port C1

The city key's gate reads the boon fact `boon:city_key` of the source
`prestige/legacy` through the band gate of `ascent_upper` (a `boon`
condition); nothing new was needed here. The `floors` harvest source
skips a floor cleared by a lapsed ward window (`clearLapsed`, old Q24).


## Step 4 port C2

Old sources: `prestige.data.ts` 29-41, `prestige.ts` 39-57 and 246-269,
`game.ts` 220-225.

- Slice version 2: `stronghold` (boolean, never unset). Migration step 1
  adds `stronghold: false`. Fixtures `tests/fixtures/prestige/v1.json`,
  `v2.json`.
- `STRONGHOLD_WAVE` 8, `STRONGHOLD_HELD` (`fights:f11_wall` 8),
  `STRONGHOLD_KEY` (`legacy:stronghold`). `strongholdHeld(r)`: the wave is
  held and the run's `legacy:stronghold` is 0. The old read was the legacy
  flag; the counter is set from the flag at the start of every later run,
  so the two answer the same. `canPrestige` is the warchief or the
  stronghold. `autoPrestigeDue` is `strongholdHeld`.
- The automatic prestige: a tick at order -200, before every other system
  (the old `Game.tick` checked it before it advanced). It reads the two
  counters first and ends the run through the same function as
  `prestige/now` (`ctx.endRun()`, decision 30). The prestige sets
  `stronghold`.
- `newRun`: `legacy:stronghold` 1 when the legacy holds the stronghold. When
  the run that ended held the wave (read from the old run's counters), it
  sends `bonus/bank` with the old bank: the automatic prestige keeps the
  bank, a prestige by choice does not.
- Command `prestige/debug-hold-wall` (CONTENT.md Q5): writes the wall's
  fight count to the wave. Used by the John driver only. Skip reasons:
  refused in a production build; the stronghold is already held.
- Skip reason of `prestige/now` changed: "prestige opens when the warchief
  of floor 6 is dead or the stronghold of floor 11 is held".

Difference from the old build: the old automatic prestige took the whole
tick (no other system moved, the clock did not advance). Here the prestige
tick ends the run, and the systems after it in the same kernel tick run in
the new run: the new run starts one tick earlier.
