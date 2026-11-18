# items

The pack, the worn gear, the rune pile and the stronghold stash.

Port of: old `systems/equipment.ts` (`equipItem`, `unequipSlot`, `canEquip`,
`wearIfFree`, `itemValue`, `itemName`, `nextUid`), `systems/wield.ts`,
`systems/inventory.ts`, the item half of `systems/stash.ts`, `createItem`,
`grantRune`, `findItem`, `resolveRune` and the rune-slot roll of
`systems/runes.ts`, the equipment loop of `collectBaseMods` and
`equippedTags` of `systems/attributes.ts`, the size penalties of
`systems/derived.ts`, `data/items.data.ts`, the catalogue of
`data/runes.data.ts`, and `compareToWorn` of `ui/lib/gearCompare.ts`.

## Files

| File | Holds |
|---|---|
| `defs.ts` | Schemas and types: items, affixes, runes, slots, sizes. `itemDefOf`, `itemName`, `itemValue`, `resolveRune`. |
| `wield.ts` | Hand and size rules, as pure functions on the equipment map and the grant set. |
| `runeslots.ts` | Rune-slot size class, ceiling and roll. |
| `inventory.ts` | Categories, rarity, stacking, sorting. Pure. |
| `compare.ts` | What a piece gives in a slot, and the difference from the worn piece. Pure. |
| `format.ts` | `describeMod`, `fmt`, `pct`, `condText`. |
| `index.ts` | The slice, commands, requests, the stat source, the view. |

## Slice

```
{ uidCounter, inventory: ItemInstance[], equipment: { <slot>: ItemInstance },
  runes: { <rune id>: count }, stash: ItemInstance[], bearer: { grants, size } }
```

An instance is `{ uid, defId, affix?, slots?, runes?, size? }`. `affix` is a
copy of the name and modifiers, as in the old build. A new character holds
the rusty sword (uid 1, one rune slot) in the pack, not equipped.

## Rules

- Slots: `weapon`, `offhand`, `hand3` to `hand6`, `head`, `chest`, `hands`,
  `legs`, `feet`, `back`, `accessory`. `HAND_SLOTS` are the first six.
- `wieldScale(def, slot)`: 1 where a piece belongs. A one-handed weapon in an
  off hand gives 60%. An off-hand piece in the main hand gives 75%, or 100%
  when it has a `mainHand` bonus. A two-hander goes in no off hand.
- Hands are a budget. A body has `2 + arms:+N` arms. A two-hander costs two
  arms, or one with `onehand:*`, `onehand:<tag>`, or in a grip the mind holds
  (`telekinetic:N`: the last N grips). On equip, the piece in the target slot
  comes off, then held pieces in hand order until the newcomer fits.
- Requirements are conditions (`canEquip`), read with the condition reader of
  the player: effective attributes and held skills.
- Size: armour gives `1 - 0.65 x steps` of itself, in either direction, never
  under 0. A weapon too big costs 18% attack speed per step; skill forgives
  5% of that per 10 levels of the governing weapon skill, up to 90% (50% for a
  two-hander or an off-hand piece). A weapon too small costs 22% damage per
  step, at most 90%.
- A hand bonus (`mainHand`, `offHand`) is never scaled, counts only in the
  hand it names (`weapon` and `offhand`), and with `pairedWith` only while
  the other of those two hands holds an item with that tag.
- Rune slots are rolled at generation by size class (`SLOT_WEIGHTS`). Rarity
  is not declared: an affix counts 2, each slot 1; 1 uncommon, 3 rare, 5
  epic. Value: base x 1.5 with an affix x (1 + 0.3 per slot).

## Commands

| Command | Effect |
|---|---|
| `items/equip` `{ uid, slot? }` | Equips from the pack into `slot`, default the slot of the item. Logs. |
| `items/unequip` `{ slot }` | Moves the piece to the pack. |
| `items/take-from-stash` `{ index }` | Moves a kept item to the pack under a new uid. Logs. |

## Requests

