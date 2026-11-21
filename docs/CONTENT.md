# Content

Step 4 of `docs/REBUILD.md`: bands 3 to 7 (floors 7 to 20), the festival,
weather and moons, the sea. This file is the port plan. No game code is
written by it.

Surveyed on old `main` (`D:\ksgproto28`) at `7c1267b`, 2026-11-20. New
repository at `fbf9360`. Line counts are `wc -l` of old files; ranges are
old line numbers.

## 1. Extent

The ladder of old `src/core/data/towers.data.ts` (496 lines) past floor 6:

| Band | Index | Floors | Old name | Clears to advance | Band rule |
|---|---|---|---|---|---|
| `ascent_upper` | 3 | 7 to 10 | The City | 4 | gate boon `city_key`; hub `castle_court`; `order: 'any'`; `levelSteps` [0, 2, 5, 9] |
| `ascent_harbor` | 4 | 11 to 14 | The Harbor | 4 | floor 11 is the stronghold on a first climb, the harbor after it |
| `ascent_festival` | 5 | 15, 16 | The Vermin Festival | 2 | landing on floor 15 starts an attempt |
| `ascent_aberrant` | 6 | 17 | The Malgeri Mountains | 1 | sky region `malgeri_range` |
| `ascent_desert` | 7 | 18 to 20 | The Desert | 3 | floor 20 has `seam: { verb: 'Sailing' }` |

| Floor | Name | Gate | Clear | Clear XP |
|---|---|---|---|---|
| 7 | The South Ward | (band) | `ward:f7:done` 1 | 500 |
| 8 | The West Ward | (band) | `fights:f8_lodge` 1 | 500 |
| 9 | The North Ward | (band) | `fights:f9_ossuary` 1 | 500 |
| 10 | The East Ward | (band) | `fights:f10_foundry` 1 | 500 |
| 11 | The Stronghold Road | | `sea:crates:won` 8 and `fights:f11_roadstead` 1 | 600 |
| 12 | The Crossings | | `sea:crates:won` 40 and `fights:f12_far_water` 1 | 650 |
| 13 | The Blockade | | `sea:crates:won` 160 and `fights:f13_blockade` 1 | 700 |
| 14 | The Final Mission | | `flag:sea:14:done` 1 (`SPINE_EXEMPT`) | 750 |
| 15 | The Dark Room | | `boss:f15_dark_room` 1 | 800 |
| 16 | The Royale | | `boss:f16_arena` 1 | 850 |
| 17 | The Malgeri Crossing | | `boss:f17_keeper` 1 | 900 |
| 18 | The Necropolis Road | | `boss:f18_forecourt` 1 | 950 |
| 19 | The Pyramid | `kills:tag:desert` 60 | `boss:f19_door` 1 | 1000 |
| 20 | The Delta Port | `kills:tag:desert` 150 | `fights:f20_roadstead` 1 | 1050 |

Nothing past floor 20 is on old `main`: no `ascent_f21`, no `f21_` spot.
`docs/FLOOR_IDEAS.md` sections 5 to 7 are ideas only.

Band 2 (floors 4 to 6) is ported (spine port 6): `dynamicLevel`
(`combat/spawn.ts:148`), and the ladder schema already carries `order`,
`hub`, `levelSteps`, `dynamicLevel`, `seam` and `levelRise`
(`ladder/index.ts:58-81`).

### 1.1 Content already in the new repository

Ported whole with their registries in step 2 and 3, with no reader past
floor 6 yet:

- Monsters: the 13 band 3 placeholders, the 17 siege and harbor
  placeholders, the 11 festival placeholders, the 16 `malgeri_*`, the 7
  desert placeholders (`monsters/content/monsters.json`).
- Items: the 8 `festival_*` items. Materials: the band 3 drops.
- The `city_key` boon (`prestige/content/prestige_boons.json:175`).
- Weather: fronts, calm, darkness, moonlight, sunlight, the Malgeri sky
  table and rules (data with no reader until floor 17). Clock: the three
  moons, phases, `moonlight`, `formatMoon`.
- Combat: `combat/start-staged` with `StagedMember { kit, hpShare, name,
  attrBias }`; monsters: `kitOf`. `stampOnClear` at `combat/engine.ts:955`.
- Ladder: `hubStatus`, `bandHubAt`, `bandLevelStep`, `bandDynamicLevel`,
  `band:pos:` keys; `ladder/floorRules.ts` (the forge does not call it).
- Kernel: `endRun()` from any handler or tick (decision 30), so an automatic
  prestige needs no kernel change.

### 1.2 Inventory by part

**Band 3, the City (floors 7 to 10).**

- Data: `locations.data.ts` (4,480) areas 86-94, spots 1940-2463 (17:
  `castle_court`, 6 on floor 7, 3 each on 8 to 10); `wards.data.ts` (24,
  `WARD_WINDOWS`: one window, `f7_demon`, 14,400 ticks at position 3).
- Systems: `wards.ts` (130: `tickWards` counts live ticks only,
  `registerWardListeners`), `wardValidation.ts` (125), parts of `ladder.ts`
  (238: `clearLapsed`, `floorsBelow` for `any`, `bandKnown`), `levels.ts`
  (279: `checkFloorClears` band line, `syncBandPositions`), `towers.ts`
  (389: hub stops in `rideStops`, `climbToHub`).
