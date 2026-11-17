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
