# bonus

Banked idle time. Port of the bank half of the old `systems/bonustime.ts`
(64 lines). Step 4 port C2 (docs/CONTENT.md section 5.3, decision Q4).

## What it does

- A tick in which the character does nothing is banked: one tick per tick,
  up to `BONUS_CAP_TICKS` (8 hours, the offline catch-up cap). Nothing is
  `isIdle`: no activity, no journey, no bench run, no fight, not knocked
  out. The old list also named a performance, which is not ported.
- Idleness is judged at the start of the tick, before anything moves
  (tick order -150: after `prestige` at -200, before `clock` at -100). The
  tick that starts or ends work is therefore not banked, as in the old
  `accrueBonusTime` at the top of `advance`.
- Catch-up banks the same way: the old offline run went through the same
  tick. The flag `ctx.catchingUp` is not read.
- `bonus/bank` (event, `{ ticks }`): bank a stretch at once, up to the cap.
  The old `bankTicks`. Sent by `prestige` from its `newRun` after the
  automatic prestige of the stronghold, which keeps the bank (a prestige by
  choice starts the next run at 0). Also the entry for a held world (the
  keeper's dare, the Facet hold of play, port F), none of which is here
  yet, and festival time away: since step 4 port C4 the festival's catch-up
  hold banks the ticks a catch-up did not run (kernel decision 35).

Slice version 1: `{ banked }`. Fixture `tests/fixtures/bonus/v1.json`. No
modifier source, no content, no command.

## Not ported: spending (the UI step)

The old build spent the bank as double speed on the player's say-so:
`bonusTime.spending` (off by default, saved), and while it was on, each
tick that was not idle ran a second whole advance (clock included) and took
one tick from the bank. That is a second kernel tick per frame, which the
run loop does, not a system; decision Q4 leaves the control and the second
advance to the UI step. The five old cases of `navigation.test.ts` "banked
idle time": three run in `tests/navigation.test.ts`, two stay `it.todo`
(spending doubles working ticks; off by default and saved). The ward case
"a bonus-time tick is a second advance and counts twice" of
`tests/wards.test.ts` waits for the same step.

## Panel

None. The old build showed the bank on the double speed button of the
header, which is the UI step. `view` (`banked`, `cap`) is for tests and
tools.

## Skip reasons

No command, so none.
