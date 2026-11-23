# practice

The XP shaping of a fight against training equipment. Port of the shaping
half of the old `systems/practice.ts` (77 lines) and of
`data/practice.data.ts` (35), docs/PRACTICE.md of the old repository. Step 3
gap, branch `step3-gaps` (docs/SPINE.md section 22).

The other half of the old module was ported with combat in the spine:
`isPracticeFight` (`combat/engine.ts`), the `hunt` tag dropped in a practice
fight (`combatTags`), no level XP from a practice target's kill (`onKill`).

## The rule

Every skill or attribute payout P at level L made inside a practice fight's
tick lands as

    max(P × 0.1 × 10 / (10 + L − 1),  min(P, 1 × gap))

with gap the seconds since this fight last paid that skill or attribute,
capped at 5; the first payout of a fight counts one second. Constants:
`PRACTICE_XP_CUT` 0.1, `PRACTICE_XP_FALLOFF` 10, `PRACTICE_XP_FLOOR` 1,
`PRACTICE_FLOOR_GAP` 5 (TypeScript constants in `index.ts`, as the old data
file was). A practice target is a monster with `passive: true`; a practice
fight is one where every enemy still standing is one.

## How it is wired

- The scope. The old `tickCombat` ran a practice fight's tick inside
  `practising(state, ...)`, a module-level slot, and the old bus delivered
  every payout inside the call. Here `combat` sends the request
  `practice/open` at the start of its tick when the fight is a practice fight.
  Every event the combat tick emits, and every event those handlers emit, is
  delivered in the drain after the combat tick hook. This system's tick
  (order 11, right after `combat` at 10, before `benches` at 15) closes the
  scope, so payouts made by later tick hooks (bench work, weather, meals) and
  by commands between ticks (a flask from the panel) are not shaped, as in the
  old build. The scope is memory (one slot naming the open practice slice,
  as the old module-level slot), never saved: it is closed at the end of
  every tick, and the closing tick reads the slot and nothing else.
- The payouts. `skills` (`addSkillXp` after the cap check; `bankLatentXp` at
  level 1) and `attributes` (`attributes/grant-xp`, before the XP router)
  call `practicePayout`: the amount unchanged while the scope is closed (one
  read of this slice, no request), else the request `practice/xp`, which
  shapes the amount and stamps the clock.
- The clock. The old `CombatState.practiceAt` lived on the fight object, so
  each fight started with none. Here it is this slice's `at` (key to tick of
  the last payout), saved, as the rebuild saves a fight. `combat` emits
  `practice/fight-started` when a fight starts and the clock holds a stamp;
  the handler empties it. The clock outlives the fight by the drain it closed
  in: the killing blow's payouts are delivered after `combat` set `fight` to
  null, and still read and stamp it, as the old synchronous payouts did before
  the fight closed.

## State

Slice version 1: `{ at }`. Fixture `tests/fixtures/practice/v1.json`. A new
run starts with an empty clock (the old prestige dropped the fight). No
modifier source, no content, no command, no view, no panel.

## Differences from the old build

- The old save dropped a fight, and its clock with it; the rebuild keeps a
  fight in the save (since the spine) and so keeps its clock.
- Tick numbers: the old stamp was `state.totalTicks` after the increment of
  `advance`; here `ctx.tick` before the kernel's increment. Only differences
  of two stamps are read.

## Skip reasons

No command, so none.

## Tests

`tests/practice.test.ts`: the 13 old cases (the shaping cases on
`shapePracticeXp`, the rest through the kernel) and 3 new (the closing tick's
order, the killing blow's payouts, a new fight's empty clock).
