# festival

The Vermin Festival, floors 15 and 16: one attempt runs from the dark room
to the royale's end. Step 4 port C4: the run and floor 15. Step 4 port C5:
the royale, its field and floor 16.

Port of the old `systems/festival.ts` (388 lines), `data/festival.data.ts`
(368), `data/survivors.data.ts` (299), `systems/festivalRules.ts` (153),
`systems/festivalValidation.ts` (99), the token half of `systems/stash.ts`
(174), `systems/royale.ts` (255), `royaleField.ts` (733), `royaleMap.ts`
(810), `royaleTerrain.ts` (86), `survivorGen.ts` (460),
`ui/lib/royaleView.ts` (383), `ui/lib/royaleMapImage.svelte.ts`,
`ui/lib/RoyaleField.svelte` (707), `ui/lib/RoyaleMinimap.svelte` (186),
`ui/panels/FestivalPanel.svelte` (197) and `ui/panels/StashPanel.svelte`
(118). The design is old `docs/FESTIVAL.md` and `docs/FLOOR_IDEAS.md`
section 5.3.

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
- Floors 15 and 16 are world content: the dark room, the hall and the five
  hub spots; the arena `f16_arena` in area `ascent_f16_area`
  (`world/content/spots.json`, `areas.json`); band 5 and floors 15 and 16
  (`ascent_f16`, clear `boss:f16_arena`, 850 XP) in `ladder`.
- `content/royale_*.json`, `content/survivor_*.json`: the royale's
  registries (below).

## The royale's pure modules (step 4 port C5, part 1)

Ported with their old tests, unchanged but for the imports. Each is a pure
function of its inputs and keeps its own random streams or takes the
generator it is handed. Part 2 wires them: `royale.ts` (the tick, caches,
dens, fights won), `royalePublish.ts` (the view), the panels.

