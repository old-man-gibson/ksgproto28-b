# quests

Taking work from a person, its objectives, and turning it in. Port of the old
`systems/quests.ts` (without the greeting, which is `npcs`) and
`data/quests.data.ts`. Spine port 7; design in `docs/SPINE.md` section 8.

Imports: `combat`, `counters`, `gold`, `items`, `levels`, `log`,
`materials`, `npcs`, `skills`, `stats`, `world`. Panel "Quests": the people
here (Talk), the work offered here, active quests with progress, done
quests.

## Slice

Version 1: `quests`, id to `{ status: 'active' | 'done', progress }`.
`progress` stores kill, craft and reach objectives; collect, talk and stat
objectives read the save live, so one met before the quest was taken counts.

## Content

`quests` (1 of 13: `the_first_ascent`), `quests_text`.

## Commands

| Command | Old function | Skip reasons |
|---|---|---|
| `quests/accept { quest }` | `acceptQuest` | unknown, already taken, giver not here, requirements not met |
| `quests/turn-in { quest }` | `turnInQuest` | unknown, not active, not complete, giver not here |

Accept: stamps `flag:quest:<id>:accepted`, social XP keyed to the giver,
`quests/accepted`. Turn-in: hands over collected materials, pays gold
(`gold/add`, earned), materials, items, skill XP, then marks it done, bumps
`quests:completed`, pays dialogue discovery XP (weight 4), emits
`quests/completed`, logs, and pays level XP (`levels/grant-xp`, default 50)
after the line.

Heard: `combat/kill` (kill objectives), `world/arrived` (reach objectives).

## Facts

Source `quests/done`: `namedFact('quest:<id>', 1)` per quest turned in. The
condition kind `quest` reads it.

## Divine favour

Since the divine port (step 3) the turn-in asks `divine/grant-favor-all`
with `1 + rewards.favor`, at the old spot (after the discovery XP, before
`quests/completed` and the completed line): favour with every known god.
`the_first_ascent` pays 2. A request and not an event, so the favour line
is logged before the completed line, as the old order.

## Left behind

- The floor 11 and harbor quests (step 4, ports C2 and C3).

## Differences from the old build

- A collect objective hands over grade c of a graded material
  (`materials/take-stack`); the old code read `state.materials` only, where
  graded goods are not kept. No quest in scope collects.

## Step 3 (the alchemy port)

- Heard: `benches/crafted { discipline, recipe? }` (the old bus event
  `craft`) advances `craft` objectives whose `recipeId` and
  `discipline` match. The owner of a bench emits it where the old code
  emitted `craft`: `alchemy/brew` emits it before its Brewed line. No quest
  in scope has a craft objective (`a_taste_of_everything` waits for the last
  of the six system people).

## Step 4 port L

- Content: `faces_of_threshold` and `a_taste_of_everything` of the Warden
  (old `quests.data.ts` 19-65), before `the_first_ascent` as in the old
  file. The Warden lists all three, `the_first_ascent` first. `quests` holds
  3 records.
- `faces_of_threshold`: eight talk objectives (the shaper Ilex,
  `psionic_shaper`, added to `npcs` with it); pays 60 gold, 50 level XP,
  favour 1 + 4, 25 Scouting XP and the Warden's crate.
- `a_taste_of_everything`: craft objectives for `iron_ingot` (the craft
  activity at the Forges sends `benches/crafted { discipline: 'craft',
  recipe }`), `cooking` and `alchemy`; stat objectives on
  `bestiary:entries` (the `bestiary` system), `kills`, `spells:inscribed`
  and `miracles:learned`.
- The questmaster achievement is in `achievements`; `quests:completed` is
  its counter.
- The text of `faces_of_threshold` says "the eight trades"; the old comment
  above it says nine. Ported as the text has it.

## Step 4 port C2

The steward's two repairs (old `quests.data.ts` 80-110), giver
`f11_steward`: `f11_shore_up_the_gate` (20 hardwood, 15 iron scrap) and
`f11_arm_the_wall` (10 raiders, 4 iron ingots; requires the first). Both
require `legacy:stronghold` 0, so neither is offered on a run after the
stronghold. No new machinery.
