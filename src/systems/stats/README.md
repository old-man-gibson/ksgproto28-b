# stats

The stat block: derived stats and effective attributes of an entity.

Port of: the pipeline of old `systems/derived.ts` (`baseStats`,
`computeDerivedStats`, the damping pass of `collectModifiers`, `scopedMult`,
`statBreakdown`) and the modifier and attribute layer of old
`systems/attributes.ts` (`resolveModValue`, the `push` closure of
`collectBaseMods`, `effectiveAttrsFrom`, `attrValueFrom`, `formulaAttrFrom`,
`groupModLines`, `attrBreakdown`).

## How it fits the kernel

This system holds no state and registers no modifier source. It declares the
resolver of every target under `stats/` (`docs/KERNEL.md` section 6). The old
`collectModifiers` was one function that read fifteen systems; here each of
those systems registers a source, and the resolver turns the collected list
into the block. The cache and the stale check are the kernel's.

Files: `keys.ts` (stat keys, attribute ids, damage types), `mods.ts`
(modifier type, builders, facts), `pipeline.ts` (the formulas), `monster.ts`
(the monster formulas),
`breakdown.ts` (tooltips), `index.ts` (the declaration and the read helpers).

## Targets

A modifier of this pipeline has `stat: 'stats/<target>'`:

| Target | Meaning |
|---|---|
| `<stat key>` | `add` adds. `mult` multiplies by (1 + value). |
| `<attribute id>` | The same two layers, on an attribute. |
| `<stat key>:<tag>` | Scoped: applies only to work that carries the tag (`scopedMult`). |
| `@...` | A fact: an input another system hands to the pipeline. |

A content modifier (`modifierSchema`: `stat`, `op`, `value`, `perLevel`,
`levelCurve`, `requiresTag`, `requiresStyle`, `requiresMonsterTag`,
`fromStat`, `undampened`) becomes a pipeline modifier with `contentMod`. The
gates travel with the modifier and the pipeline applies them, because only it
knows what is wielded, which style is fought in and what the target is.

## Order of the pipeline

1. Gates (`requiresTag`, `requiresStyle`, `requiresMonsterTag`), `scaleBy`,
   damping.
2. Effective attributes: base, adds, mults, endowment, floor of 1. Fusion and
   the attribute ceiling are applied on read.
3. Base stats from the attributes (`baseStats`).
4. Stat adds, then stat mults.
5. Attack speed, converging: each source multiplies the remaining attack time
   by (1 - v), held to [0.5, 2] per source.
6. Clamps and rounding. Attack time under 5 ticks becomes `extraSwings`.
7. Resistance overrides, the resistance cap (itself a stat), the floor.
8. Modifiers scaled by another stat (`fromStat`).

## What the table holds

`stats/<key>` for the 67 stat keys, and per attribute `stats/attr:<id>`
(checks read this: fused components summed), `stats/eff:<id>` (no fusion) and
`stats/formula:<id>` (held to the attribute ceiling). Also
`stats/unarmedDamage`, `stats/tag:<tag>`, `stats/fact:<name>`,
`stats/uncapped:<res key>` and the scoped sums. Read them with the helpers in
`index.ts`: `statOf`, `statBlockOf`, `attrValue`, `effectiveAttr`,
`formulaAttr`, `finalAttributes`, `hasWieldTag`, `factValue`,
`uncappedResistance`, `scopedMult`, `unarmedDamage`.

The variant `vsVariant(tags)` is the block against a target that carries the
tags: modifiers with `requiresMonsterTag` apply in it and not in the plain
block.

## Left behind: where each later system plugs in

Nothing below is stubbed away. Each rule of the old pipeline is ported and
tested with a test-only source; the system that feeds it is not ported yet.

