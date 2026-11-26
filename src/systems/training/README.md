# training

Training spots: a keeper who looks after beginners and, now and then, dares
them. The Cages (Threshold, the Ironyard) are the only such spot. Port of the
old `systems/training.ts` (141 lines), its five log lines
(`text/log.text.ts` 195-200), `DareModal.svelte` (the dare window) and the
dare's lines of `Game` (`answerDare`, the hold in `tick` and `advance`).
Step 3 gap, branch `step3-gaps` (docs/SPINE.md section 22).

## What it does

- **The keeper** (`SpotDef.healBetweenBouts`). On `combat/fight-won` at a
  spot with a keeper, while the six trained attribute levels total
  `maxAttrTotal` (30) or less: heal to full (`resources/heal-now` for the
  derived max HP) and remove every damage-over-time condition that is not
  hidden (`statuses/remove`). If either did something: bump
  `training:patched` and log the first-patch line (it names the cap) or the
  short line. A forced fight's win heals too.
- **The dare** (`SpotDef.dare`). After the keeper's patch, on a win that is
  not forced, while the dare's monster is unbeaten (`kills:<monster>` 0):
  bump `dare:<spot>:wins`; at `every` (8) it goes back to 0, and
  `dare:<spot>:pending` and `hold:dare` are set to 1, with the line "The cage
  keeper stops the cages". The keeper stops asking once the slime is beaten
  or the attributes pass the cap.
- **The answer**, command `training/answer-dare { accept }`: lifts the hold
  first, then clears the pending flag. Accept while standing at the spot:
  the line, then `combat/start-staged` with the dare's monster at the dare's
  level (alone, plain, unfleeable). Otherwise (a pass, or accept away from
  the spot): the pass line.
- **The window** (`overlay.ts`, modal): `DareModal.svelte` passes the view and
  `send` to `DareReadout.svelte` (props only). It shows while a dare waits:
  the foe, its size against the player's body (`items` bearer size), what it
  resists, the keeper's words, HP, the bonus bank, and two buttons (the
  view's `actions`: Fight, Flee).

State lives in counters, as the old build kept it in stats (the save shape
did not change for it there either): `dare:<spot>:pending`,
`dare:<spot>:wins`, `hold:dare`, `training:patched`. The slice is empty.

## The hold of play

While a dare waits, play is held (kernel decision 36, K2, approved for this
port by the parent session on 2026-11-22):

- Live: the system declares `playHold`. The kernel keeps the answer of
  `holds` (decision 37: asked after `ctx.holdChanged()`, a load or a new
  run); while it holds no system ticks, the tick number stays, and
  `held` emits `bonus/bank { ticks: 1 }`: each held tick is banked as bonus
  time, as the old `Game.tick` did (`bankTick` and return). Commands still
  run, so the answer gets through and lifts the hold; the view still
  publishes.
- Offline: the system also declares `catchUpHold` (decision 35) with the
  same `holds`; `held` banks the ticks left. Catch-up reads the kept
  answer (a play hold needs a catch-up hold; decisions 36, 37). The old catch-up went through
  the same `Game.tick` and banked each held tick, up to the cap: the same
  bank. A dare posed mid catch-up stops it there; a short gap that the shell
  ticks in place (30 ticks or fewer) banks tick by tick.
- `holds` reads `hold:dare` and the pending flags. The system says
  `ctx.holdChanged()` when a dare is posed and when it is answered; the
  kernel asks after that step's events (the counters) are delivered, and
  after a load or a new run. A hold with no pending dare behind it (content
  renamed under a save) is dropped on that read: the counter is cleared and
  play runs (the old `dareHolds`). Until step 4 port F `holds` was asked
  before every tick and answered from a memory of one boolean per slice
  object (decision 37).
- The old step buttons (`step`, `stepToEvent`), which did nothing while
  held, have no counterpart here.

## State

Slice version 1: `{}`. Fixture `tests/fixtures/training/v1.json`. Registry
`training_text` (the five lines). No modifier source, no tick hook; a play
hold and a catch-up hold.

## Old rules ported as they are

- Accepting the dare away from its spot reads as a pass: the hold lifts, the
  pending flag clears, the pass line is logged, no fight starts.
- An answer with no dare waiting still clears a stray `hold:dare` (the old
  `delete state.stats[HOLD_KEY]` came first); the command then returns its
  reason.
- The keeper heals after a forced win at the spot too (the dare's own fight
  included); only the count toward the next dare skips forced wins.
- The heal is for the derived max HP, not the pool's available max, as the
  old `heal(state, stats, stats.maxHp)`.

## Differences from the old build

- Handler order on `combat/fight-won`: systems in system order (`ladder`
  before `training`, then `knockout`, `sea`, `festival`, `facet`). The old
  bus ran the training listener before knockout, sea and the floor-clear
  check. The Cages have no floor clear, sea or festival rule.
- The heal's status event ("being tended") reaches the conditions in the
  drain after the keeper's handler, after the damage-over-time conditions
  were removed; the old heal fired it before the removal.
- Counter writes are events, so the wins count is computed from the value
  before the bump.

## Skip reasons

- `training/answer-dare`: "no dare is waiting".

## Tests

`tests/training.test.ts`: the 11 old cases (keeper 3, dare 6, David and
Goslimath 2) and 12 new: the hold (a held tick moves nothing but the bank,
the answer gets through, catch-up with a dare waiting and with one posed
mid-way, the kept flag after a load and a new run), the keeper's lines, the
answer's old rules, the window rendered on the server and dispatched. The
kernel's play hold has its own cases with a toy system in
`tests/runner.test.ts`.
