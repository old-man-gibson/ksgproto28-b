# resources

The five pools (HP, stamina, mana, spirit, focus), stamina's fighting rules,
and health.

Port of: old `systems/resources.ts` (`pools.ts`), `systems/stamina.ts`
(`stamina.ts`), `systems/health.ts` (`health.ts`), `data/resources.data.ts`,
and the lock announcer of old `game.ts` (`checkResourceLocks`).

## Rules

- A pool has a **true max** (a derived stat) and an **available max** (true
  max times the ceiling hook, floored). The reserve floor is measured against
  the true max.
- `spend` ignores the reserve and latches the **empty** lock at zero.
  `draw` stops at the reserve floor and latches the **low** lock there. A
  locked pool pays nothing to `draw`. A lock clears only when the pool reaches
  its available max.
- Regeneration per tick is the regen stat / 10. An empty-locked pool
  regenerates at `emptyRegenMult` until it passes `slowUntil`. A pool in debt
  recovers toward zero first. A `static` pool (spirit) sits at its max.
- HP does not regenerate through the pool tick. It recovers through `heal`:
  every tick the trickle is `hpRegen x pace.hpMult / 10`.
- An empty-locked pool gives its `emptyPenalty` modifiers (stamina: -15%
  speed).
- Stamina: `attackUpkeep`, `exert` (a fraction of max per event, trimmed by
  efficiency; a partial payment buys a proportional bonus; stamina power
  multiplies what is bought; a `drain` style spends the whole bar),
  `rollExtraHits`.

## Slice

| Field | Holds |
|---|---|
| `values` | Current value per pool. A new game starts full: 50, 11, 1, 5, 6. |
| `locks` | `low` or `empty` per pool; absent is not locked. |
| `exerting` | The player opted in to the style's exertion bargain. |
| `announced` | The lock of each pool as last written to the log. |
| `pace` | What the current activity does to regeneration (below). |

## Pace

`pace = { resting, hpMult, healKind, halted, inCombat }`, default
`{ false, 1, 'idle', false, false }`: standing about. The old `tickAction` chose
these per tick from the activity and the fight; here the world and combat
ports send `resources/set-pace`. `RECOVERY_MULT` (rest 15, job 4, train,
gather and craft 2, the rest 1) and `IN_COMBAT_REGEN_MULT` (0.5) are exported
for them. `halted` stops all regeneration: the old loop did not tick pools
while travelling.

`inCombat` (slice version 2, spine port 4): while it is set, the health
trickle is multiplied by `IN_COMBAT_REGEN_MULT` on every tick on which
stamina is below its available max. This is the old `combatRegenMult` of
`systems/actions.ts`. It is computed here, in the tick, so it reads stamina
after the pool tick of the same tick, as the old loop did. `combat` sends
`{ inCombat }` when a fight starts and when it closes, and `{ hpMult: 15,
healKind: 'rest' }` while a hunt rests before its next fight.

## Command

- `resources/set-exerting` `{ on }`.

## Requests

`resources/spend`, `resources/draw`, `resources/restore`, `resources/drain`
(`{ id, amount }`), `resources/heal` (`{ amount, kind? }`),
`resources/damage` (`{ amount, type?, source? }`), `resources/defeat`,
`resources/exert` (`{ spec }`), `resources/set-pace`.

Emitted: `resources/spent` (a draw, with the true max, for a condition that
eats effort), `resources/lock-changed`, `resources/healed` (kind, asked,
allowed, healed; also when the cap let nothing through), `resources/damaged`
(lost, type, source), `resources/exerted` (what an exertion bought).

## Requests with an answer (spine port 4, docs/KERNEL.md section 7a)

A fight resolves a blow, checks whether the player still stands, and spends
stamina before it reads what an exertion can still buy, all in one handler.
Each request does what the event of the same meaning does, emits the same
result event, and answers the result.

| Request | Answer | Event of the same meaning |
|---|---|---|
| `resources/hit` `{ amount, type?, source? }` | The health lost. | `resources/damage` |
| `resources/heal-now` `{ amount, kind? }` | `{ kind, asked, allowed, healed }` or null. | `resources/heal` |
| `resources/exert-now` `{ spec }` | What the exertion bought (a copy). | `resources/exert` |
| `resources/draw-now` `{ id, amount }` | The amount spent. | `resources/draw` |
| `resources/spend-now` `{ id, amount }` | The amount spent. | `resources/spend` |

## Hooks for other systems

Stats of this system under the kernel's default formula. Another system
moves them from a modifier source of its own. The statuses system (source
`statuses/held`) feeds every one but `regenMult`, for every entity.

| Stat | Base | Old function it replaces |
|---|---|---|
| `resources/ceiling.<pool>` | 1 | `statusCeiling`: mult modifiers, one per wound. |
| `resources/costMult.<pool>` | 1 | `statusCostMult`. |
| `resources/regenBlocked.<pool>` | 0 | `statusBlocksRegen`: above 0 blocks. |
| `resources/headroom.<pool>` | 0 | `statusNegativeHeadroom`, as a share of true max. |
| `resources/regenMult` | 1 | The fast's regeneration bonus (`fastRegenBonus`). |
| `resources/healCapped`, `resources/healAllowance` | 0 | `healAllowance`: when capped is above 0, a heal is limited to the allowance. |

Source `resources/locks` (`LOCKS_SOURCE`) returns the lock penalties. It is
touched when a lock or the exerting flag changes. A source of another system
that reads either declares `dependsOn: [LOCKS_SOURCE]`.

## Skip reasons

- `resources/set-exerting`: exertion is already on, or already off.
- A pool request: unknown pool.
- `resources/heal`, `resources/damage`, `resources/hit`,
  `resources/heal-now`: the amount is not above 0.

## Left behind

- Filled by spine port 6: `world` sends the pace of each activity, of travel
  and of the recovery; `knockout` sends `resources/defeat`.
- The Facet `hitTaken` signal: from `resources/damaged`. The fight ledger's
  attribution is in `combat` (spine port 4), from `resources/healed` and
  `resources/damaged`.
- `resources/regenMult`: the fast's regeneration bonus (mutagens).
- Monster regeneration reads `DOUSING_TYPES` in `combat` (spine port 4).
- The `cssVar` fields of the registry name colour tokens of the old
  interface. They are kept as data and not read.

## Differences from the old build

- `exert`, `heal` and `damage` returned a value to the caller. Here the
  result is an event. `docs/KERNEL.md` decision 27.
- A lock change is written to the log in this system's tick. A lock that
  changes later in a tick, in another system's handler, is announced on the
  next tick. The old loop announced at the end of the same tick.
- The heal allowance is a stat. Two heals inside one handler both see the
  allowance as it was before the first, until the statuses system has
  handled `resources/healed`.
- Conditions hear a heal, a blow and a spend through `resources/healed`,
  `resources/damaged` and `resources/spent`, after the handler that caused
  them returns. The old functions called the status module inside `heal`,
  `damagePlayer` and `spendResource`.

## Step 3 (the alchemy port)

- Request `resources/restore-now { id, amount }`: restore up to the
  available max, or with a negative amount take, never under 0 (a
  refuse-grade consumable: the old direct write). Answers the signed change.
  Health that is taken this way does not knock out, as in the old build.
