# meals

Dish slots and claims. Step 3, the cooking port. Port of old
`systems/meals.ts`. Design: `src/systems/cooking/README.md`, "Step 3
design".

At most `dishLimit()` (3, `MAX_ACTIVE_DISHES`) dishes are active. A dish is
one slot holding one claim per condition it gave; a claim is one dose with
its own clock. Eating a dish already in a slot refreshes that slot; eating a
different dish with every slot full replaces the dish with the least time
left, chosen before the new dish lands, and the replaced dish's conditions
end unless another live claim still gives them.

## Slice (version 1)

`{ slots: MealSlot[], foreign: MealClaim[], rate }`. `MealSlot`: `dish`,
`quality`, `claims`. `MealClaim`: `id`, `dose`, `left` (null: no clock),
`grade`. `foreign` holds claims of sources that are not dishes (a flask, a
condition held before any dish claimed it). `rate`: how far the conditions'
clocks advance this tick, stated by `cooking`'s early tick through
`meals/hand-off`. Fixture `tests/fixtures/meals/v1.json`.

## Order of the steps in a tick

The old `Game.advance` ran the queue and the hand-off before anything moved
and the claim clocks after the conditions ticked. One system has one tick
hook, so the steps are split:

1. `cooking` tick (order -50): the queued dish, then `meals/hand-off { rate }`
   when any slot or foreign claim exists. Rate: 0 while travelling, 5 while
   knocked out, else 1, read before anything moves.
2. `statuses` tick (order 0): the conditions tick.
3. `meals` tick (order 50): every claim's clock runs down by `rate`; claims
   that ran out or whose condition is gone are dropped, then empty slots; a
   condition stronger or longer than its leading claim explains gets a
   foreign claim from what it shows; otherwise it is put back at its leading
   claim.

## Requests

| Request | Old | Use |
|---|---|---|
| `meals/record { dish, quality, landings, victim? }` | `recordMeal` | the eater of `cooking`, after the eat line |
| `meals/hand-off { rate }` | `handOffMeals` | `cooking`'s tick |
| `meals/note-foreign { doses }` | `noteForeignDoses` | another source's doses |

A held condition is changed through `statuses/set-dose` (intensity, peak,
clock) and `statuses/remove`.

## Events

Heard: `alchemy/flask-used { grants }`, where the old `Game.useFlask` called
`noteForeignDoses`.

## Reads

`activeMeals(state, held)`, `mealToReplace(state, held, dish)`,
`dishLimit()`, `isNourishing(id)`.

## View

`limit`, `active`: dish, name, icon, quality, grade, ticks left.

## Old rules ported as they are

- A thrown flask's grants are noted as foreign claims when the player holds
  the condition, though a thrown flask grants the player nothing (old
  `Game.useFlask` passed `used.grants` for every form).
- A condition whose stacking is not `highest` is not re-derived: it ends
  only when no claim is left.
