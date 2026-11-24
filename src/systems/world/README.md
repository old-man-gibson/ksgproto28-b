# world

Where the character stands, travel, the map, activities, finds, havens and
the retreat. Spine port 6.

Port of the old `systems/locations.ts`, `systems/actions.ts` (without the
condition tick), `systems/mapped.ts`, `systems/safety.ts`,
`systems/search.ts`, `systems/activitydrops.ts`, `systems/keyitems.ts`, the
moving half of `systems/towers.ts` (`climbTo`, `rideLeg`, `ride`),
`officeArrival` and `rewardTollGolem` of `systems/floodedFloor.ts`, and
`data/locations.data.ts`.

## Files

| File | Holds |
|---|---|
| `defs.ts` | Registries and schemas, the mirrored roads (`ADJACENCY`), lookups with no state |
| `engine.ts` | The slice type and every rule: roads, the pathfinder, rides, travel, arrival, activities, finds, drops, the retreat, the office block of floor 1 |
| `index.ts` | The declaration: commands, requests, events, the view |
| `LocationPanel.svelte`, `panel.ts` | The Location panel |
| `content/regions.json`, `areas.json`, `spots.json`, `key_items.json`, `world_text.json` | 3 regions, 16 areas, 80 spots, 3 key items, the log lines |

## Slice (version 1)

`spot`, `discovered`, `travel { from, to, ticksLeft, total, fresh? }`,
`travelPlan`, `travelIntent`, `activity`, `activityProgress`,
`resumeActivity`, `explored`, `finds`, `safeSpots { nearest, unconditional }`,
`recovering`. Each is the old `GameState` field of the same name.

`travel.fresh` is set when another system starts a leg inside a tick, before
this system ticked. The first tick clears it and does not count: the old loop
returned after the step that set out.

## Commands

| Command | Old function | Refused when |
|---|---|---|
| `world/travel-to { to }` | `travelPlanTo` | unknown spot; a journey is under way; knocked out; standing there; in a forced fight; no known route |
| `world/go-and-do { spot, activity }` | `goAndDo` | unknown spot or activity; knocked out; the activity cannot start now; a journey is under way; no known route |
| `world/select-activity { activity }` | `selectActivity` | a journey is under way; knocked out; the spot has no such activity; a search with nothing left to pay; in a forced fight |
| `world/set-intent { activity }` | `setJourneyIntent` | no journey is under way; the end of the journey has no such activity |
| `world/cancel-plan` | `cancelTravelPlan` | no further leg is planned |
| `world/climb { floor }` | `climbTo` | a journey is under way; knocked out; no ladder answers here, the floor is not unlocked, or the fight cannot be left |
| `world/fast-travel { to }` | `fastTravelTo` | not waypoint to waypoint, not discovered, a forced fight, or the fee is not held |

Every accepted command emits `world/player-command`, which ends a knockout
return in flight.

## Requests answered

For `knockout`, which needs the outcome inside its tick or handler:
`world/start-activity`, `world/go`, `world/ride`, `world/retreat`,
`world/recover`, `world/stay`.

For `tutorial` and `prestige` (spine port 7): `world/place { spot, newRun }`
(`placeAt`): stand the player at a spot with no road walked. Without
`newRun` (the skip of floor 0): the spot is discovered, noted as a haven,
the region revealed, and `world/arrived` sent. With `newRun` (the start of a
run): the spot is the only one discovered, the region revealed, no haven
noted, no arrival sent.

## Requests made

`combat/set-hunt`, `combat/stop-hunt`, `combat/start-forced`,
`combat/abandon`; `gold/add`, `gold/spend`; `materials/grant`,
`materials/grant-graded`; `items/grant`, `items/grant-rune`; `mercy/chance`.

## Events

Emitted: `world/arrived { spot, from, ambushed }`, `world/activity-changed`,
`world/player-command`, `world/cycle` (a train, job or gather cycle
completed), `world/discovered`.

Sent to other systems: `resources/set-pace`, `statuses/situation { down }`,
`counters/bump` and `counters/set`, `skills/grant-xp`,
`skills/check-discovery`, `attributes/grant-xp-split`, `ladder/check`,
`log/line`.

Heard: `ladder/floor-cleared` (the hunt site is sent again), `combat/kill`
(the toll collector: the toll stamp and `flag:toll_brute_force`). The
spell flag `flag:toll_encounter_spell` and the collector's reactions to heat,
cold and lightning are set in `spellcraft` (`cast.ts`).

## Rules