| Request | Answer |
|---|---|
| `items/grant` `{ defId, size?, affixChance? }` | Mints an item into the pack. A copy of it. Draws: slots, then the affix chance when given, then the affix when it lands. |
| `items/wear-if-free` `{ slot, item }` | Places the item when the slot is empty, the requirements hold, the body has the hand and the arms budget has room. Whether it was placed. |
| `items/grant-rune` `{ id, qty?, silent? }` | Adds to the rune pile. Logs unless `silent`. |
| `items/stash` `{ item }` | Puts a keep-marked item in the stash. `false` for any other. |
| `items/set-bearer` `{ grants, size }` | States the body that wears the gear. |
| `items/take-weapon` | Takes the wielded weapon out of the hand, for a martial weapon state (grounded, impaled, sheathed). The instance, or null with an empty hand. Step 3. |
| `items/give-back` `{ item }` | Hands a weapon back: to the weapon hand when it is empty, else to the pack, with no requirement check (old `reclaim` of `systems/martial.ts`). `'hand'` or `'pack'`. Step 3. |
| `items/drop-worn` `{ slot }` | Takes a worn item off into the pack, for a caller that needs the outcome in its own handler (spine port 4: a jolt in a fight makes the bearer drop the weapon). The name of the item's definition, or null when the slot was empty. |

## Modifier source

`items/worn`, player only, `dependsOn: ['skills/effects']` (the oversize
forgiveness reads skill levels). It returns:

- `wieldTagFact(tag)` per tag of every worn piece and `armedFact()` when the
  weapon slot is filled. The condition kind `equippedTag` reads these: this is
  the fact the counters port left to this one.
- Per worn piece, scaled by `wieldScale x sizeFit`: the item modifiers
  (origin `item`), the affix modifiers (`affix`), the modifiers of each
  socketed catalogue rune for the context of the item (`rune`). Each carries
  the slot in its origin, which status damping selects by.
- The hand bonus, unscaled (origin `handBonus`).
- The oversize and undersize penalties, as `attackSpeed` and `damage` mult
  modifiers labelled "Oversized by N steps" and "Undersized by N steps".

Touched by every command and request that changes `equipment` or `bearer`.

## Reads

`itemDefOf`, `findItem`, `weaponDef` (bonus damage and damage type of the
held weapon, for combat), `canEquip`, `grantsOf`, `wielderRank`,
`keepMarked`, `carriedStash(state, elsewhere)`, `handSwingShare`,
`floatingSlots`, `twoHandedWeapon`, `handTakenBy`, `arrangeInventory`,
`compareToWorn`.

## View

`slots`: one row per slot the body has, filled or not, in slot order, so the
equipment list keeps its length. `inventory`: one row per pack item with
name, emoji `icon`, `art` (an icon name; the files are bought art and are not
in this repository, so a panel shows the emoji), facts as label and fact,
`canEquip`, `requires`, and per slot it may take the wield note and the
comparison with the worn piece. `runesOpen`, `runes`, `stash`, `arms`.

## Panel

`panel.ts` declares the equipment panel (`EquipmentPanel.svelte`): one row
per slot of the view, each `--tap` high whether filled or not, a `Take off`
button per row (disabled on an empty slot), and the facts of the selected
slot in a box of fixed height that scrolls inside. `Pack.svelte` is the pack
list, mounted by the inventory panel of the `materials` folder: stacks
(`arrangeInventory`), a sort choice, the facts of the selected item, one
`Equip: <slot>` button per slot it may take with the wield note and the
comparison against the worn piece. The list and the detail box have fixed
heights. Checked in a browser at 1280 and 375 pixels wide: equipping and
unequipping moved no element.

## Content

- `items`: 47 records, the whole old registry except the generated
  `forged:<class>` stubs.
- `affixes`: 5 records. The old list had no ids; the id is the name in lower
  case. List order is the order the drop code indexes.
- `runes`: the 11 catalogue runes. `effects` is a list with a `context`
  field; the old literal was a map. `techniqueMods.technique`, `exitTo` and
  `grantsFork` are plain strings until the martial registries exist.