| Old read | The later system does this |
|---|---|
| Achievement tiers, the festival bonus, combat buffs | Each registers a source with its modifiers. Titles do since the divine port (`titles/held`). |
| The style fought in, style mods, exertion mods, momentum | The styles system returns `styleFact(id)` and its modifiers. A source that reads `exerting` or a pool lock declares `dependsOn: ['resources/locks']`. |
| The fast's dulling of penalties (`fastGuard(...).ward` in `collectBaseMods`) | Not decided. The old code multiplied every negative status modifier by (1 - ward). A source may not read a derived value, so the mutagens port states the ward as a fact and the pipeline applies it to negative modifiers of origin `status`. |
| Fused super-attributes (`state.fused`) | `fuseFact(a, b)`. The fusion's name in the attribute breakdown is not carried. |
| Talent (`talentBonus`) | `scaleFact('talent:<skill id>', bonus)`. The skills source marks its effects with `scaleBy`. The "(talent +x%)" label suffix is not shown. |
| Endowment (`endowmentBonus`) | `endowmentFact(attr, bonus)`. |
| Chromosome mods (`mutagens`) | A source; `fromStat` is supported. Body size and arm grants go to the `items` system through its `items/set-bearer` request. |
| Carved runes socketed in gear (`resolveRune` of a carving) | The runecarving port extends `resolveRune` in `src/systems/items/defs.ts`; the source `items/worn` already returns rune modifiers with origin `rune`. |
| Forged items (`itemDefOf` of a forged instance) | Modular smithing adds its branch to `itemDefOf` in `src/systems/items/defs.ts`. |
| A title's immunity to a condition (`TitleDef.immune`) | `namedFact('statusImmune:<status id>', 1)` or `namedFact('statusImmuneElement:<damage type>', 1)`. The statuses system reads them. |
| Quest done, boon rank, Foresight, skill cap raises | `namedFact('quest:<id>', 1)`, `namedFact('boon:<id>', rank)`, `namedFact('foresight', 1)`, `namedFact('skillCap:<id>', n)`. |

## The monster case

An entity is a monster when a source states `monsterFact` for it (level,
innate armour, regeneration, innate resistances) next to its `baseAttrFact`
attributes. `computeBlock` then hands the collected list to `monster.ts`,
the port of old `systems/monsterStats.ts` (`statsFromAttrs`, the modifier
layers, `applyDerivedMods`, the overrides and the floor, the clamp). The
entity is collected by the same sources, cached by the same kernel record
and checked by the same `staleStats`; only the formulas differ.

| | Player | Monster |
|---|---|---|
| Attributes | Floored at 1; fusion, ceiling, endowment | The stated base, adds, mults. No floor |
| Max HP | `40 + 10 x CON` | `12 + 7 x CON`, rounded |
| Damage | `2 + 1.2 x STR` | `1.5 + 1.1 x STR` |
| Speed | `50 x (1 + 0.015 x DEX)` on a bar of 1000 | `(1000 / 24) x (1 + 0.012 x DEX)`, at most `1000 / 6` |
| Dodge | Converging, cap 0.75 | `0.003 x DEX`, at most 0.35 before modifiers; clamp 0.9 |
| Armour | `0.3 x CON` | The innate armour of the fact `x (1 + 0.05 x (level - 1))` |
| Attack speed | Converging per source | Plain multiplier |
| Resistances | Cap is `resistCap` (0.75) | Held to [-1, `resistCap`] (0.9) |
| Gates, `scaleBy`, damping, the attribute ceiling | Applied | Not applied |
| A modifier on a stat the body lacks | An error | Ignored (`MONSTER_STAT_KEYS`) |

The block of a monster holds every stat key: the keys a monster does not
have are 0. `stats/uncapped:<res key>` is the resistance before the clamp
where the clamp changed it; condition immunity reads it.

## Filled

- Spine port 4, `combat` (source `combat/monsters`): the monster fact and
  the attributes of every enemy of the open fight, built by
  `src/systems/monsters`.

- Spine port 3, `items` (source `items/worn`, depends on `skills/effects`):
  equipment, affixes, catalogue runes, hand bonuses and the fit scale
  (`collectBaseMods`), with origin `item`, `affix`, `rune` or `handBonus`
  and the slot; `equippedTags` as `wieldTagFact` per tag and `armedFact`;
  the oversize and undersize penalties as `attackSpeed` and `damage` mult
  modifiers.
- Spine port 2, `statuses` (source `statuses/held`): status mods scaled by
  effective intensity (`statusMods`), damping (`statusDampingFor` as
  `dampFact`), resistance overrides and the floor (`statusResOverrides`,
  `statusResFloor`), the attribute ceiling (`attrCeiling`).

## Differences from the old build

- `attrValue` is one value here. The old build computed it for gates from
  `collectBaseMods` (no chromosome, style or lock modifiers) and for the stat
  formulas from the full list. The two differ only if a chromosome modifier
  targets an attribute.
- Modifiers are summed in source order, which is system order here and was
  the order of one function there. A sum of the same numbers in another order
  can differ in the last binary digit.