- **Roads.** A road that is not `oneWay` is mirrored. The mirror carries the
  label and never `forced`, `requires`, `revealWhen` or `hidden`.
- **Pathfinder.** Shortest by base ticks, over discovered spots, visible
  roads and the rides of the ladder. Not through a shut road. Not through a
  forced spot or a forced road that is not cleared; such a spot may be the
  destination. The last hop may be undiscovered.
- **Rides.** A ride goes to a discovered stop whose gate is open. The first
  ride onto a floor is `world/climb`. Price: 45 ticks per rung, at least one.
- **Arrival.** Discovery, the mapped region, the haven (a peaceful arrival
  only), `world/arrived`, then the forced fight, the next leg, or the settle:
  the intent of the journey if it names this spot, else the activity last
  chosen here.
- **Activities.** `rest`, `hunt`, `train`, `search`, `explore`, `job`,
  `gather`. The hunt keeps the hunt loop of `combat` on with the site of the
  spot. A forced spot that is not cleared starts its fight on every tick with
  no fight, whatever is selected.
- **Pace.** `resources/set-pace` on every change: `halted` while travelling
  (pools and conditions do not tick), `RECOVERY_MULT` per activity kind,
  resting at a rest activity and while knocked out.
- **The retreat.** The nearest haven that can still be used, else the last
  unconditional haven, else the starting spot.
- **Floor 1 offices.** The doors lead where they say only in the order
  scribe, auditor, break room, scribe, toll hall, with the office key. A
  wrong door resets the sequence and lets out in another office.

## The site

`siteOf(ctx, spot)` builds the `EncounterSite` of `combat` from a spot, with
`levelStep` and `dynamicLevel` from `ladder`.

## Left behind

- Fields kept in the data and not read: `recipes`, `benches` (crafting and
  the benches, step 3), `caged` (the bestiary), `scene` and `map` (the UI
  step). `healBetweenBouts` and `dare` are read by `training` (step 3 gap).
- Craft activities, bench runs, performances.
- `cardSpent` of the old activity drops: a card is not rolled while one is
  held; whether its recipe, word or technique is already known cannot be read
  until those systems exist.
- The approach of a road (`ApproachSpec`, `pendingApproach`): no road in
  scope has one. Step 4.
- The festival forfeit, the seam verb of floor 20.
- Bonus time.
- The surveyed plan of the map and the Stations row.

## Differences from the old build

- The hunt site is stored in the `combat` slice. It is sent when the hunt
  starts and again when a floor is cleared.
- Counter writes are events. The search counts its own roll before the
  counter shows it.
- A command returns a reason. The old functions returned `false`.

## Old rules ported as they are

- `world/fast-travel` has no button, as in the old build. The scope has one
  waypoint (`ascent_foot`), so it cannot run.
- A find is claimed before its payload is handed over.
- A fully explored spot still rolls 0.8% per tick for 1 to 4 gold and more.
- The fully explored line names hidden roads by label; no road in scope is
  hidden.
- `the_cages` carries `caged`, `dare` and `healBetweenBouts`; the bestiary
  and `training` read them.
- The Great Hall's description names two escorts. The escorts are monster
  data (`combat`), not the spot's table.

## Step 3 (the alchemy port)

- Request `world/drop-activity` (`dropActivity` in `engine.ts`): the
  activity cleared, progress 0, the pace sent again, `world/activity-changed`
  when there was one. No fight is left and no plan is cleared: the old
  `startBenchWork` set `activity = null` and nothing else. `benches/start`
  asks it.
- `registerCardSpent(check)`: the old `cardSpent` of the activity drops.
  `consumables` registers it at module load (this system cannot import
  `consumables`, which imports `martial`, which imports this one). A
  one-time card is not rolled while held or once spent.
- `benches` hears `world/activity-changed` and drops its run when an
  activity is picked; it emits `world/player-command` when a run starts.
- The `benches` field of a spot is read by the Alchemy panel (`alchemy`).
  Performances still wait. Craft activities: see the next section.

## Step 3 (the smithing port)

- `ActivityDef` gains `kind: 'craft'` and `recipe` in its TypeScript type
  only. The spot schema does not accept `craft`: content cannot author one.
- `registerCraftKind(provider)` in `defs.ts`, called by `crafting` at module
  load (`CraftKind`). `spotActivities(spot)` appends one craft activity per
  listed recipe the provider knows, after the spot's own (old order). It
  caches per spot object. Without a provider it is the spot's own list.
