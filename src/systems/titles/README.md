# titles

Titles: each is earned once, when its unlock conditions hold, and latches.
Every earned title gives its `passive` modifiers; the one worn adds its
`equipped` modifiers. A title may make its holder immune to conditions, and
the worn `iconoclast` waives the pantheon's veto at preparation.

Port of: old `systems/titles.ts`, `data/titles.data.ts` and
`text/titles.text.ts`, the title half of `collectBaseMods` (old
`systems/attributes.ts`), the title half of the player's immunity (old
`systems/statuses.ts`) and `dogmaDefied` (old `systems/spellcraft.ts`).
Ported in step 3 with divine; the design is in
`src/systems/divine/README.md`, "Step 3 design", "Titles".

## Slice

Version 1: `{ earned: string[], worn: string | null }`. A new run starts
with none: the old prestige rebuilt the state with no titles.

## Content

`titles` (11 records), written by `node scripts/convert-content.mjs titles`
(`desc` merged from the old text table). `titles_text` holds the two log
lines.

## When the check runs

Event `titles/check`. This system emits it after each of
`attributes/levelup`, `skills/levelup`, `combat/kill`, `quests/completed`
and `world/arrived`, so the check reads the counters the same handler
bumped (combat bumps `kills` after it emits the kill). Since step 4 port
L it also runs after `achievements/claimed` (the old `achievement`). The
old build also checked on `craft` and `superattr:unlock`, and by direct
call from consumables and the festival: those ports emit `titles/check`.

## Modifiers

Source `titles/held`, player only, origin `title`:

- every earned title's `passive`, labelled `Title: <name>`;
- the worn title's `equipped`, labelled `Title: <name> (worn)`;
- an earned title's `immune` as `namedFact('statusImmune:<id>', 1)` and
  `namedFact('statusImmuneElement:<type>', 1)`;
- the worn title's `defiesDogma` as `namedFact('defiesDogma', 1)`, which
  `spellcraft/set-prepared` reads.

## Skip reasons

Command `titles/wear { title }` (null takes the title off):

- No such title: <id>
- <name> is not earned
- <name> is already worn / No title is worn

The old `setTitle` returned silently in all three cases.

## Files

| File | Holds |
|---|---|
| `index.ts` | Registry, slice, source, check, command, view. |
| `TitlesPanel.svelte`, `panel.ts` | The panel. |
| `content/` | `titles.json` (11), `titles_text.json`. |

## Step 3 (the alchemy port)

- `consumables` emits `titles/check` after a stamping card, where the old
  `useCard` called `checkTitleUnlocks`: the case file earns Friend of the
  Court.
