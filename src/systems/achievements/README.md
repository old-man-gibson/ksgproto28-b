# achievements

Tiered goals on a counter. A tier is claimed when its counter reaches the
threshold; every claimed tier gives its bonus for the rest of the run.

Port of: the tier half of old `systems/achievements.ts`
(`checkAchievements`, `tierNumeral`; the counter half is `counters`),
`data/achievements.data.ts`, the achievement half of `collectBaseMods`
(old `systems/attributes.ts`), the `achievements.claimed` log line, and the
achievements half of `ui/panels/AchievementsPanel.svelte` (the titles half
is `titles`). Step 4 port L (`docs/CONTENT.md` section 5.1).

Imports: `counters`, `items` (`describeMod`, `fmt`), `log`, `monsters`
(tag names), `stats`. `prestige` and `titles` import this system.

## Slice

Version 1: `{ claimed: Record<id, tiers> }`. A new run starts with none: the
old prestige rebuilt the state without them.

## Content

`achievements` (10 records, the old data file; `descTemplate` is `desc`),
`achievements_text` (the claimed line).

| Id | Counter | Thresholds |
|---|---|---|
| `slayer` | `kills` | 100, 1000, 10000 |
| `honed_body` | `attr:str` | 10, 25, 50 |
| `wanderer` | `travel:trips` | 10, 50, 200 |
| `fortune_seeker` | `gold:earned` | 100, 1000, 10000 |
| `miner` | `gather:iron_scrap` | 5, 10, 50 |
| `slime_kills` | `kills:tag:slime` | 5, 10, 50 |
| `inorganic_kills` | `kills:tag:inorganic` | 5, 25, 100 |
| `questmaster` | `quests:completed` | 3, 6, 12 |
| `artisan` | `crafts` | 10, 100, 1000 |
| `student` | `skill:levels` | 25, 100, 500 |

## When a tier is claimed

On `counters/changed` for a counter an achievement reads: every tier whose
threshold the new value reaches, in order. Each claim touches the source,
sends `achievements/claimed { achievement, tier }` and logs
"🏆 Achievement: <icon> <name> <numeral>." (kind `achievement`). `titles`
hears `achievements/claimed` and runs its check (the old titles check
listened on `achievement`). A counter
set lower takes nothing back.

## Modifiers

Source `achievements/held`, player only, origin `achievement`: each claimed
tier's `bonus`, labelled `<name> <numeral>`. `requiresMonsterTag` travels
with the modifier; the stats pipeline applies it against a target only.

## Harvest

`totalTiers` is the harvest source `achievements` of `prestige` (3 tiers per
point).

## Skip reasons

None: there is no command, and a counter no achievement reads is not an
action.

## Changed while porting

- The old check ran inside `bumpStat`, in the same call as the write. Here it
  runs on the `counters/changed` delivery. The claim, its line and the
  bonus land in the same handler chain.
- Panel: one list of rows; a row opens on click to list each tier, its
  threshold and its bonus. The old "Mastered!" reads "Goal: all tiers
  claimed".

## Files

| File | Holds |
|---|---|
| `index.ts` | Registry, slice, source, check, view. |
| `AchievementsPanel.svelte`, `panel.ts` | The panel. |
| `migrations.ts` | None yet. |

Tests: `tests/achievements.test.ts`, the hunter case of
`tests/hunters.test.ts`, the questmaster case of `tests/quests.test.ts`.