- `activityXpTags`: `['craft', ...tags]`. `activityCost`: the recipe's
  ticks, 50 for an unknown recipe. `activityFillRate`: speed x speed factors
  x `craftSpeed` x the scoped `craftSpeed` of the activity's tags.
- `startActivity` refuses a locked craft and logs `craft_locked`.
  `world/select-activity` answers `the recipe "<id>" is locked`. It no
  longer runs `canStartActivity` on a craft: the old `selectActivity` let an
  unaffordable craft start.
- `canStartActivity`: a craft is unlocked and affordable (old). Arrival,
  `world/go-and-do` and `world/start-activity` read it.
- `trainingSpots(ctx, state, target)`: takes the reads, skips locked crafts.
- `runWorldTick`: `case 'craft'` runs the provider's `tick`. False stops the
  activity (progress 0, pace, `world/activity-changed`).
- The view: `ActivityView` gains `locked` and `detail`. A secret recipe not
  yet unlocked is left out of the list. A locked craft is blocked with its
  requirement line.
- `crafting` emits `world/cycle` with `baseTicks` = the recipe's ticks.

## Step 4 port C1

- Content: the castle area and floors 7 to 10 (5 areas, 16 spots: the
  castle court and 15 ward spots), appended from the old registry.
- Command `world/climb-hub { band }` (old `climbToHub`): ride to a band's
  hub once the band is open. Skip reasons: a journey is under way, the
  character is knocked out, the fight cannot be left, the ladder does not go
  to the hub from here now. Band hubs were already ride stops and router
  stops (`rideStops`).
- The castle court is a haven by the existing rule (a rest activity).
- The ladder card of the location panel shows the hub before the band's
  first floor: status, the band gate, a ride button.


## Step 4 port C2

- Content, appended from the old registry: region `the_hold` (Your Hold,
  sheltered), areas `player_base_v1_area` (the hold, no floor) and
  `ascent_f11_area` (open sky), the 25 `base_*` spots of the hold and the 4
  stronghold spots of floor 11 (`f11_road`, `f11_gatehouse`, `f11_yard`,
  `f11_wall`). 125 spots in all.
- Left out until port C3: the road's edge on to the harbor (`f11_road` to
  `f11_quay`, gated on `legacy:stronghold`); the quay is not here.
- The hold's doors: `f11_gatehouse` to `base_entrance` and back, both
  one-way and gated on `legacy:stronghold` (`OFF_LADDER_DOORS` of `ladder`);
  `base_entrance` to `ascent_foot` one-way, always open. No road from the
  Foot into the hold. `base_entrance` is no waypoint. The map lists the
  gatehouse door as an exit of the Ascent once it is visible, and the two
  doors as exits of the hold (`view.map.exits`, no new code).
- The wall stair (`f11_yard` to `f11_wall`) needs `f11_arm_the_wall` done
  and `legacy:stronghold` 0; its encounter lines read the same and the
  wall's fight count (raiders and brutes to 6 fights won, the captain at
  7). `f11_wall` has `fightLimit` 8.
- The hold's spots keep their old `benches` lists (spellcraft table,
  alchemy, mutagens, the kitchen line, runecarving): the bench systems read
  them, so the hold's tables work as the old ones did. The Arcane Library
  is a third Spellcrafting Table in the psionic view.
- The Training Area hunts `training_dummy` (passive, pays no level XP).

## Step 4 port C3

- Content, appended from the old registry: areas `ascent_f12_area`,
  `ascent_f13_area` and `ascent_f14_area` (open sky), the six harbor
  spots of floor 11 (`f11_quay` with the three battery recipes, four
  berths, `f11_roadstead`), 8 spots on floor 12, 3 on floor 13, 9 on
  floor 14, and the road `f11_road` to `f11_quay`, shown and open with
  `legacy:stronghold`. 151 spots, 26 areas. A find's gold is
  `{ min, max }` (`f12_port_purse`).
- The road approach (old `ApproachSpec`): a road may carry `approach`
  (`requires`, `enemies`, `self`, each a list of status applications).
  The mirror never carries it. On every arrival the world sends
  `combat/approach` with the road's approach when its `requires` hold,
  or with `null` when something is stamped and this road has none (old
  `tickTravel`: an arrival without an approach wipes the stamp). The
  caravan and `placeAt` clear it. Combat spends it (see the combat README).
- The harbor readout of the `sea` system is mounted in the Location
  panel, under the activities (old placement, docs/KERNEL.md decision 29).

## Step 4 port C4

