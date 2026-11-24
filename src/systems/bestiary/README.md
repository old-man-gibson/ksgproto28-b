# bestiary

What the player has learned about each monster. The first kill of a species
opens its entry. Each fact waits for a minimum kill count, then rolls once per
kill against insight, and is granted at its `sureKills`. A kill on a caged
spot grants each fact at its `minKills` with no roll. A spot is confirmed as a
habitat after enough sightings there.

Port of: old `systems/bestiary.ts` (464 lines; the state half, the profile,
search and shelves), `data/bestiary.data.ts` (`BESTIARY_FACTS`,
`BESTIARY_TUNING`; the tag registry is in `monsters` since spine port 2),
`text/bestiary.text.ts` (fact hints), the three `bestiary.*` lines of
`text/log.text.ts`, and `ui/panels/BestiaryPanel.svelte`. Step 4 port L
(`docs/CONTENT.md` section 5.1).

Imports: `combat`, `counters`, `levels`, `log`, `monsters`, `skills`,
`stats`, `world`. The panel also reads `items`, `materials`, `mutagens`
(`damageTypeName`) and `loot`.

## Slice

Version 1: `{ entries: Record<monsterId, BestiaryEntry> }`, entry
`{ kills, seen, facts, spots, firstKill }`. `seen` counts sightings per spot
before the first kill too. `firstKill` is the tick the entry opened; 0 while a
veiled species has kills but no entry. A new run starts with an empty book:
the old prestige rebuilt the state without it.

## Content

| Registry | Records | Notes |
|---|---|---|
| `bestiary_facts` | 8 | Render order. `hint` merged from the old text table. |
| `bestiary_text` | 3 | Log lines. |

`BESTIARY_TUNING` is a constant in `index.ts`, as in the old data file.

## Rules

- Insight: `0.05 + Hunting x 0.004 + (INT + WIS) x 0.0015`, attributes as
  the formulas read them (`formulaAttr`). A fact's chance per kill is
  `min(0.6, insight x difficulty)`.
- Habitat: `max(5, 10 - floor(Hunting / 10))` sightings at one spot, and at
  least one kill.
- Discovery XP (`skills/grant-discovery-xp`, domain `bestiary`): weight 3 for
  a new entry, 2 for a fact of difficulty 0.5 or less, 1 for any other fact
  and for a habitat.
- A new entry bumps the counter `bestiary:entries`; the harvest source
  `bestiary` (5 per point) and `a_taste_of_everything` read it.
- `veil` (monster record): a species whose veil does not hold is counted and
  nothing else; it is in neither the known nor the total count. When a
  counter a veil reads changes, entries of veiled species with kills open
  (`openLiftedEntries`). The three Malgeri species carry
  `flag:malgeri_calm_seen`, which `weather` raises at the first calm.

## Events

Heard:

- `combat/fight-started`: one sighting per species in the group, at the
  site (the old `encounter` bus event, which only spot encounters sent; here
  every fight start sends it).
- `combat/kill`: the kill.
- `counters/changed`: a key some veil reads lifts veils.

Sent: `bestiary/entry { monster }`, `bestiary/fact { monster, fact }`,
`bestiary/habitat { monster, spot }`; the log lines (kind `bestiary`).

## Skip reasons

- `bestiary/kill`: no monster "<id>" (a kill of an id the registry does not
  hold; the old code returned without a word).

## View

`known`, `total`, `insight`, `habitatNeeded`, and per discovered species
`kills`, `facts`, `haunts` (spot name, count, confirmed) and `levels`, the
live level range (`spawnLevels` with the reads). The panel builds the
averaged profile (`monsterProfile`) for the selected entry only, from
`levels`; the view does not carry it because the view is rebuilt every frame.

## Old rules ported as they are

- `spawnLevels` adds a line's `levelRise` and the band's dynamic levels, not
  the band's level step (`levelStep`, band 3). From band 3 on the book shows
  levels below what spawns.
- The averaged profile uses the tier's mid multiplier, no modifier tier and
  no rarity, and reads the declared `resistances` only for Defences.
- A kill rolls each open fact in list order, one draw each, before habitats.

## Changed while porting

- The old sighting event came from `startEncounter` at a spot only. The new
  `combat/fight-started` comes from every fight start; a staged fight counts
  a sighting at its site id. No staged fight exists before step 4 content.
- The entries that open when a veil lifts open on the `counters/changed`
  delivery, after the line that raised the counter; the old code opened them
  before the first-calm line.
- Panel: no portraits (licensed art); tag rules and the insight explanation
  are shown on click, not on hover. Text is in "Label: fact" form.

## Files

| File | Holds |
|---|---|
| `index.ts` | Registries, slice, reads, recording, events, view. |
| `book.ts` | Content reads: tags in use, search, shelves, profile, drop chance. |
| `BestiaryPanel.svelte`, `panel.ts` | The panel. |
| `migrations.ts` | None yet. |

Tests: `tests/bestiary.test.ts`, the cages case of `tests/onboarding.test.ts`.

## Step 4 port C6

- Floor 17's calm trio (`malgeri_ridge_wolf`, `malgeri_cairn_brute`,
  `malgeri_hollow_seer`) now spawns: the calm lines of the six open hunt
  spots. The veil, `openLiftedEntries` and the first-kill rule are port L's;
  `tests/malgeri.test.ts` ports the old "the veil on the calm monsters" (6
  cases) on the live content, and `tests/malgeriCatchup.test.ts` checks the
  same ticks offline and live leave the same book.
- `veilIssues(monsters, { skills, quests })`: the veil half of the old forge
  validator's veil and lore rule (an empty veil hides nothing; a condition
  names a real skill or quest). The lore half is `loreIssues` in `npcs`.