- `items_text`: the log templates.

Converted with `node scripts/convert-content.mjs items affixes runes`.

## Skip reasons

- `items/equip`: `item <uid> is not in the pack`; `item "<defId>" has no
  definition`; `requirements not met for <name>: <requirements>` (also a
  log line, as in the old build); `<name> cannot go in the slot "<slot>"`
  (also a log line).
- `items/unequip`: `nothing is worn in the slot "<slot>"`.
- `items/take-from-stash`: `the stash holds no item at index <n>`; `the
  stash is shut during a festival attempt`.

## Plug points for later ports

| Old read | Where the later port plugs in |
|---|---|
| Forged items (`assembly.ts` `forgedDef`, `forgeKey`) | `itemDefOf` in `defs.ts` is the one place an instance becomes a definition, and `stackKey` the one place it gets an identity. Modular smithing adds `forged` to `ItemInstance` and its branch in both. `itemValue` then returns the definition's value for a forged item, with no affix or slot multiplier. |
| Carved runes (`runes.ts` `composeCarved`, `runeRefKey`) | `resolveRune` and `runeRefKey` in `defs.ts`. `RuneRef` is a catalogue id today. |
| Socketing, rune sale, rune bonus damage and technique changes | Runecarving. The pile (`runes`) and the catalogue exist; nothing reads the pile. |
| Body grants and size (`mutagens.ts` `bearerGrants`, `playerSizeRank`) | The `items/set-bearer` request. The mutagens port calls it when the body changes. Until then the body has two arms and is medium. |
| Festival door (`festivalRules.ts` `festivalHolds`) | The named fact `festivalHolds`. While it is above 0 the stash is shut. |
| Sheathed blade, items a fight holds, items the festival door holds (`carriedStash`) | The `elsewhere` argument of `carriedStash`. The prestige port passes them. |
| Weapon oils (`state.coating`) | Not read by any old item rule. The alchemy port owns the coating and its source. |
| Combat styles | Not read by any old item rule. A style that needs a tag reads `hasWieldTag`. |
| Monster tag names in "vs" modifier text | `describeMod` prints the tag id. |
| Dropping the weapon under a condition (`dropWeaponBelow`, old `combat.ts:3645`) | Filled by spine port 4: the request `items/drop-worn`, made by `combat` from the player's bar damage. |

## Left behind

- Spare marks (`beats`, `findSpares`, `tallySpares` of the old UI file
  `gearCompare.ts`): the Sell spares toolbar, UI step.

## Spine port 7

- `items/sell { uids }` (old `sellItems`): one log line for the lot,
  `gold/add` earned, socketed runes back to the pile. `sellPrice(item,
  goldGain)` is exported; every pack row carries `sell`.
- `items/equip-now { uid, slot? }`: the equip of the command as a request,
  for the weapon rack of floor 0.
- `newRun`: the stash a prestige keeps (`carriedStash` of the old run).
- `items` now imports `gold`.
- Festival tokens of the stash (`stashToken`, `spendToken`,
  `tokenTechniques`) and `applyFestivalLegacy`: the festival.
- Loadouts (`state.loadouts`): not part of the listed files.
- The forged class stubs of the item registry: modular smithing.
- Rune patterns, adornments and named runes: runecarving.

## Old rules ported as they are

- `items/equip` with a named hand does not check that the body has that
  hand. A one-handed weapon equipped into `hand3` on a two-armed body is
  accepted, and other hands give way until the arms budget fits. The old
  panel never offered such a slot (`allowedSlots`); `wearIfFree` does check.
  The view lists a hand past the arms of the body when it holds something.
- A hand bonus counts only in `weapon` and `offhand`, never in `hand3` to
  `hand6`, and its pairing looks only at the other of those two.
- The oversize label prints the fractional step count after forgiveness
  ("Oversized by 1.9 steps").
- `sizeFit` returns 1 for anything in the `weapon` slot, a shield forced
  into the main hand included.
- An item whose definition is missing can sit in the pack and cannot be
  equipped.
