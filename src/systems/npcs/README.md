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
  has any. (Floors 11 to 13 came with ports C2 and C3; floor 17's two and
  `lore` with port C6, below.)
- The warden's quest list holds `the_first_ascent` only; the two Threshold
  quests return with step 3.

## Old data ported as it is

- The warden's description and dialogue name The Faces of Threshold, A Taste
  of Everything and "all eight trades", which are not in this build yet.
- The smith's dialogue names the iron ingot recipe and A Taste of
  Everything (crafting, step 3).

## Step 4 port L

`psionic_shaper` (Ilex, Censer Walk; old `npcs.data.ts` 117-123 and its
text) is added for `faces_of_threshold`. It teaches and sells nothing, as in
the old build. The Warden's `quests` lists `the_first_ascent`,
`faces_of_threshold`, `a_taste_of_everything`.

## Step 4 port C2

The steward `f11_steward` in the gatehouse of floor 11 (old `npcs.data.ts`
249-262, text `npcs.text.ts` 107-112). Gives the two repair quests.

## Step 4 port C3

The harbor's six people (old `npcs.data.ts` 263-318, text
`npcs.text.ts` 115-147): the four recruiters at the berths of floor 11
(`f11_factor`, `f11_bosun`, `f11_letter_agent`, `f11_lieutenant`),
each giving its side's join quest and preparation quest; at the Last Port
of floor 13 the pilot (`f13_pilot`, shop Passage: the Pilot's Passage)
and the harbor master (`f13_harbor_master`, shop Papers: Port Clearance,
shown to merchants only). No new machinery: the shops' `requires` and the
`shop:buys:<npc>` counter were there.

## Step 4 port C6

The hamlet of floor 17 (old `npcs.data.ts` 322-341, text `npcs.text.ts`
153-165): Thora Ironbrand (`f17_thora`) at Kystel's Anvil and Captain Bren
(`f17_bren`) in Hamlet Square. Neither gives quests or sells.

- `lore` (old `NpcDef.lore`): a list of `{ requires, dialogue }`. The lines
  of an entry join the person's dialogue once every condition holds.
  `npcDialogue(reader, npc)` builds the list (old `npcDialogue(state, npc)`);
  the view reads the conditions only where someone here has lore. Bren's one
  entry waits for `flag:malgeri_calm_seen` (the first calm, `weather`): the
  only line any person says about the calm.
- `loreIssues(people, { skills, quests })`: the lore half of the old forge
  validator's veil and lore rule (an entry with no condition would always
  show; an entry with no line says nothing; a condition names a real skill
  or quest). `tests/malgeri.test.ts` calls it on the live content. The veil
  half is `veilIssues` in `bestiary`; both use `conditionRefIssues` of
  `counters`. The forge calls neither (as for the other lints).
- `dialogueLine(lines, totalTicks)` and the view's `line`: the line said
  now, rotating every 300 ticks (old people card, `LocationPanel.svelte`
  `dialogueLine`). The view reads the clock only where someone stands.
- `PeopleList.svelte`: the people at the spot, with the Talk control, the
  description and "Says: “…”" in a fixed three-line box that scrolls.
  The Quests panel mounts it (before this port it drew the list itself and
  showed no dialogue, so no lore line could be seen). Tested by a server
  render in `tests/malgeri.test.ts`.