- Content, appended from the old registry: area `ascent_f15_area` (roofed,
  scene `hall`) and floor 15's seven spots: `f15_dark_room` (the landing;
  its road to the hall opens on `festival:door`), `f15_hall` (rest, two
  drills, the stove), `f15_stores`, `f15_survey`, `f15_herb_yard`,
  `f15_workshop` (the smelt, the alembic and the anvil) and `f15_gallery`
  (rest, a three-attribute drill, a one-way stair to the dark room). The
  hub's searches are finite and run on the clock (`staticTime`). 158 spots,
  27 areas.
- `FloorRule` (`registerFloorRule`, at module load; the `festival` system
  registers it, since it imports this one):
  - `ejection(spot)`: a knockout at a festival spot lands at the tower's
    hub (`retreatSpot`, old `ejectionSpot`), and such a spot is never
    noted as a haven (`noteSafeSpot`).
  - `unrouted(floor)`, `routesHeld()`: the router never sends the player to
    a festival floor, and to no stop at all inside an attempt
    (`routableStops`).
  - `ride(toFloorId)`: the verdict on a climb, after the ladder's own
    terms (old `rideGate` and `climbTo`). `refuse` logs its line and
    refuses; `forfeit` abandons a fight in progress, throws the player
    clear (`retreatToSafety`) and answers true; `enter` runs before the
    ride (the royale's time jump). `climbToHub` asks it with a null floor.
- `ejectionSpot(spotId)` and `rideVerdict(reads, toFloorId)`, exported.
- The view's `rideVerdicts`: the rule's verdict on each ride from here, by
  floor id (`''` for a hub). The ladder card words a forfeit ride
  "Forfeit: ride to floor N" with the forfeit line as its title, and
  disables a refused one (old `ladderView` `rideAction`).
- The festival's readout is mounted in the Location panel under the
  harbor's (old placement).

## Step 4 port W

- `noteTravelSkies(ctx, regionId)` and `TRAVEL_XP_PER_ARRIVAL` (1.5): an
  arrival by travel (`tickTravel`, after the Scouting XP) sends
  `skills/grant-xp` with the tag `weather`, keyed `skies:<region>`, the
  region of the spot's area (old `noteTravelSkies` of `weathersense.ts`).
  Here because the weather system imports this one. The caravan, the
  retreat and `world/place` arrive without travel and pay nothing, as in
  the old build.
- The weather system's Sky readout is mounted in the Location panel under
  the festival's (`weather/SkyPanel.svelte`).

## Step 4 port C6

- Content, appended from the old registry: region `malgeri_range` (Malgeri
  Range, mountains, sky table `malgeri`, an atlas pin), area
  `ascent_f17_area` (The Malgeri Crossing: `regionId` the Ascent,
  `skyRegionId` the Malgeri Range) and the 18 spots of floor 17, four maps
  in a line: the cave out of the festival (landing, hub cavern, the crack,
  the brood nest, central caves; roofed and dark), the eastern ascent (east
  mouth, roofed; eastern ascent, east peak), the ridge and the peak (east
  ridge, west ridge, west peak, roofed; Malgeri Peak) and the western descent
  (mountain base, roofed; mountain path, old path; Hamlet Square and Kystel's
  Anvil, roofed; the Hamlet Gates). 177 spots, 29 areas, 5 regions.
- The Malgeri Range holds no area: floor 17's area stands in the Ascent (the
  ladder and the map count it there) and reads the range's sky through
  `skyRegionId` (old decision, `docs/MALGERI.md` of the old repository).
- The six open hunt spots carry the sky lines: a slime per front and the
  three calm lines (`sky: ['calm']`, levels 46 to 48, four times the plain
  weight). Roofed spots carry none. The weather system's `registerSiteSky`
  answers them; no new code.
- The descent (Malgeri Peak to the Mountain Base) needs `boss:f17_peak`; the
  mirror back up carries no condition. No spot of the descent is a waypoint.
- Kystel's Anvil (`f17_hamlet_forge`): `benches: ['forging']` (the Anvil
  panel works here, `smithing`), eight recipes (`crafting`: the iron ingot
  and the seven leather and charm recipes this port adds), two jobs (the
  bellows pay 30 gold every 250 ticks) and a Strength drill; `heat` and
  `indoor` tags. Hamlet Square: the well (a haven), a guard job, a Charisma
  drill, the handmill.
- The map prints no terms for a road shut by a condition ("No known route.").
  The descent's latch is named in the spot and floor text. The old map
  printed the road's terms (`routeInfo.shut`); the UI step
  (`tests/wardLabels.test.ts` todo).
