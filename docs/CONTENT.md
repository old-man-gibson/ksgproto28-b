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
- **K2. A hold of play**: old `Game.ts` stops the clock and banks bonus
  time while the keeper's dare or a Facet evolution waits. Lands in
  step3-gaps for the keeper's dare; port F reuses it for the Facet
  evolution (kernel decision 36, `playHold`).
- **K3. A catch-up hold** (added during port C4, kernel decision 35): the
  old festival clock does not read the flag K1 names; the old catch-up loop
  stops while the festival holds the player and banks the rest. A system
  may declare `catchUpHold`; `catchUp` asks it before each tick. Section
  11.4.
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
- Before it: the step 3 gap ports `superattrs` (docs/SPINE.md section 21)
  and `step3-gaps` (the keeper's dare and its hold of play, K2; practice
  shaping; wuxin; section 22), so C5's John table starts from the old
  rules. John's runs 1 to 3 through floor 15 are unchanged by the second.
- Done: section 12, split in two commits (part 1 the pure modules with
  John unchanged; part 2 the wiring and the panels). No kernel change.

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
- Done: section 13. No kernel change. Chronosense's trainer runs in
  `weather` (`clock` imports no system). The passive XP does move John
  from run 2 on: both senses count in `skill:levels` and the harvest (an
  old rule). Run totals stay within 15% of the old means (13.1).

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
- Done: section 14. No kernel change. The plan's count of 19 spots is 18
  (the old test's list). The old people card's rotating dialogue line was
  not in the rebuild's Quests panel; it came with this port, so the lore
  line can be seen.

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
- Done: section 15. No kernel change and no code change in any system:
  the desert is content on rules ported before. The full climb's run totals
  hold the tolerance; the segments outside it are the seven of `main`,
  each chance met a few times per seed (15.1). Step 4 status: 15.5.

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

## 9. Port C2: the stronghold and the hold (done)

Done 2026-11-20 on branch `step4-C2`, from `main` at `edbe69b`. Not merged,
not pushed. The full account: `src/systems/bonus/README.md` and the "Step 4
port C2" sections of the `prestige`, `ladder`, `world`, `quests` and `npcs`
READMEs.

What was ported:

- Content, appended from the old registry: region `the_hold`, areas
  `player_base_v1_area` and `ascent_f11_area`, the 25 spots of the hold and
  the 4 stronghold spots of floor 11 (road, gatehouse, yard, wall), band 4
  `ascent_harbor` and floor 11; the steward `f11_steward` and his two
  repair quests. 125 spots, 23 areas, 4 regions, 4 bands, 12 floors.
- `prestige` (slice version 2, field `stronghold`): `STRONGHOLD_WAVE`,
  `STRONGHOLD_HELD`, `STRONGHOLD_KEY`, `strongholdHeld`, `autoPrestigeDue`,
  `canPrestige` by the warchief or the stronghold. The automatic prestige
  is a tick at order -200, before every other system, through
  `ctx.endRun()` (decision 30, no kernel change). `legacy:stronghold` is
  set at the start of every later run. Dev command
  `prestige/debug-hold-wall` (Q5) for John.
- `bonus` (new system, decision Q4): the bank. One tick banked per idle
  tick, capped at 8 hours; the automatic prestige keeps the bank (event
  `bonus/bank` from `prestige`'s `newRun`), a prestige by choice does not.
- `ladder`: `OFF_LADDER_DOORS`, `offLadderDoor`.
- `knockout`: no change; `NEVER_TARGET_SPOTS` already named `f11_wall`.
- Spec ported: `stronghold.test.ts` (15 old cases; the road's edge on to
  the quay is a todo for C3); the stronghold line of the `prestige:count`
  case of `prestige.test.ts`; the hold cases of `towers.test.ts` (the todo
  at 103, and the two door cases back on the hold from the floor 1 doors
  they stood on); the Training Area case of `practice.test.ts` (the todo
  at 71); the wall cases of `knockoutReturn.test.ts` on the real spot;
  three of the five bonus time cases of `navigation.test.ts`; the door
  exemption and the quest condition check of `worldContent.test.ts`; the
  John smoke case at the siege.

Old bugs and rules kept:

- Floor 11's clear is the harbor's (8 crates won and a fight won on the
  roadstead). A first climb never clears floor 11: it ends there by the
  automatic prestige.
- The kill objective of `f11_arm_the_wall` counts raiders killed anywhere
  (the `at` of an objective is a link, as in the old build).
- The hold's spots keep their old names ("Player Base Entrance") and their
  `benches` lists, so the hold's tables work (the Arcane Library is a third
  Spellcrafting Table).
- The bank fills while catching up, as the old offline run did.

Changed while porting (no rule): the old automatic prestige took the whole
tick; here the systems after `prestige` in the same kernel tick run in the
new run, so the new run starts one tick earlier. `strongholdHeld` reads the
run's `legacy:stronghold` counter, which is set from the legacy flag at
every run start (the old read the flag). The skip reason of `prestige/now`
names both openings.

Left out:

- Port C3: the road's edge on to `f11_quay`; floor 11's clear spot and the
  label of `sea:crates:won`, so the floor 11 rung of the ladder card shows
  the raw keys ("8 sea:crates:won", "1 wins at f11_roadstead");
  `tests/worldContent.test.ts` skips floor 11 and band 4 in the clear,
  spine and band size lints (`HARBOR_PENDING`).
- The UI step: spending the bank as double speed (the second advance) and
  its control; the two `navigation.test.ts` cases and the ward case of
  `wards.test.ts` about it stay `it.todo`. `bonus` has no panel.
- `stations.test.ts`: the old list of worked spots is not ported, so its
  wall case has nowhere to run.
- Not of this scope, noticed: the old `Game.prestige` wrote the log line
  "Prestige {count}: {points} points harvested."; the new prestige writes
  none (since spine port 7).

### 9.1 John

`tests/john.ts` gains segment `siege` (`through` 11): after the four wards,
John takes Shore Up the Gate, salvages 20 hardwood in the yard and hunts
the road for 15 iron scrap, turns it in, takes Arm the Wall, hunts the road
for 10 raiders and the scrap for four ingots, goes down to the Forges,
smelts four iron ingots, climbs back, turns it in, and hunts the wall until
the stronghold ends the run. The old order of moves. The segment records
the level and gold the run ended with. `npm run pacing -- --through 11`, no
wall on any seed:

| Segment | Old 42 / 7 / 1234 | New 42 / 7 / 1234 | Old mean | New mean | Change | KO old | KO new |
|---|---|---|---|---|---|---|---|
| f11 siege | 0:07:29 / 0:06:54 / 0:07:03 | 0:08:23 / 0:08:11 / 0:07:30 | 0:07:09 | 0:08:01 | +12.1% | 3/2/2 | 5/4/4 |
| Run 2 total | 0:53:15 / 1:01:10 / 0:53:51 | 0:53:18 / 0:47:03 / 0:59:55 | 0:56:05 | 0:53:25 | -4.8% | | |

Against section 3.4: the run 2 total is within 15% of the old mean; the
siege (over two minutes, not a keeper alone) is within 35%. Captain tries
and losses, old 2/1, 2/1, 1/0, new 3/2, 2/1, 3/2. Level at the stronghold,
old 21 / 24 / 23, new 20 / 21 / 23. Run 1 and the segments of run 2 before
the siege are those of section 8.1 (the siege adds no move before it).

### 9.2 Offline budgets

The port adds two tick hooks: `prestige` (two counter lookups a tick) and
`bonus` (`isIdle`: three slice reads a tick). `scripts/budget-runs.ts`,
alternating `main` (`edbe69b`) and this branch, the same hour, ms:

| Run of 8 hours | `main` | `step4-C2` |
|---|---|---|
| No fight, no condition | 1,598 / 1,572 | 1,755 / 1,751 |
| Poison held | 5,309 / 5,356 | 5,467 / 5,605 |
| Floor 1 table | 5,217 / 5,310 | 5,544 / 5,674 |

About 160 ms on the idle run (+10%), 0.55 microseconds a tick. Measured
apart: an empty `bonus` hook costs nothing measurable; the three reads of
`isIdle` about 100 ms; the `prestige` hook 25 to 50 ms. A read is the
kernel's `ctx.read`; no cheaper read exists without a kernel change. Kept.

`npm run verify` on this branch (CPU 14% at the start): unit 3,053 passed,
4 skipped, 149 todo; budget 4 (idle 1,809 ms of 2,200, poison 5,586 of
8,250, floor 1 5,663 of 7,700, floor 6 9,736 of 14,850); budget-world 2
(9,624 and 9,735 of 14,300); john 14; build.

Outcome digests recorded again in their own commit (`d433996`): every
state hash, nothing else (the new slice `bonus`, `prestige` version 2). No
run reaches floor 11.

### 9.3 Browser check

Dev server 5600, desktop (800 px pane) and 375 px. Two saves made by the
John driver (seed 7) loaded into the dev slot through the forge page (the
game page saves on `pagehide`); the dev save was put back after (backup
`ksgb:development:save.before-step4C2-check`, the floor 11 save kept as
`ksgb:development:save.step4C2-siege`).

- Run 3, after the stronghold, standing at the hold's entrance: the map
  "Your Hold" with exits to The Ascent and Threshold; walked to the Main
  Hall; took the exit to The Ascent, which walked through the door to the
  Gatehouse of floor 11, whose map lists the exit to Your Hold. The steward
  offers nothing.
- Run 2, in the yard of floor 11 with Shore Up the Gate active: the quest
  in the Quests panel (20 hardwood 0/20, 15 scrap 15/15), Salvage Timber,
  the wall stair a shut unknown place, the floor 11 rung (see Left out).

No horizontal overflow at 375 px on Location and Quests; no console errors.
Not checked in a browser: the wave on the wall and the automatic prestige
(tested headless, and by John on three seeds).

## 10. Port C3: the harbor and the sea (done)

Done 2026-11-21 on branch `step4-C3`, from `main` at `a72b168`. Not merged,
not pushed. The full account: `src/systems/sea/README.md` and the "Step 4
port C3" sections of the `world`, `combat`, `ladder`, `quests`, `npcs`,
`counters` and `crafting` READMEs.

What was ported:

- Content, appended from the old registry: areas `ascent_f12_area`,
  `ascent_f13_area` and `ascent_f14_area` (open sky); the six harbor spots
  of floor 11 (the quay, four berths, the roadstead), 8 spots on floor 12,
  3 on floor 13, 9 on floor 14; the road from `f11_road` to the quay
  (shown and open with `legacy:stronghold`); floors 12 to 14; the six
  people (four recruiters, the pilot, the harbor master, with the shops
  Passage and Papers); the eight quests (four joins, four preparations); the
  battery's three recipes at the quay. 151 spots, 26 areas, 15 floors. The
  materials, monsters and cargo were here already.
- `sea` (new system): old `sea.ts`, `sea.data.ts`, `seaValidation.ts`,
  `sea.text.ts`, `SeaPanel.svelte`. Registries `sea_sides` (4) and `convoys`
  (9 waters); `rules.ts` holds the schedule, the leg roll, the four
  formulas, the battery and the port price; `validation.ts` holds
  `seaContentIssues`. No slice of its own (decision Q6): the side is the
  join quest's accept stamp, the running cargo is in run counters
  `sea:<water>:*`. Tick order 17, after combat: the clock is read on the
  kernel tick where the next leg can end (a cache of that tick), the leg's
  work on the four ticks an hour that end a leg. Hears `combat/kill` (the leg's kills; the mission boss stamps
  `flag:sea:14:done`) and `combat/fight-won` (`fights:<water>`).
- Kernel K1: the sea reads `ctx.catchingUp`. A leg resolved while catching
  up fires the battery with no kills and pays one cargo per 4 crates to
  `sea:crates:offline`, never to `sea:crates:won`. `tests/runner.test.ts`
  names `sea` beside `wards`, with a case.
- The road approach (old `ApproachSpec`, `pendingApproach`): roads carry
  `approach`; the world stamps it on arrival with the request
  `combat/approach` (or clears it); the combat slice (version 3, migration
  step 2, fixture `v3.json`) holds it; the first fight at its spot spends it
  before the tempo check. Floor 13's picket road leaves the player
  Flat-Footed, the pilot's channel leaves the blockaders Surprised, and each
  floor 14 wing lays its condition once the side's preparation is turned in.
- `ladder`: floors 12 to 14, `SPINE_EXEMPT` (floor 14), and
  `registerTermText`: floor 11's rung reads "8 crates won" and "1 wins at
  The Roadstead" (C2 left the raw keys), floors 12 and 13 the same with 40
  and 160 crates, floor 14 "Your side's mission boss slain". `HARBOR_PENDING` is gone from `tests/worldContent.test.ts`: the
  clear, spine and band size lints run on floors 11 to 14.
- `counters`: the request `counters/set-now`, so two kills of one tick
  both count against the leg (the kernel delivers both `combat/kill` events
  before either handler's writes).
- Panel: `sea/SeaReadout.svelte` (props only) and `sea/SeaPanel.svelte`,
  mounted in the Location panel under the activities, the old placement.
  Two controls the old readout did not have, each sending an existing
  command: the water's hunt when not sailing (shown, disabled, while
  sailing) and "Sign with <side>" at a berth before a side is picked
  (`quests/accept`). `tests/harbor.test.ts` renders the readout on the
  server (`svelte/server`), checks each control is drawn, and dispatches
  the command it carries.
- Spec ported: `harbor.test.ts` (31 of the 32 old cases; the 32nd, "catch-up
  marks its ticks as offline", is the kernel's case in `runner.test.ts`
  with the new sea case there; 6 new: two kills in one drain, the floor 12
  map's two world rules from the old `mapplan.test.ts`, the readout and its
  controls), `approach.test.ts` (the 9 old cases and one new: an arrival
  with no approach wipes the stamp),
  the sea cases of `content.test.ts` (`seaContentIssues`, the water's fight
  count, accept stamps and `shop:buys:<npc>` as counters, `SPINE_EXEMPT`),
  the todo at `worldContent.test.ts` (the sea lint), the stronghold todo
  (the road on to the quay), floors 11 to 14 of `exposure.test.ts` (open
  sky, from `openSky.test.ts`), the old John smoke case at floor 14.

Old bugs and rules kept:

- A night away pays crates as cargo at 1 in 4 and never moves a clear:
  floors 11 to 13 need play at the water.
- Merchants are paid gold only in play; caught up, their crates pay cargo
  like every other side's (old `credit`).
- Legs sailed while the player was away are folded in with battery 0 and
  no kills, so arriving mid-convoy loses crates to the legs missed.
- The battery's three items are worth no more than their inputs at any
  counter (the no-arbitrage case passes at Charisma 1, 30 and 60).
- The privateers pay no fifth; named ships do not remove floor 14's
  escorts (old `HARBOR.md` section 5, not built there).

Changed while porting (no rule):

- The kill handler reads the fight's site from `combat/kill`, where the old
  listener read `state.spot`; a kill happens at the site the player stands
  on.
- The approach's feed lines are sent after the fight's transcript opens,
  so they are in it.
- Two panel controls (above). The readout lines are "Label: fact" lines at
  fixed heights.

Noticed, older than this port (not changed):

- The old advance ticked no fight on a tick of travel; here combat ticks
  after the world in the same kernel tick, so a forced fight's first
  combat tick is the arrival tick, one tick earlier than in the old build.
  The old approach case "before anyone swings" reads the opening from the
  fight's transcript instead.
- `conditionReader` holds the counters slice it was made on; a new run
  replaces the slices. John held one reader from run 2 into run 3 and saw
  run 2's ward clears; John now makes it per read. No system keeps a reader
  across a handler.

Left out:

- The forge validator calls no sea lint (as for the ward and floor lints);
  `seaContentIssues` runs in `tests/worldContent.test.ts`.
- The surveyed map plan of `mapplan.test.ts` (roads drawn, rings, route
  summaries) is the UI step; its two world rules are ported.
- `ladderView.test.ts` has no harbor case.

### 10.1 John

`tests/john.ts` gains run 3 (section 3.1): the siege's prestige starts it;
`reclimb3` climbs floors 1 to 6 again and replays the wards (old `replay`:
no record, a wall of run 2 skipped); then `floor11` to `floor14` in the
old order of moves: sign with the side at its berth by way of the quay and
work the roadstead; the far water by the strait and the isle; the blockade
by the picket line; the side's wing, the approach water as the den and the
mission boss as the keeper. John buys and crafts nothing, so he fires the
ship's battery of 1. Option `side` (default merchants); `through` 11 to 14
plays run 3 to that floor, as the old `through` did. `npm run pacing --
--through 14 [--side navy]`. No wall on any seed or side. The John smoke
case of `tests/john.test.ts` runs at 14.

Merchants (the default), seeds 42 / 7 / 1234, old at `7c1267b` (section
3.3):

| Segment | Old | New | Old mean | New mean | Change | KO old | KO new |
|---|---|---|---|---|---|---|---|
| f1-10 again | 0:46:42 / 0:39:36 / 0:46:00 | 0:52:33 / 0:47:13 / 0:49:22 | 0:44:06 | 0:49:43 | +12.7% | 47/36/35 | 42/46/48 |
| f11 | 0:12:18 / 0:07:24 / 0:07:00 | 0:06:27 / 0:05:47 / 0:03:38 | 0:08:54 | 0:05:17 | -40.6% | 6/4/3 | 1/2/3 |
| f12 | 0:30:00 / 0:36:00 / 0:30:00 | 0:30:00 / 0:30:00 / 0:24:00 | 0:32:00 | 0:28:00 | -12.5% | 8/10/7 | 8/5/12 |
| f13 | 1:30:00 / 1:42:00 / 1:30:00 | 1:42:00 / 1:54:00 / 1:42:00 | 1:34:00 | 1:46:00 | +12.8% | 6/9/12 | 10/14/14 |
| f14 (keeper) | 0:00:13 / 0:00:14 / 0:00:12 | 0:00:13 / 0:00:12 / 0:00:17 | 0:00:13 | 0:00:14 | | 0/0/0 | 0/0/0 |
| Run 3 to f14 | 2:59:13 / 3:05:14 / 2:53:12 | 3:11:13 / 3:17:12 / 2:59:17 | 2:59:13 | 3:09:14 | +5.6% | | |
| Floor 0 to f14 | 4:19:09 / 4:29:15 / 4:11:16 | 4:30:45 / 4:30:41 / 4:25:02 | 4:19:53 | 4:28:49 | +3.4% | | |

`--side navy`, old run on `D:\ksgproto28` at `7c1267b`, nothing edited,
the same day (runs 1 and 2 and `f1-10 again` are the merchants' rows):

| Segment | Old | New | Old mean | New mean | Change | KO old | KO new |
|---|---|---|---|---|---|---|---|
| f11 | 0:06:18 / 0:07:24 / 0:07:00 | 0:06:27 / 0:05:47 / 0:03:38 | 0:06:54 | 0:05:17 | -23.4% | 3/6/6 | 4/4/3 |
| f12 | 0:30:00 / 0:30:00 / 0:30:00 | 0:36:00 / 0:24:00 / 0:36:00 | 0:30:00 | 0:32:00 | +6.7% | 13/16/12 | 11/9/19 |
| f13 | 1:36:00 / 1:30:00 / 1:36:00 | 1:42:00 / 1:36:00 / 1:30:00 | 1:34:00 | 1:36:00 | +2.1% | 14/15/11 | 16/20/15 |
| f14 (keeper) | 0:00:15 / 0:00:13 / 0:00:13 | 0:00:14 / 0:00:13 / 0:00:13 | 0:00:14 | 0:00:13 | | 0/0/0 | 0/0/0 |
| Run 3 to f14 | 2:59:15 / 2:47:13 / 2:59:13 | 3:17:14 / 2:53:13 / 2:59:13 | 2:55:14 | 3:03:13 | +4.6% | | |

Against section 3.4:

- Run 3 is within 15% of the old mean on both sides (+5.6%, +4.6%).
  `f1-10 again` (+12.7%) is within 35%.
- Floor 12 is within one convoy of the old time on every seed and side
  (0, -6, -6 minutes; navy +6, -6, +6).
- Floor 13: the navy is within one convoy on every seed (+6, +6, -6
  minutes). The merchants are two convoys over on every seed (+12, +12,
  +12 minutes): outside the tolerance. Measured per leg at the blockade
  (scratch scripts, the old build's modules imported read-only): old kills
  per leg 13.4 to 13.8, every payment 8 crates, 15 payments of 120 crates;
  new 12.1 to 12.6 kills per leg, 15 to 17 payments of 120 to 123 crates,
  and more knockouts (10/14/14 against 6/9/12). The crates a convoy loses
  are lost on the legs John misses while knocked out or walking back. The
  sea's rules give the same leg for the same kills (`tests/harbor.test.ts`);
  the gap is the fight against the blockade's pirates at levels 32 to 40, a
  combat parity question older than this port. Reported, not tuned.
- Floor 11 is schedule-bound too (8 crates is one convoy): its mean is
  41% under the old one (35% held), each seed within one convoy of the old
  (-5:51, -1:37, -3:22). The old seed 42 lost crates on its first convoy
  and needed two.
- Floor 14 is a keeper segment, reported: one try, won, on every seed and
  side, at level 40 against the port warden (L33) or the sea beast.

Run 1 and run 2 are unchanged from section 9.1 (the same segment times and
knockouts on every seed). Gold earned on the merchants' floor 13 is of the
old order (1.70 million against 1.97 million on seed 42).

### 10.2 Offline budgets

The port adds one tick hook, `sea`, one `combat/kill` and one
`combat/fight-won` handler (a table lookup off the harbor), and on arrival
the request `combat/approach` only when a road has an approach or one is
stamped. The sea's tick reads the clock only on the kernel tick where the
next leg can end (every 300 ticks): it keeps that tick for the sea's slice
object, a cache never saved, read again after a load or a new run (both
replace the slice object). The clock's tick is the only writer of the clock
and adds 1 per kernel tick, so the outcome is that of reading the clock on
every tick: every outcome digest and both John tables (merchants and navy,
three seeds) came out identical with and without the cache.

The idle run of 8 hours in one process, 15 alternating rounds, ms (minimum
/ median):

| Variant | Minimum | Median |
|---|---|---|
| Sea tick reading the clock every tick | 1,714 | - |
| Sea tick with the cache (kept) | 1,674 | 1,785 |
| An empty sea tick | 1,658 | 1,723 |
| No sea tick | 1,654 | 1,735 |
| No sea system | 1,647 | 1,731 |

(the first row from an earlier session of the same A/B, against 1,659 with
no tick in that session, whose medians are not comparable: the machine ran
the same run at either about 1,700 or about 2,200 ms then). The read every
tick cost about 55 ms per 8 hours (3%); with the cache the tick costs about
20 ms (1%) over no tick, the price of a hook that looks at its own slice.

Against `main` in one process (both builds' modules imported, alternating,
15 rounds, ms, minimum / median): before the cache `main` 1,668 / 1,688,
branch 1,697 / 1,724 (+36 ms median, +2.1%); with the cache, two sessions:
`main` 1,621 / 1,643 against 1,655 / 1,690, and `main` 1,670 / 1,698
against 1,717 / 1,735, with the branch less the sea system at 1,677 /
1,710. The gap to `main` moves by about 15 ms between sessions, more than
the cache saves, so this A/B does not resolve the cache's gain; the
in-process rows above do.

`scripts/budget-runs.ts`, alternating `main` (`a72b168`, the worktree
`D:\ksgproto28-b-main`) and this branch before the cache, the same hour,
CPU 4% at the start, ms:

| Run of 8 hours | `main` | `step4-C3` |
|---|---|---|
| No fight, no condition | 1,939 / 1,982 | 1,823 / 1,806 |
| Poison held | 5,358 / 6,721 | 5,229 / 5,634 |
| Floor 1 table | 5,224 / 5,275 | 5,974 / 5,380 |
| Floor 6 Tunnels | 11,379 / 9,174 | 10,707 / 9,511 |
| World: hunt, floor 4 | 10,144 / 10,925 | 9,077 / 11,220 |
| World: hunt, floor 6 | 9,602 / 11,507 | 11,143 / 10,109 |

Within the spread of `main` in both directions. The new run, 8 hours of
the hunt at floor 11's roadstead through `catchUp` (`worldSea`, the
probe's harbor character, a merchant with four cannons, 400 shot and 400
powder): 8,285 ms alone, 10,970 kills, no defeat, all 320 legs resolved on
the offline path (640 crates to `sea:crates:offline`, none won). Budget
14,300 ms, as the other world runs.

The idle budget, raised to 2,420 ms (user decision, 2026-11-21; docs/KERNEL.md
section 8). Before the cache, `npm run verify` failed it three times
(2,336, 2,347 and 2,275 ms of 2,200): run right after the unit project,
every budget case took about 30% longer than alone on this machine that
day, and `main` in the same sequence took 2,175 ms (99% of the limit;
poison 7,522, floor 1 7,145, floor 6 11,347). The budget project alone on
this branch: idle 1,791, poison 5,290, floor 1 5,393, floor 6 9,236.

`npm run verify` on this branch with the cache and the raised budget:
svelte-check 0 errors; unit 3,114 passed, 4 skipped, 147 todo; budget 4
(idle 1,874 ms of 2,420, poison 5,837 of 8,250, floor 1 5,508 of 7,700,
floor 6 9,761 of 14,850); budget-world 3 (floor 4 10,246, floor 6 10,047,
the roadstead 10,690, each of 14,300); john 14; build.

Outcome digests recorded again in their own commit: every state hash (the
new slice `sea`, empty; `combat` version 3 with its field `approach`),
nothing else; the digest of the new run `worldSea` recorded for the first
time. No other run reaches the harbor, and the John digest stops at the
first prestige.

### 10.3 Browser check

Dev server 5600, desktop (1009 px) and 375 px. Two saves made by the John
driver (seed 7, run 3) loaded into the dev slot through the forge page; the
dev save was put back after (backup
`ksgb:development:save.before-step4C3-check`, the roadstead save kept as
`ksgb:development:save.step4C3-roadstead`).

- At the navy berth with no side picked: the harbor readout under the
  activities ("Side: none.", crates, battery, hold) and the control "Sign
  with The Navy"; pressed, the side is The Navy and the control is gone.
  The ladder card's floor 11 rung reads "Clear: 8 crates won" and "Clear: 1
  wins at The Roadstead".
- On the roadstead with the merchants, hunting: the convoy block (convoy,
  leg, threat, kills, cargo, "Sailing: yes."), the sail control shown and
  disabled, the battery (volleys 3 x hit 2 = 6) and the port price. Leg 3
  and the fourth leg resolved in play: a cannonball spent, 8 crates sold,
  the block's height unchanged (every line 24 px). The hunt stopped from
  the Activities card: "Sailing: no.", the control enabled; pressed, the
  hunt runs again.

No horizontal overflow at 375 px (the hold's notes take their own line);
no console errors. Not checked in a browser: floors 12 to 14, the
approach's feed lines and a floor 14 boss (tested headless, and by John on
three seeds and two sides).

## 11. Port C4: the festival run and floor 15 (done)

Done 2026-11-22 on branch `step4-C4`, from `main` at `d75aaee`. Not merged,
not pushed. The full account: `src/systems/festival/README.md` and the "Step
4 port C4" sections of the `world`, `ladder`, `items`, `martial`,
`alchemy`, `materials`, `knockout`, `prestige` and `titles` READMEs.

What was ported:

- Content, appended from the old registry: band 5 (`ascent_festival`, two
  clears to advance), floor 15 (`ascent_f15`, clear `boss:f15_dark_room`),
  area `ascent_f15_area` (roofed) and its seven spots: the dark room, the
  hall and the five hub spots (stores, survey, herb yard, workshop,
  gallery). 158 spots, 27 areas, 16 floors. The monsters and the
  `festival_*` items were here already.
- `festival` (new system): the run part of old `festival.data.ts`, old
  `festival.ts`, `festivalRules.ts`, the dark room's part of
  `festivalValidation.ts`, the token half of `stash.ts`. Registries
  `dark_room_waves` (four waves) and `issued_weapons` (eight families);
  `rules.ts` holds the dials and the pure reads. Slice version 1: the
  attempt (`run`), the lockout's end tick, and the legacy (tokens, bonus
  stacks, techniques bought), which its own `newRun` carries. Tick order
  18, after the sea. The door holds the gear through one request per owner
  (`items/hold` and `items/return`, `martial/hold-sheathed` and
  `martial/return-sheathed`, `alchemy/hold` and `alchemy/return`,
  `materials/hold` and `materials/return`). The modifier source
  `festival/player` states `festivalHolds` (the stash's take-out is shut),
  `festivalLent:<uid>` (the issued weapon is not sold) and the permanent
  bonus. Hears `combat/kill` (the kill by weapon family, on every kill),
  `combat/fight-won` (the dark room's next wave) and `world/arrived` (the
  door; the loss).
- `world`: a `FloorRule` the festival registers at module load: the
  ejection to the tower's hub on a festival floor (`retreatSpot`, and no
  festival spot is a haven), no routing to a festival floor and none
  inside an attempt, and the ladder's verdicts on a climb (`shut`,
  `closed`, `forfeit`, `royale`), which `climbTo` and `climbToHub` act on.
