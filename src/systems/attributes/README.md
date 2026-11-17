# attributes

The six attributes: trained level and XP, training ranks and milestones. Also
the home of the character panel.

Port of: the training half of old `systems/attributes.ts` (`attrXpNeeded`,
`grantAttrXp`, `grantAttrXpSplit`, the training block of `collectBaseMods`,
`attrName`) and `data/attributes.data.ts`. The effective-attribute layer is in
the stats system.

## Slice

`{ attrs: { str, dex, con, int, wis, cha } }`, each `{ level, xp }`. `level`
is the trained level and starts at 1. A bonus never raises it.

## Requests

| Event | Effect |
|---|---|
| `attributes/grant-xp` `{ attr, amount }` | Adds XP to the trained level and takes every level it pays for, on the `attribute` curve. |
| `attributes/grant-xp-split` `{ weights, amount }` | One grant per attribute with a weight. Weights scale the amount independently; nothing is normalised. |

A level-up emits `attributes/levelup { attr, level }`, once per level, and
raises the counter `attr:<id>` to the value checks read (`attrValue`).

The amount is taken at face value. The `trainXp` stat is applied by the
system that grants, as in the old build.

## Modifier sources

| Source | Returns |
|---|---|
| `attributes/trained` | The trained level of each attribute, as the base fact of the stat pipeline. |
| `attributes/training` | Rank bonuses and milestone bonuses, cumulative. Both read the trained level. |

Both return nothing for an entity other than the player.

## Content

- `attributes`: id, name, icon, art key.
- `attribute_training`: per attribute, the ranks (`tierNames`, at 1, 21, 41,
  61, 81) with their bonuses, and the milestones. The old
  `standardMilestones` generator is written out: +1 at every level ending in
  5, +1% at every level ending in 0, up to 100.

Intelligence has three hand-written milestones in the old data instead of the
standard list: +1 Skill XP at 5, +2 INT at 7, +10% INT and +10% Max Mana at
10. They are ported as they are.

## Panel

`CharacterPanel.svelte`, title "Character": level and level XP, the date and
time, the five pools with their locks and the exertion toggle, the six
attributes, and the skill tree. It reads the views of the attributes, levels,
resources, skills and clock systems. It is in this folder because a panel
belongs to one system folder.

Layout rules it follows: every number that changes per tick is in fixed-width
digits and does not wrap; each pool reserves one line for its lock name; bars
are not positioned elements.

## Skip reasons

- `attributes/grant-xp`: unknown attribute.

## Left behind

- Practice shaping (`practiceXp`): a grant inside a practice fight is shaped
  by the trained level. No hook here; the granting system shapes the amount
  before it asks.
- The XP router (`setXpRouter`, Weakest Weapon Master past its ceiling).
- Item requirements (`canEquip`): the items port.