- `royaleData.ts`: the royale part of old `data/festival.data.ts` and all
  of `data/survivors.data.ts`. The registries `royale_strategies`,
  `royale_sections` (registry order is the map's cell index),
  `royale_dens`, `royale_caches`, `survivor_species` (`id` is the monster),
  `survivor_families`, `survivor_archetypes` (`species` is a list of
  `{ monsterId, weight }`: the schema has no map), typed; the dials
  (`ROYALE_FIELD`, `SURVIVOR_TOOLS`, `CACHE_WEAPONS`, the name syllables,
  `ROYALE_LAYOUT_VERSION` 3, `RADAR_TICKS`, `COVER_SIGHT`); the field's
  saved shape (`RoyaleField`, `FieldFighter`).
- `royaleMap.ts`: the seeded terrain generator (old `royaleMap.ts`, 810
  lines). Builds the same map from the same seed as the old build.
- `royaleTerrain.ts`: sections, pace, sight, cover, the radar, dens and
  caches open. `sectionKnown(counter, field, id)` takes a counter reader.
- `royaleField.ts`: the field's simulation (old `royaleField.ts`).
- `survivorGen.ts`: the survivor generator (old `survivorGen.ts`). Same
  builds as the old build for the same seed, id and tools.
  `survivorMember` answers a `SurvivorMember`, combat's `StagedMember`
  shape.
- `royaleView.ts`: the map's pure reads (old `ui/lib/royaleView.ts`): the
  projection, camera, compass, fog, radar, section centres and the
  terrain's palette. The palette recipe names this build's colour tokens
  (`--color-*`); the old recipe named resource and material tokens this
  build does not have.
- `validation.ts`: the royale's lint checks, behind the optional third
  argument (strategies, plans, species, champion, dens, caches).

## State

Slice version 2:

```
{ run: FestivalRun | null, weaponKills: { <family>: number },
  lockedUntil: number | null, plan: string[],
  legacy: { tokens: { seed }[], bonus: number, techniques: string[] } }
```

`run` is `{ phase: 'dark' | 'prep' | 'royale', wave, nextAt, clock,
enteredAt?, held, issued?, lent?, fieldSeed, field? }`. `held` is what the
door holds: `equipment`, `inventory`, `sheathed`, `coating`, `flasks`,
`provisions` (`{ materials, stock }`). `field` is the royale's field
(`RoyaleField` in `royaleData.ts`): the survivors still standing (position,
health share, duels won, duel, engaged, goal, last fight, tools taken), the
player's place, target, goal and last fight, the fallen count, the layout
version, the terrain's seed, the tick it opened, the caches taken, the dens
cleared, the sections stood in, and the den being fought. Only the seed of
the terrain is saved; the map is rebuilt from it. `plan` is the player's
ranked strategies (empty: the default plan); kept between attempts, cleared
by a prestige (the old `FestivalState.plan` was run state).

Version 2 (port C5) adds `plan`; migration step 1 sets it empty. Fixtures
`tests/fixtures/festival/v1.json`, `v2.json`.

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
  ride to floor 16 (`world/ride`).
- **The ladder** (the world's `FloorRule`, registered at module load): from
  floor 15 to floor 16 `shut` while the room fights (a log line), `royale`
  after (the jump: `enteredAt` keeps the clock, the clock goes to
  `PREP_TICKS`); floor 16 from anywhere else `closed`; any other ride from
  inside an attempt, the tower's hub or a band hub, a `forfeit`. A move
  within the floor stood on is none of these. Inside an attempt the router
  sends the player to no stop, and it never sends them to a festival
  floor.
- **The royale** (`royale.ts`, port C5). Each tick the player stands on the
  arena in phase `royale`, out of travel and recovery: a field from another
  layout (or none) is made from the attempt's seed, never during a fight;
  with no fight open, survivors left engaged and a den fight left open walk
  again; an empty field gets its champion back; then the field steps
  (`stepField`, the kernel's generator) with the player's health share,
  level, travel speed, plan and the sections they know (scouted or stood
  in). The glade's spring heals the free player (`resources/heal-now`,
  kind `idle`). A cache the player reaches lends its piece (a plain copy,
  worn if its slot is free, else in the pack, uid in `run.lent`; a weapon
  cache lends `CACHE_WEAPONS` of the issued family; a lent weapon of the
  issued family takes the hand from the issued weapon, which goes to the
  pack) or heals at once. A den the player walks into is a staged fight
  with its foes at their pinned levels (`denFight` set). Survivors who
  reach the player, at most three and never the last free one, are a
  staged fight at the arena, each as its generated build (`survivorMember`:
  name, kit, attribute emphasis, level `survivorLevel(clock, wins, last)`,
  the wounds it carries); the last survivor fights as the champion. A
  fight won at the arena: a den fight clears the den and changes nothing
  else; a survivor fight takes them off the field (a line with the count
  left); the champion's fall is the win. Both reset the player's radar.
- **The loss.** An attempt whose player is off its floors is lost: checked
  on every arrival and at the start of every tick. A knockout on floors 15
  and 16 lands at the tower's hub (`ejectionSpotOf`, the world's
  `retreatSpot`); a festival spot is never a haven. The gear comes back (the
  issued weapon and the lent pieces taken back wherever they are; a held
  piece into its slot when it is empty and fits, else into the pack; the
  held flasks before the attempt's; the held oil unless the attempt's
  blade in hand carries its own; provisions on top), `festival:door` 0, and
  floors 15 and 16 shut for three world days or until the next prestige.
- **The win** (`winFestival`, the champion's fall): the gear comes back,
  the lent pieces taken back, `festival:wins` + 1, the laurel on a run's
  first win, a token at every hundredth win of the run, and
  `festival:swift_wins` + 1 with a title check when the climb began within
  twelve festival hours.
- **Tokens** (`festival/spend-token`): the permanent bonus (+3% damage and
  +3% max HP per stack, five stacks; the modifier source below), one of
  three techniques drawn from the token's seed (learned canonical now and at
  every run's start), or the regalia (minted into the stronghold stash).
  The legacy carries through prestige; a keep-marked piece held at the door
  goes back to the stash at prestige.
- **The kill count.** Every kill adds one to `weaponKills` of the family
  of the weapon in hand (`unarmed` with none; nothing for a family the table does
  not list).

Old rules kept as they are (port C5):

- A survivor's weapon cache gives a random `CACHE_WEAPONS` entry; the
  `unarmed` entry is iron gauntlets, which the survivor wears as armour, not
  as a weapon.
- A different item of the issued weapon's family always takes the hand:
  there is no ranking of weapons. The cliff cairn's old spear for an issued
  old spear does not (same item).
- The `weakest` move looks within the field's flat sight (20), not the
  looker's terrain sight.
- The champion's clear is floor 16's boss line, so it pays floor 16's clear
  XP twice (850 twice), the floor-clear bug noted in docs/CONTENT.md
  section 11 (older than this port).
- A den's monsters pay their kill XP and drops like any kill.

## Modifier source

`festival/player`, player only. While an attempt runs: the named fact
`festivalHolds` (the stash's take-out is shut, `items`) and
`festivalLent:<uid>` for the issued weapon and each lent piece (not sold,
`items`). With bonus stacks: `damage` and `maxHp` mult modifiers, labelled
"Festival bonus ×N", origin `legacy`. Touched at an attempt's start and
end, when a stack is bought and when a cache lends a piece.

## Commands and requests

| Name | Effect |
|---|---|
| `festival/spend-token` `{ index, choice }` | `choice`: `{ kind: 'bonus' }`, `{ kind: 'technique', id }` or `{ kind: 'regalia' }`. |
| `festival/move-on-field` `{ x, y }` | Walk to a point on the field by hand (held to the field); the plan takes over on arrival. The old `moveOnField`. |
| `festival/clear-field-target` | Drop the hand-set point: the plan decides again. The old `clearFieldTarget`. |
| `festival/set-plan` `{ ids }` | Rank the strategies: known ids, no repeats, at most three. The old `setRoyalePlan`. |
| `festival/begin-royale` (request) | The climb into the royale begins: the time jump. The world's ride asks it on the `royale` verdict. |
| `catchUpHold` (declaration) | Stops offline catch-up while the festival holds the player and banks the rest (above). |

The port C4 debug command `festival/debug-win` is gone: the royale is the
way to a win.

Requests it makes of other systems: `items/hold`, `items/return`,
`items/grant` (`plain`, `stash`, `wear`), `items/equip-now`,
`items/take-weapon`, `items/give-back`, `items/stash`,
`martial/hold-sheathed`, `martial/return-sheathed`, `martial/learn`,
`alchemy/hold`, `alchemy/return`, `materials/hold`, `materials/return`,
`combat/start-staged`, `world/ride`, `resources/heal-now`.

Events: hears `combat/kill` (the weapon count), `combat/fight-won` (the
dark room's next wave; the royale's field), `world/arrived` (the door; the
loss; the hold). Emits `counters/*`, `log/line`, `titles/check`,
`bonus/bank`.

## Catch-up

The festival is not simulated offline (kernel decision 35, request K3):
the system declares `catchUpHold`. `catchUp` asks `holds` before every
tick; the moment an attempt is live and the player stands on floor 15 or
16, from the first tick or from the tick a ride lands in the dark room,
the catch-up stops and `held` banks the ticks left with `bonus/bank`, 1:1
up to the bank's cap. The old `catchUpTicks` (`save/offline.ts` 67-83).
The old festival clock read no catch-up flag, and neither does this one.
The royale's field therefore never steps offline.

`holds` answers from memory: one boolean per festival slice object, never
saved, written by `noteHold` when an attempt starts or ends and on every
`world/arrived` (the floor stood on may have changed). A load and a new run
replace the slice object; the first ask after either reads the state once.

## Cost

With no attempt the tick reads its own slice and returns. While the player
stands on the field, each tick reads the clock, world, combat, resources,
levels and the stat block (the field steps every tick, so something is due
every tick), and reads the counters only when the player's plan asks which
sections it knows (a lazy read, at most once a tick). The view builds the
royale's part only while an attempt holds the player; it walks the
survivors once for the fog and builds a line per survivor in sight from a
memo (`royalePublish.ts`), never a copy of the whole field.

## View

`attempt` (while it holds the player): phase, fighters standing and waves
left, festival day, days, hour, seconds of play to the royale, survivors,
pieces held. `royale` (on the field): the terrain's seed and size, the
player's place and hand-set target, survivors standing, duelling and
fighting the player, the champion flag, the radar and its line, the
ground underfoot, the sight radius, the survivors on the player's map (far
to near, with icon, health share, duel, engaged, radar target), the same as
people (name and weapon from the generated build, tools taken), the caches
and dens on the map, and whether a fight is open. `preview` (in the hub):
the seed, the caches and dens of scouted sections, and each section's
scouted flag and counts. `plan` (while an attempt holds): the ranked ids
(the default plan when none is set), the slots, every strategy with its
condition as text, and whether a hand-set target holds. `enter` (in the
hub): "Enter the royale now" and why it is disabled. `lockoutLeft`.
`stash`: shown, the token's name, the bonus (stacks, cap, text),
techniques bought, tokens (per token: the bonus open, the offers, the
regalia open), the regalia, `holds` (take-out shut).

## Panels

- `FestivalPanel.svelte`: mounted in the Location panel under the sea's,
  shown while an attempt holds the player; draws the terrain images
  (`mapImage.ts`, once per seed and theme) and passes the view to
  `FestivalReadout.svelte`. The dark room (standing, waves left), the hub
  (day, hour, time to the royale, survivors, "Enter the royale now" with
  its reason when disabled, the preview of this attempt's field as a
  minimap with the scouted sections), or the royale
  (`RoyaleFieldReadout.svelte`), and the door's terms. Lines are "Label:
  fact" at fixed heights.
- `RoyaleFieldReadout.svelte` (old `RoyaleField.svelte`): the isometric
  field with its terrain, sections named, buildings, caches and dens, the
  sight ring, the radar arrow, the hand-set path, the survivors in sight;
  the compass; `RoyaleMinimap.svelte` over the field's corner (under it
  when the frame is narrower than 520 px). Controls: the ground (a click
  walks there; the arrow keys walk three units), the minimap (a click walks
  there), "Whole field", the plan's three pickers, "Back to the plan".
  Four status lines at fixed heights; the lists of who and what is known
  scroll in fixed boxes. The fight is the Combat panel's (the old panel
  drew the battle stage under the field).
