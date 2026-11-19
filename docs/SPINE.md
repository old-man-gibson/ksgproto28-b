# Spine

Step 2 of `docs/REBUILD.md`. The spine is the smallest set of systems and
content that lets a new character play from the start to the first prestige.

Surveyed on old `main` (`D:\ksgproto28`) at `7c1267b`, 2026-11-17.

## 1. Extent

- First prestige opens on the kill of `goblin_warchief` at `f6_great_hall`
  (old `src/core/data/prestige.data.ts:25`).
- A first run passes floor 0, the town Threshold, and floors 1 to 6.
- Correction: `docs/REBUILD.md` first said floors 1 to 3. Floor 6 is correct.

Content in the stretch (approximate counts):

| Registry | Count | Old file |
|---|---|---|
| Areas | 7, plus Threshold | `data/locations.data.ts` |
| Spots | 53, plus 9 job spots | `data/locations.data.ts` |
| Monsters | 24 of 131 | `data/monsters.data.ts` |
| Gear | 10 drops, 5 rack items, 1 starting item | `data/items.data.ts` |
| Materials | 9 | `data/materials.data.ts` |
| Statuses inflicted by monsters | 4 (punctured, bleeding, concussed, wet) | `data/statuses.data.ts` |
| Monster techniques | 6 | martial data |
| Monster spell sentences | 2 (`goblin_firetongue`) | monster data |
| Monster divine workings | 3 (`goblin_witch_doctor`: `mud_poultice` with 2 uses, `vermin_swarm`, `cinder_curse`) | monster data, `MIRACLES` |
| Quests | 3 | `data/quests.data.ts` |

The monster count was first written as 146. The old `MONSTERS` table has 131
records. `data/monsters.data.ts` holds 146 lines with an `id:` field: the 131
monsters, 7 tiers, 4 modifier tiers and 4 rarities. Counted in port 5; no
record was dropped.

## 2. Parity target

John is the old headless climb driver (`tests/john.ts`, `tests/john.test.ts`,
`npm run pacing`). He plays floors 0 to 6 with the tutorial skipped, a rusty
sword, no spell. He hunts, searches, and works a Threshold job when a gate
wants gold.

The spine is finished when a port of John, built on `runHeadless`, reaches
the first prestige here, and his game time per floor is within a tolerance of
the old build. The tolerance is set in port 7.

## 3. Kernel gaps the spine hits

- **Stats per entity.** The kernel has one stat table. Monsters need stats by
  the same formula as the player (the monster-side parity law). Port 1 extends
  the kernel and records the change in `docs/KERNEL.md`.
- **Cycles.** The old import graph has a 16-file cycle around attributes,
  derived, skills, levels and equipment, and a 6-file cycle around combat,
  locations, actions and towers. Here a system reads another with `ctx.read`
  and changes another only through events and commands.
- **Counters and conditions.** Floor gates, clears, quests and prestige all
  read counters such as `slain:f6_great_hall:goblin_warchief`,
  `kills:tag:goblin` and `gold:earned` through one condition language. That
  is a leaf system and comes first.

## 4. Port order

One session per port, one at a time. Each port follows section 5 of
`docs/REBUILD.md`.

| Port | Systems | Old files (under `src/core/systems/`) |
|---|---|---|
| 1 | Counters and conditions, log, clock, character: attributes, skills, levels, resources, derived stats; entity stats in the kernel | counter half of `achievements`, `conditions`, `log`, `clock`, `progression`, `attributes`, `skills`, `levels`, `resources`, `stamina`, `health`, `derived` |
| 2 | Statuses | `statuses`, `conditionHarm` |
| 3 | Items: inventory, equipment, wield, materials, gold, drop tables | `inventory`, `equipment`, `wield`, `stash`, drop code in `combat.ts:1586-1700` |
| 4 | Combat core: spawn, rotation, player attack, enemy attack, dodge, parry, typed damage, kill and defeat events, the fight ledger | `combat.ts`, `monsterStats`, `huntrest`, `ledger` |
| 5 | Monster techniques (6), monster spell casts (2 sentences), monster divine workings (3); the part of the martial, arcane and divine engines that executes an action in a fight, for both sides | `combat.ts:2095-2845` and `3106-3520`, the execution half of `martial`, `arcane`, `spellcraft`, `divine`, `deities`, `triggers` |
| 6 | World: areas, spots, activities, travel and map, ladder gates, Threshold jobs, weather and exposure, knockout return | `locations`, `actions`, `mapped`, `towers`, `ladder`, `weather`, `exposure`, `knockoutReturn`, `safety` |
| 7 | Quests, shops, floor 0, prestige; John port and parity run; offline budget | `quests`, `shops`, `tutorial`, `prestige`, `legacy` |

Not in the spine, because a first run cannot reach them: psionics and
floating weapons, counterspells, Facet abilities, music, runecarving,
mutagens, wards, festival, sea. Rune items drop but pay nothing; they port as
inert items.

## 5. Defaults taken

Each can be reversed by the user. None changes a rule; each moves a piece to
the port of the system it needs.

1. **Threshold system NPCs.** The smith, chef, alchemist, priest, wizard and
   the other system NPCs arrive with their systems in step 3. The spine has
   the warden, the job spots and the shops that sell materials.
2. **Quests.** The spine ports `the_first_ascent`. `faces_of_threshold` and
   `a_taste_of_everything` need the system NPCs and arrive in step 3.
3. **Floor 0.** The spine ports the cell, the weapon rack and the slime
   fight. The stance step arrives with martial; the spell step with arcane.
4. **Hall tutor (floor 2).** Teaches player techniques. Arrives with martial.
5. **Content records.** A registry is ported whole when no field points at an
   unported registry. Otherwise only the records the stretch uses are ported,
   and the rest is listed in section 6.

## 6. Port log

Each port adds rows here: old file, new system folder, tests ported, content
left behind.

