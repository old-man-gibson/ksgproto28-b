# npcs

People: who stands where, what they say, and the first greeting. Port of
`data/npcs.data.ts` (the records in scope) and of `npcsAt`, `npcDialogue`,
`talkTo`, `hasMet`, `metKey` of the old `systems/quests.ts`. Spine port 7;
design in `docs/SPINE.md` section 8.

Imports: `counters`, `log`, `skills`, `world`. Read by `quests` and `shops`.
No panel: the quests panel lists the people here and their Talk button.

## Slice

Version 1, empty. Met is the counter `met:<npc>`, as in the old build.

## Content

| Registry | Records |
|---|---|
| `npcs` | 11 of 20: `warden_of_the_foot`, `ward_outfitter`, `row_apothecary`, `granary_provisioner`, `master_smith`, `head_chef`, `row_alchemist`, `hall_quartermaster`; since the martial port `hall_tutor` (floor 2), `militia_captain` and `dojo_master` (Threshold) |
| `npcs_text` | the greeting line |

A record: `spotId`, `quests` (refs), `shop` (`name`, `lines`), `desc`,
`dialogue`. A shop line names an item or a material by `kind`; the id is a
string, checked by `tests/shops.test.ts`. Written by
`scripts/convert-port7.mjs`.

## Commands

| Command | Old function | Skip reasons |
|---|---|---|
| `npcs/talk { npc }` | `talkTo` | `no person "<id>"`, `<name> is not here`, `<name> is already met` |

A greeting bumps `met:<npc>`, sends `skills/check-discovery` and
`skills/grant-xp` (tags `social`, 8 XP, novelty keyed to the person), emits
`npcs/talked` and logs "Met <name>".

## Left behind

- The wizard, the priest and the shaper (step 3, with their systems;
  `docs/SPINE.md` defaults 1 and 4). The tutor, the captain and the dojo
  master came with martial; their lessons are martial's registry
  `teachers`, not a field here (`src/systems/martial/README.md`).
- The 6 people of floors 11 to 20 (step 4). `lore` lines: no person in scope
  has any.
- The warden's quest list holds `the_first_ascent` only; the two Threshold
  quests return with step 3.

## Old data ported as it is

- The warden's description and dialogue name The Faces of Threshold, A Taste
  of Everything and "all eight trades", which are not in this build yet.
- The smith's dialogue names the iron ingot recipe and A Taste of
  Everything (crafting, step 3).
