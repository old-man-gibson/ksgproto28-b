# cooking

The kitchen benches (stove, cutting board, grill, oven, cold counter), the
grade a dish comes out at, the Cook's Book, Cook's Notes, and eating food:
now, or queued after a fight or a knockout. Step 3, port 5.

## Step 3 design

Written and committed before the code. Old sources: `systems/cooking.ts`,
`systems/cookbook.ts`, `systems/eating.ts`, `systems/meals.ts`, the food half
of `systems/consumables.ts`, the heat-window half of `systems/disciplines.ts`
(`timelineUnits`, `meanExposure`, `inHeatWindow`, `HeatOverride`,
`describeHeatWindow`, `heatWindowProblems`, `foodProblems`), the timeline
clock of `systems/benchwork.ts` (`UNIT_TICKS`, `duration`), the five cooking
records of `data/disciplines.data.ts`, `data/preps.data.ts`, the
`cooking.*`, `meals.*` and food `consumables.*` lines of `text/log.text.ts`,
the meal steps of `Game.advance` and `Game.useFlask`, the cookbook half of
`prestigeNow` and `legacy.cookbookRank`. UI: the cooking half of
`ui/panels/BenchPanel.svelte`, `ui/lib/heatTrack.ts` and `HeatTrack.svelte`,
`ui/lib/gradeLedger.ts` and `GradeLedger.svelte`, `ui/lib/cookBook.ts` and
`CookBook.svelte`, `ui/lib/meals.ts` and `DishSlots.svelte`, the Eat button
of `ui/panels/EquipmentPanel.svelte`. Old `docs/COOKING_REVIEW.md` and
`docs/cooking-review/` are an unanswered review and are not ported.

Tests ported: `cooking`, `cookbook`, `cookBookView`, `cookingWindows`,
`meals`, `mealsView`, `recipes`, `heatTrack`, `gradeLedger`, and the three
food cases of `conditionResist` left as `it.todo` by the alchemy port.

### System folders

Two new systems.

| Folder | Holds | Why a system of its own |
|---|---|---|
| `cooking` | The five cooking benches registered with `benches`, the dish grade (exposure, uniformity, judgement, bench fit, the ledger), the cutting board, the Cook's Book counters and Cook's Notes, the food scaling and Signatures, the eat command and the eating queue, the Kitchen panel. | The system itself. |
| `meals` | Dish slots and claims (old `meals.ts`): at most three dishes, one dose per claim with its own clock, eviction, the hand-off and the per-tick claim clock. | The old `Game.advance` ran two meal steps on each tick: the queue and the hand-off before anything moved, the claim clocks after the conditions ticked. A system has one tick hook and one order. `cooking` ticks first (order -50, after `clock`), `meals` last (order 50, after `weather`). |

### `benches` additions

The schema gains what the kitchen records carry: slot `role` `adornment`,
slot `at` (entry point on a timed bench, 0 to 1), discipline `favoredPrep`,
discipline `timeline { options[] { units, name }, default }`, outcome `heat[]
{ tag, from?, to? }`, result `qty`. `disciplines.json` gains the records
`cooking`, `grilling`, `baking`, `assembling`, `preparing`, converted from
the old literals.

Rules gain the old heat half: `timelineUnits`, `meanExposure`,
`inHeatWindow`, `HeatOverride`, `describeHeatWindow`, `heatWindowProblems`,
`foodProblems`. `matchOutcome` and `checkCraft` take `duration` (and
`matchOutcome` an override), as the old ones did; a bench with no timeline
ignores both. `benchJobTicks` takes `duration`: a timed bench runs
`duration x UNIT_TICKS` (10) ticks.

The job gains `duration` (old `benchWork.duration`); `benches/start` takes
an optional `duration` and passes it to the owner's `preview`; the owner's
`craft` request gets `{ placement, duration }`. Alchemy ignores it.

### `cooking`

Slice version 1:

| Field | Old |
|---|---|
| `queued: { dish, quality, why } \| null` | `state.queuedMeal` |
| `carried: { timed: string[], signed: string[] }` | `state.prestige.cookbook` |
| `lastCooked: CookedEvent \| null` | the plate card's last `cooked` event (UI state in the old build) |

The cook counters stay in `counters` (`cooked:<dish>`,
`cooked:<dish>:<tier>`), as the old ones were in `state.stats`. Cook's
Notes is carried here, not in the prestige slice: `newRun(ctx, previous)`
computes the old `carriedCookbook` from `previous(counters)` and
`previous(cooking).carried`. The rank is read from `prestige` (`boonRank` of
the `cookbook` boon), as the old `cookbookRank`.

Content: `cooking_text` (the log and reason lines); `preps` (3 records, old
`PREPS`), and `UNIFORMITY`, `EXPOSURE`, the judgement cap and the counts
(`COOK_TIME_COOKS` 25, `SIGNATURE_COOKS` 100) as constants, unchanged.