- Floor 7 has four forms by `band:pos:ascent_f7` (merchant road; stockade
  then watchtowers or chief's tent; burnt camp with the demon). Floors 8 to
  10 gate their keeper rows on `band:pos:*` (the young or final beast, the
  squire or the death knight, ore eater stages 1 to 4).
- No NPC, quest, shop or find on floors 7 to 10. The castle is a rest spot.
- Docs: `docs/plans/bands-2-3.md` (445), `FLOOR_IDEAS.md` (1,894) band 3
  rows.

**Floor 11, the stronghold, and the hold.**

- `prestige.data.ts` (223) 29-41: `STRONGHOLD_WAVE` 8, `STRONGHOLD_HELD`
  (`fights:f11_wall` 8), `STRONGHOLD_KEY` (`legacy:stronghold`).
  `prestige.ts` (278) 39-57 and 246-269: `strongholdHeld`, `autoPrestigeDue`
  (checked in `Game.tick`, `game.ts` 221-225), the `stronghold` legacy
  field.
- Spots 2462-2604 (`f11_road`, `f11_gatehouse`, `f11_yard`, `f11_wall`).
  The wall: raider and brute while `fights:f11_wall` is 6 or less, the
  captain at 7; gated on quest `f11_arm_the_wall` and `legacy:stronghold` 0.
- NPC `f11_steward`; quests `f11_shore_up_the_gate`, `f11_arm_the_wall`.
- `knockoutReturn.ts:62` `NEVER_TARGET_SPOTS = ['f11_wall']`.
- The hold: region `the_hold` (35), area `player_base_v1_area` (48), 25
  `base_*` spots (131-507): train, rest, farm, training dummies. Doors:
  `OFF_LADDER_DOORS` (`towers.data.ts:475`), gated on the key. The storage
  spots have no activity.
- Bonus time: `bonustime.ts` (64). The automatic prestige keeps the bank.

**The harbor and the sea (floors 11 to 14).**

- `sea.data.ts` (232): 4 sides (merchants convoy, pirates raid, privateers
  recover, navy escort), 9 convoy waters, `SEA` constants (convoy 3,600
  ticks, 4 legs of 300, 8 crates, `offlineShare` 4), the battery, `SEA_DEAL`.
- `sea.ts` (466): `seaClock`, `legRoll`, `resolveLeg`, `fireBattery`,
  `dealPrice`, `presentAt` (reads `isIdle`), `tickSea(state, bus, offline)`,
  `convoyView`. No own state: cargo in counters `sea:<spot>:*`.
  `seaValidation.ts` (90). `SeaPanel.svelte` (167).
- Spots 2605-3210: `f11_quay` (recipes: cannon, ball, charge), 4 berths,
  `f11_roadstead`; 8 on floor 12; 3 on 13 (the picket sets an approach); 9
  on 14 (four wings, a boss each, `once`).
- NPCs: `f11_factor`, `f11_bosun`, `f11_letter_agent`, `f11_lieutenant`,
  `f13_pilot` (shop `pilot_passage`), `f13_harbor_master` (shop
  `port_clearance`). Quests: 4 joins, 4 preparations. Materials 854-890:
  `ship_cannon`, `cannonball`, `powder_charge`, `pilot_passage`,
  `port_clearance`. Find `f12_port_purse`.
- The road approach (`ApproachSpec`, `pendingApproach`), left behind by
  world and combat: `tests/approach.test.ts` (230).
- Docs: `HARBOR.md` (97), `FLOOR_IDEAS.md` idea 3 (1104-1342), section 1.5
  (117-217), section 5.3 (1714-1846).

**The Vermin Festival (floors 15, 16).**

- `festival.data.ts` (368), `survivors.data.ts` (299).
- `festival.ts` (388: the door, the run clock that ticks in travel, staged
  fights, `fight:won` listener), `festivalRules.ts` (153: `festivalLocked`,
  `festivalHolds`, `prepShare`, `survivorLevel`), `festivalValidation.ts`
  (99), `stash.ts` (174: tokens, `festivalBonus`, `festivalTechniques`).
- Royale: `royale.ts` (255), `royaleField.ts` (733, a pure simulation),
  `royaleMap.ts` (810, seeded map generator), `royaleTerrain.ts` (86),
  `survivorGen.ts` (460).
- UI: `FestivalPanel.svelte` (197), `RoyaleField.svelte` (707),
  `royaleView.ts` (383), `StashPanel.svelte` (118).
- Hooks elsewhere: ladder verdicts (`ladder.ts` 123-129), knockout return
  (festival floors never a target, 118-211), title `first_through_the_door`.
- Spots 3211-3446 (7 on floor 15, `f16_arena`). No NPC, quest or shop.
- Docs: `FESTIVAL.md` (394), `SURVIVORS.md` (107).

**Floor 17, the Malgeri Crossing, and weather.**

- Region `malgeri_range` (40), area 109, 19 `f17_*` spots (3447-4000), 49
  encounter lines with `sky: [...]`, caves `indoor` and `dark`.
- Calm: `CALM_PERIOD_DAYS` 12, `CALM_HOURS` 8, `CALM_SEEN_KEY` (ported in
  weather). The calm flag lifts the `veil` of 3 monsters (a bestiary read)
  and the `lore` of NPC `f17_bren`; the offline summary has a first-calm line
  (`save/offline.ts` 112, 151).
- NPCs `f17_thora` (forge, Kystel's Anvil), `f17_bren`. No quest or shop.
- Weathersense: `weathersense.ts` (186). Chronosense: `chronosense.ts`
  (147). Sky lint: `skyValidation.ts` (93).
- Docs: `MALGERI.md` (352), `WEATHER.md` (711).

**The desert (floors 18 to 20).**

- Areas 115-117 (floor 18 tagged `heat`, 19 scene crypt). Spots 4008-4393:
  floor 18 well head, five obelisks (finds pay `flag:chart`), dune den,
  salt flat, tomb row, forecourt (`ph_sand_colossus` 41); floor 19 causeway
  to door, side tomb (heat resistance 10), six grave goods (each bumps
  `flag:tomb:taken`, requires `boss:f19_door` 0), the Weighing (`ph_sabaket`,
  `levelRise` on `flag:tomb:taken`, share 0.1, ceiling 45); floor 20 river
  road, quay (roadstead edge needs `flag:chart` 3), warehouses (job,
  flour), notice wall, roadstead (`ph_roadstead_crew` 45).
- NPC `f20_broker` (buys at the global price). No desert system file.
- Docs: `FLOOR_IDEAS.md` section 4 (1343-1572).

**Engine pieces earlier ports left out.**

| Piece | Old | Needed by | Old tests |
|---|---|---|---|
| Warden quests `faces_of_threshold`, `a_taste_of_everything` | `quests.data.ts` 19-65 | step 3 inheritance (SPINE 9.3); craft objective event, talk objective, divine favour on turn-in | `onboarding.test.ts` (178, 13), parts of `levels`, `save` |
| Bestiary | `bestiary.ts` (464), `bestiary.data.ts` (167) | Malgeri `veil`; harvest source `bestiary:entries` | `bestiary.test.ts` (253, 24) |
| Achievements | `achievements.ts` (70), `achievements.data.ts` (141) | harvest source (pays 0 now) | `hunters.test.ts` (103, 7) |
| Bonus time | `bonustime.ts` (64) | stronghold prestige keeps the bank; the hold of play | in `prestige`, `stronghold` |
| Shadow Clone | `clones.ts` (253) | Facet ability (tentative) | `shadowClone.test.ts` (155, 8) |
| Statue rules | `combat.ts` 1700-1870, 4145, 4841 | Facet Basilisk Hide | `basiliskHide.test.ts` (151, 6), `basiliskEvolve.test.ts` (232, 8) |
| Hold of play while an evolution waits | `Game.ts` 226-233, 271; `facet/host.ts:579` | Facet | `basiliskEvolve.test.ts` |
| Forge calls the floor rules | `floorRules.ts` (540, ported) | forge | `floorrules.test.ts` todos 427-429 |

`it.todo` tagged step 4 in the new tests (13): `exposure.test.ts` 534,
577, 1159, 1264, 1265; `knockoutReturn.test.ts` 570; `practice.test.ts`
71; `towers.test.ts` 103; `worldContent.test.ts` 376, 821, 825, 829.

## 2. Not ported

- Old `docs/LONGTERM.md` and `src/core/data/shelved/` (REBUILD section 4).
- Plans with no code on old `main`: `docs/plans/named-weather-events.md`
  (draft), the modifier-bucket and travel-multiplier half of
  `docs/plans/weather-as-mod-source.md` (the sky-rule statuses are built and
  ported). Items `HARBOR.md` section 5 lists as not built (named ships
  removing escorts, the ship scene).
- Branch-only content (not an ancestor of old `main`):

| Old branch | Commits not on main | What |
|---|---|---|
| `band2-floors` | 1 (2026-10-26) | floor 6 sabotages, hidden, each changing the warchief fight |
| `john-floor-20` | 1 (2026-11-15) | work-in-progress rewrite of `tests/john.ts` (888 added, 358 removed). Old `main`'s `john.ts` already climbs to 20 and is the reference |
| `claude/zen-heyrovsky-25af86` | 1 (2026-11-15) | collect objectives count graded materials |
| `sim/woods-edge-fresh` | 5 (2026-11-02) | balance simulation script only |
| `docs/mutagens-review`, `docs/runecarving-review` | 1, 6 | design reviews (already noted in SPINE 17, 19) |

Floor 17 is on old `main` (merge `a68a260`, branch `malgeri-floor`), and so
is open sky on floors 7 to 14 and 18 to 20 (merge `27c96e0`).

## 3. John past floor 6

### 3.1 The old driver

Old `tests/john.ts` (997 lines) on `main` climbs to floor 20 (`through:
20`). The game's rules make it three runs:

- Run 1: floors 0 to 6, the first prestige, buy `city_key`.
- Run 2: floors 1 to 6 again, the four wards (order `wards`, default 7, 8,
  9, 10), floor 11's stronghold: the steward's two repairs and the wave.
  Holding the wave is an automatic prestige.
- Run 3: floors 1 to 10 again, the harbor (side `side`, default
  merchants: the join quest and its crates), festival, floor 17, desert.

Segments after run 1: `reclimb2`, `floor7` to `floor10`, `siege`,
`reclimb3`, `floor11` to `floor20`. Budget 80 hours past floor 6. Each floor
past 6 has a cap (`floorCap`, default 240 minutes); a floor open at the cap
is a wall, and John takes a debug skip that writes the floor's gate and
clear counters and pays no clear XP. Option `calmAtMalgeri` jumps the clock
to the next calm on floor 17. Old `tests/john.test.ts` (190) has one smoke
case for 20: every segment closes, every stuck floor is a wall, floor 20 is
played in run 3.

Past floor 6 the old John takes quests on floor 11 only (the steward's
repairs, the side's join quest), smelts iron ingots at The Forges in
Threshold for `f11_arm_the_wall` (`john.ts` 826-838), goes to floor 13's
blockade through the picket, not the pilot's channel, and never opens the
bestiary or shops. The Forges' `craft_iron_ingot` is an activity the
ported `crafting` system makes per listed recipe (`crafting/README.md`).

### 3.2 Extending the new John

Each port adds its segments to `tests/john.ts` and `scripts/pacing.ts`,
with the old names, the old options (`wards`, `side`, `calmAtMalgeri`,
`floorCap`) and the old order of moves. `through` grows with each port:
port C1 takes it to 10, C2 to the siege, C3 to 14, C5 to 16, C6 to 17,
C7 to 20. A port lands with `npm run pacing -- --through <its floor>`
printing every segment for seeds 42, 7 and 1234 and with the old smoke case
of `tests/john.test.ts` ported at its floor.

The debug skip writes counters. Here it is a command (question Q5); John
otherwise sends player commands only.

### 3.3 Target: the old build's times

Old: `npm run pacing -- --through 20 --seeds 42,7,1234 --weapons skip` in
`D:\ksgproto28` at `7c1267b`, nothing edited, run 2026-11-20. No wall on any
seed. The full output is in the session notes folder as
`step4-plan-old-john-pacing-20.txt`. Time on each segment (h:mm:ss) and
knockouts:

| Segment | Run | Old 42 | Old 7 | Old 1234 | Old mean | KO 42/7/1234 |
|---|---|---|---|---|---|---|
| f1-6 again | 2 | 0:23:16 | 0:25:29 | 0:24:04 | 0:24:16 | 21/20/22 |
| f7 | 2 | 0:03:02 | 0:02:58 | 0:03:05 | 0:03:02 | 3/3/3 |
| f8 | 2 | 0:06:33 | 0:00:15 | 0:00:13 | 0:02:20 | 9/0/0 |
| f9 | 2 | 0:12:44 | 0:12:51 | 0:19:13 | 0:14:56 | 11/15/20 |
| f10 | 2 | 0:00:11 | 0:12:42 | 0:00:15 | 0:04:23 | 0/2/0 |
| f11 siege | 2 | 0:07:29 | 0:06:54 | 0:07:03 | 0:07:09 | 3/2/2 |
| f1-10 again | 3 | 0:46:42 | 0:39:36 | 0:46:00 | 0:44:06 | 47/36/35 |
| f11 | 3 | 0:12:18 | 0:07:24 | 0:07:00 | 0:08:54 | 6/4/3 |
| f12 | 3 | 0:30:00 | 0:36:00 | 0:30:00 | 0:32:00 | 8/10/7 |
| f13 | 3 | 1:30:00 | 1:42:00 | 1:30:00 | 1:34:00 | 6/9/12 |
| f14 | 3 | 0:00:13 | 0:00:14 | 0:00:12 | 0:00:13 | 0/0/0 |
| f15 | 3 | 0:00:21 | 0:00:25 | 0:00:23 | 0:00:23 | 0/0/0 |
| f16 | 3 | 0:03:45 | 0:03:05 | 0:04:25 | 0:03:45 | 0/0/0 |
| f17 | 3 | 0:14:13 | 0:14:19 | 0:14:17 | 0:14:16 | 14/14/10 |
| f18 | 3 | 0:00:16 | 0:00:17 | 0:00:16 | 0:00:16 | 0/0/0 |
| f19 | 3 | 0:02:00 | 0:02:13 | 0:01:54 | 0:02:02 | 0/0/0 |
| f20 | 3 | 0:03:06 | 0:03:17 | 0:03:06 | 0:03:10 | 0/0/0 |
| Whole climb | | 4:42:50 | 4:52:51 | 4:35:37 | 4:43:46 | |

Run 1 of this run equals the old table of SPINE 9.1 (the tutor's lessons
on). Bosses: f8 `ph_rogue_beast_young` L16; f9 `death_knight` L18 (2 to 3
lost per seed); f10 `ph_ore_eater_4` L23; siege captain, brute, raider L27;
f14 port warden and four pirate captains L33; f15 `ph_room_last` L35; f16
`ph_survivor_champion` L40; f17 `malgeri_slime_king` L45 with two
legionaries (2 lost per seed); f18 `ph_sand_colossus` L41; f19 `ph_sabaket`
L33; f20 three `ph_roadstead_crew` L45. Level at the floor 20 clear: 46 on
each seed. Fights: 2,940, 3,187, 2,913.

`docs/COMPLETABILITY.md` (819) section 8 has the same measurement for seeds
42 and 7 before and after open sky (4:42:50 and 4:53:06 after; seed 7 is
4:52:51 at `7c1267b`). Its reading: floors 12 and 13 are set by the convoy
schedule (8 crates per 6 minutes), floor 9 is the one hard floor, floors 14
to 20 are trivial for John, and the re-climbs hold half of all lost fights.

Runs 2 and 3 start from a prestige, so a run 1 difference reaches them only
through the legacy (harvest points; John buys only `city_key`, cost 3) and
the run counters the legacy keeps.

### 3.4 Tolerance

Decided (Q1, 2026-11-20): the SPINE 9.1 rule per run. Each run's total within 15% of
the old mean over the three seeds; each segment of more than two minutes
of old mean within 35%; floors 12 and 13 within one convoy (6 minutes) of
the old time per seed, since they are schedule-bound; boss segments and
segments under two minutes reported, not held.

## 4. Kernel requests

- **K1. A tick knows it is catch-up.** Old `tickWards(state, catchingUp)`
  counts only live ticks for the ward window; old `tickSea(state, bus,
  offline)` pays offline convoys by `offlineShare`; old festival clock reads
  the same flag. The kernel runs catch-up through the same core and
  `tests/runner.test.ts` asserts catch-up equals running in place. Request:
  a read-only `ctx.catchingUp` (or the runner's mode on the tick context),
  set by `catchUp` and false in `runHeadless`. The runner equality test then
  holds for content without a live-only clock and is stated per system for
  the rest. Lands in port C1. Recorded in `docs/KERNEL.md`.
- **K2. A hold of play** (only with port F): old `Game.ts` stops the clock
  and banks bonus time while a Facet evolution waits. A kernel or clock
  hold that the tick reads.
- None else. The automatic prestige uses `endRun()` (decision 30) from the
  prestige tick; staged fights, fight-won and kill events, quest accept
  stamps, `shop:buys:` counters, `once`, `fightLimit`, `statMax`, `levelRise`
  and `seam` exist.

## 5. Port order

One session per port, one at a time, each on its own branch, each landing
with `npm run verify` green, John extended to its floors, the offline
budgets measured against `main`, and its panels checked at desktop and phone
width. Each port follows section 5 of `docs/REBUILD.md`. Floors are ported
in ladder order because John climbs them in order; L and W touch no floor
and can run beside another port (W touches only `weather` and `clock`).

| Port | Scope | Size (old lines) |
|---|---|---|
| L | Threshold leftovers: Warden quests, bestiary, achievements, harvest sources | about 1,000 |
| C1 | Band 3: castle hub, city key gate, any order, level steps, ward windows, floors 7 to 10 | about 1,300 |
| C2 | Floor 11 stronghold, automatic prestige, the hold, bonus time bank | about 900 |
| C3 | The harbor and the sea, floors 11 to 14, the road approach | about 2,200 |
| C4 | Festival run, floor 15, festival tokens and legacy | about 1,600 |
| C5 | Royale: survivor generator, field, map, floor 16 | about 3,700 |
| W | Weathersense, Chronosense, sky lint | about 430 |
| C6 | Floor 17, the Malgeri Crossing | about 700 |
| C7 | The desert, floors 18 to 20, the seam; full-climb parity | about 500 |
| F | Facet leftovers: Shadow Clone, statue rules, hold of play (Q2) | about 600 |

### 5.1 Port L: Threshold leftovers

- Scope: `quests.data.ts` 19-65 (the two Warden quests, giver
  `warden_of_the_foot`); `bestiary.ts` (464), `bestiary.data.ts` (167);
  `achievements.ts` (70), `achievements.data.ts` (141); the harvest sources
  of `prestige.ts` from line 79 and `prestige.data.ts` 52-54.
- Systems: new `bestiary`, new `achievements`; `quests` (craft and talk
  objectives, divine favour on turn-in), `prestige` (harvest readers),
  `combat`, `monsters`, `weather` (bestiary readers).
- Kernel: none. Cross-system: a craft event from each bench system to
  `quests`; `quests` requests `divine` favour.
- Spec: `onboarding.test.ts` (178, 13), `bestiary.test.ts` (253, 24),
  `hunters.test.ts` (103, 7), the quest cases of `levels.test.ts` and
  `save.test.ts`, the harvest cases of `prestige.test.ts` (416, 27).
- Parity: John unchanged through 6 except the harvest; record the harvest
  points against the old run 1 (old John never opens the bestiary).

### 5.2 Port C1: band 3, the City

- Scope: `towers.data.ts` 81-96, 249-305; `locations.data.ts` 86-94,
  1940-2463 (17 spots); `wards.data.ts` (24); `wards.ts` (130);
  `wardValidation.ts` (125); `ladder.ts` `clearLapsed`, `floorsBelow`,
  `bandKnown`; `levels.ts` `checkFloorClears` band line,
  `syncBandPositions`; `towers.ts` hub stops, `climbToHub`; text
  `locations.text.ts` 228-249.
- Systems: new `wards` (the window owner); `ladder` (band 3, `clearLapsed`
  in the clear and in the harvest floor, the boon gate read through
  `counters`), `world` (`climbToHub`, hub ride stops, `castle_court` as a
  haven for `knockout`), `levels` (`floor_lapsed` text), `prestige` (the
  city key's boon fact), `combat` (the window reads the live fight and the
  last hit through an event), forge validator (ward lint).
- Kernel: K1.
- Spec: `band3.test.ts` (256, 19), `band3-ward7.test.ts` (257, 15),
  `band3-wards-8-10.test.ts` (236, 11), `band3-wards-live.test.ts` (130,
  5), `wards.test.ts` (592, 32), `wardLabels.test.ts` (44, 3), the band 3
  cases of `ladderEnd.test.ts` (214, 14), `towers.test.ts` (129, 7),
  `rideEdges.test.ts` (270, 14), `content.test.ts`; the todo
  `worldContent.test.ts:825`; floors 7 to 10 of `exposure.test.ts:534`
  (open sky).
- Parity: John run 1, the prestige with `city_key`, run 2 to floor 10:
  segments `reclimb2`, `floor7` to `floor10`, against section 3.3. Option
  `wards` ported; also run `--wards 10,9,8,7` on both builds.

### 5.3 Port C2: the stronghold and the hold

- Scope: `prestige.data.ts` 29-41; `prestige.ts` 39-57, 246-269;
  `game.ts` 220-225; `locations.data.ts` 35, 48, 131-507 (the hold),
  2462-2604; `npcs.data.ts` 249-262 (steward); `quests.data.ts` 80-110;
  `knockoutReturn.ts:62`; `towers.data.ts` 466-483 (`OFF_LADDER_DOORS`);
  `bonustime.ts` (64).
- Systems: `prestige` (`strongholdHeld`, automatic prestige by `endRun()`
  from its tick, `stronghold` in the legacy, `legacy:stronghold` at run
  start), `ladder` (band 4 floor 11, off-ladder doors), `world` (the hold
  region, the wall's gates), `knockout` (never the wall), `npcs`,
  `quests`, `clock` or a new `bonus` folder (the bank; the double speed
  control is the UI step).
- Kernel: none (`endRun()`).
- Spec: `stronghold.test.ts` (163, 15), the stronghold cases of
  `prestige.test.ts` and `stations.test.ts` (668, 38), the wall cases of
  `knockoutReturn.test.ts` (2,046, 101), the todos `towers.test.ts:103`
  and `practice.test.ts:71` (the hold).
- Parity: segment `siege` against section 3.3; the run 2 total.

### 5.4 Port C3: the harbor and the sea

- Scope: `sea.data.ts` (232), `sea.ts` (466), `seaValidation.ts` (90),
  `sea.text.ts` (12), `SeaPanel.svelte` (167); `locations.data.ts`
  2605-3210; `npcs.data.ts` 263-318; `quests.data.ts` 111-198;
  `materials.data.ts` 854-890; recipes from `recipes.data.ts` 175; the
  approach (`ApproachSpec`, `pendingApproach` in old `combat.ts`);
  `SPINE_EXEMPT` (`towers.data.ts` 485-496).
- Systems: new `sea` (no slice of its own: counters `sea:<spot>:*`, as in
  the old build; or a slice, Q6); `world` (harbor spots, the approach after
  `combat/fight-started`), `combat` (approach statuses), `npcs`, `quests`
  (the join quests' exclusion), `shops` (pilot, harbor master), `crafting`
  (harbor recipes), `items` (the battery), `ladder` (floors 12 to 14,
  `SPINE_EXEMPT`), forge validator (sea lint). `presentAt` reads idleness
  from `world` and `combat`, not from a bank.
- Kernel: K1 (`offlineShare`).
- Spec: `harbor.test.ts` (662, 32), `approach.test.ts` (230), the sea
  cases of `content.test.ts` (`seaContentIssues`, 2398), `mapplan.test.ts`,
  `openSky.test.ts`, `towers.test.ts`, `ladderView.test.ts`; the todo
  `worldContent.test.ts:829`; floors 11 to 14 of `exposure.test.ts:534`.
- Parity: `reclimb3`, `floor11` to `floor14`. Option `side` ported; also
  run `--side navy` on both builds. Offline budget: a new world run of 8
  hours at a convoy water.

### 5.5 Port C4: the festival run and floor 15

- Scope: `festival.data.ts` (368, the run part), `festival.ts` (388),
  `festivalRules.ts` (153), `festivalValidation.ts` (99), `stash.ts` (174,
  tokens and legacy), `FestivalPanel.svelte` (197), `StashPanel.svelte`
  (118); `locations.data.ts` 3211-3423; `ladder.ts` 123-129;
  `knockoutReturn.ts` 118-211; title `first_through_the_door`.
- Systems: new `festival` (door, run clock that ticks in travel, staged
  rooms, hub); `ladder` (verdicts `shut`, `closed`, `forfeit`, `royale`,
  `festivalLocked`), `world` (the forfeit), `knockout` (never a festival
  floor), `items` (tokens, the festival hold on flasks, meals and runes),
  `prestige` (festival legacy: `festivalBonus`, `festivalTechniques` as a
  modifier source), `titles`, `combat` (fight-won read).
- Kernel: K1 if the run clock skips catch-up (to check in `festival.ts`).
- Spec: `festival.test.ts` (1,273, 71), `festivalHub.test.ts` (355, 19),
  `monsterKit.test.ts` (305, 19) where not covered by step 2; the todos
  `worldContent.test.ts:821`, `knockoutReturn.test.ts:570`.
- Parity: `floor15`. John cannot pass floor 16 until C5; `through: 15`.

### 5.6 Port C5: the royale and floor 16

- Scope: `survivors.data.ts` (299), `festival.data.ts` (the royale part),
  `survivorGen.ts` (460), `royaleMap.ts` (810), `royaleTerrain.ts` (86),
  `royaleField.ts` (733), `royale.ts` (255), `royaleView.ts` (383),
  `RoyaleField.svelte` (707); `locations.data.ts` 3424-3446.
- Systems: `festival` (the field slice, engagements into
  `combat/start-staged`), `monsters` (`kitOf` for generated members).
- Kernel: none. The field is a pure simulation on the kernel generator.
- Spec: `survivorGen.test.ts` (600, 36), `royaleMap.test.ts` (516, 24),
  `royaleField.test.ts` (805, 47), `royaleView.test.ts` (461, 37).
- Parity: `floor16`. The largest port of step 4; it may split in two
  (generator, map and field first with John unchanged; wiring and panel
  second). Decided by the session that takes it.

### 5.7 Port W: Weathersense, Chronosense, sky lint

- Scope: `weathersense.ts` (186), `chronosense.ts` (147),
  `skyValidation.ts` (93); `noteTravelSkies` in old travel.
- Systems: `weather` (Weathersense, the forecast), `clock`
  (Chronosense), `skills`, `world` (`noteTravelSkies`), forge validator.
- Kernel: none.
- Spec: `weathersense.test.ts` (127, 9), `chronosense.test.ts` (159, 15),
  the lint cases of `sky.test.ts` (949, 75) not ported in spine port 6; the
  todos `exposure.test.ts` 1264, 1265.
- Parity: John unchanged (he trains neither skill by choice; check the
  passive XP does not move a segment).

### 5.8 Port C6: the Malgeri Crossing

- Scope: `locations.data.ts` 40, 109, 3447-4000; `npcs.data.ts` 322-341;
  the calm offline line (`save/offline.ts` 112, 151); Kystel's Anvil
  (`f17_hamlet_forge`, left behind by smithing).
- Systems: `world` (region, area, spots, sky lines), `weather` (the
  Malgeri table gets its reader), `npcs` (lore gated on the calm flag),
  `bestiary` (`veil` lifted by the calm, needs port L), `smithing` (the
  anvil), `ladder` (band 6).
- Kernel: none.
- Spec: `malgeri.test.ts` (516, 37), `malgeriCatchup.test.ts` (56, 1),
  `malgeriSave.test.ts` (98, 6), `fixtures/malgeri.ts` (56); the todos
  `exposure.test.ts` 577, 1159.
- Parity: `floor17`, with and without `--malgeri-calm` on both builds.

### 5.9 Port C7: the desert

- Scope: `towers.data.ts` 418-463; `locations.data.ts` 115-117,
  4008-4393; `npcs.data.ts` 343-356 (the broker); text
  `locations.text.ts` 333-371.
- Systems: `world` (spots, finds, the seam verb in the ride), `ladder`
  (band 7), `npcs`, `shops` (the broker at the global price), `combat`
  (`levelRise` is ported).
- Kernel: none.
- Spec: `desert.test.ts` (473, 28), the desert cases of `ladderEnd.test.ts`,
  `finds.test.ts` (215, 14), `openSky.test.ts`, `knockoutReturn.test.ts`.
- Parity: `floor18` to `floor20`, then the whole climb against section 3.3
  with the tolerance of section 3.4; the old smoke case of
  `tests/john.test.ts` at 20. The step 4 status is written here as SPINE
  section 9.3 was.

### 5.10 Port F: Facet leftovers (conditional)

- Scope: `clones.ts` (253); `combat.ts` 1700-1870, 4145, 4841 (statues
  crumble, break, throw rocks, pay Stone Chunks); `Game.ts` 226-233, 271
  and `facet/host.ts:579` (hold of play); `EvolveModal.svelte` (70).
- Systems: `facet` only where possible; `combat` (statue rules behind the
  Facet switch), `benches`, `smithing`, `crafting` (clones at benches),
  `loot` (Chunks).
- Kernel: K2.
- Spec: `shadowClone.test.ts` (155, 8), `basiliskHide.test.ts` (151, 6),
  `basiliskEvolve.test.ts` (232, 8); the todos of `facetAbilities.test.ts`
  546, 590, 613.
- Parity: John with Facet off unchanged.

## 6. Decided questions

Each had a default; the plan above assumes the default. Decided by the
user on 2026-11-20: all ten defaults accepted as written below.

1. **Q1. Tolerance past floor 6.** Default: section 3.4 (per-run total
   within 15%, long segments within 35%, floors 12 and 13 within one convoy
   per seed), reported, not enforced by a test.
2. **Q2. Facet leftovers.** Shadow Clone, statue rules and the hold of play
   belong to a tentative system. Default: port F last, after C7, and only
   if Facet abilities are still kept then.
3. **Q3. Port L first.** The Warden quests were a step 3 inheritance and
   are not ported; the bestiary and achievements pay 0 to the harvest now.
   Default: port L before C1, so run 2 starts from the old harvest.
4. **Q4. Bonus time.** Not ported. The stronghold prestige keeps the bank
   and the Facet hold banks into it. Default: port the bank (64 lines) in
   C2; the double speed control waits for the UI step.
5. **Q5. John's debug skip.** It writes counters, which a test may not do
   here. Default: a dev command (`ladder/debug-skip-wall`), refused in a
   production build, used only by John. The old run hit no wall, so it is a
   safety net.
6. **Q6. Sea state.** The old sea keeps cargo in counters (`sea:<spot>:*`).
   Default: keep it in counters, as the old build did; no `sea` slice.
7. **Q7. Chronosense.** Not named in REBUILD step 4. Default: port it in W
   with Weathersense.
8. **Q8. K1, the catch-up flag.** Default: add `ctx.catchingUp` in C1 and
   state in `tests/runner.test.ts` which systems differ between catch-up
   and running in place (wards, sea), as the old build did.
9. **Q9. Branch-only content** (section 2). Default: not ported.
10. **Q10. The royale split.** Default: one port C5; the session may split
    it in two if it cannot land green in one.

## 7. Port L: Threshold leftovers (done)

Done 2026-11-20 on branch `step4-L`, from `main` at `e7bb9a7`. Not merged,
not pushed. The full account: `src/systems/bestiary/README.md`,
`src/systems/achievements/README.md`, and the "Step 4 port L" sections of
the `quests`, `npcs` and `prestige` READMEs.

What was ported:

- `quests`: `faces_of_threshold` and `a_taste_of_everything` (old
  `quests.data.ts` 19-65). The Warden lists all three quests. The quest
  machinery (talk, stat and craft objectives, `benches/crafted`, favour on
  turn-in) was already here; this port adds the records. `npcs`: the shaper
  Ilex (`psionic_shaper`, Censer Walk), the eighth talk objective.
- `bestiary` (new system): old `systems/bestiary.ts` (the slice half, the
  profile, search, shelves), `BESTIARY_FACTS`, `BESTIARY_TUNING`, the three
  log lines, the panel. Hears `combat/fight-started` (sightings),
  `combat/kill` and `counters/changed` (the veil). Bumps `bestiary:entries`.
- `achievements` (new system): the ten records, tiers claimed on
  `counters/changed`, the modifier source `achievements/held`, the panel.
  `titles` checks on `achievements/claimed`.
- `prestige`: the `achievements` harvest source reads the tiers;
  `bestiary` pays through `bestiary:entries`. Both paid 0 before.
- `monsters`: `MonsterDef.veil` typed. `world`: the `caged` help text.
- Spec ported: the bestiary cases (`tests/bestiary.test.ts`, 24 old cases
  and 2 new), the eight onboarding todos, the hunter case and the hunter
  bonuses of `hunters.test.ts` on the achievements slice, the craft
  objective and questmaster cases of `quests.test.ts`, the harvest case of
  `prestige.test.ts` (16 points, the old number). New:
  `tests/achievements.test.ts` (9).

Old bugs and rules kept:

- The book's level range adds `levelRise` and dynamic levels, not the
  band's level step: from band 3 on it shows levels below what spawns.
- An entry opened at tick 0 keeps `firstKill` 0, the mark of a veiled entry
  not yet opened (the old `totalTicks` had the same edge).
- The averaged profile uses the tier's mid multiplier, no modifier tier or
  rarity; Defences reads declared resistances only.
- A counter set lower keeps its claimed tiers. Goal text uses the old
  `fmt` ("Defeat 1.00K monsters").
- `faces_of_threshold` says "the eight trades"; the old comment says nine.

Changed while porting (no rule): sightings come from every fight start
(the old event came from spot encounters only; no staged fight exists
before step 4 content); entries a veil releases open on the counter's
`counters/changed` delivery, after the first-calm line, not before it;
panels without portraits, tag rules on click, "Label: fact" text.

Left out: nothing of the scope. The calm offline line and the Malgeri
NPC lore wait for C6, as planned.

### 7.1 John

`npm run pacing` (seeds 42, 7, 1234, through floor 6), floor 6 clear:

| Seed | Old `7c1267b` | `main` `e7bb9a7` | `step4-L` |
|---|---|---|---|
| 42 | 0:26:41 | 0:26:46 | 0:26:14 |
| 7 | 0:22:52 | 0:22:37 | 0:26:26 |
| 1234 | 0:24:13 | 0:25:04 | 0:25:51 |
| Mean | 0:24:35 | 0:24:49 | 0:26:10 |

Run 1 mean is 6.5% over the old mean (tolerance 15%, section 3.4). Every
segment moved: each kill now rolls the bestiary's open facts on the
generator, and the achievement bonuses apply. At floor 6 every seed holds
Eternal Student 2, Wanderer 2, Fortune Seeker 3, Honed Body 2 and Breaker
1, the tiers of the old seed 42 run (old 7 and 1234: one tier less on
Honed Body or Fortune Seeker). Seed 7 lost 14 fights on floor 4 against 7 on `main`.

Harvest at the first prestige (points; old read with the old `harvest`
on the old John's state, nothing edited):

| Seed | Old | `main` | `step4-L` | `step4-L` by source |
|---|---|---|---|---|
| 42 | 17 | 11 | 17 | floors 6, bestiary 3 (16 entries), skills 4, achievements 3 (10 tiers), gold 1 |
| 7 | 18 | 11 | 16 | floors 6, bestiary 2 (14), skills 4, achievements 3 (10), gold 1 |
| 1234 | 17 | 11 | 17 | floors 6, bestiary 3 (16), skills 4, achievements 3 (10), gold 1 |

The old build: bestiary 2, 3, 3 (14, 15, 15 entries), achievements 3, 3, 3
(10, 9, 9 tiers), skills 5, 5, 5. The skills gap (4 against 5) is older
than this port. Run 2 times: the new John has no run 2 segment yet (C1
adds it). The old John buys `city_key` (3 points) and nothing else, so the
6 more points do not reach run 2 for John.

Rack climbs, `tests/john.test.ts` "the toll collector is a fight": first
attempts lost, seeds 42 and 7 (10 climbs): old 1, `main` 5, `step4-L` 0;
seeds 1 to 6 and 8 to 21 (100 climbs): old 20, `main` 15, `step4-L` 16.
The rate is unchanged; the 0 of 10 failed the lower bound of the test
(at least 1).

User decision (2026-11-20): widen the sample. The loss count of that case
now runs over seeds 1 to 8, every rack weapon (40 climbs of band 1); the
10 climbs of seeds 42 and 7 keep the other checks (fight length, attempts).
Measured on the 40: old 13, `main` 9, `step4-L` 9. Over seeds 1 to 40 (200
climbs): old 34, `main` 41, `step4-L` 31. Bounds from the old rate of
about 20% (8 of 40): at least 2, at most 16. Chance of a sample under 2 at
a 20% rate about 0.2%, at 15% about 1%. `tests/john.test.ts` takes 12.1 s
on an idle machine, against 3.7 s on `main`.

### 7.2 Offline budgets

Measured 2026-11-20 while another program held the processor at about 90%:
every budget run took about twice its limit on `main` and on this branch.
`scripts/budget-runs.ts`, alternating, same hour, ms:

| Run of 8 hours | `main` | `step4-L` |
|---|---|---|
| No fight, no condition | 3,146 to 3,166 | 3,106 to 3,257 |
| Floor 1 table | 15,335 to 15,580 | 15,663 to 16,286 |
| Floor 6 Tunnels | 28,029 to 28,603 | 28,386 to 28,602 |
| World: hunt, floor 6 Tunnels | 27,466 to 29,158 | 28,225 to 28,940 |

Within the spread of `main`.

Rerun later the same day with the other program closed (CPU 32% at the
start), `npm run verify` on this branch (at `124a19b`) and then on `main`
(`e7bb9a7`), each green. Budget cases, ms, branch against `main`: idle
1,571 / 1,565 (limit 2,200); poison 4,731 / 4,861 (8,250); floor 1 4,912
/ 4,885 (7,700); floor 6 8,756 / 8,714 (14,850); world 4 8,576 / 8,702
(14,300); world 6 8,659 / 8,685 (14,300). Branch: unit 2,919 passed, 4
skipped, 149 todo; budget 4; budget-world 2; john 13; build. The port adds no tick
hook; it adds a `combat/kill` and a `counters/changed` handler and one
modifier source (touched on a claim only).

Outcome digests recorded again in their own commit (`a3eb6e9`): every
state hash; generator, kills and gold of the four fight runs; defeats and
level of world 4; every John segment and harvest.

### 7.3 Browser check

Desktop (1009 px) and 375 px, dev server 5600, the dev save (backup at
`ksgb:development:save.before-step4L-check`). Its 8 hours of offline
catch-up hunted forest rats: Bestiary 1 of 128, the rat with 8 of 8
facts, its haunt confirmed. Tag filter (Beast), tag rule on click, every
fact block filled. Achievements: Slayer 2/3, Honed Body 2/3, Fortune
Seeker 3/3, Eternal Student 1/3. Found and fixed: a haunt line at a spot
with no name overflowed the row; the Honed Body counter showed a raw
float. No horizontal overflow at 375 px after the fix; no console errors.
Not checked in a browser: the Warden's two quests in the Quests panel
(tested headless), a veil lifting (tested headless).

## 8. Port C1: band 3, the City (done)

Done 2026-11-20 on branch `step4-C1`, from `main` at `5b61195`. Not merged,
not pushed. The full account: `src/systems/wards/README.md` and the "Step 4
port C1" sections of the `ladder`, `world` and `prestige` READMEs;
docs/KERNEL.md decision 34.

What was ported:

- Kernel K1: `ctx.catchingUp`, read-only on every handler context. `catchUp`
  creates its kernel with the option `catchingUp: true`; every other kernel
  has it false. `tests/runner.test.ts` keeps the equality of catch-up and
  running in place and names `wards` as the system that differs (`sea` and
  the festival clock to come), with a case: a ward window's clock stands
  still for 500 ticks of `catchUp` and moves 500 under `runHeadless`.
- Content: band `ascent_upper`, floors 7 to 10, the castle area and the four
  ward areas, 16 spots (the castle court and 15 ward spots; section 1.2
  says 17), their text. Appended from the old registry by a one-off script.
- `wards` (new system): old `wards.ts`, `wards.data.ts` (`f7_demon`) and
  `wardValidation.ts` (`wardContentIssues`, `wardStatKeys`). No slice of its
  own: every key is a run counter, as in the old build. Tick order 16,
  after combat. Hears `combat/fight-closed` and `combat/kill`.
- `combat`: `combat/fight-closed` carries `hurt` on each standing enemy (the
  old `lastHit` stamp).
- `ladder`: `clearLapsed` (registered by `wards`), the lapse line and no
  clear XP for a lapsed clear, `ladder/debug-skip-wall` (Q5), the hub on the
  view, ward term words (old `stampTerm`, `otherFloorsOf`).
- `world`: `world/climb-hub` (old `climbToHub`); the hub row on the ladder
  card of the location panel. The castle court is a haven by the existing
  rest rule; band hubs were already ride and router stops.
- `prestige`: the `floors` harvest source skips a lapsed floor. The city
  key's gate needed nothing new (boon fact `boon:city_key`).
- Spec ported: `band3.test.ts` (19 old cases and the band hub case of
  `rideEdges.test.ts`), `band3-ward7.test.ts`, `band3-wards-8-10.test.ts`,
  `band3-wards-live.test.ts`, `wards.test.ts`, `wardLabels.test.ts` (2 and
  1 todo for C6), the ward case of `worldContent.test.ts` (the todo at 825),
  floors 7 to 10 and the castle of `exposure.test.ts` (from the old
  `openSky.test.ts`), the old John smoke case at floor 10.

Old bugs and rules kept:

- A ward window whose clock is full waits out a live fight with its threat;
  a kill then sets no flag.
- The stamp clear of floor 7 reads "Win The Merchant Road, The Chief's Tent
  or The Burnt Camp" once the floor is cleared: no spot is live, so every
  spot is named (old `stampTerm`).
- Every rung of band 3 repeats the band's gate, as the old terms did.

Changed while porting (no rule): the debug skip is a command refused in a
production build, not a write into the state; the term words come from the
ladder view, so a fight count reads "4 wins at <spot>" where the old text
said "win 4 fights at <spot>".

Left out:

- The forge validator calls no content lint here (as for the floor rules
  and smithing); `wardContentIssues` runs in `tests/worldContent.test.ts`.
- `ladderEnd.test.ts` has no band 3 case (all need floor 20, C7);
  `towers.test.ts` has none. The old `ladderView.test.ts` band 3 cases test
  the old UI card builder (folding, foreknown cards, `hubTerms`), which has
  no counterpart here: UI step.

### 8.1 John

`tests/john.ts` gains run 2 (section 3.1): the first prestige buys
`city_key`, `reclimb2` climbs floors 1 to 6 again, then `floor7` to
`floor10` in the order of the option `wards`, each with a cap (`floorCap`,
240 minutes), the stuck record and the debug skip. `npm run pacing --
--through 10 [--wards 10,9,8,7] [--cap N]`. No wall on any seed. The
prestige takes no seed here (the old one reseeded the generator), so run 2
starts from a different stream.

Default order (7, 8, 9, 10), segment time and knockouts, seeds 42/7/1234:

| Segment | Old | New | Old mean | New mean | Change | KO old | KO new |
|---|---|---|---|---|---|---|---|
| f1-6 again | 0:23:16 / 0:25:29 / 0:24:04 | 0:22:45 / 0:23:08 / 0:24:06 | 0:24:16 | 0:23:20 | -3.9% | 21/20/22 | 20/21/20 |
| f7 | 0:03:02 / 0:02:58 / 0:03:05 | 0:02:45 / 0:02:25 / 0:02:41 | 0:03:02 | 0:02:37 | -13.6% | 3/3/3 | 2/2/2 |
| f8 (keeper) | 0:06:33 / 0:00:15 / 0:00:13 | 0:12:42 / 0:00:15 / 0:06:26 | 0:02:20 | 0:06:28 | +176% | 9/0/0 | 15/0/8 |
| f9 (keeper) | 0:12:44 / 0:12:51 / 0:19:13 | 0:00:12 / 0:12:48 / 0:06:29 | 0:14:56 | 0:06:30 | -56.5% | 11/15/20 | 0/16/9 |
| f10 (keeper) | 0:00:11 / 0:12:42 / 0:00:15 | 0:06:30 / 0:00:14 / 0:12:42 | 0:04:23 | 0:06:29 | +48.0% | 0/2/0 | 3/0/5 |
| Run 2 to f10 | 0:45:46 / 0:54:16 / 0:46:48 | 0:44:55 / 0:38:52 / 0:52:25 | 0:48:57 | 0:45:24 | -7.2% | | |

`--wards 10,9,8,7`, old run on `D:\ksgproto28` at `7c1267b`, nothing
edited, the same day:

| Segment | Old | New | Old mean | New mean | Change | KO old | KO new |
|---|---|---|---|---|---|---|---|
| f1-6 again | 0:23:16 / 0:25:29 / 0:24:04 | 0:22:45 / 0:23:08 / 0:24:06 | 0:24:16 | 0:23:20 | -3.9% | 21/20/22 | 20/21/20 |
| f10 (keeper) | 0:06:31 / 0:00:29 / 0:06:32 | 0:06:34 / 0:00:27 / 0:00:26 | 0:04:31 | 0:02:29 | -45.0% | 4/1/4 | 7/1/1 |
| f9 (keeper) | 0:00:14 / 0:06:28 / 0:06:28 | 0:00:14 / 0:12:51 / 0:00:17 | 0:04:23 | 0:04:27 | +1.5% | 0/7/6 | 0/10/0 |
| f8 (keeper) | 0:06:30 / 0:12:53 / 0:00:17 | 0:06:34 / 0:00:13 / 0:25:11 | 0:06:33 | 0:10:39 | +62.5% | 9/18/0 | 10/0/34 |
| f7 (the demon) | 0:12:43 / 0:06:26 / 0:06:25 | 0:12:48 / 0:06:26 / 0:12:39 | 0:08:31 | 0:10:38 | +24.7% | 2/1/1 | 2/1/2 |
| Run 2 to f10 | 0:49:13 / 0:51:45 / 0:43:45 | 0:48:55 / 0:43:05 / 1:02:40 | 0:48:14 | 0:51:33 | +6.9% | | |

Against section 3.4: run 2 to floor 10 is within 15% of the old mean in
both orders (the run 2 total with the siege waits for C2). The held
segments (over two minutes, not a keeper) are within 35%: f1-6 again
-3.9%, f7 -13.6%. Floors 8 to 10, and floor 7 when it is the demon, are
keeper segments and are reported: each is one to five tries at a keeper,
with a 6 minute grind (`GRIND`) between tries, so a seed's time is a
multiple of about 6:30 and moves with one fight won or lost. The keepers
and levels match the old ones (f8 young beast L16 or the final form L23;
f9 death knight L18 at position 2; f10 ore eater stage 4 L23). Seed 42 won
the death knight at level 14 at the first try; old seeds lost 2 to 3.

Harvest at the first prestige: 17 / 16 / 17, unchanged from port L.
Floors 0 to 6 of run 1: unchanged from port L (0:26:14 / 0:26:26 /
0:25:51).

### 8.2 Offline budgets

The first build of the port cost about 13% on the idle run (+200 ms) and
9% on the floor 1 run (+450 ms): the `wards` tick, a few calls and three
counter lookups on every tick. The tick now reads the counter table once
and its keys are built once (no rule change, the same state hashes); the
ladder's clear check reads `floorCleared` once per floor and call and
keeps the floors of each band in a table. `scripts/budget-runs.ts`,
alternating `main` (`5b61195`) and this branch, the same hour, ms:

| Run of 8 hours | `main` | `step4-C1` |
|---|---|---|
| No fight, no condition | 1,589 / 1,581 | 1,616 / 1,612 |
| Poison held | 5,352 / 5,242 | 5,303 / 5,393 |
| Floor 1 table | 5,305 / 5,179 | 5,386 / 5,604 |
| Floor 6 Tunnels | 9,543 / 9,463 | 9,371 / 9,690 |
| World: hunt, floor 4 | 9,540 / 9,459 | 9,560 / 9,959 |
| World: hunt, floor 6 | 9,366 / 9,388 | 9,533 / 9,484 |

`npm run verify` on this branch (CPU 25% at the start): unit 3,021
passed, 4 skipped, 153 todo; budget 4 (idle 1,697 ms of 2,200, poison
5,391 of 8,250, floor 1 5,430 of 7,700, floor 6 9,300 of 14,850);
budget-world 2 (9,460 and 9,428 of 14,300); john 14; build.

Outcome digests recorded again in their own commit: every state hash (the
new slice `wards`, empty), nothing else. No run reaches band 3, and the
John digest now keeps run 1's segments only (it stops at the first
prestige, as before).

### 8.3 Browser check

Dev server 5600, desktop and 375 px. A save made by the John driver
(seed 7, run 2, standing at the lodge of floor 8, floor 7 cleared) loaded
into the dev slot; the dev save was put back after (backup
`ksgb:development:save.before-step4C1-check`, the band 3 save kept as
`ksgb:development:save.step4C1-band3`). Location panel, ladder card: the
hub row before floor 7 (The Castle Court, open, the key's gate met), the
ward rungs with their gate and clear words. "Ride to the hub of The City"
rode to the castle court; the button is disabled there. No horizontal
overflow at 375 px other than the panel tab strip, which scrolls; no
console errors. `wards` has no panel. Not checked in a browser: a ward
window opening or lapsing, the demon fight (tested headless).
