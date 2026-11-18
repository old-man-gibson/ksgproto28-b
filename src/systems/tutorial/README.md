# tutorial

Floor 0: the steps read off the world, the weapon rack, the skip, and the
gate that ends it. Port of the old `systems/tutorial.ts` and
`data/tutorial.data.ts`. Spine port 7; design in `docs/SPINE.md` section 8.

Imports: `combat`, `counters`, `items`, `log`, `styles`, `world`. No panel; an
overlay: the floor 0 card (`overlay.ts`, a banner above every panel while the
tutorial runs) with the step, the rack and the skip.

## Slice

Version 1, empty. A step is done when the world says so: counters
(`flag:tutorial_weapon`, `slain:f0_cellblock:slime_cell`, `fights:f0_field`)
and spots stood in. `flag:tutorial_done` ends it.

## Content

`tutorial_steps` (9), `tutorial_rack` (5), `tutorial_text`.

## Commands

| Command | Old function | Skip reasons |
|---|---|---|
| `tutorial/choose-weapon { weapon, shield }` | `chooseTutorialWeapon` | the rack was used, no such pick |
| `tutorial/choose-stance { style }` | `chooseTutorialStance`, `confirmTutorialStance` | the stance step is done |
| `tutorial/skip` | `skipTutorial` | the tutorial is over |

The rack equips the pick through `items/equip-now` (the rusty sword in the
pack is equipped, not minted again) and the shield beside a one-handed pick.
The skip abandons a fight, stamps every choice, and stands the player at the
Foot through `world/place`; the arrival ends the tutorial.

Heard: `world/arrived` at `ascent_foot` stamps `flag:tutorial_done`.

## Left behind

- The spell step (arcane): step 3. The step reader passes over it
  (`shownSteps`: 8 steps shown); the skip stamps its flag. The stance step
  came with the martial port: the card shows `TUTORIAL_STANCES` (Neutral,
  Frenzy, Brace) with their modifiers; a pick goes through `styles/set-now`
  and stamps the step even when the set is refused (old behaviour: the old
  card called `setStyle`, which returned silently), and the refusal is
  logged with `ctx.skip`.
- `tutorialFocus` (which tab each step opens and points at): UI step.

## Old data ported as it is

- Step texts speak of map pins and the Equipment tab of the old layout
  ("Select the marked pin in the corridor"). The map here is a list of spots.
- The `done` text names "the Quests tab under Guide".
