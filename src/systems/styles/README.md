# styles

Stances and schools: the style the player fights in. Port of the old
`systems/styles.ts`, `data/styles.data.ts`, the style half of
`collectModifiers` (`systems/derived.ts`), and `setStyle` and
`checkStyleSwap` of `game.ts`. Step 3, with the martial port; design in
`src/systems/martial/README.md` section "Step 3 design".

Imports: `combat`, `counters`, `items`, `log`, `resources`, `skills`,
`stats`, `statuses`. Read by `tutorial` (the floor 0 stance step) and the
martial panel.

## Slice

Version 1: `{ style, effective }`. `style` is the stance picked, always a
stance (old `state.style`). `effective` is the style last stated to combat,
for the swap line (old `Game.lastEffectiveStyle`, which the old game kept
outside the save).

## Content

| Registry | Records |
|---|---|
| `styles` | 21: the 9 stances (`balanced` "Neutral", `aggressive` "Frenzy", `crush`, `cleave`, `quick`, `evasive`, `finesse`, `defensive` "Brace", `multi` "Flurry") and 12 schools, each `replaces` a stance and is gated on its school skill and a weapon tag |
| `styles_text` | the three log lines |

Written by `node scripts/convert-content.mjs styles`.

## Rules

- `effectiveStyleId`: the style a held condition forces (`forceStyle`), else
  the stance picked; then the school that claims that stance's slot, if
  any. A school claims a slot when its gate holds (its skill held, its
  weapon tag worn). Two schools on one slot: more gate conditions win, then
  the higher school level, then the lower id (old `claimScore`).
- The roster (`styleSlots`): one slot per stance, in registry order. A school
  never has a slot of its own.
- Source `styles/style` states `styleFact(<effective>)`, the style's mods
  (`perLevel` read against the school skill's level), the exertion mods while
  exerting and the pool is not locked, and the momentum line
  `min(cap, fight.momentum)` on the ramp's stat. Sources it depends on:
  `items/worn`, `skills/effects`, `statuses/held`, `resources/locks`,
  `combat/momentum`.
- Tick: when the effective style differs from `effective`, store it, emit
  `combat/set-style` (the id and the exertion) and log "{icon} {was}
  switched to {now}." or "{was} reverted to {now}.". A stance picked by
  command is stated at once and logs "Combat style: {name}".

## Commands and requests

| Command | Old function | Skip reasons |
|---|---|---|
| `styles/set { style }` | `setStyle` | no style has the id; the stance is already that; the stance is locked |

Request `styles/set-now { style }`: the same, for the floor 0 card. Answers
the reason, or null; "already in it" is not a refusal there.

## Old rules ported as they are

- A school id given to `styles/set` folds to the stance it replaces.
- An unknown id folds to `balanced` before the lookup, so it is refused as
  "the stance is already Neutral" when Neutral is held (old `stanceIdFor`
  then `setStyle`'s silent return).
- The roster lists all 9 stances on a new save; none has a gate.

## Changed

- `exerting` is in `resources` since port 4; its log line there names no
  style.