Pure (`cook.ts`): `exposureInfo`, `isPrepped`, `tierFor`, `cookJudgement`,
`cookLedger`, `dishQuality`, `dishQualityRange`, `previewCook` over a reads
context (level, stock, known recipes). `cookbook.ts`: `cookedKey`,
`cookedGradeKey`, `cookedCount`, `cookTimeKnown`, `signatureEarned`,
`cookbook`, `dishHasCookTime`, `cookingDishIds`, `carriedCookbook`.

Benches: `registerBench(<id>, { preview, craft: cookRequest })` for each of
the five. `cooking/cook { discipline, placement, duration }` answers the old
`cook`: check; the board rolls its cut (`rollQuality(rng, 1 + level / 20)`,
capped at the ingredient's grade) before spending; spend through
`materials/take-graded`; the dish grade rolled per prepped part; grant;
`skills/check-discovery`; counters `cooked:<dish>` and per grade;
`skills/grant-discovery-xp cookery` on the first cook of a dish;
`skills/grant-xp` with the dish as the novelty key; `benches/crafted`; the
new event `cooking/cooked` (the old `cooked`); the tally line with the
threshold notes. Counters are events here, delivered after the handler: the
threshold notes compare the count before the cook with the count plus one,
which is what the old code read after its bump.

Commands:

| Command | Old | Refused when |
|---|---|---|
| `cooking/eat { id, quality }` | `eat` | the plan is blocked (the reason of `consumables`' check, logged as `🔒 <reason>`) |
| `cooking/cancel-meal` | `cancelQueuedMeal` | nothing is queued |

Eating (food): `consumables` keeps the one door. Its check (`canUse`) drops
the refusal "not ported" and answers as the old one did. `consumables/use`
on food, out of a fight, takes one and asks the eater registered by
`cooking` (`registerEater(request)`, as `registerBench`): the request
`cooking/eat-food { id, quality, queued? }` does the old food path: food
scale from `foodDuration` and `foodPotency` (benefit side only), restore
times potency, refuse grade gives the spoilage condition, else the grants
and the Signature once earned, each dose recorded as a landing; cures; the
cooldown; the eat line (Signature and queued variants); the counter
`food:spoiled` and `titles/check` for spoiled food; then `meals/record`.
`cooking/eat` plans as the old `eatPlan`: food in a fight or a knockout is
queued (one dish, replaced by another, cancelled by the command); otherwise
it asks `consumables/use-now` (the body of `consumables/use` as a request).

Tick (`order: -50`): old `tickMeals`, then the old `handOffMeals` as the
request `meals/hand-off { rate }`. The rate is the conditions' clock this
tick, read before anything moves: 0 while travelling (`resources` pace
halted), 5 while knocked out (`statuses` down), else 1.

View: the benches at the spot, per bench the open slots, the next slot, the
stock each slot accepts, the timeline; the Cook's Book rows; the eat plans
of held food; the queued dish; the last cooked dish. The pure UI helpers of
the old `ui/lib` (`heatTrack`, `gradeLedger`, `cookBook`, `meals`) move into
this folder, as the old tests call them.

### `meals`

Slice version 1: `{ slots: MealSlot[], foreign: MealClaim[], rate: number }`
(old `state.meals`, `state.foreignClaims`; `rate` is the clock the hand-off
read this tick, for the claim step at the end of it).

Requests: `meals/record { dish, quality, landings, victim? }` (old
`recordMeal`), `meals/hand-off { rate }` (old `handOffMeals`, stores the
rate), `meals/note-foreign { doses }` (old `noteForeignDoses`). Reads:
`activeMeals`, `mealToReplace`, `dishLimit`, `MAX_ACTIVE_DISHES`.

Tick (`order: 50`): old `tickMealClaims(rate)`.

Heard: `alchemy/flask-used { grants }` (new, emitted by `alchemy/use-flask`
where the old `Game.useFlask` called `noteForeignDoses`).

A held condition is changed through `statuses`: the new request
`statuses/set-dose { entity, id, intensity, ticksLeft }` (writes intensity,
peak and clock, touches the source), and `statuses/remove`.

### Requests and events between the systems

| Folder | Addition | For |
|---|---|---|
| `benches` | schema fields, heat rules, `duration` on start, job, preview and craft | the stove |
| `consumables` | `registerEater`, request `consumables/use-now`, export of the restore step, food rows read the cooking view | eating |
| `statuses` | request `statuses/set-dose` | claims |
| `alchemy` | event `alchemy/flask-used { grants }` | claims |

### Panels

- Kitchen (`cooking/panel.ts`): at a spot with a cooking bench, a tab per
  bench; the slots (click a slot, then an ingredient and grade from the
  list); on the stove the timeline options, the heat track rows and the
  cook-time row; the grade ledger line and ruler; the preview label; Cook,
  x5, All, Keep going, Stop, Clear; the run's bar in a fixed box; the last
  dish cooked. The Cook's Book below, one section per bench. Away from a
  kitchen, the names of the spots that have one.
- Provisions (`consumables`): food rows use the cooking view's eat plan
  (Eat, Eat after this fight, Eat after recovering, Cancel) and send
  `cooking/eat` or `cooking/cancel-meal`; the dish slots list
  (`cooking/DishSlots.svelte`) above the rows (decision 29).

Every box has a fixed height; no size depends on per-tick state. Checked at
desktop width and 375 px.

### Waits (left behind)

- Facet signals `eat`, `itemUsed`, `flaskUsed`; calories and Calorie Burn
  (`dishCalories` is ported as a read; nothing consumes it).
- Shadow Clones at a bench, bonus time, performances.
- The festival's hold on meals.
- No spot through floor 6 places the grill, the oven or the cold counter
  (only the player base, not in scope). Their records are ported, so the
  dishes they make satisfy the food lint and the old tests.
- `base_kitchen` and the player base.

## Files

| File | Holds |
|---|---|
| `defs.ts` | The `preps` registry (3 knife techniques), `cooking_text`, `UNIFORMITY`, `EXPOSURE`, the judgement cap, the Book thresholds, `COOKING_BENCHES` |
| `cook.ts` | Exposure, contribution, `cookJudgement`, `cookLedger`, `dishQuality(Range)`, `rollDishQuality`, `previewCook` (pure over `BenchReads`) |
| `cookbook.ts` | The Book over `BookReads` (counters, carried lists, Cook's Notes rank), `carriedCookbook` |
| `food.ts` | `eatenApplication`, `doseTicks`, `foodScale`, `dishCalories`, `isSpoiledFood`, `foodProblems` |
| `index.ts` | The slice, the bench and eater registrations, `cooking/cook`, `cooking/eat-food`, the eat and cancel commands, the queue, the early tick, the view, `newRun` |
| `heatTrack.ts`, `gradeLedger.ts`, `bookView.ts`, `mealsView.ts` | The old pure UI helpers of `ui/lib`, words unchanged |
| `KitchenPanel.svelte`, `DishSlots.svelte`, `panel.ts` | The Kitchen panel; the dish list Provisions mounts |

## Slice (version 1)

`{ queued: { dish, quality, why } | null, carried: { timed, signed },
plate: { cooked, before } | null }`. Fixture `tests/fixtures/cooking/v1.json`.

## Changed while building (step 3)

- `benches` hands its owner a placement and a duration only, so each of
  the five benches has its own craft request (`cooking/craft-<bench>`);
  `cooking/cook { discipline, placement, duration }` answers the old
  `cook` with its result, for tests and callers that need the dish.
- The plate card's state is in the slice (`plate`: the last cook and the
  dish's mark before it). The old UI kept it in the bench window.
- The cook tick returns after one read while nothing is queued and no
  claim is held.
- The Kitchen panel's Cook's Book is a table (dish, made, best, cook time,
  Signature); the old grade squares are in `bookView.ts` and tested, not
  drawn.
- The Eat button's tooltip is a `title`; the same facts are in the row's
  second line (click, not hover).

## Old rules ported as they are

- The grill, the oven and the cold counter are ported with their dishes,
  but no spot through floor 6 has them (only the player base).
- Fair ingredients top out at Superb at the judgement cap; Divine needs
  Superb ingredients.
- A dish's restore follows the cook's potency; a dish's own `duration`
  and the condition's default both follow the cook's duration.
- `dishCalories` is computed and read by nothing (Facet's Calorie Burn is
  not ported).
- A thrown flask's grants are noted as foreign claims (see `meals`).

## Found while porting (spine era, not cooking)

The new `combat` ticks while the player is knocked out; the old
`tickAction` returned early while recovering. With a hand-set knockout and
a hunt still on, a fight opens on the tick recovery ends. A real knockout
stops the hunt, so play is not affected. Not changed here; `docs/SPINE.md`
section 14.4.

## Left behind

- Facet signals `eat`, `itemUsed`, `flaskUsed`; Calorie Burn.
- Shadow Clones at a bench, bonus time, performances.
- The festival's hold on meals.
- `base_kitchen` and the player base (the only spot with the grill, the
  oven and the cold counter).
- The old `ui/lib/format.ts` stat tooltips (`sumMods`, `statTipLines`): two
  `it.todo` in `tests/cookBookView.test.ts`.
- Old save migrations v57 to v59: `it.todo` in `tests/cookbook.test.ts`
  and `tests/meals.test.ts`.

## Tests

`tests/cooking.test.ts` (49), `recipes` (6), `cookbook` (61, 5 todo),
`cookingWindows` (46), `heatTrack` (27), `gradeLedger` (10), `meals` (62,
3 todo), `mealsView` (13), `cookBookView` (29, 2 todo), the three food
cases of `conditionResist`, the food case of `consumables`.

## Step 4 port F

- The craft request takes `xpScale` (a Shadow Clone's share of the skill
  XP, `benches` README, port F) and passes it as `scale` on its skill XP
  events. A clone's craft is otherwise the player's craft: the same preview,
  spend, roll and lines.
- The Kitchen panel mounts `facet/CloneBenchButton.svelte` ("Send a clone"),
  shown only while the held ability has clones.