- `ladder`: `registerFloorShut`. The lockout is the counter
  `festival:shut`: the ladder reads counters, the old one read the end
  tick against the world clock. The festival sets it at the loss and
  clears it on the tick the clock reaches the end; the tick reads the
  clock only on that kernel tick (a cache per slice object, as the sea's).
- Kernel K3, decision 35 (approved during the port): a system may declare
  `catchUpHold: { holds, held }`; `catchUp` asks `holds` before each tick,
  stops on the first true and runs `held` with the ticks left. The festival
  declares it (11.4).
- `knockout`: a festival floor is never a target (why `festival`).
- The ladder card (the Location panel), as the old `ladderView` marked it: a
  floor the lockout shuts reads "Shut" with no ride; inside an attempt
  every ride out reads "Forfeit: ride to ..." (the ladder view's `shut`, the
  world view's `rideVerdicts`). Found in the browser check: before it, the
  card offered a ride to the shut floor that the ladder refused.
- `items`: `items/grant` takes `plain` (the issued weapon: slots rolled and
  dropped) and `stash` (the regalia minted into the stash); `items/sell`
  refuses a lent item, with the old log line.
- Panels: `festival/FestivalReadout.svelte` (props only) and
  `FestivalPanel.svelte`, mounted in the Location panel under the harbor's;
  `festival/StashReadout.svelte` and `StashPanel.svelte`, mounted at the
  end of the Prestige panel. The stash's controls (the bonus, each
  technique offered, the regalia, each kept item's take-out) carry their
  commands in the view; `tests/festivalPanels.test.ts` renders both
  readouts on the server, finds each control and sends its command.
- Spec ported: `festival.test.ts` (51 cases run, 13 `it.todo` for port
  C5, one old case left out; five new: a sheathed blade held and given
  back, two of the ladder card, two of the catch-up hold; the first case of
  "the time jump" and two ladder cases run on the pure reads; the old
  `prestigeNow` and `Game.prestige` lockout cases are one command here),
  three kernel cases of the catch-up hold in `runner.test.ts`, `festivalHub.test.ts` (19 of
  19), `monsterKit.test.ts` (19 of 19; the kit code came with step 2 and had
  no test here), the todos `worldContent.test.ts` (the festival lint, the
  dark room's part) and `knockoutReturn.test.ts` (a festival floor is never
  a target), the festival bonus case of `derivedcache.test.ts`, the floor
  15 sky case of `openSky.test.ts` in `exposure.test.ts`, the John smoke
  case at 15.

Old bugs and rules kept:

- A festival attempt keeps the old door: the issued weapon is a starter
  with no rune slots, picked by the highest weapon skill; John fights the
  room bare-handed, as in the old build, since he never wields a weapon.
- The lockout runs on the world clock, three days; a prestige ends it.
- A kill anywhere counts toward its weapon family, in every run, festival
  or not (the old listener did).
- The regalia and every keep-marked piece held at the door go back to the
  stash at a prestige; the sheathed and fight-held pieces of the old
  `carriedStash` are not carried by the items system (older than this
  port).

Changed while porting (no rule):

- The lockout as the counter `festival:shut` (above).
- The kills by weapon family (old run counters `kills:weapon:<family>`)
  are the festival slice's `weaponKills`, run state: only the door reads
  them, and as counters each kill sent two events (the fight runs 1 to 2%
  slower, 11.2).
- `festivalHolds` as the stash reads it is "an attempt is live"; the old read
  also required the player on the festival's floors, and the attempt ends
  on the arrival that takes them off.
- The stash's controls are in the view (`StashAction`), as the sea's.
- The festival's view of the attempt has no control: the old "Enter the
  royale now" climbs to floor 16 (port C5); the ladder card does the same
  climb.

Noticed, older than this port (not changed):

- The save holds a fight (combat README): a save mid-wave reloads with the
  wave still fighting; the old build dropped the fight and fought the wave
  again. The old case's name is kept, its fight assertion changed.
- `combat/start-staged` hands the members to the slice by reference: a kit
  object from a caller's slice is shared until the next load (found by the
  `monsterKit.test.ts` port; the old build did the same; the festival
  passes copies).
- A floor whose clear is met by the kill that ends a fight pays its clear
  XP twice: the ladder checks the clears on `combat/kill` and again on
  `combat/fight-won`, and its stamp (`counters/set`) is delivered after
  both. Seen in the browser on floor 15 (+800 twice) and in John's log on
  floor 3 (+200 twice); floor 6's warchief is not the fight's last kill and
  pays once. The old build set the stamp at once and paid once. In every
  John digest and table since the spine; not changed here.
- Super-attribute fusion (old `systems/superattrs.ts`,
  `data/superattrs.data.ts`) is not ported: `fuseFact` exists in `stats`,
  but no system states it. See 11.1: it is the cause of C3's open floor 13
  gap and of floor 15's knockouts. Fixed after C4: the step 3 gap port
  `superattrs` (branch `step3-superattrs`, 2026-11-22; docs/SPINE.md
  section 21 has the account and John's tables with the fusion's timing).

Left out:

- The royale, floor 16, the field preview, the royale's lint checks, the
  lent gear of the caches: port C5. `winFestival` is ported and reached by
  the debug command `festival/debug-win` (refused in a production build)
  until then.
- The forge validator calls no festival lint (as for the ward and sea
  lints).

### 11.1 John

`tests/john.ts` gains `floor15` (section 3.1): after floor 14, John waits
out a lockout if one runs, rides to floor 15 (the climb is his: `ride:
false`, the old option) and lets the dark room's four waves come; the room
emptied clears the floor. No preparation in the hall, no hub activity, as
the old John. The try at the boss is a fight with `ph_room_last` in it.
`through: 15` plays run 3 to floor 15; `npm run pacing -- --through 15
[--side navy]`. No wall on any seed or side. The John smoke case of
`tests/john.test.ts` runs at 15. Runs 1 to 3 to floor 14 are unchanged from
section 10.1 (the same segment times and knockouts on every seed and side).

Merchants (the default), seeds 42 / 7 / 1234, old at `7c1267b` (section
3.3):

| Segment | Old | New | Old mean | New mean | KO old | KO new | Kills old | Kills new |
|---|---|---|---|---|---|---|---|---|
| f15 | 0:00:21 / 0:00:25 / 0:00:23 | 0:00:27 / 0:00:27 / 1:13:32 | 0:00:23 | 0:24:49 | 0/0/0 | 0/0/1 | 9/9/9 | 9/9/16 |
| Run 3 to f15 | 2:59:34 / 3:05:39 / 2:53:35 | 3:11:40 / 3:17:39 / 4:12:48 | 2:59:36 | 3:34:02 | | | | |
| Floor 0 to f15 | 4:19:30 / 4:29:40 / 4:11:40 | 4:31:12 / 4:31:08 / 5:38:34 | 4:20:17 | 4:53:38 | | | | |

`--side navy`, old run on `D:\ksgproto28` at `7c1267b`, nothing edited,
the same day (runs 1 and 2 and `f1-10 again` are the merchants' rows):

| Segment | Old | New | Old mean | New mean | KO old | KO new | Kills old | Kills new |
|---|---|---|---|---|---|---|---|---|
| f15 | 0:00:23 / 0:00:23 / 0:00:22 | 1:13:33 / 0:00:26 / 0:00:29 | 0:00:23 | 0:24:49 | 0/0/0 | 1/0/0 | 9/9/9 | 17/9/9 |
| Run 3 to f15 | 2:59:37 / 2:47:35 / 2:59:36 | 4:30:46 / 2:53:39 / 2:59:42 | 2:55:36 | 3:28:02 | | | | |

Kills on floor 15: the old runs won one attempt with no knockout on every
seed and side, the room's nine; new, a lost attempt adds the kills before
the knockout (7 at the third wave, 8 at the boss) to the nine of the next
one. Boss tries: old 1, won, every run; new 1, won, except navy seed 42
(2 tries, 1 lost: the knockout was at the boss).

Against section 3.4:

- Floor 15 is a boss segment, reported, not held. A clean attempt takes 26
  to 29 s against the old 21 to 25 s. Two runs of six lose the dark room
  once (merchants seed 1234, navy seed 42): the loss shuts floors 15 and
  16 for three world days, 72 minutes of play, which John waits out.
- Run 3 is outside 15% on both sides: +19.2% (merchants) and +18.5%
  (navy). Without the two lockouts it is +5.6% and +4.6%, the run 3 of
  section 10.1 plus floor 15's seconds.

The same pattern as C3's floor 13, with its cause found. Measured from the
state John leaves at floor 14 (scratch scripts, the old build's modules
imported read-only; seed 1234, merchants), both builds fighting the room
bare-handed (John never wields the rusty sword, so the door issues bare
hands in both): the waves take the new build 28, 48 and 53 ticks against 14,
21 and 28; the third costs the new John 314 HP against 28, and he arrives
with 324 of 831 HP against 643 of 810. The new John's damage is 333 against
624 at floor 14, before the festival takes anything: the same skills
(unarmed combat 55, fighting 53) and attributes within 2 points, but a base
damage of 93.9 against 168.0. The old John's formula Strength is 138.3,
his Strength and Charisma fused: on all three seeds he holds the
super-attribute Dominion (old `systems/superattrs.ts`, fused at Strength
60, Charisma 60, 500 kills and 25,000 gold earned) and the title
`titan_incarnate` (Strength 100, which the fused value reaches; +10
damage). Super-attribute fusion is not ported: `stats` has `fuseFact`, no
system states it. That is older than this port and outside its scope; not
tuned.

### 11.2 Offline budgets

The port adds one tick hook, `festival` (order 18): on a tick with no
attempt and no lockout it reads its own slice and returns. With a lockout
it reads the clock only on the kernel tick where the lockout can end (a
cache per slice object, as the sea's leg end). Handlers: `combat/kill` (the
kill by weapon family, one write to its own slice), `combat/fight-won` and
`world/arrived` (a read of its own slice off the festival). The kills by
weapon family started as run counters, as in the old build: two events per
kill. Moved into the slice; one process A/B of the fight runs moved by less
than its spread between sessions either way, so the gain is not resolved.

Against `main` (`d75aaee`, the worktree `D:\ksgproto28-b-main`), both
builds' modules imported in one process, alternating, ms (minimum /
median). The idle run, 15 rounds:

| Run of 8 hours | `main` | `step4-C4` | Median |
|---|---|---|---|
| No fight, no condition | 1,638 / 1,669 | 1,662 / 1,687 | +18 (+1.1%) |

The other runs, 3 rounds, in two sessions (first with the kills as
counters, second as the slice):

| Run of 8 hours | `main` | `step4-C4` | Median | Second session: `main` | `step4-C4` | Median |
|---|---|---|---|---|---|---|
| Poison held | 3,925 / 4,088 | 4,045 / 4,048 | -40 (-1.0%) | | | |
| Floor 1 table | 5,077 / 5,113 | 5,083 / 5,171 | +58 (+1.1%) | 5,083 / 5,090 | 5,237 / 5,247 | +157 (+3.1%) |
| Floor 6 Tunnels | 8,354 / 8,421 | 8,507 / 8,591 | +170 (+2.0%) | 8,341 / 8,456 | 8,406 / 8,584 | +128 (+1.5%) |
| World: hunt, floor 4 | 8,356 / 8,450 | 8,478 / 8,516 | +66 (+0.8%) | 8,375 / 8,413 | 8,601 / 8,735 | +322 (+3.8%) |
| World: hunt, floor 6 | 8,404 / 8,496 | 8,634 / 8,671 | +175 (+2.1%) | 8,481 / 8,513 | 8,674 / 8,736 | +223 (+2.6%) |
| World: the roadstead | 7,654 / 7,722 | 7,885 / 7,899 | +177 (+2.3%) | 7,754 / 7,775 | 8,048 / 8,122 | +347 (+4.5%) |

A CPU profile of the floor 1 run on the branch (5.26 s): every function of
the festival together, 25 ms (`weaponFamilyInHand` 7.6, `tickFestival`
6.1, `liftLockout` 4.7, the kill handler 4.6, `festivalFightWon` 1.5). The
rest of the gap is the kernel's share of one more system (its tick hook and
three more subscribers), within the spread of the measurement.

