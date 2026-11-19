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
