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
  the benches, step 3), `caged` (the bestiary), `healBetweenBouts` and `dare`
  (the keeper of the Cages and the hold of play, step 3), `scene` and `map`
  (the UI step).
- Craft activities, bench runs, performances.
- `cardSpent` of the old activity drops: a card is not rolled while one is
  held; whether its recipe, word or technique is already known cannot be read
  until those systems exist.
- The approach of a road (`ApproachSpec`, `pendingApproach`): no road in
  scope has one. Step 4.
- The festival forfeit, the seam verb of floor 20.
- `noteTravelSkies` (Weathersense), bonus time.
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
- `the_cages` carries `caged`, `dare` and `healBetweenBouts`; nothing reads
  them here.
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