No new budget run: the festival's catch-up path is the hold, which stops
the catch-up at once (11.4); `tests/festival.test.ts` checks it. A run of 8
hours built while the hold was undecided (the ride into the dark room, the
four waves and the ten days run in catch-up) took 3,750 to 3,974 ms and was
removed with the hold.

The hold's cost, the branch alone in one process, `runHeadless` with and
without `hold`, alternating, ms (minimum / median). First version, 5 rounds
(idle 15): idle 1,735 / 1,753 without, 1,764 / 1,783 with (+30 ms, 1.7%);
the speed project's states: floor 1 +26 ms (0.5%), floor 6 +274 ms median
with the minimum 26 ms lower (noise), town +32 ms, floor 7 +25 ms. The ask
then went through a map lookup per tick; with each holder's context kept
in a flat list, idle, 24 rounds: 1,753 / 1,768 without, 1,769 / 1,786 with:
+16 ms minimum, +18 ms median (1.0%), about 60 ns per catch-up tick.

With the hold, against `main` in one process, ms (minimum / median). The
idle run, 15 rounds, the same script as the first table: `main` 1,637 /
1,649, branch 1,680 / 1,699 (+50 median, +3.0%; before the hold +18, so
the hold adds about 20 to 30 ms, as measured alone). The speed project's
four states (built by John in each build, then 8 hours of catch-up asking
the hold as `catchUp` does) and the idle run, 5 rounds (idle 15), in one
process after both builds' climbs:

| State | `main` | `step4-C4` | Median |
|---|---|---|---|
| Floor 1 hunting | 5,464 / 5,524 | 5,584 / 5,692 | +168 (+3.0%) |
| Floor 6 hunting | 10,297 / 10,460 | 10,687 / 10,711 | +251 (+2.4%) |
| Idle in town | 1,924 / 1,930 | 1,987 / 2,003 | +73 (+3.8%) |
| Floor 7 hunting | 7,151 / 7,314 | 7,285 / 7,423 | +109 (+1.5%) |
| Idle (budget run) | 1,744 / 1,764 | 1,812 / 1,846 | +82 (+4.6%) |

The idle run reads +82 here and +50 alone: in this process both builds'
climbs ran first. The whole port costs the catch-up runs 1.5 to 4.6% against
`main` in these sessions: the festival's tick hook, its handlers, three more
event subscribers, and the hold's ask (about 60 ns a tick). The speed test
in `npm run verify` (which does not ask the hold) stays at 78% of its limit
on floor 6.

