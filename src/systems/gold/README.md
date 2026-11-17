# gold

The purse.

Port of: the `gold` field of the old `GameState` and the `gold:earned`
counter bumped beside it (old `systems/equipment.ts`, `systems/combat.ts`,
`systems/actions.ts`, `systems/quests.ts`).

## Slice

`{ gold }`. Starts at 0.

## Requests

| Request | Effect | Answer |
|---|---|---|
| `gold/add` `{ amount, earned }` | Adds `amount`. With `earned`, also emits `counters/bump` on `gold:earned`. | The purse after the change. |
| `gold/spend` `{ amount }` | Takes `amount` when the purse holds it. | `false`, and nothing taken, when it does not. |

The old build bumped `gold:earned` at each earning site by hand: a sale, a
drop, a job, a quest reward. A prestige boon's starting gold did not bump it.
The caller states which with `earned`.

## Read

`goldOf(ctx.read(gold))`.

## Skip reasons

None. `gold/spend` reports a short purse in its answer; the caller logs why
its own action did not happen.

## Left behind

- Every earning and spending site: drops call `gold/add` from `loot` now;
  jobs, tolls, quests and shops arrive with ports 6 and 7.
