# wuxin

The five-element cycle as a graph the player rewires. Step 3 gap, branch
`step3-gaps` (docs/SPINE.md section 22). Ported whole, as the old build had
it:

| Old | Here |
|---|---|
| `src/core/systems/wuxin.ts` (486) | `cycle.ts` |
| `WuxinBond`, `WuxinConfig` of `src/core/types.ts` (333-353) | `cycle.ts` |
| `src/ui/panels/WuxinPanel.svelte` (1,230) | `WuxinPanel.svelte` (state and drawing), `sandbox.ts` (every edit and every line, as functions) |
| The `wuxin` shutter of `systems/unlocks.ts` (`LOCKABLE_SUBSYSTEMS`, `unlockKey`) and the `wuxin` row of `ui/lib/nav.ts` | `index.ts` (`WUXIN_UNLOCK`, the view's `open`), `panel.ts` (`shown`) |
| `tests/wuxin.test.ts` (495, 45 cases) | `tests/wuxin.test.ts` |

What reads it in the old build: the panel and the navigation only. No
effect, no data file, no forge entry, no system reads the cycle. The old
save carried no cycle (the panel's state was its own); the old version 47
step stamped the shutter flags on older saves, which has no counterpart (no
importer).

## What it does

- `cycle.ts`: the grammar (`formatWuxin`, `parseWuxin`; `→` nourishes, `⊣`
  hinders, `∅` severed, ASCII `->` and `-|`), legality (`validateWuxin`,
  `isLegal`: five slots, eligible nouns, no self arrow, no dangling arrow, at
  most one arrow of each kind onto an element), shape (`shapeOf`, `discord`,
  `isHarmonious`, `isCounterflow`, `alignment`, `harmonyDistance`,
  `landmarks`) and `classify` (sustain, burst, tempered, harmonious,
  counterflow, split, irregular, checked in that order). Elements are the
  nouns of the arcane lexicon (`arcane`), `zero` excluded.
- The panel: a sandbox. Four presets, the graph (click a seat to pick it,
  click another to draw the switch's arrow; drag with a mouse, Shift to
  hinder, drop on open ground to sever), Sever and Drop pick, the readout of
  the picked element, Relaxed, the sandbox sliders (charge and habituation,
  fed by nothing), the verdict, the problems, the clause table (three lists
  per slot) and the grammar text. Nothing is sent to the kernel.
- The shutter: the navigation lists the panel while the counter
  `flag:unlock_wuxin` is 1 or more. Nothing in play sets it (the old debug
  panel did); `prestige` keeps every `flag:unlock_*` across a run.

## State

Slice version 1: `{}`. Fixture `tests/fixtures/wuxin/v1.json`. No modifier
source, no content, no command, no tick. View: `{ open }`.

## Differences from the old build

- The readout follows the picked element only. The old one also followed
  the pointer (hover), and the sliders set it on hover; controls here answer
  clicks.
- Escape drops a pick or a drag. The old panel put both on its overlay stack
  (Escape and the Android back button); this build has no overlay stack and
  no Android shell.
- Colours are this build's tokens: generation `--color-ok`, destruction
  `--color-danger`, charge `--color-accent`, a full node `--color-warn`.
- Fixed heights: the pick line, the readout box, the verdict and the problem
  list keep their height while the configuration changes.
- Comments were cut to facts; UI strings are the old ones.

## Old rules ported as they are

- The arrow lists of the clause table may leave the cycle illegal (two
  arrows onto one element, an arrow at itself); the problems list says so.
  Drawing on the graph displaces instead.
- The panel's state is lost when the panel closes or the page reloads.

## Skip reasons

No command, so none.

## Tests

`tests/wuxin.test.ts`: the 45 old cases unchanged, and 8 new (the shutter
and the slice; the panel rendered on the server with each control present,
the presets, picking and drawing, Sever, the lists, Relaxed).
