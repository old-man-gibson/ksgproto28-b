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

- Craft objectives advance on a `craft` event that crafting sends (step 3).
- `faces_of_threshold`, `a_taste_of_everything` (step 3); the floor 11 and
  harbor quests (step 4).
- The questmaster achievement (achievements).

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