`npm run verify` on the branch with the hold: svelte-check 0 errors; unit
3,224 passed, 4 skipped, 157 todo; budget 4 (idle 1,739 ms of 2,420,
poison 4,509 of 8,250, floor 1 5,132 of 7,700, floor 6 8,558 of 14,850);
budget-world 3 (floor 4 8,500, floor 6 8,447, the roadstead 7,818, each of
14,300); speed (floor 1 57%, floor 6 78%, town 63%, floor 7 53% of the
limit, machine load 9 to 10%; kills as the old build's within 10%); john
14; build.

Outcome digests recorded again in their own commit: every state hash (the
new slice `festival`), nothing else. The catch-up hold changes no digest:
no budget run and no John climb reaches the festival.

### 11.3 Browser check

Dev server 5600, desktop (1024 px) and 375 px. Saves made by the John
driver (seed 7, run 3, floor 15) loaded into the dev slot from the forge
page, with `savedAt` an hour ahead so no catch-up ran; the dev save was put
back after (backup `ksgb:development:save.before-step4C4-check`, the hub
save kept as `ksgb:development:save.step4C4-hall`).

- The dark room, live: the festival block under the activities ("Still
  standing", "Waves left", "Held at the door"), at 225 px while the waves
  fell; the door opened and the block turned to the hub's lines at 249
  px. The John character brings four bleed stacks from floor 14: in the
  hub they became Lacerated, knocked him out, and the attempt was lost
  (the Foot, gear back, floors 15 and 16 shut): the rules as ported.
- The hub at 375 px, the bleed removed from the save: the block at 322 px
  while the clock ran, no line cut, no overflow.
- The stash at the end of the Prestige panel: two tokens, three choices
  each, the kept regalia with take-out disabled and its reason during the
  attempt. Pressed: the permanent bonus (1 of 5 stacks, token gone), a
  technique at 375 px (Riposte, token gone), take-out after the attempt
  (the regalia in the pack). Every button 44 px high at 375 px. Two lines
  were cut at 375 px (the token's heading, the kept item's long facts):
  the heading shortened, the facts wrap (they never change in place).
- The ladder card: the forfeit from the hall by "Ride to floor 14" (the
  Foot, "Festival lost", floors shut, gear back). After it the card offered
  a ride to floor 15 that the ladder refused; the card now reads "Shut" and
  offers none, and inside an attempt every ride out reads "Forfeit: ride
  to ...", as the old card did.

No console errors. Not checked in a browser: a knockout in the dark room
during a wave, day ten (port C5), the issued weapon on a character that
wields one (tested headless).

### 11.4 The catch-up hold (K3, kernel decision 35)

The plan's K1 says the old festival clock reads the catch-up flag. It does
not: old `festival.ts` reads nothing of it. The old `catchUpTicks`
(`save/offline.ts` 67-83) stops the whole catch-up loop on the first tick
`festivalHolds` is true and banks the rest of the absence as bonus time,
1:1 up to the cap; a ride that lands in the dark room mid-catch-up stops
there. With `ctx.catchingUp` alone the world clock, the conditions, the
activities and a fight would keep running, so this needed a kernel change
section 4 did not list. Asked of the parent session as K3 and approved
during the port, with a condition on cost: `holds` must not read the
slices.

- Kernel: the system field `catchUpHold: { holds(ctx), held(ctx, ticksLeft)
  }`; `kernel.catchUpHeld(ticksLeft)` asks the declaring systems in system
  order; `runHeadless` asks before each tick with the option `hold`, which
  `catchUp` sets, and reports the ticks run and `heldBy`. A live kernel and
  `runHeadless` without `hold` never ask.
- Festival: `holds` answers a boolean kept per festival slice object
  (memory, never saved), written at an attempt's start and end and on every
  arrival; a load and a new run replace the slice object, and the first ask
  after either reads the state once. `held` sends `bonus/bank` with the
  ticks left.
- Tests: the six old offline cases (nothing simulated and the time banked
  1:1; the cap; what the bank took; a ride that lands in the dark room
  stops there; a short gap; the world outside catches up), and new: a
  catch-up that starts inside an attempt runs no tick (kernel tick, clock
  and generator unchanged), and the kept flag after a load, after a new run
  and after an attempt ends in play; three kernel cases with a toy system in
  `tests/runner.test.ts`. The offline summary's festival fields are the UI
  step.
- `tests/speed.test.ts` (`catchUpRun`) copies the body of `catchUp` and calls
  `runHeadless` without `hold`, so the speed project does not ask the hook;
  that file belongs to another session, and it was not changed here. The
  measurement above asks it.

## 12. Port C5: the royale and floor 16 (done)

Done 2026-11-22 on branch `step4-C5`, from `main` at `96a0032`. Not merged,
not pushed. Split in two commits, as 5.6 allowed:

1. `98dd825`, part 1: the generator, the map and the field. Every pure
   module of the royale with its old test file, and the royale's
   registries; nothing reads them in play, so John is unchanged.
2. `dbd7b2d`, part 2: the wiring and the panels. The festival's tick steps
   the field, floor 16 is content, the festival slice is version 2, the
   panels and John's `floor16`.

The outcome digests are recorded again in their own commit (`9735c47`).

The full account: `src/systems/festival/README.md` and the "Step 4 port
C5" section of the `items` README.

What was ported:

- Content: floor 16 (`ascent_f16`, band 5, clear `boss:f16_arena`, 850
  XP), area `ascent_f16_area` (roofed) and the arena `f16_arena`: 159
  spots, 28 areas, 17 floors. The survivor, champion and den monsters and
  the `festival_*` weapons were here already.
- `festival`, part 1 (old `royaleMap.ts` 810, `royaleTerrain.ts` 86,
  `royaleField.ts` 733, `survivorGen.ts` 460, `ui/lib/royaleView.ts` 383,
  `data/survivors.data.ts` 299, the royale part of `festival.data.ts`):
  `royaleMap.ts`, `royaleTerrain.ts`, `royaleField.ts`, `survivorGen.ts`,
  `royaleView.ts`, `royaleData.ts`, unchanged but for the imports. Seven
  registries: `royale_strategies` (10), `royale_sections` (8, registry
  order is the map's cell index), `royale_dens` (5), `royale_caches` (35),
  `survivor_species` (2, `id` is the monster), `survivor_families` (9),
  `survivor_archetypes` (10, `species` a list of `{ monsterId, weight }`).
  A scratch script ran the old modules (imported read-only) and the new
  ones on the same seeds: the same map, the same 3,000-step field run (97
  fallen, the same two left) and the same survivor builds and staged
  members.
- `festival`, part 2 (old `royale.ts` 255, the royale part of
  `festival.ts`, `RoyaleField.svelte` 707, `RoyaleMinimap.svelte` 186,
  `royaleMapImage.svelte.ts`, the field preview of `FestivalPanel.svelte`):
  - `royale.ts`: `tickRoyale` (the field made from the attempt's seed,
    never during a fight; leftovers walk again; the champion restored;
    `stepField` on the kernel's generator; the spring's heal), the caches
    (`takeCache`, `takesTheHand`), the dens, `royaleFightWon`.
  - The tick: phase `royale` on the arena, out of travel and recovery.
    `combat/fight-won` at the arena: a den cleared, survivors off the
    field, the champion's fall the win (`winFestival`).
  - Slice version 2: `plan` (run state, as the old `FestivalState.plan`);
    `run.field`. Migration step 1 sets `plan` empty; fixture `v2.json`.
  - Commands `festival/move-on-field`, `festival/clear-field-target`,
    `festival/set-plan` (the old `Game` methods). The C4 debug command
    `festival/debug-win` is removed.
  - `royalePublish.ts`: the view's royale (the field on the player's map,
    the survivors in sight as people, the radar, the ground, the known
    caches and dens), the hub's preview, the plan, "Enter the royale now".
  - Panels: `RoyaleFieldReadout.svelte`, `RoyaleMinimap.svelte`,
    `mapImage.ts` (the terrain image, redrawn on a theme switch),
    `FestivalReadout.svelte` (the hub's preview and enter control, the
    field), `royaleControls.ts` (each control's command). The Location
    panel's ladder card writes a refused rung's reason as a term and labels
    the climb into the royale "Enter the royale", as the old `ladderView`.
  - The royale's lint checks in `validation.ts` (the old ones), run by
    `tests/worldContent.test.ts`.
- `items`: `items/grant` takes `wear` (a lent piece put on when its slot is
  free, else the pack; old `wearIfFree` in `takeCache`).
- Spec ported: `royaleMap.test.ts` (24 of 24), `royaleView.test.ts` (37 of
  37), `royaleField.test.ts` (47 of 47), `survivorGen.test.ts` (36 of 36),
  the 13 C5 todos of `festival.test.ts` and the three old royale sections
  C4 left out ("the attempt's field" 4, "caches and lent gear" 8, "dens"
  2; 77 cases in the file, no todo), the royale lint todo of
  `worldContent.test.ts`, the floor 16 cases of old `openSky.test.ts` in
  `exposure.test.ts`, `festivalHub.test.ts` reading `ROYALE_SECTIONS`, the
  panels in `festivalPanels.test.ts` (8 new cases: every control rendered
  on the server and its command sent, the ground's and the minimap's pick
  through `walkAt`), John's smoke case at 16.

Old bugs and rules kept:

- The champion's kill is floor 16's clear and ends the fight, so floor 16's
  clear XP is paid twice (850 twice; the log in the browser check shows
  both lines). The floor-clear bug of section 11, older than this port.
- A survivor's weapon cache gives a random `CACHE_WEAPONS` entry; the
  `unarmed` entry, iron gauntlets, is worn as armour, not wielded.
- A different item of the issued weapon's family always takes the hand:
  there is no ranking of weapons.
- The `weakest` move looks within the field's flat sight (20), not the
  looker's terrain sight.
- A den's monsters pay their kill XP and drops like any kill.
- Outside an attempt the ladder refuses floor 16 from anywhere (`closed`),
  floor 15 cleared or not, as the old `festivalLadder`.

Changed while porting (no rule):

- The royale's tables are registries (the old ones were plain data, the
  strategies and sections a prose registry); `survivor_species` is keyed
  by the monster (`id`), an archetype's `species` is a list.
- The field's random draws come from the kernel's generator, as the old
  ones came from the state's.
- The map's palette names this build's colour tokens.
- The fight on the field is shown by the Combat panel, with a line "Fight:
  open; the Combat panel shows it." under the field; the old panel drew
  the battle stage under the field.
- Status lines are "Label: fact" ("Radar: on in 42 min (42 s of play)",
  "Ground: ...", "Field: ...", "Fights: ..."); the old line read "Radar in
  42 min (42s of play)". The lists of who and what is known scroll in fixed
  boxes; "Whole field" sits on the map's corner.
- The view carries the fighters in the player's sight and counts, never the
  whole field; the survivors in sight are named from a memo.
- A lent piece is minted by `items/grant` with `wear`; the issued weapon is
  taken out and given back by `items/take-weapon` and `items/give-back`.

Noticed, older than this port:

- C4's stand-in `festival/debug-win` is removed; every case that used it
  plays the royale.
- The festival-floor cases of old `openSky.test.ts` ("no spot of the
  Vermin Festival is open", darkness and sun at the arena) were not ported
  by C4; ported here.
- `kernel.view()` costs about 2.5 ms per call wherever the player stands
  (12.2); docs/PERFORMANCE.md section 3.4. Not changed.
- The festival cases that play a royale take 2.5 to 3 s each in the
  parallel unit run; two of them (two royales in one case) passed vitest's
  5 s default in the first verify. Every case that plays the royale has a
  30 s limit.

Left out:

- The old field's fallback for an attempt saved without a field seed: every
  attempt here draws its seed at the door.
- The offline summary's festival lines (the UI step, as in C4).

### 12.1 John

`tests/john.ts` gains `floor16` (section 3.1, the old driver's
`attemptFestival(16)`): with the dark room won and the door open, John
climbs from the dark room to floor 16 at once (no preparation in the hall,
no hub activity), walks the field by the default plan, and lets the field's
fights come until the attempt ends; a lost one is taken up again after the
lockout. A try at the boss is a fight with `ph_survivor_champion` in it.
`through: 16` plays run 3 to floor 16; `npm run pacing -- --through 16
[--side navy]`. No wall on any seed or side. The John smoke case of
`tests/john.test.ts` runs at 16.

New John and old John at `7c1267b` (`D:\ksgproto28`, nothing edited; its
modules imported read-only by a scratch script with a kill counter and a
tally of the royale's events), the same day, seeds 42, 7 and 1234. Runs 1
and 2, `f1-10 again` and floors 11 to 15 are the rows of docs/SPINE.md
section 22.1, unchanged on every seed and side (the same tick each segment
closed on, knockouts, kills and boss tries).

Merchants (the default):

| Segment | Old | New | Old mean | New mean | Change | KO old | KO new | Kills old | Kills new | Boss tries/lost old | Boss tries/lost new |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f15 | 0:00:21 / 0:00:25 / 0:00:23 | 0:00:23 / 0:00:22 / 0:00:22 | 0:00:23 | 0:00:22 | -4.1% | 0/0/0 | 0/0/0 | 9/9/9 | 9/9/9 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f16 | 0:03:45 / 0:03:05 / 0:04:25 | 0:03:02 / 0:03:32 / 0:04:24 | 0:03:45 | 0:03:39 | -2.5% | 0/0/0 | 0/0/0 | 15/9/11 | 10/8/10 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| Run 3 to f16 | 3:03:19 / 3:08:44 / 2:58:00 | 3:08:38 / 3:15:06 / 2:57:58 | 3:03:21 | 3:07:14 | +2.1% | | | | | | |
| Floor 0 to f16 | 4:23:15 / 4:32:45 / 4:16:04 | 4:28:10 / 4:28:35 / 4:23:44 | 4:24:01 | 4:26:50 | +1.1% | | | | | | |

`--side navy` (runs 1 and 2 and `f1-10 again` are the merchants' rows):

| Segment | Old | New | Old mean | New mean | Change | KO old | KO new | Kills old | Kills new | Boss tries/lost old | Boss tries/lost new |
|---|---|---|---|---|---|---|---|---|---|---|---|
| f15 | 0:00:23 / 0:00:23 / 0:00:22 | 0:00:26 / 0:00:23 / 0:00:21 | 0:00:22 | 0:00:24 | +4.9% | 0/0/0 | 0/0/0 | 9/9/9 | 9/9/9 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f16 | 0:03:03 / 0:04:32 / 1:17:11 | 0:03:10 / 0:03:21 / 1:20:43 | 0:28:15 | 0:29:04 | +2.9% | 0/0/1 | 0/0/1 | 7/13/22 | 10/10/24 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| Run 3 to f16 | 3:02:40 / 2:52:07 / 4:16:46 | 3:14:50 / 2:56:56 / 4:20:16 | 3:23:51 | 3:30:41 | +3.3% | | | | | | |
| Floor 0 to f16 | 4:22:36 / 4:16:08 / 5:34:50 | 4:34:22 / 4:10:26 / 5:46:01 | 4:44:32 | 4:50:16 | +2.0% | | | | | | |

Kills on floor 16 are the survivors and den monsters John killed on the
field. Boss tries: one try at the champion per attempt, won, on every seed
and side in both builds. Navy seed 1234 loses one royale in both builds (a
knockout in a field fight, not at the champion): the loss shuts floors 15
and 16 for three world days, 72 minutes of play, which John waits out, then
he empties the dark room again and wins the second attempt. Level at the
floor 16 clear: old 40, 41, 40 (merchants) and 41, 40, 41 (navy); new 41 on
every seed and side.

The field itself: field fights John won (a line "N left on the field" each)
old 14/8/10 and 6/9/12, new 9/7/9 and 8/9/14; caches John took old 6/1/5
and 3/3/5, new 0/0/1 and 1/2/5; den fights old 0/0/0 and 0/1/0, new 0/0/0
and 1/0/0. Each build draws the attempt's field seed from its own
generator at the door, so the map, the scatter and the field's draws
differ between the builds; and the default plan's first strategy, "Fall
Back When Hurt", reads the health John carries in from the dark room,
which differs by seed in both directions (on arrival, old 0.62 / 0.34 /
0.79 of max, new 0.45 / 1.00 / 1.00, merchants). With the same seed and
inputs the field steps identically in both builds (part 1's scratch run),
and the cache cases of `tests/festival.test.ts` take every kind of cache.

Against section 3.4: run 3 is within 15% of the old mean on both sides
(+2.1% merchants, +3.3% navy); floor 16 is a boss segment, reported, not
held (-2.5% and +2.9%, the lockout on navy seed 1234 in both builds); floors
12 and 13 are the rows of SPINE 22.1, within one convoy.

### 12.2 Live play on floor 16

The field steps once a live tick while the player stands on the arena (the
festival's catch-up hold stops catch-up the moment an attempt holds the
player, so the field never runs offline). Measured as the speed project
reports live play (docs/PERFORMANCE.md section 5.4), both builds in one
process (the old build's modules imported read-only), 10 alternating
rounds, seed 42: each build's John to floor 15, the climb into the royale,
100 ticks of warm-up on the field, then each round loads that state and
runs 300 ticks. Machine load 4% before, 22% after. Microseconds per tick
(minimum / median):

| Per tick | Old `game.tick()` | New `kernel.tick()` | New `kernel.tick()` + `kernel.view()` |
|---|---|---|---|
| Floor 16, the field live | 362 / 373 | 309 / 320 | 2,941 / 3,051 |

- The field's own cost: `stepField` alone on a copy of the field the new
  build opened (99 survivors, the player in a fight so not engaged), 300
  steps per round: the new code 263 / 269 µs a step, the old code 265 /
  270 (the same code). It is 84% of the new build's floor 16 tick. Per
  step: the duels whose time is up, a fifth of the survivors choosing a
  goal (the look-around), the walk, the caches, the dens, and the
  all-pairs check for duels over at most a hundred bodies.
- The new tick is 0.86 of the old build's here (the bar of 0.5 holds for
  catch-up, which this state never runs; live play is reported, not held).
- The view: `kernel.view()` costs about 2.5 ms per call on the arena and
  in the hub alike (2,481 / 2,491 µs on the arena, 2,412 / 2,591 in the
  hub with the preview): the cost of the whole view of section 3.4 of
  docs/PERFORMANCE.md, older than this port. The royale's part of it,
  `fieldView` alone, is 43 / 44 µs per call (the fog over 99 survivors, the
  40 caches and dens, the radar, one line per survivor in sight from a
  memo); the hub's preview, `previewView`, 13 / 14 µs. The view never
  copies the field: it carries the survivors in sight and counts.
- The tick reads the clock, world, combat, resources, levels and the stat
  block each tick on the field (something is due every tick); the counters
  only when the player's plan asks which sections it knows. With no attempt
  the festival's tick reads its own slice and returns, as in C4.

### 12.3 Offline budgets and the speed project

The port adds no per-tick work off the festival floors: with no attempt the
festival's tick reads its own slice and returns, as in C4; the catch-up
hold is C4's; the royale's registries are validated at kernel creation
only, which catch-up skips. Floor 16 adds one floor, one area and one spot
to the content every per-kill and per-spot read walks.

Against `main` (`96a0032`, the worktree `D:\ksgproto28-b-main`), both
builds' modules in one process, alternating rounds (`.scratch-c5/ab.ts`,
`abspeed.ts`, the scripts of section 22.2 of docs/SPINE.md). Wall time
(minimum / median) and processor time of the process, the median of the
per-round differences.

Batch 1, machine load 13% before the idle runs, 20% before the fight runs,
60% before the speed states (other programs), 25% after:

| Run of 8 hours | Rounds | `main` wall | Branch wall | Wall median | Processor, paired |
|---|---|---|---|---|---|
| No fight, no condition | 15 | 1,752 / 1,908 | 1,758 / 1,894 | -14 (-0.7%) | +15 (+0.8%) |
| A poison held | 15 | 4,586 / 5,226 | 4,408 / 5,263 | +37 (+0.7%) | -93 (-1.5%) |
| Floor 1 table sent to combat | 3 | 5,462 / 6,015 | 5,330 / 5,863 | -152 (-2.5%) | -142 (-2.1%) |
| Floor 6 Tunnels sent to combat | 3 | 9,411 / 9,880 | 9,017 / 9,948 | +68 (+0.7%) | -484 (-4.3%) |
| World: hunt, floor 4 Woods Edge | 3 | 9,157 / 10,169 | 9,614 / 9,922 | -247 (-2.4%) | +376 (+3.4%) |
| World: hunt, floor 6 Tunnels | 3 | 9,020 / 9,703 | 9,066 / 9,652 | -51 (-0.5%) | +1 (0.0%) |
| World: the roadstead | 3 | 8,620 / 8,944 | 8,315 / 9,125 | +181 (+2.0%) | +189 (+1.9%) |

The speed project's four states (built by John in each build, then 8 hours
of catch-up asking the holds, as `catchUp` does) and the idle run. Batch 1
started at 60% load; batch 2 ran alone at 29% before and after:

| State | `main` wall (batch 1) | Branch wall (batch 1) | Processor, paired (batch 1) | `main` wall (batch 2) | Branch wall (batch 2) | Processor, paired (batch 2) |
|---|---|---|---|---|---|---|
| Floor 1 hunting | 6,215 / 6,767 | 6,382 / 7,048 | +389 (+5.2%) | 5,756 / 6,822 | 5,741 / 6,795 | -62 (-0.8%) |
| Floor 6 hunting | 11,728 / 12,315 | 12,222 / 12,886 | +203 (+1.5%) | 11,685 / 13,260 | 11,406 / 13,208 | +78 (+0.5%) |
| Idle in town | 1,984 / 2,158 | 2,025 / 2,175 | +47 (+2.1%) | 2,003 / 2,229 | 1,986 / 2,321 | +32 (+1.4%) |
| Floor 7 hunting | 8,223 / 8,409 | 8,427 / 9,005 | +750 (+8.0%) | 8,460 / 8,850 | 8,387 / 9,155 | -62 (-0.6%) |
| Idle (budget run) | 1,922 / 2,047 | 1,926 / 2,014 | +1 (0.0%) | 1,964 / 2,033 | 1,973 / 2,063 | +47 (+2.2%) |

Batch 1 has 5 rounds per state and 15 idle runs; batch 2 has 7 and 21.
The batch run at the lower load reads within -0.8% and +2.2% of `main`
on every state; batch 1's +5 to +8% on floors 1 and 7 did not repeat. Every
outcome digest is equal to the recorded ones but for the state hash (the
slice field `plan`), in its own commit.

`npm run verify` on the final code, exit 0 (processor at 26% at the start,
42% at the end): svelte-check 0 errors; unit 3,546 passed, 4 skipped, 123
todo; budget 4 (idle 2,112 ms of 2,420, poison 5,438 of 8,250, floor 1
5,586 of 7,700, floor 6 9,393 of 14,850); budget-world 3 (floor 4 9,039,
floor 6 9,929, the roadstead 9,864, each of 14,300); speed (floor 1 57%,
floor 6 77%, town 57%, floor 7 51% of the limit, machine load 23 to 25%,
yardstick 206 to 215 ms; kills as the old build's within 10%); john 14;
build. No budget failed on time in any of the three verify runs of the
session; the first two stopped on the festival timeouts and the digests
above.

### 12.4 Browser check

Dev server 5600, desktop (1024 px) and 375 px. The dev save was backed up
at `ksgb:development:save.before-step4C5-check` and put back after, from
the forge page with the game page closed. The save used is C4's
`ksgb:development:save.step4C4-hall` (seed 7, run 3, the hall, festival
day 1), loaded into the dev slot with `savedAt` an hour ahead (no
catch-up); its festival slice loaded at version 1 and migrated.

- The hub at 1024 px: "Enter the royale now" with its line, and the
  preview of the attempt's field (the terrain image, the section names,
  "Scouted: 0 of 8", every section "not scouted"). At 375 px: the block 351
  px wide, no overflow, the button 44 px high.
- Pressed "Enter the royale now": the ride up ("Field: on the way up; 99
  survivors wait there."), then the field on floor 16: four status lines at
  24 px each, the terrain, the village's buildings, the sight ring, the
  compass, the minimap over the frame's corner. A click on the ground set a
  point (the path and the flag), "Back to the plan" turned enabled; the
  player walked into the village and the plan took over on arrival; the
  village's caches and the cleared Hound Yard showed in "Known on this
  field" (18, in a fixed box that scrolls). A click on the minimap set a
  point; "Back to the plan" cleared it. The royale was won: the log named
  each survivor by its build ("Duelist Marsin"), "Champion Branesin (Lv
  40)", the win, the laurel and the hidden title; `festival:wins` 1,
  `boss:f16_arena` 1, the player left on the arena. The same log showed
  floor 16's clear XP twice (the old clear bug, kept).
- A second royale from the same save at 375 px: the minimap under the
  field, "Whole field" (pressed: the whole diamond), the plan's pickers 44
  px high (slot 1 set to Keep Away, slot 2 cleared to None: the rest moved
  up and a third picker was offered; the plan was in the next save), a tap
  on the ground set a point, the arrow key moved it three units, a theme
  switch redrew the terrain image. A field fight opened under the plan
  "Hunt the Weakest": "Fights: 0 duelling each other, 1 fighting you.",
  the radar's line, "Fight: open; the Combat panel shows it.", every line
  still 24 px. Won again.
- Found and fixed: at 375 px the ground's line shared its row with "Whole
  field" and was cut ("The Deserted Villa..."); the button moved onto the
  map's top right corner, and the ground's line has a two-line fixed box in
  a frame narrower than 520 px. The radar's off line read "Radar in 46
  min"; it reads "Radar: on in 46 min (46 s of play)" now.
- The ladder card from floor 14 after the win: floor 16 "Cleared" with the
  term "Refused: Floor 16 is the festival's royale, entered only from floor
  15's hall during an attempt ...", the ride disabled, as the old card's
  "Entered from floor 15's hall" term. Found in this check: the reason was
  only a tooltip before.
- No console errors.

Not checked in a browser: a den fight, a knockout on the field, a cache
lending a weapon that takes the hand (tested headless), the "Enter the
royale" label of the ladder card's climb from the hall, day ten's ride.

## 13. Port W: Weathersense, Chronosense, the sky lint (done)

Done 2026-11-23 on branch `step4-W`, from `main` at `ec83015`. Not merged,
not pushed. Commits:

1. `1677910`, the port.
2. `e3944b0`, the outcome digests recorded again.
3. This account.

The full account: the "Step 4 port W" sections of the `weather`, `skills`
and `world` READMEs, the Chronosense section of the `clock` README, and the
panel paragraph of the `attributes` README.

What was ported:

- `clock`: the readers of old `chronosense.ts` (147): `SENSE_LEVELS`,
  `describeTimeSense`, `describeMoons`, `timePenaltyMult` (read by nothing,
  as in the old build), the skill's id and numbers.
- `weather`: `senses.ts`, old `weathersense.ts` (186) but
  `noteTravelSkies`, and `tickChronosense`; `validation.ts`, old
  `skyValidation.ts` (93), unchanged but for the imports. Both trainers run
  in this system's tick: Chronosense before the exposure (the old loop's
  order), Weathersense inside the exposure minute with the sample of an
  open sky. `clock` imports no system and `skills` imports `log`, which
  imports `clock`, so the trainer cannot live in `clock`; the weather tick
  reads the clock on every tick already. `forecastSky` (old shell
  `headerSky`: `still` under a roof), `view.forecast`, `SkyReadout.svelte`
  and `SkyPanel.svelte`, mounted in the Location panel under the festival's
  readout.
- `world`: `noteTravelSkies` in `tickTravel`, after the Scouting XP (old
  `locations.ts` 94-95), keyed by the region of the spot's area.
- `skills`: the view's `timeSense` (null until Chronosense is held) and
  `TimeSenseReadout.svelte`. The Character panel (`attributes`) mounts it in
  its head card in place of the date and time line: the old build showed the
  calendar only through the sense (the header clock chip, absent until the
  sense manifests).
- No slice changes shape: no migration, no fixture. No kernel change.
- Spec ported, every old case accounted for:

| Old file | Cases | Here |
|---|---|---|
| `weathersense.test.ts` | 9 | 9 in `tests/weathersense.test.ts`, `westlands` (shelved) replaced by `threshold`; `prognosisTitle` asserted on `view.forecast`. 7 new: the trainer in the tick (a severe minute manifests, a roof keeps it out, the watch rate on a minute only, no keyless grant at the ceiling while a severe key still counts, an arrival by travel), the Sky readout rendered on the server (3). |
| `chronosense.test.ts` | 15 | 15 in `tests/chronosense.test.ts`; one old `tickChronosense` is one kernel tick landing on the clock value. 4 new: no grant at the ceiling and training again once it is raised; a save past the first day manifests on the next tick, minute or not; the view's `timeSense`; the readout rendered on the server. |
| `sky.test.ts` "the forecast" | 5 | 5 in `tests/exposure.test.ts` (the todo "the forecast reads a calm sky and a heatwave") |
| `sky.test.ts` `skyContentIssues` | 7 | 7 in `tests/exposure.test.ts` (the todo "`skyContentIssues` refuses ...") |
| `content.test.ts` "region skies and sky-gated encounter lines" | 1 | `tests/worldContent.test.ts` calls `skyContentIssues` on the live content (it held an inline copy of the region and area rules) |
| `exposure.test.ts` todo "Weathersense trains under an open sky and on a journey" | 1 | 1 new case: under the open ridge, at the place left while travelling, never under a roof; the arrival case is in `weathersense.test.ts` |
| `skySlots.test.ts` | 2 | Not ported: the 7.1em clock slot of the old header chip and phone dock line (`shortClock`). The shell has neither (the UI step). The Character panel's time line has a fixed height, two lines under 640 px. |
| `prestige.test.ts` "Chronosense ceiling" | 1 | Ported before (`tests/prestige.test.ts`) |

  The exposure todos the plan names as 1264 and 1265 are the first two of
  the three above (lines 1379 to 1381 at `ec83015`). Unit project: 3,594
  passed, 4 skipped, 120 todo (`main`: 3,546, 4, 123).

Old bugs and rules kept:

- Chronosense manifests when the clock reaches one day (`totalTicks >=
  TICKS_PER_DAY`), but a run starts at 09:00 of day 1: the sense manifests
  15 game hours (9,000 ticks) into every run, not after a full day lived.
- Severe by temperature alone (-10 and below, 37 and above) makes many
  winter minutes severe: where Weathersense manifests depends on the drawn
  seed (John: the first game minute at the Foot with seed 7, floor 4 with
  seed 42, never with seed 1234).
- A severe temperature keys the novelty by temperature (`wx:brutal_cold`,
  `wx:scorch`), not by the kind; a rough read calls snow, a blizzard and a
  storm "wet weather"; `noteTravelSkies` keys on the area's region, not the
  sky region.
- Both senses count in `skill:levels` (Eternal Student: +5% skill XP at
  25 levels, +8% at 100) and in the harvest's skill levels. This moves
  John (13.1) and the fight budget runs (13.2).

Changed while porting (no rule):

- The forecast and the sky now are lines in the Location panel, shown from
  Weathersense level 1; the old build had them in the header chip's
  tooltip, on hover. "Label: fact" lines; the rough marker is "(rough)",
  not "(?)".
- The old `prognosisTitle`, read by no UI, put the exact date in the
  prognosis heading at any Chronosense level; the heading here is the old
  header's, the region only.
- A grant with no novelty key changes nothing to a sense not held, or to a
  sense at its ceiling with 0 XP, so the trainers do not send it then (the
  watch XP, the minute XP; `senseState`). The old calls ran and changed
  nothing. Every outcome digest and John's climbs through floor 16 are equal
  with and without the skip.

Noticed, older than this port:

- The old `content.test.ts` case "every skill tag is emitted by something"
  (which lists `time` and `weather`) has no counterpart in the rebuild.
- The forge validator calls no sky lint (as for the ward, sea and festival
  lints).

### 13.1 John

`tests/john.ts` is unchanged: John trains neither sense by choice. Both
train on their own in his climb, as in the old build: Chronosense
manifests 9,000 ticks into each run (old: the same tick); Weathersense in
the first severe open-sky minute, which depends on the drawn weather seed
(seed 42: floor 4 in run 1; seed 7: the first minute at the Foot; seed
1234: in no run). Old John (`7c1267b`, seed 42, merchants) gains both in
every run too, Weathersense at tick 6,370 and Chronosense at 9,000 of run
1, and ends floor 16 at Weathersense 17 and Chronosense 17 (branch: 14 and
16).

The passive XP moves John's segments; the plan (5.7) expected it not to.
The cause is the old rule that both senses count in `skill:levels` and in
the harvest:

- Run 1: every segment closes on the same tick as on `main`, but seed 42's
  floor 6 gate and floor 6 one tick earlier (the Eternal Student's 100-level
  tier, +8% skill XP, is claimed at tick 10,849 instead of 12,272). The
  first harvest's skill-level source pays 5 points on every seed instead of
  4: 18 / 17 / 18 points (`main` 17 / 16 / 17). The old build's harvest is
  17 / 18 / 17, its skill-level source 5 / 5 / 5.
- Runs 2 and 3: the senses manifest again 9,000 ticks into each run and the
  student tiers come earlier again; every segment from `f1-6 again` on
  differs from `main` on every seed (scratch `.scratch-w/diff.txt`).

New John against `main` (`ec83015`) and old John at `7c1267b`
(`D:\ksgproto28`, nothing edited; its modules imported read-only), the same
day, seeds 42, 7 and 1234, `--through 16`, the scripts of 12.1. `main`'s
results equal port C5's branch runs on every seed and side, and the old
results equal C5's old runs. Runs 1 and 2 are the same for both sides.

Merchants (the default):

| Segment | Old | Main | Branch | Old mean | Main mean | Branch mean | Branch vs main | Branch vs old | KO old | KO main | KO branch | Kills main | Kills branch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| f1-6 again | 0:23:16 / 0:25:29 / 0:24:04 | 0:22:45 / 0:23:08 / 0:24:06 | 0:22:57 / 0:23:43 / 0:24:13 | 0:24:16 | 0:23:20 | 0:23:38 | +1.3% | -2.7% | 21/20/22 | 20/21/20 | 20/23/20 | 78/87/78 | 78/88/78 |
| f7 | 0:03:02 / 0:02:58 / 0:03:05 | 0:02:45 / 0:02:25 / 0:02:41 | 0:03:23 / 0:02:55 / 0:02:32 | 0:03:02 | 0:02:37 | 0:02:57 | +12.6% | -2.6% | 3/3/3 | 2/2/2 | 3/2/2 | 32/29/33 | 40/43/33 |
| f8 | 0:06:33 / 0:00:15 / 0:00:13 | 0:12:42 / 0:00:15 / 0:06:26 | 0:06:33 / 0:00:14 / 0:06:26 | 0:02:20 | 0:06:28 | 0:04:24 | -31.8% | +88.4% | 9/0/0 | 15/0/8 | 8/0/8 | 128/1/56 | 65/1/57 |
| f9 | 0:12:44 / 0:12:51 / 0:19:13 | 0:00:12 / 0:12:48 / 0:06:29 | 0:06:27 / 0:06:29 / 0:06:27 | 0:14:56 | 0:06:30 | 0:06:28 | -0.6% | -56.7% | 11/15/20 | 0/16/9 | 7/8/7 | 1/128/54 | 62/60/66 |
| f10 | 0:00:11 / 0:12:42 / 0:00:15 | 0:06:30 / 0:00:14 / 0:12:42 | 0:00:11 / 0:06:29 / 0:12:43 | 0:04:23 | 0:06:29 | 0:06:28 | -0.3% | +47.5% | 0/2/0 | 3/0/5 | 0/4/6 | 93/1/187 | 1/89/188 |
| f11 siege | 0:07:29 / 0:06:54 / 0:07:03 | 0:08:23 / 0:08:11 / 0:07:30 | 0:08:57 / 0:08:17 / 0:07:30 | 0:07:09 | 0:08:02 | 0:08:15 | +2.7% | +15.4% | 3/2/2 | 5/4/4 | 6/5/4 | 39/38/35 | 43/38/35 |
| f1-10 again | 0:46:42 / 0:39:36 / 0:46:00 | 0:52:33 / 0:47:13 / 0:49:22 | 0:42:24 / 0:46:37 / 1:00:01 | 0:44:06 | 0:49:43 | 0:49:41 | -0.1% | +12.7% | 47/36/35 | 42/46/48 | 41/40/54 | 419/311/333 | 233/350/525 |
| f11 | 0:12:18 / 0:07:24 / 0:07:00 | 0:06:27 / 0:05:47 / 0:03:38 | 0:04:36 / 0:06:23 / 0:04:59 | 0:08:54 | 0:05:17 | 0:05:19 | +0.5% | -40.3% | 6/4/3 | 1/2/3 | 5/2/2 | 105/83/42 | 48/97/74 |
| f12 | 0:30:00 / 0:36:00 / 0:30:00 | 0:30:00 / 0:30:00 / 0:24:00 | 0:30:00 / 0:24:00 / 0:24:00 | 0:32:00 | 0:28:00 | 0:26:00 | -7.1% | -18.8% | 8/10/7 | 8/5/12 | 9/7/5 | 545/571/393 | 533/429/454 |
| f13 | 1:30:00 / 1:42:00 / 1:30:00 | 1:36:00 / 1:48:00 / 1:36:00 | 1:30:00 / 1:48:00 / 1:48:00 | 1:34:00 | 1:40:00 | 1:42:00 | +2.0% | +8.5% | 6/9/12 | 6/9/10 | 8/10/11 | 2694/3028/2582 | 2486/2873/3038 |
| f14 | 0:00:13 / 0:00:14 / 0:00:12 | 0:00:13 / 0:00:13 / 0:00:13 | 0:00:14 / 0:00:13 / 0:00:13 | 0:00:13 | 0:00:13 | 0:00:13 | +3.4% | +3.1% | 0/0/0 | 0/0/0 | 0/0/0 | 3/3/2 | 3/2/2 |
| f15 | 0:00:21 / 0:00:25 / 0:00:23 | 0:00:23 / 0:00:22 / 0:00:22 | 0:00:22 / 0:00:22 / 0:00:22 | 0:00:23 | 0:00:22 | 0:00:22 | -0.2% | -4.2% | 0/0/0 | 0/0/0 | 0/0/0 | 9/9/9 | 9/9/9 |
| f16 | 0:03:45 / 0:03:05 / 0:04:25 | 0:03:02 / 0:03:32 / 0:04:24 | 0:03:25 / 0:03:09 / 0:03:56 | 0:03:45 | 0:03:39 | 0:03:30 | -4.2% | -6.6% | 0/0/0 | 0/0/0 | 0/0/0 | 10/8/10 | 8/10/7 |
| Run 1 | 0:26:41 / 0:22:52 / 0:24:13 | 0:26:14 / 0:26:26 / 0:25:51 | 0:26:14 / 0:26:26 / 0:25:51 | 0:24:35 | 0:26:11 | 0:26:11 | -0.0% | +6.5% | | | | | |
| Run 2 | 0:53:15 / 1:01:09 / 0:53:52 | 0:53:17 / 0:47:03 / 0:59:54 | 0:48:28 / 0:48:06 / 0:59:51 | 0:56:05 | 0:53:25 | 0:52:09 | -2.4% | -7.0% | | | | | |
| Run 3 to f16 | 3:03:19 / 3:08:44 / 2:58:00 | 3:08:38 / 3:15:06 / 2:57:58 | 2:51:01 / 3:08:44 / 3:21:31 | 3:03:21 | 3:07:14 | 3:07:05 | -0.1% | +2.0% | | | | | |
| Floor 0 to f16 | 4:23:15 / 4:32:45 / 4:16:04 | 4:28:10 / 4:28:35 / 4:23:44 | 4:05:43 / 4:23:17 / 4:47:13 | 4:24:01 | 4:26:50 | 4:25:25 | -0.5% | +0.5% | | | | | |

Level at the floor 16 clear: old 40/41/40, main 41/41/41, branch 40/41/41.

Fights in the climb: old 2719/2968/2689 main 2880/2953/2703 branch 2512/2849/3160

`--side navy` (runs 1 and 2 and `f1-10 again` are the merchants' rows):

| Segment | Old | Main | Branch | Old mean | Main mean | Branch mean | Branch vs main | Branch vs old | KO old | KO main | KO branch | Kills main | Kills branch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| f11 | 0:06:18 / 0:07:24 / 0:07:00 | 0:06:27 / 0:05:47 / 0:03:38 | 0:16:36 / 0:06:23 / 0:04:59 | 0:06:54 | 0:05:17 | 0:09:19 | +76.1% | +35.0% | 3/6/6 | 4/4/3 | 13/5/3 | 90/76/42 | 221/76/70 |
| f12 | 0:30:00 / 0:30:00 / 0:30:00 | 0:36:00 / 0:24:00 / 0:36:00 | 0:30:00 / 0:30:00 / 0:30:00 | 0:30:00 | 0:32:00 | 0:30:00 | -6.3% | +0.0% | 13/16/12 | 11/9/19 | 7/14/9 | 662/418/600 | 560/516/563 |
| f13 | 1:36:00 / 1:30:00 / 1:36:00 | 1:36:00 / 1:36:00 / 1:30:00 | 1:42:00 / 1:42:00 / 1:30:00 | 1:34:00 | 1:34:00 | 1:38:00 | +4.3% | +4.3% | 14/15/11 | 9/15/10 | 14/16/9 | 2641/2527/2410 | 2831/2661/2459 |
| f14 | 0:00:15 / 0:00:13 / 0:00:13 | 0:00:14 / 0:00:13 / 0:00:12 | 0:00:13 / 0:00:13 / 0:00:13 | 0:00:13 | 0:00:13 | 0:00:13 | +2.1% | -2.2% | 0/0/0 | 0/0/0 | 0/0/0 | 3/3/2 | 3/3/2 |
| f15 | 0:00:23 / 0:00:23 / 0:00:22 | 0:00:26 / 0:00:23 / 0:00:21 | 0:00:23 / 0:00:22 / 0:00:25 | 0:00:22 | 0:00:24 | 0:00:24 | +0.0% | +4.9% | 0/0/0 | 0/0/0 | 0/0/0 | 9/9/9 | 9/9/9 |
| f16 | 0:03:03 / 0:04:32 / 1:17:11 | 0:03:10 / 0:03:21 / 1:20:43 | 0:02:59 / 0:03:22 / 0:04:16 | 0:28:15 | 0:29:04 | 0:03:32 | -87.9% | -87.5% | 0/0/1 | 0/0/1 | 0/0/0 | 10/10/24 | 9/10/9 |
| Run 3 to f16 | 3:02:40 / 2:52:07 / 4:16:46 | 3:14:50 / 2:56:56 / 4:20:16 | 3:14:34 / 3:08:57 / 3:09:54 | 3:23:51 | 3:30:41 | 3:11:08 | -9.3% | -6.2% | | | | | |
| Floor 0 to f16 | 4:22:36 / 4:16:08 / 5:34:50 | 4:34:22 / 4:10:26 / 5:46:01 | 4:29:17 / 4:23:30 / 4:35:37 | 4:44:32 | 4:50:16 | 4:29:28 | -7.2% | -5.3% | | | | | |

Level at the floor 16 clear: old 41/40/41, main 41/41/41, branch 41/41/41.

Fights in the climb: old 2662/2588/2772 main 2960/2548/2755 branch 2898/2765/2867

Against section 3.4, on the means over the three seeds, against the old
build (`.scratch-w/tolerance.mjs`):

- Every run total is within 15%: run 1 +6.5% (unchanged from `main`), run
  2 -7.0% (`main` -4.8%), run 3 to floor 16 +2.0% merchants and -6.2% navy
  (`main` +2.1% and +3.3%), floor 0 to 16 +0.5% and -5.3%.
- Every segment over two minutes of old mean is within 35% but these:

| Segment | Side | Old mean | Branch mean | Change | `main` mean | `main` change |
|---|---|---|---|---|---|---|
| f8 (keeper) | both | 0:02:20 | 0:04:24 | +88.4% | 0:06:28 | +176.3% |
| f9 (keeper) | both | 0:14:56 | 0:06:28 | -56.7% | 0:06:30 | -56.5% |
| f10 (keeper) | both | 0:04:23 | 0:06:28 | +47.5% | 0:06:29 | +47.9% |
| f11 | merchants | 0:08:54 | 0:05:19 | -40.3% | 0:05:17 | -40.6% |
| f11 | navy | 0:06:54 | 0:09:19 | +35.0% (35.02) | 0:05:17 | -23.3% |
| f16 (boss) | navy | 0:28:15 | 0:03:32 | -87.5% | 0:29:04 | +2.9% |

  Floors 8 to 10 and merchants floor 11 were outside on `main` already
  (sections 8.1 and 10.1: keepers, one try every 6:30; floor 11 bound to
  the convoy schedule). New with this port: navy floor 11, where seed 42
  arrives at level 18 (`main` 21) and is knocked out 13 times (16:36
  against the old 6:18), and navy floor 16, where seed 1234 wins its first
  royale on the branch while the old build and `main` lose one and wait out
  the 72-minute lockout (4:16 against 1:17:11). Section 3.4 reports keeper
  and boss segments and holds floors 11 to 13 per seed by the convoy (next
  item); on the plain rule of the means, these six rows are outside.
- Per seed on the schedule-bound floors (one convoy is 6 minutes; floor 11
  needs one):
  - floor 11, merchants -7:42 / -1:01 / -2:01 against the old (`main`
    -5:51 / -1:37 / -3:22); navy +10:18 / -1:01 / -2:01 (`main` +0:09 /
    -1:37 / -3:22). Navy seed 42 arrives at level 18 (`main` 21) and is
    knocked out 13 times on floor 11;
  - floor 12, merchants 0 / -12 / -6 minutes, navy 0 / 0 / 0 (`main` 0 /
    -6 / -6 and +6 / -6 / +6);
  - floor 13, merchants 0 / +6 / +18, navy +6 / +12 / -6 (`main` +6 / +6 /
    +6 and 0 / +6 / -6).
  Merchants seed 7 on floor 12, merchants seed 1234 on floor 13, navy seed 7
  on floor 13 and navy seed 42 on floor 11 are outside one convoy of the old
  time. The run totals hold. The movement is the divergence of three seeds
  once the skill XP changes in run 2; no rule of floors 11 to 13 changed.

### 13.2 Offline budgets and the speed project

What the port adds per tick: no tick hook. The weather tick, which read the
clock on every tick already, compares the clock with the manifest tick and
a memo; on a game minute it reads the skills slice once for Chronosense and,
under an open sky with a sample, once for Weathersense. Per game minute
while the senses are held: one `skills/grant-xp` for Chronosense, one for
Weathersense under an open sky (the old build sent both whether held or
not). Per arrival by travel: one `skills/grant-xp`. The views: the
forecast's samples (up to 10) only while Weathersense is held; the time
sense's clock reading only while Chronosense is held.

The senses also change what the budget runs simulate: Chronosense reaches
level 20 in every run of 8 hours, and its levels bring the Eternal Student
tiers earlier (13 above), so a branch run is not the same run as `main`'s.

The cost per grant, and what was cut. A scratch benchmark ran 8 hours of
ticks at the start spot with Chronosense held below its ceiling (a grant
every game minute) and at it (none sent), paired, 7 rounds: 2.67 µs per
grant at first. A profile put a third of the skills handler in the ceiling
read (`skillCap`, a derived read of the fact `skillCap:<id>`), made on
every grant to a capped skill however far below the cap. Two changes in
`skills`, each leaving every outcome digest and John's six climbs through
floor 16 equal:

- `addSkillXp` reads the ceiling only from `maxLevel` up (a ceiling is
  `maxLevel` plus raises, and a raise only adds), at most once per grant;
- the grant handler, when the tags train exactly one skill, pays that skill
  if held instead of walking every held skill to find it (the walk would
  visit it alone).

After them: 2.19 µs per grant. Counted on the floor 1 run (a listener on
every event, both builds): 19,694 more `skills/grant-xp` (Chronosense's
minutes until its ceiling) and 20 more level-up chains, 2.7% more events in
all; the stat-cache census shows the same block computes (371 of the
player, 9,677 of monsters) and 20 more recollects (the level-ups).

What a grant that changes no level does, counted (`.scratch-w/grantcounts.ts`:
600 game minutes at the start spot with Chronosense held at level 19, cap
raised, never levelling, against the same minutes with no sense): per
grant one `skills/grant-xp` event and no other event, one derived read
(the `skillXp` multiplier the amount needs), no touch of any source, no
recollect, no stat compute, no dispatch, no request. By the code the
handler also reads the `practice` slice once (a practice fight shapes the
XP) and computes the level's cost to see that no level is gained; the
weather tick reads the skills slice once per game minute. Both reads are
needed for the same outcome, and the event is the kernel's rule for a
change to another system: nothing cheap is left on that path.

Against `main` (`ec83015`, the worktree `D:\ksgproto28-b-main`), both
builds' modules in one process, alternating rounds (the scripts of 12.3),
on the final code. Idle and poison: three processes of 5 rounds, machine
load 45, 38 and 19% at their starts; fights: three processes of 1 round
(the third with the branch first), load 7, 9 and 35%. Wall time (minimum /
median) and processor time of the process, the median of the per-round
differences:

| Run of 8 hours | Rounds | `main` wall | Branch wall | Wall median | Processor, paired |
|---|---|---|---|---|---|
| No fight, no condition | 15 | 1,747 / 1,873 | 1,871 / 1,961 | +88 (+4.7%) | +93 (+4.7%) |
| A poison held | 15 | 4,753 / 5,060 | 4,801 / 5,261 | +201 (+4.0%) | +110 (+1.8%) |
| Floor 1 table sent to combat | 3 | 5,436 / 5,439 | 5,619 / 5,812 | +373 (+6.9%) | +343 (+5.1%) |
| Floor 6 Tunnels sent to combat | 3 | 9,080 / 9,585 | 9,014 / 9,619 | +34 (+0.4%) | +61 (+0.5%) |
| World: hunt, floor 4 Woods Edge | 3 | 8,705 / 9,418 | 9,036 / 9,871 | +453 (+4.8%) | +405 (+3.8%) |
| World: hunt, floor 6 Tunnels | 3 | 8,749 / 9,160 | 8,800 / 9,612 | +452 (+4.9%) | +235 (+2.3%) |
| World: the roadstead | 3 | 8,632 / 8,653 | 8,783 / 8,801 | +148 (+1.7%) | +281 (+2.9%) |

Before the two changes in `skills` (15 rounds of idle and poison, 3 of
fights, load 7 to 35%): idle +5.8% wall, +7.2% processor; poison +5.2% and
+3.6%; floor 1 +6.2% and +5.2%.

Reading: the idle and poison runs pay about 23,000 Chronosense grants per 8
hours (until level 20), 2.2 µs each by the benchmark, about 50 ms; the
measured +88 to +201 ms is above that, and the floor 1 run's +343 ms of
processor is several times the counted work. The rest is not found in any
count (events, stat computes); the fight runs simulate a different game
from `main`'s (the Eternal Student tiers move XP), so their per-run time
is not a like-for-like measure. A grant per game minute is the old build's
rule: its catch-up sent two (Chronosense and Weathersense) whether the
senses were held or capped. A long-lived save holds both senses at their
ceilings, where this build sends none.

The speed project (the four John states and the idle run against `main`) is
not measured: from about 20:50 another program (HandBrake, a video
encoder) held the machine at 77 to 100%, and two attempts during it ran at
about twice the usual times. The budget rows above were taken before it.

`npm run verify` on the final code: svelte-check 0 errors; unit 3,594
passed, 4 skipped, 120 todo; john 14 passed; build passed. The timed
projects are not measured, because of outside load: `budget` and
`budget-world` ran at 87 to 90% machine load (HandBrake), every run took
about twice its usual time and all seven time limits failed (idle 3,401
ms, poison 9,949, floor 1 15,296, floor 6 27,543, world 4 21,294, world 6
22,270, the roadstead 18,672); every digest assertion, checked before the
time, passed. `speed` was not run under that load.

### 13.3 Browser check

Port 5600 was held by another program's dev server for the whole session
(a different project, started by another agent application), so the check
ran on the build preview, port 5601 (`npm run build`, `ksgb-preview`), at
1024 px and at 375 px. The preview's save slot (`ksgb:production:save` of
`localhost:5601`) held only the new game the first page load created; it
was backed up at `ksgb:production:save.before-step4W-check` and put back
after, the backup key removed. Every edit of the slot was made from a
static file of the same origin (`/assets/*.css`), so no game page could
save over it. The save used: John (seed 7) at the close of floor 4, built
by a scratch script on the branch, `savedAt` an hour ahead (no catch-up):
Weathersense 7, Chronosense 2, standing at the Raid Camp (floor 4, open
sky).

- Character panel, 1024 px: the head card reads "Time: Dawn" (24 px line);
  no moon line below level 4; the skill tree lists "Chronosense Lv 2 / 20"
  and "Weathersense Lv 7 / 30".
- Location panel, 1024 px: the Sky card under Activities: "Now: overcast ·
  feels freezing", "Prognosis: The Ascent", "In 2 hours" and "In 6 hours"
  precise, "In 12 hours" and "Tomorrow" fair, as level 7 gives. Every line
  24 px, none cut. At 375 px: the card 351 px wide, the same lines, no
  horizontal scroll.
- Weathersense 30 and Chronosense 25 (cap raised by 5), 375 px: twelve
  lines, out to "In 7 days: wet weather, freezing (rough)" (the 7-day row
  opens at 29); "Time: Secondday, 2nd of First Month, Year 1 · 06:39" in its
  two-line box (48 px), and three moon lines with the day of the cycle
  ("Middle Moon: waxing crescent (day 2 of 28)"), none cut.
- Floor 1 (a roofed region), Weathersense 30: "Now: still · feels cold" and
  still rows with damped temperatures, as the old header read a roofed
  spot.
- Neither sense held: "Time: unknown until Chronosense manifests (one full
  day lived)." (one line at 1024 px, the two-line box at 375 px), no Sky
  card, neither skill in the tree.
- No console errors.

Not checked in a browser: a sense manifesting or levelling in live play
(tested headless), the forecast while travelling, the dev server on 5600.

## 14. Port C6: the Malgeri Crossing, floor 17 (done)

Done 2026-11-24 on branch `step4-C6`, from `main` at `0653c3c`. Not merged,
not pushed. Commits:

1. `b51d28c`, the port.
2. This account.

The outcome digests did not change (every digest of `npm run verify`
passed on the port's code), so there is no digest commit.

The full account: the "Step 4 port C6" sections of the `world`, `weather`,
`npcs`, `bestiary`, `smithing`, `crafting`, `ladder`, `clock`, `counters`
and `quests` READMEs.

What was ported:

- `world`: region `malgeri_range` (old `locations.data.ts` 40), area
  `ascent_f17_area` (109: in the Ascent, its sky by `skyRegionId`) and the
  18 spots of floor 17 (3447-4000), old records with their text: four maps,
  the six open hunt spots with a slime line per front and the three calm
  lines, the peak gate (`boss:f17_peak` on the road down the west face, the
  mirror open), no waypoint on the descent, Kystel's Anvil and Hamlet
  Square. 177 spots, 29 areas, 5 regions.
- `weather`: the Malgeri sky table's reader is the region; no code changed.
  The fronts, their rules on the player and the foes, the sky lines and the
  calm run on floor 17's open slopes as the engine already ran them for a
  mounted region in the tests.
- The calm: the first-calm flag and line, live and in catch-up; the veil of
  the calm trio (port L's) lifting at the stamp; Captain Bren's lore line.
  The offline line: the old summary carried the first-calm line when its
  catch-up suppressed the log; here catch-up keeps log lines, so the line is
  in the log after it (tested); the summary dialog is the UI step.
- `npcs`: Thora Ironbrand and Captain Bren (old `npcs.data.ts` 322-341 and
  their text); `lore` with `npcDialogue(reader, npc)`; `loreIssues`; the
  view's `line` (old `dialogueLine`, 300 ticks a line) and
  `PeopleList.svelte` in the Quests panel.
- `bestiary`: `veilIssues`. `counters`: `conditionRefIssues`. The two lints
  are the old forge validator's veil and lore rule; the forge calls neither.
- Kystel's Anvil (`f17_hamlet_forge`): `smithing` unchanged (the anvil is
  read from the spot's `benches`); `crafting` gains the seven recipes the
  spot lists that were not here (`leather`, `leather_cap`, `leather_vest`,
  `leather_boots`, `hunting_bow`, `herbal_charm`, `wolf_cloak`; old numbers).
- `ladder`: band 6 `ascent_aberrant` and floor 17 `ascent_f17` (clear
  `boss:f17_keeper`, 900 XP). 6 bands, 18 floors; floor 17 is the top rung
  until port C7.
- `clock`: `clock/debug-advance`, a DEBUG jump for John's calm option (the
  old John wrote the clock), refused in a production build.
- No slice changes shape: no migration, no fixture. No kernel change.
- Spec, every old case accounted for:

| Old file | Cases | Here |
|---|---|---|
| `malgeri.test.ts` | 37 | 35 in `tests/malgeri.test.ts` under the old names: the layout (9), the monster levels (4), the sky lines (8), the disclosure rule (5), the veil (6), the forge validator (3, on `veilIssues` and `loreIssues`). "The map badge" (2) is `it.todo`: the map has no level badge (old `spotThreat`, the UI step). 2 new: Kystel's Anvil (an anvil, its eight crafts, the anvil view names it), the people list rendered on the server (Bren's lore line in its turn after the flag, the Talk control). The neighbour scan reads `f16_arena`; `f18_well_head` is port C7. |
| `malgeriCatchup.test.ts` | 1 | 1 in `tests/malgeriCatchup.test.ts`: 288,000 ticks live and through `catchUp` from the same save, the same flag, entry count and trio kills; the first-calm line in both runs (a recorder system keeps it: eight hours of fights push it out of the log's 60 lines). 8.4 s. |
| `malgeriSave.test.ts` | 6 | 4 as a save and a load at the current versions (the clear and the peak gate carry; a save at the keeper spot keeps spot and activity; a save at the landing and an uncleared save stay; the text round-trips). 2 `it.todo`: the move to the landing and the idempotence of the old v64 to v65 step (no importer from the old save). |
| `fixtures/malgeri.ts` | | `tests/fixtures/malgeri.ts`: the same three spots and two areas, as a mount function that returns its removal, in the real region; `tests/exposure.test.ts` uses it instead of its inline copy (which mounted the region too). |
| `exposure.test.ts` todos | 5 | The plan's 577 (`malgeri_range` names a registered table, plus the content record equals the old one) and 1159 (the calm lines of the east ridge roll only under a calm open sky) ported; "the offline summary carries the first calm line" as the line in the log after catch-up; "the first calm opens the pending bestiary entries"; floor 17's part of "floors 17 to 20" (2 cases: the range's sky through `skyRegionId`; night, moonlight, Darkvision, the caves dark at noon, sun on the slopes and none under the roofs). "Floors 18 to 20" stays `it.todo` for port C7. Floor 17's roofed spots joined the indoor list of the open-sky cases. |
| `wardLabels.test.ts` todo | 1 | Still `it.todo`, reason changed: floor 17's descent is the one road shut by a boss latch, but the case reads the road's terms on the map, which this build does not print (old `routeInfo.shut`, the UI step). |
| `john.test.ts` | 1 | The smoke case climbs to 17 (the old one to 20, port C7). |
| `knockoutReturn.test.ts` "a roofed hunt as the last fallback" | | Ported before on floor 6's spots (the old cases stood on floor 17); not moved. |

  Unit project: 3,644 passed, 4 skipped, 120 todo (`main`: 3,594, 4, 120).

Old bugs and rules kept:

- John's arranged calm climb looks for the next calm at most 12 days ahead,
  minute by minute; a spell can be up to 24 days less 8 hours away, so the
  climb can find no calm and still jumps 12 days. It happened to old seed
  1234 and to branch seed 42 (each build draws its own weather seed).
- The regent's spot has no fight limit and the clear is its boss latch: a
  fight of legionaries alone (weight 6 against 100) clears nothing.
- `firstKill` 0 is the "not opened" mark of a veiled species, and an entry
  opened at the first tick of a new game gets 0 (port L's kept bug); the
  floor 17 cases land their stamp a few ticks in.
- The old test "has seven open-sky hunt spots" lists six.
- Under a roof the Sky readout's prognosis reads `still` rows (the old
  header read a roofed spot as sheltered; port W).
- Floor 17 is the top rung until port C7: its clear writes the end notice.

Changed while porting (no rule):

- The people list shows the line each person says now, "Says: “…”" in a
  fixed three-line box (old people card's rotating `dialogueLine`); the
  rebuild's Quests panel showed only the description, so no lore line could
  be seen. The list box is 12rem (was 9rem).
- The old forge validator's veil and lore rule is two functions
  (`veilIssues`, `loreIssues`) the tests call on the live content.
- John's calm jump is a DEBUG command; his report carries the floor 17
  counts (`malgeri`) the old pacing read from its per-fight list.
- The Malgeri fixture is a mount function, not an import that assigns.

Noticed, older than this port:

- The Combat panel's "Dev encounter" picker (spine port 4: "until the world
  port sends a site") ships in a production build. It lists every monster,
  the calm trio included, before the first calm (against floor 17's
  disclosure rule), and starts a fight with any monster at any level.
- The map prints no terms for a road shut by a condition ("No known
  route.") and has no level badge; both were the old map's (UI step).
- `kernel.view()` costs about 3.5 to 4.2 ms per call on floor 17 and 3.75
  to 3.9 ms on `main` at the arena the same day (14.2).
- Old `docs/MALGERI.md` says Kystel's Anvil has 15 recipes; the old spot
  lists 8.

### 14.1 John

`tests/john.ts` gains `floor17` (the old `desertFloors[17]`): John walks
the cave and the east slope to the peak and tries the peak's guardian with
the roofed west peak as his den; after its first kill he walks the descent
to the hamlet's gates and tries the regent with the mountain base as his
den. `calmAtMalgeri` (`--malgeri-calm`) jumps the clock once to the range's
next calm as he sets out and makes the open east ridge his den at the peak.
`npm run pacing -- --through 17 [--side navy] [--malgeri-calm]` prints the
old floor 17 line (the two bosses told apart, the calm minutes, the
fights against calm lines). No wall on any seed, side or option.

Old John at `7c1267b` (`D:\ksgproto28`, nothing edited; its modules
imported read-only by a scratch script), `main` (`0653c3c`, through 16)
and the branch, the same day, seeds 42, 7 and 1234. On every seed and side
the branch equals `main` through floor 16: the same tick each segment
closed on, knockouts, boss tries, levels and kills. Runs 1 and 2 and every
segment through floor 15 are section 13's rows.

Merchants (the default):

| Segment | Old | Main | Branch | Old mean | Main mean | Branch mean | Branch vs main | Branch vs old | KO old | KO branch | Kills old | Kills branch | Boss tries/lost old | Boss tries/lost branch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| f16 | 0:03:45 / 0:03:05 / 0:04:25 | 0:03:25 / 0:03:09 / 0:03:56 | 0:03:25 / 0:03:09 / 0:03:56 | 0:03:45 | 0:03:30 | 0:03:30 | 0.0% | -6.6% | 0/0/0 | 0/0/0 | 15/9/11 | 8/10/7 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f17 | 0:14:13 / 0:14:19 / 0:14:17 | - | 0:07:49 / 0:27:12 / 0:14:13 | 0:14:16 | - | 0:16:25 | - | +15.0% | 14/14/10 | 6/22/11 | 205/208/222 | 108/445/223 | 4/2, 4/2, 4/2 | 3/1, 6/4, 4/2 |
| Run 3 to f16 | 3:03:19 / 3:08:44 / 2:58:00 | 2:51:01 / 3:08:44 / 3:21:31 | 2:51:01 / 3:08:44 / 3:21:31 | 3:03:21 | 3:07:05 | 3:07:05 | 0.0% | +2.0% | | | | | | |
| Run 3 to f17 | 3:17:32 / 3:23:02 / 3:12:17 | - | 2:58:50 / 3:35:56 / 3:35:44 | 3:17:37 | - | 3:23:30 | - | +3.0% | | | | | | |
| Floor 0 to f17 | 4:37:28 / 4:47:03 / 4:30:21 | - | 4:13:33 / 4:50:29 / 5:01:26 | 4:38:18 | - | 4:41:49 | - | +1.3% | | | | | | |

Level at the floor 17 clear: old 45/45/45, branch 44/47/45. Floor 17's
bosses (tries/lost): old peak 2/1, 1/0, 2/1 and gate 2/1, 3/2, 2/1; branch
peak 1/0, 2/1, 2/1 and gate 2/1, 4/3, 2/1. Fights in the climb: old
2838/3088/2820, branch 2571/3104/3282.

`--side navy`:

| Segment | Old | Main | Branch | Old mean | Main mean | Branch mean | Branch vs main | Branch vs old | KO old | KO branch | Kills old | Kills branch | Boss tries/lost old | Boss tries/lost branch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| f16 | 0:03:03 / 0:04:32 / 1:17:11 | 0:02:59 / 0:03:22 / 0:04:16 | 0:02:59 / 0:03:22 / 0:04:16 | 0:28:15 | 0:03:32 | 0:03:32 | 0.0% | -87.5% | 0/0/1 | 0/0/0 | 7/13/22 | 9/10/9 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f17 | 0:14:20 / 0:14:13 / 0:14:09 | - | 0:33:47 / 0:14:01 / 0:27:10 | 0:14:14 | - | 0:24:59 | - | +75.6% | 12/13/12 | 30/13/21 | 215/210/216 | 559/217/459 | 4/2, 4/2, 4/2 | 7/5, 4/2, 6/4 |
| Run 3 to f16 | 3:02:40 / 2:52:07 / 4:16:46 | 3:14:34 / 3:08:57 / 3:09:54 | 3:14:34 / 3:08:57 / 3:09:54 | 3:23:51 | 3:11:08 | 3:11:08 | 0.0% | -6.2% | | | | | | |
| Run 3 to f17 | 3:17:00 / 3:06:20 / 4:30:55 | - | 3:48:21 / 3:22:58 / 3:37:04 | 3:38:05 | - | 3:36:08 | - | -0.9% | | | | | | |
| Floor 0 to f17 | 4:36:56 / 4:30:22 / 5:48:59 | - | 5:03:03 / 4:37:31 / 5:02:47 | 4:58:46 | - | 4:54:27 | - | -1.4% | | | | | | |

Level at the floor 17 clear: old 45/45/45, branch 47/45/47. Floor 17's
bosses: old peak 1/0, 2/1, 2/1 and gate 3/2, 2/1, 2/1; branch peak 1/0,
2/1, 2/1 and gate 6/5, 2/1, 4/3.

`--malgeri-calm` (merchants):

| Seed | Build | f17 | KO | Boss tries/lost | Peak | Gate | Calm spell, min | Under the open calm sky, min | Calm-line fights, won | Level |
|---|---|---|---|---|---|---|---|---|---|---|
| 42 | old | 0:14:15 | 21 | 4/2 | 2/1 | 2/1 | 8 | 5 | 16, 3 | 45 |
| 42 | branch | 0:14:29 | 12 | 4/2 | 1/0 | 3/2 | 0 | 0 | 0, 0 | 45 |
| 7 | old | 0:27:22 | 30 | 6/4 | 4/3 | 2/1 | 8 | 5 | 17, 4 | 46 |
| 7 | branch | 0:20:45 | 25 | 5/3 | 2/1 | 3/2 | 8 | 5 | 16, 3 | 46 |
| 1234 | old | 0:20:47 | 20 | 5/3 | 1/0 | 4/3 | 0 | 0 | 0, 0 | 46 |
| 1234 | branch | 0:27:24 | 34 | 6/4 | 4/3 | 2/1 | 8 | 5 | 16, 1 | 46 |

Means: old 0:20:48, branch 0:20:53. Where a calm was found (old 42 and 7,
branch 7 and 1234), John spent the whole 8-minute spell on the floor, 5
minutes of it under the open calm sky, and won 1 to 4 of 16 or 17 fights
against calm lines in both builds (old `docs/MALGERI.md`, 2026-11-11: 29
to 39% won). Old seed
1234 and branch seed 42 found no calm within the 12-day search (old rule,
above): the clock jumped 12 days and the floor ran under fronts.

Why floor 17 differs per seed: the old build lost exactly two boss fights
on every seed and side (each loss costs a 6-minute grind at the den), the
branch one to five (12 of 24 tries lost old, 18 of 30 branch). Checked:

- John at the floor's door is the same in both builds (seed 7: level 41,
  the same six attributes, max HP 821 and 820, damage 655.4 and 655.0).
- The regent's fight is the same: a fixed character (all attributes 55,
  level 44, full health) against the hamlet gates' table, the same clock
  and weather seed in both builds, 40 or 60 fights each: under a calm 14 and
  16 of 40 won (old, branch), 315 and 310 ticks a fight; daytime snow 14 and
  9 of 60, storm 20 and 17 of 60, heatwave 18 and 17 of 60.
- What differs is chance in a handful of tries at about even odds, and the
  sky over the bosses (open spots): each build draws its own weather seed.

Against section 3.4, on the means over the three seeds, against the old
build:

- Every run total is within 15%: run 3 to floor 17 +3.0% merchants and
  -0.9% navy, floor 0 to 17 +1.3% and -1.4%.
- Segments over two minutes of old mean outside 35%: the six rows of section
  13 (f8, f9, f10 keepers; merchants f11; navy f11; navy f16), each equal
  on `main` (the branch equals `main` through floor 16); and navy f17,
  +75.6% (0:24:59 against 0:14:14), new with this port, a boss segment
  (two keeper loops), reported, not held. Merchants f17 is +15.0%.
- Floors 12 and 13 per seed: section 13's numbers, unchanged.

### 14.2 Live play on floor 17

Both builds in one process (the old modules imported read-only),
alternating rounds, seed 42: each build's John to the floor 16 close,
stood at the spot hunting, the new build's clock and weather seed set to
the old build's (both stand under the same sky: rain), 100 ticks of
warm-up, then each round loads that state and runs 3,000 ticks. 10 rounds.
Machine load 0% before, 8% after the ridge; 61% at the end of the west
peak. Microseconds per tick (minimum / median):

| Per tick | Old `game.tick()` | New `kernel.tick()` | New `kernel.tick()` + `kernel.view()` |
|---|---|---|---|
| The East Ridge (open sky, sky lines, the rain's rule) | 28 / 29 | 12 / 14 | 3,402 / 3,542 |
| The West Peak (roofed den) | 28 / 29 | 15 / 16 | 3,568 / 3,696 |

- The new tick is 0.48 and 0.55 of the old one on floor 17.
- The view: `kernel.view()` is the cost of the whole view (docs/PERFORMANCE.md
  section 3.4, older than this port). Same process per build, seed 42, John
  at the floor 16 close, 200 calls a round, 7 rounds, medians: `main` 3,896
  µs at the arena, 3,904 in the hall, 3,753 at the Foot; the branch 3,993,
  4,066 and 3,996 at the same spots, and 4,259 at the east ridge, 4,194 in
  Hamlet Square, 4,209 at Kystel's Anvil. The two builds ran one after the
  other, not alternating. The port adds to the view one more rung, one more
  area of map spots, and the people's line where someone stands.
- What the port adds per tick: nothing. No tick hook; the weather tick runs
  the sky rules and the calm check on floor 17 as it would for any region
  with a sky table. The npcs view reads the clock, and the skills and
  counters for a condition reader, only where a person stands (the reader
  only where one has lore).

### 14.3 Offline budgets and the speed project

Against `main` (`0653c3c`, the worktree `D:\ksgproto28-b-main`), both
builds' modules in one process, alternating rounds (the scripts of 12.3).
Wall time (minimum / median) and processor time of the process, the median
of the per-round differences. Idle and poison: one process of 15 rounds,
machine load 32% before, 8% after; fights: two processes of 2 rounds and 1
round (the second with the branch first), load 2 to 16%.

| Run of 8 hours | Rounds | `main` wall | Branch wall | Wall median | Processor, paired |
|---|---|---|---|---|---|
| No fight, no condition | 15 | 1,927 / 1,974 | 1,934 / 1,964 | -10 (-0.5%) | +16 (+0.8%) |
| A poison held | 15 | 5,096 / 5,253 | 5,005 / 5,149 | -104 (-2.0%) | -172 (-2.7%) |
| Floor 1 table sent to combat | 3 | 5,941 / 5,962 | 5,858 / 5,909 | -53 (-0.9%) | +16 (+0.2%) |
| Floor 6 Tunnels sent to combat | 3 | 9,784 / 9,799 | 9,772 / 9,990 | +191 (+1.9%) | +219 (+1.9%) |
| World: hunt, floor 4 Woods Edge | 3 | 9,926 / 10,284 | 9,770 / 10,085 | -199 (-1.9%) | -859 (-7.6%) |
| World: hunt, floor 6 Tunnels | 3 | 9,886 / 10,573 | 10,043 / 10,747 | +174 (+1.6%) | +360 (+3.1%) |
| World: the roadstead | 3 | 9,132 / 9,595 | 9,309 / 9,554 | -41 (-0.4%) | -62 (-0.6%) |

The speed project's four states (built by John in each build, then 8 hours
of catch-up asking the holds, as `catchUp` does) and the idle run, one
process, 5 rounds (15 idle runs), machine load 10% before, 7% after:

| State | `main` wall | Branch wall | Wall median | Processor, paired |
|---|---|---|---|---|
| Floor 1 hunting | 6,086 / 6,524 | 6,070 / 6,665 | +141 (+2.2%) | +15 (+0.2%) |
| Floor 6 hunting | 11,297 / 12,419 | 11,416 / 12,664 | +245 (+2.0%) | +233 (+1.7%) |
| Idle in town | 2,224 / 2,270 | 2,230 / 2,334 | +64 (+2.8%) | +1 (0.0%) |
| Floor 7 hunting | 7,852 / 8,539 | 7,855 / 8,650 | +111 (+1.3%) | +173 (+1.9%) |
| Idle (budget run) | 2,004 / 2,069 | 1,991 / 2,125 | +56 (+2.7%) | -30 (-1.4%) |

No state of the speed project or budget run stands on floor 17, and the
port adds no per-tick work elsewhere; the content grows by one floor, one
area and 18 spots that the per-kill floor checks and per-spot reads walk.
The readings lie within -2.7% and +3.1% of `main` but floor 4's processor
time (-7.6%, one of three rounds far off), and the wall and processor
differences of one state often disagree in sign (idle, floor 1): within
the noise of this machine.

`npm run verify` on the port's code, exit 0 (machine load 9% at the start,
0% at the end): svelte-check 0 errors; unit 3,644 passed, 4 skipped, 120
todo; budget 4 (idle 1,986 ms of 2,420, poison 4,849 of 8,250, floor 1
5,532 of 7,700, floor 6 9,042 of 14,850); budget-world 3 (floor 4 9,145,
floor 6 9,376, the roadstead 8,534, each of 14,300); speed (floor 1 57%,
floor 6 81%, town 65%, floor 7 57% of the limit, machine load 11 to 13%,
yardstick 197 to 205 ms; kills as the old build's within 10%); john 14;
build. Every outcome digest equal to the recorded ones.

### 14.4 Browser check

Port 5600 was held by another project's dev server ("Frontier Idle", not
this repository) for the whole session, so the check ran on the build
preview, port 5601 (`ksgb-preview`, the build of the port's code), at 1024
px and 375 px. The preview's slot (`ksgb:production:save`) held a new game
(4,488 bytes); it was backed up at `ksgb:production:save.before-step4C6-check`
and put back after, the backup key removed, every edit of the slot made
from a static file of the same origin (`/assets/*.css`). The save used:
John (seed 42) through floor 17, built by a scratch script on the branch,
stood at Kystel's Anvil with every floor 17 spot discovered, the
first-calm flag set and some hides added, `savedAt` an hour ahead (no
catch-up); served from the preview's folder for the check and deleted
after.

- Kystel's Anvil, Location panel, 1024 px: the spot's line ("The Ascent,
  The Malgeri Crossing"), the two jobs and the eight crafts with their
  costs, Wolf Cloak drawn disabled with "Requires: Leathercrafting 5".
  "Craft Leather Cap" started ("Cycle: 80%"); a few caps later Leathercrafting
  reached 5 and the Wolf Cloak showed its cost. The Sky card under a roof:
  "Now: still · feels freezing", "Prognosis: Malgeri Range", still rows.
  The ladder card: floor 17 "Cleared", "Clear: 1 keeper of The Hamlet Gates
  slain, done", "The ladder answers here. Floor 18: not in this build."
- The Anvil panel at Kystel's Anvil, 1024 px and 375 px: the anvil and its
  controls (Forge disabled, "Short of Hardwood: 0 held, 1 needed"), no
  horizontal scroll at 375 px, Forge 44 px high.
- Quests panel at the forge: Thora Ironbrand, her description, "Says: “Scrap
  in, steel out. That’s the whole philosophy.”" in its 58.5 px box; Talk
  sent the greeting and the control read "Met", disabled.
- Hamlet Square (walked from the forge): Captain Bren's lines rotated every
  30 s; with the flag set his lore line came round ("Says: “The mountain
  goes still for 8 hours in every 12 days. ...”"), three lines at 1024 px
  (550 px wide). At 375 px: the list 351 px wide, no horizontal scroll, the
  line box 325 px wide and 58.5 px high, the lore line four lines that
  scroll inside it; Talk 44 px high.
- The Mountain Path (open sky), 375 px: "Now: 💨 gale · feels cold",
  "Prognosis: Malgeri Range", rows of storm, gale and snow; the hunt drew
  the gale's line ("Uncommon Squall Slime (Lv 42) attacks!"); a knockout
  there sent the knockout return back to the path. Back at Kystel's Anvil
  at 375 px: every activity button inside its card (151 to 319 px of 351,
  44 and 59 px high).
- No console errors.

Not checked in a browser: a calm on the open slopes (the calm lines and
the first-calm line live; tested headless), the veiled bestiary entries
opening, the peak gate on the map, the dev server on 5600.

## 15. Port C7: the desert, floors 18 to 20 (done)

Done 2026-11-25 on branch `step4-C7`, from `main` at `68fdfc1`. Not merged,
not pushed. Commits:

1. `5e94827`, the port.
2. This account.

The outcome digests did not change (every digest of `npm run verify`
passed on the port's code), so there is no digest commit.

The full account: the "Step 4 port C7" sections of the `world`, `ladder`,
`npcs`, `shops` and `combat` READMEs.

What was ported:

- `world`: areas `ascent_f18_area` (The Necropolis Road: open sky, tag
  `heat`), `ascent_f19_area` (The Pyramid: open sky, scene `crypt`) and
  `ascent_f20_area` (The Delta Port: open sky), and their 23 spots (old
  `locations.data.ts` 4008-4393, text `locations.text.ts` 333-371), old
  records: floor 18 (10) the Well-Head, five obelisks (a haven each; the
  read is an explore of 180 ticks whose one find bumps `flag:chart`), the
  Dunes, the Salt Flat, the Tomb Row and the Forecourt (the sand colossus);
  floor 19 (8) the Causeway, the Valley Temples, the Side Tomb (Heat
  Resistance 10), the Entrance Passage, the Grand Gallery, the Burial
  Chamber, the Treasury (six grave goods, each bumping `flag:tomb:taken`,
  each refused once `boss:f19_door` is above 0) and the Door (the judge,
  `levelRise` on `flag:tomb:taken`, share 0.1, ceiling 45); floor 20 (5)
  the River Road, the Quay (the roadstead's forced road surprises the crew
  at `flag:chart` 3), the Warehouses, the Notice Wall and the Roadstead.
  200 spots, 32 areas.
- `ladder`: band 7 `ascent_desert` and floors 18 to 20 (old
  `towers.data.ts` 418-463; gates 60 and 150 desert kills; clears
  `boss:f18_forecourt`, `boss:f19_door`, `fights:f20_roadstead`; floor 20's
  `seam: { verb: 'Sailing' }`). 7 bands, 21 floors. Floor 20 is the top
  rung: its clear writes "Floor 21: not in this build." once per run.
- `npcs`: the broker `f20_broker` on the Quay (old `npcs.data.ts` 343-356),
  no shelf. `shops`: nothing to change; a sale pays the global price
  anywhere.
- `combat`: nothing to change. The judge is the first live line with
  `levelRise` (spine port 4 code); the seam verb is said by `ride` (spine
  port 6 code).
- No slice changes shape: no migration, no fixture. No kernel change.
- Spec, every old case accounted for:

| Old file | Cases | Here |
|---|---|---|
| `desert.test.ts` | 28 | 28 in `tests/desert.test.ts` under the old names. The four method-drop cases were ported in spine port 4 against copies of the two tables (`tests/loot.test.ts`, `tests/combatStatuses.test.ts`); here they run again on the live spots and monsters. The roadstead's surprise is read after the arrival tick with the player dazed: the arrival tick runs the fight, and the player's first blow, which a surprised formation hands the player, spends the front crew member's surprise (port C3: the first combat tick is the arrival tick). 2 new: the five obelisks' reads, the side tomb's door and finds. |
| `ladderEnd.test.ts` | 14 | 14 in `tests/ladderEnd.test.ts`. The old UI readers (`ladderEnd`, `towerSection(...).end`, `ladderBands`) are the ladder view's `endNotice` and rungs. The four absence cases: the old summary's `ladderEnd` line is the notice in the log after `catchUp`, once (as port C6's first-calm line); a recorder system keeps the notice lines, since ten minutes of fights push a line out of the log's 60. |
| `finds.test.ts` | 14 | Ported before (spine port 6, 14 of 14); it has no desert case. The desert's finds are in `tests/desert.test.ts`. |
| `openSky.test.ts`, the desert's part | | In `tests/exposure.test.ts`: floors 18 to 20 in the open areas, the roofed list (`f19` six spots, `f20_warehouses`), the spots judged open (`f18_tomb_row`, `f19_valley`, `f20_notice_wall`), the night spots of 18 to 20 in the three night cases; "weather changes over 120 days on floor 12 and on floor 18", which no earlier port carried (on the pure weather read: 238 kernels took over the parallel run's time limit); 1 new case for the three areas; the todo "floors 18 to 20" removed. The header chip case (`f19_chamber`, `f19_door`) stays the UI step's todo. |
| `knockoutReturn.test.ts`, the desert's cases | 3 | The real `f20_roadstead` joins the pocket waters (the two `it.each` cases); "a boss door is not sailed into again" runs on the real Door of floor 19 beside its pocket stand-in. |
| `john.test.ts` smoke case | 1 | Climbs to 20, as the old one; also asserts a try at each desert boss. |
| `malgeri.test.ts`, `malgeriSave.test.ts` | | The disclosure scan reads `f18_well_head` as the old one did; the first save case stands on floor 18's landing as the old one did. |

  New: `tests/desertPanels.test.ts` (6): the Location panel rendered on the
  server over a test kernel (the module `src/ui/game.svelte` replaced by
  `vi.mock`): the rungs of floors 18 to 20, their rides and gates, the end
  notice, the obelisk's read, the quay's forced road; and the broker in the
  people list with Talk. Unit project: 3,699 passed, 4 skipped, 119 todo
  (`main`: 3,644, 4, 120). The worldContent todo "waypoints exist for fast
  travel" keeps its todo with its reason corrected: old `main`'s live
  content has one waypoint; the old case passed with the shelved countryside
  mounted.

Old bugs and rules kept:

- The desert reads the Ascent's plains sky (no per-area climate pin, an old
  decision in `locations.data.ts`): the Necropolis Road "feels freezing"
  under an overcast sky.
- The side tomb opens at Heat Resistance 10, not the floor entry's 15 (old
  comment: it returns to 15 once the area has its own climate).
- After the judge's first kill the Treasury's search can still be chosen
  and runs its 36 seconds for nothing (a find whose conditions fail waits,
  old `pendingFinds`).
- Floor 20's seam verb "Sailing" is read only on a climb one rung up from
  floor 20; floor 21 does not exist, so no live climb says it.
- The old John walks past the obelisks unread, so the roadstead crew never
  starts surprised in his climb; ported as it is.
- The broker's old `shop.lines: []` is written as no `shop` (old comment:
  the content lint holds a shop to one line).

Changed while porting (no rule): the ladder end's absence cases read the log
after catch-up (no summary dialog in this build, the UI step); the Location
panel is rendered on the server in a test through a replaced module.

Noticed, older than this port:

- A fight-count term reads "1 wins at The Roadstead" (also "1 wins at The
  Hunting Lodge" on floor 8): the term words of port C1 do not make the
  singular.
- In the build the obelisk's find line did not appear in any panel (the
  Combat panel shows the fight feed); the log lines of finds, greetings and
  the ladder's end could not be read in the browser.
- `kernel.view()` costs about 4.2 to 4.4 ms per call on floors 18 to 20
  (15.2); port C6 measured 3.5 to 4.3 ms.
- The Character panel lists rows "❔ Unknown skill" under Combat for John at
  floor 20; not investigated.

### 15.1 John

`tests/john.ts` gains `floor18` to `floor20` (old `desertFloors[18]` to
`[20]`): floor 18, the road obelisk to obelisk (none read) to the
Forecourt, the guardian tried with the Dunes as the den; floor 19, its
gate's sixty desert kills hunted at the Dunes before the climb, then the
Entrance Passage, the Grand Gallery and the Burial Chamber to the Door
(nothing taken from the Treasury), the judge tried with the Gallery as the
den; floor 20, its gate's 150 at the Valley Temples, then the Quay and the
Roadstead's one fight, the River Road as the den. `npm run pacing --
--through 20 [--side navy]`. No wall on any seed or side, in either build.

Old John at `7c1267b` (`D:\ksgproto28`, nothing edited; its modules
imported read-only by a scratch script), `main` (`68fdfc1`, through 17)
and the branch (through 20), the same day, seeds 42, 7 and 1234. On every
seed and side the branch equals `main` through floor 17 (the same tick each
segment closed on, knockouts, boss tries, levels and kills), and `main`
equals port C6's recorded runs. The old whole climb (merchants) is section
3.3's: 4:42:50 / 4:52:51 / 4:35:37.

Merchants (the default):

| Segment | Old | Main | Branch | Old mean | Main mean | Branch mean | Branch vs main | Branch vs old | KO old | KO branch | Kills old | Kills branch | Boss tries/lost old | Boss tries/lost branch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| f1-6 again | 0:23:16 / 0:25:29 / 0:24:04 | 0:22:57 / 0:23:43 / 0:24:13 | 0:22:57 / 0:23:43 / 0:24:13 | 0:24:16 | 0:23:38 | 0:23:38 | +0.0% | -2.7% | 21/20/22 | 20/23/20 | 76/79/78 | 78/88/78 | | |
| f7 | 0:03:02 / 0:02:58 / 0:03:05 | 0:03:23 / 0:02:55 / 0:02:32 | 0:03:23 / 0:02:55 / 0:02:32 | 0:03:02 | 0:02:57 | 0:02:57 | +0.0% | -2.6% | 3/3/3 | 3/2/2 | 32/33/36 | 40/43/33 | | |
| f8 | 0:06:33 / 0:00:15 / 0:00:13 | 0:06:33 / 0:00:14 / 0:06:26 | 0:06:33 / 0:00:14 / 0:06:26 | 0:02:20 | 0:04:24 | 0:04:24 | +0.0% | +88.4% | 9/0/0 | 8/0/8 | 56/1/1 | 65/1/57 | 2/1, 1/0, 1/0 | 2/1, 1/0, 2/1 |
| f9 | 0:12:44 / 0:12:51 / 0:19:13 | 0:06:27 / 0:06:29 / 0:06:27 | 0:06:27 / 0:06:29 / 0:06:27 | 0:14:56 | 0:06:28 | 0:06:28 | +0.0% | -56.7% | 11/15/20 | 7/8/7 | 144/133/213 | 62/60/66 | 3/2, 3/2, 4/3 | 2/1, 2/1, 2/1 |
| f10 | 0:00:11 / 0:12:42 / 0:00:15 | 0:00:11 / 0:06:29 / 0:12:43 | 0:00:11 / 0:06:29 / 0:12:43 | 0:04:23 | 0:06:28 | 0:06:28 | +0.0% | +47.5% | 0/2/0 | 0/4/6 | 1/213/1 | 1/89/188 | 1/0, 3/2, 1/0 | 1/0, 2/1, 3/2 |
| f11 siege | 0:07:29 / 0:06:54 / 0:07:03 | 0:08:57 / 0:08:17 / 0:07:30 | 0:08:57 / 0:08:17 / 0:07:30 | 0:07:09 | 0:08:15 | 0:08:15 | +0.0% | +15.4% | 3/2/2 | 6/5/4 | 38/35/41 | 43/38/35 | 2/1, 2/1, 1/0 | 2/1, 2/1, 3/2 |
| f1-10 again | 0:46:42 / 0:39:36 / 0:46:00 | 0:42:24 / 0:46:37 / 1:00:01 | 0:42:24 / 0:46:37 / 1:00:01 | 0:44:06 | 0:49:41 | 0:49:41 | +0.0% | +12.7% | 47/36/35 | 41/40/54 | 304/256/366 | 233/350/525 | | |
| f11 | 0:12:18 / 0:07:24 / 0:07:00 | 0:04:36 / 0:06:23 / 0:04:59 | 0:04:36 / 0:06:23 / 0:04:59 | 0:08:54 | 0:05:19 | 0:05:19 | +0.0% | -40.3% | 6/4/3 | 5/2/2 | 179/99/96 | 48/97/74 | | |
| f12 | 0:30:00 / 0:36:00 / 0:30:00 | 0:30:00 / 0:24:00 / 0:24:00 | 0:30:00 / 0:24:00 / 0:24:00 | 0:32:00 | 0:26:00 | 0:26:00 | +0.0% | -18.8% | 8/10/7 | 9/7/5 | 559/662/555 | 533/429/454 | | |
| f13 | 1:30:00 / 1:42:00 / 1:30:00 | 1:30:00 / 1:48:00 / 1:48:00 | 1:30:00 / 1:48:00 / 1:48:00 | 1:34:00 | 1:42:00 | 1:42:00 | +0.0% | +8.5% | 6/9/12 | 8/10/11 | 2424/2743/2399 | 2486/2873/3038 | | |
| f14 | 0:00:13 / 0:00:14 / 0:00:12 | 0:00:14 / 0:00:13 / 0:00:13 | 0:00:14 / 0:00:13 / 0:00:13 | 0:00:13 | 0:00:13 | 0:00:13 | +0.0% | +3.1% | 0/0/0 | 0/0/0 | 2/2/2 | 3/2/2 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f15 | 0:00:21 / 0:00:25 / 0:00:23 | 0:00:22 / 0:00:22 / 0:00:22 | 0:00:22 / 0:00:22 / 0:00:22 | 0:00:23 | 0:00:22 | 0:00:22 | +0.0% | -4.2% | 0/0/0 | 0/0/0 | 9/9/9 | 9/9/9 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f16 | 0:03:45 / 0:03:05 / 0:04:25 | 0:03:25 / 0:03:09 / 0:03:56 | 0:03:25 / 0:03:09 / 0:03:56 | 0:03:45 | 0:03:30 | 0:03:30 | +0.0% | -6.6% | 0/0/0 | 0/0/0 | 15/9/11 | 8/10/7 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f17 | 0:14:13 / 0:14:19 / 0:14:17 | 0:07:49 / 0:27:12 / 0:14:13 | 0:07:49 / 0:27:12 / 0:14:13 | 0:14:16 | 0:16:25 | 0:16:25 | +0.0% | +15.0% | 14/14/10 | 6/22/11 | 205/208/222 | 108/445/223 | 4/2, 4/2, 4/2 | 3/1, 6/4, 4/2 |
| f18 | 0:00:16 / 0:00:17 / 0:00:16 | - | 0:00:17 / 0:00:16 / 0:00:16 | 0:00:16 | - | 0:00:16 | - | -0.4% | 0/0/0 | 0/0/0 | 1/1/1 | 1/1/1 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f19 | 0:02:00 / 0:02:13 / 0:01:54 | - | 0:02:18 / 0:02:02 / 0:01:57 | 0:02:02 | - | 0:02:06 | - | +3.0% | 0/0/0 | 0/0/0 | 60/60/60 | 60/60/60 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f20 | 0:03:06 / 0:03:17 / 0:03:06 | - | 0:03:20 / 0:03:07 / 0:03:14 | 0:03:10 | - | 0:03:14 | - | +2.1% | 0/0/0 | 0/0/0 | 92/92/92 | 92/92/92 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| Run 1 | 0:26:41 / 0:22:52 / 0:24:13 | 0:26:14 / 0:26:26 / 0:25:51 | 0:26:14 / 0:26:26 / 0:25:51 | 0:24:35 | 0:26:11 | 0:26:11 | +0.0% | +6.5% | | | | | | |
| Run 2 | 0:53:15 / 1:01:09 / 0:53:52 | 0:48:28 / 0:48:06 / 0:59:51 | 0:48:28 / 0:48:06 / 0:59:51 | 0:56:05 | 0:52:09 | 0:52:09 | +0.0% | -7.0% | | | | | | |
| Run 3 to f17 | 3:17:32 / 3:23:02 / 3:12:17 | 2:58:50 / 3:35:56 / 3:35:44 | 2:58:50 / 3:35:56 / 3:35:44 | 3:17:37 | 3:23:30 | 3:23:30 | +0.0% | +3.0% | | | | | | |
| Run 3 | 3:22:55 / 3:28:50 / 3:17:32 | - | 3:04:45 / 3:41:22 / 3:41:11 | 3:23:05 | - | 3:29:06 | - | +3.0% | | | | | | |
| Whole climb | 4:42:50 / 4:52:51 / 4:35:37 | - | 4:19:28 / 4:55:54 / 5:06:54 | 4:43:46 | - | 4:47:25 | - | +1.3% | | | | | | |

Level at the floor 20 clear: old 46/46/46, branch 45/47/46. Fights in the
climb: old 2940/3187/2913, branch 2675/3204/3384.

`--side navy` (runs 1 and 2 and `f1-10 again` are the merchants' rows):

| Segment | Old | Main | Branch | Old mean | Main mean | Branch mean | Branch vs main | Branch vs old | KO old | KO branch | Kills old | Kills branch | Boss tries/lost old | Boss tries/lost branch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| f11 | 0:06:18 / 0:07:24 / 0:07:00 | 0:16:36 / 0:06:23 / 0:04:59 | 0:16:36 / 0:06:23 / 0:04:59 | 0:06:54 | 0:09:19 | 0:09:19 | +0.0% | +35.0% | 3/6/6 | 13/5/3 | 87/81/84 | 221/76/70 | | |
| f12 | 0:30:00 / 0:30:00 / 0:30:00 | 0:30:00 / 0:30:00 / 0:30:00 | 0:30:00 / 0:30:00 / 0:30:00 | 0:30:00 | 0:30:00 | 0:30:00 | +0.0% | +0.0% | 13/16/12 | 7/14/9 | 517/506/528 | 560/516/563 | | |
| f13 | 1:36:00 / 1:30:00 / 1:36:00 | 1:42:00 / 1:42:00 / 1:30:00 | 1:42:00 / 1:42:00 / 1:30:00 | 1:34:00 | 1:38:00 | 1:38:00 | +0.0% | +4.3% | 14/15/11 | 14/16/9 | 2497/2271/2612 | 2831/2661/2459 | | |
| f14 | 0:00:15 / 0:00:13 / 0:00:13 | 0:00:13 / 0:00:13 / 0:00:13 | 0:00:13 / 0:00:13 / 0:00:13 | 0:00:13 | 0:00:13 | 0:00:13 | +0.0% | -2.2% | 0/0/0 | 0/0/0 | 3/3/2 | 3/3/2 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f15 | 0:00:23 / 0:00:23 / 0:00:22 | 0:00:23 / 0:00:22 / 0:00:25 | 0:00:23 / 0:00:22 / 0:00:25 | 0:00:22 | 0:00:24 | 0:00:24 | +0.0% | +4.9% | 0/0/0 | 0/0/0 | 9/9/9 | 9/9/9 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f16 | 0:03:03 / 0:04:32 / 1:17:11 | 0:02:59 / 0:03:22 / 0:04:16 | 0:02:59 / 0:03:22 / 0:04:16 | 0:28:15 | 0:03:32 | 0:03:32 | +0.0% | -87.5% | 0/0/1 | 0/0/0 | 7/13/22 | 9/10/9 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f17 | 0:14:20 / 0:14:13 / 0:14:09 | 0:33:47 / 0:14:01 / 0:27:10 | 0:33:47 / 0:14:01 / 0:27:10 | 0:14:14 | 0:24:59 | 0:24:59 | +0.0% | +75.6% | 12/13/12 | 30/13/21 | 215/210/216 | 559/217/459 | 4/2, 4/2, 4/2 | 7/5, 4/2, 6/4 |
| f18 | 0:00:16 / 0:00:17 / 0:00:17 | - | 0:00:16 / 0:00:16 / 0:00:16 | 0:00:17 | - | 0:00:16 | - | -2.8% | 0/0/0 | 0/0/0 | 1/1/1 | 1/1/1 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f19 | 0:01:59 / 0:02:12 / 0:02:05 | - | 0:02:05 / 0:02:10 / 0:02:07 | 0:02:05 | - | 0:02:07 | - | +1.2% | 0/0/0 | 0/0/0 | 60/60/60 | 60/60/60 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| f20 | 0:03:21 / 0:03:10 / 0:03:07 | - | 0:03:18 / 0:03:22 / 0:03:06 | 0:03:13 | - | 0:03:15 | - | +1.2% | 0/0/0 | 0/0/0 | 92/92/92 | 92/92/92 | 1/0, 1/0, 1/0 | 1/0, 1/0, 1/0 |
| Run 3 to f17 | 3:17:00 / 3:06:20 / 4:30:55 | 3:48:21 / 3:22:58 / 3:37:04 | 3:48:21 / 3:22:58 / 3:37:04 | 3:38:05 | 3:36:08 | 3:36:08 | +0.0% | -0.9% | | | | | | |
| Run 3 | 3:22:37 / 3:11:59 / 4:36:23 | - | 3:53:59 / 3:28:46 / 3:42:33 | 3:43:40 | - | 3:41:46 | - | -0.8% | | | | | | |
| Whole climb | 4:42:33 / 4:36:01 / 5:54:28 | - | 5:08:42 / 4:43:19 / 5:08:15 | 5:04:20 | - | 5:00:05 | - | -1.4% | | | | | | |

Level at the floor 20 clear: old 46/46/46, branch 48/46/47. Fights in the
climb: old 2882/2809/2997, branch 3306/2998/3229.

The desert: every desert boss was won at the first try on every seed and
side in both builds (the forecourt guardian at level 41, the judge at 33
with nothing taken, the roadstead's three crew at 45); the kills of floors
19 and 20 (60 and 92 on every seed, side and build) are the gate hunts and
the boss; floors 18 to 20 are within 3% of the old means on both sides.

Against section 3.4, on the means over the three seeds, against the old
build (`.scratch-c7/tables.mjs`):

- Every run total is within 15%: run 1 +6.5%, run 2 -7.0%, run 3 +3.0%
  merchants and -0.8% navy, the whole climb +1.3% and -1.4%.
- Segments over two minutes of old mean outside 35%, each equal on `main`
  (the seven rows the brief listed; nothing new with this port):

| Segment | Side | Old mean | Branch mean | Change | Kind | Cause |
|---|---|---|---|---|---|---|
| f8 | both | 0:02:20 | 0:04:24 | +88.4% | keeper, reported | Chance over a few keeper tries |
| f9 | both | 0:14:56 | 0:06:28 | -56.7% | keeper, reported | Chance over a few keeper tries |
| f10 | both | 0:04:23 | 0:06:28 | +47.5% | keeper, reported | Chance over a few keeper tries |
| f11 | merchants | 0:08:54 | 0:05:19 | -40.3% | schedule-bound | Chance at the water: old seed 42 lost the legs of its first convoy |
| f11 | navy | 0:06:54 | 0:09:19 | +35.0% | schedule-bound | Chance at the water: 13 knockouts on seed 42 |
| f16 | navy | 0:28:15 | 0:03:32 | -87.5% | boss, reported | Chance: old seed 1234 loses a royale and waits out the lockout |
| f17 | navy | 0:14:14 | 0:24:59 | +75.6% | boss, reported | Chance over a few boss tries (port C6) |

- Floors 12 and 13 per seed against one convoy (6 minutes): merchants f12
  0 / -12 / -6 and f13 0 / +6 / +18 minutes; navy f12 0 / 0 / 0 and f13
  +6 / +12 / -6. Outside one convoy: merchants f12 seed 7, merchants f13
  seed 1234, navy f13 seed 7 (all equal on `main`, section 13).

How each cause was found. No rule difference was found; none of the
candidate causes but chance applies (any-order floors: the wards run 7, 8,
9, 10 in both builds; segment boundaries: both drivers close a segment on
the floor's clear; passive XP: it moved the streams in port W, which is why
these seeds land where they do, not the odds):

- Floors 8 to 10. A lost keeper try costs a 6-minute grind at the den, so
  a seed's time is a multiple of about 6:30. Tries lost, old against
  branch: f8 1, 0, 0 and 1, 0, 1; f9 2, 2, 3 and 1, 1, 1; f10 0, 2, 0 and
  0, 1, 2. John at the doors of floors 8 and 9 is within one level in the
  two builds (floor 9: old 12/11/11, branch 13/11/12); at floor 10's he is
  two to four levels lower in the branch (old 19/18/21, branch 16/16/17:
  the old seeds lost more at floor 9 and hunted its den longer).
  The keepers duelled by a fixed character at the same level, the same
  counters (the band position and step) and the same sky, in both builds
  (`.scratch-c7/duel-*.ts`, `.scratch-c7/duels.txt`): the young beast
  (L16) won 114 of 200 old, 103 of 200 branch, 121 and 118 ticks a fight;
  the death knight (L18) 28 and 26 of 60 at attributes 26, 43 and 42 of 60
  at 30; the ore eater stage 4 (L23) 20 and 26 of 60. Each pair is within
  its sampling error: the same odds, about even, met a few times per seed.
- Floor 11. One convoy (8 crates) and a won fight at the roadstead clear
  it; crates are lost on the legs John misses while knocked out or walking
  back. Merchants: the old seed 42 was knocked out 6 times and needed a
  second convoy (12:18); the branch needs one on every seed (per seed
  -7:42, -1:01, -2:01). Navy: the branch's seed 42 was knocked out 13
  times (16:36 against 6:18). Checked on that seed: John at the door is
  level 18 in both builds and every derived stat (67) is within 5% of the
  other build's but the gold gain and two small resistances; the roadstead
  duelled from John's own door state, the same sky, 300 tries each: old 299
  won, 35 ticks a fight (one foe 26.9, two foes 55.1), branch 300 won, 35
  ticks (27.3, 53.4); a fixed character: 144 and 147 of 150 from full
  health, 55 and 66 of 150 from a fifth. Knockouts on floor 11 over all six
  climbs: old 28, branch 30. (Runs of 60 to 100 tries first read 31 against
  36 ticks; at 300 the two read alike: a pair of foes takes twice as long
  as one, so group size dominates a small sample.)
- Floors 12 and 13. The same schedule: 15 convoys bring floor 13's 120
  crates in 1:30 when no leg is lost. Knockouts on floor 13 are alike in
  total (merchants old 27, branch 29; navy 40 and 39); what moves a seed by
  a convoy is when they land against the legs. The blockade duelled from
  John's own floor 13 door state (seed 1234, merchants), the same sky, 300
  tries each: old and branch 27 ticks a fight with techniques (one foe 17.9
  and 17.9, two 32.1 and 32.9), 23 without; 300 and 300 won. Port C3's open
  question on the blockade's fights (13.4 to 13.8 against 12.1 to 12.6
  kills per leg then)
  does not show in John's door state now.
- Floor 16, navy: section 13. The old seed 1234 loses its first royale
  (a field fight) and waits out the 72-minute lockout; the branch wins its
  first. Each build draws the field's seed from its own generator.
- Floor 17, navy: section 14.1 (the regent's duels equal; 5, 2 and 4 gate
  tries lost against 2 each).

### 15.2 Live play on floors 18 to 20

Both builds in one process (the old modules imported read-only),
alternating rounds, seed 42: each build's John to the floor 17 close, stood
at the spot hunting, the new build's clock and weather seed set to the old
build's (the same sky: overcast at the open spots), 100 ticks of warm-up,
then each round loads that state and runs 3,000 ticks. 10 rounds per spot.
Machine load 9 to 14% at the starts. Microseconds per tick (minimum /
median) and kills in the first round:

| Per tick | Old `game.tick()` | New `kernel.tick()` | New `kernel.tick()` + `kernel.view()` | Kills old / new |
|---|---|---|---|---|
| The Dunes (floor 18, open sky, hunt) | 106 / 114 | 39 / 42 | 4,150 / 4,210 | 161 / 168 |
| The Grand Gallery (floor 19, roofed) | 69 / 78 | 35 / 37 | 4,071 / 4,276 | 95 / 140 |
| The River Road (floor 20, open sky) | 105 / 118 | 40 / 44 | 4,099 / 4,384 | 154 / 140 |

- The new tick is 0.37, 0.47 and 0.37 of the old one on floors 18 to 20.
- The Gallery's kill count differs in that round; a fixed character there
  fights alike in both builds (200 tries: 13 and 12 ticks a fight, the same
  mix of mummies and scorpions), so the count is John's state in that
  window. The new tick is cheaper with more kills.
- The view is `kernel.view()` as a whole (docs/PERFORMANCE.md section 3.4,
  older than this port): 4.2 to 4.4 ms a call here.
- What the port adds per tick: nothing. No tick hook and no read of another
  slice; the content grows by 23 spots and 3 floors that the per-kill clear
  check and the views walk.

### 15.3 Offline budgets and the speed project

Against `main` (`68fdfc1`, the worktree `D:\ksgproto28-b-main`), both
builds' modules in one process, alternating rounds (the scripts of 12.3).
Another agent application ran a test loop of a different project for much
of this time (a `node tests/model.test.mjs` loop, about 1.4 processor
cores); machine load is given for each batch. Wall time (minimum / median),
the wall difference of the medians, and processor time of the process,
the median of the per-round differences.

| Run of 8 hours | Rounds | Load | `main` wall | Branch wall | Wall median | Processor, paired |
|---|---|---|---|---|---|---|
| No fight, no condition | 15 | 20 to 25% | 1,794 / 1,873 | 1,794 / 1,848 | -25 (-1.3%) | +15 (+0.8%) |
| A poison held | 15 | 20 to 25% | 4,460 / 4,898 | 4,424 / 4,902 | +4 (+0.1%) | -62 (-1.0%) |
| Floor 1 table sent to combat | 3 | 17 to 60% | 6,035 / 6,208 | 5,872 / 6,224 | +16 (+0.3%) | +124 (+1.7%) |
| Floor 6 Tunnels sent to combat | 3 | 17 to 60% | 10,331 / 10,433 | 10,231 / 10,360 | -73 (-0.7%) | -282 (-2.3%) |
| World: hunt, floor 4 Woods Edge | 3 | 17 to 60% | 10,612 / 10,755 | 10,446 / 10,636 | -119 (-1.1%) | -234 (-2.0%) |
| World: hunt, floor 6 Tunnels | 3 | 17 to 60% | 10,392 / 12,190 | 9,808 / 11,755 | -435 (-3.6%) | -421 (-3.2%) |
| World: the roadstead | 3 | 17 to 60% | 9,876 / 10,575 | 9,647 / 10,530 | -45 (-0.4%) | -360 (-3.1%) |

The speed project's four states (built by John in each build, then 8 hours
of catch-up asking the holds) and the idle run, two processes of 3 rounds
(load 52% falling to 16%, then 19 to 23%); wall and processor both paired:

| State | `main` wall | Branch wall | Wall, paired | Processor, paired | Second process alone, wall per round |
|---|---|---|---|---|---|
| Floor 1 hunting | 6,567 / 7,818 | 6,276 / 7,874 | -34 (-0.4%) | -141 (-1.7%) | -364, +59, -291 |
| Floor 6 hunting | 12,590 / 15,303 | 12,689 / 13,869 | -1,007 (-6.6%) | -1,063 (-6.2%) | -1,007, -427, +169 |
| Idle in town | 2,217 / 2,352 | 2,185 / 2,306 | +10 (+0.4%) | +32 (+1.3%) | -32, +10, +43 |
| Floor 7 hunting | 8,238 / 9,208 | 8,328 / 10,097 | +405 (+4.4%) | +686 (+6.7%) | +405, -198, -2 |
| Idle (budget run), 18 | 1,955 / 2,155 | 1,933 / 2,105 | -34 (-1.6%) | -30 (-1.3%) | |

No state of the speed project or budget run stands on floors 18 to 20, and
the port adds no per-tick work; the readings scatter both ways under the
outside load (floor 6 -6.6%, floor 7 +4.4%, the second process's rounds
-1,007 to +405 ms).

`npm run verify` on the port's code, exit 0 (machine load 12% at the
start): svelte-check 0 errors; unit 3,699 passed, 4 skipped, 119 todo;
budget 4 (idle 1,933 ms of 2,420, poison 5,034 of 8,250, floor 1 5,595 of
7,700, floor 6 9,455 of 14,850); budget-world 3 (floor 4 9,439, floor 6
9,393, the roadstead 8,642, each of 14,300); speed (floor 1 58%, floor 6
76%, town 65%, floor 7 56% of the limit; machine load 15 to 24%; yardstick
203 to 232 ms; kills 10,631, 11,622, 0 and 12,979, within 10% of the old
build's); john 14; build. Every outcome digest equal to the recorded ones.

### 15.4 Browser check

Port 5600 was held by another agent application's dev server (a different
checkout, `D:\ksgproto28-ui-gemini`, "Frontier Idle") for the whole
session, so the check ran on the build preview, port 5601 (`ksgb-preview`,
the build of the port's code), at 1024 px and 375 px. The preview's slot
(`ksgb:production:save`) held a new game (4,487 bytes); it was backed up at
`ksgb:production:save.before-step4C7-check` and put back after, the backup
key removed, every edit of the slot made from a static file of the same
origin. The save used: John (seed 42) through floor 20, stood on the Quay
with every desert spot discovered, five bronze ingots added, `savedAt` an
hour ahead (no catch-up); served from the preview's folder for the check
and deleted after.

- The Quay, Location panel, 1024 px: the spot line ("The Ascent, The Delta
  Port"), Rest at the Quay, the Sky card (overcast, the Ascent's
  prognosis), the map's three desert areas, and the ladder card: "The
  ladder answers here. Floor 21: not in this build.", floors 18 to 20
  cleared, "Gate: 60 desert kills (60 of 60), met", "Gate: 150 desert
  kills (150 of 150), met", their clears and rides.
- Quests panel at the Quay: The Broker, his description and "Says: “The
  port house licenses the digs and buys what comes out of them. It sells
  nothing back.”"; Talk sent the greeting and the control read "Met",
  disabled.
- Inventory panel at the Quay: the bronze ingots' "Sell all: 90 g" paid 90
  gold (2,557,127 to 2,557,217): the global price at the broker's quay.
- Ride to floor 18: the Well-Head (its text, the rest, the Sky card); the
  First Obelisk picked on the map ("Route: 3 s at base speed, 1 leg", Go,
  Rest in the Shade, Read the Obelisk); Go and Read the Obelisk walked and
  explored it to 100% in about 18 seconds; the slot afterwards held
  `flag:chart` 1 and the find `f18_read_first`.
- 375 px: the obelisk's activities 182 and 179 px wide, 44 px high; the
  ladder card 351 px wide, each ride 144 × 44; no horizontal scroll.
- Ride to floor 19 (the Causeway); the Treasury's card ("Once the judge has
  fallen, nothing more can be taken this run") and the Door's; Go and
  Search the Treasury explored it to 100%: nothing taken (`flag:tomb:taken`
  0, no find), as the seal says after John's kill of the judge.
- Ride to floor 20, Go to the Quay; the Roadstead's card (cleared, so no
  forced-fight line); the Quests panel at 375 px: the people list 351 px
  wide, the line box 325 × 59 px, "Met" 44 px high, no horizontal scroll.
- No console errors.

Not checked in a browser: an obelisk read at the third bearing and the
roadstead's surprised crew live (tested headless), the judge's level rise
live, the seam verb (no floor 21), the dev server on 5600.

### 15.5 Step 4 status

Step 4 is done but for port F (conditional, section 5.10). The ports L,
C1 to C7 and W brought bands 3 to 7 (floors 7 to 20), the stronghold and
its automatic prestige, the hold and bonus time, the harbor and the sea,
the festival and the royale, Weathersense and Chronosense, the Malgeri
Crossing and the desert. A new save plays floor 0 to floor 20 in three runs
by commands only (`tests/john.ts`), with no wall on any seed or side.

Parity with the old build (section 3.4, this section's tables):

- Holds: every run total within 15% of the old mean on both sides (run 1
  +6.5%; run 2 -7.0%; run 3 +3.0% merchants, -0.8% navy; the whole climb
  +1.3% and -1.4%); every long segment that is not a keeper or boss row
  within 35% but floor 11; the desert within 3%.
- Does not hold, and why: the keeper floors 8 to 10, floor 11 (both
  sides), floors 12 and 13 on three seed-floor pairs, and the navy rows of
  floors 16 and 17 are outside the tolerance. Each is chance met a few
  times per seed: keeper and boss fights at about even odds (duels equal in
  both builds), and the convoy legs lost to knockouts (fights equal in both
  builds from John's own door state). No rule difference was found. The
  builds draw different streams: the old prestige reseeded the generator
  (the kernel's runs on), and each build draws its own weather seed and its
  own royale field seed, so the same seed meets different skies and
  different fights after run 1.

What port F inherits: Shadow Clone, the statue rules, the hold of play for
a Facet evolution (section 5.10; the 4 Facet todos).

What the UI step inherits, from step 4: the offline summary dialog (the
first-calm and ladder-end lines are in the log), a log a production build
shows, the map's road terms and level badge, the header weather chip, the
double speed control of bonus time, the Combat panel's dev encounter picker
(ships in production), the singular of fight-count terms. Of the unit
project's 119 `it.todo` cases, 40 are tagged for the UI step, 29 test an
old save migration (no importer, docs/REBUILD.md section 1), 4 wait on
port F.

Open findings: none that changes a rule. The gold John earns in run 1 is
still under the old build's (docs/SPINE.md section 9.1, not traced).
