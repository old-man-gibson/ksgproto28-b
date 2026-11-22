# festival

The Vermin Festival, floors 15 and 16: one attempt runs from the dark room
to the royale's end. Step 4 port C4: the run and floor 15. The royale, its
field and floor 16 are port C5.

Port of the old `systems/festival.ts` (388 lines), the run part of
`data/festival.data.ts` (368), `systems/festivalRules.ts` (153),
`systems/festivalValidation.ts` (99, without the royale's checks), the
token half of `systems/stash.ts` (174), `ui/panels/FestivalPanel.svelte`
(197, without the royale's field and preview) and
`ui/panels/StashPanel.svelte` (118). The design is old `docs/FESTIVAL.md`
and `docs/FLOOR_IDEAS.md` section 5.3.

## Content

- `content/dark_room_waves.json`: the dark room's nine in four waves, each
  foe a monster at a pinned level. The last wave is one fighter, the dark
  room's boss line (`boss:f15_dark_room`, floor 15's clear).
- `content/issued_weapons.json`: the weapon families in tie-break order,
  each with its skill and the starter the door issues (`unarmed`: none).
- `content/festival_text.json`: the log lines.
- `rules.ts`: the constants (`PREP_TICKS` ten festival days, 144,000 ticks;
  `LOCKOUT_TICKS` three world days; the counter keys; the token's bonus,
  technique pool and regalia; `SURVIVOR_LEVELS`; the hub's restock list)
  and the pure reads: `festivalFloorOf`, `ejectionSpotOf`, `festivalLadder`,
  `prepShare`, `prepLeft`, `survivorLevel`, `tokenTechniques`.
- `validation.ts`: `festivalContentIssues`, the dark room's waves and boss
  line. `tests/worldContent.test.ts` runs it.
- Floor 15 is world content: the dark room, the hall and the five hub spots
  (`world/content/spots.json`), band 5 and floor 15 in `ladder`.

## State

Slice version 1:

```
{ run: FestivalRun | null, weaponKills: { <family>: number },
  lockedUntil: number | null,
  legacy: { tokens: { seed }[], bonus: number, techniques: string[] } }
```

`run` is `{ phase: 'dark' | 'prep' | 'royale', wave, nextAt, clock,
enteredAt?, held, issued?, lent?, fieldSeed }`. `held` is what the door
holds: `equipment`, `inventory`, `sheathed`, `coating`, `flasks`,
`provisions` (`{ materials, stock }`). Fixture `tests/fixtures/festival/v1.json`.

Counters it writes:

| Key | Meaning |
|---|---|
| `festival:door` | 1 while the attempt's dark room door is open; 0 from an attempt's start and end. The hall's road reads it. |
| `festival:wins` | Royales won this run. |
| `festival:swift_wins` | Wins whose climb began within twelve festival hours of the door; the hidden title reads it. |
| `festival:shut` | 1 while a lost attempt keeps floors 15 and 16 shut (the ladder reads it). |

`weaponKills`: kills this run by the weapon family in hand, on every kill
anywhere (`unarmed` with no weapon). The old build kept them in the run
counters `kills:weapon:<family>`; only the door reads them, so they live
here, run state like the counters, and a kill costs one handler and no
counter event (measured: the counter bump cost the fight runs 1 to 2%).

`lockedUntil` and `festival:shut`: the old ladder read the lockout's end
tick against the world clock (`festivalLocked`). The ladder here reads
counters, so the loss sets `festival:shut` and the festival's tick clears
it on the tick the world clock reaches `lockedUntil`. The tick reads the
clock only on that kernel tick (a cache per slice object, never saved, as
the sea's leg end).

## Rules

- **The door.** Arriving in the dark room with no attempt starts one: the
  worn gear, the pack, the sheathed blade, the flasks, the oil on a blade
  and every provision (a consumable that is not a card) are taken and held.
  One plain weapon is issued and equipped: the family with the highest
  weapon skill, ties broken by `weaponKills`, then table order;
  the rusty sword with no skill, bare hands for `unarmed`. Its rune slots
  are rolled (one draw) and dropped. `festival:door` is set to 0, the hub's
  searches restock (their limits and the survey's eight scouted flags set
  to 0), and the attempt draws its field seed.
- **The dark room.** Four staged waves (`combat/start-staged` at the dark
  room's site), each 30 ticks after the last fell, only while the player
  stands there, out of a fight, not travelling, not knocked out. The fourth
  wave won opens the door: phase `prep`, the clock at 0, `festival:door`
  1.
- **The clock.** Runs one tick per tick while an attempt is past the dark
  room and the player is on its floors, travel and recovery included.
- **Day ten.** At `PREP_TICKS` with no fight the festival asks the world to
  ride to floor 16 (`world/ride`). Floor 16 is port C5: the ride is refused
  until then.
- **The ladder** (the world's `FloorRule`, registered at module load): from
  floor 15 to floor 16 `shut` while the room fights (a log line), `royale`
  after (the jump: `enteredAt` keeps the clock, the clock goes to
  `PREP_TICKS`); floor 16 from anywhere else `closed`; any other ride from
  inside an attempt, the tower's hub or a band hub, a `forfeit`. A move
  within the floor stood on is none of these. Inside an attempt the router
  sends the player to no stop, and it never sends them to a festival
  floor.
- **The loss.** An attempt whose player is off its floors is lost: checked
  on every arrival and at the start of every tick. A knockout on floors 15
  and 16 lands at the tower's hub (`ejectionSpotOf`, the world's
  `retreatSpot`); a festival spot is never a haven. The gear comes back (the
  issued weapon and the lent pieces taken back wherever they are; a held
  piece into its slot when it is empty and fits, else into the pack; the
  held flasks before the attempt's; the held oil unless the attempt's
  blade in hand carries its own; provisions on top), `festival:door` 0, and
  floors 15 and 16 shut for three world days or until the next prestige.
- **The win** (`winFestival`; the royale calls it, port C5): the gear comes
  back, `festival:wins` + 1, the laurel on a run's first win, a token at
  every hundredth win of the run, and `festival:swift_wins` + 1 with a
  title check when the climb began within twelve festival hours.
- **Tokens** (`festival/spend-token`): the permanent bonus (+3% damage and
  +3% max HP per stack, five stacks; the modifier source below), one of
  three techniques drawn from the token's seed (learned canonical now and at
  every run's start), or the regalia (minted into the stronghold stash).
  The legacy carries through prestige; a keep-marked piece held at the door
  goes back to the stash at prestige.
- **The kill count.** Every kill adds one to `weaponKills` of the family
  of the weapon in hand (`unarmed` with none; nothing for a family the table does
  not list).

## Modifier source

`festival/player`, player only. While an attempt runs: the named fact
`festivalHolds` (the stash's take-out is shut, `items`) and
`festivalLent:<uid>` for the issued weapon and each lent piece (not sold,
`items`). With bonus stacks: `damage` and `maxHp` mult modifiers, labelled
"Festival bonus ×N", origin `legacy`. Touched at an attempt's start and end
and when a stack is bought.

## Commands and requests

| Name | Effect |
|---|---|
| `festival/spend-token` `{ index, choice }` | `choice`: `{ kind: 'bonus' }`, `{ kind: 'technique', id }` or `{ kind: 'regalia' }`. |
| `festival/debug-win` | DEBUG, refused in a production build. Ends the attempt as a royale won. Until port C5 brings the royale, the only way to a win; the tests use it. |
| `festival/begin-royale` (request) | The climb into the royale begins: the time jump. The world's ride asks it on the `royale` verdict. |
| `catchUpHold` (declaration) | Stops offline catch-up while the festival holds the player and banks the rest (above). |

Requests it makes of other systems for the door: `items/hold`,
`items/return`, `items/grant` (`plain`, `stash`), `items/equip-now`,
`items/stash`, `martial/hold-sheathed`, `martial/return-sheathed`,
`martial/learn`, `alchemy/hold`, `alchemy/return`, `materials/hold`,
`materials/return`, `combat/start-staged`, `world/ride`.

Events: hears `combat/kill` (the weapon count), `combat/fight-won` (the
dark room's next wave), `world/arrived` (the door; the loss; the hold).
Emits `counters/*`, `log/line`, `titles/check`, `bonus/bank`.

## Catch-up

The festival is not simulated offline (kernel decision 35, request K3):
the system declares `catchUpHold`. `catchUp` asks `holds` before every
tick; the moment an attempt is live and the player stands on floor 15 or
16, from the first tick or from the tick a ride lands in the dark room,
the catch-up stops and `held` banks the ticks left with `bonus/bank`, 1:1
up to the bank's cap. The old `catchUpTicks` (`save/offline.ts` 67-83).
The old festival clock read no catch-up flag, and neither does this one.

`holds` answers from memory: one boolean per festival slice object, never
saved, written by `noteHold` when an attempt starts or ends and on every
`world/arrived` (the floor stood on may have changed). A load and a new run
replace the slice object; the first ask after either reads the state once.

## View

`attempt` (while it holds the player): phase, fighters standing and waves
left, festival day, days, hour, seconds of play to the royale, survivors,
pieces held. `lockoutLeft`. `stash`: shown, the token's name, the bonus
(stacks, cap, text), techniques bought, tokens (per token: the bonus open,
the offers, the regalia open), the regalia, `holds` (take-out shut).

## Panels

- `FestivalPanel.svelte`: mounted in the Location panel under the sea's,
  shown while an attempt holds the player. The dark room (standing, waves
  left) or the hub (day, hour, time to the royale, survivors), and the
  door's terms. Lines are "Label: fact" at fixed heights. No control in this
  port: the old panel's "Enter the royale now" climbs to floor 16, which
  comes with port C5; the climb is the ladder card's meanwhile.
- `StashPanel.svelte`: mounted in the Prestige panel. Each token's three
  choices (bonus, up to three techniques, regalia), each a button that
  sends `festival/spend-token`, and each kept item with a "Take out" button
  (`items/take-from-stash`), disabled inside an attempt.
  `tests/festivalPanels.test.ts` renders both on the server and sends each
  control's command.

## Skip reasons

- `festival/spend-token`: `the stash holds no token at index <i>`; `the
  festival bonus is at its cap of 5 stacks`; `this token does not offer
  "<id>"`; `the regalia cannot be kept in the stash`.
- `festival/debug-win`: `the debug win is refused in a production build`;
  `no festival attempt is in progress`.
- The ladder's refusals are log lines (`door_shut`, `royale_closed`) and the
  world's `world/climb` skip reason.

## Not ported here

- The royale: its field, map, terrain, survivors, dens, caches, lent gear,
  plan and the arena (port C5). `winFestival` waits for it.
- The royale's lint checks (strategies, plans, species, champion, dens,
  caches).
- The offline summary's festival lines, the ticks skipped and banked (the
  UI step).
