# monsters

The monster registry and what a species is before a fight. No state.

Port of: old `data/monsters.data.ts` (all 131 records, tiers, modifier
tiers, rarities, spawn weights), the tag registry of old
`data/bestiary.data.ts`, `monsterTags`, `monsterTagSet` and
`monsterSizeRank` of old `systems/bestiary.ts`, and the species half of old
`systems/monsterStats.ts` (`kitOf`, `innateArmor`, `innateResistances`,
`TAG_ARMOR`, `TAG_RESISTANCES`, `baseMonsterAttrs`, `rollMonsterAttrs`,
`biasAttrs`, `scaledMonsterAttrs`, `penetrationOf`, `penetrationProblems`).

## Where the formulas are

The formulas that turn attributes into a stat block (`statsFromAttrs`, the
modifier layers, the clamp) are the monster case of the shared stat path:
`src/systems/stats/monster.ts`. An entity is a monster when a source states
`monsterFact` for it; `combat` states it for every enemy of a fight
(source `combat/monsters`). The player and a monster go through the same
sources, the same cache and the same resolver; the resolver selects the
formulas by the fact.

`monsterFactOf(defId, level, kit)` builds the fact from a species: innate
armour (declared, else the hardest material of its tags), innate
regeneration, innate resistances (declared per type, else what its tags
imply at its tier). `speciesStats` is the block of a species from
attributes, with no entity, for the bestiary and the spawn gate.

## Content

| Registry | Records | Notes |
|---|---|---|
| `monsters` | 131 | Whole old registry. |
| `monster_tiers` | 7 | List order is the tier step of `TAG_RESISTANCES`. |
| `modifier_tiers` | 4 | `weight` is the old `MODIFIER_WEIGHTS` entry. |
| `rarities` | 4 | `weight` is the old `RARITY_WEIGHTS` entry. |
| `monster_tags` | 50 | |

Converted with `node scripts/convert-content.mjs monsters monster_tiers
modifier_tiers rarities monster_tags`. Three fields differ from the old
literals: `group.weights` is a list of `{ size, weight }`; a psionic
`cast.shape` is a list of `{ axis, value }`; an application writes
`permanent: true`.

References checked by the validator: `tags` (monster tags), `tier`,
`escorts` (monsters), `inflicts` and `wears` (statuses). `loot` uses
`dropTableSchema` of `loot`; `tests/monsters.test.ts` runs `dropTableIssues`
and `monsterIssues` on every record.

Fields that point at registries not ported yet are plain strings: a rotation
entry's `technique`, a cast's `words`, `litany` and shape axes. `art` is the
portrait file name of the old build; the files are licensed art and are not
in this repository.

## Left behind

- The bestiary (knowledge, field notes, `veil`): `veil` is kept as data and
  not read.
- `penetrationProblems` takes the list of early-floor appearances as an
  argument. `tests/monsters.test.ts` builds it from the spots of `world`.
- `monsterMind` and `mindInDebt` are in `combat`: they read a live specimen.

## Old rules ported as they are

- The task text counted 146 monsters. The old registry holds 131 records at
  `7c1267b`; all 131 are here.
- `monsterResistance` (the species layer for the bestiary) clamps to
  [-1, 0.9] and reads the declared block only, not the tags. A live monster
  reads its tags.