- `royaleControls.ts`: each control's command, built by a function the
  panel and the tests share (`walkAt`, `nudgeCommand`, `planSlotCommand`,
  `backToPlanCommand`, `enterRoyaleCommand`).
- `StashPanel.svelte`: mounted in the Prestige panel. Each token's three
  choices (bonus, up to three techniques, regalia), each a button that
  sends `festival/spend-token`, and each kept item with a "Take out" button
  (`items/take-from-stash`), disabled inside an attempt.
- `tests/festivalPanels.test.ts` renders the readouts on the server, finds
  each control and sends its command.

## Skip reasons

- `festival/spend-token`: `the stash holds no token at index <i>`; `the
  festival bonus is at its cap of 5 stacks`; `this token does not offer
  "<id>"`; `the regalia cannot be kept in the stash`.
- `festival/move-on-field`: `no royale field is open`; `the player is not
  on the royale field`; `the point is not a number`.
- `festival/clear-field-target`: `no point on the field is set by hand`.
- The ladder's refusals are log lines (`door_shut`, `royale_closed`) and the
  world's `world/climb` skip reason.

## Not ported here

- The offline summary's festival lines, the ticks skipped and banked (the
  UI step).
- The old field's fallback for an attempt saved without a field seed (the
  field drew its own): every attempt here draws its seed at the door.
