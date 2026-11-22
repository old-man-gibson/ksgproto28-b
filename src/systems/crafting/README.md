# crafting

Recipes worked as a spot activity: spend the inputs, bank the product, on
the activity bar. Through floor 6 that is the smelting line at the Forges.
Step 3, port 6 (with `smithing`).

## Step 3 design

Written and committed before the code. Old sources: `systems/crafting.ts`
(`recipeUnlocked`, `recipeHidden`, `recipeRoutes`, `chooseRoute`,
`canAfford`, `routeYield`, `consumeCost`, `recipeResultName`,
`recipeResultIcon`, `recipeCostText`), the craft half of `systems/actions.ts`
(`spotActivities` synthesis, the `craft` branches of `startActivity`,
`canStartActivity`, `trainingSpots`, `activityXpTags`, `activityCost`,
`activityFillRate` and `tickAction`), `data/recipes.data.ts` (the four
records the Forges list), `actions.craft_locked` and
`actions.out_of_materials` of `text/log.text.ts`. The inventory of old
`main` is in `src/systems/smithing/README.md`.

Tests ported: the craft cases of `tests/activities.test.ts` ("recipes with
alternative routes", the craft speed case), of `tests/phase2.test.ts`
("crafting"), of `tests/rarefinds.test.ts` (the Smith's Pattern unhides the
bronze line), of `tests/quests.test.ts` (the ingot craft) and the recipe
half of the `worldContent` `it.todo`. The route cases use the old `leather`
recipe as a literal in the test: no spot through floor 6 lists it.

### Slice and content

Slice version 1: `{}`. Progress of a craft is the world's
`activityProgress`, as in the old build. Fixture
`tests/fixtures/crafting/v1.json`.

Content: `recipes`, 4 records (`iron_ingot`, `copper_ingot`, `tin_ingot`,
`bronze_ingot`), old numbers. Schema: `id`, `name?`, `tags`, `result { kind:
material | item | rune, id, qty? }`, `cost [{ id, qty }]`, `alts? [{ id,
cost, qty? }]`, `ticks`, `xp`, `unlock?` (conditions), `secret?`.
`crafting_text`: the two log lines.

### The craft activity in `world`

`world` cannot import `crafting` (it would import `world` back). Same
arrangement as `registerCardSpent`: `world/defs.ts` gains
`registerCraftKind(provider)`, which `crafting` calls at module load.

- `spotActivities(spot)`: the spot's own activities, then one `craft`
  activity per listed recipe the provider knows (`craft_<recipe>`, name
  `Craft <result>`, icon of the result, `tags` of the recipe, `recipe`).
  Old order kept. Without a provider, as now: the spot's own.
- `ActivityDef` gains `kind: 'craft'` and `recipe` in its TypeScript type
  only; the spot schema does not author crafts.
- `activityXpTags`: `['craft', ...tags]`. `activityCost`: the recipe's
  ticks. `activityFillRate`: old rule, speed x speed factors x `craftSpeed`
  x the scoped `craftSpeed` of the recipe tags.
- `startActivity` and `world/select-activity`: a locked recipe is refused
  with `🔒 You lack the skill to craft that.` (old text) and the reason
  `the recipe "<id>" is locked`. `canStartActivity`: unlocked and
  affordable. `trainingSpots` skips locked crafts (the provider answers
  from the counters).
- The tick: `case 'craft'` asks the provider's `tick(ctx, act, stats)`,
  which is old `tickAction`'s craft branch: starved at the start of a
  cycle stops with `<name>: out of materials` (old text); the bar fills;
  at the cost the progress resets to 0 (old: reset, not carry), the route
  is chosen, its cost taken through `materials/take`, the yield granted,
  skill XP `xp + 0.2 x ticks` under the tags, attribute XP (none: no
  recipe sets `attrXp`), `world/cycle` with `baseTicks` = recipe ticks (the
  exposure of the Forges' heat tag rides it, as the old
  `grantActivityExposure`), `counters/bump crafts`, `benches/crafted {
  discipline: 'craft', recipe }` (the old bus event `craft` carried
  `recipe`), and the repeat line `🔨 Crafted <icon> <name>` grouped
  `act:<activity>`.

`materials` gains `materials/take { id, qty }`: take exactly `qty` of a
plain material, or nothing and false. `smithing` uses it too.

### Panel

None of its own. The Location panel lists `spotActivities`, so the craft
lines appear there with every other activity. A secret recipe not yet
unlocked is not listed (old `recipeHidden`): the provider leaves it out of
`spotActivities` for a reader that can answer. Decided while building
whether the Location panel needs the reader passed in or the provider reads
the counters view; recorded below.

### Left behind

- The other recipes of the old registry: leatherwork (cap, vest, boots,
  bow, wolf cloak, leather), the herbal charm, histones (mutagens), the
  harbor line (cannon, cannonballs, powder): no spot through floor 6 lists
  them.
- Output factors on a craft (`outputFactors`): no craft activity is
  authored, so none has them.
- Shadow Clones on a craft activity.

### John and budgets

John smelts only on floor 11 (out of scope). No tick hook of its own; a
world tick with no craft activity takes the old branches. Expected
unchanged.

## Files

| File | Holds |
|---|---|
| `defs.ts` | The `recipes` and `crafting_text` registries, the unlock reads and the route rules |
| `index.ts` | The declaration, the craft activity (`craftActivity`), the tick (`tickCraft`) and the registration with `world` |
| `content/recipes.json`, `crafting_text.json` | 4 recipes, 1 log line |

## Skip reasons

No command of its own. `world/select-activity` on a locked craft:
`the recipe "<id>" is locked`, with the log line `🔒 You lack the skill to
craft that.`

## Changed while building (step 3)

- The provider is `CraftKind` in `world/defs.ts`: `activities`, `ticks`,
  `unlocked`, `hidden`, `affordable`, `detail`, `tick`. `tick` answers
  false when the craft stops; the world then clears the activity, sends the
  pace and `world/activity-changed`, as for a spent search.
- `spotActivities` stays pure and lists every known recipe of the spot,
  secret or not, as the old one did. The Location view (`activityViews` in
  `world/index.ts`) asks the provider's `hidden` and leaves a secret recipe
  not yet unlocked out. No reader is passed to the panel.
- A locked craft is listed with the icon 🔒, disabled, and the line
  `Requires: <conditions>` (old title text). An unlocked one carries
  `Cost: <routes>` with the route a craft would take marked `▸`.
- `🔒 You lack the skill to craft that.` is in `world_text` (key
  `craft_locked`): the world's `startActivity` logs it. `crafting_text`
  holds `out_of_materials` only.
- `trainingSpots` takes the reads first: `trainingSpots(ctx, state, target)`.
- The old `consumeCost` is not ported. The tick takes each cost line of the
  chosen route through `materials/take`. The route tests do the same.
- Quest port: no quest here has a `craft` objective (the old
  `hammer_and_anvil` is not in scope). `tests/quests.test.ts` keeps its
  `it.todo`.
- Tests not ported: "crafted items land in the inventory" (`leather_cap`)
  and "gated recipes refuse selection until the skill threshold"
  (`wolf_cloak`) are `it.todo`: no spot through floor 6 lists those recipes.

## Old rules ported as they are

- An unaffordable craft can be picked: `world/select-activity` refuses a
  craft only while it is locked. Its first tick logs `📭 Out of materials
  for <name>.` and stops it. The resume entry stays.
- The bar resets to 0 at the end of a cycle. Progress past the cost is lost.
- A rune result reads its name and icon from the material registry, so it
  shows its id and 🔨. No recipe in scope makes a rune.
- A craft with an unknown recipe costs 50 base ticks. None exists.
- `attributes/grant-xp-split` is sent on every craft with empty weights: no
  craft activity sets `attrXp`.
- `tin_ingot` has `xp: 0`. It still pays `0.2 x 60 = 12` skill XP per craft.
- A secret recipe is in `spotActivities`. Picking one by id before it is
  unlocked is refused as locked, which says it exists.

## Step 4 port C3

The battery's three recipes (old `recipes.data.ts` 170-202), listed at the
quay of floor 11: `ship_cannon` (6 iron ingots, 600 ticks), `cannonball`
(3 from 1 iron ingot, 90 ticks), `powder_charge` (2 from 3 biomatter and
1 iron scrap, 120 ticks, alchemy). Worth no more than their inputs at any
counter (`tests/harbor.test.ts`, the no-arbitrage case).
