# sea

The harbor band's convoys, floors 11 to 14. Step 4 port C3.

Port of the old `systems/sea.ts` (466 lines), `data/sea.data.ts` (232),
`systems/seaValidation.ts` (90), `text/sea.text.ts` (12) and
`ui/panels/SeaPanel.svelte` (167). The design is old `docs/HARBOR.md` and
`docs/FLOOR_IDEAS.md` section 4, idea 3.

## Content

- `content/sea_sides.json`: the four sides, in the berths' order on the
  quay. Each has a recruiter (`giver`), a join quest, a flow, its prey and
  its floor 14 mission (spot and boss).
- `content/convoys.json`: one row per water (9: the roadstead of floor 11,
  six waters of floor 12, the picket and the blockade of floor 13). Each
  row has three inclusive ranges (raiders, monsters, guard) and the cargo a
  crate pays.
- `content/sea_text.json`: the log lines of a leg and of a payment.
- `rules.ts`: the constants (`SEA`, `SEA_DEAL`, the three counter keys) and
  every pure rule.
- `validation.ts`: `seaContentIssues`, the content lint.
  `tests/worldContent.test.ts` runs it.

| Side | Flow | Per leg | Paid |
|---|---|---|---|
| Merchants | `convoy` | crates lost = clamp(raiders + monsters - kills - battery, 0, crates) | crates left after leg 4, sold for gold |
| Navy | `escort` | crates lost = clamp(monsters - kills - battery, 0, crates) | crates left after leg 4, as cargo |
| Pirates | `raid` | crates seized = clamp(battery - (guard - kills), 0, crates) | each leg, as cargo |
| Privateers | `recover` | crates recovered = clamp(battery - (raiders - kills), 0, carried) | each leg, as cargo |

The privateers' convoy starts with all 8 crates aboard the pirate ships.

## State

No slice of its own (docs/CONTENT.md decision Q6). The slice is `{}` at
version 1, as for `wards`.

| What | Where |
|---|---|
| The side | the join quest's accept stamp, `flag:quest:<id>:accepted` (`quests`). Each join quest requires the other three stamps at 0 |
| The schedule | derived from the clock's `totalTicks`: convoy n sails ticks [3600n, 3600n + 1200), four legs of 300 |
| The convoy the player sails with | run counters `sea:<water>:convoy`, `:leg`, `:crates`, `:carried` |
| Kills in the leg in progress | `sea:<water>:kills`, `sea:<water>:kills:leg` |
| Crates won (the clears read it) | `sea:crates:won` |
| Crates credited while catching up | `sea:crates:offline` |
| Fights won on a water | `fights:<water>`, counted here (a water has no fight budget, so combat does not count it) |
| Floor 14 done | `flag:sea:14:done`, set when the side's mission boss dies at its mission spot |

A prestige clears all of it with the run counters.

## A leg

The tick (order 17, after combat) resolves the leg that ends on the
clock's tick, for a player present at the water: standing on it, an
activity, a bench run or a fight under way, not travelling, not knocked out
(`presentAt`, which reads `isIdle` of `bonus`). The clock is read only on
the kernel tick where the next leg can end: the tick keeps that kernel tick
for the sea's slice object (a cache, never saved; a load and a new run
replace the slice object, and a miss reads the clock again). The clock's
tick is the only writer of the clock and adds 1 per kernel tick, so the
cache gives the outcome of reading the clock every tick. `tickSea` reads
the clock and is what the tests call.

1. The legs since the stored one sailed without the player: folded in with
   battery 0 and no kills (`cargoBefore`).
2. The battery fires: rating = volleys x hit + morale. The ship gives 1, 1,
   0. Cannons held (up to 4, never spent) add a volley each when a
   cannonball is spent; a powder charge adds 1 hit; a traveler's ration
   (lowest grade first) adds 1 morale. One of each is spent per leg
   (`materials/take`, `materials/take-graded`).
3. The side's prey killed at this water during the leg subtract, in place
   only. A kill on the tick a leg ends is that leg's (`killLeg`).
4. Credited in place: `sea:crates:won`, then gold (merchants, at the
   Speechcraft price) or one cargo material per crate from the row; a log
   line; `ladder/check`. Credited while catching up (`ctx.catchingUp`):
   `sea:crates:offline`, one cargo per 4, never `sea:crates:won`.

The merchants' price per crate is 9 gold plus each Speechcraft threshold
met: 5 (+1), 15 (+2), 30 (+3).

## Events

- Hears `combat/kill`: on a water, the side's prey count against the leg
  in progress (written with the request `counters/set-now`, so two kills of
  one tick both count); at a mission spot, the side's boss sets
  `flag:sea:14:done` and sends `ladder/check`.
- Hears `combat/fight-won`: on a water, bumps `fights:<water>` and sends
  `ladder/check`.

## Elsewhere

- `ladder`: `registerTermText` names `sea:crates:won` ("8 crates won") and
  `flag:sea:14:done` on the ladder card. `SPINE_EXEMPT` lists floor 14.
- `world` and `combat`: the road approach (a road's `approach`, stamped by
  the world on arrival with `combat/approach`, spent by the first fight at
  its end). Floor 13's picket road and pilot's channel and floor 14's four
  wings carry one.
- `counters`: the request `counters/set-now`.

## Panel

`SeaPanel.svelte`, mounted in the Location panel (old placement), shown at
a water, a recruiter's berth or a port onto a water, and with a side
anywhere on the harbor floors. Lines: the side, crates won, the convoy at
the water (leg, roll, kills, cargo), the battery and the hold, the
merchants' port price. Controls (`view.actions`): the water's hunt when not
sailing, and the join quest of the berth's side before a side is picked.
Each control sends the command its action carries; `tests/harbor.test.ts`
dispatches them.

## Skip reasons

The sea has no command of its own. A leg not resolved is not logged: the
old build logged nothing for a leg sailed without the player, and the
panel says "Not sailing".
