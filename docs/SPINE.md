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
| Monsters | 24 of 146 | `data/monsters.data.ts` |
| Gear | 10 drops, 5 rack items, 1 starting item | `data/items.data.ts` |
| Materials | 9 | `data/materials.data.ts` |
| Statuses inflicted by monsters | 4 (punctured, bleeding, concussed, wet) | `data/statuses.data.ts` |
| Monster techniques | 6 | martial data |
| Monster spell sentences | 2 (`goblin_firetongue`) | monster data |
| Quests | 3 | `data/quests.data.ts` |

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
| 5 | Monster techniques (6) and monster spell casts (2 sentences) | `combat.ts:2224-2539`, the needed part of `martial` and `arcane` |
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
| 1 | `systems/conditions.ts` | `counters` (`conditions.ts`) | Condition cases of old `attributes.test.ts` and `superattrs.test.ts`, in `counters.test.ts` | Nothing: all seven kinds. `equippedTag`, `quest` and `boon` read facts the later ports state |
| 1 | `systems/ledger.ts` | Not ported. It is the fight ledger, not the counters | Transcript cases of old `ledger.test.ts`, in `log.test.ts` | The whole file, to port 4 |
| 1 | `systems/log.ts`, `text/log.ts` | `log` | `log.test.ts`: rendering, grouping, feed, floating runs, hunt lines, templates | Log is stored during catch-up; cases that need statuses, activities or combat; `logtext.test.ts` call-site scan; the other templates of `text/log.text.ts` |
| 1 | `systems/clock.ts`, calendar part of `data/climate.data.ts` | `clock` | `clock.test.ts`, whole | Weather and climate tables; the starting spot assertion |
| 1 | `systems/progression.ts`, `data/progression.data.ts` | `progression` | Curve cases of old `skills.test.ts`, in `skills.test.ts` | Nothing |
| 1 | `systems/derived.ts` | `stats` (pipeline, breakdowns); cache and fingerprint replaced by the kernel | `derivedcache.test.ts`, `attributes.test.ts` (old `attackspeed.test.ts`, stat cases of old `breakdown.test.ts`) | Every modifier source of an unported system (list in `src/systems/stats/README.md`); cache cases on forged items, festival bonus, cooked statuses, condition decay; damage breakdowns |
| 1 | `systems/attributes.ts`, `data/attributes.data.ts` | `attributes` (training), `stats` (effective attributes, modifier foundations) | `attributes.test.ts` | `equip`, `unequip`, `canEquip`; practice shaping; the XP router |
| 1 | `systems/skills.ts`, `data/skills.data.ts` | `skills` | `skills.test.ts` | Kills spraying XP; the bestiary payout; speechcraft through quests; switching style by command; practice shaping |
| 1 | `systems/levels.ts`, `data/levels.data.ts` | `levels` | `levels.test.ts`, with `encounterLevel` from old `desert.test.ts` and `rewardLevel` from old `dynamicLevels.test.ts` | `dynamicLevelBonus`, `checkFloorClears`, `syncBandPositions`; what pays level XP; Head Start; the old save migration |
| 1 | `systems/resources.ts`, `systems/stamina.ts`, `systems/health.ts`, `data/resources.data.ts`, `checkResourceLocks` of `game.ts` | `resources` | `resources.test.ts` (old `regen.test.ts`, `stamina.test.ts`) | Pace per activity and `combatRegenMult`; the condition and ledger observers of heal and damage; exertion in a fight; upkeep per swing |

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
