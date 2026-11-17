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

`pace = { resting, hpMult, healKind, halted }`, default
`{ false, 1, 'idle', false }`: standing about. The old `tickAction` chose
these per tick from the activity and the fight; here the world and combat
ports send `resources/set-pace`. `RECOVERY_MULT` (rest 15, job 4, train,
gather and craft 2, the rest 1) and `IN_COMBAT_REGEN_MULT` (0.5) are exported
for them. `halted` stops all regeneration: the old loop did not tick pools
while travelling.

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
- `resources/heal`, `resources/damage`: the amount is not above 0.

## Left behind

- Which activity gives which pace, `combatRegenMult`, recovery after a
  knockout: world and combat.
- The fight ledger's attribution (`noteIncoming`, `noteHealed`,
  `noteHealRefused`) and the Facet `hitTaken` signal: from `resources/healed`
  and `resources/damaged`.
- `resources/regenMult`: the fast's regeneration bonus (mutagens).
- Monster regeneration and `DOUSING_TYPES` (exported, unused): combat.
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
