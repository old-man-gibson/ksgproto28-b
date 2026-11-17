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
| 1 | Counters and conditions, log, clock, character: attributes, skills, levels, resources, derived stats; entity stats in the kernel | `ledger`, `conditions`, `log`, `clock`, `progression`, `attributes`, `skills`, `levels`, `resources`, `stamina`, `health`, `derived` |
| 2 | Statuses | `statuses`, `conditionHarm` |
| 3 | Items: inventory, equipment, wield, materials, gold, drop tables | `inventory`, `equipment`, `wield`, `stash`, drop code in `combat.ts:1586-1700` |
| 4 | Combat core: spawn, rotation, player attack, enemy attack, dodge, parry, typed damage, kill and defeat events | `combat.ts`, `monsterStats`, `huntrest` |
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