| Port | Old file | New system | Tests ported | Left behind |
|---|---|---|---|---|
| 1 | `systems/achievements.ts` (counters only: `bumpStat`, `raiseStat`, `setStat`) | `counters` | `tests/counters.test.ts` (new: the old build had no counter test) | Achievement tiers; the bumps on kill, arrival and defeat |
| 1 | `systems/conditions.ts` | `counters` (`conditions.ts`) | Condition cases of old `attributes.test.ts` and `superattrs.test.ts`, in `counters.test.ts` | Nothing: all seven kinds. `quest` and `boon` read facts the later ports state (`equippedTag`: filled by port 3) |
| 1 | `systems/ledger.ts` | Not ported. It is the fight ledger, not the counters | Transcript cases of old `ledger.test.ts`, in `log.test.ts` | The whole file, to port 4 |
| 1 | `systems/log.ts`, `text/log.ts` | `log` | `log.test.ts`: rendering, grouping, feed, floating runs, hunt lines, templates | Log is stored during catch-up; cases that need statuses, activities or combat; `logtext.test.ts` call-site scan; the other templates of `text/log.text.ts` |
| 1 | `systems/clock.ts`, calendar part of `data/climate.data.ts` | `clock` | `clock.test.ts`, whole | Weather and climate tables; the starting spot assertion |
| 1 | `systems/progression.ts`, `data/progression.data.ts` | `progression` | Curve cases of old `skills.test.ts`, in `skills.test.ts` | Nothing |
| 1 | `systems/derived.ts` | `stats` (pipeline, breakdowns); cache and fingerprint replaced by the kernel | `derivedcache.test.ts`, `attributes.test.ts` (old `attackspeed.test.ts`, stat cases of old `breakdown.test.ts`) | Every modifier source of an unported system (list in `src/systems/stats/README.md`; equipment filled by port 3); cache cases on forged items and the festival bonus; damage breakdowns |
| 1 | `systems/attributes.ts`, `data/attributes.data.ts` | `attributes` (training), `stats` (effective attributes, modifier foundations) | `attributes.test.ts` | Practice shaping; the XP router (`equip`, `unequip`, `canEquip`: port 3, from old `equipment.ts`) |
| 1 | `systems/skills.ts`, `data/skills.data.ts` | `skills` | `skills.test.ts` | Kills spraying XP; the bestiary payout; speechcraft through quests; switching style by command; practice shaping |
| 1 | `systems/levels.ts`, `data/levels.data.ts` | `levels` | `levels.test.ts`, with `encounterLevel` from old `desert.test.ts` and `rewardLevel` from old `dynamicLevels.test.ts` | `dynamicLevelBonus`, `checkFloorClears`, `syncBandPositions`; what pays level XP; Head Start; the old save migration |
| 1 | `systems/resources.ts`, `systems/stamina.ts`, `systems/health.ts`, `data/resources.data.ts`, `checkResourceLocks` of `game.ts` | `resources` | `resources.test.ts` (old `regen.test.ts`, `stamina.test.ts`) | Pace per activity and `combatRegenMult`; the condition and ledger observers of heal and damage; exertion in a fight; upkeep per swing |
| 2 | `systems/statuses.ts` | `statuses` (`engine.ts`, `index.ts`) | `statuses.test.ts`: 111 of the old 127 cases, under the old names | 16 cases as `it.todo`: the knockout and `recovering` (6, port 6); the enemy action bar, `combatEnd` from a real fight, `enemyTookDamage`, `MonsterDef.wears`, a real fight, the fight ledger (7, port 4); species and tag resistances (2, port 4); the fast (1, mutagens) |
| 2 | `tickPlayerStatuses` of `systems/actions.ts` | `statuses` (the tick in `index.ts`) | `statusSystem.test.ts` (new: tick, events, pool hooks, entities, view, save) | The knockout branch; the fight ledger's attribution |
| 2 | `systems/conditionHarm.ts` | `statuses` (`harm.ts`) | `conditionResist.test.ts`: the unresistable cases, the `resistanceProblems` lint, `resistBlock` | 9 cases as `it.todo`: food and the Scorched Mess (cooking, consumables), forced healing and monster slices (port 4). The Iron Stomach and monster penetration blocks are tests of titles and of `monsterStats` and are not listed |
| 2 | `data/statuses.data.ts`, `text/statuses.text.ts` | `statuses` (`content/statuses.json`) | `content.test.ts` validates it | Nothing: all 80 records. `forceStyle`, `displaces.to` and `art` are strings until their registries exist (`damp.slot`: an enum of the slots since port 3) |
| 2 | Cases port 1 left behind | `statuses` | `derivedcache.test.ts`: a condition and its decay, a cooked status, "a decaying condition and the cache" (6 cases) | The gale on the open ridge (weather) |
| 3 | `gold` field of `GameState`, the `gold:earned` bumps | `gold` | In `loot.test.ts` (a gold row) | Every earning and spending site but drops: ports 6 and 7 |
| 3 | `data/materials.data.ts`, `data/quality.data.ts`, graded stock of `systems/disciplines.ts`, discard half of the stackables in `systems/equipment.ts` | `materials` | `materials.test.ts`: the stackable cases of old `inventory-actions.test.ts`, plus new cases for the stock and the grade roll | 8 cases as `it.todo`: every sale (3, port 7), the carved rune cases (5, runecarving). Bench slots, consumable use, gathering. `consumable.teaches`, `unlocksWord`, `teachesTechnique` are strings until their registries exist |
| 3 | `engine/mercy.ts`, `mercy` field of `GameState` | `mercy` (`engine.ts`, `index.ts`) | `mercy.test.ts`: old `mercy.test.ts` whole, plus cases for the requests | 1 case as `it.todo`: the migration from save version 45. `proc:crit` rolls: port 4 |
| 3 | `systems/equipment.ts` (equip, unequip, `canEquip`, `wearIfFree`, `itemValue`, `itemName`, `nextUid`), `systems/wield.ts`, `systems/inventory.ts`, item half of `systems/stash.ts`, `createItem`, `grantRune`, `findItem`, `resolveRune` and the slot roll of `systems/runes.ts`, the equipment loop and `equippedTags` of `systems/attributes.ts`, size penalties of `systems/derived.ts`, `compareToWorn` of `ui/lib/gearCompare.ts` | `items` (`defs.ts`, `wield.ts`, `runeslots.ts`, `inventory.ts`, `compare.ts`, `format.ts`, `index.ts`) | `inventory.test.ts` (old `inventory.test.ts` whole, categories and rarity of `inventory-actions.test.ts`, the stack key cases of `gearcompare.test.ts`); `wield.test.ts` (old `wield.test.ts`, "the slot model" and "weapon and armour size" of `incoming.test.ts`, "grips the mind holds" of `mutagens.test.ts`); `items.test.ts` (equipment cases of old `attributes.test.ts`, `compareToWorn` of `gearcompare.test.ts`, stash items of `festival.test.ts`, item cases of `content.test.ts` and `icons.test.ts`) | 11 cases as `it.todo`: a fight (3, port 4), combat styles (2), a gene tier (1, mutagens), spare marks (2, port 7), forged items (1, smithing), stash tokens (2, festival). Selling, spare marks, loadouts, festival tokens, forged class stubs, carved runes, socketing. Plug points: `src/systems/items/README.md` |
| 3 | `data/items.data.ts`, catalogue of `data/runes.data.ts` | `items` (`content/items.json`, `affixes.json`, `runes.json`) | `content.test.ts` validates them; content cases in `items.test.ts` | The 46 `forged:<class>` stubs (generated from item classes); rune patterns, adornments, named runes. `techniqueMods` targets of a rune are strings until the martial registries exist |
| 3 | `DropEntry`, `DropTable`, `dropKey`, `dropRowsFor`, `rollDropTable` of `systems/combat.ts` (1586 to 1700); drop-table checks of `tests/content.test.ts` | `loot` | `loot.test.ts`: the method-drop cases of old `desert.test.ts` with its two tables written in the test, plus new cases calling the request | 1 case as `it.todo` (a kill by a condition sets `lastHit`, port 4). The call on a kill; the tables inside monster and location data; `RARITIES` and `MODIFIER_TIERS` |
| 3 | Cases ports 1 and 2 left behind | `items` | `skills.test.ts`, `counters.test.ts`, `derivedcache.test.ts`, `attributes.test.ts`: a worn weapon is a real item where the old test equipped one; the cache sweep grants, equips, unequips and changes the body; "weapon-family bonuses only apply while that weapon is held" of old `content.test.ts` | The forged-piece cache case (smithing) |
| 4 | `data/monsters.data.ts`, tag registry of `data/bestiary.data.ts`, `monsterTags`, `monsterTagSet`, `monsterSizeRank` of `systems/bestiary.ts`, species half of `systems/monsterStats.ts` (`kitOf`, `innateArmor`, `innateResistances`, `TAG_ARMOR`, `TAG_RESISTANCES`, attribute rolls, `penetrationOf`, `penetrationProblems`) | `monsters` (no state) | `tests/monsters.test.ts`: the monster, derived-tag, inflicts and penetration cases of old `content.test.ts`; the innate-resistance and stat-block cases of old `combat.test.ts` in `tests/combat.test.ts` | 3 cases as `it.todo`: portrait files and the generated art list (2, the art step), the floor half of the penetration rule (1, port 6). The bestiary. All 131 records are ported; the task text said 146 |
| 4 | Formula half of `systems/monsterStats.ts` (`statsFromAttrs`, `monsterStatsUnclamped`, `applyDerivedMods`, `applyResOverrides`, `clampMonsterStats`) | `stats` (`monster.ts`): the monster case of the shared pipeline, selected by `monsterFact` | In `tests/combat.test.ts` ("a monster reads the same stat block the player does", "a monster entity goes through the shared stat path"); `conditionResist` cases in `tests/combatStatuses.test.ts` | Nothing |
| 4 | `systems/combat.ts`: size steps, graze, respawn, generation and groups, fight start, forced and staged fights, typed damage, `onKill`, `onDefeat`, `activeRotation`, `pickActive`, `pickMonsterAction`, bar damage, retaliation, `enemyTookDamage`, enemy regeneration, status ticks, minds, `runCombatTick`, the player's normal attack, enemy attacks, close and abandon, kept wounds. Mapping by line range: `src/systems/combat/README.md` "Old to new" | `combat` (`engine.ts`, `spawn.ts`, `damage.ts`, `actions.ts`, `index.ts`) | `combat.test.ts`, `combatStart.test.ts`, `forced.test.ts`, `dynamicLevels.test.ts`, `keeper.test.ts`, `hunters.test.ts`, `breakdown.test.ts` (damage cases), `encounters.test.ts`, under the old names; new `combatSystem.test.ts` (determinism, a save in the middle of a fight, rotation kinds, events, requests, view) and `combatBudget.test.ts` | 14 cases as `it.todo`: the knockout, travel, roads, the pathfinder, activities (10, port 6), combat styles (1), achievement tiers (2), the bestiary level range (1). Not ported, each an extension point: floating weapons, counter techniques, crafted spells and monster workings, counterspells, Facet strikes, gene abilities, statues, coatings, skill actives, the approach, practice shaping |
| 4 | `systems/ledger.ts` | `combat` (`ledger.ts`) | `ledger.test.ts`, under the old names | 1 case as `it.todo` (the migration from old save version 35). The notebook has commands and no panel part |
| 4 | `systems/huntrest.ts` | `combat` (`holdNextFight`, `setResting` in `engine.ts`; the command `combat/set-hunt-rest`) | `huntrest.test.ts`, whole | `returnRecoverTarget` (port 6: the pending return) |
| 4 | `combatRegenMult` of `systems/actions.ts`; the fight half of `tickPlayerStatuses` (a condition finishes the player in a fight) | `resources` (`pace.inCombat`, slice version 2), `combat` (`fallToCondition`) | In `combatSystem.test.ts` | Pace per activity (port 6) |
| 4 | Kill and defeat listeners of `systems/achievements.ts`; the kill listener of `systems/levels.ts`; `dynamicLevelBonus` of `systems/levels.ts` | `combat` (`onKill`, `onDefeat`, `spawn.ts`) | `hunters.test.ts`, `dynamicLevels.test.ts` | `checkFloorClears` (port 6) |
| 4 | Cases ports 1 to 3 left tagged port 4 | `combat` | `tests/combatStatuses.test.ts`: 17 cases under their old names, from `statuses.test.ts` (10), `conditionResist.test.ts` (4), `loot.test.ts` (1), `wield.test.ts` (2) | 3 retagged: forced healing of a monster (2, port 5 or arcane: `healEnemy`), a school taking a stance slot (1, styles) |
| 5 | `data/martial.data.ts` (`TECHNIQUES`, `POSITIONS`, `FORK_ARCHETYPES`); execution half of `systems/martial.ts` (`declaredEntries`, `declaredPositions`, `techniqueEntries`, `openEntry`, `resolvedMove`, `techniqueExit`, `techniqueArmed`, `weaponStateGate`, `positionIncomingMult`, `positionDodgeMult`, `watchStatKey`); technique branches of `pickActive`, `pickMonsterAction` and the buff slot; `pickCounter`, `fireCounter` | `martial` | `tests/martial.test.ts`: 31 of the old 96 cases, under the old names; `tests/goblins.test.ts`: 6 of 9; `tests/monsterActions.test.ts`, `tests/playerActions.test.ts` (new) | 68 cases as `it.todo` tagged step 3: learning, eligibility and teachers (14), mastery (7), drilling (2), slots and the bench (7), forks (4), weapon states (7), rune surgery (4), readied spells (6), the planner, the position graph and `techniqueStatus` (10), `recordExecution` halves (3), watch-learning (4); 4 old save migrations |
| 5 | `systems/triggers.ts` (`evaluateTrigger`, the subjects) | `combat` (`triggers.ts`) | In `tests/martial.test.ts`, `tests/antimagic.test.ts`, `tests/playerActions.test.ts` | The picker of the rotation screen (`options`, `visible`, `describeCondition`); `style.active` and `style.selected` read one style id until the styles port |
| 5 | `ARCANE_WORDS` of `data/spellcraft.data.ts`; `parseSentence`, `composeArcane`, `splitWordId`, `displayWord`, the tuning constants of `systems/arcane.ts` | `arcane` (`grammar.ts`, written by `scripts/port-arcane.py`) | `tests/spellcraft.test.ts` ("arcane syntax", "cut, crush and pierce as verbs"), `tests/antimagic.test.ts` (undo, with, the signature) | `checkSentence`, word unlocks and levels, mastery, word skills and word XP, inscription: `it.todo` tagged step 3 arcane (7) |
| 5 | `specForSource`, `spellKey`, `workingSignature`, `leadingElement`, `undoWorking` of `systems/spellcraft.ts`; `castMonsterWorking`, `resolveMonsterWorking`, `castCraftedSelf`, `castCraftedAttack`, miracle synergy, the counterspell functions, the cast branches of `pickActive` and `pickMonsterAction` of `systems/combat.ts`; `counterEfficiency` of `systems/arcane.ts` | `spellcraft` | `tests/spellcraft.test.ts`: 72 of the old 124 cases; `tests/antimagic.test.ts`: 35 of 35 | The book's writing side, the prepared cap, `resolveSpellFor`, `castUtility`: `it.todo` tagged step 3 spellcraft (5); the psionic school (35); 2 old save migrations; the refuting body (`registerRefuter`, mutagens) |
| 5 | `MIRACLES` of `data/spellcraft.data.ts`, `data/deities.data.ts`, `miracleSpec` of `systems/divine.ts`, `deityRelation` of `systems/deities.ts` | `divine` | In `tests/spellcraft.test.ts` ("the pantheon", "miracle mechanics", content), `tests/goblins.test.ts` | Favour, receiving a miracle, the pantheon shelf, the veto at preparation: `it.todo` tagged step 3 divine (6) |
| 5 | `healEnemy` of `systems/combat.ts`; the landing of `castCraftedAttack`; `c.buffs`; `setPosition`; `state.skillTriggers` | `combat` (slice version 2: `fight.buffs`, `triggers`, `Enemy.lastAction`; requests `heal-enemy`, `land-slices`, `hurt-enemy`, `add-buff`, `move-player`, `stamp-cooldown`, `mark-event`, `take-prevented`, `attack-retaliation`; `registerInterception`, `registerBlowRider`) | `tests/overgrowth.test.ts`: the 2 cases port 4 retagged; the overgrowth cases of `tests/spellcraft.test.ts` | Nothing |
| 5 | `tests/band2.test.ts` | Not ported: floors, spots and the John climb | `tests/band2.test.ts`: 5 `it.todo` (3 port 6, 2 port 7) | The whole file |
| 6 | `data/locations.data.ts`, location half of `registry.ts`, `systems/locations.ts`, `systems/actions.ts` (activities, finds, `settleArrival`; not the condition tick), `systems/mapped.ts`, `systems/safety.ts`, `systems/search.ts`, `systems/activitydrops.ts`, `systems/keyitems.ts`, `climbTo`, `rideLeg`, `ride` of `systems/towers.ts`, `officeArrival` and `rewardTollGolem` of `systems/floodedFloor.ts`, the `travel:trips` listener of `systems/achievements.ts` | `world` | `navigation.test.ts` (12 of 18), `map.test.ts` (2 of 14), `towers.test.ts` (6 of 7), `job.test.ts` (4 of 20), `finds.test.ts` (14 of 14), `safety.test.ts` (6 of 8), `forced.test.ts` (the 5 cases port 4 left), `combatStart.test.ts` (the 4 cases port 4 left), `worldContent.test.ts` (the location lints of old `content.test.ts`, 41 of 47); new `worldSystem.test.ts` (27) and `walk.test.ts` | `it.todo`: bonus time (5), the wayfinding boon (1, port 7), the drawn plan (12, UI step), the job strip and the rate chip (14, UI step), performances and benches (1, step 3), the hold (1, step 4), 2 old save migrations, waypoints, recipes, benches, festival, wards, sea lints (6). Craft activities, the approach of a road, band hubs, the keeper and the dare |
| 6 | `data/towers.data.ts`, `systems/ladder.ts`, the stops and the gate of `systems/towers.ts`, `systems/floorRules.ts`, `checkFloorClears` and `syncBandPositions` of `systems/levels.ts` | `ladder` | `floorrules.test.ts` (39 of 42), ladder cases of `towers.test.ts`, `band2.test.ts` (the 3 cases port 5 left) | 3 `it.todo` (the forge validator). `bandPassed`, `floorsSeen` (port 7); festival verdicts, ward windows, bands 3 to 7 (step 4) |
| 6 | `systems/knockoutReturn.ts`, the knockout half of `onDefeat`, the three knockout branches of `tickPlayerStatuses`, the recovery branch of `tickAction`, `returnRecoverTarget` of `systems/huntrest.ts`, `stayHere` of `game.ts` | `knockout` | `knockoutReturn.test.ts` (107 of 110, with a determinism case added), the knockout cases ports 2 and 4 left in `statuses.test.ts` (5), `combat.test.ts` (1), `forced.test.ts` (1) | 3 `it.todo`: a festival floor (step 4), a bench run or a performance (step 3), a prestige (port 7) |
| 6 | `systems/weather.ts`, `systems/exposure.ts`, the weather tables of `data/climate.data.ts` | `weather` | `weather.test.ts` (10 of 10), `exposure.test.ts` (114, 10 `it.todo`), with "under a gale on the open ridge" of old `derivedcache.test.ts` | Weathersense, the forecast, the bestiary entries the calm opens, `world.sunlight` for Facet, floor 17 and `malgeri_range` (step 4) |
| 6 | `tests/training.test.ts`, `tests/practice.test.ts`, `tests/completability.test.ts` | Not systems of this port | `training.test.ts` (1 of 12: the data of the Cages), `practice.test.ts` (1 of 13: the post on the Sand), `completability.test.ts` (5 of 5) | The keeper and the dare (step 3), practice shaping (step 3) |
| 6 | `tests/sites.json`, `scripts/dump-test-sites.mjs` | Replaced | `tests/combatHelpers.ts` builds the site of every spot from the world registry | `tests/sitesOutside.json` keeps 6 tables of spots that are not here: the shelved countryside (2), the hold (3), floor 17 (1) |
| 7 | `data/npcs.data.ts`, the talk half of `systems/quests.ts` | `npcs` | Talk cases in `tests/quests.test.ts` (new) | 12 of 20 people: the 6 system people of Threshold and floor 2 (step 3), the 6 of floors 11 to 20 (step 4) |
| 7 | `systems/quests.ts`, `data/quests.data.ts`, `questLevelXp` | `quests` | `tests/quests.test.ts`: 11 (5 old cases on test-only copies of the shelved quests, 6 new), 3 `it.todo` | 12 of 13 quests; favour on turn-in, craft objectives, the questmaster achievement (step 3) |
| 7 | `systems/shops.ts` | `shops` | `tests/shops.test.ts`: 10 of 10 | The counters of floors 11 to 20 |
| 7 | Sale half of `systems/equipment.ts` (`sellItems`, `sellPrice`, `materialSellPrice`, `gradedUnitPrice`, `sellStackable`, `sellStackablesBatch`) | `items`, `materials` | `tests/selling.test.ts`: 6 of 6; the 3 sale `it.todo` of `tests/materials.test.ts` stay (their old cases are in `shops` and `selling` now) | Spare marks (UI step); the rune sale (runecarving) |
| 7 | `systems/tutorial.ts`, `data/tutorial.data.ts` | `tutorial` | `tests/tutorial.test.ts`: 10 ported, 11 `it.todo` (stance and spell steps, step 3; 2 old migrations; the 5 cases of `tutorialfocus.test.ts`, UI step) | The stance and spell steps; `tutorialFocus` |
| 7 | `systems/prestige.ts`, `systems/legacy.ts`, `data/prestige.data.ts` | `prestige` | `tests/prestige.test.ts`: 26 ported, 3 `it.todo` (prepared pages, step 3; 2 old migrations) | The stronghold and its automatic prestige, festival legacy, cookbook carry |
| 7 | `createInitialState` as the start of a run | Kernel: `ctx.endRun`, `newRun` (decision 30) | `tests/newRun.test.ts` (new, 4) | Nothing |
| 7 | `tests/john.ts`, `tests/john.test.ts`, `scripts/pacing.ts`, the 2 John cases of `tests/band2.test.ts` | `tests/john.ts` on `runHeadless` and commands; `scripts/pacing.ts` | `tests/john.test.ts`: 9 cases, 1 `it.todo` (a bound missed, measured value in the case); the vitest project `john` | Runs 2 and 3 (floors 7 to 20, step 4); the duel harness of "the archive's club"; the rack climbs' spell |
| 3: martial | The rest of `systems/martial.ts` (ledger, learning and the martial unlock, reach, ladder, drilling, slots and the bench, forks, teachers, weapon states, rune surgery, `positionKnown`, `positionGraph`, `techniqueStatus`); `NpcDef.teaches`; `hall_tutor`, `dojo_master`, `militia_captain` of `data/npcs.data.ts`; `legacyTechniqueSlots` as read by `techniqueSlots` | `martial` (slice version 2, `ladder.ts`, the panel), `npcs` (3 records), `combat` (`combat/enable-action`, the `before` hook, `combat/momentum`), `items` (`items/take-weapon`, `items/give-back`), `skills` (`skills/enter`) | `tests/martial.test.ts`: 85 cases, 54 of the 68 `it.todo` of port 5 ported (2 more cases: the counter check, the stance of the skip); `tests/goblins.test.ts`: the 3 watch-learning cases | 12 `it.todo` left: readied spells (6), a loadout (UI step), the study card (consumables), 4 old save migrations. Readied spells, loadouts, drill manuals, the planner drawing: `src/systems/martial/README.md` "Left behind" |
| 3: martial | `systems/styles.ts`, `data/styles.data.ts`, the style half of `collectModifiers` of `systems/derived.ts`, `setStyle` and `checkStyleSwap` of `game.ts` | `styles` (new) | `tests/styles.test.ts`: the old 11 cases plus 2 new; `tests/skills.test.ts`: the school-bonus case uses the real stance | Nothing of the old file |
| 3: martial | `chooseTutorialStance`, `confirmTutorialStance`, `TUTORIAL_STANCES` | `tutorial` (`tutorial/choose-stance`; the card shows the three stances) | `tests/tutorial.test.ts`: the stance pick, the walk through floor 0 with the stance, the skip keeping a stance, the three stances offered | The spell step (arcane) |
| 3: arcane | The rest of `systems/arcane.ts` (`checkSentence`, `knownWords`, `arcaneLevel`, word mastery, `wordLevels`, `grantWordXp`); `maxSentenceWords`; the starter lexicon of `systems/unlocks.ts`; `checkInscription`, `inscribeArcane`, `grantCastWordXp`; `lectory_wizard` of `data/npcs.data.ts` | `arcane` (`legal.ts`, command `arcane/inscribe`, event `arcane/inscribed`, the panel), `npcs` (1 record) | `tests/spellcraft.test.ts`: "deep words are earned" and "checkSentence gates on the mage" whole, "the grimoire" (2), "word skills" (4); `tests/onboarding.test.ts` (new file): the floor 0 word at the table, the starter lexicon (3) | Word slips (consumables), `faces_of_threshold`, `a_taste_of_everything`, the drag strip of the old bench (UI step): `src/systems/arcane/README.md` "Left behind" |
| 3: arcane | The book half of `systems/spellcraft.ts` (`preparedCap`, `setPrepared`, `deityConflict`, `addSpell`, `forgetSpell`, `renameSpell`, `hasSpell`, `castUtility` and its checks, `resolveSpellFor`); `legacyPreparedPages` as read by `preparedCap` | `spellcraft` (slice version 2: `utilityReady`; `book.ts`, `lines.ts`; request `spellcraft/add`, event `spellcraft/practised`, `registerHeldSpell`, the school's `reading`) | `tests/spellcraft.test.ts`: the prepared cap (3), 2 new (the veto, casting outside a fight); `tests/prestige.test.ts`: the page half of "ceilings and pages"; `tests/antimagic.test.ts`: the two assertions left in port 5 | `learnMiracle` and the veto's old case (divine), the title that defies dogma, psionic |
| 3: arcane | The readied spell of `systems/martial.ts` and `systems/combat.ts` (`readyableSpell`, `spellIsHeld`, `releaseReadiedSpell`, `setPosition` dropping the seat, the Ready Spell form, the Spell Parry delivery) | `martial` (request `martial/hold-spell`), `combat` (`registerPositionWatch`) | `tests/martial.test.ts`: the 6 `it.todo` of "readied spells", 2 new | Nothing. Spell Parry never arms in a fight, as in the old build (`src/systems/martial/README.md`) |
| 3: arcane | `chooseTutorialSpell`, `TUTORIAL_SPELLS`, `TUTORIAL_SPELL_INT` | `tutorial` (`tutorial/choose-spell`; the card shows the three spells) | `tests/tutorial.test.ts`: the walk with the spell step, the two spell cases; `tests/john.test.ts`: the rack climbs take `fire`, the vermin bound of the old case is held again | Nothing |
| 3: divine | All of `systems/divine.ts` and `systems/deities.ts` left by port 5 (favour, `checkMiracle`, `learnMiracle`, `grantFavorAll`, floating favour, `queryDeities`, `pantheonOf`, `deityGroups`, `deitiesInRelation`); the known gods of `systems/unlocks.ts`; the favour of the quest turn-in; `chapel_priest` of `data/npcs.data.ts` | `divine` (slice version 2: `favor`; `favor.ts`, `shelf.ts`; commands `divine/learn`, `divine/assign-favor`; requests `divine/grant-favor-all`, `divine/meet`; the panel), `quests` (the turn-in asks for favour), `npcs` (1 record) | `tests/spellcraft.test.ts`: "browsing the powers" (4), the favour case and the veto's old case; `tests/onboarding.test.ts`: "a fresh life knows two"; `tests/goblins.test.ts`: the known gods half; `tests/quests.test.ts`: 1 new (the turn-in favour); `tests/divine.test.ts` (new, 6, and the votive half of the old `rarefinds.test.ts` case) | The votive token (consumables), `faces_of_threshold`, `a_taste_of_everything`, meeting a god: `src/systems/divine/README.md` "Left behind" |
| 3: divine | `systems/titles.ts`, `data/titles.data.ts`, `text/titles.text.ts`; the title half of `collectBaseMods` (`systems/attributes.ts`), of the player's immunity (`systems/statuses.ts`) and `dogmaDefied` (`systems/spellcraft.ts`) | `titles` (new system: slice version 1, source `titles/held`, event `titles/check`, command `titles/wear`, the panel); `spellcraft` (the veto reads the fact `defiesDogma`) | `tests/titles.test.ts` (4 of 6, and 4 new); `tests/training.test.ts`: "David and Goslimath" (2) | The deeds of four titles (case file, dare, spoiled food, festival); the weapon families case (shelved spot) and the v6 save migration: `src/systems/titles/README.md` |

Port 1 notes:

- Mapping is not one folder per old file. `stamina` and `health` are files of
  `resources`. `derived` and the modifier half of `attributes` are `stats`.
  `conditions` is a file of `counters`. The 16-file import cycle is gone: no
  system folder imports a folder that imports it. `clock`, `counters`,
  `progression` and `stats` import no system. `log` imports `clock`.
  `attributes` imports `counters`, `progression`, `stats`. `levels` and
  `resources` import `log`, `stats`. `skills` imports `counters`, `log`,
  `progression`, `stats`.
- Content: every registry these systems own was converted whole with
  `scripts/convert-content.mjs`: `skills` (94), `skill_categories`,
  `attributes`, `attribute_training`, `progressions`, `xp_bases`, `xp_rates`,
  `resources`, `months`, `weekdays`, `holy_days`, `moons`, `moon_phases`.
  Text templates: only the keys these systems fire.
- A later port plugs into the stat pipeline with a modifier source of its
  own. `src/systems/stats/README.md` lists, per old read of an unported
  system, what that system returns. `src/systems/resources/README.md` lists
  the hook stats that replace the status queries of the pools.
- Kernel changes: `docs/KERNEL.md` section 6 and decisions 21 to 27.
- Open for port 4: old monsters have their own base formulas
  (`monsterStats.ts`: HP is `12 + 7 x CON`). The kernel path is shared now;
  the resolver in `stats` runs the player formulas for every entity until
  port 4 adds the monster formulas.
- Open for port 4: combat needs the result of an exertion, a heal and a hit
  inside one handler. They are events now (decision 27).
- Old content that looks like a tuning experiment and was ported as it is:
  Intelligence training has three hand-written milestones (+1 Skill XP at
  level 5, which doubles skill XP; +2 INT at 7; +10% INT and +10% Max Mana at
  10) where the other five attributes use the standard list.

Port 2 notes:

- One system folder, `statuses`. It imports `log`, `resources`, `stats`.
  No system imports it except the character panel in `attributes`, which
  mounts its status list.
- Kernel change: requests (`docs/KERNEL.md` section 7a, decision 28).
  `tests/requests.test.ts`.
- The status plug points of `src/systems/stats/README.md` and
  `src/systems/resources/README.md` are filled by the source
  `statuses/held`. No slice of port 1 changed shape.
- Events a later port must emit are listed in
  `src/systems/statuses/README.md`: `statuses/hook`, `statuses/inflict`,
  `statuses/situation`, `statuses/forget`.
- Open for port 4: combat ticks each monster's conditions with the
  `statuses/tick` request and applies the result; it sends
  `statuses/situation` and `statuses/forget`; it needs requests on
  `resources` for the result of a heal, a hit and an exertion.
- Open for port 6: the knockout. `statuses/fatal`, `statuses/detonated` and
  `statuses/damage` are emitted and nothing hears them yet. A condition can
  take the player to 0 HP and nothing follows.
- Open for port 7: the offline budget with conditions held. 8 hours with a
  condition that deals damage on every tick took 2,650 ms.
- Old rules that look like bugs and were ported as they are: listed under
  "Old rules ported as they are" in `src/systems/statuses/README.md`.

Port 3 notes:

- Five system folders: `gold`, `materials`, `mercy`, `items`, `loot`. The
  task named inventory, equipment, wield, materials, gold and drop tables;
  `mercy` is a folder of its own because its ledger is shared by drops (this
  port) and combat procs (port 4).
- Imports: `gold` imports `counters`. `mercy` imports no system. `materials`
  imports `log`, `resources`, `stats`, `statuses`. `items` imports
  `attributes`, `counters`, `log`, `skills`, `stats`. `loot` imports
  `counters`, `gold`, `items`, `log`, `materials`, `mercy`, `stats`.
  `statuses` now imports `items` for the list of equipment slots. No folder
  imports a folder that imports it.
- No kernel change. No slice of port 1 or 2 changed shape.
- `equip`, `unequip` and `canEquip` were in old `systems/equipment.ts`, not
  in `attributes.ts` as the port 1 row said.
- The fact the condition kind `equippedTag` reads is stated by the source
  `items/worn`: `wieldTagFact` per tag of every worn piece, `armedFact` when
  the weapon slot is filled.
- Status content: `damp.slot` is an enum of the equipment slots. Slots are a
  fixed list in `items`, not a registry, so it is not an `s.ref`. No status
  field points at an item or a material.
- Panels: `items` holds the equipment panel and `materials` holds the
  inventory panel, which mounts the pack component of `items` (decision 29).
  A folder holds one panel.
- Item icons: the `art` field is the icon name of the old build. The files
  are bought art and are not in this repository; the panels show the emoji
  `icon`. Loading a file from `src/assets/licensed/` when it is present is
  left to the art step.
- Content: `items` (47), `affixes` (5), `runes` (11), `materials` (189),
  `quality_tiers` (7), converted whole with `scripts/convert-content.mjs`.
  Default 5 was not needed for these: a field that points at an unported
  registry is a plain string, as in port 2.
- An item instance carries a copy of its affix (name and modifiers), as in
  the old save, not an id.
- Open for port 4: call `loot/roll` on a kill with the tags, rarity,
  modifier tier, reward level, size and killing blow of the monster; call
  `mercy/proc` for crits; read `weaponDef` for bonus damage and damage type,
  `handSwingShare` and `floatingSlots` for the swing; decide the request for
  a weapon dropped under a condition (`dropWeaponBelow`). Monster and
  location registries use `dropTableSchema` and test `dropTableIssues`.
- Open for port 7: selling (items, materials, runes), spare marks, the
  prestige pass over `carriedStash`.
- Measured on 2026-11-16, same machine: 8 hours with no condition 700 to
  715 ms alone, 1,106 ms inside the full test run (port 2: 700 and 1,150).
  With a bleed held: 3,096 ms alone, 3,944 ms inside the full run (port 2:
  2,650 and 4,070). Both budgets unchanged.
- Old rules that look like bugs and were ported as they are: listed under
  "Old rules ported as they are" in `src/systems/items/README.md` and
  `src/systems/loot/README.md`.

Port 4 notes:

- Two system folders: `monsters` (registry and species rules, no state) and
  `combat`. The monster formulas are a file of `stats`, as the port 1 note
  asked: one resolver, selected by a fact a source states.
- Imports: `monsters` imports `counters`, `items`, `loot`, `stats`,
  `statuses`. `combat` imports `attributes`, `clock`, `counters`, `gold`,
  `items`, `levels`, `log`, `loot`, `mercy`, `monsters`, `resources`,
  `skills`, `stats`, `statuses`. No system imports `combat`. No folder
  imports a folder that imports it.
- No kernel change. Decision 28 (requests) carried the port: a blow is
  resolved in one handler with `resources/hit`, `resources/exert-now`,
  `resources/draw-now`, `statuses/apply`, `statuses/fire`, `statuses/tick`,
  `mercy/proc`, `loot/roll`.
- Slices of earlier ports: `resources` is at version 2 (`pace.inCombat`),
  with a migration step and a fixture. `resources` gained five requests,
  `items` one (`items/drop-worn`). `stats` gained `monster.ts` and the fact
  `monsterFact`.
- The save holds the fight (`tests/fixtures/combat/v1.json` is a slice saved
  in the middle of one). The old build dropped the fight at save.
- Locations do not exist yet. Combat takes an `EncounterSite` as data
  (`src/systems/combat/README.md` "The site"). The ported tests carry the
  encounter tables of the old spots they stood on in `tests/sites.json`,
  written by `scripts/dump-test-sites.mjs`.
- Rotations: the normal attack is the only kind this port executes. A kind
  is registered by its owner (`registerMonsterAction`,
  `registerPlayerAction`); an entry of an unregistered kind is passed over
  with one skip-log line per fight and entry, and the combatant swings
  plainly. Of the 131 monsters, 60 have a rotation. Six of them are on
  floors 0 to 6: `goblin_raid_leader` (floor 4), `hobgoblin` (5, 6),
  `hobgoblin_champion` (5), `goblin_warchief` (6) with techniques
  (`pocket_sand`, `dirty_stab`, `gather`, `hamstring`, `lunge`,
  `heavy_blow`); `goblin_firetongue` (5, 6) with two arcane sentences;
  `goblin_witch_doctor` (6) with three divine workings (`mud_poultice` with
  2 uses, `vermin_swarm`, `cinder_curse`). Section 1 counted the two
  sentences and not the witch doctor's workings.
- Content: `monsters` (131), `monster_tiers` (7), `modifier_tiers` (4),
  `rarities` (4), `monster_tags` (50), `combat_text` (15). Converted with
  `node scripts/convert-content.mjs monsters monster_tiers modifier_tiers
  rarities monster_tags`.
- Panel: `combat` holds the combat panel. Five enemy slots, the status line
  and the log have fixed heights. Checked on the build preview (port 5601)
  at 1280 and 375 pixels wide: a kill, a group of three, a defeat; the
  positions of the status line, the bars, the slots and the log were
  sampled every 50 ms and did not change; no console error.
- Measured on 2026-11-17, same machine. 8 hours with no fight and no
  condition: 929 ms alone, 1,447 ms inside the full test run (port 3: 700
  to 715 and 1,106); budget raised from 2,000 to 3,000 ms. With a bleed
  held: 3,561 ms alone, 5,577 ms inside the full run (port 3: 3,096 and
  3,944); budget 8,000 ms, unchanged. 8 hours of fights at a floor 1 table
  (`tests/combatBudget.test.ts`): 3,931 ms alone, 7,126 ms inside the full
  run, 9,673 kills; budget 12,000 ms. The three budget tests run in
  parallel workers, which is why each is slower inside the full run.
- Open for port 5: register `technique` and `cast` with
  `registerMonsterAction`, and the player kinds; `combat/heal-enemy` for a
  working that forces life into a monster (2 `it.todo` cases in
  `tests/conditionResist.test.ts`); counter techniques and per-hit riders
  (coatings) need a hook inside the blow that combat does not have yet:
  add it to `actions.ts` as a registered kind, not to the tick.
- Open for port 6: the knockout. `combat/defeat` carries `monster`,
  `forced`, `outcome`, `cause`, `site` and `byCondition`; combat has closed
  the fight, set the respawn delay and turned the hunt off. HP 1,
  `recovering`, the retreat, the return, the "knocks you out" line of a
  condition, and `resources/set-pace` per activity are the world port's.
  The site: build `EncounterSite` from a spot, with `levelStep` and
  `dynamicLevel` from its band; send `combat/hunt` from the hunt activity,
  `combat/start-forced` on arrival at a forced spot, `combat/abandon` on
  travel and activity switches after checking `inForcedFight`. `sky` lines
  of an encounter table do not roll until weather exists. The hook stat
  `combat/darkness`. The approach (`pendingApproach`). `checkFloorClears` on
  `combat/kill` and `combat/fight-won`. `penetrationProblems` takes the
  early-floor list. 10 `it.todo` cases wait in `combatStart.test.ts`,
  `forced.test.ts` and `combat.test.ts`.
- Open for port 7: the John port needs the knockout of port 6 and the
  monster techniques of port 5 to match the old climb on floors 4 to 6.
  The toll golem's reward and spell reactions (`floodedFloor.ts`) are not
  ported; its 30-tick address is.
- Old rules that look like bugs and were ported as they are: listed under
  "Old rules ported as they are" in `src/systems/combat/README.md` and
  `src/systems/monsters/README.md`.

Port 5 notes:

- Four system folders: `martial`, `spellcraft`, `arcane`, `divine`. Each
  README has a section "Design", written and committed before the code
  (`81eb1d1`), that states the cut: what of the old engine is ported now,
  what waits for step 3, and why the ported part is not rewritten then.
- The cut, in one line each. Martial: the registries and the execution of a
  technique for both sides, with the ledger read but never written.
  Arcane: the whole grammar engine and the whole word registry; legality,
  mastery, word skills and inscription wait. Spellcraft: the resolution of
  a spell for both sides and the counterspells; the book's writing side
  waits. Divine: the miracle and deity registries and the relation between
  deities; favour and learning wait.
- Imports: `martial` imports `attributes`, `combat`, `counters`, `items`,
  `log`, `resources`, `skills`, `stats`, `statuses`. `spellcraft` imports
  `attributes`, `clock`, `combat`, `log`, `mercy`, `monsters`, `resources`,
  `skills`, `stats`, `statuses`. `arcane` imports `spellcraft`, `stats`,
  `statuses`. `divine` imports `spellcraft`. `combat` imports none of the
  four. No folder imports a folder that imports it.
- No kernel change. Combat's extension points changed; the list is in
  `src/systems/combat/README.md` "Port 5 design" and "Port 5: changed while
  building". The combat slice is at version 2, with a migration step and a
  fixture. `statuses` gained the request `statuses/surplus`.
- A kind may refuse an entry with a reason. The reason is in the skip log
  once per fight, entry and reason (`combat/rotation`). The old build passed
  such an entry over silently.
- `activeRotation` of port 4 was corrected to the old rule: ids the player
  did not order follow by kind (techniques before spells), and an id of the
  saved order that its kind no longer has is left out.
- Content: `techniques` (29), `positions` (7), `fork_archetypes` (8),
  `arcane_words` (40), `miracles` (30), `deities` (11), `deity_tags` (44).
- The six monsters: `tests/monsterActions.test.ts` runs each in a seeded
  fight. Every entry fires except three that the old data does not let
  fire: Dirty Stab of `goblin_raid_leader` (nothing in its rotation exits to
  `extended`), and Lunge and Pocket Sand of `hobgoblin` at its own pace
  (each is asked after an entry for the same position that is always
  ready). A hobgoblin given attack speed fires all five.
- Measured on 2026-11-17, same machine: `docs/KERNEL.md` section 8. The
  three budgets of ports 1 to 4 are unchanged. The new floor 6 run takes
  11,500 to 13,200 ms alone. The four budgets are one file,
  `tests/budgets.test.ts`, run as its own vitest project after the other
  tests.
- Panel: the enemy slot shows the last action of the monster beside its
  action bar for 3 seconds, in a box that is always there. Checked on the
  dev server (port 5600, parchment theme). At 1280 pixels wide: a fight
  led by `goblin_warchief`, one by `goblin_firetongue`, one by
  `goblin_witch_doctor`; the rectangles of the status line, the bars, the
  first and the last slot, the log and the action box were sampled every
  50 ms and each had one value; no console error. At 375 pixels wide: the
  `goblin_warchief` fight, whose group held a witch doctor (Gather, Heavy
  Blow, Mud Poultice shown), same sampling, no horizontal scroll, no
  console error. The fights led by the firetongue and by the witch doctor
  were not seen at 375 pixels: the browser pane was hidden and the frame
  loop did not run.
- Open for port 6: nothing new from this port. `tests/band2.test.ts` holds
  3 `it.todo` for the floors and spots of band 2. A witch doctor casts Mud
  Poultice whenever kin stands, also when the kin is unhurt, and a
  firetongue's cast is not dodged: the knockout of port 6 meets both on
  floors 5 and 6.
- Open for port 7: the John port can now meet the real floor 4 to 6
  monsters. The offline budget: 8 hours at a floor 6 table cost 12 seconds,
  of which about 5 are stat table builds; per-stat dependency tracking or a
  cheaper monster stat block (kernel decision 4) is the place to look.
  `tests/band2.test.ts` holds 2 `it.todo` for the John climb.
- Open for step 3: every `it.todo` tagged `step 3` in `tests/martial.test.ts`,
  `tests/goblins.test.ts`, `tests/spellcraft.test.ts`. Per system, the list
  under "Waits for step 3" in its README. The points step 3 extends without
  an edit elsewhere: `moveOf`, `entriesOf`, `exitOf`, `weaponStateGate` and
  the ledger of `martial`; `resolveSpell` and the book of `spellcraft`;
  `registerSchool('psionic')`; `registerRefuter`; `registerBlowRider`; the
  events `spellcraft/cast` and `spellcraft/strike-landed`. `psionic_slime`
  and every other monster with a psionic rotation swing plainly until the
  psionic school is registered; each entry is in the skip log with the
  reason.
- Old rules that look like bugs and were ported as they are: listed under
  "Old rules ported as they are" in the README of `martial` and of
  `spellcraft`, and in `src/systems/divine/README.md` "Content".

Port 6 notes:

- Four system folders: `world`, `ladder`, `knockout`, `weather`. The design
  is section 7, written and committed before the code (`de8afc8`).
- Imports: `ladder` imports `combat`, `counters`, `levels`, `log`, `skills`.
  `world` imports `attributes`, `combat`, `counters`, `gold`, `items`,
  `ladder`, `log`, `materials`, `mercy`, `resources`, `skills`, `stats`,
  `statuses`. `knockout` imports `clock`, `combat`, `counters`, `ladder`,
  `log`, `resources`, `stats`, `statuses`, `world`. `weather` imports
  `clock`, `combat`, `counters`, `log`, `skills`, `stats`, `statuses`,
  `world`. The Location panel of `world` mounts the views of `knockout` and
  `ladder` (decision 29). No kernel-side file of a folder imports a folder
  that imports it.
- No kernel change. No slice of an earlier port changed shape. `combat`
  gained the requests `combat/set-hunt` and `combat/stop-hunt` and the
  registry `registerSiteSky`.
- Content: `regions` (3), `areas` (16), `spots` (80), `key_items` (3),
  `towers` (1), `bands` (2), `floors` (7), `terrains` (8), `sky_tables` (1),
  `sky_rules` (5), text registries. Written by `scripts/convert-world.mjs`.
- The headless walk (`tests/walk.test.ts`): from `f0_cell` through every
  gate to `f6_great_hall` by `world/*` commands only: 11,440 ticks, 113
  kills, 1 knockout, which the return handles with no command. What stands
  in for port 7 content: the probe gives the character 4,000 health, 160
  damage and 30 armour; the rusty sword is equipped by the test. The gold
  gates are paid by the weighbridge job, as John does.
- The knockout is live for every test of ports 1 to 5. Two cases changed: a
  detonation that takes all health leaves 1 HP; the stand-in system named
  `world` in the corruption case is gone. `keepHunting` no longer rests the
  character itself. The held-condition budget holds a poison in place of a
  bleed: the forced rest of the first knockout tends a bleed and ends it.
- Measured on 2026-11-17, same machine, each alone: `docs/KERNEL.md`
  section 8. Two new budgets, 30,000 ms each, in the vitest project
  `budget-world`.
- Panel "Location" (`world`). Checked on the dev server (port 5600,
  parchment theme). The session had no visible window, so the frame loop did
  not run; the game was advanced by reloading the page (the offline catch-up
  simulates the gap) and the rectangles of the place line, the status line,
  the bar, the return line, the activity row, the card of the picked spot
  and the first spot button were read after each reload. At 1280 pixels:
  the Cellblock and the Field, with no fight and with a fight open (2
  samples), each rectangle had one value; no console error. At 375 pixels:
  the Field after its last fight, 2 samples, one value each, no horizontal
  scroll, no button under 44 pixels, picking a spot moves nothing; no
  console error. Found and fixed: the activity row and the description had
  no fixed height, so an arrival moved everything below them.
- Open for port 7: quests and shops; the floor 0 script and the weapon rack;
  prestige (`registerBandPass`, `floorsSeen`, a prestige ends the knockout
  return, `PRESTIGE_UNLOCK` on the floor 6 clear); the John port on
  `world/*` commands (`tests/walk.test.ts` is the skeleton), 2 `it.todo` in
  `tests/band2.test.ts`; the wayfinding boon; the offline summary lines (the
  ladder end, the first calm); the defeat dialog (`knockout` view,
  `defeatDialogDue`); the offline budget: 8 hours of the hunt activity cost
  19 seconds on floors 4 and 6 (section 8 of `docs/KERNEL.md`).
- Open for the kernel session (decision 4, measured and not fixed here):
  the same floor 6 table costs 14.7 s sent to `combat` directly and 19.0 s
  through the hunt activity. Under an open night sky the place darkness
  changes every game minute with the moons, and each change rebuilds the
  player's stat table (every 10 ticks). The hunt activity emits
  `skills/check-discovery` on every tick, as the old loop called
  `checkDiscovery`.
- Open for step 3: the keeper of the Cages and the dare with its hold of
  play, practice shaping, craft activities and benches, the toll collector's
  reactions to spells, `cardSpent` for activity drops. `statuses` does not
  touch `statuses/held` when a condition with no modifier lands or goes, so
  `weather` keeps an `eyeless` flag in its slice and compares each tick.
- Open for step 4: Weathersense, the forecast, floors 7 to 20 with their
  regions, band hubs, the approach of a road, the festival and ward rules of
  the ladder.
- Open for the UI step: the surveyed plan of the map, the Stations row, the
  job strip and the rate chip (26 `it.todo` in `tests/map.test.ts` and
  `tests/job.test.ts`), the weather chip of the header, the floor rules in
  the forge validator. The combat panel reads "Next fight in 0.0 s" at a
  cleared spot.
- Old data and old rules that look wrong and were ported as they are:
  `clearsToAdvance` is 2 on bands of 3 floors (the field is not read); the
  description of `ascent_lower` names three floors that no longer exist;
  the Cages carry `caged`, `dare` and `healBetweenBouts`, read by nothing
  here; the scope has one waypoint, so the caravan cannot run; a fully
  explored spot rolls 0.8% per tick for a few gold; the calm flag
  `flag:malgeri_calm_seen` is shared by every sky table; the sky rules apply
  only under a sky table, and no region here has one. Per system: "Old
  rules ported as they are" in the four READMEs.
- Changed while building, against section 7: `weather` has a third slice
  field (`eyeless`) and a text registry, and 8 terrains, not 6;
  `world/select-activity` and `world/go-and-do` at the spot are accepted
  while knocked out, as the old functions were; `world/travel` (one hop) is
  a request; `world/stay` was added for `knockout/stay-here`; `safeSpots`
  starts empty, as in the old build; `world` bumps `travel:trips` on every
  arrival; the world budgets are a vitest project of their own.

Port 7 notes:

- Five system folders: `npcs`, `quests`, `shops`, `tutorial`, `prestige`.
  The design is section 8, written and committed before the code
  (`81e363a`).
- Imports: `npcs` imports `counters`, `log`, `skills`, `world`. `quests`
  imports `combat`, `counters`, `gold`, `items`, `levels`, `log`,
  `materials`, `npcs`, `skills`, `stats`, `world`. `shops` imports
  `counters`, `gold`, `items`, `log`, `materials`, `npcs`, `skills`, `stats`,
  `world`. `tutorial` imports `combat`, `counters`, `items`, `log`, `world`.
  `prestige` imports `attributes`, `counters`, `gold`, `ladder`, `levels`,
  `log`, `skills`, `stats`, `world`. `items` and `materials` now import
  `gold`. No older folder imports a new one.
- Kernel change: a new run (`docs/KERNEL.md` decision 30). Shell change:
  overlays (decision 31). No slice of an earlier port changed shape; no
  fixture of an earlier port changed. Earlier folders changed: `items`
  (`items/sell`, `items/equip-now`, `sellPrice`, `newRun`), `materials`
  (`materials/sell`, `materials/sell-batch`, the two price functions),
  `world` (`world/place`), `ladder` (`floorSeenKey`), `weather` (`newRun`),
  `knockout` (the defeat dialog overlay). Each README has the change.
- Panels: "Quests" (people here, offered, active, done), "Shop", "Prestige".
  Overlays: the floor 0 card (banner, `tutorial`), the defeat summary
  (modal, `knockout`), the review after a prestige (modal, `prestige`). Sell
  buttons in the pack and the material list.
- Browser check, dev server (port 5600, parchment theme). The pane was
  hidden, so the frame loop did not run; the game was advanced by loading
  saves with an earlier `savedAt` (catch-up simulates the gap). Two saves
  were made headless: a few seconds before a knockout that no return follows
  (John seed 42, the floor 3 hearing room), and right after John's first
  prestige. Seen: the floor 0 card with the rack and the shield choice, the
  rack equip, the skip to the Foot, the warden's quest accepted, the
  greeting, the Rack of the Wrights' Gate with stranger prices, the defeat
  dialog (1280 and 375 px), the review with a boon bought and left (375 px).
  Layout: the rectangles of the headings, lists, cards and buttons of the
  Quests, Shop, Prestige and Combat panels were read at four moments of the
  hearing room fight (1, 2.5, 4 and 5.5 s into the gap), at 1280 and at 375
  px; each panel had one value at each width. No horizontal scroll, no
  button under 44 px at 375, no console error. Not seen: light and dark
  themes; a buy with gold in the purse (the shop test covers it); the
  tutorial card during the slime fight.
- John: section 9. The per-floor comparison and the tolerance.
- Budgets: section 9.
- Changed while building, against section 8: the floors-seen read is a
  counter (`legacy:floor_seen:<floor>`) that prestige sets each run, not a
  registered read, because the condition reader has no slice access;
  `world/place` takes `newRun` (no arrival, no haven noted) for the start of
  a run; the defeat dialog, the review and the floor 0 card are overlays,
  not panel parts (decision 31); `tests/john.test.ts` runs as the vitest
  project `john` after the budgets, because two parallel climbs made a timed
  unit case of `tests/combatStatuses.test.ts` pass its 5 s limit; the spare
  marks are the UI step's, not this port's.
- Old data and old rules that look wrong and were ported as they are: the
  floor 0 step texts name map pins and tabs of the old layout; the warden's
  text names two quests and eight trades that are not here; boons whose
  readers are not ported are sold (pages, technique slots, the city key,
  Cook's Notes) and do nothing yet; `the_first_ascent` names a favour reward
  that is not paid until divine favour is ported.

## 7. Port 6 design: the world

Written before the code (2026-11-17). "Changed while building" at the end of
the port 6 notes lists what differs.

### 7.1 System folders

Four folders. The old 6-file cycle (combat, locations, actions, towers,
knockoutReturn, safety) is cut by direction: `ladder` reads only, `world`
moves the character, `knockout` drives `world` through requests, `weather`
reads `world`. No folder imports a folder that imports it.

| Folder | Old files | Imports (systems) | Tick order |
|---|---|---|---|
| `ladder` | `ladder.ts`, the stop and gate half of `towers.ts`, `floorRules.ts`, `checkFloorClears` and `syncBandPositions` of `levels.ts`, `towers.data.ts` | `combat`, `counters`, `levels`, `log`, `skills` | none |
| `world` | `locations.ts`, `actions.ts` without the condition tick, `mapped.ts`, `safety.ts`, `search.ts`, `activitydrops.ts`, `keyitems.ts`, the moving half of `towers.ts` (`climbTo`, `rideLeg`, `ride`), `locations.data.ts` | `attributes`, `combat`, `counters`, `gold`, `items`, `ladder`, `log`, `materials`, `mercy`, `resources`, `skills`, `stats`, `statuses` | 5 |
| `knockout` | `knockoutReturn.ts`, the three knockout branches of `tickPlayerStatuses`, the knockout half of `onDefeat`, `returnRecoverTarget` of `huntrest.ts`, the recovery branch of `tickAction` | `clock`, `combat`, `counters`, `ladder`, `log`, `resources`, `stats`, `statuses`, `world` | 4 |
| `weather` | `weather.ts`, `exposure.ts`, the weather tables of `climate.data.ts` | `clock`, `combat`, `counters`, `log`, `skills`, `stats`, `statuses`, `world` | 20 |

Order: `resources` and `statuses` tick at 0, `knockout` at 4, `world` at 5,
`combat` at 10, `weather` at 20. The old loop ran pools, conditions, the
recovery check, the return step, the activity, the fight, then exposure.

### 7.2 Slices

`world` (version 1):

| Field | Old field |
|---|---|
| `spot` | `state.spot`. Starts at `f0_cell`. |
| `discovered` | `state.discovered` |
| `travel` | `state.travel`: `{ from, to, ticksLeft, total }` or null |
| `travelPlan`, `travelIntent` | the same |
| `activity`, `activityProgress` | the same |
| `resumeActivity` | the same; key order is recency |
| `explored`, `finds` | the same |
| `safeSpots` | `{ nearest, unconditional }` |
| `recovering` | `state.recovering` |

`knockout` (version 1): `pendingReturn` (old `PendingReturn`), `proven`
(old `ReturnSpot` or null). The streak counters `ko:n:<spot>`,
`win:n:<spot>` and `win:at:<spot>` stay counters.

`weather` (version 1): `seed` (number or null) and `darkness` (the place
darkness last computed, 0 to 1). The old seed was a mix of the save's
`createdAt`. System code may not read a wall clock, so the seed is one draw
of the kernel generator, taken at the first game minute the character
stands under an open sky. A character that never leaves a roof draws
nothing, so no seeded test of ports 1 to 5 shifts.

`ladder` has no state. Cleared, open, gated and sealed are derived from
counters, as in the old build.

`combat`, `resources`, `statuses`: no slice change.

### 7.3 Content

| Registry | System | Records | Note |
|---|---|---|---|
| `regions` | `world` | 3: `holding_level`, `threshold`, `the_ascent` | `the_hold` and `malgeri_range` are step 4 |
| `areas` | `world` | 16: 9 of Threshold, 7 floors | |
| `spots` | `world` | 80: 27 of Threshold, 53 on floors 0 to 6 | Whole records. `recipes`, `benches`, `caged`, `healBetweenBouts`, `dare` are kept in the data and not read until their systems exist. |
| `key_items` | `world` | 3 | |
| `world_text` | `world` | the keys this port fires | |
| `towers`, `bands`, `floors` | `ladder` | 1, 2, 7 | Bands above the second and floors above 6 are step 4 |
| `terrains`, `sky_tables`, `sky_rules` | `weather` | 6, 1, 5 | Constants of the noise field stay in code |
| `knockout_text` | `knockout` | the `knockout.*` lines | |

Converted by `scripts/convert-world.mjs`. The task text counts 9 Threshold
job spots; the old data has 27 Threshold spots, of which 6 hold a job. All
27 are ported: Threshold is a mapped region and the map shows every spot.

### 7.4 Commands (player)

All of `world`. Each ends a knockout return in flight when it is accepted
(`world/player-command`, heard by `knockout`), as the old `Game` methods did.

| Command | Old function |
|---|---|
| `world/travel-to { to }` | `travelPlanTo` |
| `world/go-and-do { spot, activity }` | `goAndDo` |
| `world/select-activity { activity }` | `selectActivity` (null stops) |
| `world/set-intent { activity }` | `setJourneyIntent`; `''` is "stay here" |
| `world/cancel-plan` | `cancelTravelPlan` |
| `world/climb { floor }` | `climbTo` (null is the hub) |
| `world/fast-travel { to }` | `fastTravelTo` (no button calls it, as in the old build) |

One hop (old `startTravel`) is a function of the system, used by the plan.

### 7.5 Requests and events between the systems

Requests `world` answers (the caller needs the outcome in its handler):

| Request | Caller | Old call |
|---|---|---|
| `world/start-activity { activity }`, answers a boolean | `knockout` | `startActivity`: does not end the return |
| `world/go { spot, activity }`, answers a boolean | `knockout` | `goAndDo` |
| `world/ride { floor }`, answers a boolean | `knockout` | `climbTo` |
| `world/retreat { reason }`, answers the spot left | `knockout` | `retreatToSafety`, plus `recovering = true` |
| `world/recover` | `knockout` | `recovering = false` and the "recovered" line |

Requests `world` makes: `combat/set-hunt { site }` and `combat/stop-hunt`
(new in `combat`: the hunt loop set from a system, where `combat/hunt` is
the player's command), `combat/start-forced`, `combat/abandon`,
`gold/add`, `gold/spend`, `materials/grant`, `mercy/chance`, `items/grant`.

Events `world` emits:

| Event | Payload | Heard by |
|---|---|---|
| `world/arrived` | `{ spot, from, ambushed }` | `weather` (darkness), `knockout`; port 7 quests |
| `world/activity-changed` | `{ spot, activity, kind }` | `knockout`; the panel |
| `world/player-command` | `{ type }` | `knockout`: the return ends |
| `world/cycle` | `{ spot, activity, kind, tags, baseTicks }` | `weather`: exposure by work |
| `world/discovered` | `{ spot }` | port 7 |

To other systems: `resources/set-pace` per activity, on travel and on
recovery (`RECOVERY_MULT`, `halted` while travelling, `resting`);
`statuses/situation { down }`; `counters/bump` and `set` (`gold:earned`,
`gather:<material>`, `flag:search:...`, `found:<material>`, find stats);
`skills/grant-xp`, `skills/check-discovery`; `attributes/grant-xp-split`;
`ladder/check` on arrival; `log/line`.

`ladder` hears `combat/kill`, `combat/fight-won` and `ladder/check`, pays
the floor clear XP through `levels/grant-xp`, sets `level:floor:<id>` and
`cleared:band:<id>`, and emits `ladder/floor-cleared { floor }`. `world`
hears that and sends the hunt site again, since `levelStep` may have moved.

`knockout` hears `combat/defeat` (a blow), `statuses/fatal`,
`statuses/detonated`, `statuses/damage` (a condition, in a fight or not),
`combat/fight-won` (streaks, the proven hunt, the progress of the return)
and `world/player-command`. It ticks before `world`: while
`world.recovering` it checks the recovery mark (60%, or 95% and the hunt
rest target with a return pending) and asks `world/recover`; then it takes
one step of the return. It emits `resources/defeat` for the 1 HP.

Subscriber order makes the condition case work: `knockout` (order 4) hears
`statuses/damage` before `combat` (order 10) closes the fight, so it reads
whether the fight was forced; `combat` then emits `combat/defeat` with
`byCondition: true`, which `knockout` ignores.

`weather` states `combat/darkness` from the source `weather/darkness`
(place darkness, darkvision level, the `eyeless` condition), recomputed
each game minute and on `world/arrived`. It registers the reader of `sky`
encounter lines with `combat` (`registerSiteSky`, new in `combat/spawn.ts`,
the same pattern as the rotation kinds). It applies the sky rules with
`statuses/apply` under the source `Weather: <kind>`.

### 7.6 The encounter site

`world` builds `EncounterSite` from a spot: `encounters`, `groupWeights`,
`modifierWeights`, `fightLimit`, `stampOnClear`, `levelStep` (old
`bandLevelStep`, from `ladder`), `dynamicLevel` (from the band). The hunt
activity keeps `combat.hunting` on with the site of the spot; a forced spot
that is not cleared starts its fight on arrival and on every tick with no
fight, as old `tickAction` did.

### 7.7 Panel

One panel, in `world`: "Location". Top to bottom: the place line and the
journey line (one fixed-height box, also while standing); the activities of
the spot; the map of the region as a list of spots by area (click a spot:
its card with "Go" and one "Go and do" per activity; no other travel
control); the ladder (each rung with its state: cleared, open, gated with
the terms of the gate and their progress, sealed). No element changes size
with the tick or the fight. The old surveyed plan drawn from `map`
coordinates and the Stations row are left to the UI step; the `map` field
is ported.

### 7.8 Waits

Port 7: quests, shops, the floor 0 script and the weapon rack, prestige
(`bandPassed`, `floorsSeen`, the return cleared by a prestige), the John
port, the offline summary lines of the ladder end.

Step 3: the keeper of the Cages (`healBetweenBouts`) and the dare with its
hold of play (bonus time), practice shaping, benches and craft activities,
gather activities (no spot in scope has one), the hall tutor.

Step 4: Weathersense, the festival, ward windows, the sea, band hubs
(`climbToHub`), the approach of a road (no road in scope has one), every
floor above 6.

## 8. Port 7 design: people, quests, shops, floor 0, prestige

Written before the code (2026-11-17). Old sources read at `7c1267b`:
`systems/quests.ts`, `shops.ts`, `tutorial.ts`, `prestige.ts`, `legacy.ts`,
the sale half of `equipment.ts`, `data/npcs.data.ts`, `quests.data.ts`,
`tutorial.data.ts`, `prestige.data.ts`, `save/offline.ts`, `tests/john.ts`,
`scripts/pacing.ts`.

### 8.1 System folders

Five new folders. Selling goes to the two folders that own the goods, as in
the old build (`equipment.ts`), so `shops` holds buying only.

| Folder | Old files | Imports (systems) |
|---|---|---|
| `npcs` | `npcs.data.ts` (records in scope), `npcsAt`, `npcDialogue`, `talkTo`, `hasMet`, `metKey` of `quests.ts` | `counters`, `log`, `skills`, `world` |
| `quests` | `quests.ts` without the talk half, `quests.data.ts`, `questLevelXp` of `levels.ts` | `combat`, `counters`, `gold`, `items`, `levels`, `log`, `materials`, `npcs`, `skills`, `stats`, `world` |
| `shops` | `shops.ts` | `counters`, `gold`, `items`, `log`, `materials`, `npcs`, `stats`, `world` |
| `tutorial` | `tutorial.ts`, `tutorial.data.ts` | `combat`, `counters`, `items`, `log`, `world` |
| `prestige` | `prestige.ts`, `legacy.ts`, `prestige.data.ts` | `attributes`, `counters`, `gold`, `items`, `ladder`, `levels`, `log`, `skills`, `stats`, `world` |

Changed folders: `items` (sale of items, spare marks, the request
`items/equip-now`, the stash carried over a new run), `materials` (sale of
stackables), `world` (the request `world/place`), `ladder` (the read of
`floorsSeen`, registered by `prestige`), `weather` (seed and first-calm flag
carried over a new run). None of the five new folders is imported by an
older one.

### 8.2 Kernel change: a new run (decision 30)

A prestige replaces every slice. The old build did it with
`createInitialState()` and copied the legacy block across. Here no system may
write another's slice, and editing every folder to listen for a reset breaks
"adding a system touches one folder". So the kernel gets the mechanism; the
systems keep the rules.

- `ctx.endRun()`: asks for a new run. The kernel performs it after the
  current command or tick step has drained its events.
- The new run: every slice is replaced by `initial()`; `kernel.tick` and the
  random state go on; every entity but the player is dropped; every source
  is touched. Then each system's `newRun(ctx, previous)` hook runs in system
  order, where `previous(system)` reads that system's slice as the old run
  left it; then the events drain.
- A system that carries something across a prestige says so in its own
  `newRun`: `prestige` (the legacy block), `items` (the stash, old
  `carriedStash`), `weather` (the world seed and the first-calm flag).
  `counters` starts new like every slice; `prestige` sets the counters a
  run starts with.

### 8.3 Slices

| Slice | Version | Fields |
|---|---|---|
| `npcs` | none | Met is the counter `met:<npc>`, as in the old build |
| `quests` | 1 | `quests`: id to `{ status: 'active' \| 'done', progress: number[] }` |
| `shops` | none | Nothing about a shop is saved (old rule) |
| `tutorial` | none | Every step reads counters and the world |
| `prestige` | 1 | `count`, `points`, `purchases`, `peakLevels`, `peakAttrs`, `floorsSeen`, `lastHarvest`, `review`, `spentThisReview` |

The old legacy block also held `cookbook` (cooking, step 3), `stronghold`,
`stash`, `festivalBonus`, `festivalTechniques` (step 4). The stash is the
`items` slice's own `stash` here. Each missing field arrives with a migration
step in its port.

### 8.4 Content

| Registry | System | Records |
|---|---|---|
| `npcs` | `npcs` | 8 of 20: `warden_of_the_foot`, the three vendors at the district gates (`ward_outfitter`, `row_apothecary`, `granary_provisioner`), the three material counters (`master_smith`, `head_chef`, `row_alchemist`), `hall_quartermaster`. The other 6 in scope (wizard, priest, captain, shaper, dojo master, hall tutor) arrive with their systems in step 3 (defaults 1 and 4); 6 stand on floors 11 to 20 (step 4). |
| `quests` | `quests` | 1 of 13: `the_first_ascent`. `faces_of_threshold` and `a_taste_of_everything` wait for step 3 (default 2), the rest for step 4. The warden's quest list holds the one id. |
| `prestige_sources` | `prestige` | 6, whole |
| `prestige_boons` | `prestige` | 15, whole. Effects whose reader is not ported (pages, technique slots, the city key, Cook's Notes) are bought and held; nothing reads them yet. |
| `tutorial_steps` | `tutorial` | 9, whole; the stance and spell steps are skipped by the step reader until martial and arcane (default 3) |
| text registries | each folder | the lines it fires |

### 8.5 Commands

| Command | Old function |
|---|---|
| `npcs/talk { npc }` | `talkTo` |
| `quests/accept { quest }`, `quests/turn-in { quest }` | `acceptQuest`, `turnInQuest` |
| `shops/buy { npc, index, qty }` | `buy` |
| `items/sell { uids }` | `sellItems` |
| `materials/sell { id, quality, qty }`, `materials/sell-batch { refs, noun }` | `sellStackable`, `sellStackablesBatch` |
| `tutorial/choose-weapon { weapon, shield }`, `tutorial/skip` | `chooseTutorialWeapon`, `skipTutorial` |
| `prestige/now`, `prestige/buy-boon { boon }`, `prestige/leave-review` | `prestigeNow`, `buyBoon`, `leaveReview` |

### 8.6 Requests and events between the systems

New requests: `items/equip-now { uid, slot? }` (the rack), `world/place
{ spot, forget }` (the skip and the start of a run: stop the activity and the
journey, stand at the spot, note it safe, reveal the mapped region, emit
`world/arrived`; `forget` makes the spot the only one discovered, as old
`prestigeNow` did).

Used: `gold/add`, `gold/spend`, `items/grant`, `materials/grant`,
`materials/take-stack`, `materials/grant-graded`, `combat/abandon`,
`levels/grant-xp`, `levels/raise-start`, `skills/grant-xp`,
`skills/grant-xp-direct`, `skills/grant-discovery-xp`,
`skills/check-discovery`, `counters/*`, `log/line`.

Heard: `quests` hears `combat/kill` (kill objectives) and `world/arrived`
(reach objectives). `tutorial` hears `world/arrived` (the gate stamps
`flag:tutorial_done`). Nothing else listens.

Facts (source `quests/done`): `quest:<id>` for each quest turned in.
Facts (source `prestige/legacy`): `boon:<id>` rank, `talent:<skill>`,
`endowment:<attr>`, `skillCap:<skill>`, `foresight`. The readers exist since
port 1 (`src/systems/stats/README.md`).

Registrations: `prestige` calls `registerBandPass` and a new
`registerFloorsSeen` of `ladder`, the pattern of `registerSiteSky`.

### 8.7 Prestige

- `PRESTIGE_UNLOCK`: `slain:f6_great_hall:goblin_warchief` 1. The stronghold
  path (`strongholdHeld`, `autoPrestigeDue`) is step 4.
- `prestige/now`: the harvest, peaks, `floorsSeen` (old `floorsReachedThisRun`
  plus the earlier list), auto boons, then `endRun`. The new run: the counters
  `prestige:count` and `flag:tutorial_done`, every `flag:unlock_*` the old run
  held (old `LOCKABLE_SUBSYSTEMS`), `world/place ascent_foot` with `forget`,
  starting gold (`gold/add`, not earned), `levels/raise-start`.
- Harvest sources with no counter yet: `bestiary:entries` (bestiary, step 3)
  and achievement tiers (achievements, step 3) pay 0.
- The knockout return ends because its slice starts new.

### 8.8 Shops and selling

- Prices: `BUY_MARKUP` 2, `STRANGER_MARKUP` 1.5, the no-arbitrage floor
  (one coin over the best resale), the price seal flag. Charisma reads
  `stats/goldGain`.
- `sellPrice` (`itemValue x goldGain`, at least 1), `materialSellPrice`,
  `gradedUnitPrice`: exported by `items` and `materials`, read by `shops`.
- Socketed runes of a sold item go back to the rune pile.

### 8.9 Floor 0

The rack (spear, sword, dagger, hammer, unarmed; the shield beside a
one-handed pick), the skip, the gate. The cell, the slime and the field are
world content since port 6. The step list reads the world. The stance and
spell steps wait (default 3): the step reader passes over them, and the skip
stamps their flags as the old skip did.

### 8.10 John

`tests/john.ts` here: the old driver for floors 0 to 6 (`through` 3 to 6),
on `runHeadless` and `world/*` commands, from a fresh save, no probe
modifiers. Runs 2 and 3 (floors 7 to 20) are step 4. Known gap before the
run: floor 2's tutor teaches Gather and Lunge to both Johns in the old build;
the tutor waits for step 3 (default 4), so John here fights with no
technique from floor 2 on. `tests/john.test.ts` holds the band 1 bounds that
need no rack pick, and the 2 `it.todo` of `tests/band2.test.ts`.
`scripts/pacing.ts` prints the per-floor table.

### 8.11 Panels

- `quests`: the warden's offer, active quests with progress, turn-in.
- `shops`: the vendors at the current spot, their shelf with prices, buy 1
  and buy 5; selling from the pack and the pouch stays in the item and
  inventory panels (a sell button per row).
- `prestige`: the harvest preview, the button, the boons, the review after a
  prestige.
- `tutorial`: the floor 0 card (step, rack, skip).
- The defeat dialog: a component of `knockout`, mounted by the combat panel
  (decision 29), opened when a lost fight is not followed by a return.
- Every panel reserves its slots; nothing changes size with the tick.

### 8.12 Waits

- Step 3: the system NPCs and their talk-gated quests, teaching, crafting
  objectives (`craft`), favour rewards (`r.favor`, `grantFavorAll`), the
  stance and spell steps, the cookbook carry, bestiary and achievement
  harvest sources.
- Step 4: the stronghold and its automatic prestige, the city key's gate,
  bands 3 and up, festival legacy, the harbor's quests and shops.
- The offline summary dialog (kills, gold, levels): UI step. Its two lines
  of port 6 (ladder end, first calm) are not lost here, because the log keeps
  lines during catch-up (`src/systems/log/README.md`).

## 9. Parity and spine status

Measured 2026-11-17 on the same machine.

### 9.1 John, old and new

Both builds: John skipping floor 0 (rusty sword left in the pack, no
stance, no spell), seeds 42, 7 and 1234, floors 0 to 6. Old: `npm run
pacing -- --through 6 --seeds 42,7,1234 --weapons skip` in `D:\ksgproto28`
at `7c1267b`, nothing edited. New: `npm run pacing`. Game time per segment
(the time the segment took, m:ss), as the old pacing table names them:

| Floor | Old 42 | Old 7 | Old 1234 | Old mean | New 42 | New 7 | New 1234 | New mean | Difference |
|---|---|---|---|---|---|---|---|---|---|
| f1 vermin | 1:29 | 1:11 | 1:34 | 1:25 | 1:31 | 1:28 | 1:03 | 1:21 | -5% |
| f1 | 2:24 | 2:29 | 2:18 | 2:24 | 1:31 | 2:29 | 3:28 | 2:29 | +4% |
| f2 | 2:09 | 3:03 | 2:53 | 2:42 | 2:30 | 2:07 | 2:32 | 2:23 | -12% |
| f3 gate | 4:47 | 3:19 | 4:03 | 4:03 | 3:21 | 4:04 | 4:04 | 3:50 | -5% |
| f3 stairs | 1:22 | 1:12 | 1:16 | 1:17 | 1:17 | 1:15 | 1:20 | 1:17 | +1% |
| f3 | 0:50 | 0:20 | 0:20 | 0:30 | 0:50 | 1:41 | 1:23 | 1:18 | +160% |
| f4 | 8:44 | 5:07 | 7:28 | 7:06 | 8:01 | 5:03 | 5:54 | 6:19 | -11% |
| f5 gate | 0:03 | 0:03 | 0:03 | 0:03 | 0:04 | 0:04 | 0:04 | 0:04 | +33% |
| f5 | 1:00 | 1:32 | 0:38 | 1:03 | 1:01 | 0:42 | 1:03 | 0:55 | -13% |
| f6 gate | 3:38 | 4:17 | 3:18 | 3:44 | 3:27 | 4:26 | 3:46 | 3:53 | +4% |
| f6 | 0:15 | 0:19 | 0:21 | 0:18 | 0:19 | 0:33 | 0:51 | 0:34 | +87% |
| Total to the warchief | 26:41 | 22:52 | 24:13 | 24:35 | 23:51 | 23:53 | 25:28 | 24:24 | -1% |

Knockouts over the climb: old 26, 20, 21; new 24, 23, 24. Character level at
the warchief: old 9, 8, 8; new 9, 8, 9. Gold earned: old 17,118, 10,357,
9,498; new 8,905, 8,400, 10,250. Every new climb ends in the first
prestige (harvest 10, 10 and 11 points) and the next run stands at the Foot.
The full tables: `side-session-notes` of this session group,
`spine-7-old-john-pacing.txt` and `spine-7-new-john-pacing.txt`.

The two boss segments are slower here: the bureaucrat of floor 3 (new
tries/lost 2/1, 4/3, 3/2; old 2/1, 1/0, 1/0) and the warchief (new 1/1,
2/2, 3/2; old 1/0 each). The old John learns Gather and Lunge from floor 2's
tutor; the tutor is step 3, so John here has no technique. The old John was
run once more with the lessons turned off (a scratch script that bundles the
old modules and replaces `Game.prototype.learnFromTeacher` with a no-op;
nothing in the old repository was written): totals 23:22, 24:11, 24:05
(mean 23:53), floor 3 boss 2/1, 2/1, 1/0, warchief 1/0, 1/0, 4/3. Without
the techniques the old build loses boss fights the same way, and its total
is 2% under the new one. The boss rows are a few fights each and swing with
the seed; the gap is the missing techniques plus that noise, not a rule
difference found.

The gold earned differs most (old mean 12,324, new mean 9,185). The old
seed 42 earns 17,118, most of it after floor 4. Not traced further. Gold
pays nothing in the spine's gates past floor 3, and the harvest pays a gold
point at 10,000.

Tolerance proposed (not enforced by a test yet, the user decides): the total
game time to the warchief within 15% of the old mean over the same three
seeds; each segment longer than two minutes of old mean within 35%. Boss
segments and gates under two minutes are reported, not held. Measured: total
-1%; the long segments -12% to +4%. A step 3 port that adds the tutor
should measure again against the old build with the lessons on.

### 9.2 Offline budgets

Measured inside `npm run verify` (each budget project runs alone, after the
unit tests), same machine. The catch-up work (kernel decision 32) measured
each run alone through `scripts/budget-runs.ts`; the table of before, after
and the new budgets is in `docs/KERNEL.md` section 8. After: no fight 1.3 s,
poison 4.9 s, floor 1 4.6 s, floor 6 9.4 to 9.8 s, world floor 4 9.2 to
9.5 s, world floor 6 9.3 to 9.6 s, every run on the outcome digest of
`main`. Budgets now 2,000, 7,500, 7,000, 15,000, 15,000 and 15,000 ms.
Pass 2: floor 6 8.9 s, world floor 4 8.6 to 8.7 s, world floor 6 8.6 to
8.8 s, the others unchanged; the floor 6 and world budgets are 13,500 and
13,000 ms. The poison run is no longer slower than before pass 1 (means
4,750 and 4,761 ms over five alternating pairs).

| Run of 8 hours | Port 6 | Port 7 | Budget |
|---|---|---|---|
| No fight, no condition | 1,231 to 1,242 ms | 1,391 ms | 3,000 ms |
| A poison held | 4,952 to 5,003 ms | 5,242 ms | 8,000 ms |
| Floor 1 table sent to combat (9,673 kills) | 5,237 to 5,368 ms | 5,694 ms | 12,000 ms |
| Floor 6 Tunnels sent to combat (11,328 kills) | 14,368 to 14,899 ms | 15,551 ms | 20,000 ms |
| World: hunt activity, floor 4 Woods Edge (9,834 kills, 4 knockouts) | 18,923 to 19,656 ms | 20,510 ms | 30,000 ms |
| World: hunt activity, floor 6 Tunnels (11,360 kills, 1 knockout) | 18,608 to 19,636 ms | 20,374 ms | 30,000 ms |

One measurement each; port 6 took two to three. The rise of 5 to 13% is
within the spread port 5 saw between runs (11,500 to 13,200 ms on one case)
and was not traced. What port 7 adds to a tick: nothing; no new system has a
tick hook. To the player's stat table: two sources (`quests/done`,
`prestige/legacy`), both empty on a first run. The kill events gain one
subscriber (`quests`, which returns at once with no active kill objective).
The old build took 3 to 5 s for the world runs.

The John climbs are fast: 0.7 to 1.8 s of wall clock for 24 minutes of game
time each (`scripts/pacing.ts` prints it).

### 9.3 Spine status

The spine runs: a new save plays floor 0, Threshold and floors 1 to 6, and
the first prestige starts the second run at the Foot, by commands only
(`tests/john.ts`). Every system folder has a README: 31 folders, the toy
`counter` of the kernel step among them.

What the catch-up session inherits:

- Catch-up, done in part (kernel decision 32, section 8 of
  `docs/KERNEL.md`): the world runs went from 20.4 and 20.5 s to 9.3 to
  9.6 s for 8 hours, floor 6 from 15.6 to 9.4 to 9.8 s, with the same
  outcome digests (`tests/outcomeDigests.ts`). The player's stat block is
  kept while only stats outside `stats/` change, and
  `skills/check-discovery` visits only the skills its tags train. The target
  of 5 s (old build 3 to 5 s) is not met. Pass 2 took the world runs to
  8.6 to 8.8 s and floor 6 to 8.9 s. What remains is spread over the tick
  paths of combat (half of each run), statuses and resources, about 1.4
  million events per 8 hours, and one stat block per monster; no single
  step is above 10%. `docs/KERNEL.md` section 8 lists what was tried.

What step 3 inherits (every `it.todo` tagged step 3, and per system the
README's "Left behind"):

- The six system people and their teaching (the hall tutor's Gather and
  Lunge change John's boss fights: section 9.1), `faces_of_threshold` and
  `a_taste_of_everything`, craft objectives, divine favour on turn-in.
- The stance and spell steps of floor 0; the rack climbs of
  `tests/john.test.ts` then take the spell as the old ones did.
- Readers of the boons for grimoire pages, technique slots and Cook's Notes;
  the bestiary and achievement harvest sources.
- Every system of `docs/REBUILD.md` step 3, with the extension points each
  README lists (martial, spellcraft, arcane, divine, combat).

What step 4 inherits: bands 3 and up, floors 7 to 20, the city key's gate,
the stronghold and its automatic prestige, runs 2 and 3 of John, the
festival, the harbor, Weathersense.

What the UI step inherits: the drawn map plan, the Stations row, the job
strip and the rate chip, the offline summary dialog (its two lines are in
the log already), spare marks (Sell spares), `tutorialFocus`, Wayfinding go
links, Foresight in the skill view, the weather chip.

Open finding: the gold earned by John is 25% under the old build over the
same seeds (section 9.1); not traced.

## 10. Step 3: martial

Done 2026-11-17 on branch `step3-martial`. Design and the full account:
`src/systems/martial/README.md` ("Step 3 design", "Changed while building
(step 3)", "Left behind", "Old rules ported as they are") and
`src/systems/styles/README.md`.

### 10.1 John with the tutor

Floor 2's tutor teaches John Gather and Lunge, as in the old build. Old: the
old build with the lessons on, `npm run pacing -- --through 6 --seeds
42,7,1234 --weapons skip` at `7c1267b` (section 9.1). Before: this
repository at `d0aab95`, no tutor (section 9.1). New: this branch, `npm run
pacing`. Game time per segment, m:ss.

| Floor | Old 42 | Old 7 | Old 1234 | Old mean | Before mean | New 42 | New 7 | New 1234 | New mean | New vs old |
|---|---|---|---|---|---|---|---|---|---|---|
| f1 vermin | 1:29 | 1:11 | 1:34 | 1:25 | 1:21 | 1:31 | 1:28 | 1:03 | 1:21 | -5% |
| f1 | 2:24 | 2:29 | 2:18 | 2:24 | 2:29 | 1:31 | 2:29 | 3:28 | 2:29 | +4% |
| f2 | 2:09 | 3:03 | 2:53 | 2:42 | 2:23 | 2:55 | 2:41 | 2:18 | 2:38 | -2% |
| f3 gate | 4:47 | 3:19 | 4:03 | 4:03 | 3:50 | 3:43 | 3:42 | 4:48 | 4:04 | +1% |
| f3 stairs | 1:22 | 1:12 | 1:16 | 1:17 | 1:17 | 1:17 | 1:17 | 1:10 | 1:15 | -3% |
| f3 | 0:50 | 0:20 | 0:20 | 0:30 | 1:18 | 0:52 | 0:49 | 0:49 | 0:50 | +67% |
| f4 | 8:44 | 5:07 | 7:28 | 7:06 | 6:19 | 7:45 | 7:00 | 6:42 | 7:09 | +1% |
| f5 gate | 0:03 | 0:03 | 0:03 | 0:03 | 0:04 | 0:04 | 0:04 | 0:04 | 0:04 | +33% |
| f5 | 1:00 | 1:32 | 0:38 | 1:03 | 0:55 | 1:06 | 1:07 | 0:41 | 0:58 | -8% |
| f6 gate | 3:38 | 4:17 | 3:18 | 3:44 | 3:53 | 3:45 | 4:05 | 4:09 | 4:00 | +7% |
| f6 | 0:15 | 0:19 | 0:21 | 0:18 | 0:34 | 0:34 | 0:22 | 0:19 | 0:25 | +39% |
| Total to the warchief | 26:41 | 22:52 | 24:13 | 24:35 | 24:24 | 25:02 | 25:04 | 25:32 | 25:13 | +3% |

The two boss segments moved toward the old build: floor 3 from a mean of
1:18 to 0:50 (old 0:30), the warchief from 0:34 to 0:25 (old 0:18). Boss
tries/lost, new: floor 3 2/1, 2/1, 2/1 (before 2/1, 4/3, 3/2; old 2/1, 1/0,
1/0); warchief 2/2, 1/1, 1/1 (before 1/1, 2/2, 3/2; old 1/0 each).
Knockouts over the climb: new 26, 24, 22 (before 24, 23, 24; old 26, 20,
21). Level at the warchief: 9, 9, 9 (old 9, 8, 8). Gold earned: new 12,200,
13,216, 11,924, mean 12,447 (before 9,185; old 12,324): the open finding of
section 9.1 (gold 25% under the old build) closes with the techniques. Every
climb ends in the first prestige (harvest 11 points each).

Against the tolerance proposed in section 9.1 (total within 15%, each
segment over two minutes of old mean within 35%): total +3%; the long
segments -5% to +7%. Boss segments are reported, not held.

### 10.2 Offline budgets

Each run of 8 hours alone through `scripts/budget-runs.ts`, two rounds, same
machine. Pass 2 is `main` at `d0aab95` (`docs/KERNEL.md` section 8).

| Run of 8 hours | Pass 2 | Step 3 martial | Budget |
|---|---|---|---|
| No fight, no condition | 1,316 to 1,359 ms | 1,442 to 1,444 ms | 2,000 ms |
| A poison held | 4,692 to 4,912 ms | 5,203 to 5,359 ms | 7,500 ms |
| Floor 1 table sent to combat | 4,506 to 4,548 ms | 4,977 to 5,080 ms | 7,000 ms |
| Floor 6 Tunnels sent to combat | 8,853 to 8,917 ms | 9,886 to 10,232 ms | 13,500 ms |
| World: hunt, floor 4 Woods Edge | 8,597 to 8,662 ms | 9,526 to 9,748 ms | 13,000 ms |
| World: hunt, floor 6 Tunnels | 8,578 to 8,817 ms | 9,648 to 9,939 ms | 13,000 ms |

Every budget holds. The runs are 7 to 12% slower. What this port adds to
every tick: the styles tick (the effective style read each tick, as the old
`checkStyleSwap`), the styles source (collected again when `statuses/held`,
`items/worn`, `skills/effects`, `resources/locks` or `combat/momentum`
change), and martial's subscriber to `counters/changed` (a set lookup per
counter change). Not profiled. The kills, the generator, the level and the
gold of every run are the same as on `main`; only the state hash changed
(the new slices and fields), and the digests are recorded again in their
own commit.

## 11. Step 3: arcane

Done 2026-11-17 on branch `step3-arcane`. Design and the full account:
`src/systems/arcane/README.md` ("Step 3 design", "Changed while building
(step 3)", "Left behind", "Old rules ported as they are"), the step 3
sections of `src/systems/spellcraft/README.md`, "Readied spells (the arcane
port)" in `src/systems/martial/README.md`, and `src/systems/tutorial/README.md`.

### 11.1 John

The skipping John of `npm run pacing` and of the outcome digests plays no
floor 0 and takes no spell: his climbs are the same as after the martial
port, segment for segment (the digests differ in the state hash only), so
section 10.1 stands and no new table was measured. The rack climbs of
`tests/john.test.ts` take the spell `fire` at the Field, as the old ones
did. With it, 2 of the 12 band 1 climbs lose one vermin fight (both
skipping Johns; no rack climb), and the old bound (at most two) holds
again; it was an `it.todo` measured at 3 of 12 without the spell. First
toll collector, rack climbs, won / ticks: seed 42 sword yes 293, spear yes
169, dagger no 349, hammer yes 198, unarmed no 324; seed 7 sword no 329,
spear yes 135, dagger no 280, hammer no 304, unarmed yes 226.

### 11.2 Offline budgets

Each run of 8 hours alone through `scripts/budget-runs.ts`, two rounds,
same machine, same hour. Step 3 martial is section 10.2.

| Run of 8 hours | Step 3 martial | Step 3 arcane | Budget |
|---|---|---|---|
| No fight, no condition | 1,442 to 1,444 ms | 1,396 to 1,420 ms | 2,000 ms |
| A poison held | 5,203 to 5,359 ms | 4,991 to 4,994 ms | 7,500 ms |
| Floor 1 table sent to combat | 4,977 to 5,080 ms | 4,471 to 4,657 ms | 7,000 ms |
| Floor 6 Tunnels sent to combat | 9,886 to 10,232 ms | 8,457 to 8,730 ms | 13,500 ms |
| World: hunt, floor 4 Woods Edge | 9,526 to 9,748 ms | 8,499 to 8,726 ms | 13,000 ms |
| World: hunt, floor 6 Tunnels | 9,648 to 9,939 ms | 8,761 to 8,926 ms | 13,000 ms |

Every budget holds; no run is slower. The runs are 3 to 15% faster than
the martial measurement. Nothing this port adds runs on the paths these
runs take (no prepared spell, no readied spell; one more call per position
change, a loop over one watch), so the difference is taken to be the
machine between the two sessions, not this code; it was not traced. The
kills, the generator, the level and the gold of every run and every John
segment are the same as on `main`; only the state hash changed (the
spellcraft slice field `utilityReady`), and the digests are recorded again
in their own commit.

## 12. Step 3: divine

Done 2026-11-17 on branch `step3-divine`. Design and the full account:
`src/systems/divine/README.md` ("Step 3 design", "Changed while building
(step 3)", "Left behind", "Old rules ported as they are"),
`src/systems/titles/README.md` (new system), "Divine favour" in
`src/systems/quests/README.md`, "Step 3 (the divine port)" in
`src/systems/spellcraft/README.md`.

### 12.1 John

John's play changed: titles now latch, as in the old build. Every skipping
John earns Procedural Objection on floor 1 (no modifier) and Wanderer
(+5% travel speed at 50 journeys) near the third floor's gate (ticks 6918,
6340, 6850 for seeds 42, 7, 1234). The turn-in of `the_first_ascent` pays
2 favour with each known god; John receives no miracle. Old: section 10.1.
New: this branch, `npm run pacing`. Game time per segment, m:ss.

| Floor | Old 42 | Old 7 | Old 1234 | Old mean | Arcane mean | New 42 | New 7 | New 1234 | New mean | New vs old |
|---|---|---|---|---|---|---|---|---|---|---|
| f1 vermin | 1:29 | 1:11 | 1:34 | 1:25 | 1:21 | 1:31 | 1:28 | 1:03 | 1:21 | -5% |
| f1 | 2:24 | 2:29 | 2:18 | 2:24 | 2:29 | 1:31 | 2:29 | 3:28 | 2:29 | +4% |
| f2 | 2:09 | 3:03 | 2:53 | 2:42 | 2:38 | 2:55 | 2:41 | 2:18 | 2:38 | -2% |
| f3 gate | 4:47 | 3:19 | 4:03 | 4:03 | 4:04 | 3:43 | 3:42 | 4:48 | 4:04 | +1% |
| f3 stairs | 1:22 | 1:12 | 1:16 | 1:17 | 1:15 | 1:17 | 1:16 | 1:16 | 1:16 | -1% |
| f3 | 0:50 | 0:20 | 0:20 | 0:30 | 0:50 | 0:52 | 0:47 | 1:48 | 1:09 | +130% |
| f4 | 8:44 | 5:07 | 7:28 | 7:06 | 7:09 | 5:34 | 10:22 | 8:35 | 8:10 | +15% |
| f5 gate | 0:03 | 0:03 | 0:03 | 0:03 | 0:04 | 0:04 | 0:04 | 0:04 | 0:04 | +33% |
| f5 | 1:00 | 1:32 | 0:38 | 1:03 | 0:58 | 1:31 | 0:39 | 0:37 | 0:56 | -12% |
| f6 gate | 3:38 | 4:17 | 3:18 | 3:44 | 4:00 | 3:21 | 3:21 | 3:09 | 3:17 | -12% |
| f6 | 0:15 | 0:19 | 0:21 | 0:18 | 0:25 | 0:35 | 1:15 | 0:17 | 0:42 | +135% |
| Total to the warchief | 26:41 | 22:52 | 24:13 | 24:35 | 25:13 | 22:54 | 28:04 | 27:22 | 26:07 | +6% |

Against the tolerance of section 9.1 (total within 15%, each segment over
two minutes of old mean within 35%): total +6%; the long segments -12% to
+15%. Boss segments are reported, not held. Before Wanderer latches the
climbs are the arcane port's to the tick: seed 42 through the stairs,
seed 7 through the third floor's gate; seed 1234 reaches that gate 6 ticks
sooner. Floor 4 carries the spread: 5:34 to 10:22, knockouts 10, 19, 16
(arcane: 15, 12, 11; old 17, 9, 14). Boss tries/lost: floor 3 2/1, 2/1,
4/3; warchief 2/2, 5/4, 1/0. Level at the warchief 8, 9, 9 (old 9, 8, 8).
Gold earned 13,357, 14,124, 14,601, mean 14,027 (arcane 12,447; old
12,324). Every climb ends in the first prestige (harvest 11 points each).

### 12.2 Offline budgets

Each run of 8 hours alone through `scripts/budget-runs.ts`, two rounds,
same machine. Step 3 arcane is section 11.2.

| Run of 8 hours | Step 3 arcane | Step 3 divine | Budget |
|---|---|---|---|
| No fight, no condition | 1,396 to 1,420 ms | 1,404 to 1,417 ms | 2,000 ms |
| A poison held | 4,991 to 4,994 ms | 4,481 to 5,005 ms | 7,500 ms |
| Floor 1 table sent to combat | 4,471 to 4,657 ms | 4,204 to 4,655 ms | 7,000 ms |
| Floor 6 Tunnels sent to combat | 8,457 to 8,730 ms | 7,807 to 8,555 ms | 13,500 ms |
| World: hunt, floor 4 Woods Edge | 8,499 to 8,726 ms | 8,446 to 9,071 ms | 13,000 ms |
| World: hunt, floor 6 Tunnels | 8,761 to 8,926 ms | 8,484 to 8,490 ms | 13,000 ms |

Every budget holds. World 4 measured 8,446 and 9,071 ms: one round 4%
over the arcane range, the other under it. The rest are inside or under
the arcane range.
What this port adds to a fight run: one `titles/check` event per kill, per
arrival and per level-up, each a scan of the 11 titles (only the unearned
ones read their conditions). The floor 6 and both world runs earn Slayer
(+2% damage at 100 kills), and their kills, generator and gold changed:
floor 6 11,328 to 11,347 kills, 1 defeat to 0; world 4 9,834 to 9,885;
world 6 11,360 to 11,347, 1 defeat to 0. Floor 1 also earns Slayer and its
kills, generator and gold are unchanged. The digests are recorded again in
their own commit.

### 12.3 Browser check

Desktop width and 375 px. On a dev save edited from the forge page for
favour and an earned title (`ksgb:development:save` only): Receive, the
filter chips, the search box, +1 favor (unassigned) and Wear clicked; no
horizontal overflow at 375 px. Both panels sampled every 0.5 s while a
fight ran at the Cages: no element moved.

Not verified in a browser: a title earned by play (the save was edited),
the turn-in favour (tested headless), the forge form of the `titles`
registry.

## 13. Step 3: alchemy

Done 2026-11-17 on branch `step3-alchemy`. Design and the full account:
`src/systems/alchemy/README.md` ("Step 3 design", "Changed while building
(step 3)", "Old rules ported as they are", "Left behind"), and the READMEs
of the two other new systems, `src/systems/benches` (disciplines and the
bench run) and `src/systems/consumables` (cards and items used). Additions
in other folders are listed in each folder's "Step 3 (the alchemy port)"
section: `world`, `resources`, `combat`, `materials`, `quests`, plus notes
in `martial`, `arcane`, `divine`, `items`, `titles`.

### 13.1 John

Unchanged. No John climb brews a flask or uses an item: every segment
tick, knockout, level and gold figure equals the divine port's (section
12.1); only the end state hash changed (the three new slices). No new
pacing table was measured.

### 13.2 Offline budgets

Each run of 8 hours alone through `scripts/budget-runs.ts`, same machine,
same hour, `main` (0faae8d) against this branch. The machine was slower
this session than during the divine measurement (section 12.2) on both
builds.

| Run of 8 hours | Step 3 divine (12.2) | `main`, this session | Step 3 alchemy | Budget |
|---|---|---|---|---|
| No fight, no condition | 1,404 to 1,417 ms | 1,750 ms | 1,662 to 1,766 ms | 2,000 ms |
| A poison held | 4,481 to 5,005 ms | 6,590 ms | 6,446 to 6,691 ms | 7,500 ms |
| Floor 1 table sent to combat | 4,204 to 4,655 ms | 5,862 ms | 5,659 to 6,130 ms | 7,000 ms |
| Floor 6 Tunnels sent to combat | 7,807 to 8,555 ms | 11,960 ms | 11,360 to 12,163 ms | 13,500 ms |
| World: hunt, floor 4 Woods Edge | 8,446 to 9,071 ms | 11,811 ms | 12,071 to 12,160 ms | 13,000 ms |
| World: hunt, floor 6 Tunnels | 8,484 to 8,490 ms | 11,919 ms | 11,976 to 12,151 ms | 13,000 ms |

Every budget holds. Against `main` measured in the same hour the branch
is within -5% to +3% on every run: no slowdown attributable to the port.
What the port adds to a run: one `alchemy/spend-coating` request per hit
of a weapon blow (no coating: it answers null at once), the `benches` tick
(returns at once with no run), a subscriber to `world/activity-changed`.
Against section 12.2 every run is 25 to 45% slower on both builds: the
machine, not traced. The world runs now sit 7 to 8% under their budget.
The kills, generator, level and gold of every run are unchanged; the
state hash changed (the slices `benches`, `alchemy`, `consumables`), and
the digests are recorded again in their own commit.

Test change outside the new tests: `tests/job.test.ts` "keeps pct inside
0..1 or null across a long mixed run" got a 30 s limit: 2.3 s alone on
the branch, 2.2 s on `main`, over 5 s under the full parallel run.

### 13.3 Browser check

Desktop width and 375 px, on the dev server. On a dev save edited for the
check (`ksgb:development:save` only: stood at the Alembics, 10 Fair and 4
Fine of every reagent, Alchemy 40, healing salves, votive tokens; the save
before the edit is at `ksgb:development:save.before-alchemy-check`): the
step picker, the reading and preview of Smoulderer's Flask (potency 5.29,
13 heat, as the old guide), a run of five (bar, Stop), the Satchel, a
flask thrown at the Cages in a live fight ("hits the Forest Rat for 12"),
the Provisions panel (a votive token offered, a salve used, the cooldown
shown, facts opened on click). No horizontal overflow at 375 px. The
Alchemy panel sampled every 0.5 s while the run went and while fights ran
at the Cages: no box moved or changed size.

Not verified in a browser: an oil worked into the blade and spent in a
fight (tested headless, `tests/alchemy.test.ts`), a word slip or a drill
manual used from the panel (tested headless), the forge forms of the new
registries.

## 14. Step 3: cooking

Done 2026-11-18 on branch `step3-cooking`. Design and the full account:
`src/systems/cooking/README.md` ("Step 3 design", "Changed while building
(step 3)", "Old rules ported as they are", "Left behind") and the README
of the new system `src/systems/meals` (dish slots and claims). Additions
in other folders are listed in each folder's "Step 3 (the cooking port)"
section or note: `benches` (five kitchen records, heat windows, the timed
clock, `duration`), `consumables` (the eater, `consumables/use-now`),
`statuses` (`statuses/set-dose`), `alchemy` (`alchemy/flask-used`).

### 14.1 John

Unchanged. No John climb cooks or eats: every segment tick, knockout,
level and gold figure equals the alchemy port's (section 13.1); only the
end state hash changed (the slices `cooking` and `meals`). No new pacing
table was measured.

### 14.2 Offline budgets

Measured the same hour against `main` (57912c9), alternating; the table is
in `docs/KERNEL.md` section 8. `main` failed four limits on this machine
with no change (floor 1 7,043 ms, floor 6 13,963, world 4 14,270, world 6
14,952). The port adds two tick hooks (`cooking` at order -50: the eating
queue and the hand-off; `meals` at order 50: the claim clocks), as the old
`Game.advance` ran meal steps before and after the conditions: 3 to 6% per
run, about 0.4 microseconds per tick; with both hooks removed the no-fight
run equals `main`. User decision: every budget raised 10%, in its own
commit; the two-hook port kept. The kills, generator, level and gold of
every run are unchanged; the state hash changed, and the digests are
recorded again in their own commit.

Test change outside the new tests: `tests/consumables.test.ts` "food waits
for the cooking port" became "food goes to the eater of the cooking port";
`tests/recipes.test.ts`'s Reading Hall drop case got a 30 s limit (about
3 s alone, over 5 s under the full parallel run).

### 14.3 Browser check

Desktop width and 375 px, on the dev server. Dev save edited for the
check from the forge page (`ksgb:development:save` only: stood at the
Granary Kitchens, raw meat, wild onion, mushroom, herb, salt and fish at
Fair and Superb, Cooking 12; the save before the edit is at
`ksgb:development:save.before-cooking-check`). The Kitchen panel: the
bench tabs, the cook lengths, the slot picker, the ledger ("Fine · 1.80 ·
Superb 0.70 short", judgement +0.80 at Cooking 12), the preview "Fine
Hearty Stew", a cook of 12 units (bar, done), the plate line. A fight
left from the edited save interrupted the first run ("interrupted", the
ported rule); after Abandon the cook made a Fine Hearty Stew and spent
one meat. Provisions: Eat; the dish list read "Fine Hearty Stew: 10m 36s"
(Well Fed 10 minutes times the Cooking 12 duration 1.06) and the
Character panel held Well Fed at dose 1.6. No horizontal overflow at
375 px (the Cook's Book table scrolls inside its box).

Not verified in a browser: the queue after a fight or a knockout, the
eviction of a fourth dish, a Signature, Cook's Notes across a prestige
(each tested headless), the cutting board, the forge forms of the new
registries.

### 14.4 Found while porting (spine era, not cooking)

The new `combat` ticks while the player is knocked out; the old
`tickAction` returned early while recovering. With a hand-set knockout and
a hunt still on, the respawn timer runs out on the floor and a fight opens
on the tick recovery ends. A real knockout stops the hunt, so play is not
affected; `tests/meals.test.ts` stops the hunt loop in its hand-made
knockout case. Not changed here.

## 15. Step 3: smithing

Done 2026-11-18 on branch `step3-smithing`. Design and the full account:
`src/systems/smithing/README.md` (the inventory of old `main`, "Step 3
design", "Changed while building (step 3)", "Old rules ported as they are",
"Panel as built", "Left behind") and `src/systems/crafting/README.md` (the
smelting recipes as a craft activity). Additions in other folders are in
each folder's "Step 3 (the smithing port)" section: `items` (the forged
item, `registerForging`, `items/grant-forged`), `benches` (the `forging`
record, `assembles`, the `forge` field and clock), `materials`
(`materials/take`), `world` (`registerCraftKind`, the craft activity).

The brief named `origin/smithing-modular` as unmerged. It is merged: pull
request 21, merge `2de9981`, an ancestor of old `main`; the branch has no
commit `main` lacks. The anvil on `main` is that slice 1, and it is what
was ported. Slices 2 and 3 of the plan document were never built.

### 15.1 John

Unchanged. No John climb through floor 6 forges or smelts (the old John
smelts ingots on floor 11). `npm run pacing` on this branch and on `main`
(5e6f31f) print the same tables for seeds 42, 7 and 1234, wall clock aside.
Every outcome digest changed in the state hash only (the slices `smithing`
and `crafting`); kills, generator, level, gold and every John segment are
unchanged. The digests are recorded again in their own commit.

### 15.2 Offline budgets

Each run of 8 hours through `scripts/budget-runs.ts`, `main` (5e6f31f, a
worktree) and this branch alternating, two rounds, same hour, ms:

| Run of 8 hours | `main` | Step 3 smithing | Budget |
|---|---|---|---|
| No fight, no condition | 1,718 to 1,746 | 1,642 to 1,778 | 2,200 |
| A poison held | 6,369 to 6,644 | 6,322 to 6,722 | 8,250 |
| Floor 1 table sent to combat | 5,772 to 6,034 | 5,728 to 6,048 | 7,700 |
| Floor 6 Tunnels sent to combat | 11,246 to 12,054 | 11,321 to 11,936 | 14,850 |
| World: hunt, floor 4 Woods Edge | 11,175 to 11,644 | 11,419 to 12,054 | 14,300 |
| World: hunt, floor 6 Tunnels | 11,288 to 11,484 | 11,819 to 12,085 | 14,300 |

Every budget holds; `npm run verify` passes. The branch is within the
spread of `main` on five runs; world 6 is 3 to 5% above `main` in both
rounds, inside its budget. What the port adds to a run: no tick hook; one
`forged` check per `itemDefOf` and `stackKey`; `spotActivities` returns a
cached list for a spot with recipes (none on these runs' spots). Not
profiled.

### 15.3 Browser check

Desktop (1024 and 1600 px) and 375 px, on the dev server, by play on the
dev save (`ksgb:development:save`; the save before the check is at
`ksgb:development:save.before-smithing-check`): walked to the Forges,
smelted iron ingots from scrap (Craft Iron Ingot; the bronze line hidden),
bought hardwood and leather from Ferra Ostwind, forged one Iron Sword at
the Anvil (run bar, Stop, form chart 1 of 44; it rolled below Fair:
damage +6), equipped it from the pack against the worn Rusty Sword. No
element of the panel moved while the run went (sampled every 0.5 s for
10 s). No horizontal overflow at 375 px. At 1024 px the three columns
clipped the middle one; the one-column breakpoint was raised from 47rem to
52rem. The comparison row previews on click and the table does not move.
No console errors.

Not verified in a browser: the form chart view, the second head, a run of
several pieces and "until out of stock" (tested headless), the bronze line
after studying the pattern (tested headless), the forge forms of the new
registries.

### 15.4 Old rules ported as they are

Listed in the two READMEs. In short: a forged piece never has rune slots;
the grade is rolled from Smithing with no cap; a ring or an amulet has no
stats; the STR requirement counts the haft and the strap; `benches/start`
does not check the spot has an anvil; an unaffordable craft can be selected
and stops on its first tick; the craft bar resets to 0, not carrying over.
