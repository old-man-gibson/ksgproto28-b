# superattrs

Super-attribute fusion. Two attributes fuse into a super-attribute once its
unlock conditions hold. From then until the run ends, each of the two reads
as the sum of both effective values, in every check and every formula.

Port of: old `systems/superattrs.ts`, `data/superattrs.data.ts`,
`text/superattrs.text.ts`, the `superattrs.fusion` line of
`text/log.text.ts`, the `state.fused` reads of old `systems/attributes.ts`
(`isFused`, `superFor`) and the fused chip of old `ui/panels/Sidebar.svelte`.
The sum itself was ported with `stats` in the spine (`fuseFact`,
`stats/README.md`); until this port no system stated the fact.

Ported after step 3 (2026-11-22), which missed it. Port C4 found the gap:
docs/CONTENT.md section 11.1, docs/SPINE.md section 21.

## Content

`superattrs` (3 records), written by `node scripts/convert-content.mjs
superattrs` (`desc` merged from the old text table). `superattrs_text` holds
the log line.

| Id | Components | Unlock |
|---|---|---|
| `dominion` | Strength, Charisma | Strength 60, Charisma 60, counter `kills` 500, counter `gold:earned` 25,000 |
| `force` | Intelligence, Constitution | Intelligence 60, Constitution 60, Magic 20 |
| `martial_prowess` | Dexterity, Wisdom | Dexterity 60, Wisdom 60, Ittou-ryu 10 |

An attribute condition reads `attrValue`, the value with fusion. The old data
calls these unlock conditions provisional; they are ported as they are.

## Slice

Version 1: `{ fused: string[] }`, the old `state.fused`. A new run starts
with none: the old prestige built the new state with `fused: []`, and the
counters `kills` and `gold:earned` start at 0 too.

## When the check runs

Event `superattrs/check`. This system emits it after each of
`attributes/levelup`, `skills/levelup`, `skills/unlock` and `combat/kill`,
the four old listeners (`registerSuperAttrListeners`), so the check runs
after the counter bumps those handlers queued (combat bumps `kills` after it
emits the kill; the old achievements listener bumped it before the old
fusion listener ran). It is not emitted once all three are fused.

No check on a tick, on gold earned or on a load: the old build had none. A
condition met by gold earned alone fuses on the next kill or level-up, as in
the old build.

The check (old `checkSuperUnlocks`), for each unfused super-attribute whose
conditions hold, in registry order:

1. add it to `fused` and touch the source;
2. emit `superattrs/unlocked { id }` (the old `superattr:unlock`);
3. emit `titles/check` (the old titles listener on `superattr:unlock`);
4. log `{icon} Fusion: {a} and {b} merge into {NAME} ({value}).`, kind
   `fusion`;
5. raise the counters `attr:<a>` and `attr:<b>` to the fused value, so the
   attribute achievements see it.

## Modifiers

Source `superattrs/held`, player only: `fuseFact(a, b)` per fused
super-attribute. The `stats` pipeline then reads `stats/attr:<id>` and
`stats/formula:<id>` of both components as their sum (`stats/eff:<id>`
stays apart).

## View and panel

`fused`: per fused super-attribute, in registry order, the name, icon,
description, the fused value, the value the formulas read (held to the
attribute ceiling) and each component's effective value.

`FusionReadout.svelte` (props only) is mounted in the Character panel of
`attributes`, above the attribute list: per fused pair the icon, name and
value, the description, each component's effective value, and a "Formulas
read" line while the attribute ceiling holds the value. It is the old
Sidebar's fused chip and its tooltip as lines (the shell has no tooltips).
No control. Nothing is drawn while nothing is fused.

## Skip reasons

No command. The check fuses nothing when a condition is unmet; that is not a
refused action and logs nothing, as in the old build.

## Old rules ported as they are

- The log line prints the fused value unformatted
  (`(140.12065987933198)`): the old `text()` wrote `String(value)`.
- The conditions are checked on the four old events only (above).

## Differences from the old build

- Log order: the old bus ran the title check inside `superattr:unlock`, so
  a title earned by the fused value logged before the fusion line. Here
  `titles/check` is a queued event: the fusion line comes first.
- A kill's level XP: the old fusion listener ran on `kill` before the level
  listener paid the kill's level XP; here the check is delivered after
  `levels/grant-xp`, so a character level gained on that kill (+1 to every
  attribute) is already in the values the check reads.
- The old Sidebar hid the two component chips of a fused pair. The Character
  panel keeps the component rows: they carry the training bars, which the
  old build showed in the Skills tab. Their value is the fused sum, as the
  old `attrValue` read.
- The old log kind `fusion` had its own colour and mark; the shell does not
  style log kinds.
- The old `art` key is kept in the data; the art is not in this repository.
