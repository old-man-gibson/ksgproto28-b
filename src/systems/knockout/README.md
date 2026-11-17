# knockout

What follows a defeat: 1 HP, the retreat, the recovery, and the return to the
work the knockout interrupted. Spine port 6.

Port of the old `systems/knockoutReturn.ts`, the knockout half of `onDefeat`
(`systems/combat.ts`), the three knockout branches of `tickPlayerStatuses`
and the recovery branch of `tickAction` (`systems/actions.ts`),
`returnRecoverTarget` (`systems/huntrest.ts`) and `stayHere` (`game.ts`).

Rule: a knockout never leaves the character idle while a place to work is
known.

## Slice (version 1)

| Field | Holds |
|---|---|
| `pendingReturn` | `{ target, phase, fallback?, wins, until?, probes, from? }` or null. The old `PendingReturn`. |
| `proven` | The last hunt spot where 10 fights were won in a row, or null. |

Streaks are counters: `ko:n:<spot>` (knockouts in a row, cleared by a win),
`win:n:<spot>` (wins in a row up to 10, cleared by a knockout),
`win:at:<spot>` (clock tick of the last win at a spot with a fight budget).

## The knockout

| Cause | Heard | Does |
|---|---|---|
| A blow | `combat/defeat` with `byCondition: false` | 1 HP, the retreat, the return |
| A condition takes the last health | `statuses/damage`, `statuses/detonated` with the player at 0 HP | The line "knocks you out", then the same |
| A condition empties a pool | `statuses/fatal` | The same, with no extra line |

While already knocked out a condition only holds the character at 1 HP: no
line, no second retreat, no second outcome.

`knockout` hears a condition event before `combat` does (tick order 4 before
10), so it reads whether the open fight was forced. `combat` then closes the
fight and emits `combat/defeat` with `byCondition: true`, which is ignored
here.

## Recovery

The tick checks the health share while `world.recovering`: 60%, or with a
return pending 95% or the rest target of the hunt when that is higher. When
HP cannot recover (no regeneration, or a condition blocks it) the 60% mark
applies. At the mark it asks `world/recover`.

## The return

Phases, in the order a failing spot moves through them:

- `return`: back to the spot of the fall. A win there ends it. Work with no
  fights ends it on arrival.
- `fallback`: after 5 knockouts in a row at one spot, or when the spot is
  never walked back to, hunt the proven spot until 200 wins or 2 hours, then
  retry the target. With no usable proven spot: a spot with a fight budget,
  won at and not lost at since, the most recent first. With neither: a
  roofed (`indoor`) endless hunt on the floor of the fall, the lowest level
  first, never harder than the spot of the fall.
- `hold`: with no fallback, wait and probe the target after 10, 20, 40, then
  80 minutes.

The return never walks into a forced spot or along a forced road. A plain
hunt behind a forced road, with no fallback at all, is held on and walked to
again. A fallback is never on a higher floor than the fall.

A character with no activity, knocked out outside a forced fight, is sent
nowhere.

## Commands

| Command | Does | Refused when |
|---|---|---|
| `knockout/stay-here` | End the return. A leg under way completes and starts nothing. | no return is in flight |

## Requests made

`world/retreat`, `world/recover`, `world/start-activity`, `world/go`,
`world/ride`, `world/stay`.

## Events

Heard: `combat/defeat`, `statuses/damage`, `statuses/detonated`,
`statuses/fatal`, `combat/fight-won`, `world/player-command` (the return
ends: the character stays where the player put it).

Sent: `resources/defeat`, `counters/bump`, `raise`, `set`, `clear`,
`log/line`.

## View

`pending` (phase, target, fallback, wins, minutes left), `proven`,
`defeatDialogDue` (true when no return or fallback follows).

## Left behind

- `f11_wall` and the festival floors are never targets. The wall id is kept
  in `NEVER_TARGET_SPOTS`; the festival check arrives with the festival.
- A bench run or a performance ends the return: with those systems.
- A prestige ends the return: port 7.
- The defeat summary dialog: the view carries `defeatDialogDue`; no panel
  opens it yet.

## Differences from the old build

- A counter cleared by a knockout is cleared by an event. A pick made in the
  same handler is told which spot was just lost at.
- `combat` turns the hunt loop off at a defeat; the return turns it on again
  through the hunt activity.

## Old rules ported as they are

- The streak counter is bumped also for a forced fight lost with no activity.
- After the fallback's retry the pending return keeps the fallback, so a
  knockout at the fallback before the character sets out carries on to the
  target.
- A hold after a spent fallback waits where the character stands, not at the
  haven.
